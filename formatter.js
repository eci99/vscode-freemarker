const BLOCK_DIRECTIVES = new Set([
  'if', 'list', 'foreach', 'switch', 'macro', 'function', 'attempt', 'compress',
  'noparse', 'outputformat', 'autoesc', 'noautoesc', 'escape', 'transform',
  'items', 'sep', 'recover', 'visit', 'recurse'
]);
const BRANCH_DIRECTIVES = new Set(['else', 'elseif', 'case', 'default', 'recover']);

// The whitespace inside these elements is part of the page.
const PREFORMATTED_ELEMENTS = new Set(['pre', 'textarea']);
// Scripts and style sheets keep the indentation they have relative to their first line.
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

const { isRawStringStart, normalizeTemplate } = require('./syntax');
const { htmlTags } = require('./validator');

function maskComments(text) {
  return text.replace(/<#--[\s\S]*?-->/g, (comment) =>
    comment.replace(/[^\r\n]/g, ' ')
  );
}

function findTagEnd(text, start) {
  let quote = null;
  let raw = false;
  let parentheses = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\' && !raw) index += 1;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
      raw = isRawStringStart(text, index);
    } else if (character === '(') {
      parentheses += 1;
    } else if (character === ')') {
      parentheses = Math.max(0, parentheses - 1);
    } else if (character === '>' && parentheses === 0) {
      return index;
    }
  }
  return -1;
}

// The FreeMarker tags of a template. A tag can span several lines.
function freemarkerTags(text) {
  const tags = [];
  const opening = /<(\/?)#([A-Za-z_][A-Za-z0-9_-]*)|<(\/?)@([A-Za-z_][A-Za-z0-9_.-]*)/g;
  let match;

  while ((match = opening.exec(text)) !== null) {
    const end = findTagEnd(text, opening.lastIndex);
    if (end < 0) continue;
    const directive = match[2] !== undefined;
    const closing = directive ? match[1] === '/' : match[3] === '/';
    const name = directive ? match[2] : match[4];
    const selfClosing = !directive && !closing && /\/\s*$/.test(text.slice(opening.lastIndex, end));
    tags.push({
      offset: match.index,
      end,
      directive,
      closing,
      selfClosing,
      name: name.toLowerCase()
    });
    opening.lastIndex = end + 1;
  }
  return tags;
}

