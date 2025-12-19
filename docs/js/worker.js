// worker.js
// v0.0.3.5

import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';
import { postLog, setDebug } from './util/logger.js';

// Enable debug by default for test runner visibility
setDebug(true);

// --- Phase 4: 観測用状態 ---
let lastDidOpen = null;
let lastDidChange = null;

// --- Phase 4: 単一ドキュメント状態 ---
const documentState = {
  uri: null,
  version: 0,
  text: null,
};

const handlers = {
  // --- lifecycle ---
  'worker/ready': async () => ({ ok: true }),

  // --- vfs ---
  'vfs/ensureReady': async () => {
    await VfsCore.ensureReady();
    return { ok: true };
  },

  'vfs/getEnvInfo': async () => {
    return VfsCore.getEnvInfo();
  },

  'vfs/resetForTest': async () => {
    VfsCore.resetForTest();
    documentState.uri = null;
    documentState.version = 0;
    documentState.text = null;
    lastDidOpen = null;
    lastDidChange = null;
    return { ok: true };
  },

  'vfs/openFile': async (params) => {
    // params validation
    if (
      !params ||
      typeof params.uri !== 'string' ||
      params.uri.length === 0 ||
      typeof params.content !== 'string'
    ) {
      throw Object.assign(new Error('Invalid params'), { code: -32602 });
    }

    // VFS ready check
    if (!VfsCore.getEnvInfo().ready) {
      throw Object.assign(new Error('VFS is not ready'), { code: -32001 });
    }

    if (documentState.uri === params.uri) {
      documentState.version += 1;
    } else {
      documentState.uri = params.uri;
      documentState.version = 1;
    }

    documentState.text = params.content;

    return { ok: true };
  },

  // --- lsp ---
  'lsp/initialize': async (params) => {
    const result = await LspCore.initialize(params);

    /*
      Phase 4 仕様:
      - initialize 時点で documentState を評価
      - version === 1 → didOpen
      - version > 1  → didChange
      NOTE:
      この挙動は Phase 5 で LSP 標準フローに置き換える
    */
    if (documentState.uri) {
      if (documentState.version === 1) {
        lastDidOpen = {
          uri: documentState.uri,
          version: 1,
          text: documentState.text,
        };
      } else if (documentState.version > 1) {
        lastDidChange = {
          uri: documentState.uri,
          version: documentState.version,
          text: documentState.text,
        };
      }
    }

    return result;
  },

  'textDocument/hover': async () => null,

  // --- lsp debug (Phase 4 test only) ---
  'lsp/_debug/getLastDidOpen': async () => {
    return lastDidOpen;
  },

  'lsp/_debug/getLastDidChange': async () => {
    return lastDidChange;
  },
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

postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });
