const { findBuiltin, suggestBuiltin } = require('./builtins');

const BLOCK_DIRECTIVES = new Set([
  'if', 'list', 'foreach', 'switch', 'macro', 'function', 'attempt', 'compress',
  'noparse', 'outputformat', 'autoesc', 'noautoesc', 'escape', 'transform',
  'items', 'sep', 'recover', 'visit', 'recurse', 'assign'
]);

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

function validateBuiltins(source) {
  const diagnostics = [];
  const expressionPattern = /[$#]\{|<[#@][A-Za-z_]/g;
  let match;

  while ((match = expressionPattern.exec(source)) !== null) {
    const start = match.index + 2;
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

function validateTemplate(text) {
  const source = withoutComments(text);
  const stack = [];
  const diagnostics = [];
  const tagPattern = /<(\/?)#([A-Za-z_][A-Za-z0-9_-]*)|<(\/?)@([A-Za-z_][A-Za-z0-9_.-]*)/g;
  let match;

  while ((match = tagPattern.exec(source)) !== null) {
    const end = findTagEnd(source, tagPattern.lastIndex);
    if (end < 0) continue;

    const isDirective = match[2] !== undefined;
    const closing = isDirective ? match[1] === '/' : match[3] === '/';
    const name = isDirective ? match[2].toLowerCase() : match[4];
    const body = source.slice(tagPattern.lastIndex, end);
    const selfClosing = !closing && /\/\s*$/.test(body);
    const isCaptureAssign = isDirective && name === 'assign' && !/=/.test(body);
    const opensBlock = isDirective
      ? BLOCK_DIRECTIVES.has(name) && !selfClosing && (name !== 'assign' || isCaptureAssign)
      : !closing && !selfClosing;

    if (closing) {
      const expectedIndex = stack.map((entry) => entry.name).lastIndexOf(name);
      if (expectedIndex < 0) {
        const message = stack.length > 0
          ? `Closing tag </${isDirective ? '#' : '@'}${name}> does not match the open <${stack[stack.length - 1].kind === 'directive' ? '#' : '@'}${stack[stack.length - 1].name}> block.`
          : `Unexpected closing tag </${isDirective ? '#' : '@'}${name}>.`;
        diagnostics.push({
          message,
          offset: match.index,
          length: end + 1 - match.index
        });
      } else if (expectedIndex !== stack.length - 1) {
        const unclosed = stack[stack.length - 1];
        diagnostics.push({
          message: `Block <${unclosed.kind === 'directive' ? '#' : '@'}${unclosed.name}> must be closed before </${isDirective ? '#' : '@'}${name}>.`,
          offset: match.index,
          length: end + 1 - match.index
        });
        stack.splice(expectedIndex, 1);
      } else {
        stack.pop();
      }
    } else if (opensBlock) {
      stack.push({ name, kind: isDirective ? 'directive' : 'macro', offset: match.index, length: end + 1 - match.index });
    }

    tagPattern.lastIndex = end + 1;
  }

  for (const block of stack.reverse()) {
    diagnostics.push({
      message: `Unclosed ${block.kind === 'directive' ? 'directive' : 'macro'} <${block.kind === 'directive' ? '#' : '@'}${block.name}>.`,
      offset: block.offset,
      length: block.length
    });
  }
  return [...diagnostics, ...validateBuiltins(source)];
}

module.exports = { validateTemplate };