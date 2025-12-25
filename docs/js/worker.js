// worker.js
// v0.0.4.2 Phase 10 implementation
// Browser TS Compiler API + Language Service

import * as ts from 'https://esm.sh/typescript';
import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';
import { postLog, setDebug } from './util/logger.js';

setDebug(true);

/* --------------------------------------------------
 * document state
 * -------------------------------------------------- */

const documents = new Map(); // uri -> { version, text }
let initialized = false;

/* --------------------------------------------------
 * LSP position <-> offset
 * -------------------------------------------------- */

function positionToOffset(text, position) {
  const lines = text.split('\n');
  let offset = 0;

  for (let i = 0; i < position.line; i++) {
    offset += lines[i].length + 1;
  }
  return offset + position.character;
}

/* --------------------------------------------------
 * TypeScript Language Service
 * -------------------------------------------------- */

let languageService = null;

function uriToFileName(uri) {
  return uri.replace(/^file:\/\//, '');
}

/* --- LanguageServiceHost --- */
const serviceHost = {
  getScriptFileNames: () => {
    return [...documents.keys()].map(uriToFileName);
  },

  getScriptVersion: (fileName) => {
    for (const [uri, doc] of documents.entries()) {
      if (uriToFileName(uri) === fileName) return String(doc.version);
    }
    return '0';
  },

  getScriptSnapshot: (fileName) => {
    for (const [uri, doc] of documents.entries()) {
      if (uriToFileName(uri) === fileName) {
        return ts.ScriptSnapshot.fromString(doc.text);
      }
    }
    return undefined;
  },

  getCurrentDirectory: () => '/',
  getCompilationSettings: () => ({
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
  }),
  getDefaultLibFileName: (options) =>
    ts.getDefaultLibFilePath(options),
  fileExists: () => true,
  readFile: () => '',
  readDirectory: () => [],
};

/* --- create service once --- */
function ensureLanguageService() {
  if (!languageService) {
    languageService = ts.createLanguageService(
      serviceHost,
      ts.createDocumentRegistry()
    );
  }
  return languageService;
}

/* --------------------------------------------------
 * handlers
 * -------------------------------------------------- */

const handlers = {
  /* lifecycle */

  'worker/ready': async () => ({ ok: true }),

  /* VFS */

  'vfs/ensureReady': async () => {
    await VfsCore.ensureReady();
    return { ok: true };
  },

  'vfs/openFile': async ({ uri, content }) => {
    if (!VfsCore.getEnvInfo().ready) {
      throw Object.assign(new Error('VFS is not ready'), { code: -32001 });
    }

    const prev = documents.get(uri);
    const version = prev ? prev.version + 1 : 1;

    documents.set(uri, { uri, text: content, version });

    // Language Service は documents を見るだけなのでこれで十分
    ensureLanguageService();

    return { ok: true };
  },

  /* LSP initialize */

  'lsp/initialize': async (params) => {
    const result = await LspCore.initialize(params);
    initialized = true;

    ensureLanguageService();
    return result;
  },

  /* completion */

  'textDocument/completion': async (params) => {
    if (!initialized) {
      return { isIncomplete: false, items: [] };
    }

    const uri = params?.textDocument?.uri;
    const position = params?.position;

    const doc = uri ? documents.get(uri) : null;
    if (!doc) return { isIncomplete: false, items: [] };

    const fileName = uriToFileName(uri);
    const offset = positionToOffset(doc.text, position);

    const ls = ensureLanguageService();

    const entries =
      ls.getCompletionsAtPosition(fileName, offset, {})?.entries ?? [];

    return {
      isIncomplete: false,
      items: entries.slice(0, 40).map((e) => ({
        label: e.name,
        kind: 6,
        detail: e.kind,
      })),
    };
  },

  /* hover */

  'textDocument/hover': async (params) => {
    if (!initialized) return null;

    const uri = params?.textDocument?.uri;
    const position = params?.position;

    const doc = uri ? documents.get(uri) : null;
    if (!doc) return null;

    const fileName = uriToFileName(uri);
    const offset = positionToOffset(doc.text, position);

    const ls = ensureLanguageService();

    const info = ls.getQuickInfoAtPosition(fileName, offset);
    if (!info) {
      return { contents: { kind: 'plaintext', value: 'unknown' } };
    }

    const display = ts.displayPartsToString(info.displayParts ?? []);
    const documentation = ts.displayPartsToString(info.documentation ?? []);

    const value =
      documentation && documentation.trim().length > 0
        ? `${display}\n\n${documentation}`
        : display;

    return {
      contents: {
        kind: 'plaintext',
        value: value || 'unknown',
      },
    };
  },
};

/* --------------------------------------------------
 * RPC loop
 * -------------------------------------------------- */

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

/* --------------------------------------------------
 * ready notify
 * -------------------------------------------------- */

postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });

