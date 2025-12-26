// core/text-document-manager.js
// v0.0.4.2

export class TextDocumentManager {
  constructor(vfsCore) {
    if (!vfsCore) {
      throw new Error("TextDocumentManager: vfsCore is required");
    }

    this.vfsCore = vfsCore;

    // uri -> { text, version, languageId, isOpen }
    this.documents = new Map();
  }

  has(uri) {
    return this.documents.has(uri);
  }

  getText(uri) {
    const doc = this.documents.get(uri);
    if (!doc) {
      throw new Error(`TextDocumentManager: document not found: ${uri}`);
    }
    return doc.text;
  }

  /* ------------------------
   * 内部 API (推奨呼び出し)
   * ------------------------ */

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

  /* ------------------------
   * LSP 互換 wrapper
   * ------------------------ */

  async didOpen(params) {
    const { textDocument } = params;
    return this.open({
      uri: textDocument.uri,
      text: textDocument.text,
      version: textDocument.version,
      languageId: textDocument.languageId,
    });
  }

  async didChange(params) {
    const { textDocument, contentChanges } = params;

    if (!contentChanges?.length) {
      throw new Error("TextDocumentManager: empty contentChanges");
    }

    // Phase10 では full text のみサポート
    const newText = contentChanges[0].text;

    return this.change({
      uri: textDocument.uri,
      version: textDocument.version,
      text: newText,
    });
  }

  async didClose(params) {
    const { textDocument } = params;
    return this.close({ uri: textDocument.uri });
  }
}
