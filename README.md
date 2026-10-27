# FreeMarker (with IntelliSense)

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
- **Import aliases**: Find All References and Rename Symbol on the alias of an `<#import>`, at the import or at a use such as `<@cards.render />`, cover the import and every `cards.` in the templates that see it, but not an alias of the same name declared by another import.
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
- Aliases that no `<#import>` declares: the namespace of a macro call, such as `cardz` in `<@cardz.render />`, and a namespace inside an imported one, such as `nestd` in `${toolkit.nestd.label}`. A template that is included sees the aliases of the templates that include it. A name such as `${user.name}` may come from the data model and is only reported as undeclared (an information)

Reported as warnings:

- HTML tags that are never closed, and closing HTML tags without a start tag. Every start tag needs an end tag of its own, also in the branches of a directive: `<#if a><div class="a"><#else><div></#if>` opens two elements.

Reported as warnings, based on the workspace index:

- `import`/`include` paths that cannot be found
- Names that are not defined in an imported namespace, such as `<@cards.rendr />`
- Macro calls that leave out a required parameter

Reported as information, based on the workspace index:

- Names that are declared neither in the template nor in the ones it includes or imports, with the hint that they may come from the data model, which the extension does not know. They are not reported while one of the included or imported templates cannot be found, and can be turned off with `freemarker.validateUndeclaredNames`.

Templates in diff and merge editors, and files with unresolved merge conflicts, are not checked.

### Formatting and editing

- **Format Document** indents nested FreeMarker blocks, paired `<@...>` calls, and HTML elements. End tags line up with their start tags, and the entries of multi-line hashes and sequences are indented like JSON. Lines are never joined, so an element with its start and end tag on one line stays on that line. When a start tag is alone on its line, its end tag gets a line of its own too (`<#if x>⏎text</#if>` becomes `<#if x>⏎    text⏎</#if>`), except where that would change the output: after a FreeMarker end tag with more on its line, and in `<#list>`, `<#macro>`, and `<#assign>` blocks. Other lines are split only if `freemarker.wrapLongLines` is on (see below). Text over several lines is indented by one level below its first line, also when that line opens several elements (`<p>Text <b>bold`), and interpolations over several lines are indented like tags. The lines of a string over several lines are left as they are, since their spaces are part of the value. An HTML element without an end tag, such as `<li>` or `<br>`, does not indent what follows. The content of `<pre>` and `<textarea>` is left alone, and scripts and style sheets keep their own indentation. Regions between `<#-- @formatter:off -->` and `<#-- @formatter:on -->` are left as they are. Pasted lines are indented to fit where they are pasted (`editor.formatOnPaste`, on by default for FreeMarker), and **Format Selection** indents the selected lines the same way, without splitting them or moving the rest of the document.
- **Folding** for FreeMarker blocks and comments. The parts before and after `<#else>` fold separately.
- **Automatic end tags**: typing `>` after a start tag inserts the end tag, for HTML elements, `<@...>` calls, and directives that need one, but not inside string literals. `<#assign x>` gets `</#assign>`, `<#assign x = 1>` and directives with an optional end tag such as `<#sep>` do not. Typing `/` at the end of a start tag, as in `<#include "a.ftl" />` or `<br/>`, adds the `>`; a `/` that may be a division, as in `<#assign x = a /`, is left alone. Typing `</` completes the end tag of the innermost element or block that is still open. Typing `/` before the `>` of a start tag, as in `<@render/>`, removes its end tag; the content between the two tags stays.
- **Extract to Macro** (light bulb or the command **FreeMarker: Extract to Macro**): moves the selected part of a template into a new macro and calls it in its place. Local variables, loop variables, and parameters that the selection uses become parameters of the macro. The selection must not cut through a tag, an interpolation, or an HTML element, and must contain complete directives.
- **Wrap with Abbreviation** (light bulb or the command **FreeMarker: Wrap with Abbreviation**): wraps the selection in the tags of an Emmet-like abbreviation. Whole lines get one tag per line and are indented; a selection inside a line stays on it.
  - `div.card#main[data-id="1" hidden]`: an element with classes, an id, and attributes; `.note` alone is a `div` (an `li` in a list, a `td` in a row, ...)
  - `ul>li` nests, `h2+div` adds a sibling, and the selection goes into the last element
  - `ul>li*` wraps each selected line in an `li`; `$` in an attribute is the number of the line
  - `#if`, `#list[users as user]`, `#assign[name]`: FreeMarker directives with an end tag, with their parameters in `[]`, or a placeholder for them; `#main` is still an id
  - `@card[title="x"]`: a macro call
