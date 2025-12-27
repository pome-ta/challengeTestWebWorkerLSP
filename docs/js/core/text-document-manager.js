// core/text-document-manager.js
// v0.0.4.2

export class TextDocumentManager {
  constructor(vfsCore) {
    if (!vfsCore) {
      throw new Error("TextDocumentManager requires VfsCore instance");
    }
    this.vfs = vfsCore;
    this.opened = new Map(); // uri -> version(optional)
  }

  async open(uri, content) {
    await this.vfs.writeFile(uri, content);
    this.opened.set(uri, { version: 1 });
  }

  async change(uri, newContent) {
    if (!this.opened.has(uri)) {
      throw new Error(`Document not opened: ${uri}`);
    }

    await this.vfs.writeFile(uri, newContent);

    const entry = this.opened.get(uri);
    entry.version += 1;
  }

  async close(uri) {
    this.opened.delete(uri);

    // VFS からも削除するかはポリシー次第
    // ここでは安全側に倒し「削除はしない」
    // LSP でも close = untrack が原則で delete ではない
  }

  async getContent(uri) {
    return await this.vfs.readFile(uri);
  }

  has(uri) {
    return this.opened.has(uri);
  }
}
