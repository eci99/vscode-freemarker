const assert = require('assert');
const { literalType, parseTemplate, symbolType } = require('../template-index');

const parsed = parseTemplate([
  '<#-- <#macro hidden> -->',
  '<#-- Renders a reusable card.\n\nAdditional implementation notes. -->',
  '<#macro card title width=2 label="wide card">',
  '<#-- Calculates the total value. -->',
  '<#function total items precision=2>',
  '<#-- Heading for a page. -->',
  '<#assign pageHeading = "Welcome">',
  '<#assign inlineNote = "value"> <#-- Short inline description. -->',
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
    ['pageHeading', 'variable'],
    ['inlineNote', 'variable'],
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
assert.strictEqual(parsed.symbols[2].documentation, 'Heading for a page.');
assert.strictEqual(parsed.symbols[3].documentation, 'Short inline description.');
assert.strictEqual(parsed.symbols[4].declaration, '<#assign heading = "Cards">');
assert.strictEqual(parsed.symbols[4].value, '"Cards"');
assert.strictEqual(parsed.symbols[5].declaration, '<#assign greeting>\n  Hello World\n</#assign>');
assert.strictEqual(parsed.symbols[5].value, 'Hello World');
assert.strictEqual(parsed.symbols[7].value, '{"fontSize": 14}');
assert.strictEqual(parsed.symbols[8].value, '14');
assert.strictEqual(parsed.symbols[9].declaration, '<#list entries as entry>');
const selfClosingAssignment = parseTemplate('<#assign name2 = "test"/>');
assert.strictEqual(selfClosingAssignment.symbols[0].value, '"test"');
const separatedComment = parseTemplate('<#-- Not directly attached. -->\n\n<#assign detached = true>');
assert.strictEqual(separatedComment.symbols[0].documentation, undefined);
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
assert.strictEqual(parsed.source[parsed.directives[0].endOffset - 1], '>');

assert.strictEqual(literalType('"text"'), 'string');
assert.strictEqual(literalType("r'C:\\temp'"), 'string');
assert.strictEqual(literalType('"a" + name'), undefined);
assert.strictEqual(literalType('"a"?length'), undefined);
assert.strictEqual(literalType('-12.5'), 'number');
assert.strictEqual(literalType('true'), 'boolean');
assert.strictEqual(literalType('[1, [2, 3]]'), 'sequence');
assert.strictEqual(literalType('[1, 2][0]'), undefined);
assert.strictEqual(literalType('{"a": 1}'), 'hash');
assert.strictEqual(literalType('user.name'), undefined);

const typed = parseTemplate([
  '<#assign title = "Home">',
  '<#assign note>text</#assign>',
  '<#assign config = {"size": 14}>',
  '<#assign other = title>',
  '<#list entries as entry></#list>'
].join('\n'));
assert.deepStrictEqual(
  typed.symbols.map((symbol) => [symbol.name, symbolType(symbol)]),
  [
    ['title', 'string'],
    ['note', 'string'],
    ['config', 'hash'],
    ['config.size', 'number'],
    ['other', undefined],
    ['entry', 'loop variable']
  ]
);

console.log('Template parser tests passed.');