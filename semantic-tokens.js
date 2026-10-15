const { findTagEnd, splitParameters } = require('./template-index');

const KEYWORDS = new Set(['as', 'in', 'using', 'true', 'false', 'gt', 'gte', 'lt', 'lte']);

// Directives whose parameters are expressions; the others take settings such as parse=false.
const EXPRESSION_DIRECTIVES = new Set(['if', 'elseif', 'list', 'items', 'return', 'switch', 'case', 'assign', 'local', 'global']);

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

// The identifiers of an expression, outside of its strings. Built-ins (a?b) and keywords
// are left out. `parent` is the identifier a member (a.b) belongs to, `call` is set for
// a()), and `assigned` for a=.
function identifiers(source, start, end) {
  const found = [];
  let quote = null;
  let previous;
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (!/[A-Za-z_]/.test(character)) {
      // A number such as 0x1F or 1e3 has no identifiers in it.
      if (/[0-9]/.test(character)) while (/[A-Za-z0-9_]/.test(source[index + 1] || '') && index + 1 < end) index += 1;
      continue;
    }

    let nameEnd = index + 1;
    while (nameEnd < end && /[A-Za-z0-9_]/.test(source[nameEnd])) nameEnd += 1;
    const name = source.slice(index, nameEnd);
    // The r of a raw string literal, r"..."
    if (name === 'r' && (source[nameEnd] === '"' || source[nameEnd] === "'")
      && !/[A-Za-z0-9_.]$/.test(source.slice(start, index))) {
      index = nameEnd - 1;
      continue;
    }
    const before = source.slice(start, index).trimEnd();
    const after = source.slice(nameEnd, end).trimStart();
    const member = before.endsWith('.') && !before.endsWith('..');
    if (!before.endsWith('?') && (member || !KEYWORDS.has(name))) {
      const parent = member && previous && source.slice(previous.end, index).trim() === '.' ? previous : undefined;
      previous = { name, offset: index, end: nameEnd, member, parent, call: after.startsWith('('), assigned: /^=(?!=)/.test(after) };
      found.push(previous);
    }
    index = nameEnd - 1;
  }
  return found;
}

// The names of a template that is already in the default syntax, for semantic highlighting:
// { offset, length, type: 'parameter' | 'variable' | 'namespace' | 'macro' | 'function', local }.
// `options.variables`, `options.functions`, and `options.namespaces` are the names that
// are declared in other templates. With `options.reportUnknown`, names that are declared
// nowhere come back with the type 'unknown'.
function semanticTokens(source, options = {}) {
  const regions = [];
  for (let index = 0; index < source.length;) {
    const interpolation = (source[index] === '$' || source[index] === '#') && source[index + 1] === '{';
    const tag = /^<\/?[#@]/.exec(source.slice(index, index + 3));
    if (!interpolation && !tag) {
      index += 1;
      continue;
    }
    const end = interpolation ? findInterpolationEnd(source, index + 2) : findTagEnd(source, index + 1);
    if (end < 0) {
      index += 2;
      continue;
    }
    if (interpolation) {
      regions.push({ start: index + 2, end });
    } else if (tag[0].length === 2) {
      const name = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(source.slice(index + 2, end));
      if (name) regions.push({ start: index + 2 + name[0].length, end, tagStart: index, kind: tag[0][1], name: name[0] });
    } else {
      const name = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(source.slice(index + 3, end));
      regions.push({ start: end, end, tagStart: index, kind: tag[0][2], name: name ? name[0] : '', closing: true });
    }
    index = end + 1;
  }

  // Macros and functions have parameters and local variables of their own.
  const scopes = [];
  const openScopes = [];
  const assigned = new Set(options.variables || []);
  const functions = new Set(options.functions || []);
  const namespaces = new Set(options.namespaces || []);
  const topLevelLocals = new Set();
  const tokens = [];
  for (const region of regions) {
    if (region.kind !== '#') continue;
    const scope = openScopes[openScopes.length - 1];
    if (region.closing) {
      if (scope && scope.kind === region.name) scopes.push({ ...openScopes.pop(), end: region.tagStart });
    } else if (region.name === 'macro' || region.name === 'function') {
      const header = /^\s+([A-Za-z_][A-Za-z0-9_.-]*)/.exec(source.slice(region.start, region.end));
      if (header) {
        region.start += header[0].length;
        tokens.push({ offset: region.start - header[1].length, length: header[1].length, type: region.name, local: false });
        if (region.name === 'function') functions.add(header[1]);
      }
      const parameters = splitParameters(source.slice(region.start, region.end).replace(/\.\.\./g, '   '));
      openScopes.push({
        kind: region.name,
        start: region.tagStart,
        parameters: new Set(parameters.map((parameter) => parameter.name)),
        locals: new Set()
      });
    } else if (['assign', 'global', 'local'].includes(region.name)) {
      const names = identifiers(source, region.start, region.end).filter((name) => !name.member);
      const declared = names.filter((name, position) => position === 0 || name.assigned).map(({ name }) => name);
      const target = region.name === 'local' ? (scope ? scope.locals : topLevelLocals) : assigned;
      for (const name of declared) target.add(name);
    } else if (region.name === 'list' || region.name === 'items') {
      const loopVariables = /\bas\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*([A-Za-z_][A-Za-z0-9_]*))?\s*$/
        .exec(source.slice(region.start, region.end));
      const target = scope ? scope.locals : topLevelLocals;
      if (loopVariables) for (const name of loopVariables.slice(1)) if (name) target.add(name);
    } else if (region.name === 'import') {
      const alias = /\bas\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(source.slice(region.start, region.end));
      if (alias) namespaces.add(alias[1]);
    }
  }
  for (const scope of openScopes) scopes.push({ ...scope, end: source.length });

  for (const region of regions) {
    if (region.kind === '@' && region.name) {
      // <@name> and <@alias.name>
      const nameOffset = region.tagStart + (region.closing ? 3 : 2);
      const macroName = region.name.slice(region.name.lastIndexOf('.') + 1);
      const alias = region.name.split('.')[0];
      if (alias !== region.name && namespaces.has(alias)) {
        tokens.push({ offset: nameOffset, length: alias.length, type: 'namespace', local: false });
      }
      tokens.push({
        offset: nameOffset + region.name.length - macroName.length,
        length: macroName.length,
        type: 'macro',
        local: false
      });
    }
    const scope = scopes
      .filter((candidate) => region.start >= candidate.start && region.start < candidate.end)
      .sort((left, right) => right.start - left.start)[0];
    const checked = options.reportUnknown
      && (region.kind === undefined || region.kind === '@' || EXPRESSION_DIRECTIVES.has(region.name));
    // <@macro ; a, b> declares loop variables after the semicolon.
    const semicolon = region.kind === '@' ? source.slice(region.start, region.end).indexOf(';') : -1;
    const isKnown = (name) => (scope && scope.parameters.has(name))
      || (scope ? scope.locals.has(name) : topLevelLocals.has(name))
      || assigned.has(name) || namespaces.has(name);
    const unknown = (token, name) => {
      if (!checked || /_(?:index|has_next|count)$/.test(name)) return;
      if (semicolon >= 0 && token.offset > region.start + semicolon) return;
      tokens.push({ ...token, type: 'unknown', local: false });
    };
    for (const { name, offset, member, parent, call, assigned: isArgument } of identifiers(source, region.start, region.end)) {
      const token = { offset, length: name.length };
      if (member) {
        // alias.name()
        if (call && parent && !parent.member && namespaces.has(parent.name)) {
          tokens.push({ ...token, type: 'function', local: false });
        }
      } else if (call) {
        if (functions.has(name)) tokens.push({ ...token, type: 'function', local: false });
        else if (!isKnown(name)) unknown(token, name);
      } else if (region.kind === '@' && isArgument) {
        tokens.push({ ...token, type: 'parameter', local: false });
      } else if (scope && scope.parameters.has(name)) {
        tokens.push({ ...token, type: 'parameter', local: false });
      } else if (scope ? scope.locals.has(name) : topLevelLocals.has(name)) {
        tokens.push({ ...token, type: 'variable', local: true });
      } else if (assigned.has(name)) {
        tokens.push({ ...token, type: 'variable', local: false });
      } else if (namespaces.has(name)) {
        tokens.push({ ...token, type: 'namespace', local: false });
      } else if (!isArgument) {
        unknown(token, name);
      }
    }
  }
  return tokens.sort((left, right) => left.offset - right.offset);
}

module.exports = { semanticTokens };
