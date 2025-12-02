// core/lsp-core.js
// v0.0.2.14

import ts from 'https://esm.sh/typescript';
import { VfsCore } from './vfs-core.js';
import { postLog } from '../util/logger.js';

class LspServer {
  #env = null;
  #openFiles = new Map(); // uri -> { text, version }
  #compilerOptions = {};

  constructor() {
    postLog('LspServer instance created');
  }

  /**
   * Minimal compiler options merge: take defaults and shallow-merge incoming.
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

  /**
   * Basic didOpen: store file text/version, recreate env, publish diagnostics.
   */
  async didOpen(params) {
    const { uri, text, version } = params.textDocument;
    const path = this.#uriToPath(uri);
    postLog(`didOpen ${path} (version:${version})`);

    this.#openFiles.set(uri, { text, version });
    await this.#recreateEnv();
    await this.publishDiagnostics(uri);
  }

  /**
   * didChange: attempt incremental (range-based) edit when possible.
   * Falls back to full replace (#recreateEnv) otherwise.
   */
  async didChange(params) {
    const { uri, version } = params.textDocument;
    const changes = params.contentChanges || [];

    const path = this.#uriToPath(uri);
    postLog(`didChange ${path} (version:${version})`);

    // Find last text if provided as full replace in contentChanges
    // LSP: contentChanges may be array; if last has `text` w/o range -> full replace
    // If exactly one change and that change has range -> incremental candidate
    try {
      if (changes.length === 1 && changes[0] && typeof changes[0].text === 'string' && changes[0].range) {
        // Attempt incremental
        const change = changes[0];
        const applied = await this.#applyIncrementalChange(uri, change);
        if (applied) {
          // Update openFiles map with new text/version
          const stored = this.#openFiles.get(uri) || { text: '', version };
          this.#openFiles.set(uri, { text: applied, version });
          // publish diagnostics for the file
          await this.publishDiagnostics(uri);
          return;
        }
        // else fallthrough to full replace
        postLog('incremental apply returned false: falling back to full replace');
      }

      // Non-incremental path: determine new text if provided; otherwise rely on stored openFiles
      let newText;
      if (changes.length && typeof changes[changes.length - 1].text === 'string' && !changes[changes.length - 1].range) {
        // full replace using last change text
        newText = changes[changes.length - 1].text;
      } else {
        // no text provided: try to use existing stored text (no-op) but still recreate env to ensure consistency
        const stored = this.#openFiles.get(uri);
        newText = stored ? stored.text : undefined;
      }

      if (typeof newText === 'string') {
        this.#openFiles.set(uri, { text: newText, version });
      }

      await this.#recreateEnv();
      await this.publishDiagnostics(uri);
    } catch (e) {
      postLog(`didChange unexpected error: ${String(e?.message ?? e)}. Falling back to recreateEnv.`);
      // best-effort fallback
      await this.#recreateEnv();
      await this.publishDiagnostics(uri);
    }
  }

  /**
   * didClose: remove from openFiles, recreate env, clear diagnostics for the uri
   */
  async didClose(params) {
    const { uri } = params.textDocument;
    const path = this.#uriToPath(uri);
    postLog(`didClose ${path}`);

    this.#openFiles.delete(uri);
    await this.#recreateEnv();
    this.#clearDiagnostics(uri);
  }

  /**
   * Apply a single LSP incremental change object to stored text and VFS.
   * - change: { range, rangeLength?, text }
   * - returns newText (string) on success, or false on failure
   */
  async #applyIncrementalChange(uri, change) {
    try {
      if (!change || typeof change.text !== 'string' || !change.range) {
        return false;
      }

      const stored = this.#openFiles.get(uri);
      if (!stored || typeof stored.text !== 'string') {
        postLog(`#applyIncrementalChange: no stored text for ${uri}`);
        return false;
      }

      const oldText = stored.text;
      const { range } = change;
      const startOffset = this.#positionToOffset(oldText, range.start);
      const endOffset = this.#positionToOffset(oldText, range.end);

      if (startOffset === null || endOffset === null || startOffset > endOffset) {
        postLog(`#applyIncrementalChange: invalid offsets for ${uri} start=${startOffset} end=${endOffset}`);
        return false;
      }

      const newText = oldText.slice(0, startOffset) + change.text + oldText.slice(endOffset);

      // If env exists and file present, update in-place. Otherwise, indicate failure (let caller recreate).
      if (this.#env && typeof this.#env.getSourceFile === 'function') {
        // VFS path expected to be normalized with leading '/'
        let path = this.#uriToPath(uri);
        if (!path.startsWith('/')) path = `/${path}`;

        try {
          // If source file exists in env, update. Otherwise create file.
          if (this.#env.getSourceFile && this.#env.getSourceFile(path)) {
            // updateFile available on virtual env
            if (typeof this.#env.updateFile === 'function') {
              this.#env.updateFile(path, newText);
            } else {
              // fallback: recreate env (signal failure)
              postLog('#applyIncrementalChange: env.updateFile not available');
              return false;
            }
          } else {
            if (typeof this.#env.createFile === 'function') {
              this.#env.createFile(path, newText);
            } else {
              postLog('#applyIncrementalChange: env.createFile not available');
              return false;
            }
          }
          // success
          return newText;
        } catch (e) {
          postLog(`#applyIncrementalChange: env update/create failed: ${String(e?.message ?? e)}`);
          return false;
        }
      } else {
        postLog('#applyIncrementalChange: env not initialized; cannot apply incremental');
        return false;
      }
    } catch (e) {
      postLog(`#applyIncrementalChange unexpected error: ${String(e?.message ?? e)}`);
      return false;
    }
  }

  /**
   * Convert LSP position {line, character} into UTF-16 code unit offset within `text`.
   * Implementation: compute by splitting into lines and summing lengths including '\n' between lines.
   * Returns null on invalid input.
   */
  #positionToOffset(text, pos) {
    try {
      if (!text || !pos || typeof pos.line !== 'number' || typeof pos.character !== 'number') {
        return null;
      }
      const lines = text.split('\n');
      if (pos.line < 0 || pos.line >= lines.length) {
        // allow position at EOF equal to lines.length (when last line is empty?) - but be conservative
        if (pos.line === lines.length && pos.character === 0) {
          // offset = text.length
          return text.length;
        }
        return null;
      }
      let offset = 0;
      for (let i = 0; i < pos.line; i++) {
        // add line length + 1 for the '\n' that was removed by split
        offset += lines[i].length + 1;
      }
      // character is number of UTF-16 code units into the line
      const line = lines[pos.line];
      const ch = Math.max(0, Math.min(pos.character, line.length));
      offset += ch;
      return offset;
    } catch (e) {
      postLog(`#positionToOffset error: ${String(e?.message ?? e)}`);
      return null;
    }
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
      this.#env = VfsCore.createEnvironment(
        this.#compilerOptions,
        rootFiles,
        initialFiles
      );

      // Ensure content applied (defensive)
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
      if (
        Array.isArray(diag.relatedInformation) &&
        diag.relatedInformation.length > 0
      ) {
        const riList = [];
        for (const ri of diag.relatedInformation) {
          try {
            let riUri = null;
            let riRange = {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            };

            if (
              ri?.file &&
              typeof ri.file === 'object' &&
              typeof ri.file.fileName === 'string'
            ) {
              riUri = `file://${ri.file.fileName.startsWith('/') ? ri.file.fileName : ri.file.fileName}`;
              if (typeof ri.start === 'number') {
                const pos = ts.getLineAndCharacterOfPosition(ri.file, ri.start);
                riRange = {
                  start: { line: pos.line, character: pos.character },
                  end: { line: pos.line, character: pos.character },
                };
              }
            } else if (ri?.file && typeof ri.file === 'string') {
              riUri = `file://${ri.file.startsWith('/') ? ri.file : ri.file}`;
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

    const syntactic =
      this.#env.languageService.getSyntacticDiagnostics(path) || [];
    const semantic =
      this.#env.languageService.getSemanticDiagnostics(path) || [];
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

