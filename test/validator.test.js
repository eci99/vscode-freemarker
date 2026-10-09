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

console.log('Template validator tests passed.');