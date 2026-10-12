const { normalizeTemplate } = require('./syntax');

// Blanks the comments of `text`. `original` is the same template before it was rewritten
// to the default syntax, and gets the same ranges blanked.
function withoutComments(text, original = text) {
  let result = '';
  let end = 0;
  const commentPattern = /<#--[\s\S]*?-->/g;
  let match;
  while ((match = commentPattern.exec(text)) !== null) {
    result += original.slice(end, match.index) + match[0].replace(/[^\r\n]/g, ' ');
    end = match.index + match[0].length;
  }
  return result + original.slice(end);
}

function leadingCommentParagraph(text, declarationOffset) {
  const commentPattern = /<#--([\s\S]*?)-->/g;
  let precedingComment;
  let match;
  while ((match = commentPattern.exec(text)) !== null) {
    if (match.index + match[0].length > declarationOffset) break;
    precedingComment = match;
  }
  if (!precedingComment) return undefined;

  const commentEnd = precedingComment.index + precedingComment[0].length;
  if (!/^[ \t]*\r?\n[ \t]*$/.test(text.slice(commentEnd, declarationOffset))) return undefined;

  const content = precedingComment[1].trim();
  const firstParagraph = content.split(/\r?\n\s*\r?\n/)[0];
  return firstParagraph.replace(/[ \t]*\r?\n[ \t]*/g, ' ').trim() || undefined;
}

function trailingCommentParagraph(text, declarationEnd) {
  const lineEndMatch = /\r?\n/.exec(text.slice(declarationEnd));
  const lineEnd = lineEndMatch ? declarationEnd + lineEndMatch.index : text.length;
  const lineTail = text.slice(declarationEnd, lineEnd);
  const commentMatch = /^\s*<#--([\s\S]*?)-->/.exec(lineTail);
  if (!commentMatch) return undefined;

  const content = commentMatch[1].trim();
  const firstParagraph = content.split(/\r?\n\s*\r?\n/)[0];
  return firstParagraph.replace(/[ \t]*\r?\n[ \t]*/g, ' ').trim() || undefined;
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

function matchingBrace(text, start) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) return index;
  }
  return -1;
}

function topLevelSeparator(text, start, end, separator) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < end; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '{' || character === '[' || character === '(') depth += 1;
    else if (character === '}' || character === ']' || character === ')') depth -= 1;
    else if (character === separator && depth === 0) return index;
  }
  return -1;
}

function parseHashMembers(source, objectStart, parentName, declaration, symbols) {
  const objectEnd = matchingBrace(source, objectStart);
  if (objectEnd < 0) return;

  let entryStart = objectStart + 1;
  while (entryStart < objectEnd) {
    const entryEnd = topLevelSeparator(source, entryStart, objectEnd, ',');
    const end = entryEnd < 0 ? objectEnd : entryEnd;
    const colon = topLevelSeparator(source, entryStart, end, ':');
    if (colon >= 0) {
      const keyText = source.slice(entryStart, colon);
      const keyMatch = /^\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1\s*$/.exec(keyText);
      if (keyMatch) {
        const keyOffset = entryStart + keyText.indexOf(keyMatch[2]);
        const name = `${parentName}.${keyMatch[2]}`;
        symbols.push({
          name,
          kind: 'variable',
          offset: keyOffset,
          length: keyMatch[2].length,
          declaration,
          value: source.slice(colon + 1, end).trim()
        });

        let valueStart = colon + 1;
        while (/\s/.test(source[valueStart] || '')) valueStart += 1;
        if (source[valueStart] === '{') {
          parseHashMembers(source, valueStart, name, declaration, symbols);
        }
      }
    }
    entryStart = end + 1;
  }
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

function matchingClose(text, start) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '{' || character === '[' || character === '(') depth += 1;
    else if ((character === '}' || character === ']' || character === ')') && --depth === 0) return index;
  }
  return -1;
}

