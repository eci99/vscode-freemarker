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

module.exports = { toggleLineComments };
