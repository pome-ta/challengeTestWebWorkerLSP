// worker.js
// v0.0.3.9 Phase 8 clean implementation (completion / hover minimal)

import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';
import { postLog, setDebug } from './util/logger.js';

setDebug(true);

/**
 * ---- Internal document state ----
 * Phase 4〜7 で確立したモデルを維持
 */
const documents = new Map(); // uri -> { version, text }
let initialized = false;

/**
 * ---- Phase 8 debug observability ----
 */
let lastCompletion = null;
let lastHover = null;

const handlers = {
  // --- lifecycle ---
  'worker/ready': async () => ({ ok: true }),

  // --- VFS ---
  'vfs/ensureReady': async () => {
    await VfsCore.ensureReady();
    return { ok: true };
  },

  'vfs/getEnvInfo': async () => VfsCore.getEnvInfo(),

  'vfs/resetForTest': async () => {
    VfsCore.resetForTest();
    documents.clear();
    initialized = false;
    lastCompletion = null;
    lastHover = null;
    return { ok: true };
  },

  'vfs/openFile': async (params) => {
    if (
      !params ||
      typeof params.uri !== 'string' ||
      typeof params.content !== 'string'
    ) {
      throw Object.assign(new Error('Invalid params'), { code: -32602 });
    }

    if (!VfsCore.getEnvInfo().ready) {
      throw Object.assign(new Error('VFS is not ready'), { code: -32001 });
    }

    const prev = documents.get(params.uri);
    const version = prev ? prev.version + 1 : 1;

    documents.set(params.uri, {
      uri: params.uri,
      version,
      text: params.content,
    });

    return { ok: true };
  },

  // --- LSP ---
  'lsp/initialize': async (params) => {
    const result = await LspCore.initialize(params);
    initialized = true;
    return result;
  },

  /**
   * ---- Phase 8: completion (minimal) ----
   */
  'textDocument/completion': async (params) => {
    lastCompletion = params ?? null;

    if (!initialized) {
      return { isIncomplete: false, items: [] };
    }

    const uri = params?.textDocument?.uri;
    if (!uri || !documents.has(uri)) {
      return { isIncomplete: false, items: [] };
    }

    return {
      isIncomplete: false,
      items: [],
    };
  },

  /**
   * ---- Phase 8: hover (minimal) ----
   */
  'textDocument/hover': async (params) => {
    lastHover = params ?? null;

    if (!initialized) {
      return null;
    }

    const uri = params?.textDocument?.uri;
    if (!uri || !documents.has(uri)) {
      return null;
    }

    return {
      contents: {
        kind: 'plaintext',
        value: '',
      },
    };
  },

  // --- debug ---
  'lsp/_debug/getLastCompletion': async () => lastCompletion,
  'lsp/_debug/getLastHover': async () => lastHover,
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

// RPC ready
postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });
