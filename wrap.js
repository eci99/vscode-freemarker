const { findDirective } = require('./directives');

// Wraps text in the tags of an Emmet-like abbreviation:
//   div.card#main[data-id="1" hidden]   an element with classes, an id, and attributes
//   ul>li                               a child, which gets the text
//   h2+div                              siblings; the text goes into the last one
//   ul>li*                              one li for each line of the text; $ is its number
//   .note                               an element without a name is a div, li in a list, ...
//   #if  #list[users as user]  #assign[name]   FreeMarker directives, with their parameters in []
//   @card[title="x"]                    a macro call
// A directive without parameters gets a snippet placeholder for them.

const IMPLICIT_CHILDREN = { ul: 'li', ol: 'li', table: 'tr', tbody: 'tr', thead: 'tr', tfoot: 'tr', tr: 'td', select: 'option', optgroup: 'option', dl: 'dt' };
const INLINE_ELEMENTS = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var']);
const NAME = /^[A-Za-z_][A-Za-z0-9_:.-]*/;

// The text between [ and the matching ], respecting quotes.
function bracketContent(text, start) {
  let quote = null;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ']') {
      return { content: text.slice(start + 1, index), end: index + 1 };
    }
  }
  return undefined;
}

// name="value" pairs from the text of [...]: a=b becomes a="b", a alone becomes a="".
function htmlAttributes(text) {
  const attributes = [];
  const pattern = /([^\s=]+)(?:=("[^"]*"|'[^']*'|\S*))?/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[2] === undefined ? '' : match[2].replace(/^(["'])([\s\S]*)\1$/, '$2');
    attributes.push([match[1], value]);
  }
  return attributes;
}

// The tree of the abbreviation: { roots, target } or { error }. `target` is the element that
// gets the text, the last element on the deepest level.
function parseAbbreviation(abbreviation) {
  const text = abbreviation.trim();
  if (!text) return { error: 'Enter an abbreviation, such as div.card or ul>li*.' };
  const roots = [];
  let siblings = roots;
  let parent;
  let last;
  let index = 0;
  while (index < text.length) {
    const element = { kind: 'html', name: '', classes: [], attributes: [], children: [], parent };
    if (text[index] === '@') {
      const name = NAME.exec(text.slice(index + 1));
      if (!name) return { error: 'A macro call needs a name: @card.' };
      Object.assign(element, { kind: 'macro', name: name[0] });
      index += 1 + name[0].length;
    } else if (text[index] === '#' && /^[A-Za-z]+/.test(text.slice(index + 1))) {
      const name = /^[A-Za-z]+/.exec(text.slice(index + 1))[0];
      const directive = findDirective(name);
      if (directive && ['required', 'capture'].includes(directive.block)) {
        Object.assign(element, { kind: 'directive', name, directive });
        index += 1 + name.length;
      }
    }
    if (element.kind === 'html') {
      const name = /^[A-Za-z][A-Za-z0-9:-]*/.exec(text.slice(index));
      if (name) {
        element.name = name[0];
        index += name[0].length;
      }
    }

    // The parts after the name: #id, .class, [attributes], and * for one per line.
    for (;;) {
      const character = text[index];
      if (character === '[') {
        const bracket = bracketContent(text, index);
        if (!bracket) return { error: 'A [ is not closed.' };
        if (element.kind === 'html') element.attributes.push(...htmlAttributes(bracket.content));
        else element.parameters = bracket.content.trim();
        index = bracket.end;
      } else if ((character === '#' || character === '.') && element.kind === 'html') {
        const value = /^[A-Za-z0-9_$:-]+/.exec(text.slice(index + 1));
        if (!value) return { error: `${character} needs a name after it.` };
        if (character === '#') element.attributes.push(['id', value[0]]);
        else element.classes.push(value[0]);
        index += 1 + value[0].length;
      } else if (character === '*') {
        if (/^\d/.test(text.slice(index + 1))) return { error: 'Only * without a number is supported: one element for each line.' };
        element.repeat = true;
        index += 1;
      } else {
        break;
      }
    }
    if (element.kind === 'html' && !element.name) {
      if (!element.classes.length && !element.attributes.length) {
        return { error: `Unexpected "${text[index] || ''}" at position ${index + 1}.` };
      }
      const parentName = parent && parent.kind === 'html' ? parent.name.toLowerCase() : '';
      element.name = IMPLICIT_CHILDREN[parentName] || (INLINE_ELEMENTS.has(parentName) ? 'span' : 'div');
    }
    siblings.push(element);
    last = element;

    const operator = text[index];
    if (operator === undefined) break;
    if (operator === '>') {
      parent = last;
      siblings = last.children;
    } else if (operator !== '+') {
      return { error: `Unexpected "${operator}" at position ${index + 1}.` };
    }
    index += 1;
    if (index === text.length) return { error: `The abbreviation must not end with "${operator}".` };
  }

  const repeated = [];
  for (let element = last; element; element = element.parent) if (element.repeat) repeated.push(element);
  if (repeated.length > 1) return { error: 'Only one element can have *.' };
  // A * on an element that is not on the way to the text.
  const all = [];
  const collect = (elements) => elements.forEach((element) => { all.push(element); collect(element.children); });
  collect(roots);
  if (all.some((element) => element.repeat && !repeated.includes(element))) {
    return { error: 'Only the element that gets the text, or one of its parents, can have *.' };
  }
  return { roots, target: last, repeated: repeated[0] };
}

