// core/lsp-core.js
// v0.0.2.6
// 変更点要約:
// - LspServer.#recreateEnv() が VfsCore.createEnvironment(..., initialFiles) を使うように修正
// - didOpen/didChange/didClose は openFiles を保持し、recreateEnv により env 作成時点でファイル中身が system に存在することを保証
// - publishDiagnostics の安定化(env.getProgram を確実に呼ぶ)
// - 最小限の defensive エラーハンドリングを追加

import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';
import { VfsCore } from './vfs-core.js';

class LspServer {
  #env = null;
  #openFiles = new Map(); // uri -> { text, version }
  #compilerOptions = {};
  #diagTimers = new Map();
  #diagnosticDebounceMs = 300;

  constructor() {
    postLog('✨ LspServer instance created');
  }

  async initialize(params = {}) {
    this.#compilerOptions =
      params.initializationOptions?.compilerOptions || VfsCore.getDefaultCompilerOptions();

    await VfsCore.ensureReady();
    // 初期は openFiles が無いので空の env を作る(将来的には workspaceRoots も渡す)
    this.#env = VfsCore.createEnvironment(this.#compilerOptions, [], {});
    postLog('✅ LspServer initialized, env created.');
  }

  getInitializeResult() {
    return {
      capabilities: {
        textDocumentSync: 1,
      },
      serverInfo: {
        name: 'WebWorker-LSP-Server',
        version: '0.0.2',
      },
    };
  }

  async didOpen(params) {
    const { uri, text, version } = params.textDocument;
    const path = this.#uriToPath(uri);
    postLog(`📄 didOpen ${path} (version:${version})`);

    this.#openFiles.set(uri, { text, version });

    // 安定性重視: env を rootFiles + initialFiles で再生成して Program に確実に取り込む
    await this.#recreateEnv();
    this.#scheduleDiagnostics(uri);
  }

  async didChange(params) {
    const { uri, version } = params.textDocument;
    const changes = params.contentChanges || [];
    const text = changes.length ? changes[changes.length - 1].text : undefined;
    if (typeof text !== 'string') {
      postLog(`⚠️ didChange received but no text for ${uri}`);
      return;
    }
    const path = this.#uriToPath(uri);
    postLog(`✏️ didChange ${path} (version:${version})`);

    this.#openFiles.set(uri, { text, version });

    // 単純化: 再生成フローで安定動作を優先
    await this.#recreateEnv();
    this.#scheduleDiagnostics(uri);
  }

  async didClose(params) {
    const { uri } = params.textDocument;
    const path = this.#uriToPath(uri);
    postLog(`📕 didClose ${path}`);

    this.#openFiles.delete(uri);

    // 再構築して openFiles を反映(closed ファイルを program から外す)
    await this.#recreateEnv();
    this.#clearDiagnostics(uri);
  }

  // core/lsp-core.js (inside LspServer class)
  // PATCH: after createEnvironment(), ensure program contains root files; short retry loop
  
  async #recreateEnv() {
    const rootFiles = [];
    const initialFiles = {};
    for (const [uri, { text }] of this.#openFiles.entries()) {
      const path = this.#uriToPath(uri);
      // ensure normalized absolute path
      const normalized = path.startsWith('/') ? path : `/${path}`;
      rootFiles.push(normalized);
      initialFiles[normalized] = text;
    }
  
    try {
      this.#env = VfsCore.createEnvironment(this.#compilerOptions, rootFiles, initialFiles);
  
      // defensive sync (existing logic)
      for (const [path, content] of Object.entries(initialFiles)) {
        try {
          if (this.#env.getSourceFile && this.#env.getSourceFile(path)) {
            this.#env.updateFile(path, content);
          } else {
            this.#env.createFile(path, content);
          }
        } catch (e) {
          postLog(`⚠️ recreateEnv sync failed for ${path}: ${e?.message ?? String(e)}`);
        }
      }
  
      // force program build + verify presence of root files in program
      let program;
      try {
        program = this.#env.languageService.getProgram();
      } catch (e) {
        postLog(`⚠️ getProgram() during recreateEnv failed: ${e?.message ?? String(e)}`);
      }
  
      // Retry loop: confirm program has each root sourceFile; short sleep/backoff if missing.
      const maxRetries = 5;
      const retryDelayMs = 30;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const missing = [];
        if (program) {
          for (const p of rootFiles) {
            if (!program.getSourceFile(p)) missing.push(p);
          }
        }
        if (missing.length === 0) {
          // all good
          break;
        }
        if (attempt === maxRetries) {
          postLog(`⚠️ recreateEnv: program missing files after retries: ${missing.join(', ')}`);
          break;
        }
        // small wait then rebuild program reference
        await sleep(retryDelayMs * (attempt + 1));
        try {
          program = this.#env.languageService.getProgram();
        } catch (e) {
          postLog(`⚠️ getProgram() retry failed: ${e?.message ?? String(e)}`);
        }
      }
  
      postLog(`🧠 recreateEnv done; roots: [${rootFiles.join(', ')}]`);
    } catch (e) {
      postLog(`❌ recreateEnv failed: ${e?.message ?? String(e)}`);
      throw e;
    }
  }

  #scheduleDiagnostics(uri) {
    if (this.#diagTimers.has(uri)) {
      clearTimeout(this.#diagTimers.get(uri));
    }
    const timer = setTimeout(() => {
      // ignore promise rejection here; publishDiagnostics does its own guards
      this.publishDiagnostics(uri).catch((e) => postLog(`⚠️ publishDiagnostics error: ${e?.message ?? String(e)}`));
      this.#diagTimers.delete(uri);
    }, this.#diagnosticDebounceMs);
    this.#diagTimers.set(uri, Number(timer));
  }

  async publishDiagnostics(uri) {
    if (!this.#env) {
      postLog('⚠️ publishDiagnostics called but env is not initialized');
      return;
    }
    const path = this.#uriToPath(uri);

    // ensure program exists
    let program;
    try {
      program = this.#env.languageService.getProgram();
    } catch (e) {
      postLog(`⚠️ getProgram() failed before diagnostics: ${e?.message ?? String(e)}`);
    }

    const syntactic = this.#env.languageService.getSyntacticDiagnostics(path) || [];
    const semantic = this.#env.languageService.getSemanticDiagnostics(path) || [];
    const all = [...syntactic, ...semantic];
    
    
    // 追加: diagnostics の詳細をログ出力(テスト時の原因特定用)
    if (all.length > 0) {
      postLog(`🔍 Diagnostics detail for ${path}:`);
      for (const d of all) {
        try {
          const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
          postLog(`  - code:${d.code} start:${d.start ?? '-'} len:${d.length ?? '-'} msg:${msg}`);
        } catch (e) {
          postLog(`  - (failed to stringify diag) ${String(e?.message ?? e)}`);
        }
      }
    }

  

    const diagnostics = all.map((d) => this.#tsDiagToLsp(d, path, program));

    postLog(`Publishing ${diagnostics.length} diagnostics for ${path}`);
    self.postMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri, diagnostics },
    });
  }

  #clearDiagnostics(uri) {
    self.postMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri, diagnostics: [] },
    });
  }

  #tsDiagToLsp(diag, path, program) {
    const sourceFile = program?.getSourceFile(path);
    const start = diag.start ?? 0;
    const length = diag.length ?? 0;
    const startPos = sourceFile ? ts.getLineAndCharacterOfPosition(sourceFile, start) : { line: 0, character: 0 };
    const endPos = sourceFile ? ts.getLineAndCharacterOfPosition(sourceFile, start + length) : { line: 0, character: 0 };

    return {
      range: { start: startPos, end: endPos },
      message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
      severity: (typeof diag.category === 'number') ? diag.category + 1 : 1,
      source: 'ts',
      code: diag.code,
    };
  }

  #uriToPath(uri) {
    // accept both file:/// and '/...' forms
    if (!uri) return '';
    return uri.replace(/^file:\/\//, '');
  }
}

let server = null;
async function getServer() {
  if (!server) {
    server = new LspServer();
  }
  return server;
}

export const LspCore = {
  initialize: async (params = {}) => {
    postLog(`LSP initialize params: ${JSON.stringify(params)}`);
    const s = await getServer();
    await s.initialize(params);
    return s.getInitializeResult();
  },

  didOpen: async (params) => {
    const s = await getServer();
    await s.didOpen(params);
  },

  didChange: async (params) => {
    const s = await getServer();
    await s.didChange(params);
  },

  didClose: async (params) => {
    const s = await getServer();
    await s.didClose(params);
  },

  publishDiagnostics: async (uri) => {
    const s = await getServer();
    await s.publishDiagnostics(uri);
  },
};
