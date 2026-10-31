const BLOCK_DIRECTIVES = new Set([
  'if', 'list', 'foreach', 'switch', 'macro', 'function', 'attempt', 'compress',
  'noparse', 'outputformat', 'autoesc', 'noautoesc', 'escape', 'transform',
  'items', 'sep', 'recover', 'visit', 'recurse'
]);
const BRANCH_DIRECTIVES = new Set(['else', 'elseif', 'case', 'default', 'recover']);
// <#assign name>...</#assign> captures its content; with = it has no end tag.
const CAPTURE_DIRECTIVES = new Set(['assign', 'local', 'global']);
const CAPTURE_HEADER = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*|"[^"]*"|'[^']*')(?:\s+in\s[\s\S]+)?\s*$/;

// In these blocks a line break before the end tag would be part of what they repeat,
// capture or return, so their end tag stays where it is.
const INLINE_END_DIRECTIVES = new Set(['list', 'foreach', 'items', 'sep', 'macro']);

// The whitespace inside these elements is part of the page.
const PREFORMATTED_ELEMENTS = new Set(['pre', 'textarea']);
// Scripts and style sheets keep the indentation they have relative to their first line.
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

const {
  INTERPOLATION_SCAN, TAG_SCAN, commentRanges, interpolationEnd, isRawStringStart, maskComments, normalizeTemplate, repeatedScan
} = require('./syntax');
const { findHtmlTagEnd, htmlTags } = require('./validator');

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
  const tagEnd = repeatedScan(text, findTagEnd, TAG_SCAN, true);
  let match;

  while ((match = opening.exec(text)) !== null) {
    const end = tagEnd(opening.lastIndex);
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
      capture: directive && !closing && CAPTURE_DIRECTIVES.has(name.toLowerCase())
        && CAPTURE_HEADER.test(text.slice(opening.lastIndex, end)),
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
  // An interpolation that spans several lines, such as ${message(\n"key")}, is continued like a tag.
  const interpolations = new Map();
  for (const interpolation of multiLineInterpolations(maskedText)) {
    const position = locate(interpolation.offset);
    const last = locate(interpolation.end).line;
    if (last === position.line || continuations.has(position.line + 1)) continue;
    if (!interpolations.has(position.line)) interpolations.set(position.line, []);
    interpolations.get(position.line).push(interpolation);
    for (let line = position.line + 1; line <= last; line += 1) continuations.set(line, interpolation);
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
  return { tags, continuations, interpolations, regions: regions.filter((region) => region.last >= region.first) };
}

// The interpolations of a template outside of FreeMarker tags, as { offset, end }: the
// offset after ${ and the offset of the closing }.
function multiLineInterpolations(text) {
  const found = [];
  const tags = freemarkerTags(text);
  const closingBrace = repeatedScan(text, interpolationEnd, INTERPOLATION_SCAN, true);
  let tagIndex = 0;
  for (let index = 0; index < text.length; index += 1) {
    while (tagIndex < tags.length && tags[tagIndex].end < index) tagIndex += 1;
    const tag = tags[tagIndex];
    if (tag && index >= tag.offset && index <= tag.end) {
      index = tag.end;
      continue;
    }
    if ((text[index] !== '$' && text[index] !== '#') || text[index + 1] !== '{') continue;
    const end = closingBrace(index + 2);
    if (end < 0) continue;
    found.push({ offset: index + 2, end, interpolation: true });
    index = end;
  }
  return found;
}

// Whether the text ends inside a string literal, so that the next line is part of the string.
function endsInString(text) {
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
    }
  }
  return quote !== null;
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

// The lines that are between @formatter:off and @formatter:on, with the markers.
function disabledLines(lines) {
  const disabled = new Set();
  let off = false;
  lines.forEach((line, lineIndex) => {
    const marker = formatterMarker(line);
    if (off || marker === 'off') disabled.add(lineIndex);
    if (marker === 'off') off = true;
    else if (marker === 'on') off = false;
  });
  return disabled;
}

