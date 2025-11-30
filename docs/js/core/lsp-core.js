// core/lsp-core.js
// v0.0.2.12

import ts from 'https://esm.sh/typescript';
import { VfsCore } from './vfs-core.js';
import { sleep } from '../util/async-utils.js';
import {
  mapTsDiagnosticToLsp,
  flattenDiagnosticMessage,
} from './diag-utils.js';
import { postLog } from '../util/logger.js';

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
    // パターンC: default は Bundler。最終強制なし。
    const defaults = VfsCore.getDefaultCompilerOptions
      ? VfsCore.getDefaultCompilerOptions()
      : {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          strict: true,
        };

    const opts = { ...defaults, ...(incoming || {}) };

    // 1) allowImportingTsExtensions -> noEmit 強制
    if (opts.allowImportingTsExtensions && !opts.noEmit) {
      postLog(
        'sanitizeCompilerOptions: enabling noEmit because allowImportingTsExtensions requested'
      );
      opts.noEmit = true;
    }

    // 2) resolvePackageJson* が有効なら moduleResolution は bundler/node16/nodenext のいずれか必須
    //    デフォルトは bundler なので override された場合のみ発火する
    const needsNodeLike =
      opts.resolvePackageJsonExports === true ||
      opts.resolvePackageJsonImports === true;

    if (needsNodeLike) {
      const mr = opts.moduleResolution;
      const valid =
        mr === ts.ModuleResolutionKind.Bundler ||
        mr === ts.ModuleResolutionKind.Node16 ||
        mr === ts.ModuleResolutionKind.NodeNext;

      if (!valid) {
        postLog(
          `sanitizeCompilerOptions: resolvePackageJson* requires node-like resolution; fixing moduleResolution->Bundler`
        );
        opts.moduleResolution = ts.ModuleResolutionKind.Bundler;
      }
    }

    // 3) 危険な compilerOptions を除去
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
        postLog(
          `sanitizeCompilerOptions: removing possibly-unsafe option "${f}"`
        );
        delete opts[f];
      }
    }

    return opts;
  }

  async initialize(params = {}) {
    const incoming = params.initializationOptions?.compilerOptions || {};
    this.#compilerOptions = this.#sanitizeCompilerOptions(incoming);

    postLog(
      `LSP initialize (sanitized opts): ${JSON.stringify(
        this.#compilerOptions
      )}`
    );

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
        version: '0.0.3',
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
      this.#env = VfsCore.createEnvironment(
        this.#compilerOptions,
        rootFiles,
        initialFiles
      );

      for (const [path, content] of Object.entries(initialFiles)) {
        try {
          if (this.#env.getSourceFile && this.#env.getSourceFile(path)) {
            this.#env.updateFile(path, content);
          } else {
            this.#env.createFile(path, content);
          }
        } catch (e) {
          postLog(
            `recreateEnv sync failed for ${path}: ${e?.message ?? String(e)}`
          );
        }
      }

      let program;
      try {
        program = this.#env.languageService.getProgram();
      } catch (e) {
        postLog(
          `getProgram() during recreateEnv failed: ${e?.message ?? String(e)}`
        );
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
          postLog(
            `recreateEnv: program missing files after retries: ${missing.join(
              ', '
            )}`
          );
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
      this.publishDiagnostics(uri).catch((e) =>
        postLog(`publishDiagnostics error: ${e?.message ?? String(e)}`)
      );
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
      postLog(
        `getProgram() failed before diagnostics: ${e?.message ?? String(e)}`
      );
    }

    const syntactic =
      this.#env.languageService.getSyntacticDiagnostics(path) || [];
    const semantic =
      this.#env.languageService.getSemanticDiagnostics(path) || [];
    const all = [...syntactic, ...semantic];

    if (all.length > 0) {
      postLog(`Diagnostics detail for ${path}:`);
      for (const d of all) {
        try {
          const msg = flattenDiagnosticMessage(d);
          postLog(
            `  - code:${d.code} start:${d.start ?? '-'} len:${
              d.length ?? '-'
            } msg:${msg}`
          );
        } catch (e) {
          postLog(`  - (failed to stringify diag) ${String(e?.message ?? e)}`);
        }
      }
    }

    const diagnostics = all.map((d) => mapTsDiagnosticToLsp(d, path, program));

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

  #uriToPath(uri) {
    if (!uri) return '';
    let path = String(uri).replace(/^file:\/\//, '');
    if (!path.startsWith('/')) path = `/${path}`;
    return path;
  }


  /*
  // ----------------------------
  // Test-only API: raw diagnostics
  // Returns JSON-safe subset of Diagnostic objects
  // ----------------------------
  async getRawDiagnosticsForTest(uri) (
    if (!this.#env) {
      postLog('getRawDiagnosticsForTest called but env is not initialized');
      return { diagnostics: [] };
    }
    const path = this.#uriToPath(uri);
    const semantic =
      this.#env.languageService.getSemanticDiagnostics(path) || [];
    const syntactic =
      this.#env.languageService.getSyntacticDiagnostics(path) || [];
    const all = [...syntactic, ...semantic];

    // Map to JSON-safe structure; preserve messageText which may be chain object
    const safe = all.map((d) => {
      return {
        code: d.code,
        category: d.category,
        start: d.start,
        length: d.length,
        messageText: d.messageText, // might be string or DiagnosticMessageChain (object)
        relatedInformation: Array.isArray(d.relatedInformation)
          ? d.relatedInformation.map((ri) => {
              // Try to return JSON-safe subset; remove file objects
              return {
                messageText: ri.messageText,
                fileName:
                  ri.file && ri.file.fileName ? ri.file.fileName : ri.file,
                start: ri.start,
                length: ri.length,
              };
            })
          : undefined,
      };
    });

    return { diagnostics: safe };
  }
  */
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

  /*
  // Test-only RPC consumer can call this
  getRawDiagnosticsForTest: async (uri) => {
    const s = await getServer();
    return await s.getRawDiagnosticsForTest(uri);
  },
  */
};
