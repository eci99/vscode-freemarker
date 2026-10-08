const assert = require('assert');
const { parseTemplate } = require('../template-index');

const parsed = parseTemplate([
  '<#-- <#macro hidden> -->',
  '<#macro card title>',
  '<#function total items>',
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