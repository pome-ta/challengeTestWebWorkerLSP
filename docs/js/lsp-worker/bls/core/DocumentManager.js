import { postLog } from '../../logger.js';

export class DocumentManager {
  #tsEnv;
  #activeDocuments = new Set();

  constructor(tsEnv) {
    this.#tsEnv = tsEnv;
  }

  get activeUris() {
    return Array.from(this.#activeDocuments);
  }

  openDocument(uri, text) {
    this.#activeDocuments.add(uri);
    // ユーザー由来の「ドキュメント」として VFS に反映
    this.#tsEnv.updateDocument(uri, text);
    postLog(`Document opened: ${uri}`);
  }

  updateDocument(uri, text) {
    this.#tsEnv.updateDocument(uri, text);
  }

  closeDocument(uri) {
    this.#activeDocuments.delete(uri);
    this.#tsEnv.closeDocument(uri);
    postLog(`Document closed: ${uri}`);
  }
}
