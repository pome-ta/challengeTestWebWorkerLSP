// worker.js
// v0.0.3.2

import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';
import { JsonRpcErrorCode } from './core/error-codes.js';
import { postLog, setDebug } from './util/logger.js';

// Enable debug by default for test runner visibility
setDebug(true);

// handlers: "method" -> async function(params)
// - Requests (with id) return a result via JSON-RPC response
// - Notifications (no id) do not return a response
const handlers = {
  // VFS
  'vfs/ensureReady': async (params) => await VfsCore.ensureReady(),
  
  // テスト専用: VFS をリセットして単一インスタンス初期状態に戻す
  'vfs/resetForTest': async (params) => await VfsCore.resetForTest(params),
  // テスト専用: テスト専用内部情報の取得
  'vfs/_getEnvInfo': async () => {
    return VfsCore.getEnvInfo();
  },



  // LSP lifecycle / utility
  'lsp/ping': async () => 'pong',
  'lsp/shutdown': async () => {
    postLog('Worker shutting down...');
    setTimeout(() => self.close(), 100);
    return 'shutdown-complete';
  },
  'lsp/initialize': async (params) => await LspCore.initialize(params),

  // Document sync (VFS required)
  'textDocument/didOpen': async (params) => await LspCore.didOpen(params),
  'textDocument/didChange': async (params) => await LspCore.didChange(params),
  'textDocument/didClose': async (params) => await LspCore.didClose(params),
};

// ============================================================
// JSON-RPC Message Processing
// ============================================================

/**
 * Handle incoming JSON-RPC message object.
 * Validates JSON-RPC 2.0 structure, VFS precondition for LSP methods, and dispatches to handlers.
 *
 * @param {object} msg JSON-RPC message
 */
async function handleJsonRpcMessage(msg) {
  const { jsonrpc, id, method, params } = msg || {};

  if (jsonrpc !== '2.0' || typeof method !== 'string') {
    if (id) {
      self.postMessage({
        jsonrpc: '2.0',
        id,
        error: {
          code: JsonRpcErrorCode.InvalidRequest,
          message: 'Invalid JSON-RPC 2.0 payload',
        },
      });
    }
    return;
  }

  postLog(`Received: ${method} (id:${id ?? '-'})`);

  // Methods that assume VFS / LSP presence:
  // - textDocument/* always requires VFS
  // - lsp/* except initialize/ping/shutdown require VFS
  const requiresVfs =
    method.startsWith('textDocument/') ||
    (method.startsWith('lsp/') && !['lsp/initialize', 'lsp/ping', 'lsp/shutdown'].includes(method));

  if (requiresVfs && !VfsCore.isReady()) {
    const message = 'VFS not ready. Call `vfs/ensureReady` first.';
    postLog(`Error: ${message}`);
    if (id) {
      self.postMessage({
        jsonrpc: '2.0',
        id,
        error: { code: JsonRpcErrorCode.ServerNotInitialized, message },
      });
    }
    return;
  }

  const handler = handlers[method];
  if (!handler) {
    const message = `Unknown method: ${method}`;
    postLog(`Error: ${message}`);
    if (id) {
      self.postMessage({
        jsonrpc: '2.0',
        id,
        error: { code: JsonRpcErrorCode.MethodNotFound, message },
      });
    }
    return;
  }

  try {
    const result = await handler(params);
    postLog(`Finished: ${method}`);
    if (id) {
      // JSON-RPC response for requests
      self.postMessage({
        jsonrpc: '2.0',
        id,
        result: result !== undefined ? result : null,
      });
    }
    // For notifications (no id) - no response sent
  } catch (err) {
    const message = `${method} failed: ${err?.message ?? String(err)}`;
    postLog(`Error: ${message}`);
    if (id) {
      self.postMessage({
        jsonrpc: '2.0',
        id,
        error: { code: JsonRpcErrorCode.ServerError, message },
      });
    }
  }
}

// Message event listener
self.addEventListener('message', async (event) => {
  const { data } = event;

  // Toggle debug mode via simple string messages 'debug:on' | 'debug:off'
  if (typeof data === 'string' && data.startsWith('debug:')) {
    const enabled = data === 'debug:on';
    setDebug(enabled);
    postLog(`Debug mode set ${enabled}`);
    return;
  }

  // JSON-RPC
  if (data?.jsonrpc === '2.0') {
    await handleJsonRpcMessage(data);
    return;
  }

  // Unknown non-jsonrpc message: keep for backwards compatibility
  postLog(`Received unknown message format: ${JSON.stringify(data)}`);
});

// Announce ready
postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });
