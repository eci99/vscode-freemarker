const assert = require('assert');
const { expressionTest, literalType, parseTemplate, symbolType } = require('../template-index');

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
assert.strictEqual(literalType('0xFF'), 'number');
assert.strictEqual(literalType('-0X1f'), 'number');
assert.strictEqual(literalType('0xZZ'), undefined);
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

const square = parseTemplate([
  '[#-- Renders a card. --]',
  '[#macro card title width=2]',
  '[#-- [#macro hidden] --]',
  '[#assign wide = width > 2]',
  '[#assign note]text[/#assign]',
  '[#list entries as entry][/#list]',
  '[#import "/lib/cards.ftl" as cards]',
  '<#macro notATag>'
].join('\n'));
assert.strictEqual(square.tagSyntax, 'square');
assert.deepStrictEqual(
  square.symbols.map(({ name, kind, declaration, value }) => [name, kind, declaration, value]),
  [
    ['card', 'macro', '[#macro card title width=2]', undefined],
    ['wide', 'variable', '[#assign wide = width > 2]', 'width > 2'],
    ['note', 'variable', '[#assign note]text[/#assign]', 'text'],
    ['entry', 'variable', '[#list entries as entry]', undefined]
  ]
);
assert.strictEqual(square.symbols[0].documentation, 'Renders a card.');
assert.deepStrictEqual(square.symbols[0].parameters, [
  { name: 'title', defaultValue: undefined },
  { name: 'width', defaultValue: '2' }
]);
assert.deepStrictEqual(square.symbols.map((symbol) => symbolType(symbol)), [undefined, undefined, 'string', 'loop variable']);
assert.deepStrictEqual(square.directives.map(({ kind, path, alias }) => [kind, path, alias]), [['import', '/lib/cards.ftl', 'cards']]);
assert.strictEqual(square.source.length, square.display.length);

const squareInterpolation = parseTemplate('<#assign a = 1>[=a]', { interpolationSyntax: 'squareBracket' });
assert.strictEqual(squareInterpolation.source, '<#assign a = 1>${a}');
assert.strictEqual(squareInterpolation.display, '<#assign a = 1>[=a]');

const escapedBackslash = parseTemplate('<#macro m config="{\\\\"+name+"}" flag=true></#macro>');
assert.deepStrictEqual(escapedBackslash.symbols[0].parameters, [
  { name: 'config', defaultValue: '"{\\\\"+name+"}"' },
  { name: 'flag', defaultValue: 'true' }
]);

console.log('Template parser tests passed.');
// <#assign> with several variables declares each of them
const multiple = parseTemplate('<#assign a=1 b = "x y" c = {"k": 2, "l": a} d = a + (b == c)>');
const multipleVariables = multiple.symbols.filter((symbol) => symbol.kind === 'variable' && !symbol.name.includes('.'));
assert.deepStrictEqual(multipleVariables.map((symbol) => [symbol.name, symbol.value]), [
  ['a', '1'], ['b', '"x y"'], ['c', '{"k": 2, "l": a}'], ['d', 'a + (b == c)']
]);
assert(multiple.symbols.some((symbol) => symbol.name === 'c.k'));

// config += {...} declares a variable only when there is no declaration before it
const compound = parseTemplate('<#local config+={"n": 1}/><#local config += {"m": 2}/><#local other = 1/><#local other+=2/>');
assert.deepStrictEqual(
  compound.symbols.filter((symbol) => symbol.kind === 'variable' && !symbol.name.includes('.')).map((symbol) => symbol.name),
  ['config', 'other']
);

// Unclosed tags, many declarations, and long runs of spaces in a comment take linear time.
for (const text of [
  '<#macro x '.repeat(50000),
  '<#import ('.repeat(50000),
  '<#assign a=1>'.repeat(50000),
  '<#--'.repeat(50000),
  '<#list '.repeat(50000),
  '<#list x as y '.repeat(50000),
  '<#assign a>'.repeat(50000),
  '<#assign a+=1>'.repeat(50000),
  `<#-- a${' '.repeat(500000)}b -->\n<#macro m></#macro>`
]) {
  const start = Date.now();
  parseTemplate(text);
  assert(Date.now() - start < 2000, text.slice(0, 12));
}
assert.strictEqual(parseTemplate('<#-- a  \n   b -->\n<#macro m></#macro>').symbols[0].documentation, 'a b');

// expressionTest answers like a scan from the opening for each name, also out of order.
{
  const source = '<#if (a > 1) && "x.y" == b.c>${d.e} "f.g" <#assign h = i.j';
  const test = expressionTest(source);
  const at = (name) => source.indexOf(name);
  assert.deepStrictEqual(['a', 'x.y', 'b.c', 'd.e', 'f.g', 'i.j'].map((name) => test(at(name), at(name))), [true, false, true, true, false, true]);
  assert.strictEqual(test(at('b.c'), at('b.c')), true);
  assert.strictEqual(test(at('x.y'), at('x.y')), false);
  assert.strictEqual(test(at('d.e'), source.indexOf('}') + 1), false);
  const many = '<#if ' + 'a.b '.repeat(100000);
  const start = Date.now();
  const manyTest = expressionTest(many);
  for (let index = 5; index < many.length; index += 4) manyTest(index, index);
  assert(Date.now() - start < 2000);
}

// The loop variable of <#list> is the first "as name" before the >.
assert.deepStrictEqual(
  parseTemplate('<#list xs as x><#list ys><#items as y>${y}</#items></#list></#list> <#list zs>as z</#list>').symbols.map((symbol) => symbol.name),
  ['x', 'y']
);
