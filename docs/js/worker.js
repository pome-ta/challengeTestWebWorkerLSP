// worker.js
// v0.0.4.1 Phase 10 clean implementation (TS Language Service connected)

import * as ts from 'https://esm.sh/typescript';
import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';
import { postLog, setDebug } from './util/logger.js';

setDebug(true);

/**
 * ---- Internal document state (Phase 4〜9 維持) ----
 */
const documents = new Map(); // uri -> { uri, version, text }
let initialized = false;

/**
 * ---- TS Language Service ----
 */
let tsService = null;

/**
 * URI <-> TS fileName mapping
 * Safari / browser 環境では file path は仮想でよい
 */
const uriToFileName = (uri) => uri.replace('file://', '');
const fileNameToUri = (fileName) => `file://${fileName}`;

/**
 * ---- TS Language Service Host ----
 */
const tsHost = {
  getScriptFileNames() {
    return [...documents.keys()].map(uriToFileName);
  },

  getScriptVersion(fileName) {
    const uri = fileNameToUri(fileName);
    return String(documents.get(uri)?.version ?? 0);
  },

  getScriptSnapshot(fileName) {
    const uri = fileNameToUri(fileName);
    const doc = documents.get(uri);
    if (!doc) return undefined;
    return ts.ScriptSnapshot.fromString(doc.text);
  },

  getCurrentDirectory() {
    return '/';
  },

  getCompilationSettings() {
    return {
      strict: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    };
  },

  getDefaultLibFileName(options) {
    return ts.getDefaultLibFilePath(options);
  },

  fileExists(fileName) {
    return documents.has(fileNameToUri(fileName));
  },

  readFile(fileName) {
    const uri = fileNameToUri(fileName);
    return documents.get(uri)?.text;
  },
};

/**
 * ---- Utilities ----
 */
const offsetAt = (text, position) => {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < position.line; i++) {
    offset += lines[i].length + 1;
  }
  return offset + position.character;
};

/**
 * ---- RPC handlers ----
 */
const handlers = {
  // --- lifecycle ---
  'worker/ready': async () => ({ ok: true }),

  // --- VFS ---
  'vfs/ensureReady': async () => {
    await VfsCore.ensureReady();
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

    // Phase 10: TS Language Service 起動
    tsService = ts.createLanguageService(tsHost);
    initialized = true;

    return result;
  },

  /**
   * ---- Phase 10: completion (TS LS) ----
   */
  'textDocument/completion': async (params) => {
    if (!initialized || !tsService) {
      return { isIncomplete: false, items: [] };
    }

    const uri = params?.textDocument?.uri;
    const doc = uri ? documents.get(uri) : null;
    if (!doc) {
      return { isIncomplete: false, items: [] };
    }

    const fileName = uriToFileName(uri);
    const offset = offsetAt(doc.text, params.position);

    const entries = tsService.getCompletionsAtPosition(
      fileName,
      offset,
      {},
    );

    if (!entries) {
      return { isIncomplete: false, items: [] };
    }

    return {
      isIncomplete: false,
      items: entries.entries.map((e) => ({
        label: e.name,
        kind: 6, // Variable / Property
        detail: e.kind,
        insertText: e.name,
      })),
    };
  },

  /**
   * ---- Phase 10: hover (TS LS) ----
   */
  'textDocument/hover': async (params) => {
    if (!initialized || !tsService) {
      return null;
    }

    const uri = params?.textDocument?.uri;
    const doc = uri ? documents.get(uri) : null;
    if (!doc) {
      return null;
    }

    const fileName = uriToFileName(uri);
    const offset = offsetAt(doc.text, params.position);

    const info = tsService.getQuickInfoAtPosition(fileName, offset);
    if (!info) {
      return null;
    }

    const display = ts.displayPartsToString(info.displayParts);

    return {
      contents: {
        kind: 'plaintext',
        value: display,
      },
    };
  },
};

/**
 * ---- JSON-RPC loop (Phase 9 完全維持) ----
 */
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

