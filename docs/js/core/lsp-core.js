// core/lsp-core.js
// v0.0.2.9
// - LSP core for browser VFS
// - sanitizeCompilerOptions, stable recreateEnv, publishDiagnostics
// - provides test-only API getRawDiagnosticsForTest (safe JSONable subset)

import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';
import { VfsCore } from './vfs-core.js';
import { sleep } from '../util/async-utils.js';

class LspServer {
  #env = null;
  #openFiles = new Map();
  #compilerOptions = {};
  #diagTimers = new Map();
  #diagnosticDebounceMs = 300;

  constructor() {
    postLog('LspServer instance created');
  }

  #sanitizeCompilerOptions(incoming = {}) {
    const defaults = VfsCore.getDefaultCompilerOptions ? VfsCore.getDefaultCompilerOptions() : {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
    };

    const opts = Object.assign({}, defaults, incoming || {});

    if (opts.allowImportingTsExtensions && !opts.noEmit) {
      postLog('sanitizeCompilerOptions: enabling noEmit because allowImportingTsExtensions requested');
      opts.noEmit = true;
    }

    const needsNodeLikeResolution = !!opts.resolvePackageJsonExports || !!opts.resolvePackageJsonImports;
    if (needsNodeLikeResolution) {
      if (
        opts.moduleResolution !== ts.ModuleResolutionKind.Node16 &&
        opts.moduleResolution !== ts.ModuleResolutionKind.NodeNext &&
        opts.moduleResolution !== ts.ModuleResolutionKind.Bundler &&
        opts.moduleResolution !== ts.ModuleResolutionKind.NodeJs
      ) {
        postLog('sanitizeCompilerOptions: resolvePackageJson* requested -> setting moduleResolution to Bundler');
        opts.moduleResolution = ts.ModuleResolutionKind.Bundler;
      }
    }

