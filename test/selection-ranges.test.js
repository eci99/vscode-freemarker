const assert = require('assert');
const { enclosingRanges, selectionRanges } = require('../selection-ranges');

// The texts that Expand Selection steps through from the | in the template.
const expand = (template, options = { tagSyntax: 'auto' }) => {
  const offset = template.indexOf('|');
  const text = template.replace('|', '');
  return enclosingRanges(selectionRanges(text, options), offset, offset).map(([start, end]) => text.slice(start, end));
};

assert.deepStrictEqual(expand('<#if us|er.name?has_content>yes</#if>'), [
  'user.name',
  'user.name?has_content',
  '<#if user.name?has_content>',
  '<#if user.name?has_content>yes</#if>'
]);
assert.deepStrictEqual(expand('<#if ready>\n  <p>Hel|lo</p>\n<#else>\n  no\n</#if>'), [
  'Hello',
  '<p>Hello</p>',
  '\n  <p>Hello</p>\n',
  '\n  <p>Hello</p>\n<#else>\n  no\n',
  '<#if ready>\n  <p>Hello</p>\n<#else>\n  no\n</#if>'
]);
assert.deepStrictEqual(expand('<#if ready>yes<#else>n|o</#if>'), [
  'no',
  '<#else>no',
  'yes<#else>no',
  '<#if ready>yes<#else>no</#if>'
]);
assert.deepStrictEqual(expand('<@cards.render title="Ti|tle" size=2 />'), [
  'Title',
  '"Title"',
  'title="Title"',
  'title="Title" size=2',
  '<@cards.render title="Title" size=2 />'
]);
assert.deepStrictEqual(expand('<@cards.ren|der title="a">x</@cards.render>'), [
  'cards.render',
  '<@cards.render title="a">',
  '<@cards.render title="a">x</@cards.render>'
]);
assert.deepStrictEqual(expand('<div class="a">${(price + ta|x) * 2}</div>'), [
  'tax',
  'price + tax',
  '(price + tax)',
  '(price + tax) * 2',
  '${(price + tax) * 2}',
  '<div class="a">${(price + tax) * 2}</div>'
]);
assert.deepStrictEqual(expand('<a href="/x/${i|d}" class="b">link</a>'), [
  'id',
  '${id}',
  '/x/${id}',
  '"/x/${id}"',
  'href="/x/${id}"',
  '<a href="/x/${id}" class="b">',
  '<a href="/x/${id}" class="b">link</a>'
]);
assert.deepStrictEqual(expand('<#assign greeting = "Hello ${na|me}!">'), [
  'name',
  '${name}',
  'Hello ${name}!',
  '"Hello ${name}!"',
  'greeting = "Hello ${name}!"',
  '<#assign greeting = "Hello ${name}!">'
]);
// Words are left to the editor.
assert.deepStrictEqual(expand('<#-- A no|te -->'), ['A note', '<#-- A note -->']);
assert.deepStrictEqual(expand('[#list items as it|em][@show value=item /][/#list]', { tagSyntax: 'squareBracket' }), [
  'item',
  'items as item',
  '[#list items as item]',
  '[#list items as item][@show value=item /][/#list]'
]);

console.log('Selection range tests passed.');
