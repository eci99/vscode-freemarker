# Changelog

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
