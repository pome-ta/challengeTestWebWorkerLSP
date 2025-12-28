// core/text-document-manager.js
// v0.0.4.2

export class TextDocumentManager {
  constructor(vfsCore) {
    this.vfs = vfsCore;

    // uri -> { uri, languageId, version, text }
    this.map = new Map();
  }

  /* --------------------------------------------------
   * helpers
   * -------------------------------------------------- */

  get(uri) {
    return this.map.get(uri) ?? null;
  }

  getAll() {
    return [...this.map.values()];
  }

  /* --------------------------------------------------
   * didOpen
   * -------------------------------------------------- */

  async didOpen(params) {
    const { textDocument } = params;
    if (!textDocument) return;

    const { uri, languageId = 'typescript', version = 1, text } = textDocument;

    // VFS にも反映
    await this.vfs.writeFile(uri, text);

    this.map.set(uri, {
      uri,
      languageId,
      version,
      text,
    });
  }

  /* --------------------------------------------------
   * didChange
   * -------------------------------------------------- */

  async didChange(params) {
    const { textDocument, contentChanges } = params;
    const uri = textDocument?.uri;

    const current = this.map.get(uri);
    if (!current) return;

    // LSP 仕様に準拠：今回は full text だけを対象にする
    const newText =
      contentChanges?.[0]?.text != null ? contentChanges[0].text : current.text;

    await this.vfs.writeFile(uri, newText);

    this.map.set(uri, {
      ...current,
      version: textDocument.version ?? current.version + 1,
      text: newText,
    });
  }

  /* --------------------------------------------------
   * didClose
   * -------------------------------------------------- */

  async didClose(params) {
    const uri = params?.textDocument?.uri;
    if (!uri) return;

    this.map.delete(uri);

    // VFS からは消さない（言語サービスキャッシュのため）
  }
}