// Puts an end tag on a line of its own when its start tag is alone on its line, so
// <#if x>⏎text</#if> becomes <#if x>⏎text⏎</#if>. This holds for FreeMarker blocks,
// macro calls with a body, and HTML elements, but not for the content of <pre>,
// <textarea>, <script> and <style>, and not between @formatter:off and @formatter:on.
// A FreeMarker end tag moves only if nothing follows it on its line, since the line
// break after it then is not output, and not for loops, macros and captures, so the
// output stays the same.
function separateEndTags(text, options, newline) {
  const masked = maskComments(normalizeTemplate(text, options).text);
  const lineStart = (offset) => masked.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = (offset) => {
    const end = masked.indexOf('\n', offset);
    return end < 0 ? masked.length : end;
  };
  const alone = (start, end) => !masked.slice(lineStart(start), start).trim()
    && !masked.slice(end + 1, lineEnd(end + 1)).trim();
  const lineIndex = (offset) => masked.slice(0, offset).split('\n').length - 1;
  const disabled = disabledLines(text.split(/\r?\n/));

  // Pairs of { start, end, close }: the start tag from start to end, and the offset of the end tag.
  const pairs = [];
  const open = [];
  for (const tag of freemarkerTags(masked)) {
    const key = `${tag.directive ? '#' : '@'}${tag.name}`;
    if (tag.closing) {
      const opener = open.map((candidate) => candidate.key).lastIndexOf(key);
      if (opener < 0) continue;
      const start = open[opener];
      open.length = opener;
      if (start.inline || masked.slice(tag.end + 1, lineEnd(tag.end + 1)).trim()) continue;
      pairs.push({ start: start.offset, end: start.end, close: tag.offset });
    } else if (tag.directive
      ? tag.capture || (BLOCK_DIRECTIVES.has(tag.name) && !BRANCH_DIRECTIVES.has(tag.name))
      : !tag.selfClosing) {
      open.push({ key, offset: tag.offset, end: tag.end, inline: tag.capture || INLINE_END_DIRECTIVES.has(tag.name) });
    }
  }
  const verbatim = [];
  for (const pair of htmlTags(masked).pairs) {
    const name = masked.slice(pair.open, pair.open + pair.openLength).toLowerCase();
    const end = findHtmlTagEnd(masked, pair.open + pair.openLength);
    if (end < 0) continue;
    const close = pair.close - 2;
    if (PREFORMATTED_ELEMENTS.has(name) || RAW_TEXT_ELEMENTS.has(name)) {
      verbatim.push({ from: end, to: PREFORMATTED_ELEMENTS.has(name) ? close + 1 : close });
    }
    pairs.push({ start: pair.open - 1, end, close });
  }

  const breaks = new Set();
  for (const pair of pairs) {
    if (!alone(pair.start, pair.end) || !masked.slice(lineStart(pair.close), pair.close).trim()) continue;
    if (verbatim.some((region) => pair.close > region.from && pair.close < region.to)) continue;
    if (disabled.has(lineIndex(pair.close))) continue;
    breaks.add(pair.close);
  }
  let result = text;
  for (const offset of [...breaks].sort((left, right) => right - left)) {
    result = `${result.slice(0, offset).trimEnd()}${newline}${result.slice(offset)}`;
  }
  return result;
}

