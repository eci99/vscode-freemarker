const assert = require('assert');
const { toggleLineComments } = require('../comments');

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

console.log('Comment tests passed.');
