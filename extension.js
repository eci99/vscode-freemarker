const path = require('path');
const vscode = require('vscode');
const snippets = require('./snippets/freemarker.json');
const { BUILTINS, builtinBefore, builtinNameStart, builtinSignature, findBuiltin } = require('./builtins');
const { toggleBlockComment, toggleLineComments } = require('./comments');
const { formatTemplate } = require('./formatter');
const {
  DIRECTIVES,
  SPECIAL_VARIABLES,
  findDirective,
  findSpecialVariable,
  specialVariableNameStart
} = require('./directives');
const { enclosingRanges, selectionRanges } = require('./selection-ranges');
const { EXPRESSION_DIRECTIVES, expressionRegions, identifiers, semanticTokens } = require('./semantic-tokens');
const { displayText, isRawStringStart, normalizeTemplate, toSquareBracketTags } = require('./syntax');
const { analyzeExtraction, checkExpression, checkSelection } = require('./extract-macro');
const { findTagEnd, literalType, parseTemplate, symbolType } = require('./template-index');
const { htmlTags, templateBlocks, validateTemplate } = require('./validator');
const { wrapWithAbbreviation } = require('./wrap');
const { stageMovedTemplates } = require('./git-move');

const templatePattern = '**/*.{ftl,ftlh,ftlx}';
// For text that has already been rewritten to the default syntax.
const defaultSyntax = { tagSyntax: 'angleBracket', interpolationSyntax: 'legacy' };
const htmlVoidElements = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr'
]);
// Local variables are variables with the modifier 'local'.
const semanticTokensLegend = new vscode.SemanticTokensLegend(
  ['parameter', 'variable', 'namespace', 'macro', 'function'],
  ['local']
);
const pathTriggerCharacters = ['"', "'", '/'];
const htmlTagNamePattern = /^[A-Za-z][A-Za-z0-9:-]*$/;

const autoCloseDirectives = new Set([
  'if', 'list', 'foreach', 'switch', 'macro', 'function', 'attempt', 'compress',
  'noparse', 'outputformat', 'autoesc', 'noautoesc', 'escape', 'transform',
  'items', 'sep', 'assign', 'local', 'global'
]);

// Whether the offset is inside a string literal of a tag or interpolation, as in <#assign x = "|".
// The text is in the default syntax. An interpolation in a string is an expression again.
function isInStringLiteral(source, offset) {
  const stack = [];
  for (let index = 0; index < offset; index += 1) {
    const character = source[index];
    const top = stack[stack.length - 1];
    if (!top) {
      if (source.startsWith('<#--', index)) {
        const commentEnd = source.indexOf('-->', index + 4);
        if (commentEnd < 0 || commentEnd >= offset) return false;
        index = commentEnd + 2;
      } else if (/^<\/?[#@]/.test(source.slice(index, index + 3))) {
        stack.push({ kind: 'tag', quote: null, raw: false, parentheses: 0, braces: 0 });
      } else if ((character === '$' || character === '#') && source[index + 1] === '{') {
        stack.push({ kind: 'interpolation', quote: null, raw: false, parentheses: 0, braces: 0 });
        index += 1;
      }
    } else if (top.quote) {
      if (character === '\\' && !top.raw) {
        index += 1;
      } else if (character === top.quote) {
        top.quote = null;
      } else if (!top.raw && (character === '$' || character === '#') && source[index + 1] === '{') {
        stack.push({ kind: 'interpolation', quote: null, raw: false, parentheses: 0, braces: 0 });
        index += 1;
      }
    } else if (character === '"' || character === "'") {
      top.quote = character;
      top.raw = isRawStringStart(source, index);
    } else if (character === '(') {
      top.parentheses += 1;
    } else if (character === ')') {
      top.parentheses = Math.max(0, top.parentheses - 1);
    } else if (top.kind === 'tag' && character === '>' && top.parentheses === 0) {
      stack.pop();
    } else if (top.kind === 'interpolation' && character === '{') {
      top.braces += 1;
    } else if (top.kind === 'interpolation' && character === '}') {
      if (top.braces === 0) stack.pop();
      else top.braces -= 1;
    }
  }
  const innermost = stack[stack.length - 1];
  return Boolean(innermost && innermost.quote);
}

function closingTextAfterTypedTag(document, change, record) {
  if (change.rangeLength !== 0 || !['>', ']'].includes(change.text)) return undefined;
  const source = document.getText();
  const cursorOffset = change.rangeOffset + change.text.length;
  const angleStart = source.lastIndexOf('<', cursorOffset - 1);
  const squareStart = Math.max(
    source.lastIndexOf('[#', cursorOffset - 1),
    source.lastIndexOf('[@', cursorOffset - 1)
  );
  if (change.text === ']' && squareStart < 0) return undefined;
  if (change.text === '>' && squareStart > angleStart) return undefined;
  const tagStart = change.text === ']' ? squareStart : angleStart;
  if (tagStart < 0) return undefined;
  if (record && isInStringLiteral(record.source, tagStart)) return undefined;

  const opener = change.text === ']' ? '[' : '<';
  const ending = opener === '<' ? '>' : ']';
  if (change.text !== ending) return undefined;
  const tagText = source.slice(tagStart, cursorOffset);
  if (!tagText.endsWith(ending)) return undefined;
  const header = tagText.slice(1, -1);
  let quote = null;
  for (let index = 0; index < header.length; index += 1) {
    const character = header[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (opener === '<' && character === ending && !/^[#@]/.test(header)) {
      return undefined;
    }
  }
  if (quote) return undefined;
  if (header.startsWith('/') || /\/\s*$/.test(header)) return undefined;

  const special = /^([#@])([A-Za-z_][A-Za-z0-9_.-]*)\b/.exec(header);
  let closeTag;
  if (special) {
    if (special[1] === '#' && !autoCloseDirectives.has(special[2])) return undefined;
    closeTag = `${opener}/${special[1]}${special[2]}${ending}`;
    if (special[1] === '#' && ending === '>' && /\s>$/.test(header)) return undefined;
  } else {
    const html = /^([A-Za-z][A-Za-z0-9:-]*)\b/.exec(header);
    if (!html || htmlVoidElements.has(html[1].toLowerCase())) return undefined;
    closeTag = `</${html[1]}>`;
  }

  const remainder = source.slice(cursorOffset);
  if (remainder.startsWith(closeTag)) return undefined;
  return closeTag;
}

function closingTagAfterTypedSlash(document, change, record) {
  if (change.rangeLength !== 0 || change.text !== '/') return undefined;
  const source = document.getText();
  const opener = source[change.rangeOffset - 1];
  const squareSyntax = record.tagSyntax === 'square';
  if (opener !== '<' && !(opener === '[' && squareSyntax)) return undefined;
  if (isInStringLiteral(record.source, change.rangeOffset - 1)) return undefined;

  const sourceBeforeTag = record.source.slice(0, change.rangeOffset - 1);
  const candidates = htmlTags(sourceBeforeTag).unclosed.map((tag) => ({ ...tag, kind: 'html' }));
  if (opener === '[' || !squareSyntax) {
    candidates.push(...templateBlocks(sourceBeforeTag, defaultSyntax).unclosed
      .filter((block) => !block.optional)
      .map((block) => ({ ...block, kind: block.kind })));
  }
  candidates.sort((left, right) => right.offset - left.offset);
  const innermost = candidates[0];
  if (!innermost) return undefined;

  let closingText;
  if (innermost.kind === 'html') {
    closingText = `${innermost.name}>`;
  } else {
    const prefix = innermost.kind === 'directive' ? '#' : '@';
    closingText = `${prefix}${innermost.name}${squareSyntax ? ']' : '>'}`;
  }

  const cursorOffset = change.rangeOffset + change.text.length;
  if (record.source.slice(cursorOffset).startsWith(closingText)) return undefined;
  return closingText;
}

// The end tag that belonged to a start tag that a typed slash just made self-closing, as in
// <@render|></@render>, as offset and length; undefined if there is none.
function endTagAfterSelfClosingSlash(document, change, record) {
  if (change.rangeLength !== 0 || !['/', '>', ']'].includes(change.text)) return undefined;
  const source = record.source;
  // The offset of the slash before the end of the tag.
  const slash = change.text === '/' ? change.rangeOffset : change.rangeOffset - 1;
  if (source[slash] !== '/' || source[slash + 1] !== '>') return undefined;
  const tagStart = source.lastIndexOf('<', slash - 1);
  if (tagStart < 0 || isInStringLiteral(source, tagStart)) return undefined;

  // The pairs of start and end tags as they were before the tag was made self-closing.
  const before = `${source.slice(0, slash)}${source.slice(slash + 1)}`;
  let end;
  if (/^<[#@]/.test(source.slice(tagStart, tagStart + 2))) {
    const block = templateBlocks(before, defaultSyntax).blocks.find((candidate) => candidate.open.offset === tagStart);
    if (block) end = { offset: block.close.offset + 1, length: block.close.length };
  } else {
    const pair = htmlTags(before).pairs.find((candidate) => candidate.open === tagStart + 1);
    if (pair) end = { offset: pair.close - 1, length: before.indexOf('>', pair.close) + 3 - pair.close };
  }
  // A tag typed with its slash, as in <span/>, may come before the end tag of another
  // element; only the end tag right after it belongs to it.
  if (end && change.text !== '/' && end.offset !== slash + 2) return undefined;
  return end;
}

// The line and character of an offset in text, for files that are not open.
function textPosition(text, offset) {
  const lines = text.slice(0, offset).split('\n');
  return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
}

function syntaxOptions() {
  const configuration = vscode.workspace.getConfiguration('freemarker');
  return {
    tagSyntax: configuration.get('tagSyntax', 'auto'),
    interpolationSyntax: configuration.get('interpolationSyntax', 'legacy')
  };
}

class TemplateWorkspaceIndex {
  constructor() {
    this.records = new Map();
    this.folders = [];
    this.ready = Promise.resolve();
  }

  key(uri) {
    return path.resolve(uri.fsPath);
  }

  update(uri, text) {
    this.records.set(this.key(uri), {
      uri,
      ...parseTemplate(text, syntaxOptions())
    });
  }

  remove(uri) {
    this.records.delete(this.key(uri));
  }

  initialize() {
    this.folders = vscode.workspace.workspaceFolders || [];
    this.ready = vscode.workspace.findFiles(templatePattern, '**/{node_modules,.git}/**')
      .then((uris) => Promise.all(uris.map(async (uri) => {
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          this.update(uri, Buffer.from(bytes).toString('utf8'));
        } catch {
          this.remove(uri);
        }
      })));
    return this.ready;
  }

  currentRecord(document) {
    this.update(document.uri, document.getText());
    return this.records.get(this.key(document.uri));
  }

  // The directories a template path can start from, in the order they are searched.
  // Paths are resolved against the workspace folders too, but not suggested from there.
  templateBases(fromRecord, isRooted, workspaceFolders = true) {
    const bases = [];
    if (!isRooted && fromRecord.uri.scheme === 'file') bases.push(path.dirname(fromRecord.uri.fsPath));
    const folders = this.folders.filter((folder) => folder.uri.scheme === 'file');
    if (workspaceFolders) for (const folder of folders) bases.push(folder.uri.fsPath);

    const templateRoots = vscode.workspace.getConfiguration('freemarker').get('templateRoots', []);
    for (const folder of folders) {
      for (const root of templateRoots) bases.push(path.resolve(folder.uri.fsPath, root));
    }
    return bases;
  }

  // The templates and folders that can follow the part of an import or include path that is already typed.
  templatePathCompletions(record, document, position, typedPath) {
    const isRooted = typedPath.startsWith('/');
    const directory = typedPath.slice(0, typedPath.lastIndexOf('/') + 1);
    const range = new vscode.Range(
      document.positionAt(document.offsetAt(position) - (typedPath.length - directory.length)),
      position
    );
    const ownKey = this.key(record.uri);
    const items = new Map();
    const addItem = (name, isFolder, order, detail) => {
      const label = isFolder ? `${name}/` : name;
      if (items.has(label)) return;
      const item = new vscode.CompletionItem(label, isFolder ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File);
      item.insertText = label;
      item.range = range;
      item.detail = detail;
      item.sortText = `${order}_${isFolder ? '0' : '1'}_${name.toLowerCase()}`;
      // The next part of the path is suggested right away.
      if (isFolder) item.command = { command: 'editor.action.triggerSuggest', title: 'Suggest' };
      items.set(label, item);
    };

    this.templateBases(record, isRooted, false).forEach((base, order) => {
      const target = path.resolve(base, directory.replace(/^\/+/, ''));
      const isOwnDirectory = !isRooted && order === 0 && record.uri.scheme === 'file';
      // Only a path relative to the template itself can leave its starting directory.
      if (!isOwnDirectory && path.relative(base, target).startsWith('..')) return;
      for (const key of this.records.keys()) {
        if (key === ownKey) continue;
        const relative = path.relative(target, key);
        if (path.isAbsolute(relative)) continue;
        const segments = relative.split(path.sep);
        if (segments[0] === '..') {
          if (isOwnDirectory && /^(?:\.\.\/)*$/.test(directory)) addItem('..', true, order);
        } else if (segments.length > 1) {
          addItem(segments[0], true, order);
        } else {
          addItem(segments[0], false, order, vscode.workspace.asRelativePath ? vscode.workspace.asRelativePath(key) : undefined);
        }
      }
    });
    return [...items.values()];
  }

  resolveTemplate(fromRecord, templatePath) {
    const match = this.resolveTemplateBase(fromRecord, templatePath);
    return match && match.record;
  }

  // The template a path leads to, together with the directory it was found from.
  resolveTemplateBase(fromRecord, templatePath) {
    const cleanPath = templatePath.replace(/\\/g, '/');
    const isRooted = cleanPath.startsWith('/');
    const relativePath = cleanPath.replace(/^\/+/, '');
    const bases = this.templateBases(fromRecord, isRooted);
    const ownDirectory = !isRooted && fromRecord.uri.scheme === 'file';

    for (const [order, base] of bases.entries()) {
      const resolved = path.resolve(base, relativePath);
      const candidates = path.extname(resolved)
        ? [resolved]
        : [resolved, `${resolved}.ftl`, `${resolved}.ftlh`, `${resolved}.ftlx`];
      for (const candidate of candidates) {
        const record = this.records.get(path.resolve(candidate));
        if (record) return { record, base, isOwnDirectory: ownDirectory && order === 0 };
      }
    }
    return undefined;
  }

  // The templates that the given moves of files or folders take along: old key -> new path.
  movedTemplates(renames) {
    const moved = new Map();
    for (const { oldUri, newUri } of renames) {
      if (oldUri.scheme !== 'file' || newUri.scheme !== 'file') continue;
      const oldPath = path.resolve(oldUri.fsPath);
      const newPath = path.resolve(newUri.fsPath);
      for (const key of this.records.keys()) {
        const relative = path.relative(oldPath, key);
        // A moved folder takes all templates inside it along.
        if (!relative) moved.set(key, newPath);
        else if (!relative.startsWith('..') && !path.isAbsolute(relative)) moved.set(key, path.join(newPath, relative));
      }
    }
    return moved;
  }

  // The import and include paths that have to change so that they still lead to the same
  // templates after the given files or folders are moved. Each edit names the file at its new location.
  movedTemplateEdits(renames) {
    const moved = this.movedTemplates(renames);
    if (!moved.size) return [];
    const newLocation = (key) => moved.get(key) || key;

    const edits = [];
    for (const [key, record] of this.records) {
      if (record.uri.scheme !== 'file') continue;
      for (const directive of record.directives) {
        const match = this.resolveTemplateBase(record, directive.path);
        if (!match) continue;
        const targetKey = this.key(match.record.uri);
        if (!moved.has(key) && !moved.has(targetKey)) continue;
        const newPath = this.movedTemplatePath(record, directive.path, match, newLocation(key), newLocation(targetKey));
        if (!newPath || newPath === directive.path) continue;
        edits.push({
          fsPath: newLocation(key),
          start: textPosition(record.display, directive.pathOffset),
          end: textPosition(record.display, directive.pathOffset + directive.pathLength),
          newText: newPath
        });
      }
    }
    return edits;
  }

  // The path that leads from a template at recordPath to the one at targetPath, written like templatePath:
  // relative to the template itself or to the same template root, with or without a leading slash and extension.
  movedTemplatePath(record, templatePath, match, recordPath, targetPath) {
    const cleanPath = templatePath.replace(/\\/g, '/');
    const isRooted = cleanPath.startsWith('/');
    const isInside = (base) => {
      const relative = path.relative(base, targetPath);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    };

    let base = match.isOwnDirectory ? path.dirname(recordPath) : match.base;
    if (!match.isOwnDirectory && !isInside(base)) {
      // The template has left the root it was found in.
      base = isRooted
        ? this.templateBases(record, true).find(isInside)
        : path.dirname(recordPath);
      if (!base) return undefined;
    }

    let result = path.relative(base, targetPath).split(path.sep).join('/');
    if (!path.extname(cleanPath) && ['.ftl', '.ftlh', '.ftlx'].includes(path.extname(result))) {
      result = result.slice(0, -path.extname(result).length);
    }
    if (isRooted) return `/${result}`;
    if (cleanPath.startsWith('./') && !result.startsWith('../')) return `./${result}`;
    return result;
  }

  includedSymbols(record, visited = new Set()) {
    return this.includedRecords(record, visited)
      .flatMap((included) => included.symbols.map((symbol) => ({ symbol, record: included })));
  }

  includedRecords(record, visited = new Set()) {
    const recordKey = this.key(record.uri);
    if (visited.has(recordKey)) return [];
    visited.add(recordKey);

    const records = [record];
    for (const directive of record.directives) {
      if (directive.kind !== 'include') continue;
      const included = this.resolveTemplate(record, directive.path);
      if (included) records.push(...this.includedRecords(included, visited));
    }
    return records;
  }

  // The import that declares the alias, in the template or the templates it includes.
  importDirective(record, alias) {
    for (const source of this.includedRecords(record)) {
      const directive = source.directives.find((item) => item.kind === 'import' && item.alias === alias);
      if (directive) return { source, directive };
    }
    return undefined;
  }

  importedRecord(record, alias) {
    const found = this.importDirective(record, alias);
    return found && this.resolveTemplate(found.source, found.directive.path);
  }

  // The aliases in the qualified names of the template (alias.name, alias.nested.name),
  // each with the import that declares it.
  aliasUses(record) {
    const uses = [];
    const qualified = /\b((?:[A-Za-z_][A-Za-z0-9_]*\.)+)([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let match;
    while ((match = qualified.exec(record.source)) !== null) {
      if (record.source[match.index - 1] === '.'
        || !this.isFreeMarkerExpression(record.source, match.index, match.index)) continue;
      let owner = record;
      let segmentStart = match.index;
      for (const segment of match[1].slice(0, -1).split('.')) {
        const found = owner && this.importDirective(owner, segment);
        if (!found) break;
        uses.push({ offset: segmentStart, length: segment.length, ...found });
        owner = this.resolveTemplate(found.source, found.directive.path);
        segmentStart += segment.length + 1;
      }
    }
    return uses;
  }

  // The import whose alias is declared or used at the offset.
  aliasAt(record, offset) {
    const directive = record.directives.find((item) => item.kind === 'import' && item.alias
      && offset >= item.aliasOffset && offset <= item.aliasOffset + item.alias.length);
    if (directive) return { source: record, directive, offset: directive.aliasOffset, length: directive.alias.length };
    return this.aliasUses(record).find((use) => offset >= use.offset && offset <= use.offset + use.length);
  }

  // The declaration and the uses of the alias of an import, in all templates.
  async aliasLocations({ source, directive }) {
    const sourceKey = this.key(source.uri);
    const found = [{ record: source, offset: directive.aliasOffset, length: directive.alias.length }];
    for (const record of this.records.values()) {
      for (const use of this.aliasUses(record)) {
        if (this.key(use.source.uri) !== sourceKey || use.directive.aliasOffset !== directive.aliasOffset) continue;
        found.push({ record, offset: use.offset, length: use.length });
      }
    }
    const locations = [];
    for (const { record, offset, length } of found) {
      const document = await vscode.workspace.openTextDocument(record.uri);
      locations.push(new vscode.Location(record.uri, new vscode.Range(
        document.positionAt(offset), document.positionAt(offset + length)
      )));
    }
    return locations;
  }

  resolveNamespaceRecord(record, aliases, includePrivate = false) {
    let current = record;
    for (let index = 0; index < aliases.length; index += 1) {
      const alias = aliases[index];
      if (!includePrivate && index > 0 && this.isPrivateName(alias)) return undefined;
      current = this.importedRecord(current, alias);
      if (!current) return undefined;
    }
    return current;
  }

  // Documentation is written with angle bracket tags.
  tagText(record, text) {
    return record.tagSyntax === 'square' ? toSquareBracketTags(text) : text;
  }

  isPrivateName(name) {
    const prefix = vscode.workspace.getConfiguration('freemarker').get('privatePrefix', '_');
    return typeof prefix === 'string' && prefix.length > 0 && name.startsWith(prefix);
  }

  resolveNamespaceMember(record, segments, includePrivate = false) {
    if (segments.length < 2) return undefined;
    const localPath = segments.join('.');
    const localMember = this.includedSymbols(record)
      .find(({ symbol }) => symbol.kind === 'variable' && symbol.name === localPath);
    if (localMember) return localMember;

    const namespace = this.resolveNamespaceRecord(record, segments.slice(0, -1), includePrivate);
    if (namespace) {
      const member = this.includedSymbols(namespace).find(({ symbol }) => symbol.name === segments[segments.length - 1]);
      return member && (includePrivate || !this.isPrivateName(member.symbol.name)) ? member : undefined;
    }

    // A hash of an imported template: alias.hash.key
    for (let split = segments.length - 2; split > 0; split -= 1) {
      const owner = this.resolveNamespaceRecord(record, segments.slice(0, split), includePrivate);
      if (!owner) continue;
      const hashPath = segments.slice(split).join('.');
      const member = this.includedSymbols(owner).find(({ symbol }) => symbol.kind === 'variable' && symbol.name === hashPath);
      return member && (includePrivate || !this.isPrivateName(segments[split])) ? member : undefined;
    }
    return undefined;
  }

  nestedVariableDeclarations(record, pathPrefix) {
    const prefix = `${pathPrefix}.`;
    const declarations = new Map();
    for (const declaration of this.includedSymbols(record)) {
      const { symbol } = declaration;
      if (symbol.kind !== 'variable' || !symbol.name.startsWith(prefix)) continue;
      const childPath = symbol.name.slice(prefix.length);
      const childName = childPath.split('.')[0];
      if (!childName || declarations.has(childName)) continue;
      declarations.set(childName, {
        ...declaration,
        symbol: { ...symbol, name: childName }
      });
    }
    return [...declarations.values()];
  }

  namespaceDeclarations(record, includePrivate = false) {
    const declarations = this.includedSymbols(record)
      .filter(({ symbol }) => symbol.topLevel !== false
        && (includePrivate || !this.isPrivateName(symbol.name)));
    for (const source of this.includedRecords(record)) {
      for (const directive of source.directives) {
        if (directive.kind !== 'import' || !directive.alias || directive.topLevel === false) continue;
        const imported = this.resolveTemplate(source, directive.path);
        if (imported && (includePrivate || !this.isPrivateName(directive.alias))) {
          declarations.push({
            symbol: { name: directive.alias, kind: 'namespace' },
            record: imported,
            origin: source
          });
        }
      }
    }
    return declarations;
  }

  // What is visible where the cursor is: loop variables only inside their loop, and
  // the parameters and local variables of a macro or function only inside it.
  scopeDeclarations(record, offset, declarations) {
    const enclosing = templateBlocks(record.source, { tagSyntax: 'angleBracket' }).blocks.filter((block) =>
      block.kind === 'directive' && offset > block.open.offset + block.open.length && offset <= block.close.offset);
    const inOpenTag = (block, symbol) =>
      symbol.offset > block.open.offset && symbol.offset < block.open.offset + block.open.length;
    const loopPattern = /^[<[]#(?:list|items)\b/;
    const seenAliases = new Set();
    const scoped = declarations
      .filter(({ symbol, record: source }) =>
        // Keys of a hash are offered after its name and a dot.
        !(symbol.kind === 'variable' && symbol.name.includes('.'))
        && (!loopPattern.test(symbol.declaration || '')
          || (source === record && enclosing.some((block) => inOpenTag(block, symbol)))))
      .filter(({ symbol, origin }) => {
        if (symbol.kind !== 'namespace') return true;
        // An alias of an included template is private to it, and one name is shown once.
        if (origin !== record && this.isPrivateName(symbol.name)) return false;
        if (seenAliases.has(symbol.name)) return false;
        seenAliases.add(symbol.name);
        return true;
      });

    const callable = enclosing.filter((block) => block.name === 'macro' || block.name === 'function').pop();
    if (!callable) return scoped;
    const owner = record.symbols.find((symbol) =>
      (symbol.kind === 'macro' || symbol.kind === 'function') && inOpenTag(callable, symbol));
    const parameters = ((owner && owner.parameters) || []).map(({ name, defaultValue }) => ({
      symbol: { name, kind: 'variable', value: defaultValue, declaration: `Parameter of ${owner.name}` },
      record,
      origin: record
    }));
    const locals = record.symbols
      .filter((symbol) => symbol.topLevel === false && symbol.kind === 'variable'
        && symbol.offset > callable.open.offset && symbol.offset < offset
        && !loopPattern.test(symbol.declaration || ''))
      .map((symbol) => ({ symbol, record }));
    return [...scoped, ...parameters, ...locals];
  }

  // The names that only exist where the selection is: parameters of the macro or function,
  // loop variables, and local variables.
  visibleLocals(record, start, end) {
    const names = new Set();
    const blocks = templateBlocks(record.source, { tagSyntax: 'angleBracket' }).blocks;
    const encloses = (block) => block.open.offset + block.open.length <= start && block.close.offset >= end;
    for (const scope of this.parameters(record)) {
      if (encloses(scope.block)) scope.params.forEach(({ name }) => names.add(name));
    }
    const enclosing = blocks.filter(encloses);
    for (const symbol of record.symbols) {
      if (symbol.kind !== 'variable') continue;
      if (/^[<[]#(?:list|items)\b/.test(symbol.declaration || '')) {
        if (enclosing.some((block) => symbol.offset > block.open.offset && symbol.offset < block.open.offset + block.open.length)) {
          names.add(symbol.name);
        }
      } else if (symbol.topLevel === false && symbol.offset < start && enclosing.some((block) =>
        (block.name === 'macro' || block.name === 'function')
        && symbol.offset > block.open.offset && symbol.offset < block.close.offset)) {
        names.add(symbol.name);
      }
    }
    return names;
  }

  // Moves the selected part of a template into a new macro that is called in its place.
  async extractMacro(document, range) {
    await this.ready;
    const record = this.currentRecord(document);
    const text = document.getText();
    const { start, end } = this.wholeLines(text, document.offsetAt(range.start), document.offsetAt(range.end));

    const analysis = analyzeExtraction(record.source, start, end, this.visibleLocals(record, start, end));
    if (analysis.error) {
      vscode.window.showWarningMessage(this.tagText(record, `Extract to macro: ${analysis.error}`));
      return;
    }
    const taken = new Set(this.includedSymbols(record).map(({ symbol }) => symbol.name));
    const name = await vscode.window.showInputBox({
      prompt: 'Name of the new macro',
      validateInput: (value) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
        ? 'Use letters, digits, and underscores, and do not start with a digit.'
        : taken.has(value) ? `"${value}" is already defined.` : undefined
    });
    if (!name) return;

    const options = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document === document
      ? vscode.window.activeTextEditor.options : {};
    const unit = options.insertSpaces === false ? '\t' : ' '.repeat(Math.max(1, Number(options.tabSize) || 4));
    const newline = text.includes('\r\n') ? '\r\n' : '\n';

    // Whole lines are replaced together with their indentation.
    const { lineStart, lineEnd, indent, wholeLines } = this.lineLayout(text, start, end);

    const call = this.tagText(record, `<@${name}${analysis.parameters.map((parameter) => ` ${parameter}=${parameter}`).join('')} />`);
    const replaceStart = wholeLines ? lineStart : start;
    const replaceEnd = wholeLines ? lineEnd : end;

    const lines = text.slice(start, end).split(/\r?\n/);
    const rest = lines.slice(1).filter((line) => line.trim());
    const restIndent = rest.length ? Math.min(...rest.map((line) => line.length - line.trimStart().length)) : 0;
    const base = wholeLines ? Math.min(indent.length, restIndent) : restIndent;
    const body = lines.map((line, index) => line.trim()
      ? unit + (index === 0 ? line : line.slice(Math.min(base, line.length - line.trimStart().length)))
      : '').join(newline);
    const definition = [
      this.tagText(record, `<#macro ${name}${analysis.parameters.map((parameter) => ` ${parameter}`).join('')}>`),
      body,
      this.tagText(record, '</#macro>')
    ].join(newline);

    // After the macro or function that contains the selection, otherwise at the end.
    const container = templateBlocks(record.source, { tagSyntax: 'angleBracket' }).blocks
      .filter((block) => block.kind === 'directive' && (block.name === 'macro' || block.name === 'function')
        && block.open.offset + block.open.length <= start && block.close.offset >= end)
      .sort((left, right) => left.open.offset - right.open.offset)[0];
    const insertAt = container ? container.close.offset + container.close.length : text.length;
    const separator = container || !text.endsWith('\n') ? newline + newline : newline;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(replaceStart), document.positionAt(replaceEnd)),
      wholeLines ? indent + call : call);
    edit.insert(document.uri, document.positionAt(insertAt), `${separator}${definition}${container ? '' : newline}`);
    await vscode.workspace.applyEdit(edit);
  }

  // The macro or function that contains source[start, end), the innermost one.
  enclosingCallable(record, start, end) {
    return templateBlocks(record.source, { tagSyntax: 'angleBracket' }).blocks
      .filter((block) => block.kind === 'directive' && (block.name === 'macro' || block.name === 'function')
        && block.open.offset + block.open.length <= start && block.close.offset >= end)
      .sort((left, right) => right.open.offset - left.open.offset)[0];
  }

  // The kinds of extraction the selected expression allows: function, assign, and local
  // inside a macro or function. Nothing if the selection is not a whole expression.
  expressionExtractions(record, start, end) {
    const checked = checkExpression(record.source, start, end);
    if (checked.error) return [];
    return this.enclosingCallable(record, checked.start, checked.end)
      ? ['function', 'local', 'assign'] : ['function', 'assign'];
  }

  // Moves the selected expression into a new function that is called in its place, or into a
  // variable (<#assign> or <#local>) that is set before the tag or interpolation it is in.
  async extractExpression(document, range, kind) {
    await this.ready;
    const record = this.currentRecord(document);
    const text = document.getText();
    const label = kind === 'function' ? 'Extract to function' : this.tagText(record, `Extract to <#${kind}>`);
    const checked = checkExpression(record.source, document.offsetAt(range.start), document.offsetAt(range.end));
    const container = !checked.error && this.enclosingCallable(record, checked.start, checked.end);
    const error = checked.error || (kind === 'local' && !container ? 'The selection is not inside a macro or function.' : undefined);
    if (error) {
      vscode.window.showWarningMessage(`${label}: ${this.tagText(record, error)}`);
      return;
    }
    const { start, end } = checked;
    const locals = this.visibleLocals(record, start, end);
    const taken = new Set([...this.includedSymbols(record).map(({ symbol }) => symbol.name), ...locals]);
    const name = await vscode.window.showInputBox({
      prompt: kind === 'function' ? 'Name of the new function' : 'Name of the new variable',
      validateInput: (value) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
        ? 'Use letters, digits, and underscores, and do not start with a digit.'
        : taken.has(value) ? `"${value}" is already defined.` : undefined
    });
    if (!name) return;

    const square = record.tagSyntax === 'square';
    const tag = (content) => (square ? `[${content}]` : `<${content}>`);
    let expression = text.slice(start, end);
    // A > that was fine in an interpolation would end an angle bracket tag.
    if (!square && findTagEnd(`<#return ${expression}>`, 1) !== `<#return ${expression}>`.length - 1) {
      expression = `(${expression})`;
    }
    const options = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document === document
      ? vscode.window.activeTextEditor.options : {};
    const unit = options.insertSpaces === false ? '\t' : ' '.repeat(Math.max(1, Number(options.tabSize) || 4));
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const edit = new vscode.WorkspaceEdit();

    if (kind === 'function') {
      const parameters = [];
      for (const { name: used, member, assigned } of identifiers(record.source, start, end)) {
        if (!member && !assigned && locals.has(used) && !parameters.includes(used)) parameters.push(used);
      }
      const definition = [
        tag(`#function ${name}${parameters.map((parameter) => ` ${parameter}`).join('')}`),
        `${unit}${tag(`#return ${expression}`)}`,
        tag('/#function')
      ].join(newline);
      // After the macro or function that contains the selection, otherwise at the end.
      const insertAt = container ? container.close.offset + container.close.length : text.length;
      const separator = container || !text.endsWith('\n') ? newline + newline : newline;
      edit.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)),
        `${name}(${parameters.join(', ')})`);
      edit.insert(document.uri, document.positionAt(insertAt), `${separator}${definition}${container ? '' : newline}`);
    } else {
      // Before the line of the tag or interpolation, or before the block whose branch it is,
      // such as the <#if> of an <#elseif>.
      let anchor = checked.outer.tagStart ?? checked.outer.start - 2;
      const branchOf = templateBlocks(record.source, { tagSyntax: 'angleBracket' }).blocks
        .find((block) => block.branches.some((branch) => branch.offset === anchor));
      if (branchOf) anchor = branchOf.open.offset;
      if (kind === 'local' && anchor <= container.open.offset) {
        vscode.window.showWarningMessage(`${label}: ${this.tagText(record, 'The expression must be in the body of the macro or function.')}`);
        return;
      }
      const { lineStart } = this.lineLayout(text, anchor, anchor);
      const indent = /^[ \t]*/.exec(text.slice(lineStart))[0];
      edit.insert(document.uri, document.positionAt(lineStart), `${indent}${tag(`#${kind} ${name} = ${expression}`)}${newline}`);
      edit.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), name);
    }
    await vscode.workspace.applyEdit(edit);
  }

  // The selection widened to the whole lines it touches, without the indentation of the
  // first line and the whitespace after the last. A selection that ends at the start of a
  // line does not include that line.
  wholeLines(text, start, end) {
    if (end > start && text[end - 1] === '\n') end -= text[end - 2] === '\r' ? 2 : 1;
    const layout = this.lineLayout(text, start, end);
    start = layout.lineStart;
    end = layout.lineEnd;
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    return { start, end };
  }

  // Where the lines of a selection are, and whether it covers them completely.
  lineLayout(text, start, end) {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd < 0) lineEnd = text.length;
    if (text[lineEnd - 1] === '\r') lineEnd -= 1;
    const indent = text.slice(lineStart, start);
    return { lineStart, lineEnd, indent, wholeLines: !indent.trim() && !text.slice(end, lineEnd).trim() };
  }

  // Wraps the selection in <#list> or <#if>; what is missing in the opening tag is a snippet placeholder.
  async surroundWith(document, range, directive) {
    await this.ready;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) return;
    const record = this.currentRecord(document);
    const text = document.getText();
    const { start, end } = this.wholeLines(text, document.offsetAt(range.start), document.offsetAt(range.end));

    const checked = checkSelection(record.source, start, end);
    if (checked.error) {
      vscode.window.showWarningMessage(this.tagText(record, `Surround with <#${directive}>: ${checked.error}`));
      return;
    }
    const options = editor.options || {};
    const unit = options.insertSpaces === false ? '\t' : ' '.repeat(Math.max(1, Number(options.tabSize) || 4));
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const escape = (value) => value.replace(/[\\$}]/g, '\\$&');
    const openTag = this.tagText(record, directive === 'list' ? '<#list ${1:items} as ${2:item}>' : '<#if ${1:condition}>');
    const closeTag = this.tagText(record, `</#${directive}>`);

    const { lineStart, lineEnd, indent, wholeLines } = this.lineLayout(text, start, end);
    let snippet;
    let target;
    if (wholeLines) {
      const body = text.slice(lineStart, lineEnd).split(/\r?\n/).map((line) => (line.trim() ? unit + escape(line) : ''));
      snippet = `${indent}${openTag}${newline}${body.join(newline)}${newline}${indent}${closeTag}`;
      target = new vscode.Range(document.positionAt(lineStart), document.positionAt(lineEnd));
    } else {
      snippet = `${openTag}${escape(text.slice(start, end))}${closeTag}`;
      target = new vscode.Range(document.positionAt(start), document.positionAt(end));
    }
    await editor.insertSnippet(new vscode.SnippetString(snippet), target);
  }

  // Wraps the selection in the tags of an Emmet-like abbreviation, such as div.card>#if or ul>li*.
  // Whole lines get a tag per line; a selection inside a line is wrapped on that line.
  async wrapWithAbbreviation(document, range) {
    await this.ready;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) return;
    const record = this.currentRecord(document);
    const text = document.getText();
    let start = document.offsetAt(range.start);
    let end = document.offsetAt(range.end);
    // A selection that ends at the start of a line does not include that line.
    if (end > start && text[end - 1] === '\n') end -= text[end - 2] === '\r' ? 2 : 1;
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    if (start === end) return;

    const options = editor.options || {};
    const { lineStart, lineEnd, indent, wholeLines } = this.lineLayout(text, start, end);
    const wrapOptions = {
      tagSyntax: record.tagSyntax,
      block: wholeLines,
      indent,
      unit: options.insertSpaces === false ? '\t' : ' '.repeat(Math.max(1, Number(options.tabSize) || 4)),
      newline: text.includes('\r\n') ? '\r\n' : '\n'
    };
    const selected = text.slice(start, end);
    const abbreviation = await vscode.window.showInputBox({
      prompt: 'Abbreviation, such as div.card, ul>li*, #if>p, or @card[title="x"]',
      validateInput: (value) => value.trim() && wrapWithAbbreviation(value, selected, wrapOptions).error
    });
    if (!abbreviation) return;
    const wrapped = wrapWithAbbreviation(abbreviation, selected, wrapOptions);
    if (wrapped.error) {
      vscode.window.showWarningMessage(`Wrap with abbreviation: ${wrapped.error}`);
      return;
    }
    const target = wholeLines
      ? new vscode.Range(document.positionAt(lineStart), document.positionAt(lineEnd))
      : new vscode.Range(document.positionAt(start), document.positionAt(end));
    await editor.insertSnippet(new vscode.SnippetString(wrapped.snippet), target);
  }

  macroArgumentCompletions(record, source, cursorOffset) {
    const beforeCursor = source.slice(0, cursorOffset);
    const tagStart = beforeCursor.lastIndexOf('<@');
    if (tagStart < 0 || source[tagStart - 1] === '/') return undefined;
    const typedInvocation = /^([A-Za-z_][A-Za-z0-9_.]*)(\s+)/.exec(beforeCursor.slice(tagStart + 2));
    if (!typedInvocation) return undefined;

    let quote = null;
    let tagEnd = -1;
    for (let index = tagStart + 2; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === '\\') index += 1;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        tagEnd = index;
        break;
      }
    }
    if (tagEnd >= 0 && cursorOffset > tagEnd) return undefined;

    const invocationText = source.slice(tagStart + 2, tagEnd < 0 ? source.length : tagEnd);
    const invocation = /^([A-Za-z_][A-Za-z0-9_.]*)([\s\S]*)$/.exec(invocationText);
    if (!invocation || !/^\s/.test(invocation[2])) return undefined;

    quote = null;
    for (let index = 0; index < invocation[2].length; index += 1) {
      const character = invocation[2][index];
      if (quote) {
        if (character === '\\') index += 1;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      }
    }
    if (quote) return undefined;

    const macroPath = invocation[1].split('.');
    const declaration = macroPath.length > 1
      ? this.resolveNamespaceMember(record, macroPath)
      : this.includedSymbols(record).find(({ symbol }) =>
        symbol.kind === 'macro' && symbol.name === invocation[1]
      );
    if (!declaration || declaration.symbol.kind !== 'macro') return undefined;

    const usedParameters = this.namedArguments(invocation[2]);
    return declaration.symbol.parameters
      .filter(({ name }) => !usedParameters.has(name))
      .map(({ name, defaultValue }) => {
        const label = defaultValue === undefined ? `${name} (Required)` : `${name}=${defaultValue}`;
        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Property);
        item.insertText = `${name}=`;
        item.detail = `Parameter of ${declaration.symbol.name}`;
        if (defaultValue !== undefined) item.documentation = new vscode.MarkdownString(`Default: \`${defaultValue}\``);
        item.sortText = name.toLowerCase();
        return item;
      });
  }

  // The cursor is after the = of a named argument, as in <@macro name=|.
  isMacroArgumentValue(source, offset) {
    const before = source.slice(0, offset);
    const tagStart = before.lastIndexOf('<@');
    if (tagStart < 0) return false;
    const body = before.slice(tagStart + 2);
    if (!/^[A-Za-z_][A-Za-z0-9_.]*\s/.test(body)) return false;
    let quote = null;
    for (let index = 0; index < body.length; index += 1) {
      const character = body[index];
      if (quote) {
        if (character === '\\') index += 1;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        return false;
      }
    }
    if (quote) return false;
    return /\s[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[A-Za-z_][A-Za-z0-9_.]*)?$/.test(body)
      // Inside the parentheses of a call in a value: <@macro name=function(|
      || (/\s[A-Za-z_][A-Za-z0-9_]*\s*=/.test(body) && this.openCall(source.slice(0, offset)) !== undefined);
  }

  namedArguments(text, entries = []) {
    const names = new Set();
    let quote = null;
    let nesting = 0;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quote) {
        if (character === '\\') index += 1;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === '(' || character === '[' || character === '{') {
        nesting += 1;
        continue;
      }
      if (character === ')' || character === ']' || character === '}') {
        nesting = Math.max(0, nesting - 1);
        continue;
      }
      if (nesting > 0 || !/[A-Za-z_]/.test(character) || (index > 0 && !/\s/.test(text[index - 1]))) continue;

      const nameStart = index;
      while (/[A-Za-z0-9_]/.test(text[index] || '')) index += 1;
      const name = text.slice(nameStart, index);
      while (/\s/.test(text[index] || '')) index += 1;
      if (text[index] === '=') {
        names.add(name);
        entries.push({ name, offset: nameStart });
      }
      index -= 1;
    }
    return names;
  }

  hasUnresolvedIncludes(record) {
    return this.includedRecords(record).some((included) =>
      included.directives.some((directive) =>
        directive.kind === 'include' && !this.resolveTemplate(included, directive.path)
      )
    );
  }

  // Aliases that no import declares: the first name of a macro call such as <@cardz.render />,
  // which can only be a namespace, and a name after a namespace that the imported template
  // neither imports nor declares, as in toolkit.nestd.render. A name such as ${user.name} may
  // come from the data model, which the warning about undeclared names covers. A template
  // that is included sees the aliases and variables of the templates that include it.
  wrongAliases(record) {
    const issues = [];
    const { source } = record;
    const includers = [...this.records.values()]
      .filter((other) => other !== record && this.includesRecord(other, this.key(record.uri)));
    const visibleFrom = [record, ...includers];
    const parameterScopes = this.parameters(record);
    const qualified = /(?<![A-Za-z0-9_.?])([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)/g;
    let match;
    while ((match = qualified.exec(source)) !== null) {
      if (!this.isFreeMarkerExpression(source, match.index, match.index)) continue;
      const segments = match[1].split('.');
      let owner = record;
      let segmentStart = match.index;
      for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        const found = index === 0
          ? visibleFrom.map((other) => this.importDirective(other, segment)).find(Boolean)
          : this.importDirective(owner, segment);
        if (found) {
          owner = this.resolveTemplate(found.source, found.directive.path);
          if (!owner) break;
          segmentStart += segment.length + 1;
          continue;
        }
        if (index === 0) {
          const declared = visibleFrom.some((other) => this.includedSymbols(other).some(({ symbol }) => symbol.name === segment))
            || parameterScopes.some(({ params, block }) => block.open.offset < segmentStart && segmentStart < block.close.offset
              && params.some((param) => param.name === segment));
          if (this.isMacroInvocation(source, match.index) && !declared) {
            issues.push({
              message: `"${segment}" is not the alias of an <#import>.`,
              offset: segmentStart,
              length: segment.length
            });
          }
        } else if (!this.includedSymbols(owner).some(({ symbol }) => symbol.name === segment)
          && !this.hasUnresolvedIncludes(owner)) {
          issues.push({
            message: `"${segment}" is not the alias of an <#import> in namespace "${segments.slice(0, index).join('.')}" (${path.basename(owner.uri.fsPath)}).`,
            offset: segmentStart,
            length: segment.length
          });
        }
        break;
      }
    }
    return issues.map((issue) => ({ ...issue, message: this.tagText(record, issue.message) }));
  }

  // Problems that only show up with knowledge of the other templates in the workspace.
  semanticIssues(record) {
    const issues = [];
    const { source } = record;

    if (vscode.workspace.getConfiguration('freemarker').get('validateTemplatePaths', true)) {
      for (const directive of record.directives) {
        const beforePath = source.slice(directive.offset, directive.pathOffset - 1);
        const afterPath = source.slice(directive.pathOffset + directive.pathLength + 1, directive.endOffset - 1);
        const isLiteralPath = /^<#(?:import|include)\s+r?$/.test(beforePath)
          && !/^\s*[+?\[(]/.test(afterPath)
          && !/[*$#]/.test(directive.path);
        if (!isLiteralPath || /\bignore_missing\s*=\s*true\b/.test(afterPath)) continue;
        if (this.resolveTemplate(record, directive.path)) continue;
        issues.push({
          message: `Template "${directive.path}" was not found in the workspace or the configured template roots.`,
          offset: directive.pathOffset,
          length: directive.pathLength,
          severity: 'warning'
        });
      }
    }

    const visible = this.includedSymbols(record);
    const invocations = /<@([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/g;
    let match;
    while ((match = invocations.exec(source)) !== null) {
      const segments = match[1].split('.');
      const memberName = segments[segments.length - 1];
      const nameOffset = match.index + 2;
      let declaration;
      if (segments.length === 1) {
        declaration = visible.find(({ symbol }) => symbol.kind === 'macro' && symbol.name === memberName);
      } else {
        if (visible.some(({ symbol }) => symbol.kind === 'variable' && symbol.name === segments[0])) continue;
        const namespace = this.resolveNamespaceRecord(record, segments.slice(0, -1), true);
        if (!namespace) continue;
        declaration = this.includedSymbols(namespace).find(({ symbol }) => symbol.name === memberName);
        if (!declaration) {
          if (this.importedRecord(namespace, memberName) || this.hasUnresolvedIncludes(namespace)) continue;
          issues.push({
            message: `"${memberName}" is not defined in namespace "${segments.slice(0, -1).join('.')}" (${path.basename(namespace.uri.fsPath)}).`,
            offset: nameOffset + match[1].length - memberName.length,
            length: memberName.length,
            severity: 'warning'
          });
          continue;
        }
      }
      if (!declaration || declaration.symbol.kind !== 'macro') continue;

      const tagEnd = findTagEnd(source, invocations.lastIndex);
      if (tagEnd < 0) continue;
      const argumentText = source.slice(invocations.lastIndex, tagEnd).replace(/\/\s*$/, '');
      const entries = [];
      const supplied = this.namedArguments(argumentText, entries);
      // A macro with a catch-all parameter (others...) takes any argument.
      if (!/\w\s*\.\.\./.test(declaration.symbol.declaration || '')) {
        for (const { name, offset } of entries) {
          if ((declaration.symbol.parameters || []).some((parameter) => parameter.name === name)) continue;
          issues.push({
            message: `Macro "${declaration.symbol.name}" has no parameter "${name}".`,
            offset: invocations.lastIndex + offset,
            length: name.length
          });
        }
      }
      // Positional arguments cannot be matched to parameter names reliably.
      if (supplied.size === 0 && argumentText.split(';')[0].trim()) continue;
      const missing = (declaration.symbol.parameters || [])
        .filter(({ name, defaultValue }) => defaultValue === undefined && !supplied.has(name))
        .map(({ name }) => `"${name}"`);
      if (missing.length > 0) {
        issues.push({
          message: `Missing required parameter${missing.length > 1 ? 's' : ''} ${missing.join(', ')} for macro "${declaration.symbol.name}".`,
          offset: nameOffset,
          length: match[1].length,
          severity: 'warning'
        });
      }
    }

    // The data model is not known, so a name that is declared nowhere is only an information.
    // Names from a template that was not found could be among the missing ones.
    if (!this.hasUnresolvedIncludes(record)) {
      const qualified = /(?<![A-Za-z0-9_.?])([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)/g;
      while ((match = qualified.exec(source)) !== null) {
        if (!this.isFreeMarkerExpression(source, match.index, match.index)) continue;
        const segments = match[1].split('.');
        const memberName = segments[segments.length - 1];
        if (visible.some(({ symbol }) => symbol.kind === 'variable' && symbol.name === segments[0])) continue;
        const namespace = this.resolveNamespaceRecord(record, segments.slice(0, -1), true);
        if (!namespace || this.hasUnresolvedIncludes(namespace)) continue;
        if (this.includedSymbols(namespace).some(({ symbol }) => symbol.name === memberName)
          || this.importedRecord(namespace, memberName)) continue;
        issues.push({
          message: `"${memberName}" is not defined in namespace "${segments.slice(0, -1).join('.')}" (${path.basename(namespace.uri.fsPath)}).`,
          offset: match.index + match[1].length - memberName.length,
          length: memberName.length,
          severity: 'warning'
        });
      }
      const wrongAliases = this.wrongAliases(record);
      issues.push(...wrongAliases);
      const reportUndeclared = vscode.workspace.getConfiguration('freemarker').get('validateUndeclaredNames', true);
      for (const token of reportUndeclared ? semanticTokens(source, { ...this.declaredElsewhere(record), reportUnknown: true }) : []) {
        if (token.type !== 'unknown' || wrongAliases.some((issue) => issue.offset === token.offset)) continue;
        issues.push({
          message: `"${source.slice(token.offset, token.offset + token.length)}" is not declared in this template or the ones it includes or imports. It may come from the data model.`,
          offset: token.offset,
          length: token.length,
          severity: 'info'
        });
      }
    }
    return issues;
  }

  documentLinks(record, document) {
    return record.directives.flatMap((directive) => {
      const target = this.resolveTemplate(record, directive.path);
      if (!target) return [];
      const link = new vscode.DocumentLink(
        new vscode.Range(
          document.positionAt(directive.pathOffset),
          document.positionAt(directive.pathOffset + directive.pathLength)
        ),
        target.uri
      );
      link.tooltip = 'Open template';
      return [link];
    });
  }

  async workspaceSymbols(query) {
    await this.ready;
    const wanted = query.toLowerCase();
    const matchesQuery = (name) => {
      let position = 0;
      for (const character of name.toLowerCase()) {
        if (character === wanted[position]) position += 1;
      }
      return position === wanted.length;
    };

    const results = [];
    for (const record of this.records.values()) {
      const lineStarts = [0];
      for (let index = record.source.indexOf('\n'); index >= 0; index = record.source.indexOf('\n', index + 1)) {
        lineStarts.push(index + 1);
      }
      const positionAt = (offset) => {
        let line = lineStarts.length - 1;
        while (lineStarts[line] > offset) line -= 1;
        return new vscode.Position(line, offset - lineStarts[line]);
      };
      for (const symbol of record.symbols) {
        if (symbol.topLevel === false
          || symbol.name.includes('.')
          || /^[<[]#(?:list|items)\b/.test(symbol.declaration || '')
          || !matchesQuery(symbol.name)) continue;
        const kind = symbol.kind === 'macro'
          ? vscode.SymbolKind.Method
          : symbol.kind === 'function'
            ? vscode.SymbolKind.Function
            : vscode.SymbolKind.Variable;
        results.push(new vscode.SymbolInformation(
          symbol.name,
          kind,
          path.basename(record.uri.fsPath),
          new vscode.Location(record.uri, new vscode.Range(
            positionAt(symbol.offset),
            positionAt(symbol.offset + symbol.length)
          ))
        ));
      }
    }
    return results;
  }

  foldingRanges(document) {
    const text = document.getText();
    const ranges = [];
    const lineOf = (offset) => document.positionAt(offset).line;

    // Each branch of a block, such as the parts before and after <#else>, folds separately.
    for (const block of templateBlocks(text, syntaxOptions()).blocks) {
      const tags = [block.open, ...block.branches, block.close];
      for (let index = 0; index < tags.length - 1; index += 1) {
        ranges.push({ start: lineOf(tags[index].offset), end: lineOf(tags[index + 1].offset) - 1 });
      }
    }

    const comments = /<#--[\s\S]*?-->/g;
    const normalizedText = normalizeTemplate(text, syntaxOptions()).text;
    let match;
    while ((match = comments.exec(normalizedText)) !== null) {
      ranges.push({
        start: lineOf(match.index),
        end: lineOf(match.index + match[0].length),
        kind: vscode.FoldingRangeKind.Comment
      });
    }

    // Registering a provider turns off the editor's own indentation folding, which the
    // HTML between the FreeMarker tags still needs.
    const lines = text.split(/\r?\n/);
    const open = [];
    let lastContentLine = -1;
    const closeDeeperThan = (indentation) => {
      while (open.length > 0 && open[open.length - 1].indentation >= indentation) {
        ranges.push({ start: open.pop().line, end: lastContentLine });
      }
    };
    lines.forEach((line, lineNumber) => {
      if (!line.trim()) return;
      const indentation = line.length - line.trimStart().length;
      closeDeeperThan(indentation);
      open.push({ line: lineNumber, indentation });
      lastContentLine = lineNumber;
    });
    closeDeeperThan(0);

    const starts = new Set();
    return ranges
      .filter(({ start, end }) => end > start && !starts.has(start) && starts.add(start))
      .map(({ start, end, kind }) => new vscode.FoldingRange(start, end, kind));
  }

  documentHighlights(document, position) {
    const offset = document.offsetAt(position);
    for (const block of templateBlocks(document.getText(), syntaxOptions()).blocks) {
      const tags = [block.open, ...block.branches, block.close];
      if (!tags.some((tag) => offset >= tag.offset && offset <= tag.offset + tag.nameLength)) continue;
      return tags.map((tag) => new vscode.DocumentHighlight(new vscode.Range(
        document.positionAt(tag.offset),
        document.positionAt(tag.offset + tag.nameLength)
      )));
    }
    return undefined;
  }

  openCall(source) {
    const parentheses = [];
    // What was open outside of an interpolation that is inside of a string: "text ${|"
    const interpolations = [];
    let quote = null;
    let braces = 0;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === '\\') {
          index += 1;
        } else if (character === quote) {
          quote = null;
        } else if ((character === '$' || character === '#') && source[index + 1] === '{') {
          interpolations.push({ quote, parentheses: parentheses.length, braces });
          quote = null;
          braces = 0;
          index += 1;
        }
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '(') {
        parentheses.push(index);
      } else if (character === ')') {
        parentheses.pop();
      } else if (character === '{') {
        braces += 1;
      } else if (character === '}') {
        if (braces > 0) {
          braces -= 1;
        } else if (interpolations.length > 0) {
          const outer = interpolations.pop();
          quote = outer.quote;
          parentheses.length = outer.parentheses;
          braces = outer.braces;
        }
      }
    }

    const opening = parentheses[parentheses.length - 1];
    if (opening === undefined || !this.isFreeMarkerExpression(source, opening, source.length)) return undefined;
    return opening;
  }

  functionCallContext(record, source, includePrivate = false) {
    const opening = this.openCall(source);
    if (opening === undefined) return undefined;
    const functionMatch = /((?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(source.slice(0, opening));
    if (!functionMatch) return undefined;

    const functionPath = functionMatch[1].split('.');
    const declaration = functionPath.length > 1
      ? this.resolveNamespaceMember(record, functionPath, includePrivate)
      : this.includedSymbols(record).find(({ symbol }) =>
        symbol.kind === 'function' && symbol.name === functionPath[0]
      );
    if (!declaration || declaration.symbol.kind !== 'function') return undefined;

    return { declaration, ...this.callArguments(source, opening) };
  }

  callArguments(source, opening) {
    let argumentIndex = 0;
    let nesting = 0;
    let quote = null;
    const suppliedArguments = [];
    let argumentStart = opening + 1;
    for (let index = opening + 1; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === '\\') index += 1;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '(' || character === '[' || character === '{') {
        nesting += 1;
      } else if (character === ')' || character === ']' || character === '}') {
        if (nesting === 0) {
          suppliedArguments.push(displayText(source.slice(argumentStart, index)).trim());
          break;
        }
        nesting -= 1;
      } else if (character === ',' && nesting === 0) {
        suppliedArguments.push(displayText(source.slice(argumentStart, index)).trim());
        argumentStart = index + 1;
        argumentIndex += 1;
      }
    }
    if (argumentStart <= source.length && suppliedArguments.length === argumentIndex) {
      suppliedArguments.push(displayText(source.slice(argumentStart)).trim());
    }

    return { argumentIndex, suppliedArguments };
  }

  builtinSignatureHelp(record, source) {
    const opening = this.openCall(source);
    const builtin = opening === undefined ? undefined : builtinBefore(source.slice(0, opening));
    if (!builtin || builtin.parameters === undefined) return undefined;

    const signature = new vscode.SignatureInformation(
      `?${builtinSignature(builtin)}`,
      new vscode.MarkdownString(this.tagText(record, builtin.description))
    );
    let parameterStart = builtin.name.length + 2;
    signature.parameters = builtin.parameters.split(', ').map((parameter) => {
      const range = [parameterStart, parameterStart + parameter.length];
      parameterStart += parameter.length + 2;
      return new vscode.ParameterInformation(
        range,
        new vscode.MarkdownString(parameter.endsWith('?') ? 'Optional' : parameter.endsWith('...') ? 'Repeatable' : '*(Required)*')
      );
    });

    const help = new vscode.SignatureHelp();
    help.signatures = [signature];
    help.activeSignature = 0;
    help.activeParameter = Math.min(this.callArguments(source, opening).argumentIndex, signature.parameters.length - 1);
    return help;
  }

  functionArgumentCompletions(record, source) {
    const context = this.functionCallContext(record, source);
    if (!context) return undefined;

    const { declaration, argumentIndex, suppliedArguments } = context;


    const parameter = declaration.symbol.parameters[argumentIndex];
    if (!parameter) return [];
    const parameterList = declaration.symbol.parameters.map(({ name, defaultValue }, index) => {
      const suppliedValue = suppliedArguments[index];
      const parameterText = suppliedValue
        ? `\`${name}\` = \`${suppliedValue.replace(/`/g, '\\`')}\``
        : defaultValue === undefined
          ? `\`${name}\` (Required)`
          : `\`${name}\` = \`${defaultValue.replace(/`/g, '\\`')}\``;
      return index === argumentIndex ? `- **${parameterText}**` : `- ${parameterText}`;
    }).join('\n');

    const candidates = this.namespaceDeclarations(record, true)
      .filter(({ symbol }) => symbol.kind === 'variable' || symbol.kind === 'namespace');
    const seen = new Set();
    return candidates.filter(({ symbol }) => {
      if (seen.has(symbol.name)) return false;
      seen.add(symbol.name);
      return true;
    }).map(({ symbol, record: sourceRecord }) => {
      const kind = symbol.kind === 'namespace'
        ? vscode.CompletionItemKind.Module
        : vscode.CompletionItemKind.Variable;
      const value = typeof symbol.value === 'string' ? symbol.value.replace(/\s+/g, ' ').trim() : undefined;
      const label = symbol.kind === 'variable' && value !== undefined
        ? `${symbol.name} = ${value.length > 60 ? `${value.slice(0, 57)}...` : value}`
        : symbol.name;
      const item = new vscode.CompletionItem(label, kind);
      item.insertText = symbol.name;
      item.detail = path.basename(sourceRecord.uri.fsPath);
      item.documentation = new vscode.MarkdownString(
        `Arguments for ${declaration.symbol.name}\n\n${parameterList}`
      );
      item.sortText = `${symbol.kind === 'namespace' ? '0' : '1'}_${symbol.name.toLowerCase()}`;
      return item;
    });
  }

  async signatureHelp(document, position) {
    await this.ready;
    const record = this.currentRecord(document);
    const offset = document.offsetAt(position);
    const beforeCursor = record.source.slice(0, offset);
    const builtinHelp = this.builtinSignatureHelp(record, beforeCursor);
    if (builtinHelp) return builtinHelp;
    const context = this.functionCallContext(record, beforeCursor, true);
    if (!context) return undefined;

    const { declaration, argumentIndex } = context;
    const parameters = declaration.symbol.parameters || [];
    const paramInfos = parameters.map(({ name, defaultValue }) => {
      const label = defaultValue !== undefined ? `${name}=${defaultValue}` : name;
      const doc = defaultValue !== undefined
        ? new vscode.MarkdownString(`Default: \`${defaultValue}\``)
        : new vscode.MarkdownString('*(Required)*');
      return new vscode.ParameterInformation(label, doc);
    });

    const paramLabels = paramInfos.map((p) => p.label).join(', ');
    const signatureLabel = `${declaration.symbol.name}(${paramLabels})`;
    const signature = new vscode.SignatureInformation(
      signatureLabel,
      declaration.symbol.documentation ? new vscode.MarkdownString(declaration.symbol.documentation) : undefined
    );
    signature.parameters = paramInfos;

    const help = new vscode.SignatureHelp();
    help.signatures = [signature];
    help.activeSignature = 0;
    help.activeParameter = parameters.length > 0 ? argumentIndex : 0;
    return help;
  }

  isInterpolationContext(source, offset) {
    const beforeCursor = source.slice(0, offset);
    const openingOffset = Math.max(beforeCursor.lastIndexOf('${'), beforeCursor.lastIndexOf('#{'));
    if (openingOffset < 0) return false;

    let quote = null;
    let nesting = 0;
    for (let index = openingOffset + 2; index < beforeCursor.length; index += 1) {
      const character = beforeCursor[index];
      if (quote) {
        if (character === '\\') index += 1;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '{') {
        nesting += 1;
      } else if (character === '}') {
        if (nesting === 0) return false;
        nesting -= 1;
      }
    }
    return quote === null;
  }

  isFreeMarkerExpression(source, tokenStart, cursorOffset) {
    const openings = ['${', '#{', '<#', '<@', '</@'];
    let openingOffset = -1;
    let opening = '';
    for (const candidate of openings) {
      const candidateOffset = source.lastIndexOf(candidate, cursorOffset);
      if (candidateOffset > openingOffset) {
        openingOffset = candidateOffset;
        opening = candidate;
      }
    }
    if (openingOffset < 0) return false;

    // A > in parentheses, as in <#if (a > 1)>, does not end the tag.
    const closingOffset = opening === '${' || opening === '#{'
      ? source.indexOf('}', openingOffset + opening.length)
      : findTagEnd(source, openingOffset + opening.length);
    if (closingOffset >= 0 && cursorOffset > closingOffset) return false;

    let quote = null;
    for (let index = openingOffset + opening.length; index < tokenStart; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === '\\') index += 1;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      }
    }
    return quote === null;
  }

  isMacroInvocation(source, tokenStart) {
    const prefix = source.slice(0, tokenStart);
    return prefix.endsWith('<@') || prefix.endsWith('</@');
  }

  definitionLocation(record, symbol) {
    const start = record.uri;
    const startPosition = new vscode.Position(0, 0);
    const documentOffset = symbol.offset;
    return vscode.workspace.openTextDocument(start).then((document) => {
      const rangeStart = document.positionAt(documentOffset);
      const rangeEnd = document.positionAt(documentOffset + symbol.length);
      return new vscode.Location(record.uri, new vscode.Range(rangeStart, rangeEnd));
    }, () => new vscode.Location(record.uri, startPosition));
  }

  async documentSymbols(document) {
    await this.ready;
    const record = this.currentRecord(document);
    const declarations = record.symbols
      .filter((symbol) => symbol.topLevel !== false
        && !symbol.name.includes('.')
        && !/^[<[]#(?:list|items)\b/.test(symbol.declaration || ''))
      .map((symbol) => {
        const declarationStart = symbol.declaration
          ? record.display.lastIndexOf(symbol.declaration, symbol.offset)
          : symbol.offset;
        const rangeStart = declarationStart >= 0 ? declarationStart : symbol.offset;
        const rangeEnd = symbol.declaration
          ? rangeStart + symbol.declaration.length
          : symbol.offset + symbol.length;
        const kind = symbol.kind === 'macro'
          ? vscode.SymbolKind.Method
          : symbol.kind === 'function'
            ? vscode.SymbolKind.Function
            : vscode.SymbolKind.Variable;
        return new vscode.DocumentSymbol(
          symbol.name,
          symbol.kind,
          kind,
          new vscode.Range(document.positionAt(rangeStart), document.positionAt(rangeEnd)),
          new vscode.Range(
            document.positionAt(symbol.offset),
            document.positionAt(symbol.offset + symbol.length)
          )
        );
      });
    const templateDirectives = record.directives
      .filter((directive) => directive.topLevel !== false)
      .map((directive) => {
        const name = directive.alias || directive.path;
        const selectionStart = directive.alias ? directive.aliasOffset : directive.pathOffset;
        const selectionLength = directive.alias ? directive.alias.length : directive.pathLength;
        const kind = directive.kind === 'import'
          ? vscode.SymbolKind.Module
          : vscode.SymbolKind.File;
        return new vscode.DocumentSymbol(
          name,
          `${directive.kind} ${directive.path}`,
          kind,
          new vscode.Range(
            document.positionAt(directive.offset),
            document.positionAt(directive.endOffset)
          ),
          new vscode.Range(
            document.positionAt(selectionStart),
            document.positionAt(selectionStart + selectionLength)
          )
        );
      });
    // In the order of the template, which the outline can sort by name or kind itself.
    const offsetOf = (symbol) => document.offsetAt(symbol.range.start);
    return [...templateDirectives, ...declarations].sort((left, right) => offsetOf(left) - offsetOf(right));
  }

  // The parameters of the macros and functions of a template: where each is declared and
  // where it is used in the body.
  parameters(record) {
    const { source } = record;
    const regions = expressionRegions(source);
    const namePattern = /^([A-Za-z_][A-Za-z0-9_]*)(?:\.\.\.|=[\s\S]*)?$/;
    return templateBlocks(source, { tagSyntax: 'angleBracket' }).blocks
      .filter((block) => block.kind === 'directive' && (block.name === 'macro' || block.name === 'function'))
      .flatMap((block) => {
        const tag = source.slice(block.open.offset, block.open.offset + block.open.length);
        const header = /^<#(?:macro|function)\s+[A-Za-z_][A-Za-z0-9_.-]*/.exec(tag);
        if (!header) return [];

        const text = tag.slice(header[0].length, -1);
        const tokens = [];
        let start = -1;
        let quote = null;
        let nesting = 0;
        for (let index = 0; index <= text.length; index += 1) {
          const character = text[index];
          if (quote) {
            if (character === '\\') index += 1;
            else if (character === quote) quote = null;
            continue;
          }
          if (character === '"' || character === "'") {
            quote = character;
          } else if (character === '(' || character === '[' || character === '{') {
            nesting += 1;
          } else if (character === ')' || character === ']' || character === '}') {
            nesting = Math.max(0, nesting - 1);
          }
          if (index === text.length || (/\s/.test(character) && nesting === 0)) {
            if (start >= 0) tokens.push({ text: text.slice(start, index).replace(/,$/, ''), start });
            start = -1;
          } else if (start < 0) {
            start = index;
          }
        }

        const params = [];
        for (let index = 0; index < tokens.length; index += 1) {
          const match = namePattern.exec(tokens[index].text);
          if (!match) continue;
          params.push({
            name: match[1],
            offset: block.open.offset + header[0].length + tokens[index].start,
            length: match[1].length
          });
          // The rest of a default value that has spaces in it.
          while (tokens[index].text.includes('=') && index + 1 < tokens.length && !namePattern.test(tokens[index + 1].text)) {
            index += 1;
          }
        }

        const bodyStart = block.open.offset + block.open.length;
        const uses = [];
        for (const region of regions) {
          if (region.start < bodyStart || region.start >= block.close.offset) continue;
          if (!(region.kind === undefined || region.kind === '@' || EXPRESSION_DIRECTIVES.has(region.name))) continue;
          for (const { name, offset, member, assigned } of identifiers(source, region.start, region.end)) {
            if (!member && !assigned && params.some((param) => param.name === name)) {
              uses.push({ name, offset, length: name.length });
            }
          }
        }
        return [{ params, uses, owner: record.symbols.find((symbol) =>
          (symbol.kind === 'macro' || symbol.kind === 'function')
          && symbol.offset > block.open.offset && symbol.offset < block.open.offset + block.open.length), block }];
      });
  }

  // The named arguments with the name of the parameter in the calls of its macro.
  async namedArgumentRanges(document, parameter) {
    if (!parameter.owner || parameter.owner.kind !== 'macro') return [];
    const calls = await this.references(document, document.positionAt(parameter.owner.offset));
    const ranges = [];
    for (const call of calls) {
      const record = this.records.get(this.key(call.uri));
      if (!record) continue;
      const callDocument = await vscode.workspace.openTextDocument(call.uri);
      const afterName = callDocument.offsetAt(call.range.end);
      const tagEnd = findTagEnd(record.source, afterName);
      if (tagEnd < 0) continue;
      const entries = [];
      this.namedArguments(record.source.slice(afterName, tagEnd), entries);
      for (const { name, offset } of entries) {
        if (name !== parameter.name) continue;
        ranges.push({
          uri: call.uri,
          range: new vscode.Range(
            callDocument.positionAt(afterName + offset),
            callDocument.positionAt(afterName + offset + name.length)
          )
        });
      }
    }
    return ranges;
  }

  // The parameter that is declared or used at the offset.
  parameterAt(record, offset) {
    for (const scope of this.parameters(record)) {
      for (const param of scope.params) {
        const uses = scope.uses.filter((use) => use.name === param.name);
        const hit = [param, ...uses].find((item) => offset >= item.offset && offset <= item.offset + item.length);
        if (hit) return { name: param.name, declaration: param, uses, hit, owner: scope.owner };
      }
    }
    return undefined;
  }

  async definition(document, position) {
    await this.ready;
    const record = this.currentRecord(document);
    const offset = document.offsetAt(position);
    const parameter = this.parameterAt(record, offset);
    if (parameter) {
      const locate = (item) => new vscode.Location(document.uri, new vscode.Range(
        document.positionAt(item.offset), document.positionAt(item.offset + item.length)
      ));
      if (parameter.hit !== parameter.declaration) return locate(parameter.declaration);
      return parameter.uses.length ? parameter.uses.map(locate) : undefined;
    }
    const declaredCallable = record.symbols.find((symbol) =>
      (symbol.kind === 'macro' || symbol.kind === 'function')
      && offset >= symbol.offset
      && offset <= symbol.offset + symbol.length
    );
    if (declaredCallable) {
      const references = await this.references(document, position);
      return references.length ? references : undefined;
    }

    for (const directive of record.directives) {
      if (offset >= directive.pathOffset && offset <= directive.pathOffset + directive.pathLength) {
        const target = this.resolveTemplate(record, directive.path);
        if (target) return new vscode.Location(target.uri, new vscode.Position(0, 0));
      }
      if (directive.alias && offset >= directive.aliasOffset && offset <= directive.aliasOffset + directive.alias.length) {
        const target = this.resolveTemplate(record, directive.path);
        if (target) return new vscode.Location(target.uri, new vscode.Position(0, 0));
      }
    }

    const qualified = /\b((?:[A-Za-z_][A-Za-z0-9_]*\.)+)([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let match;
    while ((match = qualified.exec(record.source)) !== null) {
      const segments = `${match[1]}${match[2]}`.split('.');
      let segmentStart = match.index;
      for (let index = 0; index < segments.length - 1; index += 1) {
        const segmentEnd = segmentStart + segments[index].length;
        if (offset >= segmentStart && offset <= segmentEnd) {
          const namespace = this.resolveNamespaceRecord(record, segments.slice(0, index + 1), true);
          if (namespace) return new vscode.Location(namespace.uri, new vscode.Position(0, 0));
          const hash = index > 0 && this.resolveNamespaceMember(record, segments.slice(0, index + 1), true);
          if (hash) return this.definitionLocation(hash.record, hash.symbol);
        }
        segmentStart = segmentEnd + 1;
      }

      const memberOffset = match.index + match[0].length - match[2].length;
      if (offset < memberOffset || offset > memberOffset + match[2].length) continue;
      const localPath = segments.join('.');
      const localDeclaration = this.includedSymbols(record)
        .find(({ symbol }) => symbol.kind === 'variable' && symbol.name === localPath);
      if (localDeclaration) return this.definitionLocation(localDeclaration.record, localDeclaration.symbol);
      const declaration = this.resolveNamespaceMember(record, segments, true);
      if (declaration) return this.definitionLocation(declaration.record, declaration.symbol);
    }

    const included = this.includedSymbols(record);
    const identifiers = /[A-Za-z_][A-Za-z0-9_.-]*/g;
    while ((match = identifiers.exec(record.source)) !== null) {
      if (offset < match.index || offset > match.index + match[0].length) continue;
      const before = record.source.slice(Math.max(0, match.index - 2), match.index);
      const after = record.source.slice(match.index + match[0].length);
      const declaration = included.find(({ symbol }) => symbol.name === match[0]);
      if (!declaration) continue;
      if (declaration.symbol.kind === 'variable'
        && this.isFreeMarkerExpression(record.source, match.index, offset)) {
        return this.definitionLocation(declaration.record, declaration.symbol);
      }
      if (!match[0].includes('.') && (this.isMacroInvocation(record.source, match.index) || /^\s*\(/.test(after))) {
        return this.definitionLocation(declaration.record, declaration.symbol);
      }
    }
    return undefined;
  }

  async hover(document, position) {
    await this.ready;
    const record = this.currentRecord(document);
    const offset = document.offsetAt(position);
    const words = /[A-Za-z_][A-Za-z0-9_]*/g;
    let selectedWord;
    let match;
    while ((match = words.exec(record.source)) !== null) {
      if (offset >= match.index && offset <= match.index + match[0].length) {
        selectedWord = { name: match[0], start: match.index, end: match.index + match[0].length };
        break;
      }
    }
    if (!selectedWord) return undefined;

    const beforeWord = record.source.slice(Math.max(0, selectedWord.start - 2), selectedWord.start);
    if (builtinNameStart(beforeWord) >= 0
      && this.isFreeMarkerExpression(record.source, selectedWord.start, offset)) {
      const builtin = findBuiltin(selectedWord.name);
      if (!builtin) return undefined;
      const parts = [
        `**built-in ${builtin.name}**`,
        this.tagText(record, builtin.description),
        `\`\`\`ftl\n?${builtinSignature(builtin)}\n\`\`\``,
        `Applies to: ${builtin.category}`
      ];
      if (builtin.deprecated) parts.push('Deprecated');
      return new vscode.Hover(
        new vscode.MarkdownString(parts.join('\n\n')),
        new vscode.Range(document.positionAt(selectedWord.start), document.positionAt(selectedWord.end))
      );
    }

    const wordRange = new vscode.Range(document.positionAt(selectedWord.start), document.positionAt(selectedWord.end));
    if (/<\/?#$/.test(record.source.slice(Math.max(0, selectedWord.start - 3), selectedWord.start))) {
      const directive = findDirective(selectedWord.name);
      if (!directive) return undefined;
      const parts = [
        `**directive ${directive.name}**`,
        this.tagText(record, directive.description),
        `\`\`\`ftl\n${this.tagText(record, directive.syntax)}\n\`\`\``
      ];
      if (directive.deprecated) parts.push('Deprecated');
      return new vscode.Hover(new vscode.MarkdownString(parts.join('\n\n')), wordRange);
    }
    if (specialVariableNameStart(beforeWord) >= 0
      && this.isFreeMarkerExpression(record.source, selectedWord.start, offset)) {
      const variable = findSpecialVariable(selectedWord.name);
      if (!variable) return undefined;
      return new vscode.Hover(
        new vscode.MarkdownString(`**special variable .${variable.name}**\n\n${this.tagText(record, variable.description)}`),
        wordRange
      );
    }

    const chains = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/g;
    let chain;
    while ((chain = chains.exec(record.source)) !== null) {
      if (offset >= chain.index && offset <= chain.index + chain[0].length) break;
    }

    let symbolRecord = record;
    let symbol;
    let namespaceName;
    let namespaceRecord;
    if (chain && chain[0].includes('.')) {
      const segments = chain[0].split('.');
      const selectedIndex = segments.findIndex((_, index) => {
        const segmentStart = chain.index + segments.slice(0, index).reduce((length, segment) => length + segment.length + 1, 0);
        return offset >= segmentStart && offset <= segmentStart + segments[index].length;
      });

      if (selectedIndex === 0) {
        namespaceName = segments[0];
        namespaceRecord = this.resolveNamespaceRecord(record, [namespaceName]);
      } else {
        const parent = this.resolveNamespaceRecord(record, segments.slice(0, selectedIndex));
        const candidateNamespace = parent && this.importedRecord(parent, segments[selectedIndex]);
        if (candidateNamespace) {
          namespaceName = segments.slice(0, selectedIndex + 1).join('.');
          namespaceRecord = candidateNamespace;
        } else {
          const localPath = segments.join('.');
          const local = this.includedSymbols(record).find(({ symbol: item }) =>
            item.kind === 'variable' && item.name === localPath
          );
          const member = local || (parent && this.includedSymbols(parent).find(({ symbol: item }) =>
            item.name === segments[selectedIndex]
          )) || this.resolveNamespaceMember(record, segments.slice(0, selectedIndex + 1), true);
          if (member) {
            symbolRecord = member.record;
            symbol = member.symbol;
          }
        }
      }
    } else {
      const declared = record.symbols.find((item) =>
        offset >= item.offset && offset <= item.offset + item.length
      );
      const local = declared && { symbol: declared, record };
      const visible = local || this.includedSymbols(record).find(({ symbol: item }) => item.name === selectedWord.name);
      if (visible) {
        symbol = visible.symbol;
        symbolRecord = visible.record;
      } else {
        const namespace = this.namespaceDeclarations(record, true).find(({ symbol: item }) =>
          item.kind === 'namespace' && item.name === selectedWord.name
        );
        if (namespace) {
          namespaceName = namespace.symbol.name;
          namespaceRecord = namespace.record;
        }
      }
    }

    const range = new vscode.Range(document.positionAt(selectedWord.start), document.positionAt(selectedWord.end));
    if (namespaceRecord) {
      const members = this.namespaceDeclarations(namespaceRecord)
        .map(({ symbol: item }) => `\`${item.name}${item.kind === 'function' || item.kind === 'macro' ? '()' : ''}\``)
        .join(', ');
      const memberList = members ? `\n\nMembers: ${members}` : '';
      return new vscode.Hover(new vscode.MarkdownString(
        `**Namespace \`${namespaceName}\`**\n\nTemplate: \`${path.basename(namespaceRecord.uri.fsPath)}\`${memberList}`
      ), range);
    }
    if (!symbol) return undefined;

    const parts = [`**${symbol.kind} ${symbol.name}**`];
    if (symbol.documentation) parts.push(symbol.documentation);
    if (symbol.kind === 'variable') {
      if (typeof symbol.value === 'string') parts.push(`Value: \`${symbol.value.replace(/`/g, '\\`')}\``);
      if (symbol.declaration) parts.push(`\`\`\`ftl\n${symbol.declaration}\n\`\`\``);
    } else {
      if (symbol.declaration) parts.push(`\`\`\`ftl\n${symbol.declaration}\n\`\`\``);
      if (symbol.parameters && symbol.parameters.length) {
        const parameters = symbol.parameters.map(({ name, defaultValue }) =>
          defaultValue === undefined ? `- \`${name}\` (Required)` : `- \`${name}\` = \`${defaultValue}\``
        );
        parts.push(`Parameters\n\n${parameters.join('\n')}`);
      }
    }
    parts.push(`Source: \`${path.basename(symbolRecord.uri.fsPath)}\``);
    return new vscode.Hover(new vscode.MarkdownString(parts.join('\n\n')), range);
  }

  async symbolAt(document, position) {
    await this.ready;
    const record = this.currentRecord(document);
    const offset = document.offsetAt(position);
    const declared = record.symbols.find((symbol) =>
      offset >= symbol.offset && offset <= symbol.offset + symbol.length
    );
    if (declared) return { record, symbol: declared };

    const location = await this.definition(document, position);
    if (!location) return undefined;
    const targetLocation = Array.isArray(location) ? location[0] : location;
    if (!targetLocation) return undefined;
    const targetRecord = this.records.get(this.key(targetLocation.uri));
    if (!targetRecord) return undefined;

    const targetDocument = await vscode.workspace.openTextDocument(targetLocation.uri);
    const targetOffset = targetDocument.offsetAt(targetLocation.range.start);
    const symbol = targetRecord.symbols.find((item) => item.offset === targetOffset);
    return symbol ? { record: targetRecord, symbol } : undefined;
  }

  includesRecord(record, targetKey, visited = new Set()) {
    const recordKey = this.key(record.uri);
    if (visited.has(recordKey)) return false;
    visited.add(recordKey);
    if (recordKey === targetKey) return true;

    for (const directive of record.directives) {
      if (directive.kind !== 'include') continue;
      const included = this.resolveTemplate(record, directive.path);
      if (included && this.includesRecord(included, targetKey, visited)) return true;
    }
    return false;
  }

  async references(document, position) {
    await this.ready;
    const parameter = this.parameterAt(this.currentRecord(document), document.offsetAt(position));
    if (parameter) {
      return parameter.uses.map((use) => new vscode.Location(document.uri, new vscode.Range(
        document.positionAt(use.offset), document.positionAt(use.offset + use.length)
      )));
    }
    const alias = this.aliasAt(this.currentRecord(document), document.offsetAt(position));
    if (alias) return (await this.aliasLocations(alias)).slice(1);
    const target = await this.symbolAt(document, position);
    if (!target) return [];

    const targetKey = this.key(target.record.uri);
    const targetOffset = target.symbol.offset;
    const results = [];
    const seen = new Set();
    const addLocation = async (record, offset, length) => {
      const key = `${this.key(record.uri)}:${offset}`;
      if (seen.has(key)) return;
      seen.add(key);
      const sourceDocument = await vscode.workspace.openTextDocument(record.uri);
      results.push(new vscode.Location(record.uri, new vscode.Range(
        sourceDocument.positionAt(offset),
        sourceDocument.positionAt(offset + length)
      )));
    };

    for (const record of this.records.values()) {
      const qualified = /\b((?:[A-Za-z_][A-Za-z0-9_]*\.)+)([A-Za-z_][A-Za-z0-9_]*)\b/g;
      let match;
      while ((match = qualified.exec(record.source)) !== null) {
        const segments = `${match[1]}${match[2]}`.split('.');
        const fullPath = segments.join('.');
        if (match[2] !== target.symbol.name && fullPath !== target.symbol.name) continue;
        const member = this.resolveNamespaceMember(record, segments, true);
        if (!member) continue;
        if (member.symbol.offset !== targetOffset || this.key(member.record.uri) !== targetKey) continue;
        const invocationEnd = match.index + match[0].length;
        if (member.symbol.kind === 'macro' && !this.isMacroInvocation(record.source, match.index)) continue;
        if (member.symbol.kind === 'function' && !/^\s*\(/.test(record.source.slice(invocationEnd))) continue;
        const memberOffset = match.index + match[0].lastIndexOf(match[2]);
        await addLocation(record, memberOffset, match[2].length);
      }

      if (!this.includesRecord(record, targetKey)) continue;
      const identifiers = /[A-Za-z_][A-Za-z0-9_]*/g;
      while ((match = identifiers.exec(record.source)) !== null) {
        if (match[0] !== target.symbol.name) continue;
        if (this.key(record.uri) === targetKey && match.index === targetOffset) continue;
        const before = record.source.slice(Math.max(0, match.index - 2), match.index);
        const after = record.source.slice(match.index + match[0].length);
        if (before.endsWith('.') || !this.isFreeMarkerExpression(record.source, match.index, match.index)) continue;

        const visible = this.includedSymbols(record).some(({ symbol, record: source }) =>
          symbol.name === target.symbol.name
          && symbol.offset === targetOffset
          && this.key(source.uri) === targetKey
        );
        if (!visible) continue;

        if (target.symbol.kind === 'macro' && !this.isMacroInvocation(record.source, match.index)) continue;
        if (target.symbol.kind === 'function' && !/^\s*\(/.test(after)) continue;
        await addLocation(record, match.index, match[0].length);
      }
    }

    return results;
  }

  // Colors names by what they are, which the grammar cannot tell.
  declaredElsewhere(record) {
    const included = this.namespaceDeclarations(record, true).filter(({ symbol, record: source }) =>
      (source !== record || symbol.kind === 'namespace')
      && !/^[<[]#(?:list|items)\b/.test(symbol.declaration || ''));
    const names = (kind) => included.filter(({ symbol }) => symbol.kind === kind).map(({ symbol }) => symbol.name);
    return { variables: names('variable'), functions: names('function'), namespaces: names('namespace') };
  }

  async semanticTokens(document) {
    await this.ready;
    const record = this.currentRecord(document);
    const builder = new vscode.SemanticTokensBuilder(semanticTokensLegend);
    const declaredElsewhere = this.declaredElsewhere(record);
    for (const token of semanticTokens(record.source, declaredElsewhere)) {
      builder.push(
        new vscode.Range(document.positionAt(token.offset), document.positionAt(token.offset + token.length)),
        token.type,
        token.local ? ['local'] : []
      );
    }
    return builder.build();
  }

  // The names in the start and end tag of the HTML element whose start tag is at the
  // position. An end tag is not renamed.
  htmlTagNames(document, position) {
    const offset = document.offsetAt(position);
    const pair = htmlTags(this.currentRecord(document).source).pairs.find((candidate) =>
      offset >= candidate.open && offset <= candidate.open + candidate.openLength
    );
    if (!pair) return undefined;
    return [[pair.open, pair.openLength], [pair.close, pair.closeLength]].map(([start, length]) =>
      new vscode.Range(document.positionAt(start), document.positionAt(start + length))
    );
  }

  async prepareRename(document, position) {
    const htmlTagNames = this.htmlTagNames(document, position);
    if (htmlTagNames) {
      return { range: htmlTagNames[0], placeholder: document.getText(htmlTagNames[0]) };
    }

    await this.ready;
    const parameter = this.parameterAt(this.currentRecord(document), document.offsetAt(position));
    if (parameter) {
      const { offset, length } = parameter.hit;
      return {
        range: new vscode.Range(document.positionAt(offset), document.positionAt(offset + length)),
        placeholder: parameter.name
      };
    }
    const alias = this.aliasAt(this.currentRecord(document), document.offsetAt(position));
    if (alias) {
      return {
        range: new vscode.Range(document.positionAt(alias.offset), document.positionAt(alias.offset + alias.length)),
        placeholder: alias.directive.alias
      };
    }
    const target = await this.symbolAt(document, position);
    if (!target) return undefined;

    const record = this.currentRecord(document);
    let wordName;
    let range;

    if (typeof document.getWordRangeAtPosition === 'function') {
      const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
      if (wordRange) {
        range = wordRange;
        wordName = document.getText(wordRange);
      }
    }

    if (!range) {
      const offset = document.offsetAt(position);
      const words = /[A-Za-z_][A-Za-z0-9_]*/g;
      let match;
      while ((match = words.exec(record.source)) !== null) {
        if (offset >= match.index && offset <= match.index + match[0].length) {
          wordName = match[0];
          range = new vscode.Range(
            document.positionAt(match.index),
            document.positionAt(match.index + match[0].length)
          );
          break;
        }
      }
    }

    if (!range || !wordName) return undefined;

    const leafName = target.symbol.name.split('.').pop();
    if (wordName !== leafName) return undefined;

    return { range, placeholder: leafName };
  }

  async rename(document, position, newName) {
    const htmlTagNames = this.htmlTagNames(document, position);
    if (htmlTagNames) {
      if (!newName || !htmlTagNamePattern.test(newName)) {
        throw new Error(`'${newName}' is not a valid HTML tag name.`);
      }
      const edit = new vscode.WorkspaceEdit();
      for (const range of htmlTagNames) edit.replace(document.uri, range, newName);
      return edit;
    }

    if (!newName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) {
      throw new Error(`'${newName}' is not a valid FreeMarker identifier.`);
    }

    await this.ready;
    const parameter = this.parameterAt(this.currentRecord(document), document.offsetAt(position));
    if (parameter) {
      const parameterEdit = new vscode.WorkspaceEdit();
      for (const { offset, length } of [parameter.declaration, ...parameter.uses]) {
        parameterEdit.replace(document.uri, new vscode.Range(
          document.positionAt(offset), document.positionAt(offset + length)
        ), newName);
      }
      for (const { uri: callUri, range } of await this.namedArgumentRanges(document, parameter)) {
        parameterEdit.replace(callUri, range, newName);
      }
      return parameterEdit;
    }
    const alias = this.aliasAt(this.currentRecord(document), document.offsetAt(position));
    if (alias) {
      if (newName !== alias.directive.alias && this.importDirective(alias.source, newName)) {
        throw new Error(`'${newName}' is already the alias of another import.`);
      }
      const aliasEdit = new vscode.WorkspaceEdit();
      for (const { uri: aliasUri, range } of await this.aliasLocations(alias)) {
        aliasEdit.replace(aliasUri, range, newName);
      }
      return aliasEdit;
    }
    const target = await this.symbolAt(document, position);
    if (!target) return undefined;

    const references = await this.references(document, position);
    const edit = new vscode.WorkspaceEdit();
    const seen = new Set();
    const addEdit = (targetUri, range) => {
      const key = `${targetUri.toString()}:${range.start.line}:${range.start.character}`;
      if (seen.has(key)) return;
      seen.add(key);
      edit.replace(targetUri, range, newName);
    };

    const declDocument = await vscode.workspace.openTextDocument(target.record.uri);
    const declRange = new vscode.Range(
      declDocument.positionAt(target.symbol.offset),
      declDocument.positionAt(target.symbol.offset + target.symbol.length)
    );
    addEdit(target.record.uri, declRange);

    for (const ref of references) {
      addEdit(ref.uri, ref.range);
    }

    return edit;
  }

  // The type of the expression a built-in is applied to, named like the built-in categories.
  builtinTargetType(record, target) {
    if (/["']$/.test(target)) return 'string';
    const literal = /(?:^|[^A-Za-z0-9_.?])(0[xX][0-9A-Fa-f]+|\d+(?:\.\d+)?|true|false)$/.exec(target);
    if (literal) return literalType(literal[1]);

    const chain = /(^|[^A-Za-z0-9_.?\])])((?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Za-z_][A-Za-z0-9_]*)$/.exec(target);
    if (!chain) return undefined;
    const segments = chain[2].split('.');
    if (segments.length > 1) {
      const member = this.resolveNamespaceMember(record, segments, true);
      return member && member.symbol.kind === 'variable' ? symbolType(member.symbol) : undefined;
    }

    const candidates = this.includedSymbols(record)
      .filter(({ symbol }) => symbol.kind === 'variable' && symbol.name === segments[0]);
    const declaredBefore = candidates
      .filter((candidate) => candidate.record === record && candidate.symbol.offset < target.length);
    const declaration = declaredBefore[declaredBefore.length - 1] || candidates[0];
    return declaration && symbolType(declaration.symbol);
  }

  builtinCompletions(record, targetType) {
    return BUILTINS.map((builtin) => {
      const item = new vscode.CompletionItem(builtinSignature(builtin), vscode.CompletionItemKind.Function);
      item.detail = `${builtin.category} built-in`;
      item.documentation = new vscode.MarkdownString(this.tagText(record, builtin.description));
      item.filterText = builtin.name;
      item.insertText = builtin.name;
      item.sortText = `${builtin.category === targetType ? 0 : 1}_${builtin.name}`;
      if (builtin.deprecated) item.tags = [vscode.CompletionItemTag.Deprecated];
      return item;
    });
  }

  directiveCompletions(record) {
    return DIRECTIVES.map((directive) => {
      const item = new vscode.CompletionItem(directive.name, vscode.CompletionItemKind.Keyword);
      item.detail = this.tagText(record, directive.syntax);
      item.documentation = new vscode.MarkdownString(this.tagText(record, directive.description));
      if (directive.deprecated) item.tags = [vscode.CompletionItemTag.Deprecated];
      return item;
    });
  }

  specialVariableCompletions(record) {
    return SPECIAL_VARIABLES.map((variable) => {
      const item = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Constant);
      item.detail = 'special variable';
      item.documentation = new vscode.MarkdownString(this.tagText(record, variable.description));
      return item;
    });
  }

  async completions(document, position, triggerCharacter) {
    await this.ready;
    const record = this.currentRecord(document);
    const offset = document.offsetAt(position);
    const beforeCursor = record.source.slice(0, offset);
    const templatePath = /<#(?:import|include)\s+r?(["'])([^"'<>]*)$/.exec(beforeCursor);
    if (templatePath && /^[^"']*$/.test(templatePath[2])) {
      return this.templatePathCompletions(record, document, position, templatePath[2]);
    }
    // These characters only ask for the paths of import and include.
    if (pathTriggerCharacters.includes(triggerCharacter)) return [];
    const builtinStart = builtinNameStart(beforeCursor);
    if (builtinStart >= 0 && this.isFreeMarkerExpression(record.source, builtinStart, offset)) {
      return this.builtinCompletions(record, this.builtinTargetType(record, beforeCursor.slice(0, builtinStart - 1)));
    }
    const tagStart = /<(\/?)([#@])([A-Za-z_][A-Za-z0-9_.-]*)?$/.exec(beforeCursor);
    if (tagStart && !tagStart[1] && tagStart[2] === '#') return this.directiveCompletions(record);
    const specialVariableStart = specialVariableNameStart(beforeCursor);
    if (specialVariableStart >= 0 && this.isFreeMarkerExpression(record.source, specialVariableStart, offset)) {
      return this.specialVariableCompletions(record);
    }
    const macroValue = this.isMacroArgumentValue(record.source, offset);
    const macroArguments = macroValue ? undefined : this.macroArgumentCompletions(record, record.source, offset);
    if (macroArguments !== undefined) return macroArguments;
    const namespaceMatch = /((?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Za-z_][A-Za-z0-9_]*)\.$/.exec(beforeCursor);
    // An argument such as alias.| offers the members of alias, not the arguments.
    const functionArguments = namespaceMatch ? undefined : this.functionArgumentCompletions(record, beforeCursor);
    if (functionArguments !== undefined) return functionArguments;
    const interpolationContext = macroValue || this.isInterpolationContext(record.source, offset);
    let declarations = [];

    if (namespaceMatch) {
      const segments = namespaceMatch[1].split('.');
      const imported = this.resolveNamespaceRecord(record, segments);
      if (imported) {
        // A hash is offered once; its keys come after its name and a dot.
        declarations = this.namespaceDeclarations(imported)
          .filter(({ symbol }) => !(symbol.kind === 'variable' && symbol.name.includes('.')));
      } else {
        // alias.hash. offers the keys of a hash of the imported template.
        let owner;
        let split = segments.length - 1;
        for (; split > 0 && !owner; split -= 1) owner = this.resolveNamespaceRecord(record, segments.slice(0, split));
        declarations = owner
          ? this.nestedVariableDeclarations(owner, segments.slice(split + 1).join('.'))
          : this.nestedVariableDeclarations(record, namespaceMatch[1]);
      }
    } else if (/<@([A-Za-z_][A-Za-z0-9_]*)?$/.test(beforeCursor)) {
      declarations = this.scopeDeclarations(record, offset, this.namespaceDeclarations(record, true));
    } else if (interpolationContext) {
      declarations = this.scopeDeclarations(record, offset, this.namespaceDeclarations(record, true));
    }

    const wordPrefix = /[A-Za-z_][A-Za-z0-9_]*$/.exec(beforeCursor);
    const snippetItems = wordPrefix && !interpolationContext
      ? Object.entries(snippets)
        .filter(([, snippet]) => snippet.prefix.toLowerCase().startsWith(wordPrefix[0].toLowerCase()))
        .map(([name, snippet]) => {
          const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Snippet);
          item.detail = snippet.description;
          item.filterText = snippet.prefix;
          const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
          item.insertText = new vscode.SnippetString(
            snippet.prefix === 'interp' && record.interpolationSyntax === 'squareBracket'
              ? '[=${1:expression}]$0'
              : this.tagText(record, body)
          );
          item.sortText = `snippet_${snippet.prefix.toLowerCase()}`;
          return item;
        })
      : [];

    if (interpolationContext) {
      declarations = declarations.filter(({ symbol }) =>
        symbol.kind === 'namespace' || symbol.kind === 'variable' || symbol.kind === 'function'
      );
    }

    const groupOrder = { namespace: 0, variable: 1, function: 2, macro: 3 };
    const isLocal = ({ record: sourceRecord, origin }) => (origin || sourceRecord) === record;
    declarations.sort((left, right) => {
      const groupDifference = (groupOrder[left.symbol.kind] ?? 4) - (groupOrder[right.symbol.kind] ?? 4);
      return groupDifference
        || Number(isLocal(right)) - Number(isLocal(left))
        || left.symbol.name.localeCompare(right.symbol.name);
    });

    const symbolItems = declarations.map((declaration) => {
      const { symbol, record: sourceRecord } = declaration;
      const kind = symbol.kind === 'namespace'
        ? vscode.CompletionItemKind.Module
        : symbol.kind === 'variable'
          ? vscode.CompletionItemKind.Variable
          : symbol.kind === 'function'
            ? vscode.CompletionItemKind.Function
            : vscode.CompletionItemKind.Method;
      const isCallable = symbol.kind === 'function' || symbol.kind === 'macro';
      const variableValue = typeof symbol.value === 'string'
        ? symbol.value.replace(/\s+/g, ' ').trim()
        : undefined;
      const shortVariableValue = variableValue && variableValue.length > 60
        ? `${variableValue.slice(0, 57)}...`
        : variableValue;
      const signature = isCallable
        ? `${symbol.name}(${(symbol.parameters || []).map(({ name, defaultValue }) =>
          defaultValue === undefined ? name : `${name}=${defaultValue}`
        ).join(', ')})`
        : symbol.kind === 'variable' && shortVariableValue !== undefined
          ? `${symbol.name} = ${shortVariableValue}`
          : symbol.name;
      const item = new vscode.CompletionItem(signature, kind);
      item.sortText = `${String(groupOrder[symbol.kind] ?? 4).padStart(2, '0')}_${isLocal(declaration) ? 0 : 1}_${symbol.name.toLowerCase()}`;
      const sourceName = path.basename(sourceRecord.uri.fsPath);
      item.detail = symbol.kind === 'function' || symbol.kind === 'macro'
        ? sourceName
        : symbol.kind === 'variable' && symbol.declaration
          ? sourceName
          : `${symbol.kind} from ${sourceName}`;
      if ((symbol.kind === 'function' || symbol.kind === 'macro') && symbol.parameters) {
        const parameterLines = symbol.parameters.map(({ name, defaultValue }) => {
          const parameter = `\`${name}\``;
          return defaultValue === undefined
            ? `- ${parameter} (Required)`
            : `- ${parameter} = \`${defaultValue.replace(/`/g, '\\`')}\``;
        });
        const parameters = parameterLines.length > 0
          ? `Parameter:\n\n${parameterLines.join('\n')}`
          : 'Parameter: none';
        const description = symbol.documentation ? `${symbol.documentation}\n\n` : '';
        item.documentation = new vscode.MarkdownString(`${symbol.kind} ${symbol.name}\n\n${description}${parameters}`);
      } else if (symbol.kind === 'variable' && symbol.declaration) {
        item.documentation = new vscode.MarkdownString(`variable ${symbol.name}\n\nDefinition\n\n\`\`\`ftl\n${symbol.declaration}\n\`\`\``);
      }
      item.insertText = symbol.name;
      return item;
    });
    return [...symbolItems, ...snippetItems];
  }
}

function activate(context) {
  const index = new TemplateWorkspaceIndex();
  index.initialize();
  const diagnostics = vscode.languages.createDiagnosticCollection('freemarker');
  context.subscriptions.push(diagnostics);
  const validateDocument = (document) => {
    if (document.languageId !== 'freemarker') return;
    const text = document.getText();
    // No analysis of the versions in a diff or merge editor, or of a file with unresolved conflicts.
    if (!['file', 'untitled'].includes(document.uri.scheme) || /^<{7}(?: |$)/m.test(text)) {
      diagnostics.delete(document.uri);
      return;
    }
    const publish = (issues) => {
      const entries = issues.map((issue) => new vscode.Diagnostic(
        new vscode.Range(document.positionAt(issue.offset), document.positionAt(issue.offset + issue.length)),
        issue.message,
        { warning: vscode.DiagnosticSeverity.Warning, info: vscode.DiagnosticSeverity.Information }[issue.severity]
          ?? vscode.DiagnosticSeverity.Error
      ));
      if (entries.length) diagnostics.set(document.uri, entries);
      else diagnostics.delete(document.uri);
    };
    const issues = validateTemplate(text, {
      ...syntaxOptions(),
      validateHtml: vscode.workspace.getConfiguration('freemarker').get('validateHtmlTags', true)
    });
    publish(issues);
    // The checks against other templates have to wait until the workspace is indexed.
    index.ready.then(() => {
      if (document.getText() !== text) return;
      publish([...issues, ...index.semanticIssues(index.currentRecord(document))]);
    });
  };
  const validateOpenDocuments = () => {
    for (const document of vscode.workspace.textDocuments) validateDocument(document);
  };
  const updatePathsSetting = () => vscode.workspace.getConfiguration('freemarker').get('updatePathsOnFileMove', 'prompt');
  // The edits for a move, from the moment before it to the moment after it.
  const pendingMoveEdits = new Map();
  const renameKey = (files) => files.map(({ oldUri, newUri }) => `${oldUri.fsPath}\n${newUri.fsPath}`).join('\n');

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider({ language: 'freemarker' }, {
      provideDefinition: (document, position) => index.definition(document, position)
    }),
    vscode.languages.registerDocumentSymbolProvider({ language: 'freemarker' }, {
      provideDocumentSymbols: (document) => index.documentSymbols(document)
    }),
    vscode.languages.registerHoverProvider({ language: 'freemarker' }, {
      provideHover: (document, position) => index.hover(document, position)
    }),
    vscode.languages.registerReferenceProvider({ language: 'freemarker' }, {
      provideReferences: (document, position) => index.references(document, position)
    }),
    vscode.languages.registerRenameProvider({ language: 'freemarker' }, {
      prepareRename: (document, position) => index.prepareRename(document, position),
      provideRenameEdits: (document, position, newName) => index.rename(document, position, newName)
    }),
    vscode.languages.registerDocumentSemanticTokensProvider({ language: 'freemarker' }, {
      provideDocumentSemanticTokens: (document) => index.semanticTokens(document)
    }, semanticTokensLegend),
    vscode.languages.registerSignatureHelpProvider({ language: 'freemarker' }, {
      provideSignatureHelp: (document, position) => index.signatureHelp(document, position)
    }, '(', ','),
    vscode.languages.registerCompletionItemProvider({ language: 'freemarker' }, {
      provideCompletionItems: (document, position, _token, context) =>
        index.completions(document, position, context && context.triggerCharacter)
    }, '.', '@', ' ', '?', '#', ...pathTriggerCharacters),
    vscode.languages.registerDocumentLinkProvider({ language: 'freemarker' }, {
      provideDocumentLinks: async (document) => {
        await index.ready;
        return index.documentLinks(index.currentRecord(document), document);
      }
    }),
    vscode.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: (query) => index.workspaceSymbols(query)
    }),
    vscode.languages.registerCodeActionsProvider({ language: 'freemarker' }, {
      provideCodeActions: (document, range) => {
        if (range.isEmpty) return [];
        const record = index.currentRecord(document);
        const action = new vscode.CodeAction('Extract to macro', vscode.CodeActionKind.RefactorExtract);
        action.command = { command: 'freemarker.extractMacro', title: 'Extract to macro', arguments: [document, range] };
        const surround = ['list', 'if'].map((directive) => {
          const surroundAction = new vscode.CodeAction(index.tagText(record, `Surround with <#${directive}>`), vscode.CodeActionKind.RefactorRewrite);
          surroundAction.command = {
            command: 'freemarker.surroundWith',
            title: surroundAction.title,
            arguments: [document, range, directive]
          };
          return surroundAction;
        });
        const expressionActions = index.expressionExtractions(record, document.offsetAt(range.start), document.offsetAt(range.end))
          .map((kind) => {
            const title = kind === 'function' ? 'Extract to function' : index.tagText(record, `Extract to <#${kind}>`);
            const expressionAction = new vscode.CodeAction(title, vscode.CodeActionKind.RefactorExtract);
            expressionAction.command = { command: `freemarker.extract${kind[0].toUpperCase()}${kind.slice(1)}`, title, arguments: [document, range] };
            return expressionAction;
          });
        const wrapAction = new vscode.CodeAction('Wrap with abbreviation…', vscode.CodeActionKind.RefactorRewrite);
        wrapAction.command = { command: 'freemarker.wrapWithAbbreviation', title: wrapAction.title, arguments: [document, range] };
        return [...expressionActions, action, ...surround, wrapAction];
      }
    }, { providedCodeActionKinds: [vscode.CodeActionKind.RefactorExtract, vscode.CodeActionKind.RefactorRewrite] }),
    vscode.commands.registerCommand('freemarker.surroundWith', (document, range, directive) => {
      const editor = vscode.window.activeTextEditor;
      const target = document ?? (editor && editor.document);
      const selection = range ?? (editor && editor.selection);
      if (target && selection) return index.surroundWith(target, selection, directive ?? 'if');
    }),
    ...['function', 'assign', 'local'].map((kind) =>
      vscode.commands.registerCommand(`freemarker.extract${kind[0].toUpperCase()}${kind.slice(1)}`, (document, range) => {
        const editor = vscode.window.activeTextEditor;
        const target = document ?? (editor && editor.document);
        const selection = range ?? (editor && editor.selection);
        if (target && selection) return index.extractExpression(target, selection, kind);
      })),
    vscode.commands.registerCommand('freemarker.wrapWithAbbreviation', (document, range) => {
      const editor = vscode.window.activeTextEditor;
      const target = document ?? (editor && editor.document);
      const selection = range ?? (editor && editor.selection);
      if (target && selection) return index.wrapWithAbbreviation(target, selection);
    }),
    vscode.commands.registerCommand('freemarker.extractMacro', (document, range) => {
      const editor = vscode.window.activeTextEditor;
      const target = document ?? (editor && editor.document);
      const selection = range ?? (editor && editor.selection);
      if (target && selection) return index.extractMacro(target, selection);
    }),
    vscode.languages.registerFoldingRangeProvider({ language: 'freemarker' }, {
      provideFoldingRanges: (document) => index.foldingRanges(document)
    }),
    vscode.languages.registerSelectionRangeProvider({ language: 'freemarker' }, {
      provideSelectionRanges: (document, positions) => {
        const text = document.getText();
        const ranges = selectionRanges(text, syntaxOptions()).filter(([start, end]) => start > 0 || end < text.length);
        return positions.map((position) => {
          const offset = document.offsetAt(position);
          let selectionRange = new vscode.SelectionRange(
            new vscode.Range(document.positionAt(0), document.positionAt(text.length))
          );
          for (const [start, end] of enclosingRanges(ranges, offset, offset).reverse()) {
            selectionRange = new vscode.SelectionRange(
              new vscode.Range(document.positionAt(start), document.positionAt(end)),
              selectionRange
            );
          }
          return selectionRange;
        });
      }
    }),
    vscode.languages.registerDocumentHighlightProvider({ language: 'freemarker' }, {
      provideDocumentHighlights: (document, position) => index.documentHighlights(document, position)
    }),
    vscode.languages.registerDocumentFormattingEditProvider({ language: 'freemarker' }, {
      provideDocumentFormattingEdits: (document, options) => {
        const formatted = formatTemplate(document.getText(), { ...options, ...syntaxOptions() });
        if (formatted === document.getText()) return [];
        return [vscode.TextEdit.replace(
          new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
          formatted
        )];
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'freemarker') {
        index.currentRecord(event.document);
        validateDocument(event.document);
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== event.document || event.contentChanges.length !== 1) return;
        const change = event.contentChanges[0];
        const cursor = event.document.positionAt(
          change.rangeOffset + change.text.length
        );
        const record = index.currentRecord(event.document);
        const endTag = endTagAfterSelfClosingSlash(event.document, change, record);
        if (endTag) {
          const range = new vscode.Range(
            event.document.positionAt(endTag.offset),
            event.document.positionAt(endTag.offset + endTag.length)
          );
          return editor.edit((editBuilder) => editBuilder.delete(range));
        }
        const closingEndTag = closingTagAfterTypedSlash(event.document, change, record);
        if (closingEndTag) {
          const finalCursor = new vscode.Position(cursor.line, cursor.character + closingEndTag.length);
          return editor.edit((editBuilder) => editBuilder.insert(cursor, closingEndTag)).then((applied) => {
            if (applied) editor.selection = new vscode.Selection(finalCursor, finalCursor);
          });
        }
        const closingText = closingTextAfterTypedTag(event.document, change, record);
        if (!closingText) return;
        return editor.edit((editBuilder) => editBuilder.insert(cursor, closingText)).then((applied) => {
          if (applied) editor.selection = new vscode.Selection(cursor, cursor);
        });
      }
    }),
    // The editor's own Toggle Line Comment puts several lines into a single comment.
    vscode.commands.registerTextEditorCommand('freemarker.toggleLineComment', (editor, edit) => {
      const { document } = editor;
      const { tagSyntax } = index.currentRecord(document);
      let nextLine = 0;
      const selections = [...editor.selections].sort((left, right) => left.start.line - right.start.line);
      for (const selection of selections) {
        // A selection that ends at the start of a line does not include that line.
        const endsBeforeLine = selection.end.line > selection.start.line && selection.end.character === 0;
        const firstLine = Math.max(selection.start.line, nextLine);
        const lastLine = selection.end.line - (endsBeforeLine ? 1 : 0);
        if (lastLine < firstLine) continue;
        nextLine = lastLine + 1;

        const lines = [];
        for (let line = firstLine; line <= lastLine; line += 1) lines.push(document.lineAt(line).text);
        toggleLineComments(lines, tagSyntax).forEach((text, offset) => {
          if (text === lines[offset]) return;
          edit.replace(
            new vscode.Range(firstLine + offset, 0, firstLine + offset, lines[offset].length),
            text
          );
        });
      }
    }),
    // The editor's own Toggle Block Comment only knows <#-- -->.
    vscode.commands.registerCommand('freemarker.toggleBlockComment', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return undefined;
      const { document } = editor;
      const { tagSyntax } = index.currentRecord(document);
      const text = document.getText();
      const toggles = [...editor.selections]
        .map((selection) => toggleBlockComment(text, document.offsetAt(selection.start), document.offsetAt(selection.end), tagSyntax))
        .sort((left, right) => left.start - right.start)
        .filter((toggle, position, sorted) => position === 0 || toggle.start >= sorted[position - 1].end);
      return editor.edit((editBuilder) => {
        for (const toggle of toggles) {
          editBuilder.replace(new vscode.Range(document.positionAt(toggle.start), document.positionAt(toggle.end)), toggle.text);
        }
      }).then((applied) => {
        if (!applied) return;
        // The selections in the edited text: each edit before one moves it.
        let shift = 0;
        editor.selections = toggles.map((toggle) => {
          const selection = new vscode.Selection(
            editor.document.positionAt(toggle.selectionStart + shift),
            editor.document.positionAt(toggle.selectionEnd + shift)
          );
          shift += toggle.text.length - (toggle.end - toggle.start);
          return selection;
        });
      });
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === 'freemarker') {
        index.currentRecord(document);
        validateDocument(document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
    // The paths are worked out before the move, while the index still knows the old locations,
    // and changed after it, in the files at their new locations.
    vscode.workspace.onWillRenameFiles((event) => {
      if (updatePathsSetting() === 'never') return;
      event.waitUntil(index.ready.then(async () => {
        // Unsaved changes are saved first: the paths are worked out from the text in the editors,
        // and that text has to be the one in the files that are moved and then changed.
        if (index.movedTemplates(event.files).size) await vscode.workspace.saveAll(false);
        pendingMoveEdits.set(renameKey(event.files), index.movedTemplateEdits(event.files));
      }));
    }),
    vscode.workspace.onDidRenameFiles(async (event) => {
      // Templates that git tracks are moved in the index too, so that git shows a rename.
      if (vscode.workspace.getConfiguration('freemarker').get('gitMoveFiles', true)) {
        await stageMovedTemplates(event.files
          .filter(({ oldUri, newUri }) => oldUri.scheme === 'file' && newUri.scheme === 'file')
          .map(({ oldUri, newUri }) => ({ oldPath: oldUri.fsPath, newPath: newUri.fsPath })))
          .catch(() => undefined);
      }
      const key = renameKey(event.files);
      const edits = pendingMoveEdits.get(key);
      pendingMoveEdits.delete(key);
      if (!edits || !edits.length) return;

      if (updatePathsSetting() === 'prompt') {
        const files = new Set(edits.map((edit) => edit.fsPath)).size;
        const answer = await vscode.window.showInformationMessage(
          `Update the import and include paths in ${files === 1 ? '1 template' : `${files} templates`}?`,
          'Yes', 'No', 'Always', 'Never'
        );
        if (answer === 'Always' || answer === 'Never') {
          await vscode.workspace.getConfiguration('freemarker')
            .update('updatePathsOnFileMove', answer.toLowerCase(), vscode.ConfigurationTarget.Global);
        }
        if (answer !== 'Yes' && answer !== 'Always') return;
      }

      const workspaceEdit = new vscode.WorkspaceEdit();
      for (const edit of edits) {
        workspaceEdit.replace(vscode.Uri.file(edit.fsPath), new vscode.Range(edit.start, edit.end), edit.newText);
      }
      await vscode.workspace.applyEdit(workspaceEdit);
    }),
    // The syntax settings change how every template is read.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('freemarker')) index.initialize().then(validateOpenDocuments);
    })
  );

  validateOpenDocuments();

  // A change to one template can add or remove problems in the templates that use it.
  const watcher = vscode.workspace.createFileSystemWatcher(templatePattern);
  const reindex = (uri) => vscode.workspace.fs.readFile(uri)
    .then((bytes) => index.update(uri, Buffer.from(bytes).toString('utf8')), () => index.remove(uri))
    .then(validateOpenDocuments);
  watcher.onDidCreate(reindex);
  watcher.onDidChange(reindex);
  watcher.onDidDelete((uri) => {
    index.remove(uri);
    validateOpenDocuments();
  });
  context.subscriptions.push(watcher);
}

function deactivate() {}

module.exports = { activate, deactivate };