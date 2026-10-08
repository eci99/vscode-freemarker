function withoutComments(text) {
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

function parseTemplate(text) {
  const source = withoutComments(text);
  const symbols = [];
  const directives = [];
  const symbolPattern = /<#(macro|function)\s+([A-Za-z_][A-Za-z0-9_.-]*)\b/g;
  let match;

  while ((match = symbolPattern.exec(source)) !== null) {
    const nameOffset = match.index + match[0].lastIndexOf(match[2]);
    symbols.push({
      name: match[2],
      kind: match[1],
      offset: nameOffset,
      length: match[2].length
    });
  }

  const variablePatterns = [
    /<#(?:assign|local|global)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g,
    /<#list\b[^>]*?\bas\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
    /<#items\b[^>]*?\bas\s+([A-Za-z_][A-Za-z0-9_]*)\b/g
  ];
  for (const pattern of variablePatterns) {
    while ((match = pattern.exec(source)) !== null) {
      const nameOffset = match.index + match[0].lastIndexOf(match[1]);
      symbols.push({
        name: match[1],
        kind: 'variable',
        offset: nameOffset,
        length: match[1].length
      });
    }
  }

  const directivePattern = /<#(import|include)\b/g;
  while ((match = directivePattern.exec(source)) !== null) {
    const end = findTagEnd(source, directivePattern.lastIndex);
    if (end < 0) continue;
    const tagBody = source.slice(directivePattern.lastIndex, end);
    const pathMatch = /(['"])(.*?)\1/.exec(tagBody);
    if (!pathMatch) {
      directivePattern.lastIndex = end + 1;
      continue;
    }

    const pathOffset = directivePattern.lastIndex + pathMatch.index + 1;
    const aliasSuffix = tagBody.slice(pathMatch.index + pathMatch[0].length);
    const aliasMatch = match[1] === 'import'
      ? /\bas\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(aliasSuffix)
      : null;

    directives.push({
      kind: match[1],
      path: pathMatch[2],
      alias: aliasMatch ? aliasMatch[1] : null,
      aliasOffset: aliasMatch
        ? directivePattern.lastIndex + pathMatch.index + pathMatch[0].length + aliasMatch.index + aliasMatch[0].lastIndexOf(aliasMatch[1])
        : null,
      offset: match.index,
      pathOffset,
      pathLength: pathMatch[2].length
    });
    directivePattern.lastIndex = end + 1;
  }

  return { source, symbols, directives };
}

module.exports = { parseTemplate };