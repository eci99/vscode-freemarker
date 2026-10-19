const COMMENT_TOKENS = {
  angle: ['<#--', '-->'],
  square: ['[#--', '--]']
};

// Puts every line into a FreeMarker comment of its own, or takes the comments away again
// if all of the lines already are one. Blank lines stay as they are, unless there is
// nothing else.
function toggleLineComments(lines, tagSyntax = 'angle') {
  const [open, close] = COMMENT_TOKENS[tagSyntax] || COMMENT_TOKENS.angle;
  const hasContent = lines.some((line) => line.trim());
  const isTarget = (line) => !hasContent || Boolean(line.trim());
  const isCommented = (line) => {
    const content = line.trim();
    return content.length >= open.length + close.length && content.startsWith(open) && content.endsWith(close);
  };

  if (hasContent && lines.filter(isTarget).every(isCommented)) {
    return lines.map((line) => {
      if (!isTarget(line)) return line;
      const indentation = line.slice(0, line.length - line.trimStart().length);
      const content = line.trim().slice(open.length, -close.length);
      return `${indentation}${content.replace(/^ /, '').replace(/ $/, '')}`;
    });
  }

  // The comment starts at the beginning of the line, and the indentation of the line stays inside it.
  return lines.map((line) => (isTarget(line) ? `${open} ${line.trimEnd()} ${close}` : line));
}

// Takes away the comment that text[start, end) is in or consists of, or puts the selection
// into a comment. Returns the replaced part { start, end, text } and the selection after
// the edit { selectionStart, selectionEnd }, both as offsets in the original text plus the
// length of the replacement.
function toggleBlockComment(text, start, end, tagSyntax = 'angle') {
  const [open, close] = COMMENT_TOKENS[tagSyntax] || COMMENT_TOKENS.angle;
  let contentStart = start;
  let contentEnd = end;
  while (contentStart < contentEnd && /\s/.test(text[contentStart])) contentStart += 1;
  while (contentEnd > contentStart && /\s/.test(text[contentEnd - 1])) contentEnd -= 1;

  const commentStart = text.lastIndexOf(open, contentStart);
  const commentClose = commentStart < 0 ? -1 : text.indexOf(close, commentStart + open.length);
  if (commentClose >= 0 && commentClose + close.length >= contentEnd) {
    let innerStart = commentStart + open.length;
    let innerEnd = commentClose;
    if (text[innerStart] === ' ' && innerEnd > innerStart) innerStart += 1;
    if (text[innerEnd - 1] === ' ' && innerEnd > innerStart) innerEnd -= 1;
    const inner = text.slice(innerStart, innerEnd);
    return {
      start: commentStart,
      end: commentClose + close.length,
      text: inner,
      selectionStart: commentStart,
      selectionEnd: commentStart + inner.length
    };
  }

  const selected = text.slice(start, end);
  return {
    start,
    end,
    text: selected ? `${open} ${selected} ${close}` : `${open}  ${close}`,
    selectionStart: start + open.length + 1,
    selectionEnd: start + open.length + 1 + selected.length
  };
}

module.exports = { toggleBlockComment, toggleLineComments };
