const assert = require('assert');
const { templateBlocks, validateTemplate } = require('../validator');

assert.deepStrictEqual(validateTemplate('<#if ready>\n${value}\n</#if>'), []);
assert.deepStrictEqual(validateTemplate('<#assign captured>text</#assign>'), []);
assert.deepStrictEqual(validateTemplate('<@panel>text</@panel>'), []);
assert.deepStrictEqual(validateTemplate('<#-- <#if hidden> -->\ntext'), []);

const unexpectedClose = validateTemplate('</#if>');
assert.strictEqual(unexpectedClose.length, 1);
assert(unexpectedClose[0].message.includes('Unexpected closing tag'));
assert.strictEqual(unexpectedClose[0].offset, 0);

const missingClose = validateTemplate('<#list items as item>\n${item}');
assert.strictEqual(missingClose.length, 1);
assert(missingClose[0].message.includes('Unclosed directive <#list>'));

const mismatchedClose = validateTemplate('<#if ready>\n</#list>');
assert.strictEqual(mismatchedClose.length, 2);
assert(mismatchedClose[0].message.includes('does not match the open'));
assert(mismatchedClose[1].message.includes('Unclosed directive <#if>'));

assert.deepStrictEqual(validateTemplate('${name?upper_case} ${name?upperCase} ${name??} ${name!?size}'), []);
assert.deepStrictEqual(validateTemplate('<#if name?has_content && items?size gt 0>${amount?string.currency}</#if>'), []);
assert.deepStrictEqual(validateTemplate('<a href="page?unknown=1">${"a?unknown"}</a> <#-- ${name?unknown} -->'), []);

const unknownBuiltin = validateTemplate('line\n${name?uper_case}');
assert.strictEqual(unknownBuiltin.length, 1);
assert.strictEqual(unknownBuiltin[0].message, 'Unknown built-in ?uper_case. Did you mean ?upper_case?');
assert.strictEqual(unknownBuiltin[0].offset, 12);
assert.strictEqual(unknownBuiltin[0].length, 9);

const unknownInTags = validateTemplate('<#if name?is_defined><@panel title=name?json /></#if>');
assert.deepStrictEqual(unknownInTags.map((issue) => issue.message), [
  'Unknown built-in ?is_defined.',
  'Unknown built-in ?json.'
]);
assert.strictEqual(validateTemplate('${a?foo(b?bar)}').length, 2);

for (const valid of [
  '<#list items as item>${item}<#sep>, </#list>',
  '<#list items as item>${item}<#sep>, </#sep></#list>',
  '<#list items><#items as item>${item}<#sep>, </#items><#else>none</#list>',
  '<#if ready><#list items as item><#if item.last>.<#sep>, </#if></#list></#if>',
  '<#attempt>${risky}<#recover>failed</#attempt>',
  '<#attempt>${risky}<#recover>failed</#recover></#attempt>',
  '<#visit node><#recurse>',
  '<#macro box><#local body>text</#local><#global shared>text</#global></#macro>',
  '<#assign counter++><#assign total += 1>',
  '<#assign title in page>text</#assign>',
  '<#if a>1<#elseif b>2<#else>3</#if>',
  '<#switch kind><#case 1>one<#break><#on 2, 3>more<#default>other</#switch>',
  '<#noparse><#if open>${name?not_checked}</#noparse>'
]) {
  assert.deepStrictEqual(validateTemplate(valid), [], valid);
}

assert.deepStrictEqual(validateTemplate('<#else>').map((issue) => issue.message), [
  '<#else> must be directly inside <#if> or <#list>.'
]);
assert.deepStrictEqual(validateTemplate('<#if a><@box><#else></@box></#if>').map((issue) => issue.message), [
  '<#else> must be directly inside <#if> or <#list>.'
]);
assert.deepStrictEqual(validateTemplate('<#list items as item><#elseif b></#list>').map((issue) => issue.message), [
  '<#elseif> must be directly inside <#if>.'
]);
assert.deepStrictEqual(validateTemplate('<#case 1><#recover>').map((issue) => issue.message), [
  '<#case> must be directly inside <#switch>.',
  '<#recover> must be directly inside <#attempt>.'
]);
assert.deepStrictEqual(validateTemplate('<#noparse><#if open>').map((issue) => issue.message), [
  'Unclosed directive <#if>.',
  'Unclosed directive <#noparse>.'
]);

const { blocks, unclosed } = templateBlocks('<#if a>\n<#else>\n</#if>\n<#list items as item><@box>');
assert.deepStrictEqual(blocks.map((block) => [block.name, block.open.offset, block.close.offset, block.branches.length]), [
  ['if', 0, 16, 1]
]);
assert.strictEqual(blocks[0].open.nameLength, '<#if'.length);
assert.strictEqual(blocks[0].close.nameLength, '</#if'.length);
assert.deepStrictEqual(unclosed.map((block) => block.name), ['list', 'box']);

console.log('Template validator tests passed.');