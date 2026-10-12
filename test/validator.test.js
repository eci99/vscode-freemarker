const assert = require('assert');
const { htmlTags, templateBlocks, validateTemplate } = require('../validator');

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

assert.deepStrictEqual(validateTemplate('${text?dedent?indent("  ")?wrap(0x50)?lines?size} ${name?empty_to_null!"-"}'), []);

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

// Square bracket syntax
for (const valid of [
  '[#if a > b]${value}[#else]none[/#if]',
  '[#list items as item][@box title=item?upper_case /][#sep], [/#list]',
  '[#assign names = ["a", "b"]][#-- [#if open] --]',
  '[#if a]<#if not a tag>[/#if]',
  '[#noparse][#if open][/#noparse]'
]) {
  assert.deepStrictEqual(validateTemplate(valid), [], valid);
}
assert.deepStrictEqual(validateTemplate('[#if a]\n[/#list]').map((issue) => [issue.message, issue.offset, issue.length]), [
  ['Closing tag [/#list] does not match the open [#if] block.', 8, 8],
  ['Unclosed directive [#if].', 0, 7]
]);
assert.deepStrictEqual(validateTemplate('[#list xs as x][#elseif a][/#list]').map((issue) => issue.message), [
  '[#elseif] must be directly inside [#if].'
]);
assert.deepStrictEqual(validateTemplate('[@box]${name?uper_case}').map((issue) => issue.message), [
  'Unclosed macro [@box].',
  'Unknown built-in ?uper_case. Did you mean ?upper_case?'
]);
assert.deepStrictEqual(
  validateTemplate('<#if a>[=name?uper_case]${name?not_checked}</#if>', { interpolationSyntax: 'squareBracket' })
    .map((issue) => [issue.message, issue.offset]),
  [['Unknown built-in ?uper_case. Did you mean ?upper_case?', 14]]
);
assert.deepStrictEqual(validateTemplate('[#if a][/#if]', { tagSyntax: 'angleBracket' }), []);
assert.deepStrictEqual(validateTemplate('<#if a>', { tagSyntax: 'squareBracket' }), []);

// HTML tags
const htmlIssues = (text, options) => validateTemplate(text, options).map((issue) => [issue.message, issue.offset, issue.length]);
for (const valid of [
  '<div class="a"><span>text</span><br><img src="a.png"><input /></div>',
  '<DIV>text</div>',
  '<!-- <div> --><#-- <div> -->${"<div>"}<#assign open = "<div>">',
  '<script>if (a < b && c<d) { render("<div>"); }</script><style>a > b {}</style>',
  '<div <#if active>class="active"</#if> title="a>b">text</div>',
  '<#if wrap><div></#if>text<#if wrap></div></#if>',
  '<#macro open><section></#macro><#macro close></section></#macro>'
]) {
  assert.deepStrictEqual(htmlIssues(valid), [], valid);
}
assert.deepStrictEqual(htmlIssues('<div>\n<span>text</span>'), [['Unclosed HTML tag <div>.', 0, 4]]);
assert.deepStrictEqual(htmlIssues('<div><span class="a">text</div>'), [['Unclosed HTML tag <span>.', 5, 5]]);
assert.deepStrictEqual(htmlIssues('<section><div>'), [
  ['Unclosed HTML tag <div>.', 9, 4],
  ['Unclosed HTML tag <section>.', 0, 8]
]);
assert.deepStrictEqual(htmlIssues('<#if wide><div class="wide"><#else><div></#if>text</div>'), [
  ['Unclosed HTML tag <div>.', 10, 4]
]);
assert.deepStrictEqual(htmlIssues('<#if wide><div class="wide"><#else><div></#if>text</div><#if wide></div></#if>'), []);
assert.deepStrictEqual(htmlIssues('<#if a><div>text</#if>'), [['Unclosed HTML tag <div>.', 7, 4]]);
assert.deepStrictEqual(htmlIssues('<script>let a = 1;'), [['Unclosed HTML tag <script>.', 0, 7]]);
assert.deepStrictEqual(htmlIssues('[#if a]<div>[#if b > 1]<span>[/#if][/#if]'), [
  ['Unclosed HTML tag <span>.', 23, 5],
  ['Unclosed HTML tag <div>.', 7, 4]
]);
assert.deepStrictEqual(
  validateTemplate('<ul><li>one<li>two</li></ul><p>text').map((issue) => [issue.message, issue.offset, issue.severity]),
  [['Unclosed HTML tag <li>.', 4, 'warning'], ['Unclosed HTML tag <p>.', 28, 'warning']]
);
assert.strictEqual(validateTemplate('<div>')[0].severity, 'warning');
assert.deepStrictEqual(
  validateTemplate('<p>text</p>\n</div >').map((issue) => [issue.message, issue.offset, issue.length, issue.severity]),
  [['Unexpected closing HTML tag </div>.', 12, 7, 'warning']]
);
assert.deepStrictEqual(htmlIssues('<div><#if early>text</div><#else>more</div></#if>'), [
  ['Unexpected closing HTML tag </div>.', 37, 6]
]);
assert.deepStrictEqual(htmlIssues('<div><span></div></span>'), [
  ['Unclosed HTML tag <span>.', 5, 5],
  ['Unexpected closing HTML tag </span>.', 17, 7]
]);
assert.deepStrictEqual(htmlIssues('</div>', { validateHtml: false }), []);
assert.deepStrictEqual(htmlIssues('<div>', { validateHtml: false }), []);
assert.deepStrictEqual(htmlTags('<ul><li>text').unclosed.map((tag) => tag.name), ['ul', 'li']);

console.log('Template validator tests passed.');