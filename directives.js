const DEPRECATED = true;

// How a directive is closed: 'required' needs an end tag, 'optional' may have one,
// and 'capture' needs one only when it is used without `=`.
// [name, syntax, description, block, deprecated]
const directiveRows = [
  ['assign', '<#assign name=value>', 'Creates or replaces a variable in the current namespace. Without `=`, captures the content up to `</#assign>`.', 'capture'],
  ['attempt', '<#attempt>...<#recover>...</#attempt>', 'Runs the first part and, if it fails, rolls its output back and runs the part after `<#recover>`.', 'required'],
  ['autoesc', '<#autoesc>...</#autoesc>', 'Turns auto-escaping on for the enclosed content.', 'required'],
  ['break', '<#break>', 'Leaves the enclosing `<#list>` or `<#switch>`.'],
  ['case', '<#case value>', 'A branch of `<#switch>` that falls through to the next branch unless `<#break>` is used.'],
  ['compress', '<#compress>...</#compress>', 'Removes superfluous whitespace from the enclosed output.', 'required'],
  ['continue', '<#continue>', 'Skips the rest of the current `<#list>` iteration.'],
  ['default', '<#default>', 'The branch of `<#switch>` used when no other branch matches.'],
  ['else', '<#else>', 'The alternative of `<#if>`, or the content of `<#list>` when there are no items.'],
  ['elseif', '<#elseif condition>', 'A further condition of `<#if>`.'],
  ['escape', '<#escape identifier as expression>...</#escape>', 'Applies an expression to all interpolations in the enclosed content. Use auto-escaping instead.', 'required', DEPRECATED],
  ['fallback', '<#fallback>', 'Continues with the default handling of the node inside a `<#visit>` or `<#recurse>` handler macro.'],
  ['flush', '<#flush>', 'Flushes the output.'],
  ['foreach', '<#foreach item in sequence>...</#foreach>', 'Iterates over a sequence. Use `<#list>` instead.', 'required', DEPRECATED],
  ['ftl', '<#ftl name=value>', 'Template header with settings such as `output_format`, `encoding`, or `strip_whitespace`.'],
  ['function', '<#function name param1 param2>...<#return value></#function>', 'Defines a function that returns a value with `<#return>`.', 'required'],
  ['global', '<#global name=value>', 'Creates or replaces a variable that is visible in all namespaces.', 'capture'],
  ['if', '<#if condition>...<#elseif condition>...<#else>...</#if>', 'Outputs the enclosed content if the condition is true.', 'required'],
  ['import', '<#import path as namespace>', 'Loads a template as a namespace, giving access to its macros, functions, and variables.'],
  ['include', '<#include path>', 'Inserts another template at this point.'],
  ['items', '<#items as item>...</#items>', 'The repeated part inside `<#list sequence>`, so that the surrounding content is output only once.', 'required'],
  ['list', '<#list sequence as item>...<#else>...</#list>', 'Iterates over a sequence or hash.', 'required'],
  ['local', '<#local name=value>', 'Creates or replaces a local variable inside a macro or function.', 'capture'],
  ['lt', '<#lt>', 'Ignores the leading whitespace of the line.'],
  ['macro', '<#macro name param1 param2=default>...</#macro>', 'Defines a user-defined directive that is called with `<@name ...>`.', 'required'],
  ['nested', '<#nested loopVariable1, loopVariable2>', 'Runs the content between the start and end tag of the calling `<@...>`.'],
  ['noautoesc', '<#noautoesc>...</#noautoesc>', 'Turns auto-escaping off for the enclosed content.', 'required'],
  ['noescape', '<#noescape>...</#noescape>', 'Turns the surrounding `<#escape>` off for the enclosed content.', 'required', DEPRECATED],
  ['noparse', '<#noparse>...</#noparse>', 'Outputs the enclosed content as is, without interpreting FreeMarker syntax.', 'required'],
  ['nt', '<#nt>', 'Disables whitespace stripping for the line.'],
  ['on', '<#on value1, value2>', 'A branch of `<#switch>` that does not fall through to the next branch.'],
  ['outputformat', '<#outputformat "HTML">...</#outputformat>', 'Sets the output format of the enclosed content.', 'required'],
  ['recover', '<#recover>', 'Starts the part of `<#attempt>` that runs after a failure.', 'optional'],
  ['recurse', '<#recurse node using namespace>', 'Visits all children of a node.'],
  ['return', '<#return value>', 'Leaves the macro or function. Inside a function it also sets the result.'],
  ['rt', '<#rt>', 'Ignores the trailing whitespace of the line.'],
  ['sep', '<#sep>...', 'Content that is output only between two items of `<#list>`.', 'optional'],
  ['setting', '<#setting name=value>', 'Changes a processing setting such as `locale`, `number_format`, or `time_zone`.'],
  ['stop', '<#stop reason>', 'Aborts template processing with an error.'],
  ['switch', '<#switch value>...<#on value>...<#default>...</#switch>', 'Chooses a branch by comparing a value.', 'required'],
  ['t', '<#t>', 'Ignores the leading and trailing whitespace of the line.'],
  ['transform', '<#transform transformer>...</#transform>', 'Passes the enclosed content through a transform. Use `<@...>` instead.', 'required', DEPRECATED],
  ['visit', '<#visit node using namespace>', 'Calls the macro that handles the node.']
];

