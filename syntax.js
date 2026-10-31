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

// In a raw string literal (r"..."), a backslash is a plain character.
function isRawStringStart(text, index) {
  return text[index - 1] === 'r' && !/[A-Za-z0-9_.]/.test(text[index - 2] || '');
}

// Replaces the backslashes in raw strings, so that scanners that treat a backslash
// as an escape do not skip the closing quote. The offsets stay the same.
function maskRawStrings(text) {
  return text.replace(/(?<![A-Za-z0-9_.])r(["'])((?:(?!\1)[^])*)\1/g, (match) => match.replace(/\\/g, '/'));
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
  let raw = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\' && !raw) index += 1;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
      raw = isRawStringStart(text, index);
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

// The offset of the } that ends an interpolation whose content starts at `start`, or -1.
// The search ends at `limit`.
function interpolationEnd(text, start, limit = text.length) {
  let quote = null;
  let raw = false;
  let nesting = 0;
  for (let index = start; index < Math.min(limit, text.length); index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\' && !raw) index += 1;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
      raw = isRawStringStart(text, index);
    } else if (character === '{') {
      nesting += 1;
    } else if (character === '}') {
      if (nesting === 0) return index;
      nesting -= 1;
    }
  }
  return -1;
}

// The comments of a template, as { start, end }, end being the offset after the -->. The
// search stops at a comment that is not closed: no later one can be closed either.
function commentRanges(text) {
  const ranges = [];
  for (let start = text.indexOf('<#--'); start >= 0; start = text.indexOf('<#--', start)) {
    const close = text.indexOf('-->', start + 4);
    if (close < 0) break;
    ranges.push({ start, end: close + 3 });
    start = close + 3;
  }
  return ranges;
}

// Blanks the comments of `text`, except for their line breaks. `original` is the same
// template before it was rewritten to the default syntax, and gets the same ranges blanked.
function maskComments(text, original = text) {
  let result = '';
  let end = 0;
  for (const comment of commentRanges(text)) {
    result += original.slice(end, comment.start) + text.slice(comment.start, comment.end).replace(/[^\r\n]/g, ' ');
    end = comment.end;
  }
  return result + original.slice(end);
}

// For each offset, the next one at or after it where `found(index)` holds, or -1.
function nextOffsets(text, found) {
  const next = new Int32Array(text.length + 1).fill(-1);
  for (let index = text.length - 1; index >= 0; index -= 1) next[index] = found(index) ? index : next[index + 1];
  return next;
}

// The scans for the > of a tag and the } of an interpolation: a > inside parentheses and a
// } that closes a { are no end, nor is anything in a string. `raw` lets r"..." strings
// keep their backslashes.
const TAG_SCAN = { open: '(', close: ')', end: '>' };
const INTERPOLATION_SCAN = { open: '{', close: '}', end: '}' };

// Where the scan from every offset of `text` ends, worked out in one pass from the end of
// the text. A string or a bracket is skipped to its end, so the scan from an offset
// continues where the scan from the offset after the skipped part does.
function scanEnds(text, { open, close, end }, raw) {
  const table = () => new Int32Array(text.length + 2).fill(-1);
  const escaped = { '"': table(), "'": table() };
  const plain = { '"': table(), "'": table() };
  // Where a bracket that is open at an offset closes.
  const closes = table();
  const ends = table();
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index];
    for (const quote of ['"', "'"]) {
      plain[quote][index] = character === quote ? index : plain[quote][index + 1];
      escaped[quote][index] = character === quote ? index
        : character === '\\' ? escaped[quote][index + 2] : escaped[quote][index + 1];
    }
    let skipped = -1;
    if (character === '"' || character === "'") {
      skipped = (raw && isRawStringStart(text, index) ? plain : escaped)[character][index + 1];
    } else if (character === open) {
      skipped = closes[index + 1];
    } else if (character === close) {
      closes[index] = index;
      // A ) without its ( is ignored by the scan for the end of a tag.
      ends[index] = close === end ? index : ends[index + 1];
      continue;
    } else if (character === end) {
      closes[index] = closes[index + 1];
      ends[index] = index;
      continue;
    } else {
      closes[index] = closes[index + 1];
      ends[index] = ends[index + 1];
      continue;
    }
    closes[index] = skipped < 0 ? -1 : closes[skipped + 1];
    ends[index] = skipped < 0 ? -1 : ends[skipped + 1];
  }
  return ends;
}

// `scan(text, start)` for callers that scan from many offsets. An unclosed tag makes each
// scan read to the end of the text, so once the scans have read more than twice the text,
// the ends of all offsets are worked out at once.
function repeatedScan(text, scan, kind, raw = false) {
  let read = 0;
  let ends;
  return (start) => {
    if (ends) return start >= 0 && start < ends.length ? ends[start] : -1;
    const found = scan(text, start);
    read += (found < 0 ? text.length : found) - start;
    if (read > 2 * text.length) ends = scanEnds(text, kind, raw);
    return found;
  };
}

// The interpolations in the strings of text[start, end), as in "Hello ${name}", with the
// ones inside of those. Each is { start, end }: the content and the offset of its }.
function stringInterpolations(text, start, end) {
  const found = [];
  let quote = null;
  let raw = false;
  for (let index = start; index < end; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\' && !raw) {
        index += 1;
      } else if (character === quote) {
        quote = null;
      } else if (!raw && (character === '$' || character === '#') && text[index + 1] === '{') {
        const close = interpolationEnd(text, index + 2, end);
        if (close < 0) break;
        found.push({ start: index + 2, end: close }, ...stringInterpolations(text, index + 2, close));
        index = close;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
      raw = isRawStringStart(text, index);
    }
  }
  return found;
}

module.exports = {
  INTERPOLATION_SCAN, TAG_SCAN, commentRanges, displayText, interpolationEnd, isRawStringStart, maskComments, maskRawStrings,
  nextOffsets, normalizeTemplate, repeatedScan, resolveTagSyntax, scanEnds, stringInterpolations, toSquareBracketTags
};
