const DEPRECATED = true;

// [name, category, parameters, description, deprecated]
// `parameters` is undefined for built-ins that are used without a call.
const rows = [
  // Strings
  ['blank_to_null', 'string', undefined, 'The string itself, or a missing value if it is empty or contains only whitespace.'],
  ['boolean', 'string', undefined, 'Converts the string `"true"` or `"false"` to a boolean.'],
  ['c_lower_case', 'string', undefined, 'Lower-case form for computer audiences, independent of the current locale.'],
  ['c_upper_case', 'string', undefined, 'Upper-case form for computer audiences, independent of the current locale.'],
  ['cap_first', 'string', undefined, 'The string with its very first word capitalized.'],
  ['capitalize', 'string', undefined, 'The string with all words capitalized.'],
  ['chop_linebreak', 'string', undefined, 'The string without the line-break at its end, if there was one.'],
  ['contains', 'string', 'substring', 'Whether the substring occurs in the string.'],
  ['ends_with', 'string', 'suffix', 'Whether the string ends with the given suffix.'],
  ['ensure_ends_with', 'string', 'suffix', 'Appends the suffix unless the string already ends with it.'],
  ['ensure_starts_with', 'string', 'prefix, substitution?, flags?', 'Prepends the prefix unless the string already starts with it.'],
  ['esc', 'string', undefined, 'Escapes the string with the current output format and returns markup output.'],
  ['groups', 'string', undefined, 'The regular expression groups of a `?matches` result, as a sequence.'],
  ['html', 'string', undefined, 'HTML-escapes the string. Use auto-escaping or `?esc` instead.', DEPRECATED],
  ['index_of', 'string', 'substring, fromIndex?', 'The index of the first occurrence of the substring, or -1.'],
  ['j_string', 'string', undefined, 'Escapes the string for use inside a Java string literal.'],
  ['js_string', 'string', undefined, 'Escapes the string for use inside a JavaScript string literal.'],
  ['json_string', 'string', undefined, 'Escapes the string for use inside a JSON string literal.'],
  ['keep_after', 'string', 'separator, flags?', 'The part after the first occurrence of the separator.'],
  ['keep_after_last', 'string', 'separator, flags?', 'The part after the last occurrence of the separator.'],
  ['keep_before', 'string', 'separator, flags?', 'The part before the first occurrence of the separator.'],
  ['keep_before_last', 'string', 'separator, flags?', 'The part before the last occurrence of the separator.'],
  ['last_index_of', 'string', 'substring, fromIndex?', 'The index of the last occurrence of the substring, or -1.'],
  ['left_pad', 'string', 'width, fill?', 'Pads the beginning of the string until it reaches the given width.'],
  ['length', 'string', undefined, 'The number of characters in the string.'],
  ['lower_case', 'string', undefined, 'The lower-case version of the string.'],
  ['matches', 'string', 'regex, flags?', 'Whether the whole string matches the regular expression. The result also lists the matches.'],
  ['no_esc', 'string', undefined, 'Marks the string as markup output so that it is not auto-escaped.'],
  ['number', 'string', undefined, 'Converts the string to a number.'],
  ['remove_beginning', 'string', 'prefix', 'Removes the prefix from the beginning of the string, if present.'],
  ['remove_ending', 'string', 'suffix', 'Removes the suffix from the end of the string, if present.'],
  ['replace', 'string', 'from, to, flags?', 'Replaces all occurrences of a substring or regular expression.'],
  ['right_pad', 'string', 'width, fill?', 'Pads the end of the string until it reaches the given width.'],
  ['rtf', 'string', undefined, 'Escapes the string for Rich Text Format output.', DEPRECATED],
  ['split', 'string', 'separator, flags?', 'Splits the string into a sequence of strings.'],
  ['starts_with', 'string', 'prefix', 'Whether the string starts with the given prefix.'],
  ['substring', 'string', 'from, toExclusive?', 'A substring. Use slicing such as `text[from..<toExclusive]` instead.', DEPRECATED],
  ['trim', 'string', undefined, 'The string without leading and trailing whitespace.'],
  ['trim_to_null', 'string', undefined, 'The trimmed string, or a missing value if nothing remains after trimming.'],
  ['truncate', 'string', 'maxLength, terminator?', 'Cuts the string to the given length, preferably at a word boundary, and appends a terminator.'],
  ['truncate_c', 'string', 'maxLength, terminator?', 'Like `?truncate`, but always cuts at a character boundary.'],
  ['truncate_c_m', 'string', 'maxLength, terminator?', 'Like `?truncate_c`, but returns markup output if the terminator is markup.'],
  ['truncate_m', 'string', 'maxLength, terminator?', 'Like `?truncate`, but returns markup output if the terminator is markup.'],
  ['truncate_w', 'string', 'maxLength, terminator?', 'Like `?truncate`, but always cuts at a word boundary.'],
  ['truncate_w_m', 'string', 'maxLength, terminator?', 'Like `?truncate_w`, but returns markup output if the terminator is markup.'],
  ['uncap_first', 'string', undefined, 'The string with its very first word un-capitalized.'],
  ['upper_case', 'string', undefined, 'The upper-case version of the string.'],
  ['url', 'string', 'charset?', 'URL-escapes the string, including `/`.'],
  ['url_path', 'string', 'charset?', 'URL-escapes the string but keeps `/` unescaped.'],
  ['web_safe', 'string', undefined, 'Same as `?html`. Use auto-escaping or `?esc` instead.', DEPRECATED],
  ['word_list', 'string', undefined, 'A sequence of the words in the string.'],
  ['xhtml', 'string', undefined, 'XHTML-escapes the string. Use auto-escaping or `?esc` instead.', DEPRECATED],
  ['xml', 'string', undefined, 'XML-escapes the string. Use auto-escaping or `?esc` instead.', DEPRECATED],

  // Numbers
  ['abs', 'number', undefined, 'The absolute value of the number.'],
  ['byte', 'number', undefined, 'Converts the number to a Java `byte`.'],
  ['ceiling', 'number', undefined, 'Rounds the number upwards to a whole number.'],
  ['double', 'number', undefined, 'Converts the number to a Java `double`.'],
  ['float', 'number', undefined, 'Converts the number to a Java `float`.'],
  ['floor', 'number', undefined, 'Rounds the number downwards to a whole number.'],
  ['int', 'number', undefined, 'Converts the number to a Java `int`.'],
  ['is_infinite', 'number', undefined, 'Whether the number is a floating point infinity.'],
  ['is_nan', 'number', undefined, 'Whether the number is a floating point NaN.'],
  ['long', 'number', undefined, 'Converts the number to a Java `long`.'],
  ['lower_abc', 'number', undefined, 'Converts 1, 2, 3, ... to `a`, `b`, `c`, ...'],
  ['number_to_date', 'number', undefined, 'Interprets the number as epoch milliseconds and returns a date.'],
  ['number_to_datetime', 'number', undefined, 'Interprets the number as epoch milliseconds and returns a date-time.'],
  ['number_to_time', 'number', undefined, 'Interprets the number as epoch milliseconds and returns a time.'],
  ['round', 'number', undefined, 'Rounds the number to the nearest whole number.'],
  ['short', 'number', undefined, 'Converts the number to a Java `short`.'],
  ['upper_abc', 'number', undefined, 'Converts 1, 2, 3, ... to `A`, `B`, `C`, ...'],

  // Dates
  ['date', 'date', 'format?', 'The date-only part of a date-like value, or a string parsed as a date.'],
  ['date_if_unknown', 'date', undefined, 'Marks a date-like value of unknown kind as a date.'],
  ['datetime', 'date', 'format?', 'A date-like value as a date-time, or a string parsed as a date-time.'],
  ['datetime_if_unknown', 'date', undefined, 'Marks a date-like value of unknown kind as a date-time.'],
  ['time', 'date', 'format?', 'The time-only part of a date-like value, or a string parsed as a time.'],
  ['time_if_unknown', 'date', undefined, 'Marks a date-like value of unknown kind as a time.'],

  // Booleans
  ['then', 'boolean', 'whenTrue, whenFalse', 'The first argument if the boolean is true, otherwise the second.'],

  // Sequences
  ['chunk', 'sequence', 'size, fill?', 'Splits the sequence into sequences of the given size.'],
  ['drop_while', 'sequence', 'predicate', 'Skips the leading elements for which the predicate is true.'],
  ['filter', 'sequence', 'predicate', 'Keeps only the elements for which the predicate is true.'],
  ['first', 'sequence', undefined, 'The first element of the sequence.'],
  ['join', 'sequence', 'separator, emptyValue?, ending?', 'Concatenates the elements into a string with the given separator.'],
  ['last', 'sequence', undefined, 'The last element of the sequence.'],
  ['map', 'sequence', 'mapper', 'Replaces each element with the result of the mapper.'],
  ['max', 'sequence', undefined, 'The largest number or date-like element.'],
  ['min', 'sequence', undefined, 'The smallest number or date-like element.'],
  ['reverse', 'sequence', undefined, 'The sequence in reversed order.'],
  ['seq_contains', 'sequence', 'value', 'Whether the sequence contains the value.'],
  ['seq_index_of', 'sequence', 'value, fromIndex?', 'The index of the first occurrence of the value, or -1.'],
  ['seq_last_index_of', 'sequence', 'value, fromIndex?', 'The index of the last occurrence of the value, or -1.'],
  ['sequence', 'sequence', undefined, 'Converts a collection or lazily generated result to a sequence.'],
  ['size', 'sequence', undefined, 'The number of elements in the sequence or hash.'],
  ['sort', 'sequence', undefined, 'The sequence in ascending order.'],
  ['sort_by', 'sequence', 'key', 'The sequence of hashes sorted by the given key or key path.'],
  ['take_while', 'sequence', 'predicate', 'Keeps the leading elements for which the predicate is true.'],

  // Hashes
  ['keys', 'hash', undefined, 'A sequence of the keys of the hash.'],
  ['values', 'hash', undefined, 'A sequence of the values of the hash.'],

  // Nodes
  ['ancestors', 'node', undefined, 'A sequence of all ancestors of the node, starting with its parent.'],
  ['children', 'node', undefined, 'A sequence of the direct children of the node.'],
  ['next_sibling', 'node', undefined, 'The next sibling of the node.'],
  ['node_name', 'node', undefined, 'The name used to find the macro that handles the node in `<#visit>` and `<#recurse>`.'],
  ['node_namespace', 'node', undefined, 'The namespace of the node.'],
  ['node_type', 'node', undefined, 'The type of the node, such as `"element"` or `"text"`.'],
  ['parent', 'node', undefined, 'The direct parent of the node.'],
  ['previous_sibling', 'node', undefined, 'The previous sibling of the node.'],
  ['root', 'node', undefined, 'The root of the tree the node belongs to.'],

  // Loop variables
  ['counter', 'loop variable', undefined, 'The 1-based index of the current iteration.'],
  ['has_next', 'loop variable', undefined, 'Whether the current item is not the last one.'],
  ['index', 'loop variable', undefined, 'The 0-based index of the current iteration.'],
  ['is_even_item', 'loop variable', undefined, 'Whether the 1-based index of the current iteration is even.'],
  ['is_first', 'loop variable', undefined, 'Whether the current item is the first one.'],
  ['is_last', 'loop variable', undefined, 'Whether the current item is the last one.'],
  ['is_odd_item', 'loop variable', undefined, 'Whether the 1-based index of the current iteration is odd.'],
  ['item_cycle', 'loop variable', 'value1, value2, ...', 'Cycles through the given values, one per iteration.'],
  ['item_parity', 'loop variable', undefined, '`"odd"` or `"even"`, depending on the 1-based index of the current iteration.'],
  ['item_parity_cap', 'loop variable', undefined, '`"Odd"` or `"Even"`, depending on the 1-based index of the current iteration.'],

  // Any type
  ['c', 'any', undefined, 'Formats a number, boolean, or string for computer audiences instead of human readers.'],
  ['cn', 'any', undefined, 'Like `?c`, but outputs `null` for a missing value.'],
  ['default', 'any', 'value', 'A default for a missing value. Use the `!` operator instead.', DEPRECATED],
  ['exists', 'any', undefined, 'Whether the value exists. Use the `??` operator instead.', DEPRECATED],
  ['has_content', 'any', undefined, 'Whether the value exists and is not an empty string, sequence, or hash.'],
  ['if_exists', 'any', undefined, 'The value, or an empty value if it is missing. Use the `!` operator instead.', DEPRECATED],
  ['string', 'any', 'format?', 'Converts a number, date-like value, or boolean to a string, optionally with a format.'],
  ['switch', 'any', 'case1, result1, ..., defaultResult?', 'The result that belongs to the first case equal to the value.'],

  // Type checks
  ['is_boolean', 'type check', undefined, 'Whether the value is a boolean.'],
  ['is_collection', 'type check', undefined, 'Whether the value is a collection, including sequences.'],
  ['is_collection_ex', 'type check', undefined, 'Whether the value is an extended collection that also supports `?size`.'],
  ['is_date', 'type check', undefined, 'Whether the value is date-like. Same as `?is_date_like`.'],
  ['is_date_like', 'type check', undefined, 'Whether the value is a date, time, or date-time.'],
  ['is_date_only', 'type check', undefined, 'Whether the value is a date without a time part.'],
  ['is_datetime', 'type check', undefined, 'Whether the value is a date-time.'],
  ['is_directive', 'type check', undefined, 'Whether the value is a macro, function, or other directive.'],
  ['is_enumerable', 'type check', undefined, 'Whether the value is a sequence or collection.'],
  ['is_hash', 'type check', undefined, 'Whether the value is a hash.'],
  ['is_hash_ex', 'type check', undefined, 'Whether the value is an extended hash that supports `?keys` and `?values`.'],
  ['is_indexable', 'type check', undefined, 'Whether the value is a sequence.'],
  ['is_macro', 'type check', undefined, 'Whether the value is a macro or function.'],
  ['is_markup_output', 'type check', undefined, 'Whether the value is markup output.'],
  ['is_method', 'type check', undefined, 'Whether the value is a method.'],
  ['is_node', 'type check', undefined, 'Whether the value is a node.'],
  ['is_number', 'type check', undefined, 'Whether the value is a number.'],
  ['is_sequence', 'type check', undefined, 'Whether the value is a sequence.'],
  ['is_string', 'type check', undefined, 'Whether the value is a string.'],
  ['is_time', 'type check', undefined, 'Whether the value is a time without a date part.'],
  ['is_transform', 'type check', undefined, 'Whether the value is a transform.'],
  ['is_unknown_date_like', 'type check', undefined, 'Whether the value is date-like but of unknown kind.'],

  // Expert
  ['absolute_template_name', 'expert', 'currentTemplateName?', 'Converts a template name to an absolute name.'],
  ['api', 'expert', undefined, 'Gives access to the Java API of the underlying object, if that is enabled.'],
  ['eval', 'expert', undefined, 'Evaluates the string as an FTL expression.'],
  ['eval_json', 'expert', undefined, 'Evaluates the string as JSON.'],
  ['has_api', 'expert', undefined, 'Whether the value supports `?api`.'],
  ['interpret', 'expert', undefined, 'Interprets the string as an FTL template and returns a user-defined directive.'],
  ['markup_string', 'expert', undefined, 'The markup stored in a markup output value, as a string.'],
  ['namespace', 'expert', undefined, 'The namespace in which the macro or function was defined.'],
  ['new', 'expert', 'constructorArguments...', 'Creates an instance of the Java class named by the string.'],
  ['with_args', 'expert', 'arguments', 'A macro, function, or method with the given default arguments added before the call-site arguments.'],
  ['with_args_last', 'expert', 'arguments', 'Like `?with_args`, but positional arguments are added after the call-site arguments.']
];

for (const zone of ['iso_utc', 'iso_local', 'iso']) {
  const target = zone === 'iso_utc'
    ? 'in UTC'
    : zone === 'iso_local'
      ? 'in the current time zone'
      : 'in the given time zone';
  for (const [accuracy, precision] of [['', 'seconds'], ['_ms', 'milliseconds'], ['_m', 'minutes'], ['_h', 'hours']]) {
    for (const offset of ['', '_nz']) {
      rows.push([
        `${zone}${accuracy}${offset}`,
        'date',
        zone === 'iso' ? 'timeZone' : undefined,
        `ISO 8601 format ${target} with ${precision} accuracy${offset ? ', without the zone offset' : ''}.`
      ]);
    }
  }
}

const BUILTINS = rows
  .map(([name, category, parameters, description, deprecated]) => ({
    name,
    category,
    parameters,
    description,
    deprecated: Boolean(deprecated)
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

// FreeMarker also accepts every built-in in camel case, such as ?upperCase or ?isoUtcNZ.
function camelCaseName(name) {
  return name.split('_')
    .map((part, index) => index === 0
      ? part
      : part === 'nz'
        ? 'NZ'
        : part[0].toUpperCase() + part.slice(1))
    .join('');
}

const builtinsByName = new Map();
for (const builtin of BUILTINS) {
  builtinsByName.set(builtin.name, builtin);
  builtinsByName.set(camelCaseName(builtin.name), builtin);
}

function findBuiltin(name) {
  return builtinsByName.get(name);
}

function builtinSignature(builtin) {
  return builtin.parameters === undefined ? builtin.name : `${builtin.name}(${builtin.parameters})`;
}

// The offset of the built-in name that follows a `?` at the end of the text, if any.
function builtinNameStart(beforeCursor) {
  const match = /(^|[^?])\?([A-Za-z_][A-Za-z0-9_]*)?$/.exec(beforeCursor);
  return match ? beforeCursor.length - (match[2] || '').length : -1;
}

// The built-in named directly before the position, such as `replace` before the `(` of a call.
function builtinBefore(text) {
  const head = text.replace(/\s+$/, '');
  const start = builtinNameStart(head);
  return start >= 0 && start < head.length ? findBuiltin(head.slice(start)) : undefined;
}

function editDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

// The known built-in name closest to a misspelled one, if any is close enough.
function suggestBuiltin(name) {
  let best;
  let bestDistance = Math.min(3, name.length / 2);
  for (const candidate of builtinsByName.keys()) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

// The match pattern used by syntaxes/freemarker.tmLanguage.json.
function builtinGrammarPattern() {
  return `\\?(${[...builtinsByName.keys()].sort().join('|')})\\b`;
}

module.exports = {
  BUILTINS,
  builtinBefore,
  builtinGrammarPattern,
  builtinNameStart,
  builtinSignature,
  camelCaseName,
  findBuiltin,
  suggestBuiltin
};