    if (
      (opts.resolvePackageJsonExports || opts.resolvePackageJsonImports) &&
      ![ts.ModuleResolutionKind.Node16, ts.ModuleResolutionKind.NodeNext, ts.ModuleResolutionKind.Bundler, ts.ModuleResolutionKind.NodeJs].includes(opts.moduleResolution)
    ) {
      postLog('sanitizeCompilerOptions: clearing resolvePackageJson* because moduleResolution is incompatible');
      opts.resolvePackageJsonExports = false;
      opts.resolvePackageJsonImports = false;
    }

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
        postLog(`sanitizeCompilerOptions: removing possibly-unsafe option "${f}"`);
        delete opts[f];
      }
    }
    // 最終確定(TS の auto-fallback 対策)
    opts.moduleResolution = ts.ModuleResolutionKind.Bundler;

 
    return opts;
  }

  async initialize(params = {}) {
    const incoming = params.initializationOptions?.compilerOptions || {};
    this.#compilerOptions = this.#sanitizeCompilerOptions(incoming);

    postLog(`LSP initialize (sanitized opts): ${JSON.stringify(this.#compilerOptions)}`);

    await VfsCore.ensureReady();

    this.#env = VfsCore.createEnvironment(this.#compilerOptions, [], {});
    postLog('LspServer initialized, env created.');
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
    postLog(`didOpen ${path} (version:${version})`);

    this.#openFiles.set(uri, { text, version });
    await this.#recreateEnv();
    this.#scheduleDiagnostics(uri);
  }

  async didChange(params) {
    const { uri, version } = params.textDocument;
    const changes = params.contentChanges || [];
    const text = changes.length ? changes[changes.length - 1].text : undefined;
    if (typeof text !== 'string') {
      postLog(`didChange received but no text for ${uri}`);
      return;
    }
    const path = this.#uriToPath(uri);
    postLog(`didChange ${path} (version:${version})`);

    this.#openFiles.set(uri, { text, version });
    await this.#recreateEnv();
    this.#scheduleDiagnostics(uri);
  }

  async didClose(params) {
    const { uri } = params.textDocument;
    const path = this.#uriToPath(uri);
    postLog(`didClose ${path}`);

    this.#openFiles.delete(uri);
    await this.#recreateEnv();
    this.#clearDiagnostics(uri);
  }

  async #recreateEnv() {
    const rootFiles = [];
    const initialFiles = {};
    for (const [uri, { text }] of this.#openFiles.entries()) {
      let path = this.#uriToPath(uri);
      if (!path.startsWith('/')) path = `/${path}`;
      rootFiles.push(path);
      initialFiles[path] = text;
    }

    try {
      this.#env = VfsCore.createEnvironment(this.#compilerOptions, rootFiles, initialFiles);

      for (const [path, content] of Object.entries(initialFiles)) {
        try {
          if (this.#env.getSourceFile && this.#env.getSourceFile(path)) {
            this.#env.updateFile(path, content);
          } else {
            this.#env.createFile(path, content);
          }
        } catch (e) {
          postLog(`recreateEnv sync failed for ${path}: ${e?.message ?? String(e)}`);
        }
      }

      let program;
      try {
        program = this.#env.languageService.getProgram();
      } catch (e) {
        postLog(`getProgram() during recreateEnv failed: ${e?.message ?? String(e)}`);
      }

      const maxRetries = 5;
      const retryDelayMs = 30;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const missing = [];
        if (program) {
          for (const p of rootFiles) {
            if (!program.getSourceFile(p)) missing.push(p);
          }
        } else {
          missing.push(...rootFiles);
        }

        if (missing.length === 0) break;

        if (attempt === maxRetries) {
          postLog(`recreateEnv: program missing files after retries: ${missing.join(', ')}`);
          break;
        }

        await sleep(retryDelayMs * (attempt + 1));
        try {
          program = this.#env.languageService.getProgram();
        } catch (e) {
          postLog(`getProgram() retry failed: ${e?.message ?? String(e)}`);
        }
      }

      postLog(`recreateEnv done; roots: [${rootFiles.join(', ')}]`);
    } catch (e) {
      postLog(`recreateEnv failed: ${e?.message ?? String(e)}`);
      throw e;
    }
  }

  #scheduleDiagnostics(uri) {
    if (this.#diagTimers.has(uri)) {
      clearTimeout(this.#diagTimers.get(uri));
    }
    const timer = setTimeout(() => {
      this.publishDiagnostics(uri).catch((e) => postLog(`publishDiagnostics error: ${e?.message ?? String(e)}`));
      this.#diagTimers.delete(uri);
    }, this.#diagnosticDebounceMs);
    this.#diagTimers.set(uri, Number(timer));
  }

  async publishDiagnostics(uri) {
    if (!this.#env) {
      postLog('publishDiagnostics called but env is not initialized');
      return;
    }
    const path = this.#uriToPath(uri);

    let program;
    try {
      program = this.#env.languageService.getProgram();
    } catch (e) {
      postLog(`getProgram() failed before diagnostics: ${e?.message ?? String(e)}`);
    }

    const syntactic = this.#env.languageService.getSyntacticDiagnostics(path) || [];
    const semantic = this.#env.languageService.getSemanticDiagnostics(path) || [];
    const all = [...syntactic, ...semantic];

    if (all.length > 0) {
      postLog(`Diagnostics detail for ${path}:`);
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
    let path = String(uri).replace(/^file:\/\//, '');
    if (!path.startsWith('/')) path = `/${path}`;
    return path;
  }

  // ----------------------------
  // Test-only API: raw diagnostics
  // Returns JSON-safe subset of Diagnostic objects
  // ----------------------------
  async getRawDiagnosticsForTest(uri) {
    if (!this.#env) {
      postLog('getRawDiagnosticsForTest called but env is not initialized');
      return { diagnostics: [] };
    }
    const path = this.#uriToPath(uri);
    const semantic = this.#env.languageService.getSemanticDiagnostics(path) || [];
    const syntactic = this.#env.languageService.getSyntacticDiagnostics(path) || [];
    const all = [...syntactic, ...semantic];

    // Map to JSON-safe structure; preserve messageText which may be chain object
    const safe = all.map((d) => {
      return {
        code: d.code,
        category: d.category,
        start: d.start,
        length: d.length,
        messageText: d.messageText, // might be string or DiagnosticMessageChain (object)
      };
    });

    return { diagnostics: safe };
  }
}

let server = null;
async function getServer() {
  if (!server) server = new LspServer();
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

  // Test-only RPC consumer can call this
  getRawDiagnosticsForTest: async (uri) => {
    const s = await getServer();
    return await s.getRawDiagnosticsForTest(uri);
  },
};
