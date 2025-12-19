// worker.js
// v0.0.3.6
// Phase 5 clean minimal implementation

import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';
import { postLog, setDebug } from './util/logger.js';

setDebug(true);

/* -------------------------
 * Phase 5 state
 * ------------------------- */

let isInitialized = false;

const documentState = {
  uri: null,
  version: 0,
  text: null,
};

// debug observation (no side effects)
let lastDidOpen = null;
let lastDidChange = null;

/* -------------------------
 * RPC handlers
 * ------------------------- */

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
    isInitialized = false;

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

    const { uri, content } = params;

    // version management
    if (documentState.uri === uri) {
      documentState.version += 1;
    } else {
      documentState.uri = uri;
      documentState.version = 1;
    }

    documentState.text = content;

    // Phase 5: event-driven sync
    if (isInitialized) {
      if (documentState.version === 1) {
        lastDidOpen = {
          uri,
          version: 1,
          text: content,
        };
      } else {
        lastDidChange = {
          uri,
          version: documentState.version,
          text: content,
        };
      }
    }

    return { ok: true };
  },

  // --- lsp ---
  'lsp/initialize': async (params) => {
    const result = await LspCore.initialize(params);
    isInitialized = true;
    return result;
  },

  'textDocument/hover': async () => {
    return null;
  },

  // --- debug ---
  'lsp/_debug/getLastDidOpen': async () => {
    return lastDidOpen;
  },

  'lsp/_debug/getLastDidChange': async () => {
    return lastDidChange;
  },
};

/* -------------------------
 * JSON-RPC loop
 * ------------------------- */

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

// ready notification
postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });
