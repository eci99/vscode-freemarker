const assert = require('assert');
const { parseTemplate } = require('../template-index');

const parsed = parseTemplate([
  '<#-- <#macro hidden> -->',
  '<#-- Renders a reusable card.\n\nAdditional implementation notes. -->',
  '<#macro card title width=2 label="wide card">',
  '<#-- Calculates the total value. -->',
  '<#function total items precision=2>',
  '<#assign heading = "Cards">',
  '<#assign greeting>\n  Hello World\n</#assign>',
  '<#assign config = {"editor": {"fontSize": 14}}>',
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
    ['greeting', 'variable'],
    ['config', 'variable'],
    ['config.editor', 'variable'],
    ['config.editor.fontSize', 'variable'],
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
assert.strictEqual(parsed.symbols[0].documentation, 'Renders a reusable card.');
assert.strictEqual(parsed.symbols[1].documentation, 'Calculates the total value.');
assert.strictEqual(parsed.symbols[2].declaration, '<#assign heading = "Cards">');
assert.strictEqual(parsed.symbols[2].value, '"Cards"');
assert.strictEqual(parsed.symbols[3].declaration, '<#assign greeting>\n  Hello World\n</#assign>');
assert.strictEqual(parsed.symbols[3].value, 'Hello World');
assert.strictEqual(parsed.symbols[5].value, '{"fontSize": 14}');
assert.strictEqual(parsed.symbols[6].value, '14');
assert.strictEqual(parsed.symbols[7].declaration, '<#list entries as entry>');
const selfClosingAssignment = parseTemplate('<#assign name2 = "test"/>');
assert.strictEqual(selfClosingAssignment.symbols[0].value, '"test"');
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