function formatTemplate(text, options = {}) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  if (options.separateEndTags !== false) text = separateEndTags(text, options, newline);
  const sourceLines = text.split(/\r?\n/);
  const normalizedText = normalizeTemplate(text, options).text;
  const maskedText = maskComments(normalizedText);
  const maskedLines = maskedText.split(/\r?\n/);
  const lineOffsets = [0];
  for (let index = maskedText.indexOf('\n'); index >= 0; index = maskedText.indexOf('\n', index + 1)) {
    lineOffsets.push(index + 1);
  }
  // A comment that fills whole lines starts at the beginning of its first line; the lines of
  // a longer one are left as they are.
  const commentLines = new Map();
  // The last line that starts at or before the offset.
  const lineOf = (offset) => {
    let low = 0;
    let high = lineOffsets.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineOffsets[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  for (const { start, end } of commentRanges(normalizedText)) {
    const first = lineOf(start);
    const last = lineOf(end);
    const lineEnd = last + 1 < lineOffsets.length ? lineOffsets[last + 1] : normalizedText.length;
    if (normalizedText.slice(lineOffsets[first], start).trim() || normalizedText.slice(end, lineEnd).trim()) continue;
    commentLines.set(first, 'first');
    for (let line = first + 1; line <= last; line += 1) commentLines.set(line, 'rest');
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
    const commentLine = commentLines.get(lineIndex);
    if (commentLine) return commentLine === 'first' ? line.trimStart() : line;
    const masked = maskedLines[lineIndex];
    const tags = html.tags.get(lineIndex) || [];
    const firstTag = tags.find((tag) => masked.slice(0, tag.start).trim() === '');
    const continued = html.continuations.get(lineIndex);
    let lineDepth = depth;

    if (continued && endsInString(maskedText.slice(continued.offset, lineOffsets[lineIndex]))) {
      // The line continues a string, whose spaces are part of its value.
      return line;
    }
    if (continued) {
      // The rest of a tag is indented below its first line, and the end of the tag lines up with it.
      // The entries of a hash or sequence are indented like JSON, by how deeply they are nested.
      const nesting = openBrackets(maskedText.slice(continued.offset, lineOffsets[lineIndex]));
      const closers = /^\s*[}\])]*/.exec(masked)[0].trim().length;
      lineDepth = continued.lineDepth + (nesting > 0
        ? Math.max(0, nesting - closers)
        : !continued.interpolation && /^\s*\/?>/.test(masked) ? 0 : 1);
    } else if (firstTag && (firstTag.closing || (firstTag.directive && BRANCH_DIRECTIVES.has(firstTag.name)))) {
      const opener = firstTag.closing ? openerOf(firstTag) : -1;
      lineDepth = opener >= 0 ? openTags[opener].lineDepth : Math.max(0, lineDepth - 1);
    }

    for (const interpolation of html.interpolations.get(lineIndex) || []) interpolation.lineDepth = lineDepth;
    // Several tags that are opened on one line, as in <p>Text <b>bold, indent what follows by one level.
    const depthAtLineStart = depth;
    const open = (tag) => {
      openTags.push({ key: tagKey(tag), lineDepth, depthBefore: depth });
      if (depth <= depthAtLineStart) depth += 1;
    };
    for (const tag of tags) {
      tag.lineDepth = lineDepth;
      if (tag.directive) {
        if (tag.closing && (BLOCK_DIRECTIVES.has(tag.name) || CAPTURE_DIRECTIVES.has(tag.name))) {
          const opener = openerOf(tag);
          if (opener >= 0) {
            depth = openTags[opener].depthBefore;
            openTags.length = opener;
          } else {
            depth = Math.max(0, depth - 1);
          }
        } else if (!tag.closing && (tag.capture || (BLOCK_DIRECTIVES.has(tag.name) && !BRANCH_DIRECTIVES.has(tag.name)))) {
          open(tag);
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
        open(tag);
      }
    }

    const region = html.regions.find((candidate) => lineIndex >= candidate.first && lineIndex <= candidate.last);
    if (region && region.preformatted) return line;
    const content = region ? line.slice(Math.min(region.indentation, indentationOf(line))) : line.trimStart();
    return `${indentUnit.repeat(lineDepth)}${content}`;
  });

  const result = formatted.join(newline);
  return options.wrapLongLines ? wrapLongTags(result, options, indentUnit, newline) : result;
}

// Where a FreeMarker tag may go on in a new line without changing what it does: before a
// named argument (name=value), before && and || in a condition, and between the parameters
// of a macro or function. Only places outside of strings and brackets count, and none that
// would leave the name of the tag alone on its line.
function tagBreakOffsets(text, tag) {
  const header = /^<\/?[#@][A-Za-z_][A-Za-z0-9_.-]*/.exec(text.slice(tag.offset, tag.end));
  if (!header) return [];
  const parameters = tag.directive && (tag.name === 'macro' || tag.name === 'function');
  const offsets = [];
  let quote = null;
  let raw = false;
  let depth = 0;
  for (let index = tag.offset + header[0].length; index < tag.end; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\' && !raw) index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      raw = isRawStringStart(text, index);
    } else if ('([{'.includes(character)) {
      depth += 1;
    } else if (')]}'.includes(character)) {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && /\s/.test(character) && !/\s/.test(text[index - 1])) {
      let next = index;
      while (next < tag.end && /\s/.test(text[next])) next += 1;
      const rest = text.slice(next, tag.end);
      const previous = text.slice(tag.offset + header[0].length, index).trimEnd();
      if (!previous || /=$/.test(previous) || /^=/.test(rest)) continue;
      const argument = /^[A-Za-z_][A-Za-z0-9_.-]*\s*=(?!=)/.test(rest);
      const condition = /^(?:&&|\|\||and\b|or\b)/.test(rest);
      const parameter = parameters && /^[A-Za-z_]/.test(rest);
      if (argument || condition || parameter) offsets.push({ start: index, next });
    }
  }
  return offsets;
}

// Breaks the FreeMarker tags that start a line and are longer than the line may be. The
// parts go on in lines indented one level below the tag, the way the formatter indents
// the rest of a tag, so formatting the result again changes nothing. Comments, regions
// between @formatter:off and @formatter:on, and the content of <pre>, <textarea>,
// <script> and <style> are left as they are.
function wrapLongTags(text, options, indentUnit, newline) {
  const limit = Math.max(40, Math.floor(options.wrapLineLength) || 160);
  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => line.length > limit)) return text;

  const normalized = maskComments(normalizeTemplate(text, options).text);
  const structure = templateStructure(normalized);
  const lineOffsets = [0];
  for (let index = normalized.indexOf('\n'); index >= 0; index = normalized.indexOf('\n', index + 1)) {
    lineOffsets.push(index + 1);
  }
  const lineOf = (offset) => {
    let line = lineOffsets.length - 1;
    while (lineOffsets[line] > offset) line -= 1;
    return line;
  };

  const disabled = disabledLines(lines);

  const wrapped = new Map();
  for (const tag of freemarkerTags(normalized)) {
    const lineIndex = lineOf(tag.offset);
    if (wrapped.has(lineIndex) || disabled.has(lineIndex) || lineOf(tag.end) !== lineIndex) continue;
    const line = lines[lineIndex];
    const start = tag.offset - lineOffsets[lineIndex];
    if (line.length <= limit || line.slice(0, start).trim()) continue;
    if (structure.regions.some((region) => lineIndex >= region.first && lineIndex <= region.last)) continue;
    // A line that continues a string or a tag is not the start of one.
    if (structure.continuations.has(lineIndex)) continue;

    const indentation = line.slice(0, start);
    const breaks = tagBreakOffsets(normalized, tag);
    if (!breaks.length) continue;
    const pieces = [];
    let from = tag.offset;
    for (const point of breaks) {
      pieces.push(text.slice(from, point.start).trimEnd());
      from = point.next;
    }
    // The rest of the line, with the end of the tag, goes on the last piece.
    pieces.push(text.slice(from, lineOffsets[lineIndex] + line.length));

    const result = [indentation + pieces[0]];
    for (const piece of pieces.slice(1)) {
      const last = result[result.length - 1];
      if (last.length + 1 + piece.length <= limit) result[result.length - 1] = `${last} ${piece}`;
      else result.push(indentation + indentUnit + piece);
    }
    if (result.length > 1) wrapped.set(lineIndex, result);
  }
  if (!wrapped.size) return text;
  return lines.flatMap((line, lineIndex) => wrapped.get(lineIndex) || [line]).join(newline);
}

module.exports = { formatTemplate };