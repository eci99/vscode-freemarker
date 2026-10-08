# FreeMarker Language Support

VS Code support for Apache FreeMarker templates (`.ftl`, `.ftlh`, and `.ftlx`).

## Template features

- Syntax highlighting for directives, interpolations, comments, and expressions
- Completion of macros, functions, and variables from templates imported with `as namespace`
- Go to Definition for imported namespace members, assigned variables, loop variables, and included templates
- Find All References for variables and macros/functions across namespace imports and includes
- Workspace indexing that updates as template files are opened, edited, created, or deleted
- Optional `freemarker.templateRoots` workspace setting for template-loader roots

For example, with `<#import "lib/cards.ftl" as cards>`, typing `cards.` offers the macros, functions, and variables declared in `lib/cards.ftl`. Use Go to Definition on `cards.render` or `${cards.theme}` to open the declaration. Local variables declared by `#assign`, `#local`, `#global`, and `#list ... as ...` are also navigable from their references.

The index resolves statically written import/include paths. It does not infer Java methods exposed through the FreeMarker data model.

## Run in VS Code

Open this folder in VS Code and press `F5` to launch an Extension Development Host. Open a FreeMarker template there to try the language support.

## Tests and packaging

Run the parser tests with `node ./test/template-index.test.js`. Package the extension with `npx @vscode/vsce package` in an environment with a supported Node.js/npm version.
