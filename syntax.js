// FreeMarker templates can use square brackets for tags ([#if x]...[/#if]) and for
// interpolations ([=x]). The rest of the extension only understands the default syntax,
// so templates are first rewritten to it, character for character: every offset in the
// rewritten text is the same offset in the original.

// Stands in for a `>` inside a square bracket tag, where it is an operator and not the end of the tag.
const GREATER_THAN = '\uE000';
// Replace the first character of text that only looks like FreeMarker syntax.
const STATIC_TEXT = { '<': '\uE001', '$': '\uE002', '#': '\uE003' };

function isTagStart(text, index) {
  const next = text[index + 1] === '/' ? text[index + 2] : text[index + 1];
  return next === '#' || next === '@';
}

// 'square' or 'angle'. An <#ftl> or [#ftl] header wins over the setting, and with 'auto'
// the first FreeMarker tag of the template decides.
function resolveTagSyntax(text, tagSyntax = 'auto') {
  const header = /^\s*([<[])#ftl\b/.exec(text);
  if (header) return header[1] === '[' ? 'square' : 'angle';
  if (tagSyntax === 'squareBracket') return 'square';
  if (tagSyntax === 'angleBracket') return 'angle';
  const firstTag = /[<[](?:\/?[#@][A-Za-z_]|#--)/.exec(text) || /[<[]\/?[#@]/.exec(text);
  return firstTag && firstTag[0][0] === '[' ? 'square' : 'angle';
}

// The offset of the `]` that ends a square bracket tag or interpolation, or -1 while it is unfinished.
function squareBracketEnd(text, start) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== '\\') quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '[') {
      if (isTagStart(text, index)) return -1;
      depth += 1;
    } else if (character === '(' || character === '{') {
      depth += 1;
    } else if (character === ')' || character === '}') {
      depth -= 1;
    } else if (character === ']') {
      if (depth <= 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

// options.tagSyntax: 'auto' (default), 'angleBracket', or 'squareBracket'
// options.interpolationSyntax: 'legacy' (default: ${x} and #{x}), 'dollar' (only ${x}), or 'squareBracket' ([=x])
function normalizeTemplate(text, options = {}) {
  const tagSyntax = resolveTagSyntax(text, options.tagSyntax);
  const interpolationSyntax = options.interpolationSyntax || 'legacy';
  const syntax = { tagSyntax, interpolationSyntax };
  if (tagSyntax === 'angle' && interpolationSyntax === 'legacy') return { text, ...syntax };

  const characters = text.split('');
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (text[index + 1] === '{' && (character === '#' || character === '$')) {
      if (interpolationSyntax === 'squareBracket' || (character === '#' && interpolationSyntax === 'dollar')) {
        characters[index] = STATIC_TEXT[character];
      }
    } else if (character === '<' && tagSyntax === 'square') {
      if (isTagStart(text, index)) characters[index] = STATIC_TEXT[character];
    } else if (character !== '[') {
      continue;
    } else if (tagSyntax === 'square' && text.startsWith('[#--', index)) {
      characters[index] = '<';
      const end = text.indexOf('--]', index + 4);
      if (end < 0) break;
      for (let inner = index + 4; inner < end; inner += 1) {
        if (text[inner] === '>') characters[inner] = GREATER_THAN;
      }
      characters[end + 2] = '>';
      index = end + 2;
    } else if (tagSyntax === 'square' && isTagStart(text, index)) {
      characters[index] = '<';
      const end = squareBracketEnd(text, index + 1);
      // A tag that is still being typed is taken to reach the end of its line.
      for (let inner = index + 1; end < 0 ? inner < text.length : inner < end; inner += 1) {
        if (end < 0 && (text[inner] === '\n' || (text[inner] === '[' && isTagStart(text, inner)))) break;
        if (text[inner] === '>') characters[inner] = GREATER_THAN;
      }
      if (end < 0) continue;
      characters[end] = '>';
      index = end;
    } else if (interpolationSyntax === 'squareBracket' && text[index + 1] === '=') {
      characters[index] = '$';
      characters[index + 1] = '{';
      const end = squareBracketEnd(text, index + 2);
      if (end < 0) continue;
      characters[end] = '}';
      index = end;
    }
  }
  return { text: characters.join(''), ...syntax };
}

// Text taken from a rewritten template, as the user wrote it.
function displayText(text) {
  let result = text.split(GREATER_THAN).join('>');
  for (const [character, placeholder] of Object.entries(STATIC_TEXT)) result = result.split(placeholder).join(character);
  return result;
}

// Rewrites documentation and snippets, which are written with angle bracket tags.
function toSquareBracketTags(text) {
  return text
    .replace(/<#--/g, '[#--')
    .replace(/-->/g, '--]')
    .replace(/<(\/?[#@][^<>]*)>/g, '[$1]');
}

module.exports = { displayText, normalizeTemplate, resolveTagSyntax, toSquareBracketTags };
