// worker.js
// v0.0.2.1

import { postLog } from './util/logger.js';
import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';

// ============================================================
// JSON-RPC Method Handlers
// ============================================================
const handlers = {
  // VFS
  'vfs/ensureReady': VfsCore.ensureReady,
  // LSP Lifecycle
  'lsp/ping': () => 'pong',
  'lsp/shutdown': () => {
    postLog('Worker shutting down...');
    setTimeout(() => self.close(), 100);
    return 'shutdown-complete';
  },
};

// ============================================================
// Message Event Listener
// ============================================================
self.addEventListener('message', async ({ data: { id, method, params } }) => {
  postLog(`Received: ${method} (id: ${id})`);

  const handler = handlers[method];
  if (!handler) {
    const message = `Unknown method: ${method}`;
    postLog(`Error: ${message}`);
    if (id) {
      self.postMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message },
      });
    }
    return;
  }

  try {
    const result = await handler(params);
    postLog(`Finished: ${method}`);
    if (id) {
      self.postMessage({
        jsonrpc: '2.0',
        id,
        result: result !== undefined ? result : null,
      });
    }
  } catch (error) {
    const message = `${method} failed: ${error.message}`;
    postLog(`Error: ${message}`);
    if (id) {
      self.postMessage({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message },
      });
    }
  }
});

postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });
