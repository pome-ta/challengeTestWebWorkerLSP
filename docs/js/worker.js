// worker.js
// v0.0.3.8 Phase 7 clean
//
// 対応範囲:
// - didOpen / didChange / didClose lifecycle
// - incremental sync (range + text / full text fallback)
// - diagnostics 最小通知
// - テスト専用 debug API
//
// 非対応（意図的）:
// - completion / hover 実体
// - semantic tokens
// - diagnostics 内容生成

import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';
import { postLog, setDebug } from './util/logger.js';

setDebug(true);

/* =========================
 * 内部 document state
 * ========================= */

const documents = new Map();
/*
documents.get(uri) = {
  uri,
  version,
  text,
  opened: boolean
}
*/

let initialized = false;

/* =========================
 * debug observation
 * ========================= */

let lastDidOpen = null;
let lastDidChange = null;
let lastDidClose = null;
let lastDiagnostics = null;

/* =========================
 * utility
 * ========================= */

function applyIncrementalChange(text, change) {
  if (!change.range) {
    return change.text;
  }

  const lines = text.split('\n');

  const { start, end } = change.range;

  const before = lines[start.line].slice(0, start.character);

  const after = lines[end.line].slice(end.character);

  lines.splice(
    start.line,
    end.line - start.line + 1,
    `${before}${change.text}${after}`
  );

  return lines.join('\n');
}

function emitDiagnostics(uri) {
  lastDiagnostics = {
    uri,
    diagnostics: [],
  };
}

/* =========================
 * handlers
 * ========================= */

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
    documents.clear();
    initialized = false;
    lastDidOpen = null;
    lastDidChange = null;
    lastDidClose = null;
    lastDiagnostics = null;
    return { ok: true };
  },

  'vfs/openFile': async (params) => {
    if (
      !params ||
      typeof params.uri !== 'string' ||
      typeof params.content !== 'string'
    ) {
      throw Object.assign(new Error('Invalid params'), {
        code: -32602,
      });
    }

    if (!VfsCore.getEnvInfo().ready) {
      throw Object.assign(new Error('VFS not ready'), {
        code: -32001,
      });
    }

    let doc = documents.get(params.uri);

    if (!doc) {
      doc = {
        uri: params.uri,
        version: 0,
        text: '',
        opened: false,
      };
      documents.set(params.uri, doc);
    }

    doc.text = params.content;
    doc.version += 1;
    doc.opened = true;

    return { ok: true };
  },

  // --- lsp ---
  'lsp/initialize': async (params) => {
    const result = await LspCore.initialize(params);
    initialized = true;

    for (const doc of documents.values()) {
      if (!doc.opened) continue;

      lastDidOpen = {
        uri: doc.uri,
        version: doc.version,
        text: doc.text,
      };

      emitDiagnostics(doc.uri);
    }

    return result;
  },

  'textDocument/didChange': async (params) => {
    if (!initialized) {
      return null;
    }

    const { textDocument, contentChanges } = params;
    const doc = documents.get(textDocument.uri);

    if (!doc || !doc.opened) {
      return null;
    }

    let text = doc.text;

    for (const change of contentChanges) {
      text = applyIncrementalChange(text, change);
    }

    doc.text = text;
    doc.version += 1;

    lastDidChange = {
      uri: doc.uri,
      version: doc.version,
      text: doc.text,
    };

    emitDiagnostics(doc.uri);

    return null;
  },

  'textDocument/didClose': async (params) => {
    if (!initialized) return null;

    const uri = params.textDocument.uri;
    const doc = documents.get(uri);

    if (!doc) return null;

    doc.opened = false;

    lastDidClose = { uri };

    return null;
  },

  // --- hover stub ---
  'textDocument/hover': async () => {
    return null;
  },

  // --- debug ---
  'lsp/_debug/getLastDidOpen': async () => lastDidOpen,
  'lsp/_debug/getLastDidChange': async () => lastDidChange,
  'lsp/_debug/getLastDidClose': async () => lastDidClose,
  'lsp/_debug/getLastDiagnostics': async () => lastDiagnostics,
};

/* =========================
 * message loop
 * ========================= */

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
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
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

// ready
postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });
