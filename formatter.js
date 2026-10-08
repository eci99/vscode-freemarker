const BLOCK_DIRECTIVES = new Set([
  'if', 'list', 'foreach', 'switch', 'macro', 'function', 'attempt', 'compress',
  'noparse', 'outputformat', 'autoesc', 'noautoesc', 'escape', 'transform',
  'items', 'sep', 'recover', 'visit', 'recurse'
]);
const BRANCH_DIRECTIVES = new Set(['else', 'elseif', 'case', 'default', 'recover']);

function maskComments(text) {
  return text.replace(/<#--[\s\S]*?-->/g, (comment) =>
    comment.replace(/[^\r\n]/g, ' ')
  );
}

function findTagEnd(text, start) {
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== '\\') quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

function tagsInLine(line) {
  const tags = [];
  const opening = /<(\/?)#([A-Za-z_][A-Za-z0-9_-]*)|<(\/?)@([A-Za-z_][A-Za-z0-9_.-]*)/g;
  let match;

  while ((match = opening.exec(line)) !== null) {
    const end = findTagEnd(line, opening.lastIndex);
    if (end < 0) continue;
    const directive = match[2] !== undefined;
    const closing = directive ? match[1] === '/' : match[3] === '/';
    const name = directive ? match[2] : match[4];
    const selfClosing = !directive && !closing && /\/\s*$/.test(line.slice(opening.lastIndex, end));
    tags.push({
      start: match.index,
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
      if (character === quote && line[index - 1] !== '\\') quote = null;
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

function formatTemplate(text, options = {}) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const sourceLines = text.split(/\r?\n/);
  const maskedLines = maskComments(text).split(/\r?\n/);
  const indentUnit = options.insertSpaces === false
    ? '\t'
    : ' '.repeat(Math.max(1, options.tabSize || 4));
  let depth = 0;
  let formattingDisabled = false;

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
    const tags = tagsInLine(masked);
    const firstTag = tags.find((tag) => masked.slice(0, tag.start).trim() === '');
    let lineDepth = depth;

    if (firstTag && (firstTag.closing || (firstTag.directive && BRANCH_DIRECTIVES.has(firstTag.name)))) {
      lineDepth = Math.max(0, lineDepth - 1);
    }

    for (const tag of tags) {
      if (tag.directive) {
        if (tag.closing && BLOCK_DIRECTIVES.has(tag.name)) {
          depth = Math.max(0, depth - 1);
        } else if (!tag.closing && BLOCK_DIRECTIVES.has(tag.name) && !BRANCH_DIRECTIVES.has(tag.name)) {
          depth += 1;
        }
      } else if (tag.closing) {
        depth = Math.max(0, depth - 1);
      } else if (!tag.selfClosing) {
        depth += 1;
      }
    }

    const content = line.trimStart();
    return `${indentUnit.repeat(lineDepth)}${content}`;
  });

  return formatted.join(newline);
}

module.exports = { formatTemplate };