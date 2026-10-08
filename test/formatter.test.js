const assert = require('assert');
const { formatTemplate } = require('../formatter');

const input = [
  '<#if ready>',
  '<p>Ready</p>',
  '<#list items as item>',
  '${item}',
  '</#list>',
  '<#else>',
  '<p>Waiting</p>',
  '</#if>'
].join('\n');

const expected = [
  '<#if ready>',
  '    <p>Ready</p>',
  '    <#list items as item>',
  '        ${item}',
  '    </#list>',
  '<#else>',
  '    <p>Waiting</p>',
  '</#if>'
].join('\n');

assert.strictEqual(formatTemplate(input), expected);
assert.strictEqual(formatTemplate('<#if x>\n\tA\n</#if>', { tabSize: 2 }), '<#if x>\n  A\n</#if>');
assert.strictEqual(formatTemplate('<#if x>\r\nA\r\n</#if>', { insertSpaces: false }), '<#if x>\r\n\tA\r\n</#if>');
assert.strictEqual(formatTemplate('<@panel>\nBody\n</@panel>'), '<@panel>\n    Body\n</@panel>');
assert.strictEqual(formatTemplate([
  '<#if ready>',
  '<#-- @formatter:off -->',
  '      <#list items as item>',
  ' raw ${item}',
  '      </#list>',
  '<#-- @formatter:on -->',
  '<p>Ready</p>',
  '</#if>'
].join('\n')), [
  '<#if ready>',
  '<#-- @formatter:off -->',
  '      <#list items as item>',
  ' raw ${item}',
  '      </#list>',
  '<#-- @formatter:on -->',
  '    <p>Ready</p>',
  '</#if>'
].join('\n'));
assert.strictEqual(formatTemplate('  <!-- @formatter:off -->\n    text\n<!-- @formatter:on -->\ntext'),
  '  <!-- @formatter:off -->\n    text\n<!-- @formatter:on -->\ntext');
assert.strictEqual(formatTemplate('<#-- @formatter:off -->\n  text\n"@formatter:on"\n  more\n<#-- @formatter:on -->\ntext'),
  '<#-- @formatter:off -->\n  text\n"@formatter:on"\n  more\n<#-- @formatter:on -->\ntext');

console.log('Formatter tests passed.');