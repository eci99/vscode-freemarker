const assert = require('assert');
const { wrapWithAbbreviation } = require('../wrap');

const wrap = (abbreviation, text, options) => {
  const result = wrapWithAbbreviation(abbreviation, text, options);
  return result.error ? `Error: ${result.error}` : result.snippet;
};

// Inline: a selection inside a line
assert.strictEqual(wrap('strong', 'Hello'), '<strong>Hello</strong>');
assert.strictEqual(wrap('a.link#top[href="/home" target=_blank hidden]', 'Home'),
  '<a class="link" id="top" href="/home" target="_blank" hidden="">Home</a>');
assert.strictEqual(wrap('p>em', '${name}'), '<p><em>\\${name\\}</em></p>');
assert.strictEqual(wrap('h2+.body', 'x'), '<h2></h2><div class="body">x</div>');
assert.strictEqual(wrap('span>.inner', 'x'), '<span><span class="inner">x</span></span>');
assert.strictEqual(wrap('#if', 'x'), '<#if ${1:condition}>x</#if>');
assert.strictEqual(wrap('#if[user??]>b', 'x'), '<#if user??><b>x</b></#if>');
assert.strictEqual(wrap('#list>li', 'x'), '<#list ${1:sequence as item}><li>x</li></#list>');
assert.strictEqual(wrap('#assign', 'x'), '<#assign ${1:name}>x</#assign>');
assert.strictEqual(wrap('@card[title="A"]', 'x'), '<@card title="A">x</@card>');
assert.strictEqual(wrap('@ui.card', 'x', { tagSyntax: 'square' }), '[@ui.card]x[/@ui.card]');
assert.strictEqual(wrap('#if>#list', 'x', { tagSyntax: 'square' }), '[#if ${1:condition}][#list ${2:sequence as item}]x[/#list][/#if]');
// # alone is an id, also with the name of a directive that has no end tag
assert.strictEqual(wrap('#main', 'x'), '<div id="main">x</div>');
assert.strictEqual(wrap('#include', 'x'), '<div id="include">x</div>');
assert.strictEqual(wrap('div#if', 'x'), '<div id="if">x</div>');

// Block: whole lines, nested tags indented, the text keeping its own indentation
assert.strictEqual(
  wrap('div.card>#if[visible]', '<h2>Title</h2>\n    <p>Text</p>', { block: true, indent: '  ', unit: '  ' }),
  [
    '  <div class="card">',
    '    <#if visible>',
    '      <h2>Title</h2>',
    '        <p>Text</p>',
    '    </#if>',
    '  </div>'
  ].join('\n')
);
assert.strictEqual(
  wrap('ul.items>li*', 'One\n\n  Two', { block: true, unit: '  ' }),
  '<ul class="items">\n  <li>One</li>\n  <li>Two</li>\n</ul>'
);
assert.strictEqual(
  wrap('ul>li.item-$*>a[href="#$"]', 'One\nTwo', { block: true, unit: '  ' }),
  '<ul>\n  <li class="item-1"><a href="#1">One</a></li>\n  <li class="item-2"><a href="#2">Two</a></li>\n</ul>'
);
assert.strictEqual(wrap('table>.row', 'x'), '<table><tr class="row">x</tr></table>');

// Abbreviations that cannot be used
assert.strictEqual(wrap('', 'x'), 'Error: Enter an abbreviation, such as div.card or ul>li*.');
assert.strictEqual(wrap('li*3', 'x'), 'Error: Only * without a number is supported: one element for each line.');
assert.strictEqual(wrap('ul>li*', 'x'), 'Error: Select whole lines to wrap each of them with *.');
assert.strictEqual(wrap('li*+p', 'x', { block: true }), 'Error: Only the element that gets the text, or one of its parents, can have *.');
assert.strictEqual(wrap('div>', 'x'), 'Error: The abbreviation must not end with ">".');
assert.strictEqual(wrap('(div)', 'x'), 'Error: Unexpected "(" at position 1.');
assert.strictEqual(wrap('div[a="b"', 'x'), 'Error: A [ is not closed.');
assert.strictEqual(wrap('@', 'x'), 'Error: A macro call needs a name: @card.');

console.log('Wrap tests passed.');
