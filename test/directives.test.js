const assert = require('assert');
const grammar = require('../syntaxes/freemarker.tmLanguage.json');
const {
  BRANCH_PARENTS,
  DIRECTIVES,
  SPECIAL_VARIABLES,
  findDirective,
  findSpecialVariable,
  specialVariableGrammarPattern,
  specialVariableNameStart
} = require('../directives');

const directiveNames = DIRECTIVES.map((directive) => directive.name);
assert.strictEqual(new Set(directiveNames).size, directiveNames.length);
assert(DIRECTIVES.every((directive) => directive.syntax.startsWith(`<#${directive.name}`) && directive.description));
assert(DIRECTIVES.every((directive) => [undefined, 'required', 'optional', 'capture'].includes(directive.block)));
assert.strictEqual(findDirective('list').block, 'required');
assert.strictEqual(findDirective('LIST'), findDirective('list'));
assert.strictEqual(findDirective('sep').block, 'optional');
assert.strictEqual(findDirective('assign').block, 'capture');
assert.strictEqual(findDirective('include').block, undefined);
assert.strictEqual(findDirective('foreach').deprecated, true);
assert.strictEqual(findDirective('unknown'), undefined);
for (const [name, parents] of Object.entries(BRANCH_PARENTS)) {
  assert(findDirective(name), name);
  assert(parents.every((parent) => findDirective(parent).block === 'required'), name);
}

const variableNames = SPECIAL_VARIABLES.map((variable) => variable.name);
assert.strictEqual(new Set(variableNames).size, variableNames.length);
assert(findSpecialVariable('now'));
assert(findSpecialVariable('current_node'));

const numberRule = grammar.repository.expression.patterns
  .find((pattern) => pattern.name === 'constant.numeric.freemarker');
for (const literal of ['0xFF', '0XcafeBABE', '008', '5.013']) {
  assert.strictEqual(new RegExp(numberRule.match).exec(`\${${literal}}`)[0], literal);
}
assert.strictEqual(findSpecialVariable('mainTemplateName'), findSpecialVariable('main_template_name'));
assert.strictEqual(findSpecialVariable('unknown'), undefined);

assert.strictEqual(specialVariableNameStart('${.'), 3);
assert.strictEqual(specialVariableNameStart('${.no'), 3);
assert.strictEqual(specialVariableNameStart('.'), 1);
assert.strictEqual(specialVariableNameStart('<#if a && .no'), 11);
assert.strictEqual(specialVariableNameStart('${user.'), -1);
assert.strictEqual(specialVariableNameStart('${items[0].'), -1);
assert.strictEqual(specialVariableNameStart('${load().'), -1);
assert.strictEqual(specialVariableNameStart('${1.'), -1);
assert.strictEqual(specialVariableNameStart('${1..'), -1);

const grammarRule = grammar.repository.expression.patterns
  .find((pattern) => pattern.name === 'variable.language.freemarker');
assert.strictEqual(grammarRule.match, specialVariableGrammarPattern());
const patterns = grammar.repository.expression.patterns.map((pattern) => pattern.name);
assert(patterns.indexOf('variable.language.freemarker') < patterns.indexOf('variable.other.freemarker'));
const highlighted = new RegExp(grammarRule.match);
assert.strictEqual(highlighted.exec('${.now}')[1], 'now');
assert.strictEqual(highlighted.exec('${.currentTemplateName}')[1], 'currentTemplateName');
assert.strictEqual(highlighted.exec('${user.now}'), null);
assert.strictEqual(highlighted.exec('${.nowhere}'), null);

console.log('Directive tests passed.');