- **Extract to Function**, **Extract to `<#local>`**, and **Extract to `<#assign>`** (light bulb or the commands of the same name): moves the selected expression into a new function that is called in its place, or into a variable that is set on the line before the tag or interpolation (before the `<#if>` of an `<#elseif>`). Local variables, loop variables, and parameters that the expression uses become parameters of the function. `<#local>` is offered inside macros and functions. The selection must be a whole expression: `b + c` in `a * b + c` is refused, `(b + c)` is not.
- **Surround with `<#list>` / `<#if>`** (light bulb): wraps the selected lines in a directive; the missing parts of its start tag are placeholders.
- **Toggle Line Comment** (`Ctrl+/`) puts every selected line into a FreeMarker comment of its own, `<#-- ... -->` or `[#-- ... --]` depending on the tag syntax of the template, and removes the comments again. The comment starts at the beginning of the line and the indentation stays inside it.
- **Toggle Block Comment** (`Ctrl+Shift+A`, `Shift+Alt+A` on macOS) puts the selection into `<#-- ... -->` or `[#-- ... --]`, depending on the tag syntax, or takes away the comment the selection is in.
- **Moving templates**: when a template or a folder of templates is moved or renamed in VS Code, the `<#import>` and `<#include>` paths that lead to it and from it are updated. A path keeps its form: relative to the template, relative to the workspace folder or a template root, with a leading `/`, or without an extension. By default VS Code asks first; `freemarker.updatePathsOnFileMove` changes that. Before templates are moved, all files with unsaved changes are saved, so that the paths are changed in the text that is moved. Templates that git tracks are moved in the git index too, like `git mv`, so that git shows a rename and keeps their history; changes that were not staged stay unstaged. Other files in a moved folder are left to you. `freemarker.gitMoveFiles` turns this off.
- **Rename HTML tags**: **Rename Symbol** (`F2`) on the name of an HTML start tag renames its end tag as well.
- **Expand Selection** (`Shift`+`Alt`+`→`, shrink with `Shift`+`Alt`+`←`) follows the structure of the template: a name with its members (`user.name`) and built-ins (`?upper_case`), strings, brackets, parameters (`title="…"`), the parameters of a tag, the whole tag, interpolations, HTML attributes, the content of an element or block, a branch such as `<#else>…`, the whole element or block, and comments.
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
| `freemarker.wrapLongLines` | `false` | Format Document breaks FreeMarker tags that are longer than `freemarker.wrapLineLength` into several lines: before named arguments of a macro call, before `&&` and `||` in conditions, and between the parameters of a macro or function. The parts are indented below the tag. Strings, comments, text, `<pre>` and regions between `@formatter:off` and `@formatter:on` are never split. |
| `freemarker.wrapLineLength` | `160` | The line length from which a tag is broken, if `freemarker.wrapLongLines` is on. |
| `freemarker.validateUndeclaredNames` | `true` | Report names that are declared neither in the template nor in the templates it includes or imports, as information. Turn this off if the templates use many names from the data model. |
| `freemarker.updatePathsOnFileMove` | `prompt` | `prompt`, `always`, or `never`: whether the `import`/`include` paths are updated when a template or its folder is moved or renamed. |
| `freemarker.gitMoveFiles` | `true` | Move templates that git tracks in the git index too when they are moved or renamed in VS Code, like `git mv`. |
| `freemarker.privatePrefix` | `_` | Prefix that marks macros, functions, variables, and namespace aliases as private to their template. |

## Limitations

- Syntax highlighting cannot tell which syntax a template uses, so it colors both. Text such as `[#note]` in an angle bracket template is colored like a tag, but is not treated as one anywhere else.
- Only `import`/`include` paths written as plain string literals are followed. Paths that are computed at runtime are ignored.
- Objects and methods that come from the Java data model are not known to the extension, so there is no completion for them, and their names are reported as undeclared (as information, which `freemarker.validateUndeclaredNames` turns off).
- Types are only inferred from literals, assignments of literals, and loop variables. Everything else gets the full, alphabetical list of built-ins.

## Development

Open the folder in VS Code and press `F5` to start an Extension Development Host with the extension loaded.

Run the tests with `npm test`. They need no VS Code installation.

Square bracket templates are rewritten to the default syntax before they are analyzed (`syntax.js`). The rewrite keeps every character at its offset, so the rest of the code only has to understand angle bracket tags and `${...}`.

The lists of built-ins, directives, and special variables live in `builtins.js` and `directives.js`. The highlighting patterns in `syntaxes/freemarker.tmLanguage.json` are generated from them (`builtinGrammarPattern()` and `specialVariableGrammarPattern()`), and the tests fail if the two no longer match.

Build the package with `npx @vscode/vsce package`.

## License

[MIT](LICENSE)
