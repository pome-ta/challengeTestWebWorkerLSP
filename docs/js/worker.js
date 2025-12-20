// worker.js
// v0.0.3.8  Phase 7 clean implementation (incremental sync minimal)

import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';
import { postLog, setDebug } from './util/logger.js';

setDebug(true);

// ---- document state (uri -> { version, text, opened }) ----
const documents = new Map();

// ---- debug observation ----
let lastDidChange = null;
let lastDiagnostics = null;

// ---- helpers ----
function applyIncrementalChange(text, change) {
  if (!change.range) {
    // fallback: full replace
    return change.text;
  }

  const { start, end } = change.range;
  const lines = text.split('\n');

  const beforeLines = lines.slice(0, start.line);
  const afterLines = lines.slice(end.line + 1);

  const startLine = lines[start.line] ?? '';
  const endLine = lines[end.line] ?? '';

  const before = startLine.slice(0, start.character);
  const after = endLine.slice(end.character);

  const middle = change.text;

  const merged = (before + middle + after).split('\n');

  return [...beforeLines, ...merged, ...afterLines].join('\n');
}

// ---- handlers ----
const handlers = {
  // lifecycle
  'worker/ready': async () => ({ ok: true }),

  // vfs
  'vfs/ensureReady': async () => {
    await VfsCore.ensureReady();
    return { ok: true };
  },

  // lsp
  'lsp/initialize': async (params) => {
    return LspCore.initialize(params);
  },

  'textDocument/didOpen': async (params) => {
    const { uri, text } = params.textDocument;

    documents.set(uri, {
      uri,
      version: params.textDocument.version ?? 1,
      text,
      opened: true,
    });

    // diagnostics (Phase 7: always empty)
    lastDiagnostics = { uri, diagnostics: [] };

    return null;
  },

  'textDocument/didChange': async (params) => {
    const { uri, version } = params.textDocument;
    const doc = documents.get(uri);
    if (!doc || !doc.opened) return;

    let text = doc.text;
    for (const change of params.contentChanges) {
      text = applyIncrementalChange(text, change);
    }

    doc.text = text;
    doc.version = version;

    lastDidChange = {
      uri,
      version,
      text,
    };

    lastDiagnostics = { uri, diagnostics: [] };

    return;
  },

  'textDocument/didClose': async (params) => {
    const { uri } = params.textDocument;
    const doc = documents.get(uri);
    if (doc) doc.opened = false;
    return;
  },

  // ---- debug ----
  'lsp/_debug/getLastDidChange': async () => lastDidChange,
  'lsp/_debug/getLastDiagnostics': async () => lastDiagnostics,
};

// ---- JSON-RPC loop ----
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
