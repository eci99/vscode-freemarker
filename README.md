# FreeMarker ![FreeMarker](images/icon-small.png) IntelliSense

Completion, navigation, validation, and formatting for [Apache FreeMarker](https://freemarker.apache.org/) templates (`.ftl`, `.ftlh`, and `.ftlx`) in VS Code.

The extension indexes the templates in your workspace and follows `<#import>` and `<#include>`, so macros, functions, and variables are known across files. Built-ins, directives, special variables, and literals follow FreeMarker 2.3.35.

Both tag syntaxes are supported, `<#if x>...</#if>` and `[#if x]...[/#if]`, as well as both interpolation syntaxes, `${x}` and `[=x]`.

## Features

### Completion

- **Macros, functions, and variables** from the current template and from everything it imports or includes. `toolkit.` lists the members of the imported namespace, and `toolkit.nested.` those of a namespace imported there.
- **Macro arguments**: inside `<@card ...>` the parameters are offered as `name=`, with their default values. Parameters that are already set are left out.
- **Function arguments**: variables and namespaces in scope, with the full signature and the current parameter in the documentation.
- **Built-ins** after `?`, with parameters and a short description. Built-ins that fit the expression are listed first, for example string built-ins after a variable that was assigned a string, or `index` and `has_next` after a loop variable.
- **Directives** after `<#`, with their syntax.
- **End tags**: `</#` and `</@` offer the blocks that are still open, innermost first.
- **Special variables** after a leading `.`, such as `.now` or `.current_template_name`.
- **Snippets** for common constructs: `if`, `ife`, `elif`, `else`, `list`, `assign`, `local`, `macro`, `import`, `include`, `interp`, and `ftlcomment`.

Completion labels show what is known about a symbol: the value assigned to a variable, or the parameters and defaults of a macro or function.

### Navigation

- **Go to Definition** for macros, functions, namespace members, variables (including capture assignments, loop variables, and fields of hash literals), namespace aliases, and `import`/`include` paths. On a macro or function declaration it lists the call sites instead.
- **Find All References** and **Rename Symbol** for variables, macros, and functions, across all templates that import or include them.
- **Clickable paths** in `<#import>` and `<#include>`.
- **Outline** with imports and includes, variables, functions, and macros.
- **Workspace symbol search** (`Ctrl+T`) for macros, functions, and variables in all templates.

### Hover and Signature Help

- **Hover** for variables, macros, functions, and namespace aliases shows the declaration, the assigned value or the parameters, and the source template. Built-ins, directives, and special variables show their description and syntax.
- **Signature Help** for function calls and for built-ins that take arguments, such as `?replace(from, to, flags?)`, with the active parameter highlighted.
- **Documentation comments**: the first paragraph of a `<#-- ... -->` comment directly before a macro or function is shown in completion, hover, and Signature Help. For a variable it is shown in the hover, and a comment on the same line after the declaration works too.

### Diagnostics

Reported as errors:

- Unclosed, unexpected, and mismatched block tags, for directives and for `<@...>` calls
- `<#else>`, `<#elseif>`, `<#case>`, `<#default>`, `<#on>`, and `<#recover>` outside the directive they belong to
- Unknown built-ins, with a suggestion for likely typos: `?uper_case` → `?upper_case`

Reported as warnings, based on the workspace index:

- `import`/`include` paths that cannot be found
- Names that are not defined in an imported namespace, such as `<@cards.rendr />`
- Macro calls that leave out a required parameter

### Formatting and editing

- **Format Document** indents nested FreeMarker blocks and paired `<@...>` calls. Regions between `<#-- @formatter:off -->` and `<#-- @formatter:on -->` are left as they are.
- **Folding** for FreeMarker blocks and comments. The parts before and after `<#else>` fold separately.
- **Matching tags**: with the cursor on a tag, the start tag, the end tag, and branch tags such as `<#else>` of the same block are highlighted.
- **Syntax highlighting** for directives, interpolations, comments, expressions, built-ins, and special variables, on top of HTML.

## How templates are connected

```ftl
<#import "lib/toolkit.ftl" as toolkit>
<#include "shared.ftl">

<@toolkit.card title=pageTitle />
${toolkit.nested.label}
```

- Everything declared in an included template is available as if it were declared in the including template.
- An imported template is available under its alias. If `toolkit.ftl` imports another template as `nested`, its members are reachable as `toolkit.nested.…`.
- Template paths are resolved relative to the current template, then relative to the workspace folders, then relative to the folders in `freemarker.templateRoots`.
- Names that start with the private prefix (`_` by default) are hidden from completion and navigation outside the template that defines them.

## Square bracket syntax

Everything above works the same in templates that use the square bracket syntax. Completion inserts square bracket tags there, and documentation and messages show them.

- **Tags** (`[#if x]`, `[@box /]`, `[#-- comment --]`): by default the first FreeMarker tag of a template decides which syntax it uses, so nothing has to be configured. If your FreeMarker configuration sets `tag_syntax` to a fixed value, set `freemarker.tagSyntax` to match. A template that starts with `<#ftl>` or `[#ftl]` always uses the syntax of that tag.
- **Interpolations** (`[=x]`): FreeMarker cannot detect these per template, so set `freemarker.interpolationSyntax` to `squareBracket` if your configuration uses them. `${x}` and `#{x}` are then plain text.

The two are independent: `[#if x]${y}[/#if]` and `<#if x>[=y]</#if>` are both possible.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `freemarker.templateRoots` | `[]` | Workspace-relative folders that are searched when resolving template paths, matching the roots of your template loader. |
| `freemarker.tagSyntax` | `auto` | `auto`, `angleBracket`, or `squareBracket`, matching the `tag_syntax` setting of FreeMarker. With `auto`, the first FreeMarker tag of a template decides. |
| `freemarker.interpolationSyntax` | `legacy` | `legacy` (`${x}` and `#{x}`), `dollar` (only `${x}`), or `squareBracket` (only `[=x]`), matching the `interpolation_syntax` setting of FreeMarker. |
| `freemarker.validateTemplatePaths` | `true` | Warn about `import`/`include` paths that cannot be found. Turn this off if templates are loaded from outside the workspace, for example from a JAR. |
| `freemarker.privatePrefix` | `_` | Prefix that marks macros, functions, variables, and namespace aliases as private to their template. |

## Limitations

- Syntax highlighting cannot tell which syntax a template uses, so it colors both. Text such as `[#note]` in an angle bracket template is colored like a tag, but is not treated as one anywhere else.
- Toggle Block Comment always inserts `<#-- -->`, also in square bracket templates.
- Only `import`/`include` paths written as plain string literals are followed. Paths that are computed at runtime are ignored.
- Objects and methods that come from the Java data model are not known to the extension, so there is no completion or validation for them.
- Types are only inferred from literals, assignments of literals, and loop variables. Everything else gets the full, alphabetical list of built-ins.
- Interpolations inside string literals, such as `"${name?trim}"`, are not checked for unknown built-ins.

## Development

Open the folder in VS Code and press `F5` to start an Extension Development Host with the extension loaded.

Run the tests with `npm test`. They need no VS Code installation.

Square bracket templates are rewritten to the default syntax before they are analyzed (`syntax.js`). The rewrite keeps every character at its offset, so the rest of the code only has to understand angle bracket tags and `${...}`.

The lists of built-ins, directives, and special variables live in `builtins.js` and `directives.js`. The highlighting patterns in `syntaxes/freemarker.tmLanguage.json` are generated from them (`builtinGrammarPattern()` and `specialVariableGrammarPattern()`), and the tests fail if the two no longer match.

Build the package with `npx @vscode/vsce package`.

## License

[MIT](LICENSE)
