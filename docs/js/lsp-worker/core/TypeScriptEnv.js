import ts from 'https://esm.sh/typescript';
import * as tsvfs from 'https://esm.sh/@typescript/vfs';
import { setupTypeAcquisition } from 'https://esm.sh/@typescript/ata';
import { postLog } from '../logger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class TypeScriptEnv {
  #fsMap;
  #system;
  #env;
  #ata;
  #ataTimer = null;
  #onAtaFinished = null;

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

  async init(onAtaFinishedCallback) {
    this.#onAtaFinished = onAtaFinishedCallback;
    postLog('TypeScriptEnv init start');

    this.#fsMap = await this.#createDefaultMapWithRetry();
    this.#system = tsvfs.createSystem(this.#fsMap);
    this.#env = tsvfs.createVirtualTypeScriptEnvironment(
      this.#system,
      [],
      ts,
      this.#compilerOptions,
    );

    this.#setupATA();
    this.#ata(`import 'p5';`);
    // note: 環境固有の固定モジュールを初期注入する
    // this.#injectInternalModules();
    postLog('TypeScriptEnv init complete');
  }

  // パターンA：その環境に「常に最初から存在してほしい固定のモジュール」の場合
  //   #injectInternalModules() {
  //     this.createFile(
  //       'file:///src/utils/math.js',
  //       `
  // /**
  //  * 2つの数値を加算します。
  //  * * @param {number} a - 1つ目の数値
  //  * @param {number} b - 2つ目の数値
  //  * @returns {number} a と b の合計値
  //  */
  // export function add(a, b) {
  //   return a + b;
  // }

  // /**
  //  * hogehoge処理（2つの数値を加算します）。
  //  * * @param {number} a - 1つ目の引数
  //  * @param {number} b - 2つ目の引数
  //  * @returns {number} 計算結果
  //  */
  // export function hogehoge(a, b) {
  //   return a + b;
  // }
  //       `,
  //     );
  //     postLog('[Env Init] Injected internal module: math.js', 4);
  //   }

  // --- File System API ---
  createFile(uri, text) {
    // if (!this.#env.getSourceFile(uri)) this.#env.createFile(uri, text);
    !this.#env.getSourceFile(uri) ? this.#env.createFile(uri, text) : null;
  }

  updateFile(uri, text) {
    this.#env.getSourceFile(uri)
      ? this.#env.updateFile(uri, text)
      : this.#env.createFile(uri, text);
  }

  deleteFile(uri) {
    // if (this.#env.getSourceFile(uri)) this.#env.deleteFile(uri);
    this.#env.getSourceFile(uri) ? this.#env.deleteFile(uri) : null;
  }

  getSourceFile(uri) {
    return this.#env.getSourceFile(uri);
  }

  getLanguageService() {
    return this.#env.languageService;
  }

  // --- ATA API ---
  triggerATA(text) {
    // if (this.#ataTimer) clearTimeout(this.#ataTimer);
    this.#ataTimer ? clearTimeout(this.#ataTimer) : null;
    this.#ataTimer = setTimeout(() => {
      postLog('Triggering ATA parsing...', 4);
      this.#ata(text);
    }, 1000);
  }

  #setupATA() {
    this.#ata = setupTypeAcquisition({
      projectName: 'browser-lsp',
      typescript: ts,
      logger: {
        log: (msg) => postLog(`[ATA] ${msg}`, 4),
        error: (msg) => postLog(`[ATA Error] ${msg}`, 1),
        warn: (msg) => postLog(`[ATA Warn] ${msg}`, 2),
        info: (msg) => postLog(`[ATA Info] ${msg}`, 3),
      },
      delegate: {
        receivedFile: (code, path) => {
          const vfsPath = `file://${path}`;
          postLog(`[ATA] Injected: ${path}`, 4);
          this.updateFile(vfsPath, code);
        },
        finished: () => {
          postLog(`[ATA] Finished downloading types.`, 3);
          //   if (this.#onAtaFinished) this.#onAtaFinished();
          this.#onAtaFinished ? this.#onAtaFinished() : null;
        },
      },
    });
  }

  async #createDefaultMapWithRetry(retryCount = 3, perAttemptTimeoutMs = 8000) {
    let lastError = null;
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      postLog(`VFS lib fetch attempt ${attempt}/${retryCount}`);
      try {
        const result = await Promise.race([
          tsvfs.createDefaultMapFromCDN(
            this.#compilerOptions,
            ts.version,
            false,
            ts,
          ),
          new Promise((_, r) =>
            setTimeout(() => r(new Error('timeout')), perAttemptTimeoutMs),
          ),
        ]);
        postLog(`VFS lib fetch success size=${result.size}`);
        return result;
      } catch (err) {
        lastError = err;
        const msg = String(err?.message ?? err);
        if (msg.includes('NetworkError')) throw err;
        if (msg.includes('timeout')) {
          await sleep(1000 * attempt);
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error('VFS default map initialization failed');
  }
}
