// core/text-document-manager.js

export class TextDocumentManager {
  constructor(vfsCore) {
    if (!vfsCore) {
      throw new Error('TextDocumentManager: vfsCore is required');
    }

    this.vfsCore = vfsCore;

    // uri -> { text, version, languageId, isOpen }
    this.documents = new Map();
  }

  /* --------------------------------------------------
   * basic getters
   * -------------------------------------------------- */

  has(uri) {
    return this.documents.has(uri);
  }

  get(uri) {
    const doc = this.documents.get(uri);
    if (!doc) {
      throw new Error(`TextDocumentManager: not found: ${uri}`);
    }
    return doc;
  }

  getText(uri) {
    return this.get(uri).text;
  }

  /* --------------------------------------------------
   * internal core API (直接呼び出し推奨)
   * -------------------------------------------------- */

  async open({ uri, languageId = 'typescript', text, version = 1 }) {
    await this.vfsCore.ensureReady();

    this.documents.set(uri, {
      text,
      version,
      languageId,
      isOpen: true,
    });

    await this.vfsCore.writeFile(uri, text);
  }

  async change({ uri, version, text }) {
    const doc = this.documents.get(uri);

    if (!doc || !doc.isOpen) {
      throw new Error(`TextDocumentManager: change on unopened ${uri}`);
    }

    // version regression protection
    if (version != null && doc.version != null && version <= doc.version) {
      throw new Error(
        `TextDocumentManager: version regression: ${doc.version} -> ${version} (${uri})`
      );
    }

    doc.text = text;
    doc.version = version;

    await this.vfsCore.writeFile(uri, text);
  }

  async close({ uri }) {
    const doc = this.documents.get(uri);

    if (!doc) {
      throw new Error(`TextDocumentManager: close on unknown ${uri}`);
    }

    doc.isOpen = false;
  }

  /* --------------------------------------------------
   * LSP-compatible wrapper API
   * -------------------------------------------------- */

  async didOpen(params) {
    const { textDocument } = params;

    return this.open({
      uri: textDocument.uri,
      text: textDocument.text ?? '',
      version: textDocument.version,
      languageId: textDocument.languageId,
    });
  }

  async didChange(params) {
    const { textDocument, contentChanges } = params;

    if (!contentChanges?.length) {
      throw new Error('TextDocumentManager: empty contentChanges');
    }

    // Phase 10: full text only
    const newText = contentChanges[0].text;

    return this.change({
      uri: textDocument.uri,
      version: textDocument.version,
      text: newText,
    });
  }

  async didClose(params) {
    const { textDocument } = params;

    return this.close({
      uri: textDocument.uri,
    });
  }
}
