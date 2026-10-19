const { EXPRESSION_DIRECTIVES, expressionRegions, identifiers } = require('./semantic-tokens');
const { htmlTags, templateBlocks } = require('./validator');

// Checks that source[start, end) of a template in the default syntax can be moved as a
// whole: it cuts through no tag, interpolation, or HTML element and has complete directives.
// Returns { error } or { regions }.
function checkSelection(source, start, end) {
  const selected = source.slice(start, end);
  if (!selected.trim()) return { error: 'Select the part to move.' };

  const regions = expressionRegions(source);
  for (const region of regions) {
    const regionStart = region.tagStart ?? region.start - 2;
    for (const boundary of [start, end]) {
      if (boundary > regionStart && boundary <= region.end) {
        return { error: 'The selection starts or ends inside a tag or an interpolation.' };
      }
    }
  }
  if (/[A-Za-z/]/.test(source[start]) && source[start - 1] === '<') {
    return { error: 'The selection starts inside an HTML tag.' };
  }
  for (const pair of htmlTags(source).pairs) {
    const closeEnd = pair.close + pair.closeLength;
    const opens = pair.open >= start && pair.open < end;
    const closes = closeEnd > start && closeEnd <= end;
    if (opens !== closes) return { error: 'The selection cuts through an HTML element.' };
  }

  const blocks = templateBlocks(selected, { tagSyntax: 'angleBracket' });
  if (blocks.diagnostics.length > 0 || blocks.unclosed.some((block) => !block.optional)) {
    return { error: 'The selection must contain complete directives.' };
  }
  return { regions };
}

// Checks whether the selection can become a macro, and which of the names that are only
// visible there (`visibleLocals`) it needs as parameters. Returns { error } or { parameters }.
function analyzeExtraction(source, start, end, visibleLocals) {
  const checked = checkSelection(source, start, end);
  if (checked.error) return checked;
  const selected = source.slice(start, end);
  if (/<#(?:return|nested)\b/.test(selected)) {
    return { error: 'A selection with <#return> or <#nested> cannot be extracted.' };
  }
  if (/<#(?:break|continue)\b/.test(selected) && !/<#(?:list|foreach|switch)\b/.test(selected)) {
    return { error: 'A selection with <#break> or <#continue> needs its loop or switch.' };
  }

  const declaredInside = new Set();
  const used = [];
  for (const region of checked.regions) {
    if (region.start < start || region.end > end) continue;
    const found = identifiers(source, region.start, region.end);
    if (region.kind === '#' && ['assign', 'local', 'global'].includes(region.name)) {
      found.filter((name, index) => !name.member && (index === 0 || name.assigned))
        .forEach(({ name }) => declaredInside.add(name));
    } else if (region.kind === '#' && (region.name === 'list' || region.name === 'items')) {
      const loop = /\bas\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*([A-Za-z_][A-Za-z0-9_]*))?\s*$/
        .exec(source.slice(region.start, region.end));
      if (loop) loop.slice(1).filter(Boolean).forEach((name) => declaredInside.add(name));
    }
    if (!(region.kind === undefined || region.kind === '@' || EXPRESSION_DIRECTIVES.has(region.name))) continue;
    for (const { name, member, assigned } of found) {
      if (!member && !assigned && !used.includes(name)) used.push(name);
    }
  }

  return { parameters: used.filter((name) => visibleLocals.has(name) && !declaredInside.has(name)) };
}

// Checks that source[start, end) of a template in the default syntax is a whole expression
// that can be moved into a variable or a function. Returns { error } or { start, end, region }:
// the selection without the whitespace around it, and the tag or interpolation it is in.
function checkExpression(source, start, end) {
  while (start < end && /\s/.test(source[start])) start += 1;
  while (end > start && /\s/.test(source[end - 1])) end -= 1;
  if (start === end) return { error: 'Select an expression.' };

  const regions = expressionRegions(source);
  const region = regions
    .filter((candidate) => !candidate.closing && candidate.start <= start && end <= candidate.end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
  if (!region || !(region.kind === undefined || region.kind === '@' || EXPRESSION_DIRECTIVES.has(region.name))) {
    return { error: 'Select an expression in an interpolation, a macro call, or a directive.' };
  }
  const outer = regions
    .filter((candidate) => !candidate.closing && (candidate.tagStart ?? candidate.start - 2) <= start && end <= candidate.end)
    .sort((left, right) => (left.tagStart ?? left.start - 2) - (right.tagStart ?? right.start - 2))[0];

  // Brackets and strings must be complete, and operators at the top level are remembered.
  let quote = null;
  let depth = 0;
  let operators = false;
  let separators = false;
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    const word = !/[A-Za-z0-9_]/.test(source[index - 1] || '') && /^[A-Za-z]+/.exec(source.slice(index, end));
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if ('([{'.includes(character)) {
      depth += 1;
    } else if (')]}'.includes(character)) {
      depth -= 1;
      if (depth < 0) break;
    } else if (depth > 0) {
      continue;
    } else if (character === ',' || character === ';' || (word && ['as', 'in', 'using'].includes(word[0]))) {
      separators = true;
    } else if (/[-+*/%<>=!&|:\uE000]/.test(character) || (character === '.' && source[index + 1] === '.')
      || (word && ['gt', 'gte', 'lt', 'lte'].includes(word[0]))) {
      operators = true;
    }
  }
  if (quote || depth !== 0) return { error: 'The selection cuts through a string or brackets.' };
  if (separators) return { error: 'Select a single expression.' };

  const before = source.slice(region.start, start).trimEnd();
  const after = source.slice(end, region.end).trimStart();
  if (/[A-Za-z0-9_]/.test(source[start - 1] || '') && /[A-Za-z0-9_]/.test(source[start])
    || /[A-Za-z0-9_]/.test(source[end - 1]) && /[A-Za-z0-9_]/.test(source[end] || '')) {
    return { error: 'The selection cuts through a name.' };
  }
  if (/^[.?]/.test(source.slice(start, end)) || /[.?]$/.test(before)) {
    return { error: 'Select a whole expression, not a member or a built-in.' };
  }
  const names = identifiers(source, start, end);
  const assignedHere = names.some((name) => name.assigned)
    || (['assign', 'local', 'global'].includes(region.name) && !/=/.test(before))
    || (region.kind === '@' && /^=(?!=)/.test(after));
  if (assignedHere || !/[A-Za-z0-9_"']/.test(source.slice(start, end)) || /\bas\s*$/.test(before)) {
    return { error: 'Select a value, not a name that is assigned or declared.' };
  }
  // An operator could bind differently once the selection is a single name, as in a * |b + c|.
  if (operators && !(/(?:^|[([{,:=])$/.test(before) && /^(?:$|[)\]},:])/.test(after))) {
    return { error: 'Select a whole operand, or put parentheses around the expression.' };
  }
  return { start, end, region, outer };
}

module.exports = { analyzeExtraction, checkExpression, checkSelection };
