// core/lsp-core.js
// v0.0.2.14

import ts from 'https://esm.sh/typescript';
import { VfsCore } from './vfs-core.js';
import { postLog } from '../util/logger.js';

class LspServer {
  #env = null;
  #openFiles = new Map();
  #compilerOptions = {};

  constructor() {
    postLog('LspServer instance created');
  }

  /**
   * Minimal compiler options merge: take defaults and shallow-merge incoming.
   * Avoid heavy sanitization here; keep small and predictable.
   */
  #mergeCompilerOptions(incoming = {}) {
    const defaults = VfsCore.getDefaultCompilerOptions
      ? VfsCore.getDefaultCompilerOptions()
      : {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          strict: true,
        };
    return Object.assign({}, defaults, incoming || {});
  }

  async initialize(params = {}) {
    const incoming = params.initializationOptions?.compilerOptions || {};
    this.#compilerOptions = this.#mergeCompilerOptions(incoming);

    postLog(`LSP initialize (opts): ${JSON.stringify(this.#compilerOptions)}`);

    await VfsCore.ensureReady();

    // Create empty environment (no root files yet)
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
    // publish immediately (no debounce)
    await this.publishDiagnostics(uri);
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
    await this.publishDiagnostics(uri);
  }

  async didClose(params) {
    const { uri } = params.textDocument;
    const path = this.#uriToPath(uri);
    postLog(`didClose ${path}`);

    this.#openFiles.delete(uri);
    await this.#recreateEnv();
    // clear diagnostics immediately
    this.#clearDiagnostics(uri);
  }

  /**
   * Recreate the VFS environment from currently open files.
   * Simplified: no retry loop, assume VfsCore.createEnvironment is robust.
   */
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

      // Ensure content applied
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

      // Try to prime the program; if it fails, we still continue (logs)
      try {
        this.#env.languageService.getProgram();
      } catch (e) {
        postLog(`getProgram() during recreateEnv failed: ${e?.message ?? String(e)}`);
      }

      postLog(`recreateEnv done; roots: [${rootFiles.join(', ')}]`);
    } catch (e) {
      postLog(`recreateEnv failed: ${e?.message ?? String(e)}`);
      throw e;
    }
  }

  /**
   * Map TS Diagnostic -> LSP Diagnostic (standards-aligned).
   * - message uses ts.flattenDiagnosticMessageText
   * - relatedInformation mapped only when file+start available
   */
  #mapTsDiagnosticToLsp(diag, path, program) {
    const start = typeof diag.start === 'number' ? diag.start : 0;
    const length = typeof diag.length === 'number' ? diag.length : 0;

    let sourceFile = null;
    try {
      sourceFile = program?.getSourceFile(path) ?? null;
    } catch (e) {
      sourceFile = null;
    }

    const startPos =
      sourceFile && typeof start === 'number'
        ? ts.getLineAndCharacterOfPosition(sourceFile, start)
        : { line: 0, character: 0 };

    const endPos =
      sourceFile && typeof start === 'number' && typeof length === 'number'
        ? ts.getLineAndCharacterOfPosition(sourceFile, start + length)
        : { line: startPos.line, character: startPos.character };

    const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');

    // Severity mapping: TS -> LSP
    let severity = 1; // default Error
    if (typeof diag.category === 'number') {
      switch (diag.category) {
        case ts.DiagnosticCategory.Error:
          severity = 1;
          break;
        case ts.DiagnosticCategory.Warning:
          severity = 2;
          break;
        case ts.DiagnosticCategory.Suggestion:
          severity = 3;
          break;
        case ts.DiagnosticCategory.Message:
        default:
          severity = 3;
          break;
      }
    }

    const lsp = {
      range: { start: startPos, end: endPos },
      message,
      severity,
      source: 'ts',
      code: diag.code,
    };

    // Map relatedInformation -> LSP relatedInformation when location available
    try {
      if (Array.isArray(diag.relatedInformation) && diag.relatedInformation.length > 0) {
        const riList = [];
        for (const ri of diag.relatedInformation) {
          try {
            let riUri = null;
            let riRange = {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            };

            if (ri?.file && typeof ri.file === 'object' && typeof ri.file.fileName === 'string') {
              riUri = `file://${ri.file.fileName.startsWith('/') ? ri.file.fileName : ri.file.fileName}`;
              if (typeof ri.start === 'number') {
                const pos = ts.getLineAndCharacterOfPosition(ri.file, ri.start);
                riRange = {
                  start: {
                    line: pos.line,
                    character: pos.character,
                  },
                  end: {
                    line: pos.line,
                    character: pos.character,
                  },
                };
              }
            } else if (ri?.file && typeof ri.file === 'string') {
              riUri = `file://${ri.file.startsWith('/') ? ri.file : ri.file}`;
              // cannot compute line/char without SourceFile
            }

            const riMsg = ts.flattenDiagnosticMessageText(ri.messageText, '\n');

            if (riUri) {
              riList.push({
                location: { uri: riUri, range: riRange },
                message: riMsg,
              });
            }
          } catch (e) {
            postLog(`map relatedInformation error: ${String(e?.message ?? e)}`);
            // continue with other relatedInformation
          }
        }

        if (riList.length > 0) {
          lsp.relatedInformation = riList;
        }
      }
    } catch (e) {
      postLog(`relatedInformation mapping failed: ${String(e?.message ?? e)}`);
    }

    return lsp;
  }

  /**
   * Publish diagnostics for a given uri (immediate, no debounce).
   */
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

    const diagnostics = all.map((d) => this.#mapTsDiagnosticToLsp(d, path, program));

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
    if (!uri) {
      return '';
    }
    let path = String(uri).replace(/^file:\/\//, '');
    if (!path.startsWith('/')) {
      path = `/${path}`;
    }
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
