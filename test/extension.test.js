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
    '<#macro render title className="button">card</#macro>',
    '<#macro _hidden>secret</#macro>',
    '<#macro _helper><#return></#macro>',
    '<#macro publicHelper><@_helper /></#macro>',
    '<#-- Calculates a total from the supplied values. -->',
    '<#function total items precision=2 label="compact">1</#function>',
    '<#assign salutation>\n  Hello World\n</#assign>',
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

class Document {
  constructor(targetUri, text) {
    this.uri = targetUri;
    this.text = text;
    this.languageId = 'freemarker';
  }

  getText() {
    return this.text;
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
}

const providers = {};
const disposable = { dispose() {} };
const vscode = {
  Position,
  Range,
  Location,
  Hover,
  CompletionItemKind: { Method: 1, Function: 2, Variable: 5, Module: 8, Property: 9, Snippet: 14 },
  TextEdit: {
    replace: (range, newText) => ({ range, newText })
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
  workspace: {
    workspaceFolders: [{ uri: uri('/virtual/work') }],
    findFiles: async () => [...files.keys()].map(uri),
    fs: {
      readFile: async (targetUri) => Buffer.from(files.get(targetUri.fsPath))
    },
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    openTextDocument: async (targetUri) => new Document(targetUri, files.get(targetUri.fsPath)),
    onDidChangeTextDocument: () => disposable,
    onDidOpenTextDocument: () => disposable,
    createFileSystemWatcher: () => ({
      onDidCreate() {},
      onDidChange() {},
      onDidDelete() {},
      dispose() {}
    })
  },
  languages: {
    registerDefinitionProvider: (_selector, provider) => {
      providers.definition = provider;
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
    registerCompletionItemProvider: (_selector, provider, ...triggerCharacters) => {
      providers.completion = provider;
      providers.completionTriggerCharacters = triggerCharacters;
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
  assert(variableHover.contents[0].value.includes('Value: `"blue"`'));

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

  const privateDefinitionOffset = mainText.indexOf('cards._hidden') + 'cards.'.length + 1;
  const privateDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, privateDefinitionOffset)
  );
  assert.strictEqual(privateDefinition, undefined);

  const privateNestedOffset = mainText.indexOf('toolkit._privateNested.render') + 'toolkit.'.length + 2;
  const privateNestedDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, privateNestedOffset)
  );
  assert.strictEqual(privateNestedDefinition, undefined);

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

  console.log('Extension integration tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});