// The type of a literal expression, named like the built-in categories.
function literalType(expression) {
  const text = expression.trim();
  if (/^r?(["'])(?:\\.|(?!\1)[^\\])*\1$/.test(text)) return 'string';
  if (/^[-+]?(?:0[xX][0-9A-Fa-f]+|\d+(?:\.\d+)?)$/.test(text)) return 'number';
  if (/^(?:true|false)$/.test(text)) return 'boolean';
  if ((text[0] === '[' || text[0] === '{') && matchingClose(text, 0) === text.length - 1) {
    return text[0] === '[' ? 'sequence' : 'hash';
  }
  return undefined;
}

// The type of a declared variable, as far as its declaration shows it.
function symbolType(symbol) {
  const declaration = symbol.declaration || '';
  if (/^[<[]#(?:list|items)\b/.test(declaration)) return 'loop variable';
  if (typeof symbol.value !== 'string') return undefined;
  if (/^[<[]#assign\s+[A-Za-z_][A-Za-z0-9_]*\s*[>\]]/.test(declaration) && !symbol.name.includes('.')) return 'string';
  return literalType(symbol.value);
}

function parseTemplate(text, options) {
  const normalized = normalizeTemplate(text, options);
  const source = withoutComments(normalized.text);
  // The template as it was written, for everything that is shown to the user.
  const display = withoutComments(normalized.text, text);
  text = normalized.text;
  const symbols = [];
  const directives = [];
  const symbolPattern = /<#(macro|function)\s+([A-Za-z_][A-Za-z0-9_.-]*)\b/g;
  let match;

  while ((match = symbolPattern.exec(source)) !== null) {
    const nameOffset = match.index + match[0].lastIndexOf(match[2]);
    const tagEnd = findTagEnd(source, symbolPattern.lastIndex);
    const parameterSource = tagEnd < 0 ? '' : display.slice(symbolPattern.lastIndex, tagEnd);
    symbols.push({
      name: match[2],
      kind: match[1],
      offset: nameOffset,
      length: match[2].length,
      parameters: splitParameters(parameterSource),
      documentation: leadingCommentParagraph(text, match.index),
      declaration: tagEnd < 0
        ? display.slice(match.index).trim()
        : display.slice(match.index, tagEnd + 1).trim()
    });
  }

  const variablePatterns = [
    /<#(?:assign|local|global)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|>)/g,
    /<#list\b[^>]*?\bas\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
    /<#items\b[^>]*?\bas\s+([A-Za-z_][A-Za-z0-9_]*)\b/g
  ];
  for (const pattern of variablePatterns) {
    while ((match = pattern.exec(source)) !== null) {
      const nameOffset = match.index + match[0].lastIndexOf(match[1]);
      const tagEnd = findTagEnd(source, match.index);
      const tagText = tagEnd < 0 ? source.slice(match.index) : source.slice(match.index, tagEnd + 1);
      const captureAssign = tagText.startsWith('<#assign') && !tagText.includes('=');
      let declarationEnd = tagEnd;
      let value;
      if (captureAssign) {
        const closingTag = /<\/\#assign\s*>/g;
        closingTag.lastIndex = tagEnd + 1;
        const closingMatch = closingTag.exec(source);
        if (closingMatch) {
          declarationEnd = closingMatch.index + closingMatch[0].length - 1;
          value = display.slice(tagEnd + 1, closingMatch.index).trim();
        }
      }
      const equalsOffset = source.indexOf('=', nameOffset + match[1].length);
      const hasAssignmentValue = equalsOffset >= 0 && equalsOffset < tagEnd;
      if (!captureAssign && hasAssignmentValue) {
        value = display.slice(equalsOffset + 1, tagEnd).replace(/\/\s*$/, '').trim();
      }
      symbols.push({
        name: match[1],
        kind: 'variable',
        offset: nameOffset,
        length: match[1].length,
        value,
        documentation: leadingCommentParagraph(text, match.index)
          || trailingCommentParagraph(text, declarationEnd + 1),
        declaration: declarationEnd < 0
          ? display.slice(match.index).trim()
          : display.slice(match.index, declarationEnd + 1).trim()
      });
      if (hasAssignmentValue) {
        const declaration = display.slice(match.index, tagEnd + 1).trim();
        let hashStart = equalsOffset + 1;
        while (/\s/.test(source[hashStart] || '')) hashStart += 1;
        if (source[hashStart] === '{') {
          parseHashMembers(display, hashStart, match[1], declaration, symbols);
        }
      }
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
      endOffset: end + 1,
      pathOffset,
      pathLength: pathMatch[2].length
    });
    directivePattern.lastIndex = end + 1;
  }

  const scopeStack = [];
  const scopeRanges = [];
  const scopePattern = /<(\/?)#(macro|function)\b/g;
  while ((match = scopePattern.exec(source)) !== null) {
    if (match[1]) {
      let scopeIndex = scopeStack.length - 1;
      while (scopeIndex >= 0 && scopeStack[scopeIndex].kind !== match[2]) scopeIndex -= 1;
      if (scopeIndex >= 0) {
        const [scope] = scopeStack.splice(scopeIndex, 1);
        scopeRanges.push({ start: scope.bodyStart, end: match.index });
      }
    } else {
      const tagEnd = findTagEnd(source, match.index);
      scopeStack.push({ kind: match[2], bodyStart: tagEnd < 0 ? source.length : tagEnd + 1 });
    }
  }
  for (const scope of scopeStack) scopeRanges.push({ start: scope.bodyStart, end: source.length });
  for (const symbol of symbols) {
    symbol.topLevel = !scopeRanges.some(({ start, end }) => symbol.offset >= start && symbol.offset < end);
  }
  for (const directive of directives) {
    directive.topLevel = !scopeRanges.some(({ start, end }) => directive.offset >= start && directive.offset < end);
  }

  return {
    source,
    display,
    tagSyntax: normalized.tagSyntax,
    interpolationSyntax: normalized.interpolationSyntax,
    symbols,
    directives
  };
}

module.exports = { findTagEnd, literalType, parseTemplate, splitParameters, symbolType };