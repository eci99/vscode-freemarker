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

function splitParameters(text) {
  const tokens = [];
  let tokenStart = -1;
  let quote = null;
  let nesting = 0;

  for (let index = 0; index <= text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      if (tokenStart < 0) tokenStart = index;
    } else if (character === '(' || character === '[' || character === '{') {
      nesting += 1;
      if (tokenStart < 0) tokenStart = index;
    } else if (character === ')' || character === ']' || character === '}') {
      nesting = Math.max(0, nesting - 1);
    }

    if ((index === text.length || /\s/.test(character)) && nesting === 0 && !quote) {
      if (tokenStart >= 0) {
        tokens.push(text.slice(tokenStart, index).replace(/,$/, ''));
        tokenStart = -1;
      }
    } else if (tokenStart < 0 && !/\s/.test(character)) {
      tokenStart = index;
    }
  }

  const parameters = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/.exec(token);
    if (!assignment) continue;

    let defaultValue = assignment[2];
    if (defaultValue !== undefined) {
      const expressionParts = [defaultValue];
      while (index + 1 < tokens.length && !/^[A-Za-z_][A-Za-z0-9_]*(?:=.*)?$/.test(tokens[index + 1])) {
        expressionParts.push(tokens[index + 1]);
        index += 1;
      }
      defaultValue = expressionParts.join(' ').trim();
    }
    parameters.push({ name: assignment[1], defaultValue });
  }
  return parameters;
}

function parseTemplate(text) {
  const source = withoutComments(text);
  const symbols = [];
  const directives = [];
  const symbolPattern = /<#(macro|function)\s+([A-Za-z_][A-Za-z0-9_.-]*)\b/g;
  let match;

  while ((match = symbolPattern.exec(source)) !== null) {
    const nameOffset = match.index + match[0].lastIndexOf(match[2]);
    const tagEnd = findTagEnd(source, symbolPattern.lastIndex);
    const parameterSource = tagEnd < 0 ? '' : source.slice(symbolPattern.lastIndex, tagEnd);
    symbols.push({
      name: match[2],
      kind: match[1],
      offset: nameOffset,
      length: match[2].length,
      parameters: splitParameters(parameterSource),
      declaration: tagEnd < 0
        ? source.slice(match.index).trim()
        : source.slice(match.index, tagEnd + 1).trim()
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
      const tagEnd = findTagEnd(source, match.index);
      symbols.push({
        name: match[1],
        kind: 'variable',
        offset: nameOffset,
        length: match[1].length,
        declaration: tagEnd < 0 ? source.slice(match.index).trim() : source.slice(match.index, tagEnd + 1).trim()
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