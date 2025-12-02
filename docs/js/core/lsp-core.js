// core/lsp-core.js
// v0.0.2.14 (patched incremental fallback + diagnostics return)
// - incremental path is attempted when change.range is present
// - after incremental apply, if resulting diagnostics are empty we fallback to recreateEnv -> publish again
// - publishDiagnostics now returns diagnostics array for callers to inspect

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

    // Create empty environment
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

  #uriToPath(uri) {
    if (!uri) return '';
    let path = String(uri).replace(/^file:\/\//, '');
    if (!path.startsWith('/')) path = `/${path}`;
    return path;
  }

  #pathToUri(path) {
    if (!path) return '';
    if (path.startsWith('file://')) return path;
    return `file://${path}`;
  }

  #posToOffset(text, line, character) {
    if (typeof text !== 'string') return 0;
    const lines = text.split('\n');
    const l = Math.max(0, Math.min(line, lines.length - 1));
    const ch = Math.max(0, Math.min(character, lines[l].length));
    let offset = 0;
    for (let i = 0; i < l; i++) offset += lines[i].length + 1;
    offset += ch;
    return offset;
  }

  #applyRangeChange(oldText, change) {
    if (typeof oldText !== 'string') throw new Error('oldText must be string');
    if (!change || typeof change.text !== 'string') throw new Error('change.text required');

    const range = change.range;
    if (!range || !range.start || !range.end) throw new Error('range required');

    const startOffset = this.#posToOffset(oldText, range.start.line, range.start.character);
    const endOffset = this.#posToOffset(oldText, range.end.line, range.end.character);

    if (startOffset < 0 || endOffset < startOffset) throw new Error('Invalid range offsets');

    const before = oldText.slice(0, startOffset);
    const after = oldText.slice(endOffset);
    return `${before}${change.text}${after}`;
  }

  async didOpen(params) {
    const { uri, text, version } = params.textDocument;
    const path = this.#uriToPath(uri);
    postLog(`didOpen ${path} (version:${version})`);

    this.#openFiles.set(uri, { text, version });
    await this.#recreateEnv();
    await this.publishDiagnostics(uri);
  }

  async didChange(params) {
    const { uri, version } = params.textDocument;
    const changes = params.contentChanges || [];
    if (!changes.length) {
      postLog(`didChange received but no contentChanges for ${uri}`);
      return;
    }

    const last = changes[changes.length - 1];
    const path = this.#uriToPath(uri);
    postLog(`didChange ${path} (version:${version})`);

    if (last.range) {
      // Attempt incremental apply
      try {
        const existing = this.#openFiles.get(uri);
        const oldText = existing?.text ?? '';
        // Debug logging: show snippet and lengths
        postLog(`incremental: oldText.length=${oldText.length}, change.text.length=${String(last.text ?? '').length}`);

        const newText = this.#applyRangeChange(oldText, last);

        // Log offsets & small preview for debugging
        try {
          const startOffset = this.#posToOffset(oldText, last.range.start.line, last.range.start.character);
          const endOffset = this.#posToOffset(oldText, last.range.end.line, last.range.end.character);
          const beforeSample = oldText.slice(Math.max(0, startOffset - 10), Math.min(startOffset + 10, oldText.length));
          const afterSample = newText.slice(Math.max(0, startOffset - 10), Math.min(startOffset + 10, newText.length));
          postLog(`incremental offsets: start=${startOffset}, end=${endOffset}, beforeSample="${beforeSample}", afterSample="${afterSample}"`);
        } catch (e) {
          // non-fatal
        }

        // update in-memory openFiles
        this.#openFiles.set(uri, { text: newText, version });

        // Update VFS in-place if possible
        if (this.#env && this.#env.getSourceFile && this.#env.getSourceFile(path)) {
          if (typeof this.#env.updateFile === 'function') {
            try {
              this.#env.updateFile(path, newText);
            } catch (e) {
              postLog(`env.updateFile threw: ${String(e?.message ?? e)}; falling back`);
              throw e;
            }
          } else {
            postLog('env.updateFile not available; falling back to recreateEnv');
            throw new Error('env.updateFile missing');
          }
        } else {
          // File not present: try createFile
          if (this.#env && typeof this.#env.createFile === 'function') {
            this.#env.createFile(path, newText);
          } else {
            postLog('env.createFile not available; falling back to recreateEnv');
            throw new Error('env.createFile missing');
          }
        }

        // incremental apply done. Now check diagnostics.
        const diagnosticsAfter = await this.publishDiagnostics(uri);

        // If diagnostics are empty after incremental apply, fallback to recreateEnv once.
        if ((!diagnosticsAfter || diagnosticsAfter.length === 0)) {
          postLog('incremental apply produced 0 diagnostics; performing safe fallback recreateEnv -> publishDiagnostics');
          // restore openFiles text already set; now recreate
          await this.#recreateEnv();
          await this.publishDiagnostics(uri);
        }

        return;
      } catch (e) {
        postLog(`incremental apply failed: ${String(e?.message ?? e)}; falling back to full-replace`);
        // fallthrough to fallback
      }
    }

    // Fallback: full replace
    try {
      const text = last.text;
      if (typeof text !== 'string') {
        postLog(`didChange fallback: last.change.text not present for ${uri}`);
        return;
      }
      this.#openFiles.set(uri, { text, version });
      await this.#recreateEnv();
      await this.publishDiagnostics(uri);
    } catch (e) {
      postLog(`didChange fallback failed: ${String(e?.message ?? e)}`);
    }
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
            if (typeof this.#env.updateFile === 'function') {
              this.#env.updateFile(path, content);
            }
          } else {
            if (typeof this.#env.createFile === 'function') {
              this.#env.createFile(path, content);
            }
          }
        } catch (e) {
          postLog(`recreateEnv sync failed for ${path}: ${e?.message ?? String(e)}`);
        }
      }

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

    let severity = 1;
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

    try {
      if (Array.isArray(diag.relatedInformation) && diag.relatedInformation.length > 0) {
        const riList = [];
        for (const ri of diag.relatedInformation) {
          try {
            let riUri = null;
            let riRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

            if (ri?.file && typeof ri.file === 'object' && typeof ri.file.fileName === 'string') {
              riUri = this.#pathToUri(ri.file.fileName);
              if (typeof ri.start === 'number') {
                const pos = ts.getLineAndCharacterOfPosition(ri.file, ri.start);
                riRange = { start: { line: pos.line, character: pos.character }, end: { line: pos.line, character: pos.character } };
              }
            } else if (ri?.file && typeof ri.file === 'string') {
              riUri = this.#pathToUri(ri.file);
            }

            const riMsg = ts.flattenDiagnosticMessageText(ri.messageText, '\n');

            if (riUri) {
              riList.push({ location: { uri: riUri, range: riRange }, message: riMsg });
            }
          } catch (e) {
            postLog(`map relatedInformation error: ${String(e?.message ?? e)}`);
          }
        }

        if (riList.length > 0) lsp.relatedInformation = riList;
      }
    } catch (e) {
      postLog(`relatedInformation mapping failed: ${String(e?.message ?? e)}`);
    }

    return lsp;
  }

  /**
   * Publish diagnostics and return the diagnostics array for caller inspection.
   */
  async publishDiagnostics(uri) {
    if (!this.#env) {
      postLog('publishDiagnostics called but env is not initialized');
      return [];
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

    return diagnostics;
  }

  #clearDiagnostics(uri) {
    self.postMessage({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: { uri, diagnostics: [] },
    });
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
    return await s.publishDiagnostics(uri);
  },
};
