const assert = require('assert');
const Module = require('module');

const files = new Map([
  ['/virtual/work/pages/main.ftl', [
    '<#import "../lib/cards.ftl" as cards>',
    '<#import "../lib/toolkit.ftl" as toolkit>',
    '<#import "../lib/cards.ftl" as _privateCards>',
    '<#include "shared.ftl">',
    '<#assign pageTitle = "Home">',
    '${pageTitle}',
    '<#list products as product>${product}</#list>',
    '<@cards.render>card</@cards.render>',
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
    '<#macro render>card</#macro>',
    '<#macro _hidden>secret</#macro>',
    '<#macro _helper><#return></#macro>',
    '<#macro publicHelper><@_helper /></#macro>',
    '<#function total>1</#function>',
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
  CompletionItemKind: { Function: 3, Variable: 6, Module: 9 },
  CompletionItem: class {
    constructor(label, kind) {
      this.label = label;
      this.kind = kind;
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
    registerReferenceProvider: (_selector, provider) => {
      providers.references = provider;
      return disposable;
    },
    registerCompletionItemProvider: (_selector, provider) => {
      providers.completion = provider;
      return disposable;
    }
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

  const memberOffset = mainText.indexOf('cards.render') + 'cards.'.length;
  const memberDefinition = await providers.definition.provideDefinition(document, positionAt(mainText, memberOffset));
  assert.strictEqual(memberDefinition.uri.fsPath, '/virtual/work/lib/cards.ftl');
  assert.strictEqual(memberDefinition.range.start.character, '<#macro '.length);

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

  const loopVariableOffset = mainText.indexOf('product}</') + 1;
  const loopVariableDefinition = await providers.definition.provideDefinition(document, positionAt(mainText, loopVariableOffset));
  assert.strictEqual(loopVariableDefinition.uri.fsPath, mainUri.fsPath);
  assert.strictEqual(
    loopVariableDefinition.range.start.line,
    positionAt(mainText, mainText.indexOf('<#list products')).line
  );

  const namespaceVariableOffset = mainText.indexOf('cards.theme') + 'cards.'.length;
  const namespaceVariableDefinition = await providers.definition.provideDefinition(document, positionAt(mainText, namespaceVariableOffset));
  assert.strictEqual(namespaceVariableDefinition.uri.fsPath, '/virtual/work/lib/cards.ftl');
  assert.strictEqual(
    namespaceVariableDefinition.range.start.line,
    positionAt(files.get('/virtual/work/lib/cards.ftl'), files.get('/virtual/work/lib/cards.ftl').indexOf('theme =')).line
  );

  const completionOffset = mainText.indexOf('<@cards.render') + '<@cards.'.length;
  const completions = await providers.completion.provideCompletionItems(document, positionAt(mainText, completionOffset));
  assert.deepStrictEqual(completions.map((item) => item.label), ['render', 'publicHelper', 'total', 'theme']);
  assert(!completions.some((item) => item.label.startsWith('_')));
  assert.strictEqual(completions.find((item) => item.label === 'render').kind, vscode.CompletionItemKind.Function);
  assert.strictEqual(completions.find((item) => item.label === 'theme').kind, vscode.CompletionItemKind.Variable);

  const nestedDefinitionOffset = mainText.indexOf('toolkit.nested.render') + 'toolkit.nested.'.length;
  const nestedDefinition = await providers.definition.provideDefinition(
    document,
    positionAt(mainText, nestedDefinitionOffset)
  );
  assert.strictEqual(nestedDefinition.uri.fsPath, '/virtual/work/lib/nested.ftl');

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
  assert(nestedCompletions.some((item) => item.label === 'render'));
  assert(nestedCompletions.some((item) => item.label === 'label'));

  const toolkitCompletionOffset = mainText.indexOf('toolkit.nested.render') + 'toolkit.'.length;
  const toolkitCompletions = await providers.completion.provideCompletionItems(
    document,
    positionAt(mainText, toolkitCompletionOffset)
  );
  assert(toolkitCompletions.some((item) => item.label === 'included'));
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