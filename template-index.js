const {
  TAG_SCAN, commentRanges, maskComments, maskRawStrings, nextOffsets, normalizeTemplate, repeatedScan
} = require('./syntax');

// The lines of a paragraph joined with single spaces. A loop rather than a regex such as
// /[ \t]*\n[ \t]*/, which backtracks over a long run of spaces.
function joinLines(paragraph) {
  const blank = (character) => character === ' ' || character === '\t';
  return paragraph.split(/\r?\n/).map((line, index, lines) => {
    let start = 0;
    let end = line.length;
    if (index > 0) while (start < end && blank(line[start])) start += 1;
    if (index < lines.length - 1) while (end > start && blank(line[end - 1])) end -= 1;
    return line.slice(start, end);
  }).join(' ');
}

// The comments of a template, as { start, end, content, singleLine }.
function templateComments(text) {
  return commentRanges(text).map(({ start, end }) => {
    const content = text.slice(start + 4, end - 3);
    return { start, end, content, singleLine: !content.includes('\n') };
  });
}

// The number of comments for which `before(comment)` holds; they come first.
function countBefore(comments, before) {
  let low = 0;
  let high = comments.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (before(comments[middle])) low = middle + 1;
    else high = middle;
  }
  return low;
}

function commentParagraph(comment) {
  const firstParagraph = comment.content.trim().split(/\r?\n\s*\r?\n/)[0];
  return joinLines(firstParagraph).trim() || undefined;
}

function leadingCommentParagraph(text, comments, declarationOffset) {
  const precedingComment = comments[countBefore(comments, (comment) => comment.end <= declarationOffset) - 1];
  if (!precedingComment) return undefined;
  if (!/^[ \t]*\r?\n[ \t]*$/.test(text.slice(precedingComment.end, declarationOffset))) return undefined;
  return commentParagraph(precedingComment);
}

// A comment that starts on the line of the declaration, after nothing but spaces, and ends there.
function trailingCommentParagraph(text, comments, declarationEnd) {
  let start = declarationEnd;
  while (start < text.length && text[start] !== '\n' && !text.startsWith('\r\n', start) && /\s/.test(text[start])) {
    start += 1;
  }
  if (!text.startsWith('<#--', start)) return undefined;
  const comment = comments[countBefore(comments, (candidate) => candidate.start < start)];
  if (!comment || comment.start !== start || !comment.singleLine) return undefined;
  return commentParagraph(comment);
}

// Whether an offset is in one of the ranges { start, end }.
function inRanges(ranges) {
  const merged = [];
  for (const range of ranges.filter(({ start, end }) => start < end).sort((left, right) => left.start - right.start)) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return (offset) => {
    const range = merged[countBefore(merged, ({ start }) => start <= offset) - 1];
    return range !== undefined && offset < range.end;
  };
}

// The > that ends a tag; one inside of parentheses, as in (a > b), is an operator.
function findTagEnd(text, start) {
  let quote = null;
  let parentheses = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
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

// Answers, for the offsets of `source`, whether a token is inside a FreeMarker expression:
// in an interpolation or a tag, not in a string, and the expression not ended before the
// cursor. Each answer would scan back to the opening and on to its end, so callers that
// ask for every name of a template get the openings and ends worked out once.
function expressionTest(source) {
  const openings = ['${', '#{', '<#', '<@', '</@'];
  // The offset and the length of the last opening that starts at or before each offset.
  const openingAt = new Int32Array(source.length + 1).fill(-1);
  const openingLength = new Int8Array(source.length + 1);
  for (let index = 0; index <= source.length; index += 1) {
    const found = openings.find((opening) => source.startsWith(opening, index));
    openingAt[index] = found ? index : index > 0 ? openingAt[index - 1] : -1;
    openingLength[index] = found ? found.length : index > 0 ? openingLength[index - 1] : 0;
  }
  const nextBrace = new Int32Array(source.length + 1).fill(-1);
  for (let index = source.length - 1; index >= 0; index -= 1) {
    nextBrace[index] = source[index] === '}' ? index : nextBrace[index + 1];
  }
  const tagEnd = repeatedScan(source, findTagEnd, TAG_SCAN);
  // Where the last scan for strings stopped, so that the next name after the same opening
  // goes on from there.
  let scanned = { opening: -1, token: -1, index: -1, quote: null };

  return (tokenStart, cursorOffset) => {
    const at = Math.max(0, Math.min(cursorOffset, source.length));
    const openingOffset = openingAt[at];
    if (openingOffset < 0) return false;
    const length = openingLength[at];
    // A > in parentheses, as in <#if (a > 1)>, does not end the tag.
    const closingOffset = source[openingOffset + 1] === '{'
      ? nextBrace[openingOffset + length]
      : tagEnd(openingOffset + length);
    if (closingOffset >= 0 && cursorOffset > closingOffset) return false;

    let { index, quote } = scanned.opening === openingOffset && tokenStart >= scanned.token
      ? scanned : { index: openingOffset + length, quote: null };
    for (; index < tokenStart; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === '\\') index += 1;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      }
    }
    scanned = { opening: openingOffset, token: tokenStart, index, quote };
    return quote === null;
  };
}

