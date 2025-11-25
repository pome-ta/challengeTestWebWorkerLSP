// core/lsp-core.js
// v0.0.2.7
// - improved/stable variant for browser VFS usage
// 変更点要旨(ファイル先頭コメント):
// - sleep import を追加
// - initialize() で compilerOptions をサニタイズ(ブラウザ向け)
// - recreateEnv の root path 正規化と program 存在確認リトライを強化
// - diagnostics ログの詳細化(テストデバッグ向け)
// - uri/path 正規化を厳格化(前方スラッシュを確保)

import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';
import { VfsCore } from './vfs-core.js';
import { sleep } from '../util/async-utils.js'; // <-- 必須

class LspServer {
  #env = null;
  #openFiles = new Map(); // uri -> { text, version }
  #compilerOptions = {};
  #diagTimers = new Map();
  #diagnosticDebounceMs = 300;

  constructor() {
    postLog('✨ LspServer instance created');
  }

  /**
   * sanitizeCompilerOptions
   * - ブラウザ + @typescript/vfs 実行環境で問題を起こしやすいオプションを無害化/補完する
   * - 常に安全な既定値 (noEmit: true, moduleResolution: Bundler/NodeJs のどちらか) を返す
   */
  #sanitizeCompilerOptions(incoming = {}) {
    const defaults = VfsCore.getDefaultCompilerOptions ? VfsCore.getDefaultCompilerOptions() : {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
    };

    // shallow merge: incoming overrides defaults
    const opts = Object.assign({}, defaults, incoming || {});

    // Ensure noEmit is true to avoid TS errors when enabling certain flags like allowImportingTsExtensions
    if (opts.allowImportingTsExtensions && !opts.noEmit) {
      postLog(`🔧 sanitizeCompilerOptions: enabling noEmit because allowImportingTsExtensions requested`);
      opts.noEmit = true;
    }

    // If resolvePackageJson* flags are present, ensure moduleResolution is compatible.
    const needsNodeLikeResolution =
      !!opts.resolvePackageJsonExports || !!opts.resolvePackageJsonImports;
    if (needsNodeLikeResolution) {
      // prefer Bundler (works in many browser/vfs scenarios); otherwise fall back to NodeJs
      if (
        opts.moduleResolution !== ts.ModuleResolutionKind.Node16 &&
        opts.moduleResolution !== ts.ModuleResolutionKind.NodeNext &&
        opts.moduleResolution !== ts.ModuleResolutionKind.Bundler
      ) {
        postLog(
          `🔧 sanitizeCompilerOptions: resolvePackageJson* requested -> setting moduleResolution to Bundler`
        );
        opts.moduleResolution = ts.ModuleResolutionKind.Bundler;
      }
    }

    // Disallow problematic Node-only flags unless moduleResolution is Node16/NodeNext/Bundler
    if (
      (opts.resolvePackageJsonExports || opts.resolvePackageJsonImports) &&
      ![ts.ModuleResolutionKind.Node16, ts.ModuleResolutionKind.NodeNext, ts.ModuleResolutionKind.Bundler].includes(opts.moduleResolution)
    ) {
      postLog(`🔧 sanitizeCompilerOptions: clearing resolvePackageJson* because moduleResolution is incompatible`);
      opts.resolvePackageJsonExports = false;
      opts.resolvePackageJsonImports = false;
    }

    // Defensive: remove or coerce options that are unlikely to be supported in the browser vfs
    // (This list can be extended if further incompatibilities appear)
    const unsafeFlags = [
      'incremental',
      'tsBuildInfoFile',
      'outDir',
      'rootDir',
      'outFile',
      'composite',
    ];
    for (const f of unsafeFlags) {
      if (f in opts) {
        postLog(`🔧 sanitizeCompilerOptions: removing possibly-unsafe option "${f}" for browser VFS`);
        delete opts[f];
      }
    }

    return opts;
  }

  async initialize(params = {}) {
    // incoming compiler options may come from client initialization options
    const incoming = params.initializationOptions?.compilerOptions || {};
    this.#compilerOptions = this.#sanitizeCompilerOptions(incoming);

    postLog(`LSP initialize (sanitized opts): ${JSON.stringify(this.#compilerOptions)}`);

    await VfsCore.ensureReady();

    // create initial env with no root files; subsequent didOpen will rebuild roots
    // createEnvironment expects compilerOptions and rootFiles/initialFiles later
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

  /**
   * #recreateEnv
   * - openFiles の内容を rootFiles / initialFiles として VfsCore.createEnvironment に渡す
   * - createEnvironment 内で system にファイルを書き込み -> env を作る方針に依存
   * - 作成直後に program を確認し、root source files が取り込まれているかを短時間リトライして確認する
   */
  async #recreateEnv() {
    // collect root files (absolute paths) and initialFiles map
    const rootFiles = [];
    const initialFiles = {};
    for (const [uri, { text }] of this.#openFiles.entries()) {
      let path = this.#uriToPath(uri);
      // ensure path starts with '/'
      if (!path.startsWith('/')) path = `/${path}`;
      rootFiles.push(path);
      initialFiles[path] = text;
    }

    try {
      // Create new env with sanitized compiler options
      this.#env = VfsCore.createEnvironment(this.#compilerOptions, rootFiles, initialFiles);

      // ensure content is synced (defensive)
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

      // force program build to ensure up-to-date
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
        } else {
          // if program is not available, consider it missing and re-fetch
          missing.push(...rootFiles);
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
    if (!uri) return '';
    // Accept both file:///... and '/...' and ensure leading slash for VFS stability
    let path = String(uri).replace(/^file:\/\//, '');
    if (!path.startsWith('/')) path = `/${path}`;
    return path;
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
