const assert = require('assert');
const {
  INTERPOLATION_SCAN, TAG_SCAN, displayText, interpolationEnd, normalizeTemplate, repeatedScan, resolveTagSyntax, scanEnds,
  toSquareBracketTags
} = require('../syntax');

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

// HTML tags in strings: a lone quote is plain text, a quote pair may hide `<` and `>`.
for (const [rule, text, matched] of [
  ['stringHtmlTagDouble', '<a title=\\"don\'t\\">', '<a title=\\"don\'t\\">'],
  ['stringHtmlTagDouble', '<img alt=\\"it\'s\\" />', '<img alt=\\"it\'s\\" />'],
  ['stringHtmlTagDouble', '<p class=it\'s>', '<p class=it\'s>'],
  ['stringHtmlTagDouble', '<a title=\\"don\'t\\">x</a> and \'y\'', '<a title=\\"don\'t\\">'],
  ['stringHtmlTagDouble', '<a title=\'x>y\'>', '<a title=\'x>'],
  ['stringHtmlTagDouble', '<a title=\'<b>\'>', '<a title=\'<b>\'>'],
  ['stringHtmlTagDouble', '<a title=don\'t x=\'<b>\'>', '<a title=don\'t x=\'<b>\'>'],
  ['stringHtmlTagDouble', '<a\'\'<>', null],
  ['stringHtmlTagSingle', '<a title=x"y>', '<a title=x"y>'],
  ['stringHtmlTagSingle', '<a title="x>y">', '<a title="x>'],
  ['stringHtmlTagSingle', '<a title="<b>">', '<a title="<b>">'],
  ['stringHtmlTagSingle', '<a title=\\\'x>y\\\'>', '<a title=\\\'x>']
]) {
  const match = new RegExp(grammar.repository[rule].match).exec(text);
  assert.strictEqual(match && match[0], matched, text);
}
// A long run of quotes that cannot close the tag fails fast instead of trying every way to pair them.
for (const [rule, quote] of [['stringHtmlTagDouble', '\''], ['stringHtmlTagSingle', '"']]) {
  const start = Date.now();
  assert(!new RegExp(grammar.repository[rule].match).test(`<a${quote.repeat(2000)}<>`.repeat(10)), rule);
  assert(Date.now() - start < 1000, rule);
}

// scanEnds finds, from every offset, what a scan for the end of a tag or interpolation finds.
{
  const tag = 'a "x>" (b > c) >\'d\\\'>\' > r"e\\" >';
  const ends = scanEnds(tag, TAG_SCAN, true);
  // A > in a string or in parentheses is skipped, an escaped quote does not end a string.
  assert.deepStrictEqual([0, 2, 7, 16].map((start) => ends[start]), [15, 15, 15, 23]);
  // In r"e\" the backslash is a plain character.
  assert.strictEqual(ends[25], 31);
  assert.strictEqual(scanEnds(tag, TAG_SCAN, false)[25], -1);
  const interpolation = 'a {b} "}" c} d {';
  assert.deepStrictEqual([0, 3, 12, 14].map((start) => scanEnds(interpolation, INTERPOLATION_SCAN)[start]), [11, 4, -1, -1]);
  let calls = 0;
  const text = '${'.repeat(1000);
  const end = repeatedScan(text, (scanned, start) => { calls += 1; return interpolationEnd(scanned, start); }, INTERPOLATION_SCAN, true);
  for (let start = 2; start < text.length; start += 2) assert.strictEqual(end(start), -1);
  assert(calls < 10);
}

console.log('Syntax tests passed.');
