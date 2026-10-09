# FreeMarker Language Support

VS Code support for Apache FreeMarker templates (`.ftl`, `.ftlh`, and `.ftlx`).

## Template features

- Syntax highlighting for directives, interpolations, comments, and expressions
- Template validation for unclosed, unexpected, and mismatched FreeMarker block tags, for branch tags such as `<#else>` or `<#case>` outside their parent directive, and for unknown built-ins with a suggestion for likely typos
- Warnings based on the workspace index: `import`/`include` paths that cannot be found, names that are not defined in an imported namespace, and macro calls that leave out required parameters
- Document formatting for nested FreeMarker blocks and paired user directives, with `@formatter:off` / `@formatter:on` comment markers to preserve selected regions
- Completion of macros, functions, variables, and nested aliases across imported and included templates
- Variable completion labels include known assigned values
- Interpolation completion (`${...}` and `#{...}`) is limited to namespaces, variables, and functions
- Macro and function completion details include declared parameters and default values
- The first paragraph of an immediately preceding FreeMarker comment is included in macro/function completion documentation
- Named macro-call arguments are suggested as `name=` and already supplied arguments are omitted
- Function arguments suggest in-scope variables and namespaces without snippets; documentation lists the full signature, highlights the current parameter, and substitutes values already entered at the call site
- Go to Definition for imported namespace members, simple and capture-assigned variables, loop variables, nested hash fields, and included templates; Go to Definition on a macro or function declaration navigates directly to its call sites
- Hover documentation for namespace aliases, variables, macros, and functions
- Built-in completion after `?` in FreeMarker expressions, with hover documentation and highlighting for snake case and camel case names; deprecated built-ins are marked, and built-ins that fit the type of a literal, an assigned variable, or a loop variable are listed first
- Directive completion after `<#` and hover documentation for directives; `</#` and `</@` suggest the blocks that are still open, innermost first
- Completion, hover documentation, and highlighting for special variables such as `.now` or `.current_template_name`
- Clickable `import`/`include` paths, workspace symbol search for macros, functions, and variables, folding for FreeMarker blocks and comments, and highlighting of the tags that belong to the block under the cursor
- The first paragraph of a comment immediately before or inline after a variable declaration is included in its hover
- Signature Help for function calls with parameter details, default values, documentation, and active parameter highlighting
- Signature Help for built-ins that take arguments, such as `?replace(from, to, flags?)`
- Find All References for variables and macros/functions across namespace imports and includes
- Rename Symbol for variables, macros, and functions across templates, updating declarations and all references
- Workspace indexing that updates as template files are opened, edited, created, or deleted
- Optional `freemarker.templateRoots` workspace setting for template-loader roots
- `freemarker.validateTemplatePaths` (default: on) turns the warning for unresolved `import`/`include` paths off, for projects that load templates from outside the workspace
- Private definitions and namespace aliases use the configurable `freemarker.privatePrefix` setting (default: `_`)

For example, with `<#import "lib/toolkit.ftl" as toolkit>`, if that template imports `nested.ftl` as `nested` and includes `shared.ftl`, then `toolkit.nested.` offers nested-template declarations and `toolkit.` offers declarations from the included template plus the `nested` alias. Go to Definition resolves paths such as `toolkit.nested.render` across these template levels. Local variables declared by `#assign`, `#local`, `#global`, and `#list ... as ...` are also navigable from their references.

Names beginning with the private prefix are hidden from external namespace completion and definition lookup, but remain available inside their defining template. The index resolves statically written import/include paths. It does not infer Java methods exposed through the FreeMarker data model.

## Run in VS Code

Open this folder in VS Code and press `F5` to launch an Extension Development Host. Open a FreeMarker template there to try the language support.

## Tests and packaging

Run the parser tests with `node ./test/template-index.test.js`. The built-in list lives in `builtins.js`, and the directives and special variables in `directives.js`; `node ./test/builtins.test.js` and `node ./test/directives.test.js` fail if the highlighting patterns in `syntaxes/freemarker.tmLanguage.json` no longer match them. Package the extension with `npx @vscode/vsce package` in an environment with a supported Node.js/npm version.
