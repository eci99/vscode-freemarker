const { findBuiltin, suggestBuiltin } = require('./builtins');

const { BRANCH_PARENTS, findDirective } = require('./directives');
const { normalizeTemplate } = require('./syntax');

function withoutComments(text) {
  return text.replace(/<#--[\s\S]*?-->/g, (comment) => comment.replace(/[^\r\n]/g, ' '));
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

function findInterpolationEnd(text, start) {
  let quote = null;
  let nesting = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== '\\') quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{') {
      nesting += 1;
    } else if (character === '}') {
      if (nesting === 0) return index;
      nesting -= 1;
    }
  }
  return -1;
}

function validateBuiltins(source, blocks) {
  const diagnostics = [];
  const unparsed = blocks.filter((block) => block.name === 'noparse');
  const expressionPattern = /[$#]\{|<[#@][A-Za-z_]/g;
  let match;

  while ((match = expressionPattern.exec(source)) !== null) {
    const start = match.index + 2;
    if (unparsed.some((block) => start > block.open.offset + block.open.length && start < block.close.offset)) continue;
    const end = match[0][0] === '<' ? findTagEnd(source, start) : findInterpolationEnd(source, start);
    if (end < 0) continue;

    let quote = null;
    for (let index = start; index < end; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote && source[index - 1] !== '\\') quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '?' && source[index - 1] !== '?') {
        const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index + 1, end));
        if (!name || findBuiltin(name[0])) continue;
        const suggestion = suggestBuiltin(name[0]);
        diagnostics.push({
          message: `Unknown built-in ?${name[0]}.${suggestion ? ` Did you mean ?${suggestion}?` : ''}`,
          offset: index + 1,
          length: name[0].length
        });
      }
    }
    expressionPattern.lastIndex = end + 1;
  }
  return diagnostics;
}

function tagLabel(tag, closing = false) {
  const label = `${closing ? '/' : ''}${tag.kind === 'directive' ? '#' : '@'}${tag.name}`;
  return tag.square ? `[${label}]` : `<${label}>`;
}

// Pairs the start and end tags of a template. `blocks` are the closed pairs with the
// branch tags (such as <#else>) that belong to them, and `unclosed` are the blocks
// that are still open at the end of the text, outermost first.
function templateBlocks(text, options) {
  const normalized = normalizeTemplate(text, options);
  const square = normalized.tagSyntax === 'square';
  const source = withoutComments(normalized.text);
  const stack = [];
  const blocks = [];
  const diagnostics = [];
  const tagPattern = /<(\/?)#([A-Za-z_][A-Za-z0-9_-]*)|<(\/?)@([A-Za-z_][A-Za-z0-9_.-]*)/g;
  let match;

  // <#sep> and <#recover> end with their parent unless they have an end tag of their own.
  const closeOptionalBlocks = (name) => {
    while (stack.length > 0 && stack[stack.length - 1].optional && stack[stack.length - 1].name !== name) stack.pop();
  };

  while ((match = tagPattern.exec(source)) !== null) {
    const end = findTagEnd(source, tagPattern.lastIndex);
    if (end < 0) continue;

    const isDirective = match[2] !== undefined;
    const closing = isDirective ? match[1] === '/' : match[3] === '/';
    const name = isDirective ? match[2].toLowerCase() : match[4];
    const body = source.slice(tagPattern.lastIndex, end);
    const selfClosing = !closing && /\/\s*$/.test(body);
    const directive = isDirective ? findDirective(name) : undefined;
    const isCapture = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*|"[^"]*"|'[^']*')(?:\s+in\s[\s\S]+)?\s*$/.test(body);
    const opensBlock = isDirective
      ? Boolean(directive && directive.block) && !selfClosing && (directive.block !== 'capture' || isCapture)
      : !closing && !selfClosing;
    const tag = {
      name,
      kind: isDirective ? 'directive' : 'macro',
      offset: match.index,
      length: end + 1 - match.index,
      nameLength: match[0].length,
      square
    };

    if (closing) {
      closeOptionalBlocks(name);
      const expectedIndex = stack.map((entry) => entry.name).lastIndexOf(name);
      if (expectedIndex < 0) {
        const message = stack.length > 0
          ? `Closing tag ${tagLabel(tag, true)} does not match the open ${tagLabel(stack[stack.length - 1])} block.`
          : `Unexpected closing tag ${tagLabel(tag, true)}.`;
        diagnostics.push({ message, offset: tag.offset, length: tag.length });
      } else if (expectedIndex !== stack.length - 1) {
        diagnostics.push({
          message: `Block ${tagLabel(stack[stack.length - 1])} must be closed before ${tagLabel(tag, true)}.`,
          offset: tag.offset,
          length: tag.length
        });
        stack.splice(expectedIndex, 1);
      } else {
        const open = stack.pop();
        blocks.push({ name, kind: tag.kind, open, close: tag, branches: open.branches });
      }
    } else {
      const parents = isDirective ? BRANCH_PARENTS[name] : undefined;
      if (parents) {
        closeOptionalBlocks(name);
        const parent = stack[stack.length - 1];
        if (parent && parent.kind === 'directive' && parents.includes(parent.name)) {
          parent.branches.push(tag);
        } else {
          diagnostics.push({
            message: `${tagLabel(tag)} must be directly inside ${parents.map((parentName) => tagLabel({ ...tag, name: parentName })).join(' or ')}.`,
            offset: tag.offset,
            length: tag.length
          });
        }
      }
      if (opensBlock && name === 'noparse' && isDirective) {
        const closePattern = /<\/#noparse\s*>/g;
        closePattern.lastIndex = end + 1;
        const close = closePattern.exec(source);
        if (close) {
          blocks.push({
            name,
            kind: tag.kind,
            open: tag,
            close: { ...tag, offset: close.index, length: close[0].length, nameLength: '</#noparse'.length },
            branches: []
          });
          tagPattern.lastIndex = close.index + close[0].length;
          continue;
        }
      }
      if (opensBlock) stack.push({ ...tag, optional: Boolean(directive && directive.block === 'optional'), branches: [] });
    }

    tagPattern.lastIndex = end + 1;
  }

  for (const block of [...stack].reverse()) {
    if (block.optional) continue;
    diagnostics.push({
      message: `Unclosed ${block.kind === 'directive' ? 'directive' : 'macro'} ${tagLabel(block)}.`,
      offset: block.offset,
      length: block.length
    });
  }
  blocks.sort((left, right) => left.open.offset - right.open.offset);
  return { source, blocks, unclosed: stack, diagnostics };
}

