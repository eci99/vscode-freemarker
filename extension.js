const path = require('path');
const vscode = require('vscode');
const { formatTemplate } = require('./formatter');
const { parseTemplate } = require('./template-index');

const templatePattern = '**/*.{ftl,ftlh,ftlx}';

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
      ...parseTemplate(text)
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

  resolveTemplate(fromRecord, templatePath) {
    const cleanPath = templatePath.replace(/\\/g, '/');
    const isRooted = cleanPath.startsWith('/');
    const relativePath = cleanPath.replace(/^\/+/, '');
    const candidates = [];
    const addCandidate = (base, value) => {
      const resolved = path.resolve(base, value);
      candidates.push(resolved);
      if (!path.extname(resolved)) {
        candidates.push(`${resolved}.ftl`, `${resolved}.ftlh`, `${resolved}.ftlx`);
      }
    };

    if (!isRooted && fromRecord.uri.scheme === 'file') {
      addCandidate(path.dirname(fromRecord.uri.fsPath), cleanPath);
    }

    for (const folder of this.folders) {
      if (folder.uri.scheme === 'file') addCandidate(folder.uri.fsPath, relativePath);
    }

    const templateRoots = vscode.workspace.getConfiguration('freemarker').get('templateRoots', []);
    for (const folder of this.folders) {
      if (folder.uri.scheme !== 'file') continue;
      for (const root of templateRoots) {
        addCandidate(path.resolve(folder.uri.fsPath, root), relativePath);
      }
    }

    for (const candidate of candidates) {
      const record = this.records.get(path.resolve(candidate));
      if (record) return record;
    }
    return undefined;
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

  importedRecord(record, alias) {
    for (const source of this.includedRecords(record)) {
      const directive = source.directives.find((item) => item.kind === 'import' && item.alias === alias);
      if (directive) return this.resolveTemplate(source, directive.path);
    }
    return undefined;
  }

  resolveNamespaceRecord(record, aliases) {
    let current = record;
    for (let index = 0; index < aliases.length; index += 1) {
      const alias = aliases[index];
      if (index > 0 && this.isPrivateName(alias)) return undefined;
      current = this.importedRecord(current, alias);
      if (!current) return undefined;
    }
    return current;
  }

  isPrivateName(name) {
    const prefix = vscode.workspace.getConfiguration('freemarker').get('privatePrefix', '_');
    return typeof prefix === 'string' && prefix.length > 0 && name.startsWith(prefix);
  }

  resolveNamespaceMember(record, segments) {
    if (segments.length < 2) return undefined;
    const namespace = this.resolveNamespaceRecord(record, segments.slice(0, -1));
    if (!namespace) return undefined;
    const member = this.includedSymbols(namespace).find(({ symbol }) => symbol.name === segments[segments.length - 1]);
    return member && !this.isPrivateName(member.symbol.name) ? member : undefined;
  }

  namespaceDeclarations(record, includePrivate = false) {
    const declarations = this.includedSymbols(record)
      .filter(({ symbol }) => includePrivate || !this.isPrivateName(symbol.name));
    for (const source of this.includedRecords(record)) {
      for (const directive of source.directives) {
        if (directive.kind !== 'import' || !directive.alias) continue;
        const imported = this.resolveTemplate(source, directive.path);
        if (imported && (includePrivate || !this.isPrivateName(directive.alias))) {
          declarations.push({
            symbol: { name: directive.alias, kind: 'namespace' },
            record: imported
          });
        }
      }
    }
    return declarations;
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

    const closing = opening === '${' || opening === '#{' ? '}' : '>';
    const closingOffset = source.indexOf(closing, openingOffset + opening.length);
    if (closingOffset >= 0 && cursorOffset > closingOffset) return false;

    let quote = null;
    for (let index = openingOffset + opening.length; index < tokenStart; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote && source[index - 1] !== '\\') quote = null;
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

  async definition(document, position) {
    await this.ready;
    const record = this.currentRecord(document);
    const offset = document.offsetAt(position);

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
      const memberOffset = match.index + match[0].length - match[2].length;
      if (offset < memberOffset || offset > memberOffset + match[2].length) continue;
      const segments = `${match[1]}${match[2]}`.split('.');
      const declaration = this.resolveNamespaceMember(record, segments);
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
    const targetRecord = this.records.get(this.key(location.uri));
    if (!targetRecord) return undefined;

    const targetDocument = await vscode.workspace.openTextDocument(location.uri);
    const targetOffset = targetDocument.offsetAt(location.range.start);
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
        if (match[2] !== target.symbol.name) continue;
        const segments = `${match[1]}${match[2]}`.split('.');
        const member = this.resolveNamespaceMember(record, segments);
        if (!member) continue;
        if (member.symbol.offset !== targetOffset || this.key(member.record.uri) !== targetKey) continue;
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

  async completions(document, position) {
    await this.ready;
    const record = this.currentRecord(document);
    const offset = document.offsetAt(position);
    const beforeCursor = record.source.slice(0, offset);
    const namespaceMatch = /((?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Za-z_][A-Za-z0-9_]*)\.$/.exec(beforeCursor);
    let declarations = [];

    if (namespaceMatch) {
      const imported = this.resolveNamespaceRecord(record, namespaceMatch[1].split('.'));
      if (!imported) return [];
      declarations = this.namespaceDeclarations(imported);
    } else if (/<@([A-Za-z_][A-Za-z0-9_]*)?$/.test(beforeCursor)) {
      declarations = this.namespaceDeclarations(record, true);
    }

    return declarations.map(({ symbol, record: sourceRecord }) => {
      const kind = symbol.kind === 'namespace'
        ? vscode.CompletionItemKind.Module
        : symbol.kind === 'variable'
          ? vscode.CompletionItemKind.Variable
          : vscode.CompletionItemKind.Function;
      const item = new vscode.CompletionItem(symbol.name, kind);
      item.detail = `${symbol.kind} from ${path.basename(sourceRecord.uri.fsPath)}`;
      item.insertText = symbol.name;
      return item;
    });
  }
}

function activate(context) {
  const index = new TemplateWorkspaceIndex();
  index.initialize();

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider({ language: 'freemarker' }, {
      provideDefinition: (document, position) => index.definition(document, position)
    }),
    vscode.languages.registerReferenceProvider({ language: 'freemarker' }, {
      provideReferences: (document, position) => index.references(document, position)
    }),
    vscode.languages.registerCompletionItemProvider({ language: 'freemarker' }, {
      provideCompletionItems: (document, position) => index.completions(document, position)
    }, '.', '@'),
    vscode.languages.registerDocumentFormattingEditProvider({ language: 'freemarker' }, {
      provideDocumentFormattingEdits: (document, options) => {
        const formatted = formatTemplate(document.getText(), options);
        if (formatted === document.getText()) return [];
        return [vscode.TextEdit.replace(
          new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
          formatted
        )];
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'freemarker') index.currentRecord(event.document);
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === 'freemarker') index.currentRecord(document);
    })
  );

  const watcher = vscode.workspace.createFileSystemWatcher(templatePattern);
  watcher.onDidCreate((uri) => {
    vscode.workspace.fs.readFile(uri).then((bytes) => index.update(uri, Buffer.from(bytes).toString('utf8')), () => index.remove(uri));
  });
  watcher.onDidChange((uri) => {
    vscode.workspace.fs.readFile(uri).then((bytes) => index.update(uri, Buffer.from(bytes).toString('utf8')), () => index.remove(uri));
  });
  watcher.onDidDelete((uri) => index.remove(uri));
  context.subscriptions.push(watcher);
}

function deactivate() {}

module.exports = { activate, deactivate };