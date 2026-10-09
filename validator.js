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
  return diagnostics;
}

module.exports = { validateTemplate };