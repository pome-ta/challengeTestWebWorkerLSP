// worker.js
// v0.0.3.4

import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';
import { JsonRpcErrorCode } from './core/error-codes.js';
import { postLog, setDebug } from './util/logger.js';

// Enable debug by default for test runner visibility
setDebug(true);

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

  // --- lsp ---
  'lsp/initialize': async (params) => {
    return LspCore.initialize(params);
  },
};

self.onmessage = async (e) => {
  const msg = e.data;

  if (!msg || msg.jsonrpc !== '2.0') return;

  const { id, method, params } = msg;

  if (!handlers[method]) {
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
    const result = await handlers[method](params);

    if (id != null) {
      self.postMessage({ jsonrpc: '2.0', id, result });
    }
  } catch (err) {
    if (id != null) {
      self.postMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err?.message ?? String(err) },
      });
    }
  }
};

// RPC 受付開始通知
postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });
