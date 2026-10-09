const path = require('path');
const vscode = require('vscode');
const snippets = require('./snippets/freemarker.json');
const { formatTemplate } = require('./formatter');
const { parseTemplate } = require('./template-index');
const { validateTemplate } = require('./validator');

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
    if (!namespace) return undefined;
    const member = this.includedSymbols(namespace).find(({ symbol }) => symbol.name === segments[segments.length - 1]);
    return member && (includePrivate || !this.isPrivateName(member.symbol.name)) ? member : undefined;
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
            record: imported
          });
        }
      }
    }
    return declarations;
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
        if (character === quote && source[index - 1] !== '\\') quote = null;
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
        if (character === quote && invocation[2][index - 1] !== '\\') quote = null;
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

    const usedParameters = new Set();
    let nesting = 0;
    for (let index = 0; index < invocation[2].length; index += 1) {
      const character = invocation[2][index];
      if (quote) {
        if (character === quote && invocation[2][index - 1] !== '\\') quote = null;
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
      if (nesting > 0 || !/[A-Za-z_]/.test(character) || (index > 0 && !/\s/.test(invocation[2][index - 1]))) continue;

      const nameStart = index;
      while (/[A-Za-z0-9_]/.test(invocation[2][index] || '')) index += 1;
      const name = invocation[2].slice(nameStart, index);
      while (/\s/.test(invocation[2][index] || '')) index += 1;
      if (invocation[2][index] === '=') usedParameters.add(name);
      index -= 1;
    }

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

  functionCallContext(record, source, includePrivate = false) {
    const parentheses = [];
    let quote = null;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote && source[index - 1] !== '\\') quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '(') {
        parentheses.push(index);
      } else if (character === ')') {
        parentheses.pop();
      }
    }

    const opening = parentheses[parentheses.length - 1];
    if (opening === undefined || !this.isFreeMarkerExpression(source, opening, source.length)) return undefined;
    const functionMatch = /((?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(source.slice(0, opening));
    if (!functionMatch) return undefined;

    const functionPath = functionMatch[1].split('.');
    const declaration = functionPath.length > 1
      ? this.resolveNamespaceMember(record, functionPath, includePrivate)
      : this.includedSymbols(record).find(({ symbol }) =>
        symbol.kind === 'function' && symbol.name === functionPath[0]
      );
    if (!declaration || declaration.symbol.kind !== 'function') return undefined;

    let argumentIndex = 0;
    let nesting = 0;
    quote = null;
    const suppliedArguments = [];
    let argumentStart = opening + 1;
    for (let index = opening + 1; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote && source[index - 1] !== '\\') quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '(' || character === '[' || character === '{') {
        nesting += 1;
      } else if (character === ')' || character === ']' || character === '}') {
        if (nesting === 0) {
          suppliedArguments.push(source.slice(argumentStart, index).trim());
          break;
        }
        nesting -= 1;
      } else if (character === ',' && nesting === 0) {
        suppliedArguments.push(source.slice(argumentStart, index).trim());
        argumentStart = index + 1;
        argumentIndex += 1;
      }
    }
    if (argumentStart <= source.length && suppliedArguments.length === argumentIndex) {
      suppliedArguments.push(source.slice(argumentStart).trim());
    }

    return { declaration, argumentIndex, suppliedArguments };
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
        if (character === quote && beforeCursor[index - 1] !== '\\') quote = null;
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

  async documentSymbols(document) {
    await this.ready;
    const record = this.currentRecord(document);
    const declarations = record.symbols
      .filter((symbol) => symbol.topLevel !== false
        && !symbol.name.includes('.')
        && !/^<#(?:list|items)\b/.test(symbol.declaration || ''))
      .map((symbol) => {
        const declarationStart = symbol.declaration
          ? record.source.lastIndexOf(symbol.declaration, symbol.offset)
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
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    const groups = [
      { name: '01 Imports & Includes', kind: null, directives: true },
      { name: '02 Variables', kind: 'variable' },
      { name: '03 Functions', kind: 'function' },
      { name: '04 Macros', kind: 'macro' }
    ];
    const documentRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(record.source.length)
    );
    return groups.flatMap(({ name, kind, directives }) => {
      const children = declarations
        .filter((symbol) => symbol.detail === kind)
        .sort((left, right) => left.name.localeCompare(right.name));
      const groupChildren = directives ? templateDirectives : children;
      if (!groupChildren.length) return [];
      const group = new vscode.DocumentSymbol(
        name,
        '',
        vscode.SymbolKind.Namespace,
        documentRange,
        new vscode.Range(document.positionAt(0), document.positionAt(0))
      );
      group.children = groupChildren;
      return [group];
    });
  }

  async definition(document, position) {
    await this.ready;
    const record = this.currentRecord(document);
    const offset = document.offsetAt(position);
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
          ));
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

  async prepareRename(document, position) {
    await this.ready;
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
    if (!newName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) {
      throw new Error(`'${newName}' is not a valid FreeMarker identifier.`);
    }

    await this.ready;
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

  async completions(document, position) {
    await this.ready;
    const record = this.currentRecord(document);
    const offset = document.offsetAt(position);
    const beforeCursor = record.source.slice(0, offset);
    const macroArguments = this.macroArgumentCompletions(record, record.source, offset);
    if (macroArguments !== undefined) return macroArguments;
    const functionArguments = this.functionArgumentCompletions(record, beforeCursor);
    if (functionArguments !== undefined) return functionArguments;
    const interpolationContext = this.isInterpolationContext(record.source, offset);
    const namespaceMatch = /((?:[A-Za-z_][A-Za-z0-9_]*\.)*[A-Za-z_][A-Za-z0-9_]*)\.$/.exec(beforeCursor);
    let declarations = [];

    if (namespaceMatch) {
      const imported = this.resolveNamespaceRecord(record, namespaceMatch[1].split('.'));
      declarations = imported
        ? this.namespaceDeclarations(imported)
        : this.nestedVariableDeclarations(record, namespaceMatch[1]);
    } else if (/<@([A-Za-z_][A-Za-z0-9_]*)?$/.test(beforeCursor)) {
      declarations = this.namespaceDeclarations(record, true);
    } else if (interpolationContext) {
      declarations = this.namespaceDeclarations(record, true);
    }

    const wordPrefix = /[A-Za-z_][A-Za-z0-9_]*$/.exec(beforeCursor);
    const snippetItems = wordPrefix && !interpolationContext
      ? Object.entries(snippets)
        .filter(([, snippet]) => snippet.prefix.toLowerCase().startsWith(wordPrefix[0].toLowerCase()))
        .map(([name, snippet]) => {
          const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Snippet);
          item.detail = snippet.description;
          item.filterText = snippet.prefix;
          item.insertText = new vscode.SnippetString(Array.isArray(snippet.body)
            ? snippet.body.join('\n')
            : snippet.body);
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
    declarations.sort((left, right) => {
      const groupDifference = (groupOrder[left.symbol.kind] ?? 4) - (groupOrder[right.symbol.kind] ?? 4);
      return groupDifference || left.symbol.name.localeCompare(right.symbol.name);
    });

    const symbolItems = declarations.map(({ symbol, record: sourceRecord }) => {
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
      item.sortText = `${String(groupOrder[symbol.kind] ?? 4).padStart(2, '0')}_${symbol.name.toLowerCase()}`;
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
    const issues = validateTemplate(document.getText());
    const entries = issues.map((issue) => new vscode.Diagnostic(
      new vscode.Range(document.positionAt(issue.offset), document.positionAt(issue.offset + issue.length)),
      issue.message,
      vscode.DiagnosticSeverity.Error
    ));
    if (entries.length) diagnostics.set(document.uri, entries);
    else diagnostics.delete(document.uri);
  };

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
    vscode.languages.registerSignatureHelpProvider({ language: 'freemarker' }, {
      provideSignatureHelp: (document, position) => index.signatureHelp(document, position)
    }, '(', ','),
    vscode.languages.registerCompletionItemProvider({ language: 'freemarker' }, {
      provideCompletionItems: (document, position) => index.completions(document, position)
    }, '.', '@', ' '),
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
      if (event.document.languageId === 'freemarker') {
        index.currentRecord(event.document);
        validateDocument(event.document);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === 'freemarker') {
        index.currentRecord(document);
        validateDocument(document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri))
  );

  for (const document of vscode.workspace.textDocuments) validateDocument(document);

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