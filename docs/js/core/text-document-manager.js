// core/text-document-manager.js

import { VfsCoreInstance } from './vfs-core.js';

class TextDocumentManager {
  constructor() {
    this.docs = new Map();
  }

  async initialize() {
    await VfsCoreInstance.ensureReady();
  }

  didOpen({ uri, text, languageId = 'typescript', version = 1 }) {
    const path = new URL(uri).pathname;

    this.docs.set(uri, { uri, text, languageId, version });
    VfsCoreInstance.writeFile(path, text);
  }

  didChange({ uri, text, version }) {
    const doc = this.docs.get(uri);
    if (!doc) throw new Error('document not opened');

    doc.text = text;
    doc.version = version ?? doc.version + 1;

    const path = new URL(uri).pathname;
    VfsCoreInstance.writeFile(path, text);
  }

  didClose({ uri }) {
    this.docs.delete(uri);
  }

  get(uri) {
    return this.docs.get(uri);
  }
}

export const TextDocumentManagerInstance = new TextDocumentManager();