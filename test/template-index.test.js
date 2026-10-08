const assert = require('assert');
const { parseTemplate } = require('../template-index');

const parsed = parseTemplate([
  '<#-- <#macro hidden> -->',
  '<#macro card title width=2 label="wide card">',
  '<#function total items precision=2>',
  '<#assign heading = "Cards">',
  '<#list entries as entry>',
  '<#import "/lib/cards.ftl" as cards>',
  '<#include "shared/layout.ftl">'
].join('\n'));

assert.deepStrictEqual(
  parsed.symbols.map(({ name, kind }) => [name, kind]),
  [
    ['card', 'macro'],
    ['total', 'function'],
    ['heading', 'variable'],
    ['entry', 'variable']
  ]
);
assert.deepStrictEqual(parsed.symbols[0].parameters, [
  { name: 'title', defaultValue: undefined },
  { name: 'width', defaultValue: '2' },
  { name: 'label', defaultValue: '"wide card"' }
]);
assert.deepStrictEqual(parsed.symbols[1].parameters, [
  { name: 'items', defaultValue: undefined },
  { name: 'precision', defaultValue: '2' }
]);
assert.strictEqual(parsed.symbols[0].declaration, '<#macro card title width=2 label="wide card">');
assert.strictEqual(parsed.symbols[1].declaration, '<#function total items precision=2>');
assert.strictEqual(parsed.symbols[2].declaration, '<#assign heading = "Cards">');
assert.strictEqual(parsed.symbols[3].declaration, '<#list entries as entry>');
assert.deepStrictEqual(
  parsed.directives.map(({ kind, path, alias }) => [kind, path, alias]),
  [
    ['import', '/lib/cards.ftl', 'cards'],
    ['include', 'shared/layout.ftl', null]
  ]
);
assert.strictEqual(
  parsed.source.slice(parsed.directives[0].aliasOffset, parsed.directives[0].aliasOffset + 5),
  'cards'
);

console.log('Template parser tests passed.');