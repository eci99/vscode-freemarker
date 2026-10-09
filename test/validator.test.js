const assert = require('assert');
const { validateTemplate } = require('../validator');

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

console.log('Template validator tests passed.');