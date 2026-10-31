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

// An end tag goes on a line of its own when its start tag is alone on its line
assert.deepStrictEqual(formatLines(['<#if x>', 'text</#if>']), ['<#if x>', '  text', '</#if>']);
assert.deepStrictEqual(formatLines(['<@box title="a">', 'body  </@box>']), ['<@box title="a">', '  body', '</@box>']);
assert.deepStrictEqual(formatLines(['<div>', '<p>', 'x</p></div>']), ['<div>', '  <p>', '    x', '  </p>', '</div>']);
assert.strictEqual(formatTemplate('[#if x]\r\ntext[/#if]', { tabSize: 2 }), '[#if x]\r\n  text\r\n[/#if]');
// Not if that would change the output, nor in <pre> and between @formatter:off and on
for (const lines of [
  ['<#if x>', 'text</#if> more'],
  ['<#list xs as x>', '${x}<#sep>, </#list>'],
  ['<#macro m>', 'body</#macro>'],
  ['<#assign x>', 'value</#assign>'],
  ['<span>text', 'more</span>'],
  ['<pre>', 'a</pre>'],
  ['<#-- @formatter:off -->', '<#if x>', 'text</#if>', '<#-- @formatter:on -->']
]) {
  assert.strictEqual(formatLines(lines).length, lines.length, lines.join('\n'));
}

console.log('Formatter tests passed.');
// Long tags are broken only when the switch is on
{
  const named = Array.from({ length: 12 }, (_, index) => `attr${index}=value${index}.something`).join(' ');
  const long = `<@box title="a long title" ${named} />`;
  const condition = Array.from({ length: 14 }, (_, index) => `item${index}.flag == 1`).join(' && ');
  const parameters = Array.from({ length: 20 }, (_, index) => `param${index}Name`).join(' ');
  const template = `<#if x>\n${long}\n<#if ${condition}>y</#if>\n<#macro m ${parameters}>z</#macro>\n</#if>`;
  assert.strictEqual(formatTemplate(template), formatTemplate(template, { wrapLongLines: false }));
  const wrapped = formatTemplate(template, { wrapLongLines: true });
  const lines = wrapped.split('\n');
  assert(lines.every((line) => line.length <= 160));
  assert(lines.length > template.split('\n').length);
  assert(lines.some((line) => line.startsWith('        && item')));
  // Only whitespace changes, the formatting stays as it is when it is repeated
  assert.strictEqual(wrapped.replace(/\s+/g, ' '), formatTemplate(template).replace(/\s+/g, ' '));
  assert.strictEqual(formatTemplate(wrapped, { wrapLongLines: true }), wrapped);
  assert.strictEqual(formatTemplate(template, { wrapLongLines: true, wrapLineLength: 400 }), formatTemplate(template));

  // Square brackets, strings, comments, formatter:off and text that is not a tag stay as they are
  const square = `[@box title="a long, long title with  spaces" ${named}/]`;
  const wrappedSquare = formatTemplate(square, { wrapLongLines: true });
  assert(wrappedSquare.startsWith('[@box title="a long, long title with  spaces" attr0'));
  assert(wrappedSquare.endsWith('attr11=value11.something/]'));
  const untouched = [
    `<#-- ${long} -->`,
    `<p>${'word '.repeat(50)}</p>`,
    `<#assign x = "${'a b '.repeat(60)}">`,
    `<pre>\n${long}\n</pre>`,
    `<#-- @formatter:off -->\n${long}\n<#-- @formatter:on -->`
  ].join('\n');
  assert.strictEqual(formatTemplate(untouched, { wrapLongLines: true }), formatTemplate(untouched));
  assert.strictEqual(formatTemplate(`${long}\r\n<p/>`, { wrapLongLines: true }).split('\r\n').length, 4);
}

// Interpolations and tags that are not closed do not make formatting scan to the end for each.
for (const unit of ['${', '<#a', '<#if (', '<#--', '<#--${']) {
  const text = unit.repeat(100000);
  const start = Date.now();
  assert.strictEqual(formatTemplate(text), text);
  assert(Date.now() - start < 2000, unit);
}
