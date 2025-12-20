// worker.js
// v0.0.3.7 (Phase 6 clean)

import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';
import { postLog, setDebug } from './util/logger.js';

setDebug(true);

/*
 * documentStates:
 * {
 *   [uri]: {
 *     version: number,
 *     text: string,
 *     opened: boolean
 *   }
 * }
 */
const documentStates = new Map();

let initialized = false;

// --- debug observation ---
let lastDidOpen = null;
let lastDidChange = null;
let lastDidClose = null;

const handlers = {
  // --- lifecycle ---
  'worker/ready': async () => ({ ok: true }),

  // --- vfs ---
  'vfs/ensureReady': async () => {
    await VfsCore.ensureReady();
    return { ok: true };
  },

  'vfs/resetForTest': async () => {
    documentStates.clear();
    lastDidOpen = null;
    lastDidChange = null;
    lastDidClose = null;
    initialized = false;
    return { ok: true };
  },

  'vfs/openFile': async ({ uri, content }) => {
    if (typeof uri !== 'string' || typeof content !== 'string') {
      throw Object.assign(new Error('Invalid params'), { code: -32602 });
    }
    if (!VfsCore.getEnvInfo().ready) {
      throw Object.assign(new Error('VFS not ready'), { code: -32001 });
    }

    const prev = documentStates.get(uri);

    // --- initialize 前: state のみ保持 ---
    if (!initialized) {
      documentStates.set(uri, {
        version: prev ? prev.version + 1 : 1,
        text: content,
        opened: true,
      });
      return { ok: true };
    }

    // --- initialize 後 ---
    if (!prev) {
      // didOpen
      documentStates.set(uri, {
        version: 1,
        text: content,
        opened: true,
      });

      lastDidOpen = {
        uri,
        version: 1,
        text: content,
      };
    } else if (prev.opened) {
      // didChange
      const nextVersion = prev.version + 1;
      documentStates.set(uri, {
        version: nextVersion,
        text: content,
        opened: true,
      });

      lastDidChange = {
        uri,
        version: nextVersion,
        text: content,
      };
    } else {
      // reopen after close → didOpen with version=1
      documentStates.set(uri, {
        version: 1,
        text: content,
        opened: true,
      });

      lastDidOpen = {
        uri,
        version: 1,
        text: content,
      };
    }

    return { ok: true };
  },

  'vfs/closeFile': async ({ uri }) => {
    if (typeof uri !== 'string') {
      throw Object.assign(new Error('Invalid params'), { code: -32602 });
    }

    const state = documentStates.get(uri);
    if (!state || !state.opened) {
      return { ok: true };
    }

    // initialize 前は state 破棄のみ
    if (!initialized) {
      documentStates.delete(uri);
      return { ok: true };
    }

    // initialize 後: didClose
    documentStates.delete(uri);

    lastDidClose = { uri };

    return { ok: true };
  },

  // --- lsp ---
  'lsp/initialize': async (params) => {
    const result = await LspCore.initialize(params);
    initialized = true;
    return result;
  },

  // --- debug ---
  'lsp/_debug/getLastDidOpen': async () => lastDidOpen,
  'lsp/_debug/getLastDidChange': async () => lastDidChange,
  'lsp/_debug/getLastDidClose': async () => lastDidClose,
};

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg || msg.jsonrpc !== '2.0') return;

  const { id, method, params } = msg;
  const handler = handlers[method];

  if (!handler) {
    if (id != null) {
      self.postMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
    }
    return;
  }

  try {
    const result = await handler(params);
    if (id != null) {
      self.postMessage({ jsonrpc: '2.0', id, result });
    }
  } catch (err) {
    if (id != null) {
      self.postMessage({
        jsonrpc: '2.0',
        id,
        error: {
          code: err?.code ?? -32000,
          message: err?.message ?? String(err),
        },
      });
    }
  }
};

// --- boot ---
postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });
