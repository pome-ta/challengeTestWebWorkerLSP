// worker.js
// v0.0.2.12

import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';
import { JsonRpcErrorCode } from './core/error-codes.js';

import { postLog, setDebug } from './util/logger.js';

// debug:on by default for test visibility
setDebug(true);

const handlers = {
  // VFS lifecycle
  'vfs/ensureReady': async () => await VfsCore.ensureReady(),

  // LSP ping/shutdown/init (initialize は VFS gating 対象外)
  'lsp/ping': async () => 'pong',

  'lsp/shutdown': async () => {
    postLog('Worker shutting down...');
    setTimeout(() => self.close(), 100);
    return 'shutdown-complete';
  },

  'lsp/initialize': async (params) => await LspCore.initialize(params),

  // Document sync
  'textDocument/didOpen': async (params) => await LspCore.didOpen(params),
  'textDocument/didChange': async (params) => await LspCore.didChange(params),
  'textDocument/didClose': async (params) => await LspCore.didClose(params),
};

/* =============================================================
   JSON-RPC Router
   ============================================================= */
async function handleJsonRpcMessage(msg) {
  const { jsonrpc, id, method, params } = msg || {};

  // Invalid JSON-RPC payload
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

  // todo: ここのコネコネはあとで確認（なんか無駄に処理してそう？）
  const requiresVfs =
    method.startsWith('textDocument/') ||
    (method.startsWith('lsp/') &&
      !['lsp/initialize', 'lsp/ping', 'lsp/shutdown'].includes(method));

  // note: VFS が準備できてるか確認（の、ところよね？）
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
      self.postMessage({
        jsonrpc: '2.0',
        id,
        result: result !== undefined ? result : null,
      });
    }
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

/* =============================================================
   Message Listener
   ============================================================= */
// note: やりとりに関して、基本的にここを窓口として振り分けをしている
// note: 他コードで、`worker.` とやっているところ（で、合ってるよね？）
self.addEventListener('message', async (event) => {
  const { data } = event;

  // simple debug:on/off toggle
  // todo: ここ必要かね？
  if (typeof data === 'string' && data.startsWith('debug:')) {
    const enabled = data === 'debug:on';
    setDebug(enabled);
    postLog(`Debug mode set ${enabled}`);
    return;
  }

  // JSON-RPC message
  if (data?.jsonrpc === '2.0') {
    await handleJsonRpcMessage(data);
    return;
  }

  // unknown message type
  postLog(`Received unknown message format: ${JSON.stringify(data)}`);
});

// todo: ここ残すか確認する
// note: `LSP 仕様外の独自イベント。initialized を使えば不要。` `initialized` とは？
postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });
