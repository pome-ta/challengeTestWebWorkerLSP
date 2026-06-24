// worker.js

import { LspServerCoreInstance } from './core/lsp-server-core.js';
import { TextDocumentManagerInstance } from './core/text-document-manager.js';

import { postLog, setDebug } from './util/logger.js';

setDebug(true);

// 起動完了通知
postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });

self.onmessage = async (event) => {
  const msg = event.data;
  postLog('Worker self.onmessage');

  // request
  if (msg.id) {
    try {
      const result = await handleRequest(msg);
      self.postMessage({ jsonrpc: '2.0', id: msg.id, result });
    } catch (err) {
      self.postMessage({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32603, message: err.message },
      });
    }
    return;
  }

  // notification
  await handleNotification(msg);
};

async function handleRequest(msg) {
  const { method, params } = msg;

  switch (method) {
    case 'initialize':
      return LspServerCoreInstance.initialize();

    case 'shutdown':
      return LspServerCoreInstance.shutdown();

    case 'textDocument/completion':
      return LspServerCoreInstance.completion(params);

    case 'textDocument/hover':
      return LspServerCoreInstance.hover(params);

    default:
      throw new Error(`Method not found: ${method}`);
  }
}

async function handleNotification(msg) {
  const { method, params } = msg;

  switch (method) {
    case 'initialized':
      return;

    case 'textDocument/didOpen':
      return TextDocumentManagerInstance.didOpen(params);

    case 'textDocument/didChange':
      return TextDocumentManagerInstance.didChange(params);

    case 'textDocument/didClose':
      return TextDocumentManagerInstance.didClose(params);
  }
}
