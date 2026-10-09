const assert = require('assert');
const grammar = require('../syntaxes/freemarker.tmLanguage.json');
const {
  BUILTINS,
  builtinBefore,
  builtinGrammarPattern,
  builtinNameStart,
  builtinSignature,
  camelCaseName,
  findBuiltin,
  suggestBuiltin
} = require('../builtins');

const names = BUILTINS.map((builtin) => builtin.name);
assert.strictEqual(new Set(names).size, names.length);
assert.deepStrictEqual(names, [...names].sort((left, right) => left.localeCompare(right)));
assert(BUILTINS.every((builtin) => /^[a-z]+(_[a-z]+)*$/.test(builtin.name)));
assert(BUILTINS.every((builtin) => builtin.category && builtin.description));

for (const name of ['dedent', 'indent', 'wrap', 'lines', 'empty_to_null', 'blank_to_null', 'trim_to_null', 'upper_case', 'has_next', 'is_string', 'seq_contains', 'iso_utc', 'iso_local_ms_nz', 'no_esc']) {
  assert(findBuiltin(name), name);
}
for (const name of ['json', 'is_defined', 'is_empty', 'loop', 'method', 'template_name']) {
  assert.strictEqual(findBuiltin(name), undefined, name);
}

assert.strictEqual(camelCaseName('upper_case'), 'upperCase');
assert.strictEqual(camelCaseName('iso_utc_ms_nz'), 'isoUtcMsNZ');
assert.strictEqual(findBuiltin('upperCase'), findBuiltin('upper_case'));
assert.strictEqual(findBuiltin('isoNZ'), findBuiltin('iso_nz'));
assert.strictEqual(findBuiltin('html').deprecated, true);
assert.strictEqual(findBuiltin('trim').deprecated, false);

assert.strictEqual(builtinSignature(findBuiltin('trim')), 'trim');
assert.strictEqual(builtinSignature(findBuiltin('wrap')), 'wrap(width, firstPrefix?, otherPrefix?)');
assert.strictEqual(builtinSignature(findBuiltin('replace')), 'replace(from, to, flags?)');

assert.strictEqual(builtinNameStart('${name?'), 7);
assert.strictEqual(builtinNameStart('${name?up'), 7);
assert.strictEqual(builtinNameStart('?'), 1);
assert.strictEqual(builtinNameStart('${name??'), -1);
assert.strictEqual(builtinNameStart('${name'), -1);
assert.strictEqual(builtinNameStart('${name?trim.'), -1);

assert.strictEqual(builtinBefore('${name?replace'), findBuiltin('replace'));
assert.strictEqual(builtinBefore('${name?replace '), findBuiltin('replace'));
assert.strictEqual(builtinBefore('${name?'), undefined);
assert.strictEqual(builtinBefore('${replace'), undefined);

assert.strictEqual(suggestBuiltin('uper_case'), 'upper_case');
assert.strictEqual(suggestBuiltin('lenght'), 'length');
assert.strictEqual(suggestBuiltin('uperCase'), 'upperCase');
assert.strictEqual(suggestBuiltin('x'), undefined);
assert.strictEqual(suggestBuiltin('json'), undefined);

const grammarRule = grammar.repository.expression.patterns
  .find((pattern) => pattern.name === 'support.function.builtin.freemarker');
assert.strictEqual(grammarRule.match, builtinGrammarPattern());
const highlighted = new RegExp(grammarRule.match);
assert.strictEqual(highlighted.exec('name?cap_first')[1], 'cap_first');
assert.strictEqual(highlighted.exec('name?c')[1], 'c');
assert.strictEqual(highlighted.exec('name?isoUtcNZ')[1], 'isoUtcNZ');
assert.strictEqual(highlighted.exec('name?json'), null);

console.log('Built-in tests passed.');
