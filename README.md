# FreeMarker ![FreeMarker](images/icon-small.png) IntelliSense

Completion, navigation, validation, and formatting for [Apache FreeMarker](https://freemarker.apache.org/) templates (`.ftl`, `.ftlh`, and `.ftlx`) in VS Code.

The extension indexes the templates in your workspace and follows `<#import>` and `<#include>`, so macros, functions, and variables are known across files. Built-ins, directives, special variables, and literals follow FreeMarker 2.3.35.

Both tag syntaxes are supported, `<#if x>...</#if>` and `[#if x]...[/#if]`, as well as both interpolation syntaxes, `${x}` and `[=x]`.

> **Author's note:** When editing FreeMarker templates, I wanted at least the support I was used
> to from IntelliJ; syntax highlighting alone was not enough for me. If you work on more than
> the occasional small template, I really recommend giving this extension a try.

![Diagnostics, completion, signature help, hover, Go to Definition, and formatting in a FreeMarker template](images/demo.gif)

## Features

### Completion

- **Macros, functions, and variables** from the current template and from everything it imports or includes. `toolkit.` lists the members of the imported namespace, and `toolkit.nested.` those of a namespace imported there. Only what is visible at the cursor is offered: loop variables inside their loop, parameters and local variables inside their macro or function.
- **Hash keys** after the name of a hash and a dot, also for `toolkit.hash.` in an imported template.
- **Macro arguments**: inside `<@card ...>` the parameters are offered as `name=`, with their default values. Parameters that are already set are left out.
- **Function arguments**: variables and namespaces in scope, with the full signature and the current parameter in the documentation.
- **Built-ins** after `?`, with parameters and a short description. Built-ins that fit the expression are listed first, for example string built-ins after a variable that was assigned a string, or `index` and `has_next` after a loop variable.
- **Directives** after `<#`, with their syntax.
- **Special variables** after a leading `.`, such as `.now` or `.current_template_name`.
- **Template paths** in `<#import>` and `<#include>`: the templates and folders of the workspace, relative to the current template and to the configured template roots.
- **Snippets** for common constructs: `if`, `ife`, `elif`, `else`, `list`, `assign`, `local`, `macro`, `import`, `include`, `interp`, and `ftlcomment`.

Completion labels show what is known about a symbol: the value assigned to a variable, or the parameters and defaults of a macro or function.

### Navigation

- **Go to Definition** for macros, functions, namespace members, variables (including capture assignments, loop variables, and fields of hash literals), namespace aliases, and `import`/`include` paths. On a macro or function declaration it lists the call sites instead.
- **Find All References** and **Rename Symbol** for variables, macros, and functions, across all templates that import or include them.
- **Macro and function parameters** work like local variables: Go to Definition, Find All References, and Rename Symbol, including the named arguments in calls such as `<@card title="x" />`.
- **Clickable paths** in `<#import>` and `<#include>`.
- **Outline** with imports and includes, variables, functions, and macros, in the order of the template.
- **Workspace symbol search** (`Ctrl+T`) for macros, functions, and variables in all templates.

### Hover and Signature Help

- **Hover** for variables, macros, functions, and namespace aliases shows the declaration, the assigned value or the parameters, and the source template. Built-ins, directives, and special variables show their description and syntax.
- **Signature Help** for function calls and for built-ins that take arguments, such as `?replace(from, to, flags?)`, with the active parameter highlighted.
- **Documentation comments**: the first paragraph of a `<#-- ... -->` comment directly before a macro or function is shown in completion, hover, and Signature Help. For a variable it is shown in the hover, and a comment on the same line after the declaration works too.

### Diagnostics

Reported as errors:

- Unclosed, unexpected, and mismatched block tags, for directives and for `<@...>` calls
- `<#else>`, `<#elseif>`, `<#case>`, `<#default>`, `<#on>`, and `<#recover>` outside the directive they belong to
- Unknown built-ins, with a suggestion for likely typos: `?uper_case` → `?upper_case`, also in interpolations inside strings such as `"${name?trim}"`
- Unknown directives, such as `<#iff>`
- Directives without the parameters they need (`<#if>`, `<#list>`) or with parameters they do not take (`<#else x>`), `<#import>` and `<#items>` without `as name`, and `<#macro>` or `<#function>` without a name
- Hash literals with a missing `:` or `,`, a missing key or value, or an empty entry, and unclosed or mismatched `(`, `[`, and `{`
- Arguments that a macro has no parameter for, such as `<@card titel="x" />`, unless the macro has a catch-all parameter (`others...`)

Reported as warnings:

- HTML tags that are never closed, and closing HTML tags without a start tag. Every start tag needs an end tag of its own, also in the branches of a directive: `<#if a><div class="a"><#else><div></#if>` opens two elements.

Reported as warnings, based on the workspace index:

- `import`/`include` paths that cannot be found
- Names that are not defined in an imported namespace, such as `<@cards.rendr />`
- Macro calls that leave out a required parameter
- Names that are declared neither in the template nor in the ones it includes or imports. They may come from the data model, which the extension does not know, so they are only warnings. They are not reported while one of the included or imported templates cannot be found, and can be turned off with `freemarker.validateUndeclaredNames`.

Templates in diff and merge editors, and files with unresolved merge conflicts, are not checked.

### Formatting and editing

- **Format Document** indents nested FreeMarker blocks, paired `<@...>` calls, and HTML elements. End tags line up with their start tags, and the entries of multi-line hashes and sequences are indented like JSON. Lines are never split or joined, so an element with its start and end tag on one line stays on that line. An HTML element without an end tag, such as `<li>` or `<br>`, does not indent what follows. The content of `<pre>` and `<textarea>` is left alone, and scripts and style sheets keep their own indentation. Regions between `<#-- @formatter:off -->` and `<#-- @formatter:on -->` are left as they are.
- **Folding** for FreeMarker blocks and comments. The parts before and after `<#else>` fold separately.
- **Automatic end tags**: typing `>` after a start tag inserts the end tag, for HTML elements, block directives, and `<@...>` calls, but not inside string literals. Typing `</` completes the end tag of the innermost element or block that is still open.
- **Extract to Macro** (light bulb or the command **FreeMarker: Extract to Macro**): moves the selected part of a template into a new macro and calls it in its place. Local variables, loop variables, and parameters that the selection uses become parameters of the macro. The selection must not cut through a tag, an interpolation, or an HTML element, and must contain complete directives.
- **Surround with `<#list>` / `<#if>`** (light bulb): wraps the selected lines in a directive; the missing parts of its start tag are placeholders.
- **Toggle Line Comment** (`Ctrl+/`) puts every selected line into a FreeMarker comment of its own, `<#-- ... -->` or `[#-- ... --]` depending on the tag syntax of the template, and removes the comments again. The comment starts at the beginning of the line and the indentation stays inside it.
- **Rename HTML tags**: **Rename Symbol** (`F2`) on the name of an HTML start tag renames its end tag as well.
- **Matching tags**: with the cursor on a tag, the start tag, the end tag, and branch tags such as `<#else>` of the same block are highlighted.
- **Syntax highlighting** for directives, interpolations, comments, expressions, built-ins, and special variables, on top of HTML.
- **Colors for names**: macros, functions, parameters, variables, local variables, and namespace aliases are told apart where they are declared and where they are used. The colors come from the color theme, so how many of them look different depends on the theme. They can be set with `editor.semanticTokenColorCustomizations`, using the selectors `macro:freemarker`, `function:freemarker`, `parameter:freemarker`, `variable:freemarker`, `variable.local:freemarker` (`<#local>` and loop variables), and `namespace:freemarker`.

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
| `freemarker.validateHtmlTags` | `true` | Warn about HTML tags that are never closed and about closing HTML tags without a start tag. Turn this off if the templates produce something other than HTML. |
| `freemarker.validateUndeclaredNames` | `true` | Warn about names that are declared neither in the template nor in the templates it includes or imports. Turn this off if the templates use many names from the data model. |
| `freemarker.privatePrefix` | `_` | Prefix that marks macros, functions, variables, and namespace aliases as private to their template. |

## Limitations

- Syntax highlighting cannot tell which syntax a template uses, so it colors both. Text such as `[#note]` in an angle bracket template is colored like a tag, but is not treated as one anywhere else.
- Toggle Block Comment always inserts `<#-- -->`, also in square bracket templates.
- Only `import`/`include` paths written as plain string literals are followed. Paths that are computed at runtime are ignored.
- Objects and methods that come from the Java data model are not known to the extension, so there is no completion for them, and their names are reported as undeclared (as warnings, which `freemarker.validateUndeclaredNames` turns off).
- Types are only inferred from literals, assignments of literals, and loop variables. Everything else gets the full, alphabetical list of built-ins.

## Development

Open the folder in VS Code and press `F5` to start an Extension Development Host with the extension loaded.

Run the tests with `npm test`. They need no VS Code installation.

Square bracket templates are rewritten to the default syntax before they are analyzed (`syntax.js`). The rewrite keeps every character at its offset, so the rest of the code only has to understand angle bracket tags and `${...}`.

The lists of built-ins, directives, and special variables live in `builtins.js` and `directives.js`. The highlighting patterns in `syntaxes/freemarker.tmLanguage.json` are generated from them (`builtinGrammarPattern()` and `specialVariableGrammarPattern()`), and the tests fail if the two no longer match.

Build the package with `npx @vscode/vsce package`.

## License

[MIT](LICENSE)