const htmlVoidElements = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr'
]);
const htmlRawTextElements = new Set(['script', 'style']);

// Like findTagEnd, for an HTML tag that can have FreeMarker tags between its attributes.
function findHtmlTagEnd(text, start) {
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '<' && /^<\/?[#@]/.test(text.slice(index, index + 3))) {
      const end = findTagEnd(text, index + 1);
      if (end < 0) return -1;
      index = end;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

// Pairs the start and end tags of the HTML in a template that is already in the default
// syntax. `pairs` are the name offsets of the start and end tag of each closed element,
// and `unclosed` are the elements that are still open at the end of the text,
// outermost first. FreeMarker tags are skipped, so every start tag needs an end tag of
// its own, whatever directive it is in.
function htmlTags(source) {
  const stack = [];
  const pairs = [];
  const diagnostics = [];
  const report = (tag) => {
    diagnostics.push({
      message: `Unclosed HTML tag <${tag.name}>.`,
      offset: tag.offset,
      length: tag.length,
      severity: 'warning'
    });
  };

  for (let index = 0; index < source.length;) {
    if (source[index] !== '<') {
      if ((source[index] === '$' || source[index] === '#') && source[index + 1] === '{') {
        const interpolationEnd = findInterpolationEnd(source, index + 2);
        index = interpolationEnd < 0 ? index + 2 : interpolationEnd + 1;
      } else {
        index += 1;
      }
      continue;
    }
    if (source.startsWith('<!--', index) || source.startsWith('<#--', index)) {
      const commentEnd = source.indexOf('-->', index + 4);
      if (commentEnd < 0) break;
      index = commentEnd + 3;
      continue;
    }

    if (/^<\/?[#@]/.test(source.slice(index, index + 3))) {
      const tagEnd = findTagEnd(source, index + 1);
      if (tagEnd < 0) break;
      index = tagEnd + 1;
      continue;
    }

    const match = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(source.slice(index, index + 80));
    if (!match) {
      index += 1;
      continue;
    }
    const tagEnd = findHtmlTagEnd(source, index + match[0].length);
    if (tagEnd < 0) break;
    const name = match[2];
    const lowerName = name.toLowerCase();
    const offset = index;
    index = tagEnd + 1;
    if (match[1]) {
      const openIndex = stack.map((tag) => tag.name.toLowerCase()).lastIndexOf(lowerName);
      if (openIndex >= 0) {
        const closed = stack.splice(openIndex);
        pairs.push({ open: closed[0].offset + 1, openLength: closed[0].name.length, close: offset + 2, closeLength: name.length });
        closed.slice(1).reverse().forEach(report);
      } else {
        diagnostics.push({
          message: `Unexpected closing HTML tag </${name}>.`,
          offset,
          length: index - offset,
          severity: 'warning'
        });
      }
    } else if (!htmlVoidElements.has(lowerName) && !/\/\s*$/.test(source.slice(offset, tagEnd))) {
      stack.push({ name, offset, length: match[0].length });
      if (htmlRawTextElements.has(lowerName)) {
        const rawTextEnd = source.toLowerCase().indexOf(`</${lowerName}`, index);
        index = rawTextEnd < 0 ? source.length : rawTextEnd;
      }
    }
  }

  [...stack].reverse().forEach(report);
  return { pairs, unclosed: stack, diagnostics };
}

// options.validateHtml: false leaves the HTML of the template unchecked.
function validateTemplate(text, options = {}) {
  const { source, blocks, diagnostics } = templateBlocks(text, options);
  const htmlDiagnostics = options.validateHtml === false ? [] : htmlTags(source).diagnostics;
  return [...diagnostics, ...htmlDiagnostics, ...validateBuiltins(source, blocks)];
}

module.exports = { htmlTags, templateBlocks, validateTemplate };