function formatterMarker(line) {
  const marker = /@formatter:(off|on)\b/.exec(line);
  if (!marker) return undefined;

  const commentOpeners = [
    { token: '<#--', closer: '-->' },
    { token: '[#--', closer: '--]' },
    { token: '<!--', closer: '-->' },
    { token: '/*', closer: '*/' },
    { token: '//', closer: '' }
  ];
  let quote = null;
  let commentCloser = null;
  for (let index = 0; index < marker.index; index += 1) {
    if (commentCloser !== null) {
      if (commentCloser && line.startsWith(commentCloser, index)) {
        index += commentCloser.length - 1;
        commentCloser = null;
      }
      continue;
    }
    const character = line[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    const opener = commentOpeners.find((comment) => line.startsWith(comment.token, index));
    if (opener) {
      commentCloser = opener.closer || '';
      index += opener.token.length - 1;
    }
  }
  return commentCloser !== null ? marker[1] : undefined;
}

// The tags of a template by the line they start on, the lines that continue a FreeMarker
// tag, and the lines inside HTML elements that are not indented like the rest. Of the
// HTML elements only those that have both tags take part, so a <li> or <p> without an
// end tag does not shift what follows.
function templateStructure(maskedText) {
  const lineStarts = [0];
  for (let index = maskedText.indexOf('\n'); index >= 0; index = maskedText.indexOf('\n', index + 1)) {
    lineStarts.push(index + 1);
  }
  const locate = (offset) => {
    let line = lineStarts.length - 1;
    while (lineStarts[line] > offset) line -= 1;
    return { line, start: offset - lineStarts[line] };
  };

  const tags = new Map();
  const continuations = new Map();
  const regions = [];
  for (const tag of freemarkerTags(maskedText)) {
    const position = locate(tag.offset);
    tag.start = position.start;
    if (!tags.has(position.line)) tags.set(position.line, []);
    tags.get(position.line).push(tag);
    for (let line = position.line + 1; line <= locate(tag.end).line; line += 1) continuations.set(line, tag);
  }
  for (const pair of htmlTags(maskedText).pairs) {
    const name = maskedText.slice(pair.open, pair.open + pair.openLength).toLowerCase();
    const open = locate(pair.open - 1);
    const close = locate(pair.close - 2);
    for (const [position, closing] of [[open, false], [close, true]]) {
      if (!tags.has(position.line)) tags.set(position.line, []);
      tags.get(position.line).push({ start: position.start, directive: false, closing, selfClosing: false, name });
    }
    if (PREFORMATTED_ELEMENTS.has(name)) {
      regions.push({ first: open.line + 1, last: close.line, preformatted: true });
    } else if (RAW_TEXT_ELEMENTS.has(name)) {
      regions.push({ first: open.line + 1, last: close.line - 1, preformatted: false });
    }
  }
  for (const lineTags of tags.values()) lineTags.sort((left, right) => left.start - right.start);
  return { tags, continuations, regions: regions.filter((region) => region.last >= region.first) };
}

function indentationOf(line) {
  return line.length - line.trimStart().length;
}

// How many of ( [ { are still open at the end of the text, outside of strings.
function openBrackets(text) {
  let depth = 0;
  let quote = null;
  let raw = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\' && !raw) index += 1;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
      raw = isRawStringStart(text, index);
    } else if (character === '(' || character === '[' || character === '{') {
      depth += 1;
    } else if (character === ')' || character === ']' || character === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return depth;
}

function formatTemplate(text, options = {}) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const sourceLines = text.split(/\r?\n/);
  const maskedText = maskComments(normalizeTemplate(text, options).text);
  const maskedLines = maskedText.split(/\r?\n/);
  const lineOffsets = [0];
  for (let index = maskedText.indexOf('\n'); index >= 0; index = maskedText.indexOf('\n', index + 1)) {
    lineOffsets.push(index + 1);
  }
  const html = templateStructure(maskedText);
  for (const region of html.regions) {
    const lines = sourceLines.slice(region.first, region.last + 1).filter((line) => line.trim());
    region.indentation = Math.min(...lines.map(indentationOf));
  }
  const indentUnit = options.insertSpaces === false
    ? '\t'
    : ' '.repeat(Math.max(1, options.tabSize || 4));
  let depth = 0;
  let formattingDisabled = false;
  // The open tags with the indentation of their line and the depth before them.
  const openTags = [];
  const tagKey = (tag) => `${tag.directive ? '#' : '<'}${tag.name}`;
  const openerOf = (tag) => {
    for (let index = openTags.length - 1; index >= 0; index -= 1) {
      if (openTags[index].key === tagKey(tag)) return index;
    }
    return -1;
  };

  const formatted = sourceLines.map((line, lineIndex) => {
    const marker = formatterMarker(line);
    if (formattingDisabled) {
      if (marker === 'on') formattingDisabled = false;
      return line;
    }
    if (marker === 'off') {
      formattingDisabled = true;
      return line;
    }
    if (marker === 'on') return line;
    if (!line.trim()) return '';
    const masked = maskedLines[lineIndex];
    const tags = html.tags.get(lineIndex) || [];
    const firstTag = tags.find((tag) => masked.slice(0, tag.start).trim() === '');
    const continued = html.continuations.get(lineIndex);
    let lineDepth = depth;

    if (continued) {
      // The rest of a tag is indented below its first line, and the end of the tag lines up with it.
      // The entries of a hash or sequence are indented like JSON, by how deeply they are nested.
      const nesting = openBrackets(maskedText.slice(continued.offset, lineOffsets[lineIndex]));
      const closers = /^\s*[}\])]*/.exec(masked)[0].trim().length;
      lineDepth = continued.lineDepth + (nesting > 0
        ? Math.max(0, nesting - closers)
        : /^\s*\/?>/.test(masked) ? 0 : 1);
    } else if (firstTag && (firstTag.closing || (firstTag.directive && BRANCH_DIRECTIVES.has(firstTag.name)))) {
      const opener = firstTag.closing ? openerOf(firstTag) : -1;
      lineDepth = opener >= 0 ? openTags[opener].lineDepth : Math.max(0, lineDepth - 1);
    }

    for (const tag of tags) {
      tag.lineDepth = lineDepth;
      if (tag.directive) {
        if (tag.closing && BLOCK_DIRECTIVES.has(tag.name)) {
          const opener = openerOf(tag);
          if (opener >= 0) {
            depth = openTags[opener].depthBefore;
            openTags.length = opener;
          } else {
            depth = Math.max(0, depth - 1);
          }
        } else if (!tag.closing && BLOCK_DIRECTIVES.has(tag.name) && !BRANCH_DIRECTIVES.has(tag.name)) {
          openTags.push({ key: tagKey(tag), lineDepth, depthBefore: depth });
          depth += 1;
        }
      } else if (tag.closing) {
        const opener = openerOf(tag);
        if (opener >= 0) {
          depth = openTags[opener].depthBefore;
          openTags.length = opener;
        } else {
          depth = Math.max(0, depth - 1);
        }
      } else if (!tag.selfClosing) {
        openTags.push({ key: tagKey(tag), lineDepth, depthBefore: depth });
        depth += 1;
      }
    }

    const region = html.regions.find((candidate) => lineIndex >= candidate.first && lineIndex <= candidate.last);
    if (region && region.preformatted) return line;
    const content = region ? line.slice(Math.min(region.indentation, indentationOf(line))) : line.trimStart();
    return `${indentUnit.repeat(lineDepth)}${content}`;
  });

  return formatted.join(newline);
}

module.exports = { formatTemplate };