const assert = require('assert');
const { toggleBlockComment, toggleLineComments } = require('../comments');

assert.deepStrictEqual(toggleLineComments(['<p>text</p>']), ['<#-- <p>text</p> -->']);
assert.deepStrictEqual(toggleLineComments(['<#-- <p>text</p> -->']), ['<p>text</p>']);
assert.deepStrictEqual(
  toggleLineComments(['  <#if a>', '    ${b}  ', '', '  </#if>']),
  ['<#--   <#if a> -->', '<#--     ${b} -->', '', '<#--   </#if> -->']
);
assert.deepStrictEqual(
  toggleLineComments(['<#--   <#if a> -->', '<#--     ${b} -->', '', '<#--   </#if> -->']),
  ['  <#if a>', '    ${b}', '', '  </#if>']
);
// A line that is not a comment yet makes the whole selection a comment.
assert.deepStrictEqual(
  toggleLineComments(['<#-- a -->', 'b']),
  ['<#-- <#-- a --> -->', '<#-- b -->']
);
assert.deepStrictEqual(toggleLineComments(['<#--a-->', '\t<#-- b-->']), ['a', '\tb']);
assert.deepStrictEqual(toggleLineComments(['<#-- a --> b']), ['<#-- <#-- a --> b -->']);
assert.deepStrictEqual(toggleLineComments(['', '  ']), ['<#--  -->', '<#--  -->']);
assert.deepStrictEqual(toggleLineComments(['[#if a]', '[/#if]'], 'square'), ['[#-- [#if a] --]', '[#-- [/#if] --]']);
assert.deepStrictEqual(toggleLineComments(['[#-- [#if a] --]'], 'square'), ['[#if a]']);

const blockComment = (marked, tagSyntax) => {
  const start = marked.indexOf('|');
  const end = marked.lastIndexOf('|') - (marked.indexOf('|') === marked.lastIndexOf('|') ? 0 : 1);
  const text = marked.replace(/\|/g, '');
  const edit = toggleBlockComment(text, start, end, tagSyntax);
  const result = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  const selection = [edit.selectionStart, edit.selectionEnd];
  return result.slice(0, selection[0]) + '|' + result.slice(selection[0], selection[1]) + (selection[1] > selection[0] ? '|' : '') + result.slice(selection[1]);
};
assert.strictEqual(blockComment('a |<p>b</p>| c'), 'a <#-- |<p>b</p>| --> c');
assert.strictEqual(blockComment('a |<p>b</p>| c', 'square'), 'a [#-- |<p>b</p>| --] c');
assert.strictEqual(blockComment('a | c'), 'a <#-- | --> c');
assert.strictEqual(blockComment('a [#-- | --] c', 'square'), 'a | c');
// The comment the selection is in, or that it consists of, is taken away.
assert.strictEqual(blockComment('a <#-- <p>|b|</p> --> c'), 'a |<p>b</p>| c');
assert.strictEqual(blockComment('a | <#-- b --> | c'), 'a  |b|  c');
assert.strictEqual(blockComment('a |[#--b--]| c', 'square'), 'a |b| c');
// A comment that ended before the selection is not the one it is in.
assert.strictEqual(blockComment('<#-- a --> |b|'), '<#-- a --> <#-- |b| -->');
assert.strictEqual(blockComment('<#-- a --> |b|', 'square'), '<#-- a --> [#-- |b| --]');

console.log('Comment tests passed.');