const escapeSnippet = (value) => value.replace(/[\\$}]/g, '\\$&');

// The snippet that wraps `text` in the abbreviation, or { error }.
// options: tagSyntax ('angle' | 'square'), block (the text is whole lines), indent (of the first
// line), unit (one level of indentation), newline.
function wrapWithAbbreviation(abbreviation, text, options = {}) {
  const parsed = parseAbbreviation(abbreviation);
  if (parsed.error) return parsed;
  const { roots, target, repeated } = parsed;
  const { tagSyntax = 'angle', block = false, indent = '', unit = '  ', newline = '\n' } = options;
  const [open, close] = tagSyntax === 'square' ? ['[', ']'] : ['<', '>'];
  let placeholder = 0;

  const tags = (element, number) => {
    if (element.kind === 'html') {
      const attributes = [...(element.classes.length ? [['class', element.classes.join(' ')]] : []), ...element.attributes]
        .map(([name, value]) => ` ${name}="${escapeSnippet(value.replace(/\$/g, number === undefined ? '$' : String(number)))}"`)
        .join('');
      return [`<${element.name}${attributes}>`, `</${element.name}>`];
    }
    if (element.kind === 'macro') {
      return [`${open}@${element.name}${element.parameters ? ` ${escapeSnippet(element.parameters)}` : ''}${close}`, `${open}/@${element.name}${close}`];
    }
    let parameters = element.parameters === undefined ? undefined : escapeSnippet(element.parameters);
    if (parameters === undefined) {
      const syntax = new RegExp(`^<#${element.name}\\s+([^>]*)>`).exec(element.directive.syntax);
      const hint = element.directive.block === 'capture' ? 'name' : syntax && syntax[1];
      if (hint) parameters = `\${${++placeholder}:${hint}}`;
    }
    return [`${open}#${element.name}${parameters ? ` ${parameters}` : ''}${close}`, `${open}/#${element.name}${close}`];
  };

  // Inline: everything on one line.
  const inline = (element, content, number) => {
    const [start, end] = tags(element, number);
    const inner = element === target ? content : element.children.map((child) => inline(child, content, number)).join('');
    return `${start}${inner}${end}`;
  };
  const inlineList = (elements, content) => elements.map((element) => inline(element, content)).join('');

  const lines = text.split(/\r?\n/);
  if (!block) {
    if (repeated) return { error: 'Select whole lines to wrap each of them with *.' };
    return { snippet: inlineList(roots, escapeSnippet(text)) };
  }

  // Block: one tag per line, nested ones indented, the text keeping its own indentation.
  const content = lines.map((line, position) => (position === 0 ? indent + line : line));
  const baseIndent = Math.min(...content.filter((line) => line.trim()).map((line) => line.length - line.trimStart().length));
  const contentLines = content.map((line) => (line.trim() ? line.slice(baseIndent) : ''));
  const indentation = (depth) => indent + unit.repeat(depth);
  const blockLines = (element, depth) => {
    if (element === repeated) {
      return contentLines.filter((line) => line.trim())
        .map((line, position) => indentation(depth) + inline(element, escapeSnippet(line.trim()), position + 1));
    }
    const [start, end] = tags(element);
    const inner = element === target
      ? contentLines.map((line) => (line ? indentation(depth + 1) + escapeSnippet(line) : ''))
      : element.children.flatMap((child) => blockLines(child, depth + 1));
    return [indentation(depth) + start, ...inner, indentation(depth) + end];
  };
  return { snippet: roots.flatMap((element) => blockLines(element, 0)).join(newline) };
}

module.exports = { parseAbbreviation, wrapWithAbbreviation };
