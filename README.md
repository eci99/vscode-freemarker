# FreeMarker Language Support

VS Code support for Apache FreeMarker templates (`.ftl`, `.ftlh`, and `.ftlx`).

## Template features

- Syntax highlighting for directives, interpolations, comments, and expressions
- Document formatting for nested FreeMarker blocks and paired user directives, with `@formatter:off` / `@formatter:on` comment markers to preserve selected regions
- Completion of macros, functions, variables, and nested aliases across imported and included templates
- Variable completion labels include known assigned values
- Macro and function completion details include declared parameters and default values
- Go to Definition for imported namespace members, simple and capture-assigned variables, loop variables, nested hash fields, and included templates
- Find All References for variables and macros/functions across namespace imports and includes
- Workspace indexing that updates as template files are opened, edited, created, or deleted
- Optional `freemarker.templateRoots` workspace setting for template-loader roots
- Private definitions and namespace aliases use the configurable `freemarker.privatePrefix` setting (default: `_`)

For example, with `<#import "lib/toolkit.ftl" as toolkit>`, if that template imports `nested.ftl` as `nested` and includes `shared.ftl`, then `toolkit.nested.` offers nested-template declarations and `toolkit.` offers declarations from the included template plus the `nested` alias. Go to Definition resolves paths such as `toolkit.nested.render` across these template levels. Local variables declared by `#assign`, `#local`, `#global`, and `#list ... as ...` are also navigable from their references.

Names beginning with the private prefix are hidden from external namespace completion and definition lookup, but remain available inside their defining template. The index resolves statically written import/include paths. It does not infer Java methods exposed through the FreeMarker data model.

## Run in VS Code

Open this folder in VS Code and press `F5` to launch an Extension Development Host. Open a FreeMarker template there to try the language support.

## Tests and packaging

Run the parser tests with `node ./test/template-index.test.js`. Package the extension with `npx @vscode/vsce package` in an environment with a supported Node.js/npm version.
