const assert = require('assert');
const { semanticTokens } = require('../semantic-tokens');

const describe = (source, options) => semanticTokens(source, options).map((token) =>
  `${source.slice(token.offset, token.offset + token.length)}@${token.offset}:${token.type}${token.local ? '.local' : ''}`
);

assert.deepStrictEqual(describe('<#assign title = "Home">${title} ${other} ${"title"}'), [
  'title@9:variable',
  'title@26:variable'
]);
assert.deepStrictEqual(
  describe('<#macro card title size=1><#local label = title + size>${label} ${title?upper_case} ${page.title}</#macro>${title}${label}'),
  [
    'card@8:macro',
    'title@13:parameter',
    'size@19:parameter',
    'label@34:variable.local',
    'title@42:parameter',
    'size@50:parameter',
    'label@57:variable.local',
    'title@66:parameter'
  ]
);
assert.deepStrictEqual(describe('<#function sum a b...><#return a + b[0] + sum(a, b)></#function>'), [
  'sum@11:function',
  'a@15:parameter',
  'b@17:parameter',
  'a@31:parameter',
  'b@35:parameter',
  'sum@42:function',
  'a@46:parameter',
  'b@49:parameter'
]);
assert.deepStrictEqual(describe('<#assign n = 3><#list 1..n as i>${i}<#if i gt n>${n}</#if></#list>'), [
  'n@9:variable',
  'n@25:variable',
  'i@30:variable.local',
  'i@34:variable.local',
  'i@41:variable.local',
  'n@46:variable',
  'n@50:variable'
]);
assert.deepStrictEqual(describe('<#assign a = 1 b = a == 2><@box title=a size=b.c>${a}</@box>'), [
  'a@9:variable',
  'b@15:variable',
  'a@19:variable',
  'box@28:macro',
  'title@32:parameter',
  'a@38:variable',
  'size@40:parameter',
  'b@45:variable',
  'a@51:variable',
  'box@56:macro'
]);
assert.deepStrictEqual(describe('<#global g = 1><#assign text>body</#assign><#import "a.ftl" as lib>${g}${text}${lib.x}'), [
  'g@9:variable',
  'text@24:variable',
  'lib@63:namespace',
  'g@69:variable',
  'text@73:variable',
  'lib@80:namespace'
]);
assert.deepStrictEqual(
  describe('<#import "a.ftl" as lib><@lib.card title=lib.name>${lib.total(1)} ${data.total(1)} ${other(1)}</@lib.card><@plain />'),
  [
    'lib@20:namespace',
    'lib@26:namespace',
    'card@30:macro',
    'title@35:parameter',
    'lib@41:namespace',
    'lib@52:namespace',
    'total@56:function',
    'lib@97:namespace',
    'card@101:macro',
    'plain@108:macro'
  ]
);
assert.deepStrictEqual(
  describe('${shared(1)} ${ns.f()} <@ns.m />', { functions: ['shared'], namespaces: ['ns'] }),
  ['shared@2:function', 'ns@15:namespace', 'f@18:function', 'ns@25:namespace', 'm@28:macro']
);
assert.deepStrictEqual(describe('${shared} ${unknown}', { variables: ['shared'] }), ['shared@2:variable']);
assert.deepStrictEqual(describe('<p title="a">${x</p>'), []);

console.log('Semantic token tests passed.');
