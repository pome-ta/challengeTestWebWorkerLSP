// core/lsp-core.js
// v0.0.3.4

import { VfsCore } from './vfs-core.js';
import { postLog } from '../util/logger.js';

class LspCoreClass {
  #initialized = false;

  constructor() {
    postLog('LspServer instance created');
  }

  async initialize(_params) {
    if (!VfsCore.getEnvInfo().ready) {
      throw new Error('VFS is not ready');
    }

    this.#initialized = true;

    return {
      capabilities: {},
    };
  }
}

export const LspCore = new LspCoreClass();
