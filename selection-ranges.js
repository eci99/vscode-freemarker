const { expressionRegions } = require('./semantic-tokens');
const { commentRanges, maskComments, maskRawStrings, normalizeTemplate } = require('./syntax');
const { findHtmlTagEnd, htmlTags, templateBlocks } = require('./validator');

const OPENING = { '(': ')', '[': ']', '{': '}' };

// The range without the whitespace at its start and end.
function trimmed(text, start, end) {
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return [start, end];
}

// The strings, brackets, and parameters (name=value) of an expression.
function expressionRanges(source, start, end, ranges) {
  const stack = [];
  // The offset where the value of a parameter starts, and where its name starts.
  let parameter;
  const endParameter = (index) => {
    if (parameter && stack.length === 0 && index > parameter.value) ranges.push([parameter.name, index]);
    parameter = undefined;
  };
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (character === '"' || character === "'") {
      let close = index + 1;
      while (close < end && source[close] !== character) close += source[close] === '\\' ? 2 : 1;
      if (close >= end) break;
      ranges.push([index + 1, close], [index, close + 1]);
      index = close;
    } else if (/[A-Za-z_]/.test(character) && !/[A-Za-z0-9_.?!]/.test(source[index - 1] || '')) {
      // A name with its members, as in user.name, and then with its built-ins, as in user.name?upper_case
      const name = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(source.slice(index, end))[0];
      const builtins = /^(?:\?[A-Za-z_][A-Za-z0-9_]*)*/.exec(source.slice(index + name.length, end))[0];
      ranges.push([index, index + name.length], [index, index + name.length + builtins.length]);
      index += name.length + builtins.length - 1;
    } else if (OPENING[character]) {
      stack.push({ close: OPENING[character], offset: index });
    } else if (stack.length > 0 && character === stack[stack.length - 1].close) {
      const open = stack.pop().offset;
      ranges.push(trimmed(source, open + 1, index), [open + 1, index], [open, index + 1]);
    } else if (stack.length === 0 && (/\s/.test(character) || character === ',')) {
      if (parameter && index > parameter.value) endParameter(index);
    } else if (stack.length === 0 && character === '=' && !/[=!<>]/.test(source[index - 1]) && source[index + 1] !== '=') {
      const name = /([A-Za-z_][A-Za-z0-9_.-]*)\s*$/.exec(source.slice(start, index));
      if (name) {
        let value = index + 1;
        while (value < end && /\s/.test(source[value])) value += 1;
        parameter = { name: start + name.index, value };
        index = value - 1;
      }
    }
  }
  endParameter(end);
}

// The ranges that Expand Selection steps through in a template, as [start, end] pairs in
// no particular order: names, strings, brackets, parameters, tags, the content of elements,
// blocks, and their branches, and comments. Offsets are those of the original text.
function selectionRanges(text, options) {
  const normalized = normalizeTemplate(text, options);
  const source = maskRawStrings(maskComments(normalized.text));
  const ranges = [];

  for (const comment of commentRanges(normalized.text)) {
    ranges.push(trimmed(normalized.text, comment.start + 4, comment.end - 3), [comment.start, comment.end]);
  }

  for (const region of expressionRegions(source)) {
    if (region.tagStart === undefined) {
      // An interpolation, also one in a string.
      ranges.push(trimmed(source, region.start, region.end), [region.start - 2, region.end + 1]);
    } else {
      const parametersEnd = source.slice(region.start, region.end).replace(/\/\s*$/, '').length + region.start;
      ranges.push(trimmed(source, region.start, parametersEnd), [region.tagStart, region.end + 1]);
      ranges.push([region.tagStart + (region.closing ? 3 : 2), region.tagStart + (region.closing ? 3 : 2) + region.name.length]);
    }
    expressionRanges(source, region.start, region.end, ranges);
  }

  for (const block of templateBlocks(text, options).blocks) {
    const tags = [block.open, ...block.branches, block.close];
    for (let index = 0; index + 1 < tags.length; index += 1) {
      const contentStart = tags[index].offset + tags[index].length;
      const contentEnd = tags[index + 1].offset;
      ranges.push(trimmed(source, contentStart, contentEnd), [contentStart, contentEnd]);
      // A branch with its tag, as in <#else>...
      if (index > 0) ranges.push([tags[index].offset, contentEnd]);
    }
    const contentStart = block.open.offset + block.open.length;
    ranges.push(trimmed(source, contentStart, block.close.offset), [contentStart, block.close.offset]);
    ranges.push([block.open.offset, block.close.offset + block.close.length]);
  }

  const startTags = new Map();
  const tagPattern = /<\/?([A-Za-z][A-Za-z0-9:-]*)/g;
  let tag;
  while ((tag = tagPattern.exec(source)) !== null) {
    const end = findHtmlTagEnd(source, tagPattern.lastIndex);
    if (end < 0) break;
    ranges.push([tag.index, end + 1], [tag.index + tag[0].length - tag[1].length, tagPattern.lastIndex]);
    startTags.set(tag.index, end + 1);
    const attributePattern = /([^\s=/>"']+)(\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+))?/g;
    attributePattern.lastIndex = tagPattern.lastIndex;
    let attribute;
    while ((attribute = attributePattern.exec(source)) !== null && attribute.index < end) {
      const attributeEnd = attribute.index + attribute[0].length;
      if (attributeEnd > end) break;
      ranges.push([attribute.index, attributeEnd]);
      if (attribute[3] && /^["']/.test(attribute[3])) {
        ranges.push([attributeEnd - attribute[3].length + 1, attributeEnd - 1], [attributeEnd - attribute[3].length, attributeEnd]);
      }
    }
    tagPattern.lastIndex = end + 1;
  }
  for (const pair of htmlTags(source).pairs) {
    const openStart = pair.open - 1;
    const closeStart = pair.close - 2;
    const contentStart = startTags.get(openStart);
    const closeEnd = startTags.get(closeStart);
    if (contentStart === undefined || closeEnd === undefined) continue;
    ranges.push(trimmed(source, contentStart, closeStart), [contentStart, closeStart], [openStart, closeEnd]);
  }

  return ranges.filter(([start, end]) => start < end);
}

// The ranges around a selection, from the innermost to the outermost. Ranges that cross
// a larger one are left out, so that each range contains the one before it.
function enclosingRanges(ranges, start, end) {
  const enclosing = ranges
    .filter((range) => range[0] <= start && end <= range[1] && (range[0] < start || end < range[1]))
    .sort((left, right) => (left[1] - left[0]) - (right[1] - right[0]) || right[0] - left[0]);
  const chain = [];
  for (const range of enclosing) {
    const previous = chain[chain.length - 1];
    if (previous && previous[0] === range[0] && previous[1] === range[1]) continue;
    if (!previous || (range[0] <= previous[0] && previous[1] <= range[1])) chain.push(range);
  }
  return chain;
}

module.exports = { enclosingRanges, selectionRanges };
