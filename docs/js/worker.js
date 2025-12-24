// worker.js
// v0.0.4.1 Phase 10 clean implementation
// TS Compiler API based (browser-only)

import * as ts from 'https://esm.sh/typescript';
import { VfsCore } from './core/vfs-core.js';
import { LspCore } from './core/lsp-core.js';
import { postLog, setDebug } from './util/logger.js';

setDebug(true);

/* ---------- document state ---------- */

const documents = new Map(); // uri -> { version, text }
let initialized = false;

/* ---------- TS Program helper ---------- */

function createProgramForDoc(uri, text) {
  const fileName = uri.replace('file://', '');

  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const host = {
    getSourceFile: (name) => (name === fileName ? sourceFile : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    fileExists: (name) => name === fileName,
    readFile: () => undefined,
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };

  return ts.createProgram([fileName], {}, host);
}

/* ---------- handlers ---------- */

const handlers = {
  /* --- lifecycle --- */

  'worker/ready': async () => ({ ok: true }),

  /* --- VFS --- */

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
    return { ok: true };
  },

  /* --- LSP --- */

  'lsp/initialize': async (params) => {
    const result = await LspCore.initialize(params);
    initialized = true;
    return result;
  },

  /* --- completion --- */

  'textDocument/completion': async (params) => {
    if (!initialized) {
      return { isIncomplete: false, items: [] };
    }

    const uri = params?.textDocument?.uri;
    const doc = uri ? documents.get(uri) : null;
    if (!doc) {
      return { isIncomplete: false, items: [] };
    }

    const program = createProgramForDoc(uri, doc.text);
    const checker = program.getTypeChecker();

    const sourceFile = program.getSourceFiles()[0];
    const symbols = checker.getSymbolsInScope(
      sourceFile,
      ts.SymbolFlags.Value
    );

    return {
      isIncomplete: false,
      items: symbols.slice(0, 20).map((s) => ({
        label: s.getName(),
        kind: 6,
      })),
    };
  },

  /* --- hover --- */

  'textDocument/hover': async (params) => {
    if (!initialized) return null;

    const uri = params?.textDocument?.uri;
    const doc = uri ? documents.get(uri) : null;
    if (!doc) return null;

    const program = createProgramForDoc(uri, doc.text);
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFiles()[0];

    let found = null;

    function visit(node) {
      if (found) return;
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol) {
          const type = checker.getTypeOfSymbolAtLocation(symbol, node);
          found = checker.typeToString(type);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    return {
      contents: {
        kind: 'plaintext',
        value: found ?? 'unknown',
      },
    };
  },
};

/* ---------- RPC loop ---------- */

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

/* ---------- ready ---------- */

postLog('Worker loaded and ready.');
self.postMessage({ jsonrpc: '2.0', method: 'worker/ready' });
