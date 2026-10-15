# Changelog

## 0.1.3 - 2026-10-16

Added

- Warnings for names that are declared neither in the template nor in the ones it includes or imports. They are left out if one of those templates cannot be found, and the setting `freemarker.validateUndeclaredNames` turns them off
- Errors for unknown directives, for directives with missing or unexpected parameters (`<#else x>`, `<#if>`, `<#import "a.ftl">` without `as`), and for arguments that a macro has no parameter for
- Errors in hash literals and brackets: missing `:` or `,`, missing keys or values, empty entries, and unclosed or mismatched `(`, `[`, `{`
- Macro and function parameters are treated as local variables: Go to Definition, Find All References, and Rename Symbol work on them, including the named arguments of calls
- Completion only offers what is visible at the cursor: loop variables inside their loop, and parameters and local variables inside their macro or function. The keys of a hash are offered after its name and a dot, also for `alias.hash.` of an imported template
- **Extract to Macro** (code action and command): moves the selection into a new macro that is called in its place, with the local names it uses as parameters
- **Surround with `<#list>`** and **Surround with `<#if>`** as code actions for selections of whole lines
- Raw string literals (`r"C:\path"`) are highlighted and analyzed correctly
- Interpolations inside string literals, such as `"${name?trim}"`, are checked for unknown built-ins and hash errors

Changed

- Format Document lines up an end tag with its start tag and indents the entries of multi-line hashes and sequences like JSON
- Automatic closing pairs are enabled in FreeMarker templates by default (`editor.autoClosingPairs`: `always`)

Fixed

- No automatic end tag is inserted when typing `>` inside a string literal
- A `>` inside parentheses, as in `<#if (a > b)>`, no longer ends the tag
- Diff and merge editors, and files with unresolved merge conflicts, are no longer analyzed, so they get no diagnostics

## 0.1.2 - 2026-10-12

Added

- Automatic end tags: typing `>` after a start tag inserts the end tag, for HTML elements, block directives, and `<@...>` calls. Typing `</` completes the end tag of the innermost open element or block
- Warnings for HTML tags that are never closed and for closing HTML tags without a start tag, with the setting `freemarker.validateHtmlTags` to turn them off
- Rename Symbol on the name of an HTML start tag renames its end tag as well
- Completion for the template paths of `<#import>` and `<#include>`
- Colors for macros, functions, parameters, variables, local variables, and namespace aliases, taken from the color theme
- Toggle Line Comment (`Ctrl+/`) puts every selected line into a FreeMarker comment of its own, using `[#-- --]` in square bracket templates
- Format Document indents HTML elements, leaves the content of `<pre>` and `<textarea>` alone, and keeps the indentation inside scripts and style sheets

Changed

- The outline lists its entries in the order of the template, without groups
- The completion for `</#` and `</@` is replaced by the automatic end tags

Fixed

- Format Document indents the content after a FreeMarker tag that spans several lines

## 0.1.1 - 2026-10-10

- Extension icon added
- Marketplace metadata added: publisher, repository, keywords, and changelog

## 0.1.0 - 2026-10-10

First published version of FreeMarker IntelliSense.

- Completion for macros, functions, variables, built-ins, directives, end tags, and special variables
- Go to Definition, Find All References, Rename Symbol, outline, and workspace symbol search across imported and included templates
- Hover documentation and Signature Help
- Validation of block tags and built-ins, plus warnings for unresolved template paths, unknown namespace members, and missing macro parameters
- Formatting, folding, and highlighting of matching tags
- Angle bracket and square bracket syntax, following FreeMarker 2.3.35
