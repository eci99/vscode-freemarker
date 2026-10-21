# Changelog

## 0.1.11 - 2026-10-21

Added

- Expand Selection (`Shift+Alt+Right`, shrink with `Shift+Alt+Left`) follows the structure of the template: names with their members and built-ins, strings, brackets, parameters, tags, interpolations, HTML attributes, the content of elements and blocks, branches such as `<#else>`, whole elements and blocks, and comments
- Typing `/` before the `>` of a start tag, as in `<@render/>`, removes its end tag; the content between the two tags stays

## 0.1.10 - 2026-10-21

Fixed

- Moving or renaming templates saves all files with unsaved changes first, so that updating the import and include paths does not go wrong because of unsaved changes

## 0.1.9 - 2026-10-19

Added

- Moving or renaming a template that git tracks moves it in the git index too, like `git mv`, so that git shows a rename. Changes that were not staged stay unstaged. The setting `freemarker.gitMoveFiles` turns it off

## 0.1.8 - 2026-10-19

Added

- Rename Symbol and Find All References on the alias of an `<#import>` (`<#import "lib.ftl" as lib>`), at the import or at a use such as `<@lib.card />` or `${lib.title}`. Aliases of the same name declared by other imports are left alone
- Errors for aliases that no `<#import>` declares, such as `<@cardz.render />` or `${toolkit.nestd.label}`. An included template sees the aliases of the templates that include it
- Wrap with Abbreviation: wraps the selection in the tags of an Emmet-like abbreviation such as `ul>li*`, `div.card>#if[visible]`, or `@card[title="x"]`, also in square bracket templates
- Extract to Function, Extract to `<#local>`, and Extract to `<#assign>` for a selected expression (code actions and commands)
- Toggle Block Comment (`Ctrl+Shift+A`) inserts `[#-- --]` in square bracket templates instead of `<#-- -->`

Changed

- Format Document: text over several lines is indented by one level, also when several elements are opened on its first line (`<p>Text <b>bold` no longer indents the next line by two levels)
- Format Document: an interpolation over several lines (`${message(` ... `)}`) is indented like a tag over several lines
- Names that are declared nowhere are reported as information instead of warnings, with the hint that they may come from the data model

Fixed

- Square bracket syntax: the code actions and the messages of Extract to Macro and Surround With show `[#if]` and `[#list]` instead of `<#if>` and `<#list>`
- Format Document no longer changes the lines of a string over several lines (`<#assign text = "one\n  two">`), whose spaces are part of its value
- A `>` in parentheses (`<#if (a > 1) && b>`) no longer ends the tag for Find All References and Rename, so names after it are found

## 0.1.7 - 2026-10-19

Added

- Moving or renaming a template or a folder updates the `<#import>` and `<#include>` paths that lead to and from the moved templates. The setting `freemarker.updatePathsOnFileMove` (`prompt`, `always`, `never`) decides whether to ask first

Changed

- Format Document: comments that fill whole lines start at the beginning of the line; the lines of a multi-line comment are left as they are
- Format Document: the capture form of `<#assign>`, `<#local>`, and `<#global>` (`<#local x>...</#local>`) indents its content like a block

## 0.1.6 - 2026-10-18

Fixed

- Strings ending in an escaped backslash (e.g. `"{\\"`) no longer swallow the closing quote, which broke parsing of the rest of the tag
- Completion after `alias.` inside the arguments of a function call (e.g. `inhalt=_fn.zahlMitEinheit(0.25,_K.`) offers the members of the alias instead of the top-level names again
- Completion in a macro parameter value also works after a string ending in an escaped backslash (e.g. `<@m a="\\" b=alias.`)

## 0.1.5 - 2026-10-17

Changed

- Renamed to "FreeMarker (with IntelliSense)"

## 0.1.4 - 2026-10-17

Changed

- README: demo GIF of diagnostics, completion, signature help, hover, Go to Definition, and formatting, and an author's note

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
