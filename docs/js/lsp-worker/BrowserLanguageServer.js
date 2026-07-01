import ts from 'https://esm.sh/typescript';
import * as tsvfs from 'https://esm.sh/@typescript/vfs';
import { setupTypeAcquisition } from 'https://esm.sh/@typescript/ata';

import { getCompletionItemKind, getDiagnosticSeverity } from './converters.js';

import { postLog } from './logger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default class BrowserLanguageServer {
  // =========================================================================
  // 1. State & Configurations (状態と設定)
  // =========================================================================
  #fsMap;
  #system;
  #env;
  #ready = false;
  #envId = 0;
  #documentTimers = new Map(); // Diagnosticsのデバウンス用

  #ata;
  #ataTimer = null;
  #activeUris = new Set(); // 開いているファイルのURIを管理する

  // compilerOptions をクラス内で一元管理
  #compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    allowArbitraryExtensions: true,
    allowJs: true,
    checkJs: true,
    noUnusedLocals: true,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
  };

  #requestHandlers = {
    initialize: this.#handleInitialize.bind(this),
    'textDocument/completion': this.#handleCompletion.bind(this),
    'textDocument/hover': this.#handleHover.bind(this),
  };

  #notificationHandlers = {
    initialized: this.#handleInitialized.bind(this),
    'textDocument/didOpen': this.#handleDidOpen.bind(this),
    'textDocument/didChange': this.#handleDidChange.bind(this),
    'textDocument/didClose': this.#handleDidClose.bind(this),
  };

  // =========================================================================
  // 2. Public API (エントリーポイント)
  // =========================================================================
  async handleMessage(message) {
    const { id, method, params } = message;

    try {
      if (id !== undefined) {
        const handler = this.#requestHandlers[method];
        if (handler) {
          if (method !== 'initialize' && !this.#ready) {
            throw new Error('Server is not ready yet');
          }
          const result = await handler(params);
          return { jsonrpc: '2.0', id, result };
        } else {
          // 未実装メソッドへのフォールバック
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method ${method} not implemented`,
            },
          };
        }
      } else {
        const handler = this.#notificationHandlers[method];
        if (handler) {
          if (method !== 'initialized' && !this.#ready) return null;
          await handler(params);
        }
        return null;
      }
    } catch (err) {
      postLog(`Error handling ${method}: ${err.message}`, 1);
      if (id !== undefined) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: err.message || String(err) },
        };
      }
      return null;
    }
  }

  // =========================================================================
  // 3. Initialization (初期化処理)
  // =========================================================================
  async #init() {
    this.#envId++;
    postLog(`VfsCore init start (env #${this.#envId})`);

    // 共通の compilerOptions を使用
    this.#fsMap = await this.#createDefaultMapWithRetry();
    /*
    const [fsMap, p5SoundDts] = await Promise.all([
      this.#createDefaultMapWithRetry(),
      // p5.sound の型定義を unpkg から直接ピンポイントで狙い撃ち
      fetch('https://unpkg.com/@types/p5@1.7.7/lib/addons/p5.sound.d.ts')
        .then((r) => r.text())
        .catch(() => ''),
    ]);

    this.#fsMap = fsMap;
    if (p5SoundDts) {
      const soundPath =
        'file:///node_modules/@types/p5/lib/addons/p5.sound.d.ts';
      this.#fsMap.set(soundPath, p5SoundDts);
      postLog(`[Pre-fetch] Injected: ${soundPath}`, 4);
    }
    */

    this.#system = tsvfs.createSystem(this.#fsMap);

    this.#env = tsvfs.createVirtualTypeScriptEnvironment(this.#system, [], ts, this.#compilerOptions);

    this.#ata = setupTypeAcquisition({
      projectName: 'browser-lsp',
      typescript: ts,
      // ATA内部のログを eruda に流す
      logger: {
        log: (msg) => postLog(`[ATA] ${msg}`, 4),
        error: (msg) => postLog(`[ATA Error] ${msg}`, 1),
        warn: (msg) => postLog(`[ATA Warn] ${msg}`, 2),
        info: (msg) => postLog(`[ATA Info] ${msg}`, 3),
      },
      delegate: {
        // CDNから型定義ファイルを受信した時
        receivedFile: (code, path) => {
          const vfsPath = `file://${path}`;
          postLog(`[ATA] Injected: ${path}`, 4);
          // VFSに既に存在すれば更新、なければ作成
          // this.#env.getSourceFile(vfsPath)
          //   ? this.#env.updateFile(vfsPath, code)
          //   : this.#env.createFile(vfsPath, code);
          if (this.#env.getSourceFile(vfsPath)) {
            this.#env.updateFile(vfsPath, code);
          } else {
            this.#env.createFile(vfsPath, code);
          }
        },
        // 全ての型のダウンロード完了時
        finished: () => {
          postLog(`[ATA] Finished downloading types.`, 3);
          // 診断を再実行
          for (const uri of this.#activeUris) {
            this.#publishDiagnostics(uri);
          }
        },
      },
    });

    this.#ready = true;
    postLog(`VfsCore init complete (env #${this.#envId})`);

    postLog('Pre-fetching default libraries via ATA...', 4);
    // this.#ata(`import p5 from 'p5';`);
    this.#ata(`import 'p5';`);
  }

  async #createDefaultMapWithRetry(retryCount = 3, perAttemptTimeoutMs = 8000) {
    let lastError = null;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      postLog(`VFS lib fetch attempt ${attempt}/${retryCount}`);

      try {
        const result = await Promise.race([
          tsvfs.createDefaultMapFromCDN(
            this.#compilerOptions, // 共通のオプションを渡す
            ts.version,
            false,
            ts,
          ),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), perAttemptTimeoutMs)),
        ]);

        postLog(`VFS lib fetch success size=${result.size}`);
        return result;
      } catch (err) {
        lastError = err;
        const msg = String(err?.message ?? err);

        if (msg.includes('NetworkError')) {
          postLog('VFS lib fetch network error → abort', 1);
          throw err;
        }

        if (msg.includes('timeout')) {
          postLog('VFS lib fetch timeout → retry with backoff', 2);
          await sleep(1000 * attempt);
          continue;
        }

        postLog(`VFS lib fetch unexpected error: ${msg}`, 1);
        throw err;
      }
    }
    throw lastError || new Error('VFS default map initialization failed');
  }

  // =========================================================================
  // 4. Lifecycle Handlers (ライフサイクル)
  // =========================================================================
  async #handleInitialize(params) {
    await this.#init();
    return {
      capabilities: {
        textDocumentSync: 1, // Full Sync
        hoverProvider: true,
        completionProvider: {
          resolveProvider: false,
          triggerCharacters: ['.', '"', "'", '/', '@', '<'],
        },
      },
    };
  }

  async #handleInitialized() {
    postLog('Client and Server successfully connected.');
  }

  // =========================================================================
  // 5. Document Sync Handlers (ドキュメント同期)
  // =========================================================================
  async #handleDidOpen(params) {
    const { uri, text } = params.textDocument;

    this.#activeUris.add(uri);

    const initialText = text.trim() === '' ? '\n' : text;
    this.#env.createFile(uri, initialText);
    postLog(`Opened file: ${uri}`);

    this.#triggerDiagnostics(uri);
    this.#triggerATA(initialText);
  }

  async #handleDidChange(params) {
    const { uri } = params.textDocument;
    const text = params.contentChanges[0].text;
    const validText = text.trim() === '' ? '\n' : text;
    this.#env.updateFile(uri, validText);

    this.#triggerDiagnostics(uri);
    this.#triggerATA(validText);
  }

  async #handleDidClose(params) {
    const { uri } = params.textDocument;

    this.#activeUris.delete(uri);

    this.#env.deleteFile(uri);
    postLog(`Closed file: ${uri}`);
  }

  #triggerATA(text) {
    if (this.#ataTimer) {
      clearTimeout(this.#ataTimer);
    }
    this.#ataTimer = setTimeout(() => {
      postLog('Triggering ATA parsing...', 4);
      this.#ata(text);
    }, 1000);

    /*
    const files = this.#env.languageService
      .getProgram()
      .getSourceFiles()
      .map((f) => f.fileName);

    console.log(files);
    */
  }

  // =========================================================================
  // 6. Language Features (ホバー、補完、診断)
  // =========================================================================
  async #handleHover(params) {
    // LSPから送られてくる params は
    // `{ textDocument: { uri: "..." }, position: { ... } }`
    const uri = params.textDocument.uri;
    const position = params.position;
    const offset = this.#getOffsetFromLSPPosition(uri, position);

    try {
      // TS Compiler API からホバー先の情報を取得 (QuickInfo)
      const info = this.#env.languageService.getQuickInfoAtPosition(uri, offset);
      if (!info) {
        return null;
      } // ホバー情報がない場所(空白など)は null を返す

      // TSが持っている情報を文字列に変換
      const displayString = ts.displayPartsToString(info.displayParts || []);
      const docString = ts.displayPartsToString(info.documentation || []);

      // LSPの Hover フォーマット (Markdown) に変換して返す
      const contents = {
        kind: 'markdown',
        value: [`\`\`\`typescript\n${displayString}\n\`\`\``, docString].filter(Boolean).join('\n\n---\n\n'), // コメント(docString)があれば横線で区切る
      };

      return {
        contents,
        range: {
          start: this.#getLSPPositionFromOffset(uri, info.textSpan.start),
          end: this.#getLSPPositionFromOffset(uri, info.textSpan.start + info.textSpan.length),
        },
      };
    } catch (e) {
      postLog(`Hover error: ${e.message}`, 1);
      return null;
    }
  }

  async #handleCompletion(params) {
    const uri = params.textDocument.uri;
    const position = params.position;

    // LSPの座標をTSのオフセットに変換
    const offset = this.#getOffsetFromLSPPosition(uri, position);

    try {
      // TS Compiler API から補完候補を取得
      const completions = this.#env.languageService.getCompletionsAtPosition(uri, offset, {
        includeCompletionsForModuleExports: false, // 今回はシンプルにするため外部エクスポートは含めない
        includeCompletionsWithInsertText: true,
      });

      if (!completions || !completions.entries) {
        return null; // 候補がない場合は null を返す
      }

      // TSの補完リストをLSPのフォーマットにマッピング
      const items = completions.entries.map((entry) => {
        return {
          label: entry.name,
          kind: getCompletionItemKind(entry.kind),
          sortText: entry.sortText,
          // 補完実行時に挿入されるテキスト(定義されていなければlabelが使われる)
          insertText: entry.insertText,
        };
      });

      return {
        isIncomplete: false,
        items,
      };
    } catch (e) {
      postLog(`Completion error: ${e.message}`, 1);
      return null;
    }
  }

  // デバウンス処理付きのトリガー
  #triggerDiagnostics(uri) {
    if (this.#documentTimers.has(uri)) {
      clearTimeout(this.#documentTimers.get(uri));
    }
    // 300ms 入力がなければ診断を実行
    const timer = setTimeout(() => {
      this.#publishDiagnostics(uri);
      this.#documentTimers.delete(uri);
    }, 300);
    this.#documentTimers.set(uri, timer);
  }

  #publishDiagnostics(uri) {
    try {
      // 構文エラー(Syntactic)と意味的エラー(Semantic)の両方を取得
      const syntactic = this.#env.languageService.getSyntacticDiagnostics(uri);
      const semantic = this.#env.languageService.getSemanticDiagnostics(uri);
      const tsDiagnostics = [...syntactic, ...semantic];

      const diagnostics = tsDiagnostics.map((diag) => {
        // エラー位置の計算(開始位置と終了位置)
        const startOffset = diag.start ?? 0;
        const endOffset = startOffset + (diag.length ?? 0);
        const start = this.#getLSPPositionFromOffset(uri, startOffset);
        const end = this.#getLSPPositionFromOffset(uri, endOffset);

        return {
          range: { start, end },
          severity: getDiagnosticSeverity(diag.category),
          source: 'typescript',
          // メッセージが入れ子になっている場合を考慮して平坦化
          message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
        };
      });

      // クライアント(CodeMirror)へ通知をPushする
      self.postMessage({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri,
          diagnostics,
        },
      });
      postLog(`Published ${diagnostics.length} diagnostics for ${uri}`, 4);
    } catch (e) {
      postLog(`Diagnostics error: ${e.message}`, 1);
    }
  }

  // =========================================================================
  // 7. Utilities (変換ユーティリティ群)
  // =========================================================================
  #getOffsetFromLSPPosition(uri, position) {
    const sourceFile = this.#env.getSourceFile(uri);
    if (!sourceFile) {
      throw new Error(`Source file not found: ${uri}`);
    }
    // LSPのPosition (line, character) は0ベース。TSのAPIも0ベースを想定
    return ts.getPositionOfLineAndCharacter(sourceFile, position.line, position.character);
  }

  #getLSPPositionFromOffset(uri, offset) {
    const sourceFile = this.#env.getSourceFile(uri);
    if (!sourceFile) {
      throw new Error(`Source file not found: ${uri}`);
    }
    return ts.getLineAndCharacterOfPosition(sourceFile, offset);
  }
}