// The further name = value pairs of an <#assign> tag, from `start` to the end of the tag.
function laterAssignments(source, start, end) {
  const found = [];
  let quote = null;
  let depth = 0;
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if ('([{'.includes(character)) {
      depth += 1;
    } else if (')]}'.includes(character)) {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && /\s/.test(source[index - 1] || '') && /[A-Za-z_]/.test(character)) {
      const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*[-+*\/%]?=(?!=)/.exec(source.slice(index, end));
      if (assignment) {
        found.push({ name: assignment[1], nameOffset: index, equalsOffset: index + assignment[0].length - 1 });
        index += assignment[0].length - 1;
      } else {
        index += /^[A-Za-z0-9_]*/.exec(source.slice(index, end))[0].length - 1;
      }
    }
  }
  return found;
}

function matchingBrace(text, start) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
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
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
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
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
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
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
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

// The matches of /<#list\b[^>]*?\bas\s+(name)\b/g (or <#items), worked out without scanning
// on to the next > from each <#list again, which unclosed ones would make quadratic.
function loopVariables(source, keyword, nextTagEnd) {
  const names = [...source.matchAll(/\bas\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)];
  const opening = new RegExp(`<#${keyword}\\b`, 'g');
  const found = [];
  let match;
  while ((match = opening.exec(source)) !== null) {
    const name = names[countBefore(names, (candidate) => candidate.index < opening.lastIndex)];
    const tagEnd = nextTagEnd[opening.lastIndex];
    if (!name || (tagEnd >= 0 && tagEnd < name.index)) continue;
    const end = name.index + name[0].length;
    found.push(Object.assign([source.slice(match.index, end), name[1]], { index: match.index }));
    opening.lastIndex = end;
  }
  return found;
}