const DIRECTIVES = directiveRows.map(([name, syntax, description, block, deprecated]) => ({
  name,
  syntax,
  description,
  block,
  deprecated: Boolean(deprecated)
}));

const directivesByName = new Map(DIRECTIVES.map((directive) => [directive.name, directive]));

function findDirective(name) {
  return directivesByName.get(name.toLowerCase());
}

// The directives a tag has to be a direct child of.
const BRANCH_PARENTS = {
  else: ['if', 'list'],
  elseif: ['if'],
  recover: ['attempt'],
  case: ['switch'],
  default: ['switch'],
  on: ['switch']
};

// [name, description]
const specialVariableRows = [
  ['args', 'The arguments of the current macro or function call, for use with `?with_args`.'],
  ['auto_esc', 'Whether auto-escaping is on at this point of the template.'],
  ['caller_template_name', 'The name of the template that called the current macro or function.'],
  ['current_template_name', 'The name of the template that contains this expression.'],
  ['data_model', 'A hash for accessing the data-model directly, bypassing template variables.'],
  ['error', 'The error message inside `<#recover>`.'],
  ['get_optional_template', 'A method that loads a template only if it exists.'],
  ['globals', 'A hash for accessing global variables: the data-model and variables set with `<#global>`.'],
  ['incompatible_improvements', 'The `incompatible_improvements` setting of the configuration, as a string.'],
  ['lang', 'The language part of the current locale, such as `en`.'],
  ['locale', 'The current locale as a string, such as `en_US`.'],
  ['locale_object', 'The current locale as a `java.util.Locale` object.'],
  ['locals', 'A hash for accessing the local variables of the current macro or function.'],
  ['main', 'A hash for accessing the main namespace.'],
  ['main_template_name', 'The name of the top-level template.'],
  ['namespace', 'A hash for accessing the current namespace.'],
  ['node', 'The node that is currently processed with `<#visit>` or `<#recurse>`.'],
  ['now', 'The current date and time.'],
  ['output_encoding', 'The name of the output charset, if known.'],
  ['output_format', 'The name of the current output format, such as `HTML`.'],
  ['pass', 'A macro that does nothing.'],
  ['template_name', 'The name of the main template or of the current one, depending on the configuration. Use `.main_template_name` or `.current_template_name` instead.'],
  ['time_zone', 'The current time zone as a string.'],
  ['url_escaping_charset', 'The charset used for URL escaping.'],
  ['vars', 'A hash for accessing all visible variables, including ones whose names need quoting.'],
  ['version', 'The FreeMarker version as a string.']
];

const SPECIAL_VARIABLES = specialVariableRows.map(([name, description]) => ({ name, description }));

function camelCaseName(name) {
  return name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

const specialVariablesByName = new Map();
for (const variable of SPECIAL_VARIABLES) {
  specialVariablesByName.set(variable.name, variable);
  specialVariablesByName.set(camelCaseName(variable.name), variable);
}

function findSpecialVariable(name) {
  return specialVariablesByName.get(name);
}

// The offset of the special variable name that follows a leading `.` at the end of the text, if any.
function specialVariableNameStart(beforeCursor) {
  const match = /(^|[^A-Za-z0-9_.\])"'])\.([A-Za-z_][A-Za-z0-9_]*)?$/.exec(beforeCursor);
  return match ? beforeCursor.length - (match[2] || '').length : -1;
}

// The match pattern used by syntaxes/freemarker.tmLanguage.json.
function specialVariableGrammarPattern() {
  return `(?<![A-Za-z0-9_.\\])"'])\\.(${[...specialVariablesByName.keys()].sort().join('|')})\\b`;
}

module.exports = {
  BRANCH_PARENTS,
  DIRECTIVES,
  SPECIAL_VARIABLES,
  findDirective,
  findSpecialVariable,
  specialVariableGrammarPattern,
  specialVariableNameStart
};
