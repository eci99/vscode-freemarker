const assert = require('assert');
const Module = require('module');

const files = new Map([
  ['/virtual/work/pages/main.ftl', [
    '<#import "../lib/cards.ftl" as cards>',
    '<#import "../lib/toolkit.ftl" as toolkit>',
    '<#import "../lib/cards.ftl" as _privateCards>',
    '<#include "shared.ftl">',
    '<#assign pageTitle = "Home">',
    '<#assign greeting>\n  Hello World\n</#assign>',
    '<#assign settings = {"editor": {"fontSize": 14}}>',
    '${pageTitle}',
    '${greeting}',
    '${settings.editor.fontSize}',
    '${settings.editor.fontSize}',
    '${cards.total}',
    '${cards.total(1)}',
    '<@cards._hidden />',
    '${cards._hiddenFunction(1)}',
    '${cards._internal}',
    '<#list products as product>${product}</#list>',
    '<@cards.render>card</@cards.render>',
    '${cards.salutation}',
    '<@toolkit.nested.render />',
    '<@toolkit.included />',
    '<@toolkit._privateNested.render />',
    '${toolkit.nested.label}',
    '${cards.theme}',
    '${cards.theme}',
    '<@layout />',
    '<@layout>content</@layout>'
  ].join('\n')],
  ['/virtual/work/lib/cards.ftl', [
    '<#import "nested.ftl" as nested>',
    '<#-- Renders a card with configurable styling.\n\nInternal implementation note. -->',
    '<#macro render title className="button"><#local macroOnly = "hidden"><#import "nested.ftl" as hiddenNamespace>card</#macro>',
    '<#macro _hidden>secret</#macro>',
    '<#function _hiddenFunction value>value</#function>',
    '<#macro _helper><#return></#macro>',
    '<#macro publicHelper><@_helper /></#macro>',
    '<#-- Calculates a total from the supplied values. -->',
    '<#function total items precision=2 label="compact"><#local functionOnly = "hidden">1</#function>',
    '<#assign salutation>\n  Hello World\n</#assign> <#-- Greeting shown to the visitor. -->',
    '<#-- The selected theme color. -->',
    '<#assign theme = "blue">',
    '<#assign _internal = "secret">'
  ].join('\n')],
  ['/virtual/work/lib/toolkit.ftl', [
    '<#import "nested.ftl" as nested>',
    '<#import "nested.ftl" as _privateNested>',
    '<#include "toolkit-shared.ftl">'
  ].join('\n')],
  ['/virtual/work/lib/nested.ftl', [
    '<#macro render>nested</#macro>',
    '<#function funcTest wert fallback="standard">wert</#function>',
    '<#assign label = "Nested">'
  ].join('\n')],
  ['/virtual/work/lib/toolkit-shared.ftl', '<#macro included>included</#macro>'],
  ['/virtual/work/pages/shared.ftl', '<#macro layout>layout</#macro>']
]);

function uri(fsPath) {
  return { fsPath, scheme: 'file' };
}

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class Location {
  constructor(targetUri, range) {
    this.uri = targetUri;
    this.range = range;
  }
}

class Hover {
  constructor(contents, range) {
    this.contents = Array.isArray(contents) ? contents : [contents];
    this.range = range;
  }
}

class DocumentSymbol {
  constructor(name, detail, kind, range, selectionRange) {
    this.name = name;
    this.detail = detail;
    this.kind = kind;
    this.range = range;
    this.selectionRange = selectionRange;
    this.children = [];
  }
}

class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

class Document {
  constructor(targetUri, text) {
    this.uri = targetUri;
    this.text = text;
    this.languageId = 'freemarker';
  }

  getText(range) {
    if (!range) return this.text;
    const startOffset = this.offsetAt(range.start);
    const endOffset = this.offsetAt(range.end);
    return this.text.slice(startOffset, endOffset);
  }

  offsetAt(position) {
    const lines = this.text.split('\n');
    let offset = 0;
    for (let line = 0; line < position.line; line += 1) offset += lines[line].length + 1;
    return offset + position.character;
  }

  positionAt(targetOffset) {
    const prefix = this.text.slice(0, targetOffset);
    const lines = prefix.split('\n');
    return new Position(lines.length - 1, lines[lines.length - 1].length);
  }

  getWordRangeAtPosition(position, regex = /[A-Za-z_][A-Za-z0-9_]*/) {
    const lines = this.text.split('\n');
    const line = lines[position.line];
    if (!line) return undefined;
    let match;
    const re = new RegExp(regex.source, 'g');
    while ((match = re.exec(line)) !== null) {
      if (position.character >= match.index && position.character <= match.index + match[0].length) {
        return new Range(
          new Position(position.line, match.index),
          new Position(position.line, match.index + match[0].length)
        );
      }
    }
    return undefined;
  }
}

const providers = {};
const settings = {};
const diagnosticEntries = new Map();
const executedCommands = [];
let onDidOpenDocument;
let onDidChangeDocument;
const disposable = { dispose() {} };
const vscode = {
  Position,
  Range,
  Location,
  Hover,
  DocumentSymbol,
  SymbolKind: { Function: 11, Method: 5, Variable: 12, Namespace: 2, Module: 1, File: 0 },
  Diagnostic,
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  CompletionItemTag: { Deprecated: 1 },
  CompletionItemKind: { Method: 1, Function: 2, Variable: 5, Module: 8, Property: 9, Keyword: 13, Snippet: 14, Constant: 20 },
  FoldingRangeKind: { Comment: 1 },
  FoldingRange: class {
    constructor(start, end, kind) {
      this.start = start;
      this.end = end;
      this.kind = kind;
    }
  },
  DocumentHighlight: class {
    constructor(range) {
      this.range = range;
    }
  },
  DocumentLink: class {
    constructor(range, target) {
      this.range = range;
      this.target = target;
    }
  },
  SymbolInformation: class {
    constructor(name, kind, containerName, location) {
      this.name = name;
      this.kind = kind;
      this.containerName = containerName;
      this.location = location;
    }
  },
  TextEdit: {
    replace: (range, newText) => ({ range, newText })
  },
  WorkspaceEdit: class {
    constructor() {
      this._edits = new Map();
    }
    replace(targetUri, range, newText) {
      const key = targetUri.fsPath;
      if (!this._edits.has(key)) this._edits.set(key, []);
      this._edits.get(key).push({ range, newText });
    }
    has(targetUri) {
      return this._edits.has(targetUri.fsPath);
    }
    get(targetUri) {
      return this._edits.get(targetUri.fsPath) || [];
    }
    entries() {
      return [...this._edits.entries()].map(([fsPath, edits]) => [uri(fsPath), edits]);
    }
  },
  SignatureHelp: class {
    constructor() {
      this.signatures = [];
      this.activeSignature = 0;
      this.activeParameter = 0;
    }
  },
  SignatureInformation: class {
    constructor(label, documentation) {
      this.label = label;
      this.documentation = documentation;
      this.parameters = [];
    }
  },
  ParameterInformation: class {
    constructor(label, documentation) {
      this.label = label;
      this.documentation = documentation;
    }
  },
  CompletionItem: class {
    constructor(label, kind) {
      this.label = label;
      this.kind = kind;
    }
  },
  SnippetString: class {
    constructor(value) {
      this.value = value;
    }
  },
  MarkdownString: class {
    constructor(value) {
      this.value = value;
    }
  },
  commands: {
    executeCommand: async (...args) => executedCommands.push(args)
  },
  workspace: {
    workspaceFolders: [{ uri: uri('/virtual/work') }],
    textDocuments: [],
    findFiles: async () => [...files.keys()].map(uri),
    fs: {
      readFile: async (targetUri) => Buffer.from(files.get(targetUri.fsPath))
    },
    getConfiguration: () => ({ get: (key, fallback) => (key in settings ? settings[key] : fallback) }),
    onDidChangeConfiguration: () => disposable,
    openTextDocument: async (targetUri) => new Document(targetUri, files.get(targetUri.fsPath)),
    onDidChangeTextDocument: (listener) => {
      onDidChangeDocument = listener;
      return disposable;
    },
    onDidOpenTextDocument: (listener) => {
      onDidOpenDocument = listener;
      return disposable;
    },
    onDidCloseTextDocument: () => disposable,
    createFileSystemWatcher: () => ({
      onDidCreate() {},
      onDidChange() {},
      onDidDelete() {},
      dispose() {}
    })
  },
  languages: {
    createDiagnosticCollection: () => ({
      set: (targetUri, entries) => diagnosticEntries.set(targetUri.fsPath, entries),
      delete: (targetUri) => diagnosticEntries.delete(targetUri.fsPath),
      dispose() {}
    }),
    registerDefinitionProvider: (_selector, provider) => {
      providers.definition = provider;
      return disposable;
    },
    registerDocumentSymbolProvider: (_selector, provider) => {
      providers.documentSymbols = provider;
      return disposable;
    },
    registerHoverProvider: (_selector, provider) => {
      providers.hover = provider;
      return disposable;
    },
    registerReferenceProvider: (_selector, provider) => {
      providers.references = provider;
      return disposable;
    },
    registerRenameProvider: (_selector, provider) => {
      providers.rename = provider;
      return disposable;
    },
    registerSignatureHelpProvider: (_selector, provider, ...triggerCharacters) => {
      providers.signatureHelp = provider;
      providers.signatureHelpTriggerCharacters = triggerCharacters;
      return disposable;
    },
    registerCompletionItemProvider: (_selector, provider, ...triggerCharacters) => {
      providers.completion = provider;
      providers.completionTriggerCharacters = triggerCharacters;
      return disposable;
    },
    registerDocumentLinkProvider: (_selector, provider) => {
      providers.documentLinks = provider;
      return disposable;
    },
    registerWorkspaceSymbolProvider: (provider) => {
      providers.workspaceSymbols = provider;
      return disposable;
    },
    registerFoldingRangeProvider: (_selector, provider) => {
      providers.folding = provider;
      return disposable;
    },
    registerDocumentHighlightProvider: (_selector, provider) => {
      providers.highlights = provider;
      return disposable;
    },
    registerDocumentFormattingEditProvider: (_selector, provider) => {
      providers.formatting = provider;
      return disposable;
    },
  }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.call(this, request, parent, isMain);
};
const extension = require('../extension');
Module._load = originalLoad;

function positionAt(text, targetOffset) {
  return new Document(uri('/virtual/work/pages/main.ftl'), text).positionAt(targetOffset);
}

async function run() {
  const subscriptions = [];
  extension.activate({ subscriptions });
  const mainUri = uri('/virtual/work/pages/main.ftl');
  const mainText = files.get(mainUri.fsPath);
  const document = new Document(mainUri, mainText);

  const outlineSymbols = await providers.documentSymbols.provideDocumentSymbols(document);
  const variableGroup = outlineSymbols.find((symbol) => symbol.name === '02 Variables');
  const templateGroup = outlineSymbols.find((symbol) => symbol.name === '01 Imports & Includes');
  assert(variableGroup);
  assert(templateGroup);
  assert(templateGroup.children.some((symbol) => symbol.name === 'cards' && symbol.detail === 'import ../lib/cards.ftl'));
  assert(templateGroup.children.some((symbol) => symbol.name === 'shared.ftl' && symbol.detail === 'include shared.ftl'));
  assert(!templateGroup.children.some((symbol) => symbol.name === 'hiddenNamespace'));
  const cardsImportOffset = mainText.indexOf('as cards') + 'as '.length;
  assert.deepStrictEqual(
    templateGroup.children.find((symbol) => symbol.name === 'cards').selectionRange.start,
    positionAt(mainText, cardsImportOffset)
  );
  assert(variableGroup.children.some((symbol) => symbol.name === 'pageTitle'));
  assert(variableGroup.children.some((symbol) => symbol.name === 'settings'));
  assert(!variableGroup.children.some((symbol) => symbol.name === 'fontSize'));
  assert(!variableGroup.children.some((symbol) => symbol.name === 'product'));
  const cardsOutline = await providers.documentSymbols.provideDocumentSymbols(
    new Document(uri('/virtual/work/lib/cards.ftl'), files.get('/virtual/work/lib/cards.ftl'))
  );
  assert.deepStrictEqual(cardsOutline.map((symbol) => symbol.name), [
    '01 Imports & Includes',
    '02 Variables',
    '03 Functions',
    '04 Macros'
  ]);
  const macroGroup = cardsOutline.find((symbol) => symbol.name === '04 Macros');
  const functionGroup = cardsOutline.find((symbol) => symbol.name === '03 Functions');
  assert(macroGroup.children.some((symbol) => symbol.name === 'render' && symbol.kind === vscode.SymbolKind.Method));
  assert(functionGroup.children.some((symbol) => symbol.name === 'total' && symbol.kind === vscode.SymbolKind.Function));
  assert(!macroGroup.children.some((symbol) => symbol.name === 'macroOnly'));
  assert(!functionGroup.children.some((symbol) => symbol.name === 'functionOnly'));

  const invalidDocument = new Document(mainUri, '<#if ready>\n</#list>');
  onDidOpenDocument(invalidDocument);
  assert.strictEqual(diagnosticEntries.get(mainUri.fsPath).length, 2);
  assert(diagnosticEntries.get(mainUri.fsPath)[0].message.includes('does not match the open'));
  invalidDocument.text = '<#if ready>\n</#if>';
  onDidChangeDocument({ document: invalidDocument });
  assert.strictEqual(diagnosticEntries.has(mainUri.fsPath), false);

  const unformatted = new Document(mainUri, '<#if ready>\n<p>Ready</p>\n</#if>');
  const formatEdits = providers.formatting.provideDocumentFormattingEdits(unformatted, {
    insertSpaces: true,
    tabSize: 2
  });
  assert.strictEqual(formatEdits.length, 1);
  assert.strictEqual(formatEdits[0].newText, '<#if ready>\n  <p>Ready</p>\n</#if>');

  const memberOffset = mainText.indexOf('cards.render') + 'cards.'.length;
  const memberDefinition = await providers.definition.provideDefinition(document, positionAt(mainText, memberOffset));
  assert.strictEqual(memberDefinition.uri.fsPath, '/virtual/work/lib/cards.ftl');
  assert.strictEqual(memberDefinition.range.start.character, '<#macro '.length);

  const namespaceOffset = mainText.indexOf('cards.render') + 1;
  const namespaceDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, namespaceOffset)
  );
  assert.strictEqual(namespaceDefinition.uri.fsPath, '/virtual/work/lib/cards.ftl');
  assert.strictEqual(namespaceDefinition.range.line, 0);

  const namespaceHover = await providers.hover.provideHover(
    document,
    positionAt(mainText, mainText.indexOf('cards.render') + 1)
  );
  assert(namespaceHover.contents[0].value.includes('Namespace `cards`'));
  assert(namespaceHover.contents[0].value.includes('Template: `cards.ftl`'));

  const macroHover = await providers.hover.provideHover(
    document,
    positionAt(mainText, mainText.indexOf('cards.render') + 'cards.'.length + 1)
  );
  assert(macroHover.contents[0].value.includes('macro render'));
  assert(macroHover.contents[0].value.includes('Renders a card with configurable styling.'));
  assert(macroHover.contents[0].value.includes('className'));

  const variableHover = await providers.hover.provideHover(
    document,
    positionAt(mainText, mainText.indexOf('cards.theme') + 'cards.'.length + 1)
  );
  assert(variableHover.contents[0].value.includes('variable theme'));
  assert(variableHover.contents[0].value.includes('The selected theme color.'));
  assert(variableHover.contents[0].value.includes('Value: `"blue"`'));

  const captureVariableHover = await providers.hover.provideHover(
    document,
    positionAt(mainText, mainText.indexOf('cards.salutation') + 'cards.'.length + 1)
  );
  assert(captureVariableHover.contents[0].value.includes('Greeting shown to the visitor.'));

  const functionHover = await providers.hover.provideHover(
    document,
    positionAt(mainText, mainText.indexOf('cards.total') + 'cards.'.length + 1)
  );
  assert(functionHover.contents[0].value.includes('function total'));
  assert(functionHover.contents[0].value.includes('Calculates a total from the supplied values.'));
  assert(functionHover.contents[0].value.includes('precision'));

  const closingNamespaceOffset = mainText.indexOf('</@cards.render>') + '</@cards.'.length + 1;
  const closingNamespaceDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, closingNamespaceOffset)
  );
  assert.strictEqual(closingNamespaceDefinition.uri.fsPath, '/virtual/work/lib/cards.ftl');

  const includeOffset = mainText.indexOf('shared.ftl') + 1;
  const includeDefinition = await providers.definition.provideDefinition(document, positionAt(mainText, includeOffset));
  assert.strictEqual(includeDefinition.uri.fsPath, '/virtual/work/pages/shared.ftl');

  const localOffset = mainText.indexOf('layout />') + 1;
  const localDefinition = await providers.definition.provideDefinition(document, positionAt(mainText, localOffset));
  assert.strictEqual(localDefinition.uri.fsPath, '/virtual/work/pages/shared.ftl');

  const closingMacroOffset = mainText.indexOf('</@layout>') + '</@'.length + 1;
  const closingMacroDefinition = await providers.definition.provideDefinition(document, positionAt(mainText, closingMacroOffset));
  assert.strictEqual(closingMacroDefinition.uri.fsPath, '/virtual/work/pages/shared.ftl');

  const variableOffset = mainText.indexOf('pageTitle}', 1) + 1;
  const variableDefinition = await providers.definition.provideDefinition(document, positionAt(mainText, variableOffset));
  assert.strictEqual(variableDefinition.uri.fsPath, mainUri.fsPath);
  assert.strictEqual(variableDefinition.range.start.character, '<#assign '.length);

  const greetingOffset = mainText.indexOf('greeting}', 1) + 1;
  const greetingDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, greetingOffset)
  );
  assert.strictEqual(greetingDefinition.uri.fsPath, mainUri.fsPath);

  const loopVariableOffset = mainText.indexOf('product}</') + 1;
  const loopVariableDefinition = await providers.definition.provideDefinition(document, positionAt(mainText, loopVariableOffset));
  assert.strictEqual(loopVariableDefinition.uri.fsPath, mainUri.fsPath);
  assert.strictEqual(
    loopVariableDefinition.range.start.line,
    positionAt(mainText, mainText.indexOf('<#list products')).line
  );

  const nestedHashOffset = mainText.indexOf('settings.editor.fontSize') + 'settings.editor.'.length;
  const nestedHashDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, nestedHashOffset)
  );
  assert.strictEqual(nestedHashDefinition.uri.fsPath, mainUri.fsPath);
  assert.deepStrictEqual(
    nestedHashDefinition.range.start,
    positionAt(mainText, mainText.indexOf('fontSize'))
  );
  const nestedHashCompletions = await providers.completion.provideCompletionItems(
    document,
    positionAt(mainText, mainText.indexOf('settings.editor.fontSize') + 'settings.editor.'.length)
  );
  assert(nestedHashCompletions.some((item) => item.label === 'fontSize = 14'));
  const nestedHashReferences = await providers.references.provideReferences(
    document,
    nestedHashDefinition.range.start,
    { includeDeclaration: false }
  );
  assert.strictEqual(nestedHashReferences.length, 2);

  const namespaceVariableOffset = mainText.indexOf('cards.theme') + 'cards.'.length;
  const namespaceVariableDefinition = await providers.definition.provideDefinition(document, positionAt(mainText, namespaceVariableOffset));
  assert.strictEqual(namespaceVariableDefinition.uri.fsPath, '/virtual/work/lib/cards.ftl');
  assert.strictEqual(
    namespaceVariableDefinition.range.start.line,
    positionAt(files.get('/virtual/work/lib/cards.ftl'), files.get('/virtual/work/lib/cards.ftl').indexOf('theme =')).line
  );

  const captureVariableOffset = mainText.indexOf('cards.salutation') + 'cards.'.length;
  const captureVariableDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, captureVariableOffset)
  );
  assert.strictEqual(captureVariableDefinition.uri.fsPath, '/virtual/work/lib/cards.ftl');
  assert.strictEqual(
    captureVariableDefinition.range.start.character,
    '<#assign '.length
  );

  const completionOffset = mainText.indexOf('<@cards.render') + '<@cards.'.length;
  const completions = await providers.completion.provideCompletionItems(document, positionAt(mainText, completionOffset));
  assert.deepStrictEqual(completions.map((item) => item.label), [
    'nested',
    'salutation = Hello World',
    'theme = "blue"',
    'total(items, precision=2, label="compact")',
    'publicHelper()',
    'render(title, className="button")'
  ]);
  assert(!completions.some((item) => item.label === 'macroOnly' || item.label === 'functionOnly'));
  assert.deepStrictEqual(
    [...completions].sort((left, right) => left.sortText.localeCompare(right.sortText)).map((item) => item.label),
    ['nested', 'salutation = Hello World', 'theme = "blue"', 'total(items, precision=2, label="compact")', 'publicHelper()', 'render(title, className="button")']
  );
  assert(!completions.some((item) => item.label.startsWith('_')));
  assert.strictEqual(completions.find((item) => item.label === 'nested').kind, vscode.CompletionItemKind.Module);
  assert.strictEqual(completions.find((item) => item.insertText === 'theme').kind, vscode.CompletionItemKind.Variable);
  assert.strictEqual(completions.find((item) => item.insertText === 'salutation').kind, vscode.CompletionItemKind.Variable);
  assert.strictEqual(completions.find((item) => item.insertText === 'salutation').detail, 'cards.ftl');
  assert.strictEqual(
    completions.find((item) => item.insertText === 'salutation').documentation.value,
    'variable salutation\n\nDefinition\n\n```ftl\n<#assign salutation>\n  Hello World\n</#assign>\n```'
  );
  assert.strictEqual(completions.find((item) => item.insertText === 'total').kind, vscode.CompletionItemKind.Function);
  assert.strictEqual(
    completions.find((item) => item.insertText === 'total').detail,
    'cards.ftl'
  );
  assert.strictEqual(
    completions.find((item) => item.insertText === 'total').documentation.value,
    'function total\n\nCalculates a total from the supplied values.\n\nParameter:\n\n- `items` (Required)\n- `precision` = `2`\n- `label` = `"compact"`'
  );
  assert.strictEqual(
    completions.find((item) => item.insertText === 'render').documentation.value,
    'macro render\n\nRenders a card with configurable styling.\n\nParameter:\n\n- `title` (Required)\n- `className` = `"button"`'
  );
  assert.strictEqual(
    completions.find((item) => item.insertText === 'theme').documentation.value,
    'variable theme\n\nDefinition\n\n```ftl\n<#assign theme = "blue">\n```'
  );
  assert.strictEqual(completions.find((item) => item.insertText === 'theme').detail, 'cards.ftl');
  assert.strictEqual(completions.find((item) => item.insertText === 'render').kind, vscode.CompletionItemKind.Method);

  const expressionCompletionDocument = new Document(mainUri, `${mainText}\n\${cards.`);
  const expressionCompletions = await providers.completion.provideCompletionItems(
    expressionCompletionDocument,
    expressionCompletionDocument.positionAt(expressionCompletionDocument.getText().length)
  );
  assert(expressionCompletions.some((item) => item.insertText === 'total'));
  assert.strictEqual(expressionCompletions.find((item) => item.insertText === 'total').kind, vscode.CompletionItemKind.Function);
  assert(expressionCompletions.some((item) => item.insertText === 'theme'));
  assert(expressionCompletions.some((item) => item.insertText === 'nested'));
  assert(!expressionCompletions.some((item) =>
    ['macroOnly', 'functionOnly', 'hiddenNamespace'].includes(item.label.split(/[ (]/)[0])
  ));
  const macroCompletionDocument = new Document(mainUri, `${mainText}\n<@cards.`);
  const macroCompletions = await providers.completion.provideCompletionItems(
    macroCompletionDocument,
    macroCompletionDocument.positionAt(macroCompletionDocument.getText().length)
  );
  assert(macroCompletions.some((item) => item.label === 'render(title, className="button")'));
  assert(!macroCompletions.some((item) =>
    ['macroOnly', 'functionOnly', 'hiddenNamespace'].includes(item.label.split(/[ (]/)[0])
  ));
  assert(!expressionCompletions.some((item) => item.kind === vscode.CompletionItemKind.Method));
  assert(!expressionCompletions.some((item) => item.kind === vscode.CompletionItemKind.Snippet));

  const interpolationRootDocument = new Document(mainUri, `${mainText}\n\${pa`);
  const interpolationRootCompletions = await providers.completion.provideCompletionItems(
    interpolationRootDocument,
    interpolationRootDocument.positionAt(interpolationRootDocument.getText().length)
  );
  assert(interpolationRootCompletions.some((item) => item.insertText === 'pageTitle'));
  assert(interpolationRootCompletions.some((item) => item.insertText === 'cards'));
  assert(!interpolationRootCompletions.some((item) => item.kind === vscode.CompletionItemKind.Method));
  assert(!interpolationRootCompletions.some((item) => item.kind === vscode.CompletionItemKind.Snippet));

  const nestedExpressionCompletionDocument = new Document(mainUri, `${mainText}\n\${toolkit.nested.`);
  const nestedExpressionCompletions = await providers.completion.provideCompletionItems(
    nestedExpressionCompletionDocument,
    nestedExpressionCompletionDocument.positionAt(nestedExpressionCompletionDocument.getText().length)
  );
  assert(nestedExpressionCompletions.some((item) => item.insertText === 'funcTest'));
  assert.strictEqual(
    nestedExpressionCompletions.find((item) => item.insertText === 'funcTest').kind,
    vscode.CompletionItemKind.Function
  );

  const functionArgumentDocument = new Document(mainUri, `${mainText}\n\${toolkit.nested.funcTest(`);
  const functionArgumentCompletions = await providers.completion.provideCompletionItems(
    functionArgumentDocument,
    functionArgumentDocument.positionAt(functionArgumentDocument.getText().length)
  );
  assert(functionArgumentCompletions.some((item) => item.insertText === 'pageTitle'));
  assert(functionArgumentCompletions.some((item) => item.insertText === 'cards'));
  assert(!functionArgumentCompletions.some((item) => item.kind === vscode.CompletionItemKind.Snippet));
  assert.strictEqual(
    functionArgumentCompletions[0].documentation.value,
    'Arguments for funcTest\n\n- **`wert` (Required)**\n- `fallback` = `"standard"`'
  );
  assert(functionArgumentCompletions.some((item) => item.label === 'pageTitle = "Home"'));
  assert(functionArgumentCompletions.some((item) => item.label === 'cards'));
  assert.strictEqual(functionArgumentCompletions[0].detail, 'main.ftl');
  const secondFunctionArgumentDocument = new Document(
    mainUri,
    `${mainText}\n\${toolkit.nested.funcTest(pageTitle, `
  );
  const secondFunctionArgumentCompletions = await providers.completion.provideCompletionItems(
    secondFunctionArgumentDocument,
    secondFunctionArgumentDocument.positionAt(secondFunctionArgumentDocument.getText().length)
  );
  assert.strictEqual(
    secondFunctionArgumentCompletions[0].documentation.value,
    'Arguments for funcTest\n\n- `wert` = `pageTitle`\n- **`fallback` = `"standard"`**'
  );

  const literalFunctionArgumentDocument = new Document(
    mainUri,
    `${mainText}\n\${toolkit.nested.funcTest("wert", `
  );
  const literalFunctionArgumentCompletions = await providers.completion.provideCompletionItems(
    literalFunctionArgumentDocument,
    literalFunctionArgumentDocument.positionAt(literalFunctionArgumentDocument.getText().length)
  );
  assert.strictEqual(
    literalFunctionArgumentCompletions[0].documentation.value,
    'Arguments for funcTest\n\n- `wert` = `"wert"`\n- **`fallback` = `"standard"`**'
  );
  assert(secondFunctionArgumentCompletions.some((item) => item.label === 'pageTitle = "Home"'));

  const macroCallDocument = new Document(mainUri, `${mainText}\n<@cards.render `);
  const macroArgumentCompletions = await providers.completion.provideCompletionItems(
    macroCallDocument,
    macroCallDocument.positionAt(macroCallDocument.getText().length)
  );
  assert.deepStrictEqual(macroArgumentCompletions.map((item) => item.label), ['title (Required)', 'className="button"']);
  assert(!macroArgumentCompletions.some((item) => item.kind === vscode.CompletionItemKind.Snippet));
  assert.strictEqual(macroArgumentCompletions[0].insertText, 'title=');
  assert.strictEqual(macroArgumentCompletions[0].kind, vscode.CompletionItemKind.Property);
  assert.strictEqual(macroArgumentCompletions[1].documentation.value, 'Default: `"button"`');
  const usedMacroArgumentDocument = new Document(mainUri, `${mainText}\n<@cards.render title="Hello" `);
  const unusedMacroArgumentCompletions = await providers.completion.provideCompletionItems(
    usedMacroArgumentDocument,
    usedMacroArgumentDocument.positionAt(usedMacroArgumentDocument.getText().length)
  );
  assert.deepStrictEqual(unusedMacroArgumentCompletions.map((item) => item.label), ['className="button"']);
  assert.strictEqual(unusedMacroArgumentCompletions[0].insertText, 'className=');

  const laterMacroArgumentDocument = new Document(mainUri, `${mainText}\n<@cards.render title="Later" className="primary">`);
  const beforeLaterArgumentPosition = laterMacroArgumentDocument.positionAt(
    laterMacroArgumentDocument.getText().lastIndexOf('<@cards.render ') + '<@cards.render '.length
  );
  const laterMacroArgumentCompletions = await providers.completion.provideCompletionItems(
    laterMacroArgumentDocument,
    beforeLaterArgumentPosition
  );
  assert.deepStrictEqual(laterMacroArgumentCompletions, []);
  assert(providers.completionTriggerCharacters.includes(' '));

  const snippetDocument = new Document(mainUri, `${mainText}\nass`);
  const snippetCompletions = await providers.completion.provideCompletionItems(
    snippetDocument,
    snippetDocument.positionAt(snippetDocument.getText().length)
  );
  assert(snippetCompletions.some((item) => item.label === 'Assign variable'));

  const nestedDefinitionOffset = mainText.indexOf('toolkit.nested.render') + 'toolkit.nested.'.length;
  const nestedDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, nestedDefinitionOffset)
  );
  assert.strictEqual(nestedDefinition.uri.fsPath, '/virtual/work/lib/nested.ftl');

  const nestedVariableOffset = mainText.indexOf('toolkit.nested.label') + 'toolkit.nested.'.length;
  const nestedVariableDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, nestedVariableOffset)
  );
  assert.strictEqual(nestedVariableDefinition.uri.fsPath, '/virtual/work/lib/nested.ftl');
  assert.strictEqual(
    nestedVariableDefinition.range.start.character,
    '<#assign '.length
  );

  const includedDefinitionOffset = mainText.indexOf('toolkit.included') + 'toolkit.'.length;
  const includedDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, includedDefinitionOffset)
  );
  assert.strictEqual(includedDefinition.uri.fsPath, '/virtual/work/lib/toolkit-shared.ftl');

  const nestedCompletionOffset = mainText.indexOf('toolkit.nested.render') + 'toolkit.nested.'.length;
  const nestedCompletions = await providers.completion.provideCompletionItems(
    document,
    positionAt(mainText, nestedCompletionOffset)
  );
  assert(nestedCompletions.some((item) => item.label === 'render()'));
  assert(nestedCompletions.some((item) => item.label === 'label = "Nested"'));

  const toolkitCompletionOffset = mainText.indexOf('toolkit.nested.render') + 'toolkit.'.length;
  const toolkitCompletions = await providers.completion.provideCompletionItems(
    document,
    positionAt(mainText, toolkitCompletionOffset)
  );
  assert(toolkitCompletions.some((item) => item.label === 'included()'));
  assert(toolkitCompletions.some((item) => item.label === 'nested'));
  assert(!toolkitCompletions.some((item) => item.label === '_privateNested'));

  const privateDefinitionOffset = mainText.indexOf('<@cards._hidden') + '<@cards.'.length + 1;
  const privateDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, privateDefinitionOffset)
  );
  assert.strictEqual(privateDefinition.uri.fsPath, '/virtual/work/lib/cards.ftl');
  assert.strictEqual(privateDefinition.range.start.line, positionAt(
    files.get('/virtual/work/lib/cards.ftl'),
    files.get('/virtual/work/lib/cards.ftl').indexOf('<#macro _hidden')
  ).line);

  const privateFunctionDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, mainText.indexOf('cards._hiddenFunction') + 'cards.'.length + 1)
  );
  assert.strictEqual(privateFunctionDefinition.uri.fsPath, '/virtual/work/lib/cards.ftl');

  const privateVariableDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, mainText.indexOf('cards._internal') + 'cards.'.length + 1)
  );
  assert.strictEqual(privateVariableDefinition.uri.fsPath, '/virtual/work/lib/cards.ftl');

  const privateNestedOffset = mainText.indexOf('toolkit._privateNested.render') + 'toolkit.'.length + 2;
  const privateNestedDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, privateNestedOffset)
  );
  assert.strictEqual(privateNestedDefinition.uri.fsPath, '/virtual/work/lib/nested.ftl');

  const privateNestedMemberOffset = mainText.indexOf('toolkit._privateNested.render') + 'toolkit._privateNested.'.length + 1;
  const privateNestedMemberDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, privateNestedMemberOffset)
  );
  assert.strictEqual(privateNestedMemberDefinition.uri.fsPath, '/virtual/work/lib/nested.ftl');

  const cardsUri = uri('/virtual/work/lib/cards.ftl');
  const cardsText = files.get(cardsUri.fsPath);
  const cardsDocument = new Document(cardsUri, cardsText);
  const internalMacroOffset = cardsText.indexOf('_helper />') + 2;
  const internalMacroDefinition = await providers.definition.provideDefinition(
    cardsDocument,
    cardsDocument.positionAt(internalMacroOffset)
  );
  assert.strictEqual(internalMacroDefinition.uri.fsPath, cardsUri.fsPath);

  const pageTitleReferences = await providers.references.provideReferences(
    document,
    positionAt(mainText, variableOffset),
    { includeDeclaration: true }
  );
  assert.strictEqual(pageTitleReferences.length, 1);
  const pageTitleUsages = await providers.references.provideReferences(
    document,
    positionAt(mainText, variableOffset),
    { includeDeclaration: false }
  );
  assert.strictEqual(pageTitleUsages.length, 1);

  const themeReferences = await providers.references.provideReferences(
    document,
    positionAt(mainText, namespaceVariableOffset),
    { includeDeclaration: true }
  );
  assert.strictEqual(themeReferences.length, 2);

  const layoutReferences = await providers.references.provideReferences(
    document,
    positionAt(mainText, localOffset),
    { includeDeclaration: true }
  );
  assert.strictEqual(layoutReferences.length, 3);
  assert(layoutReferences.some((location) =>
    location.uri.fsPath === mainUri.fsPath
    && location.range.start.line === positionAt(
      mainText,
      mainText.indexOf('<@layout>content</@') + '<@layout>content</@'.length
    ).line
    && location.range.start.character === '<@layout>content</@'.length
  ));

  const renderReferences = await providers.references.provideReferences(
    document,
    positionAt(mainText, memberOffset),
    { includeDeclaration: true }
  );
  assert.strictEqual(renderReferences.length, 2);

  const functionDeclarationOffset = cardsText.indexOf('total items') + 1;
  const functionReferences = await providers.references.provideReferences(
    cardsDocument,
    cardsDocument.positionAt(functionDeclarationOffset),
    { includeDeclaration: true }
  );
  assert.strictEqual(functionReferences.length, 1);
  assert.strictEqual(functionReferences[0].uri.fsPath, mainUri.fsPath);
  assert.strictEqual(
    functionReferences[0].range.start.character,
    positionAt(mainText, mainText.indexOf('cards.total(1)') + 'cards.'.length).character
  );
  const functionCallReferences = await providers.references.provideReferences(
    document,
    positionAt(mainText, mainText.indexOf('cards.total(1)') + 'cards.total('.length - 1),
    { includeDeclaration: true }
  );
  assert.strictEqual(functionCallReferences.length, 1);

  const hiddenMacroOffset = cardsText.indexOf('<#macro _hidden') + '<#macro '.length + 1;
  const hiddenMacroReferences = await providers.references.provideReferences(
    cardsDocument,
    cardsDocument.positionAt(hiddenMacroOffset),
    { includeDeclaration: false }
  );
  assert.strictEqual(hiddenMacroReferences.length, 1);
  assert.strictEqual(hiddenMacroReferences[0].uri.fsPath, mainUri.fsPath);

  const hiddenFunctionOffset = cardsText.indexOf('_hiddenFunction value') + 1;
  const hiddenFunctionReferences = await providers.references.provideReferences(
    cardsDocument,
    cardsDocument.positionAt(hiddenFunctionOffset),
    { includeDeclaration: false }
  );
  assert.strictEqual(hiddenFunctionReferences.length, 1);
  assert.strictEqual(hiddenFunctionReferences[0].uri.fsPath, mainUri.fsPath);

  const hiddenVariableOffset = cardsText.indexOf('_internal =') + 1;
  const hiddenVariableReferences = await providers.references.provideReferences(
    cardsDocument,
    cardsDocument.positionAt(hiddenVariableOffset),
    { includeDeclaration: false }
  );
  assert.strictEqual(hiddenVariableReferences.length, 1);
  assert.strictEqual(hiddenVariableReferences[0].uri.fsPath, mainUri.fsPath);

  const nestedUri = uri('/virtual/work/lib/nested.ftl');
  const nestedText = files.get(nestedUri.fsPath);
  const nestedDocument = new Document(nestedUri, nestedText);
  const nestedMacroOffset = nestedText.indexOf('<#macro render>') + '<#macro '.length + 1;
  const nestedMacroReferences = await providers.references.provideReferences(
    nestedDocument,
    nestedDocument.positionAt(nestedMacroOffset),
    { includeDeclaration: false }
  );
  assert.strictEqual(nestedMacroReferences.length, 2);

  const macroDeclarationOffset = cardsText.indexOf('<#macro render') + '<#macro '.length + 1;
  const macroDeclarationNavigation = await providers.definition.provideDefinition(
    cardsDocument,
    cardsDocument.positionAt(macroDeclarationOffset)
  );
  assert(Array.isArray(macroDeclarationNavigation));
  assert.strictEqual(macroDeclarationNavigation.length, 2);

  const functionDeclarationNavigation = await providers.definition.provideDefinition(
    cardsDocument,
    cardsDocument.positionAt(functionDeclarationOffset)
  );
  assert(Array.isArray(functionDeclarationNavigation));
  assert.strictEqual(functionDeclarationNavigation.length, 1);

  // Rename provider tests
  const pageTitleOffset = mainText.indexOf('pageTitle =') + 1;
  const pageTitlePrepare = await providers.rename.prepareRename(document, positionAt(mainText, pageTitleOffset));
  assert(pageTitlePrepare);
  assert.strictEqual(pageTitlePrepare.placeholder, 'pageTitle');

  const renderCallOffset = mainText.indexOf('<@cards.render') + '<@cards.'.length + 1;
  const renderPrepare = await providers.rename.prepareRename(document, positionAt(mainText, renderCallOffset));
  assert(renderPrepare);
  assert.strictEqual(renderPrepare.placeholder, 'render');

  const invalidPrepare = await providers.rename.prepareRename(document, positionAt(mainText, 0));
  assert.strictEqual(invalidPrepare, undefined);

  const pageTitleEdits = await providers.rename.provideRenameEdits(document, positionAt(mainText, pageTitleOffset), 'newTitle');
  assert(pageTitleEdits);
  assert(pageTitleEdits.has(mainUri));
  assert.strictEqual(pageTitleEdits.get(mainUri).length, 2);
  assert(pageTitleEdits.get(mainUri).every((edit) => edit.newText === 'newTitle'));

  const renderEdits = await providers.rename.provideRenameEdits(cardsDocument, cardsDocument.positionAt(macroDeclarationOffset), 'displayCard');
  assert(renderEdits);
  assert(renderEdits.has(cardsUri));
  assert.strictEqual(renderEdits.get(cardsUri).length, 1);
  assert.strictEqual(renderEdits.get(cardsUri)[0].newText, 'displayCard');
  assert(renderEdits.has(mainUri));
  assert.strictEqual(renderEdits.get(mainUri).length, 2);
  assert(renderEdits.get(mainUri).every((edit) => edit.newText === 'displayCard'));

  const sharedUri = uri('/virtual/work/pages/shared.ftl');
  const sharedText = files.get(sharedUri.fsPath);
  const sharedDocument = new Document(sharedUri, sharedText);
  const layoutOffset = sharedText.indexOf('layout') + 1;
  const layoutEdits = await providers.rename.provideRenameEdits(sharedDocument, sharedDocument.positionAt(layoutOffset), 'pageLayout');
  assert(layoutEdits);
  assert.strictEqual(layoutEdits.get(sharedUri).length, 1);
  assert.strictEqual(layoutEdits.get(mainUri).length, 3);
  assert(layoutEdits.get(mainUri).every((edit) => edit.newText === 'pageLayout'));

  await assert.rejects(
    async () => {
      await providers.rename.provideRenameEdits(document, positionAt(mainText, pageTitleOffset), '123invalid');
    },
    /not a valid FreeMarker identifier/
  );
  await assert.rejects(
    async () => {
      await providers.rename.provideRenameEdits(document, positionAt(mainText, pageTitleOffset), 'bad-name');
    },
    /not a valid FreeMarker identifier/
  );

  const nonExistentRename = await providers.rename.provideRenameEdits(document, positionAt(mainText, 0), 'validName');
  assert.strictEqual(nonExistentRename, undefined);

  // Rename function from call site
  const totalOffset = mainText.indexOf('cards.total') + 'cards.'.length + 1;
  const totalPrepare = await providers.rename.prepareRename(document, positionAt(mainText, totalOffset));
  assert(totalPrepare);
  assert.strictEqual(totalPrepare.placeholder, 'total');
  const totalEdits = await providers.rename.provideRenameEdits(document, positionAt(mainText, totalOffset), 'calcSum');
  assert(totalEdits);
  assert.strictEqual(totalEdits.get(cardsUri).length, 1);
  assert.strictEqual(totalEdits.get(cardsUri)[0].newText, 'calcSum');
  assert.strictEqual(totalEdits.get(mainUri).length, 1);
  assert.strictEqual(totalEdits.get(mainUri)[0].newText, 'calcSum');

  // Rename hash member
  const fontOffset = mainText.indexOf('editor.fontSize') + 'editor.'.length + 1;
  const fontPrepare = await providers.rename.prepareRename(document, positionAt(mainText, fontOffset));
  assert(fontPrepare);
  assert.strictEqual(fontPrepare.placeholder, 'fontSize');
  const fontEdits = await providers.rename.provideRenameEdits(document, positionAt(mainText, fontOffset), 'size');
  assert(fontEdits);
  assert.strictEqual(fontEdits.get(mainUri).length, 3);
  assert(fontEdits.get(mainUri).every((edit) => edit.newText === 'size'));

  // Rename prepare on closing macro tag
  const closingLayoutOffset = mainText.indexOf('</@layout>') + '</@'.length + 1;
  const closingLayoutPrepare = await providers.rename.prepareRename(document, positionAt(mainText, closingLayoutOffset));
  assert(closingLayoutPrepare);
  assert.strictEqual(closingLayoutPrepare.placeholder, 'layout');

  // Signature Help provider tests
  assert.deepStrictEqual(providers.signatureHelpTriggerCharacters, ['(', ',']);

  const totalCallOffset = mainText.indexOf('cards.total(1)') + 'cards.total('.length;
  const totalHelp = await providers.signatureHelp.provideSignatureHelp(document, positionAt(mainText, totalCallOffset));
  assert(totalHelp);
  assert.strictEqual(totalHelp.signatures.length, 1);
  assert.strictEqual(totalHelp.signatures[0].label, 'total(items, precision=2, label="compact")');
  assert.strictEqual(totalHelp.signatures[0].documentation.value, 'Calculates a total from the supplied values.');
  assert.strictEqual(totalHelp.signatures[0].parameters.length, 3);
  assert.strictEqual(totalHelp.signatures[0].parameters[0].label, 'items');
  assert.strictEqual(totalHelp.signatures[0].parameters[0].documentation.value, '*(Required)*');
  assert.strictEqual(totalHelp.signatures[0].parameters[1].label, 'precision=2');
  assert.strictEqual(totalHelp.signatures[0].parameters[1].documentation.value, 'Default: `2`');
  assert.strictEqual(totalHelp.signatures[0].parameters[2].label, 'label="compact"');
  assert.strictEqual(totalHelp.signatures[0].parameters[2].documentation.value, 'Default: `"compact"`');
  assert.strictEqual(totalHelp.activeSignature, 0);
  assert.strictEqual(totalHelp.activeParameter, 0);

  const totalSecondDoc = new Document(mainUri, `${mainText}\n\${cards.total(1, `);
  const totalSecondHelp = await providers.signatureHelp.provideSignatureHelp(
    totalSecondDoc,
    totalSecondDoc.positionAt(totalSecondDoc.getText().length)
  );
  assert(totalSecondHelp);
  assert.strictEqual(totalSecondHelp.activeParameter, 1);

  const totalThirdDoc = new Document(mainUri, `${mainText}\n\${cards.total(1, 2, `);
  const totalThirdHelp = await providers.signatureHelp.provideSignatureHelp(
    totalThirdDoc,
    totalThirdDoc.positionAt(totalThirdDoc.getText().length)
  );
  assert(totalThirdHelp);
  assert.strictEqual(totalThirdHelp.activeParameter, 2);

  const nestedFuncDoc = new Document(mainUri, `${mainText}\n\${toolkit.nested.funcTest("wert", `);
  const nestedFuncHelp = await providers.signatureHelp.provideSignatureHelp(
    nestedFuncDoc,
    nestedFuncDoc.positionAt(nestedFuncDoc.getText().length)
  );
  assert(nestedFuncHelp);
  assert.strictEqual(nestedFuncHelp.signatures[0].label, 'funcTest(wert, fallback="standard")');
  assert.strictEqual(nestedFuncHelp.activeParameter, 1);

  const hiddenFuncDoc = new Document(mainUri, `${mainText}\n\${cards._hiddenFunction(1`);
  const hiddenFuncHelp = await providers.signatureHelp.provideSignatureHelp(
    hiddenFuncDoc,
    hiddenFuncDoc.positionAt(hiddenFuncDoc.getText().length)
  );
  assert(hiddenFuncHelp);
  assert.strictEqual(hiddenFuncHelp.signatures[0].label, '_hiddenFunction(value)');
  assert.strictEqual(hiddenFuncHelp.activeParameter, 0);

  const outsideHelp = await providers.signatureHelp.provideSignatureHelp(document, positionAt(mainText, 0));
  assert.strictEqual(outsideHelp, undefined);

  const builtinUri = uri('/virtual/work/pages/builtins.ftl');
  const builtinCompletionsAt = (text) => {
    const builtinDocument = new Document(builtinUri, text);
    return providers.completion.provideCompletionItems(builtinDocument, builtinDocument.positionAt(text.length));
  };
  assert(providers.completionTriggerCharacters.includes('?'));
  const builtinCompletions = await builtinCompletionsAt('<#assign title = "Home">\n${title?');
  assert(builtinCompletions.some((item) => item.insertText === 'upper_case' && item.detail === 'string built-in'));
  assert(builtinCompletions.some((item) => item.label === 'replace(from, to, flags?)' && item.insertText === 'replace'));
  assert(builtinCompletions.some((item) => item.insertText === 'html' && item.tags.includes(vscode.CompletionItemTag.Deprecated)));
  assert(!builtinCompletions.some((item) => item.insertText === 'title'));
  assert((await builtinCompletionsAt('<#if title?up')).some((item) => item.insertText === 'upper_case'));
  assert((await builtinCompletionsAt('<@panel label=title?')).some((item) => item.insertText === 'upper_case'));
  assert(!(await builtinCompletionsAt('${title??')).some((item) => item.insertText === 'upper_case'));
  assert(!(await builtinCompletionsAt('<a href="page?')).some((item) => item.insertText === 'upper_case'));
  assert(!(await builtinCompletionsAt('${"page?')).some((item) => item.insertText === 'upper_case'));

  const builtinHoverAt = (text, word) => {
    const builtinDocument = new Document(builtinUri, text);
    return providers.hover.provideHover(builtinDocument, builtinDocument.positionAt(text.indexOf(word) + 1));
  };
  const builtinHover = await builtinHoverAt('${title?replace("a", "b")}', 'replace');
  assert(builtinHover.contents[0].value.includes('**built-in replace**'));
  assert(builtinHover.contents[0].value.includes('?replace(from, to, flags?)'));
  assert(builtinHover.contents[0].value.includes('Applies to: string'));
  assert.deepStrictEqual(builtinHover.range.start, new Position(0, 8));
  assert((await builtinHoverAt('${title?upperCase}', 'upperCase')).contents[0].value.includes('**built-in upper_case**'));
  assert((await builtinHoverAt('${title?html}', 'html')).contents[0].value.includes('Deprecated'));
  assert.strictEqual(await builtinHoverAt('${title?unknown_name}', 'unknown_name'), undefined);
  assert.strictEqual(await builtinHoverAt('<a href="page?trim">', 'trim'), undefined);

  const builtinHelpAt = (text) => {
    const builtinDocument = new Document(builtinUri, text);
    return providers.signatureHelp.provideSignatureHelp(builtinDocument, builtinDocument.positionAt(text.length));
  };
  const replaceHelp = await builtinHelpAt('${title?replace(');
  assert.strictEqual(replaceHelp.signatures[0].label, '?replace(from, to, flags?)');
  assert.deepStrictEqual(
    replaceHelp.signatures[0].parameters.map(({ label }) => replaceHelp.signatures[0].label.slice(...label)),
    ['from', 'to', 'flags?']
  );
  assert.strictEqual(replaceHelp.signatures[0].parameters[0].documentation.value, '*(Required)*');
  assert.strictEqual(replaceHelp.signatures[0].parameters[2].documentation.value, 'Optional');
  assert.strictEqual(replaceHelp.activeParameter, 0);
  assert.strictEqual((await builtinHelpAt('${title?replace("a, b", ')).activeParameter, 1);
  assert.strictEqual((await builtinHelpAt('<#if title?replace("a", "b", "r", ')).activeParameter, 2);
  assert.strictEqual((await builtinHelpAt('${item?item_cycle("a", "b", "c", "d", ')).activeParameter, 2);
  assert.strictEqual((await builtinHelpAt('${title?left_pad(title?index_of(')).signatures[0].label, '?index_of(substring, fromIndex?)');
  assert.strictEqual(await builtinHelpAt('${title?trim('), undefined);
  assert.strictEqual((await builtinHelpAt('${title?wrap(40, ')).signatures[0].label, '?wrap(width, firstPrefix?, otherPrefix?)');
  assert.strictEqual((await builtinHelpAt('${title?wrap(40, ')).activeParameter, 1);
  assert.strictEqual(await builtinHelpAt('${title?replace("a", "b")'), undefined);
  assert.strictEqual(await builtinHelpAt('${replace('), undefined);

  onDidOpenDocument(new Document(builtinUri, '${title?uper_case}'));
  assert.strictEqual(diagnosticEntries.get(builtinUri.fsPath).length, 1);
  assert(diagnosticEntries.get(builtinUri.fsPath)[0].message.includes('Did you mean ?upper_case?'));
  assert.deepStrictEqual(diagnosticEntries.get(builtinUri.fsPath)[0].range.start, new Position(0, 8));

  // Built-ins that fit the type of the expression are listed first.
  const firstBuiltins = async (text) => (await builtinCompletionsAt(text))
    .sort((left, right) => left.sortText.localeCompare(right.sortText))
    .slice(0, 3)
    .map((item) => item.detail);
  assert.deepStrictEqual(await firstBuiltins('<#assign title = "Home">\n${title?'), Array(3).fill('string built-in'));
  assert.deepStrictEqual(await firstBuiltins('<#assign count = 3>\n${count?'), Array(3).fill('number built-in'));
  assert.deepStrictEqual(await firstBuiltins('<#assign names = ["a", "b"]>\n${names?'), Array(3).fill('sequence built-in'));
  assert.deepStrictEqual(await firstBuiltins('<#assign names = {"a": 1}>\n${names?'), ['hash built-in', 'hash built-in', 'number built-in']);
  assert.deepStrictEqual(await firstBuiltins('<#assign names = {"a": "b"}>\n${names.a?'), Array(3).fill('string built-in'));
  assert.deepStrictEqual(await firstBuiltins('<#assign note>text</#assign>\n${note?'), Array(3).fill('string built-in'));
  assert.deepStrictEqual(await firstBuiltins('<#list items as item>${item?'), Array(3).fill('loop variable built-in'));
  assert.deepStrictEqual(await firstBuiltins('${"text"?'), Array(3).fill('string built-in'));
  assert.deepStrictEqual(await firstBuiltins('${12.5?'), Array(3).fill('number built-in'));
  assert.deepStrictEqual(await firstBuiltins('${0xFF?'), Array(3).fill('number built-in'));
  assert.deepStrictEqual(await firstBuiltins('<#assign title = "Home">\n${title?trim?'), ['number built-in', 'expert built-in', 'node built-in']);
  assert.deepStrictEqual(await firstBuiltins('${unknown?'), ['number built-in', 'expert built-in', 'node built-in']);

  // Directives, end tags, and special variables
  assert(providers.completionTriggerCharacters.includes('#'));
  const directiveCompletions = await builtinCompletionsAt('<#');
  assert(directiveCompletions.some((item) => item.label === 'list' && item.kind === vscode.CompletionItemKind.Keyword));
  assert(directiveCompletions.some((item) => item.label === 'foreach' && item.tags.includes(vscode.CompletionItemTag.Deprecated)));
  assert(!directiveCompletions.some((item) => item.kind === vscode.CompletionItemKind.Snippet));
  assert((await builtinCompletionsAt('<#li')).some((item) => item.label === 'list'));
  assert.deepStrictEqual(
    (await builtinCompletionsAt('<#if a><#list xs as x><@box>${x}</@box><#sep>, </#')).map((item) => item.insertText),
    ['list>', 'if>']
  );
  assert.deepStrictEqual(
    (await builtinCompletionsAt('<#if a><@layout.page><@box></@')).map((item) => item.insertText),
    ['box>', 'layout.page>']
  );
  assert.deepStrictEqual(await builtinCompletionsAt('<#if a></#if></#'), []);
  const closedTagDocument = new Document(builtinUri, '<#if a></#>');
  assert.deepStrictEqual(
    (await providers.completion.provideCompletionItems(closedTagDocument, new Position(0, 10))).map((item) => item.insertText),
    ['if']
  );

  const specialCompletions = await builtinCompletionsAt('${.');
  assert(specialCompletions.some((item) => item.label === 'now' && item.detail === 'special variable'));
  assert((await builtinCompletionsAt('<#if .main')).some((item) => item.label === 'main_template_name'));
  assert(!(await builtinCompletionsAt('${user.')).some((item) => item.detail === 'special variable'));
  assert(!(await builtinCompletionsAt('${1.')).some((item) => item.detail === 'special variable'));
  assert(!(await builtinCompletionsAt('<p>Text.')).some((item) => item.detail === 'special variable'));

  const directiveHover = await builtinHoverAt('<#list xs as x></#list>', 'list');
  assert(directiveHover.contents[0].value.includes('**directive list**'));
  assert(directiveHover.contents[0].value.includes('<#list sequence as item>'));
  assert((await builtinHoverAt('${a}</#list>', 'list')).contents[0].value.includes('**directive list**'));
  assert.strictEqual(await builtinHoverAt('<#unknown>', 'unknown'), undefined);
  assert((await builtinHoverAt('${.now}', 'now')).contents[0].value.includes('**special variable .now**'));
  assert((await builtinHoverAt('${.mainTemplateName}', 'mainTemplateName')).contents[0].value.includes('.main_template_name'));

  // Problems found with the workspace index
  const indexedIssues = async (text) => {
    const indexedDocument = new Document(uri('/virtual/work/pages/checked.ftl'), text);
    onDidOpenDocument(indexedDocument);
    await new Promise((resolve) => setImmediate(resolve));
    return (diagnosticEntries.get(indexedDocument.uri.fsPath) || []).map((entry) => [entry.message, entry.severity]);
  };
  assert.deepStrictEqual(await indexedIssues([
    '<#import "../lib/cards.ftl" as cards>',
    '<#include "shared.ftl">',
    '<#include "/pages/shared.ftl">',
    '<#include "missing.ftl" ignore_missing=true>',
    '<#include "${folder}/dynamic.ftl">',
    '<#include folder + "/dynamic.ftl">',
    '<@cards.render title="A" />',
    '<@cards.render "A" />',
    '<@cards._hidden />',
    '<@layout />',
    '<@fromDataModel.render />',
    '<@fromDataModel />'
  ].join('\n')), []);
  assert.deepStrictEqual(await indexedIssues([
    '<#import "../lib/cards.ftl" as cards>',
    '<#import "../lib/missing.ftl" as missing>',
    '<#include "nowhere.ftl">',
    '<@cards.rendr title="A" />',
    '<@cards.render className="x">card</@cards.render>',
    '<@cards.render />',
    '<#else>'
  ].join('\n')), [
    ['<#else> must be directly inside <#if> or <#list>.', vscode.DiagnosticSeverity.Error],
    ['Template "../lib/missing.ftl" was not found in the workspace or the configured template roots.', vscode.DiagnosticSeverity.Warning],
    ['Template "nowhere.ftl" was not found in the workspace or the configured template roots.', vscode.DiagnosticSeverity.Warning],
    ['"rendr" is not defined in namespace "cards" (cards.ftl).', vscode.DiagnosticSeverity.Warning],
    ['Missing required parameter "title" for macro "render".', vscode.DiagnosticSeverity.Warning],
    ['Missing required parameter "title" for macro "render".', vscode.DiagnosticSeverity.Warning]
  ]);
  const missingTitleDocument = new Document(uri('/virtual/work/pages/checked.ftl'), '<#import "../lib/cards.ftl" as cards>\n<@cards.render />');
  onDidOpenDocument(missingTitleDocument);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(diagnosticEntries.get(missingTitleDocument.uri.fsPath)[0].range.start, new Position(1, 2));

  // Links, workspace symbols, folding, and matching tags
  const links = await providers.documentLinks.provideDocumentLinks(document);
  assert.deepStrictEqual(links.map((link) => link.target.fsPath), [
    '/virtual/work/lib/cards.ftl',
    '/virtual/work/lib/toolkit.ftl',
    '/virtual/work/lib/cards.ftl',
    '/virtual/work/pages/shared.ftl'
  ]);
  assert.deepStrictEqual(links[0].range.start, new Position(0, 10));
  assert.deepStrictEqual(links[0].range.end, new Position(0, 26));

  const foundSymbols = await providers.workspaceSymbols.provideWorkspaceSymbols('rend');
  assert.deepStrictEqual(
    foundSymbols.map((symbol) => [symbol.name, symbol.containerName]).sort(),
    [['render', 'cards.ftl'], ['render', 'nested.ftl']]
  );
  const cardsRender = foundSymbols.find((symbol) => symbol.containerName === 'cards.ftl');
  assert.strictEqual(cardsRender.kind, vscode.SymbolKind.Method);
  assert.deepStrictEqual(cardsRender.location.range.start, new Position(4, 8));
  const allSymbols = await providers.workspaceSymbols.provideWorkspaceSymbols('');
  assert(allSymbols.some((symbol) => symbol.name === 'theme' && symbol.kind === vscode.SymbolKind.Variable));
  assert(!allSymbols.some((symbol) => symbol.name === 'macroOnly' || symbol.name === 'product'));

  const foldingDocument = new Document(builtinUri, [
    '<#-- Lists the',
    '     products. -->',
    '<#if ready>',
    '<ul>',
    '<#list products as product>',
    '<li>${product}</li>',
    '</#list>',
    '</ul>',
    '<#else>',
    '<p>',
    '  Loading',
    '</p>',
    '</#if>',
    '<#if inline>yes</#if>'
  ].join('\n'));
  assert.deepStrictEqual(
    providers.folding.provideFoldingRanges(foldingDocument)
      .map((range) => [range.start, range.end])
      .sort((left, right) => left[0] - right[0]),
    [[0, 1], [2, 7], [4, 5], [8, 11], [9, 10]]
  );
  assert.strictEqual(
    providers.folding.provideFoldingRanges(foldingDocument).find((range) => range.start === 0).kind,
    vscode.FoldingRangeKind.Comment
  );

  const highlightedTags = (position) => (providers.highlights.provideDocumentHighlights(foldingDocument, position) || [])
    .map((highlight) => foldingDocument.getText(highlight.range));
  assert.deepStrictEqual(highlightedTags(new Position(2, 2)), ['<#if', '<#else', '</#if']);
  assert.deepStrictEqual(highlightedTags(new Position(8, 4)), ['<#if', '<#else', '</#if']);
  assert.deepStrictEqual(highlightedTags(new Position(6, 3)), ['<#list', '</#list']);
  assert.deepStrictEqual(highlightedTags(new Position(5, 8)), []);

  // Square bracket syntax
  const squareUri = uri('/virtual/work/pages/square.ftl');
  const squareHeader = '[#import "../lib/cards.ftl" as cards]\n[#-- The page title. --]\n[#assign pageTitle = "Home"]\n[#macro box label size=1][/#macro]\n';
  const squareCompletionsAt = (text) => {
    const squareDocument = new Document(squareUri, squareHeader + text);
    return providers.completion.provideCompletionItems(squareDocument, squareDocument.positionAt(squareHeader.length + text.length));
  };
  assert((await squareCompletionsAt('[@cards.')).some((item) => item.insertText === 'render'));
  assert((await squareCompletionsAt('${cards.')).some((item) => item.insertText === 'total'));
  assert((await squareCompletionsAt('[@box ')).some((item) => item.insertText === 'label='));
  assert.deepStrictEqual((await squareCompletionsAt('[@box label="a" ')).map((item) => item.insertText), ['size=']);
  assert((await squareCompletionsAt('[#if pageTitle?')).some((item) => item.insertText === 'upper_case' && item.sortText.startsWith('0_')));
  const squareDirectives = await squareCompletionsAt('[#');
  assert.strictEqual(squareDirectives.find((item) => item.label === 'list').detail, '[#list sequence as item]...[#else]...[/#list]');
  assert(squareDirectives.find((item) => item.label === 'assign').documentation.value.includes('`[/#assign]`'));
  assert.deepStrictEqual(
    (await squareCompletionsAt('[#if a > 1][#list xs as x][@box][/@box][/#')).map((item) => [item.insertText, item.detail]),
    [['list]', 'Close [#list]'], ['if]', 'Close [#if]']]
  );
  assert.deepStrictEqual((await squareCompletionsAt('[#if a][@cards.render][/@')).map((item) => item.insertText), ['cards.render]']);
  const squareSnippets = await squareCompletionsAt('if');
  assert.strictEqual(
    squareSnippets.find((item) => item.label === 'If block').insertText.value,
    '[#if ${1:condition}]\n\t$0\n[/#if]'
  );
  assert.strictEqual((await squareCompletionsAt('ftlc')).find((item) => item.label === 'FreeMarker comment').insertText.value, '[#--\n\t$0\n--]');
  assert.strictEqual((await squareCompletionsAt('interp')).find((item) => item.label === 'Interpolation').insertText.value, '${${1:expression}}$0');

  const squareText = `${squareHeader}[#if pageTitle?has_content]\n[@cards.render title=pageTitle /]\n[@box label=pageTitle]x[/@box]\n[#else]\n${'${pageTitle}'}\n[/#if]\n[@cards.render /]\n[#case 1]`;
  const squareDocument = new Document(squareUri, squareText);
  files.set(squareUri.fsPath, squareText);
  const squarePosition = (needle, shift = 1) => squareDocument.positionAt(squareText.indexOf(needle) + shift);
  const squareHover = async (needle, shift) => (await providers.hover.provideHover(squareDocument, squarePosition(needle, shift))).contents[0].value;
  assert((await squareHover('pageTitle?')).includes('[#assign pageTitle = "Home"]'));
  assert((await squareHover('pageTitle?')).includes('The page title.'));
  assert((await squareHover('box label=')).includes('[#macro box label size=1]'));
  assert((await squareHover('[#if pageTitle', 3)).includes('[#if condition]...[#elseif condition]...[#else]...[/#if]'));
  assert((await squareHover('has_content')).includes('**built-in has_content**'));
  const squareDefinition = await providers.definition.provideDefinition(squareDocument, squarePosition('render title'));
  assert.strictEqual(squareDefinition.uri.fsPath, '/virtual/work/lib/cards.ftl');
  const squareReferences = await providers.references.provideReferences(squareDocument, squarePosition('pageTitle?'));
  assert.deepStrictEqual(squareReferences.map((reference) => reference.range.start.line), [4, 5, 6, 8]);
  const squareOutline = await providers.documentSymbols.provideDocumentSymbols(squareDocument);
  assert.deepStrictEqual(squareOutline.map((group) => group.children.map((symbol) => symbol.name)), [['cards'], ['pageTitle'], ['box']]);
  assert.deepStrictEqual(squareOutline[1].children[0].range.start, new Position(2, 0));
  assert.strictEqual((await providers.documentLinks.provideDocumentLinks(squareDocument))[0].target.fsPath, '/virtual/work/lib/cards.ftl');

  onDidOpenDocument(squareDocument);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(diagnosticEntries.get(squareUri.fsPath).map((entry) => entry.message), [
    '[#case] must be directly inside [#switch].',
    'Missing required parameter "title" for macro "render".'
  ]);
  assert.deepStrictEqual(
    providers.folding.provideFoldingRanges(squareDocument).map((range) => [range.start, range.end]),
    [[4, 6], [7, 8]]
  );
  assert.deepStrictEqual(
    providers.highlights.provideDocumentHighlights(squareDocument, squarePosition('[#else]', 2))
      .map((highlight) => squareDocument.getText(highlight.range)),
    ['[#if', '[#else', '[/#if']
  );
  const squareFormat = providers.formatting.provideDocumentFormattingEdits(
    new Document(squareUri, '[#if ready]\n<p>Ready</p>\n[/#if]'),
    { insertSpaces: true, tabSize: 2 }
  );
  assert.strictEqual(squareFormat[0].newText, '[#if ready]\n  <p>Ready</p>\n[/#if]');
  const squareHelp = await providers.signatureHelp.provideSignatureHelp(
    new Document(squareUri, `${squareHeader}[#if cards.total(pageTitle?length > 2, `),
    new Position(4, 38)
  );
  assert.strictEqual(squareHelp.signatures[0].label, 'total(items, precision=2, label="compact")');
  assert.strictEqual(squareHelp.activeParameter, 1);

  // Square bracket interpolations are a project-wide setting.
  settings.interpolationSyntax = 'squareBracket';
  assert((await squareCompletionsAt('[=cards.')).some((item) => item.insertText === 'total'));
  assert((await squareCompletionsAt('[=pageTitle?')).some((item) => item.insertText === 'upper_case'));
  assert(!(await squareCompletionsAt('${pageTitle?')).some((item) => item.insertText === 'upper_case'));
  assert.strictEqual((await squareCompletionsAt('interp')).find((item) => item.label === 'Interpolation').insertText.value, '[=${1:expression}]$0');
  const interpolationDocument = new Document(squareUri, `${squareHeader}[=pageTitle?uper_case]`);
  assert((await providers.hover.provideHover(interpolationDocument, new Position(4, 4))).contents[0].value.includes('[#assign pageTitle = "Home"]'));
  onDidOpenDocument(interpolationDocument);
  assert(diagnosticEntries.get(squareUri.fsPath)[0].message.includes('Did you mean ?upper_case?'));
  delete settings.interpolationSyntax;

  console.log('Extension integration tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});