function parseTemplate(text, options) {
  const normalized = normalizeTemplate(text, options);
  const source = maskRawStrings(maskComments(normalized.text));
  // The template as it was written, for everything that is shown to the user.
  const display = maskComments(normalized.text, text);
  text = normalized.text;
  const comments = templateComments(text);
  const symbols = [];
  const directives = [];
  const symbolPattern = /<#(macro|function)\s+([A-Za-z_][A-Za-z0-9_.-]*)\b/g;
  const tagEnds = repeatedScan(source, findTagEnd, TAG_SCAN);
  let match;

  while ((match = symbolPattern.exec(source)) !== null) {
    const nameOffset = match.index + match[0].lastIndexOf(match[2]);
    const tagEnd = tagEnds(symbolPattern.lastIndex);
    const parameterSource = tagEnd < 0 ? '' : display.slice(symbolPattern.lastIndex, tagEnd);
    symbols.push({
      name: match[2],
      kind: match[1],
      offset: nameOffset,
      length: match[2].length,
      parameters: splitParameters(parameterSource),
      documentation: leadingCommentParagraph(text, comments, match.index),
      declaration: tagEnd < 0
        ? display.slice(match.index).trim()
        : display.slice(match.index, tagEnd + 1).trim()
    });
  }

  const nextTagEnd = nextOffsets(source, (index) => source[index] === '>');
  const nextEquals = nextOffsets(source, (index) => source[index] === '=');
  const captureEnds = [...source.matchAll(/<\/#assign\s*>/g)];
  // The names of the variables declared so far; `seen` symbols have been looked at.
  const variableNames = new Set();
  let seen = 0;
  const declared = (name) => {
    for (; seen < symbols.length; seen += 1) {
      if (symbols[seen].kind === 'variable') variableNames.add(symbols[seen].name);
    }
    return variableNames.has(name);
  };
  const variableMatches = [
    [...source.matchAll(/<#(?:assign|local|global)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:[-+*\/%]?=|\+\+|--|>)/g)],
    loopVariables(source, 'list', nextTagEnd),
    loopVariables(source, 'items', nextTagEnd)
  ];
  for (const matches of variableMatches) {
    for (match of matches) {
      const nameOffset = match.index + match[0].lastIndexOf(match[1]);
      const tagEnd = tagEnds(match.index);
      const tagText = tagEnd < 0 ? source.slice(match.index) : source.slice(match.index, tagEnd + 1);
      const captureAssign = tagText.startsWith('<#assign') && !tagText.includes('=');
      let declarationEnd = tagEnd;
      let captureValue;
      if (captureAssign) {
        const closingMatch = captureEnds[countBefore(captureEnds, (candidate) => candidate.index < tagEnd + 1)];
        if (closingMatch) {
          declarationEnd = closingMatch.index + closingMatch[0].length - 1;
          captureValue = display.slice(tagEnd + 1, closingMatch.index).trim();
        }
      }
      const declaration = declarationEnd < 0
        ? display.slice(match.index).trim()
        : display.slice(match.index, declarationEnd + 1).trim();
      // <#assign a = 1 b = 2> declares both.
      const entries = [{ name: match[1], nameOffset, equalsOffset: nextEquals[nameOffset + match[1].length] }];
      if (matches === variableMatches[0] && !captureAssign && tagEnd >= 0 && entries[0].equalsOffset >= 0 && entries[0].equalsOffset < tagEnd) {
        entries.push(...laterAssignments(source, entries[0].equalsOffset + 1, tagEnd));
      }
      // config += {...} changes a variable that is declared elsewhere; it only declares one that is not.
      const changesOnly = /^\s*(?:[-+*\/%]=|\+\+|--)/.test(source.slice(nameOffset + match[1].length));
      entries.forEach((entry, index) => {
        if (index === 0 && changesOnly && declared(entry.name)) return;
        const hasAssignmentValue = entry.equalsOffset >= 0 && entry.equalsOffset < tagEnd;
        const valueEnd = index + 1 < entries.length ? entries[index + 1].nameOffset : tagEnd;
        let value;
        if (captureAssign) value = captureValue;
        else if (hasAssignmentValue) value = display.slice(entry.equalsOffset + 1, valueEnd).replace(/\/\s*$/, '').trim();
        symbols.push({
          name: entry.name,
          kind: 'variable',
          offset: entry.nameOffset,
          length: entry.name.length,
          value,
          documentation: leadingCommentParagraph(text, comments, match.index)
            || trailingCommentParagraph(text, comments, declarationEnd + 1),
          declaration
        });
        if (hasAssignmentValue) {
          let hashStart = entry.equalsOffset + 1;
          while (/\s/.test(source[hashStart] || '')) hashStart += 1;
          if (source[hashStart] === '{') {
            parseHashMembers(display, hashStart, entry.name, display.slice(match.index, tagEnd + 1).trim(), symbols);
          }
        }
      });
    }
  }

  const directivePattern = /<#(import|include)\b/g;
  while ((match = directivePattern.exec(source)) !== null) {
    const end = tagEnds(directivePattern.lastIndex);
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
      const tagEnd = tagEnds(match.index);
      scopeStack.push({ kind: match[2], bodyStart: tagEnd < 0 ? source.length : tagEnd + 1 });
    }
  }
  for (const scope of scopeStack) scopeRanges.push({ start: scope.bodyStart, end: source.length });
  const inScope = inRanges(scopeRanges);
  for (const symbol of symbols) symbol.topLevel = !inScope(symbol.offset);
  for (const directive of directives) directive.topLevel = !inScope(directive.offset);

  return {
    source,
    display,
    tagSyntax: normalized.tagSyntax,
    interpolationSyntax: normalized.interpolationSyntax,
    symbols,
    directives
  };
}

module.exports = { expressionTest, findTagEnd, literalType, parseTemplate, splitParameters, symbolType };