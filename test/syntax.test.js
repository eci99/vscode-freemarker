const assert = require('assert');
const { displayText, normalizeTemplate, resolveTagSyntax, toSquareBracketTags } = require('../syntax');

assert.strictEqual(resolveTagSyntax('<p>[#if a]x[/#if]</p>'), 'square');
assert.strictEqual(resolveTagSyntax('<p><#if a>x</#if> [#if]</p>'), 'angle');
assert.strictEqual(resolveTagSyntax('<p>[#-- note --]<#if a></#if>'), 'square');
assert.strictEqual(resolveTagSyntax('<p>${items[0]} [@box /]'), 'square');
assert.strictEqual(resolveTagSyntax('<p>plain</p>'), 'angle');
assert.strictEqual(resolveTagSyntax('[#'), 'square');
assert.strictEqual(resolveTagSyntax('<#if a></#if>', 'squareBracket'), 'square');
assert.strictEqual(resolveTagSyntax('[#if a][/#if]', 'angleBracket'), 'angle');
assert.strictEqual(resolveTagSyntax('  [#ftl]<#if a>', 'angleBracket'), 'square');
assert.strictEqual(resolveTagSyntax('<#ftl output_format="HTML">[#if a]', 'squareBracket'), 'angle');

const normalize = (text, options) => normalizeTemplate(text, options).text
  .replace(/\uE000/g, ' GT ')
  .replace(/[\uE001-\uE003]/g, '~');
const unchanged = '<#if a > b>${a}</#if> [#if] [=a]';
assert.strictEqual(normalizeTemplate(unchanged).text, unchanged);
assert.strictEqual(normalizeTemplate(unchanged).tagSyntax, 'angle');

for (const [square, angle] of [
  ['[#if a]x[#else]y[/#if]', '<#if a>x<#else>y</#if>'],
  ['[@box title="a]b" /]', '<@box title="a]b" />'],
  ['[@ns.box]x[/@ns.box]', '<@ns.box>x</@ns.box>'],
  ['[#if items[0] == map["k"][1]]x[/#if]', '<#if items[0] == map["k"][1]>x</#if>'],
  ['[#assign list = [1, [2, 3]]]', '<#assign list = [1, [2, 3]]>'],
  ['[#-- a [#if] --]x', '<#-- a [#if] -->x'],
  ['[#list xs as x]${x}[#sep], [/#list]', '<#list xs as x>${x}<#sep>, </#list>'],
  ['[#if a]${items[0]}[/#if] [not a tag]', '<#if a>${items[0]}</#if> [not a tag]']
]) {
  const result = normalizeTemplate(square);
  assert.strictEqual(result.text, angle, square);
  assert.strictEqual(result.text.length, square.length);
  assert.strictEqual(result.tagSyntax, 'square');
}

// `>` is an operator inside a square bracket tag, and angle bracket tags are static text.
assert.strictEqual(normalize('[#if a > b && c >= d]x[/#if]'), '<#if a  GT  b && c  GT = d>x</#if>');
assert.strictEqual(displayText(normalizeTemplate('[=a] ${b} #{c}', { interpolationSyntax: 'squareBracket' }).text), '${a} ${b} #{c}');
assert.strictEqual(normalize('[#if a]<#if b></#if>[/#if]'), '<#if a>~#if b>~/#if></#if>');
assert.strictEqual(displayText(normalizeTemplate('[#if a > b]<@x/>[/#if]').text), '<#if a > b><@x/></#if>');
// An unfinished tag does not swallow the tags after it.
assert.strictEqual(normalizeTemplate('[#if a\n[#list xs as x][/#list]').text, '<#if a\n<#list xs as x></#list>');
assert.strictEqual(normalizeTemplate('[#if a][/#').text, '<#if a></#');
assert.strictEqual(normalize('[#if total(a > 1, \n<b>[#if b > 1]'), '<#if total(a  GT  1, \n<b><#if b  GT  1>');

const squareInterpolation = { interpolationSyntax: 'squareBracket' };
assert.strictEqual(normalize('[=user.name] ${a} #{b}', squareInterpolation), '${user.name} ~{a} ~{b}');
assert.strictEqual(normalizeTemplate('[=items[0]["a]"]]', squareInterpolation).text, '${items[0]["a]"]}');
assert.strictEqual(normalizeTemplate('<#if a>[=a]</#if>', squareInterpolation).tagSyntax, 'angle');
assert.strictEqual(normalizeTemplate('[#if a][=a][/#if]', squareInterpolation).text, '<#if a>${a}</#if>');
assert.strictEqual(normalizeTemplate('[=name', squareInterpolation).text, '${name');
assert.strictEqual(normalize('${a} #{b}', { interpolationSyntax: 'dollar' }), '${a} ~{b}');
assert.strictEqual(normalizeTemplate('[=a]').text, '[=a]');

assert.strictEqual(toSquareBracketTags('<#if condition>...<#else>...</#if>'), '[#if condition]...[#else]...[/#if]');
assert.strictEqual(toSquareBracketTags('<#assign ${1:name} = ${2:value}/>'), '[#assign ${1:name} = ${2:value}/]');
assert.strictEqual(toSquareBracketTags('<#--\n\t$0\n-->'), '[#--\n\t$0\n--]');
assert.strictEqual(toSquareBracketTags('Called with `<@name ...>`.'), 'Called with `[@name ...]`.');

const grammar = require('../syntaxes/freemarker.tmLanguage.json');
for (const [rule, text, matched] of [
  ['squareDirective', '[#if a]', '[#if'],
  ['squareDirective', '[/#list]', '[/#list'],
  ['squareUserDirective', '[@ns.box /]', '[@ns.box'],
  ['squareInterpolation', '[=name]', '[='],
  ['squareComment', '[#-- note --]', '[#--']
]) {
  assert(grammar.patterns.some((pattern) => pattern.include === `#${rule}`), rule);
  assert.strictEqual(new RegExp(grammar.repository[rule].begin).exec(text)[0], matched);
  assert(new RegExp(grammar.repository[rule].end).test(text));
}
assert.strictEqual(new RegExp(grammar.repository.squareDirective.begin).exec('items[0]'), null);

console.log('Syntax tests passed.');
