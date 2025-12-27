// worker.js
// v0.0.4.2 Phase 10: VfsCore + TextDocumentManager + TS Language Service

import * as ts from 'https://esm.sh/typescript';
import { VfsCore } from './core/vfs-core.js';
import { TextDocumentManager } from './core/text-document-manager.js';
import { postLog } from './util/logger.js';

/* --------------------------------------------------
 * core instances
 * -------------------------------------------------- */

const vfsCore = VfsCore; // 既存設計: シングルトン
const textDocuments = new TextDocumentManager(vfsCore);

let initialized = false;
let languageService = null;

/* --------------------------------------------------
 * Language Service bootstrap
 * -------------------------------------------------- */

function ensureLanguageService() {
  if (languageService) return languageService;

  // VfsCore のラッパー API に委譲
  const env = vfsCore.getLanguageService();
  languageService = env;

  return languageService;
}

/* --------------------------------------------------
 * handlers
 * -------------------------------------------------- */

const handlers = {
  /* ---------- lifecycle ---------- */

  'worker/ready': async () => ({ ok: true }),
/* ---------- VFS ---------- */

'vfs/ensureReady': async () => {
  await vfsCore.ensureReady();
  return { ok: true };
},


  'lsp/initialize': async (params) => {
    await vfsCore.ensureReady();
    ensureLanguageService();
    initialized = true;

    return {
      capabilities: {},
    };
  },

  /* ---------- TextDocument lifecycle (LSP → 内部APIへマッピング) ---------- */

  'textDocument/didOpen': async (params) => {
    const { textDocument } = params;

    await textDocuments.open({
      uri: textDocument.uri,
      text: textDocument.text,
      languageId: textDocument.languageId,
      version: textDocument.version,
    });

    ensureLanguageService();
    return { ok: true };
  },

  'textDocument/didChange': async (params) => {
    const { textDocument, contentChanges } = params;

    if (!contentChanges?.length) {
      throw new Error('didChange with no contentChanges');
    }

    // Phase10: full text 更新のみ対応
    const newText = contentChanges[0].text;

    await textDocuments.change({
      uri: textDocument.uri,
      text: newText,
      version: textDocument.version,
    });

    return { ok: true };
  },

  'textDocument/didClose': async (params) => {
    const { textDocument } = params;

    await textDocuments.close({
      uri: textDocument.uri,
    });

    return { ok: true };
  },

  /* ---------- completion ---------- */

  'textDocument/completion': async ({ textDocument, position }) => {
    if (!initialized) return { isIncomplete: false, items: [] };

    const uri = textDocument?.uri;
    const doc = textDocuments.get(uri);
    if (!doc) return { isIncomplete: false, items: [] };

    const fileName = uri.replace(/^file:\/\//, '');

    // 仮: UTF-16 変換省略のオフセット計算
    const offset =
      doc.text.split('\n').slice(0, position.line).join('\n').length +
      position.character;

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
    const doc = textDocuments.get(uri);
    if (!doc) return null;

    const fileName = uri.replace(/^file:\/\//, '');

    const offset =
      doc.text.split('\n').slice(0, position.line).join('\n').length +
      position.character;

    const ls = ensureLanguageService();

    const info = ls.getQuickInfoAtPosition(fileName, offset);
    if (!info) {
      return {
        contents: {
          kind: 'plaintext',
          value: 'unknown',
        },
      };
    }

    const display = ts.displayPartsToString(info.displayParts ?? []);
    const documentation = ts.displayPartsToString(info.documentation ?? []);

    return {
      contents: {
        kind: 'plaintext',
        value:
          documentation && documentation.trim().length > 0
            ? `${display}\n\n${documentation}`
            : display,
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
      self.postMessage({
        jsonrpc: '2.0',
        id,
        result,
      });
    }
  } catch (err) {
    if (id != null) {
      self.postMessage({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
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
