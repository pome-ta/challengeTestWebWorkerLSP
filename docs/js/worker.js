// worker.js
// v0.0.4.2 Phase 10 完成版
// VfsCore + TextDocumentManager + TS Compiler API Language Service

import * as ts from 'https://esm.sh/typescript';
import { VfsCore } from './core/vfs-core.js';
import { TextDocumentManager } from './core/text-document-manager.js';
import { LspCore } from './core/lsp-core.js';
import { postLog, setDebug } from './util/logger.js';

setDebug(true);

/* --------------------------------------------------
 * 状態
 * -------------------------------------------------- */

let initialized = false;

/* --------------------------------------------------
 * Language Service
 * -------------------------------------------------- */

let languageService = null;

/**
 * VfsCore 上に TS Language Service を構築
 */
function ensureLanguageService() {
  if (languageService) return languageService;

  const env = VfsCore.getLanguageService(); // ← ここが Phase10 の本質
  languageService = env; // そのまま公開

  return languageService;
}

/* --------------------------------------------------
 * handler implementations
 * -------------------------------------------------- */

const handlers = {
  /* ---------- lifecycle ---------- */

  'worker/ready': async () => ({ ok: true }),

  /* ---------- VFS ---------- */

  'vfs/ensureReady': async () => {
    await VfsCore.ensureReady();
    return { ok: true };
  },

  /* ---------- document lifecycle ---------- */

  // 変更点: TextDocumentManager に委譲
  'vfs/openFile': async ({ uri, content }) => {
    await VfsCore.ensureReady();

    TextDocumentManager.open(uri, content);

    // VFS に反映
    VfsCore.writeFile(uri, content);

    // LS 準備
    ensureLanguageService();

    return { ok: true };
  },

  'textDocument/didChange': async ({ uri, content }) => {
    TextDocumentManager.update(uri, content);
    VfsCore.writeFile(uri, content);
    return { ok: true };
  },

  'textDocument/didClose': async ({ uri }) => {
    TextDocumentManager.close(uri);
    return { ok: true };
  },

  /* ---------- LSP initialize ---------- */

  'lsp/initialize': async (params) => {
    await VfsCore.ensureReady();

    const result = await LspCore.initialize(params);

    ensureLanguageService();
    initialized = true;

    return result;
  },

  /* ---------- completion ---------- */

  // 変更点: DocumentManager + VfsCore + Compiler API の統合
  'textDocument/completion': async ({ textDocument, position }) => {
    if (!initialized) return { isIncomplete: false, items: [] };

    const uri = textDocument?.uri;
    const doc = TextDocumentManager.get(uri);
    if (!doc) return { isIncomplete: false, items: [] };

    const fileName = uri.replace(/^file:\/\//, '');

    const offset = TextDocumentManager.positionToOffset(uri, position);

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

  /* ---------- hover ---------- */

  'textDocument/hover': async ({ textDocument, position }) => {
    if (!initialized) return null;

    const uri = textDocument?.uri;
    const doc = TextDocumentManager.get(uri);
    if (!doc) return null;

    const fileName = uri.replace(/^file:\/\//, '');
    const offset = TextDocumentManager.positionToOffset(uri, position);

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
 * JSON-RPC loop
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
