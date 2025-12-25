// worker.js
// v0.0.4.x Phase 10 clean implementation
// TS Compiler API based, browser-only, no Node assumptions

import * as ts from 'https://esm.sh/typescript';
import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';
import { postLog, setDebug } from './util/logger.js';

setDebug(true);

/* -------------------------------------------------------------------------- */
/*  Document state                                                            */
/* -------------------------------------------------------------------------- */

const documents = new Map(); // uri -> { version, text }
let initialized = false;

/* -------------------------------------------------------------------------- */
/*  TS global state                                                            */
/* -------------------------------------------------------------------------- */

/* ---------- TS global state ---------- */

let program = null;
let checker = null;

/**
 * Program 再構築
 * 変更点:
 *  - VfsCore.readFile() を完全排除
 *  - lib は LspCore または VfsCore 側に依存しない
 *  - documents のみで Program 構築
 */
function rebuildProgram() {
  const fileNames = [];

  for (const [uri] of documents) {
    const fileName = uri.replace('file://', '');
    fileNames.push(fileName);
  }

  const host = {
    getSourceFile: (fileName, languageVersion) => {
      // documents のみを対象にする
      for (const [uri, doc] of documents) {
        const name = uri.replace('file://', '');
        if (name === fileName) {
          return ts.createSourceFile(
            fileName,
            doc.text,
            languageVersion,
            true,
            ts.ScriptKind.TS
          );
        }
      }

      // ★ lib.d.ts グループは
      //   TS Compiler API 内蔵の getDefaultLibFileName にまかせる
      return undefined;
    },

    // TS が内部組み込み lib を利用する
    getDefaultLibFileName: () => 'lib.d.ts',

    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getDirectories: () => [],

    fileExists: (fileName) => {
      for (const [uri] of documents) {
        const name = uri.replace('file://', '');
        if (name === fileName) return true;
      }
      return false;
    },

    readFile: (fileName) => {
      for (const [uri, doc] of documents) {
        const name = uri.replace('file://', '');
        if (name === fileName) return doc.text;
      }
      return undefined;
    },

    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };

  program = ts.createProgram(fileNames, {}, host);
  checker = program.getTypeChecker();
}

/* -------------------------------------------------------------------------- */
/*  util: LSP position → offset                                               */
/* -------------------------------------------------------------------------- */

function positionToOffset(text, position) {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < position.line; i++) {
    offset += lines[i].length + 1;
  }
  return offset + position.character;
}

/* -------------------------------------------------------------------------- */
/*  Handlers                                                                  */
/* -------------------------------------------------------------------------- */

const handlers = {
  /* lifecycle */

  'worker/ready': async () => ({ ok: true }),

  /* VFS boot */

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

    // program is now stale → rebuild
    rebuildProgram();

    return { ok: true };
  },

  /* LSP initialize (Phase 10 = TS world boot) */

  'lsp/initialize': async (params) => {
    await VfsCore.ensureReady();

    const result = await LspCore.initialize(params);
    initialized = true;

    rebuildProgram();

    return result;
  },

  /* completion */

  'textDocument/completion': async (params) => {
    if (!initialized || !program || !checker) {
      return { isIncomplete: false, items: [] };
    }

    const uri = params?.textDocument?.uri;
    const doc = documents.get(uri);
    if (!doc) return { isIncomplete: false, items: [] };

    const fileName = uri.replace('file://', '');
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return { isIncomplete: false, items: [] };

    const offset = positionToOffset(doc.text, params.position);

    // tokens and node at position
    let token = ts.getTokenAtPosition(sourceFile, offset);
    if (!token && offset > 0) token = ts.getTokenAtPosition(sourceFile, offset - 1);
    if (!token) token = ts.findPrecedingToken(offset, sourceFile);

    // scope symbols
    const symbols = checker.getSymbolsInScope(sourceFile, ts.SymbolFlags.Value);

    return {
      isIncomplete: false,
      items: symbols.slice(0, 50).map((s) => ({
        label: s.getName(),
        kind: 6,
      })),
    };
  },

  /* hover */

  'textDocument/hover': async (params) => {
    if (!initialized || !program || !checker) return null;

    const uri = params?.textDocument?.uri;
    const doc = documents.get(uri);
    if (!doc) return null;

    const fileName = uri.replace('file://', '');
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) return null;

    const offset = positionToOffset(doc.text, params.position);

    let token = ts.getTokenAtPosition(sourceFile, offset);
    if (!token && offset > 0) token = ts.getTokenAtPosition(sourceFile, offset - 1);
    if (!token) token = ts.findPrecedingToken(offset, sourceFile);

    if (!token) {
      return {
        contents: { kind: 'plaintext', value: 'unknown' },
      };
    }

    const symbol = checker.getSymbolAtLocation(token);
    if (!symbol) {
      return {
        contents: { kind: 'plaintext', value: 'unknown' },
      };
    }

    const type = checker.getTypeOfSymbolAtLocation(symbol, token);
    const text = checker.typeToString(type);

    return {
      contents: {
        kind: 'plaintext',
        value: text,
      },
    };
  },
};

/* -------------------------------------------------------------------------- */
/*  JSON-RPC loop                                                             */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*  ready                                                                     */
/* -------------------------------------------------------------------------- */

postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });

