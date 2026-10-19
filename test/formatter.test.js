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

assert.strictEqual(
  formatTemplate('[#if a > b]\n<ul>\n[#list items as item]\n<li>${item}</li>\n[/#list]\n</ul>\n[#else]\n[@box]\nnone\n[/@box]\n[/#if]', { tabSize: 2 }),
  '[#if a > b]\n  <ul>\n    [#list items as item]\n      <li>${item}</li>\n    [/#list]\n  </ul>\n[#else]\n  [@box]\n    none\n  [/@box]\n[/#if]'
);
assert.strictEqual(
  formatTemplate('[#if a]\n[#-- @formatter:off --]\n      kept\n[#-- @formatter:on --]\n[/#if]', { tabSize: 2 }),
  '[#if a]\n[#-- @formatter:off --]\n      kept\n[#-- @formatter:on --]\n[/#if]'
);

// HTML elements are indented like FreeMarker blocks
const formatLines = (lines) => formatTemplate(lines.join('\n'), { tabSize: 2 }).split('\n');
assert.deepStrictEqual(formatLines([
  '<div class="a">',
  '<p>one line <b>stays</b> as it is</p>',
  '<ul>',
  '<#list items as item>',
  '<li><a href="${item.url}">${item.name}</a></li>',
  '</#list>',
  '</ul>',
  '<img src="a.png">',
  '<br />',
  '<span>text',
  'more</span>',
  '</div>'
]), [
  '<div class="a">',
  '  <p>one line <b>stays</b> as it is</p>',
  '  <ul>',
  '    <#list items as item>',
  '      <li><a href="${item.url}">${item.name}</a></li>',
  '    </#list>',
  '  </ul>',
  '  <img src="a.png">',
  '  <br />',
  '  <span>text',
  '    more</span>',
  '</div>'
]);
// An element without an end tag does not indent what follows.
assert.deepStrictEqual(formatLines(['<ul>', '<li>one', '<li>two', '</ul>', '<p>text', '<div>', 'body', '</div>']), [
  '<ul>', '  <li>one', '  <li>two', '</ul>', '<p>text', '<div>', '  body', '</div>'
]);
assert.deepStrictEqual(formatLines(['<div', 'class="a">', 'text', '</div>', '<!-- <div> -->', 'text']), [
  '<div', '  class="a">', '  text', '</div>', '<!-- <div> -->', 'text'
]);
assert.deepStrictEqual(formatLines([
  '<div>',
  '      <script>',
  '      if (a < b) {',
  '        run("<div>");',
  '      }',
  '      </script>',
  '<pre>',
  '   kept',
  ' </pre>',
  '<textarea>',
  '    kept</textarea>',
  '</div>'
]), [
  '<div>',
  '  <script>',
  '    if (a < b) {',
  '      run("<div>");',
  '    }',
  '  </script>',
  '  <pre>',
  '   kept',
  ' </pre>',
  '  <textarea>',
  '    kept</textarea>',
  '</div>'
]);

// A tag that spans several lines
assert.deepStrictEqual(formatLines([
  '<div>',
  '<#macro card',
  'title',
  'size=1>',
  '<p>${title}</p>',
  '</#macro>',
  '<#macro box',
  'label',
  '>',
  '<@card',
  'title=label',
  '/>',
  '<@card title=label',
  'size=2>',
  'body',
  '</@card>',
  '</#macro>',
  '<#assign',
  'value = 1>',
  'text',
  '</div>'
]), [
  '<div>',
  '  <#macro card',
  '    title',
  '    size=1>',
  '    <p>${title}</p>',
  '  </#macro>',
  '  <#macro box',
  '    label',
  '  >',
  '    <@card',
  '      title=label',
  '    />',
  '    <@card title=label',
  '      size=2>',
  '      body',
  '    </@card>',
  '  </#macro>',
  '  <#assign',
  '    value = 1>',
  '  text',
  '</div>'
]);
assert.deepStrictEqual(
  formatTemplate('[#macro card\ntitle\nsize=1]\ntext\n[/#macro]', { tabSize: 2 }).split('\n'),
  ['[#macro card', '  title', '  size=1]', '  text', '[/#macro]']
);

// Comments that fill whole lines start at the beginning of the line
assert.deepStrictEqual(
  formatLines(['<#if a>', '<div>', '<#-- whole line -->', 'x <#-- trailing -->', '<#-- multi', '   line', '  comment -->', '</div>', '</#if>']),
  ['<#if a>', '  <div>', '<#-- whole line -->', '    x <#-- trailing -->', '<#-- multi', '   line', '  comment -->', '  </div>', '</#if>']
);

// The capture form of assign, local, and global is a block
assert.deepStrictEqual(
  formatLines(['<#macro block>', '<#local inhalt>', '<#nested>', '</#local>', '<#assign x = 1>', '</#macro>']),
  ['<#macro block>', '  <#local inhalt>', '    <#nested>', '  </#local>', '  <#assign x = 1>', '</#macro>']
);

// Text over several lines is indented by one level, also with several tags opened on its first line
assert.deepStrictEqual(
  formatLines(['<#if a>', '<p>Text with <b>bold', 'text</b> and more', 'text here.</p>', '</#if>']),
  ['<#if a>', '  <p>Text with <b>bold', '    text</b> and more', '    text here.</p>', '</#if>']
);
assert.deepStrictEqual(formatLines(['<div><div>', 'content', '</div></div>']), ['<div><div>', '  content', '</div></div>']);
assert.deepStrictEqual(
  formatLines(['<#if a><#list xs as x>', '${x}', '</#list></#if>']),
  ['<#if a><#list xs as x>', '  ${x}', '</#list></#if>']
);
assert.deepStrictEqual(formatLines(['<tr>', '<td>a', '</td><td>b', '</td>', '</tr>']), ['<tr>', '  <td>a', '  </td><td>b', '  </td>', '</tr>']);

// An interpolation over several lines is continued like a tag
assert.deepStrictEqual(
  formatLines(['<#if a>', '${message(', '"key",', 'user.name)}', '${x(', '1', ')}', '${a +', 'b}', '</#if>']),
  ['<#if a>', '  ${message(', '    "key",', '    user.name)}', '  ${x(', '    1', '  )}', '  ${a +', '    b}', '</#if>']
);
assert.deepStrictEqual(
  formatLines(['<div>', '<p title="${t(', '1)}">x</p>', '</div>']),
  ['<div>', '  <p title="${t(', '    1)}">x</p>', '</div>']
);

// The lines of a string keep their spaces, which are part of its value
assert.deepStrictEqual(
  formatLines(['<#if a>', '<#assign text = "Line one', '   line two">', '<@m text="a', 'b" />', '</#if>']),
  ['<#if a>', '  <#assign text = "Line one', '   line two">', '  <@m text="a', 'b" />', '</#if>']
);
assert.deepStrictEqual(
  formatTemplate('[#if a]\n[#assign t = "x\n  y"]\n[/#if]', { tabSize: 2 }).split('\n'),
  ['[#if a]', '  [#assign t = "x', '  y"]', '[/#if]']
);

console.log('Formatter tests passed.');