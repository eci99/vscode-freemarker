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

module.exports = { analyzeExtraction, checkSelection };
