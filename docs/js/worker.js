// worker.js
// v0.0.2.9
// - JSON-RPC router + VFS gate + LspCore usage
// - Adds test-only request "lsp/_getRawDiagnostics"

import { postLog, setDebug } from './util/logger.js';
import { VfsCore } from './core/vfs-core.js';
import { JsonRpcErrorCode } from './core/error-codes.js';
import { LspCore } from './core/lsp-core.js';

// Default: enable debug for test-runner environment
setDebug(true);

const handlers = {
  'vfs/ensureReady': async () => await VfsCore.ensureReady(),
  'lsp/ping': async () => 'pong',
  'lsp/shutdown': async () => {
    postLog('Worker shutting down...');
    setTimeout(() => self.close(), 100);
    return 'shutdown-complete';
  },
  'lsp/initialize': async (params) => await LspCore.initialize(params),

  'textDocument/didOpen': async (params) => await LspCore.didOpen(params),
  'textDocument/didChange': async (params) => await LspCore.didChange(params),
  'textDocument/didClose': async (params) => await LspCore.didClose(params),

  // TEST-ONLY: return raw TS diagnostics (non-flattened)
  'lsp/_getRawDiagnostics': async (params) => {
    const uri = params?.uri;
    if (!uri) throw new Error('Missing uri');
    return await LspCore.getRawDiagnosticsForTest(uri);
  },
};

async function handleJsonRpcMessage(msg) {
  const { jsonrpc, id, method, params } = msg || {};
  if (jsonrpc !== '2.0' || typeof method !== 'string') {
    if (id) {
      self.postMessage({
        jsonrpc: '2.0',
        id,
        error: { code: JsonRpcErrorCode.InvalidRequest, message: 'Invalid JSON-RPC 2.0 payload' },
      });
    }
    return;
  }

  postLog(`Received: ${method} (id:${id ?? '-'})`);

  const requiresVfs = method.startsWith('lsp/') || method.startsWith('textDocument/');
  if (requiresVfs && !VfsCore.isReady()) {
    const message = 'VFS not ready. Call `vfs/ensureReady` first.';
    postLog(`Error: ${message}`);
    if (id) {
      self.postMessage({ jsonrpc: '2.0', id, error: { code: JsonRpcErrorCode.ServerNotInitialized, message } });
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
  } catch (err) {
    const message = `${method} failed: ${err?.message ?? String(err)}`;
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
    postLog(`Debug mode set ${enabled}`);
    return;
  }

  if (data?.jsonrpc === '2.0') {
    await handleJsonRpcMessage(data);
    return;
  }

  postLog(`Received unknown message format: ${JSON.stringify(data)}`);
});

postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });
