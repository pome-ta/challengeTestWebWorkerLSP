// worker.js
// v0.0.2.4

import { postLog, setDebug } from './util/logger.js';
import { VfsCore } from './core/vfs-core.js';
import { JsonRpcErrorCode } from './core/error-codes.js';
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
  'lsp/initialize': LspCore.initialize,
};

// ============================================================
// Message Event Listener
// ============================================================

/**
 * JSON-RPCリクエストを処理します。
 * @param {object} data - JSON-RPCメッセージオブジェクト
 */
async function handleJsonRpc({ id, method, params }) {
  postLog(`Received: ${method} (id: ${id})`);

  // ガード節: VFSの準備が必要なLSPメソッドが、準備完了前に呼び出された場合は早期にエラーを返す
  const requiresVfs =
    method.startsWith('lsp/') && !['lsp/ping', 'lsp/shutdown'].includes(method);

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
      self.postMessage({ jsonrpc: '2.0', id, error: { code: JsonRpcErrorCode.MethodNotFound, message } });
    }
    return;
  }

  try {
    const result = await handler(params);
    postLog(`Finished: ${method}`);
    if (id) {
      self.postMessage({ jsonrpc: '2.0', id, result: result !== undefined ? result : null });
    }
  } catch (error) {
    const message = `${method} failed: ${error.message}`;
    postLog(`Error: ${message}`);
    if (id) {
      self.postMessage({ jsonrpc: '2.0', id, error: { code: JsonRpcErrorCode.ServerError, message } });
    }
  }
}

self.addEventListener('message', async (event) => {
  const { data } = event;
  if (typeof data === 'string' && data.startsWith('debug:')) {
    const enabled = data === 'debug:on';
    setDebug(enabled);
    postLog(`Debug mode set to: ${enabled}`);
    return; // このメッセージはここで処理完了
  }

  // JSON-RPCリクエストを処理
  if (data?.jsonrpc === '2.0') {
    await handleJsonRpc(data);
    return;
  }

  postLog(`Received unknown message format: ${JSON.stringify(data)}`);
});

postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });
