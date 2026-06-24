// core/lsp-server-core.js
// v0.0.4.2

import * as ts from 'https://esm.sh/typescript';
import { VfsCoreInstance } from './vfs-core.js';
import { TextDocumentManagerInstance } from './text-document-manager.js';

class LspServerCore {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    await VfsCoreInstance.ensureReady();
    await TextDocumentManagerInstance.initialize();
    this.initialized = true;
    return { capabilities: {} };
  }

  async shutdown() {
    this.initialized = false;
  }

  completion({ textDocument, position }) {
    const ls = VfsCoreInstance.getLanguageService();
    const fileName = new URL(textDocument.uri).pathname;

    return ls.getCompletionsAtPosition(fileName, this.offsetAt(fileName, position), {});
  }

  hover({ textDocument, position }) {
    const ls = VfsCoreInstance.getLanguageService();
    const fileName = new URL(textDocument.uri).pathname;

    const info = ls.getQuickInfoAtPosition(fileName, this.offsetAt(fileName, position));

    if (!info) return null;

    const display = ts.displayPartsToString(info.displayParts);

    return {
      contents: { kind: 'markdown', value: display },
    };
  }

  offsetAt(fileName, pos) {
    const sf = VfsCoreInstance.getSourceFile(fileName);
    const lineStarts = sf.getLineStarts();
    return lineStarts[pos.line] + pos.character;
  }
}

export const LspServerCoreInstance = new LspServerCore();
