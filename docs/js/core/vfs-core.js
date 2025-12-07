// core/vfs-core.js
// v0.0.3.0

// 役割: VFS 初期化、defaultMap のキャッシュ、環境生成、テスト用リセット

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';
import { postLog } from '../util/logger.js';
import { sleep } from '../util/async-utils.js';

// =============================================
// VfsCore 本体クラス
// =============================================

export class VfsCore {
  // -------------------------------------------
  // 静的フィールド: シングルトン的キャッシュ
  // -------------------------------------------
  static cachedDefaultMap = null;       // CDN から取得した lib ファイル群
  static vfsReady = false;              // defaultMap が使える状態か
  static _ensurePromise = null;         // ensureReady の排他制御

  // -------------------------------------------
  // パスを VFS 標準形式に合わせる
  // -------------------------------------------
  static normalizeVfsPath(p) {
    if (!p) return '';
    let s = String(p).replace(/^file:\/\//, '');
    if (!s.startsWith('/')) s = `/${s}`;
    return s;
  }

  // -------------------------------------------
  // Map の浅いクローン生成
  // -------------------------------------------
  static mapClone(src) {
    return new Map(src);
  }

  // -------------------------------------------
  // CDN の defaultMap をリトライ付きで取得
  // -------------------------------------------
  static async createDefaultMapWithRetries(
    retryCount = 3,
    perAttemptTimeoutMs = 5000
  ) {
    let lastError = null;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      postLog(`VFS init attempt ${attempt}/${retryCount}`);

      try {
        // タイムアウト監視
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), perAttemptTimeoutMs)
        );

        // CDN 取得 + タイムアウト競合
        const defaultMap = await Promise.race([
          vfs.createDefaultMapFromCDN(
            {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
            },
            ts.version,
            false,
            ts
          ),
          timeout
        ]);

        postLog(`defaultMap size: ${defaultMap.size}`);
        return defaultMap;

      } catch (error) {
        lastError = error;
        const msg = String(error?.message ?? error);

        // ネットワーク系は致命的扱い
        if (msg.includes('fetch') || msg.includes('NetworkError')) {
          postLog(`Network error while fetching defaultMap: ${msg}`);
          throw error;
        }

        // タイムアウトはリトライ
        if (msg.includes('timeout')) {
          postLog(`Timeout on attempt ${attempt}, retrying after backoff`);
          await sleep(1000 * attempt);
          continue;
        }

        // その他エラー
        postLog(`createDefaultMapWithRetries unknown error: ${msg}`);
        throw error;
      }
    }

    throw lastError || new Error('VFS init failed after retries');
  }

  // -------------------------------------------
  // defaultMap が準備完了するまで待つ
  // -------------------------------------------
  static async ensureReady(retry = 3, timeoutMs = 5000) {
    if (VfsCore.vfsReady && VfsCore.cachedDefaultMap) {
      postLog('Using existing cachedDefaultMap (already ready)');
      return;
    }

    // 同時実行を防ぎ、1つの Promise に集約
    if (VfsCore._ensurePromise) return VfsCore._ensurePromise;

    VfsCore._ensurePromise = (async () => {
      try {
        if (!VfsCore.cachedDefaultMap) {
          VfsCore.cachedDefaultMap =
            await VfsCore.createDefaultMapWithRetries(retry, timeoutMs);
        } else {
          postLog('Using existing cachedDefaultMap (populate)');
        }

        VfsCore.vfsReady = true;
        postLog('VFS ensureReady complete');

      } finally {
        // クリティカルセクション終了
        VfsCore._ensurePromise = null;
      }
    })();

    return VfsCore._ensurePromise;
  }

  // -------------------------------------------
  // defaultMap の参照提供
  // -------------------------------------------
  static getDefaultMap() {
    return VfsCore.cachedDefaultMap;
  }

  // -------------------------------------------
  // デフォルトの compilerOptions を返す
  // -------------------------------------------
  static getDefaultCompilerOptions() {
    return {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,

      // ブラウザ環境での Node-like module resolution を両立する構成
      moduleResolution: ts.ModuleResolutionKind.Bundler,

      strict: true,
      allowImportingTsExtensions: true,
      allowArbitraryExtensions: true,
      resolvePackageJsonExports: true,
      resolvePackageJsonImports: true,
      skipLibCheck: true,
      useDefineForClassFields: true,
      noEmit: true
    };
  }

  // -------------------------------------------
  // VFS 環境の生成
  // -------------------------------------------
  static createEnvironment(
    compilerOptions = {},
    rootFiles = [],
    initialFiles = {}
  ) {
    if (!VfsCore.cachedDefaultMap) {
      throw new Error('VFS not initialized. Call ensureReady() first.');
    }

    // defaultMap を複製して環境専用 map を作成
    const mapForEnv = VfsCore.mapClone(VfsCore.cachedDefaultMap);

    // 初期ファイルを正規化して map に追加
    const normalizedInitialFiles = {};

    for (const [rawKey, content] of Object.entries(initialFiles || {})) {
      try {
        const key = VfsCore.normalizeVfsPath(rawKey);
        const data = String(content ?? '');
        normalizedInitialFiles[key] = data;

        mapForEnv.set(key, data);
        postLog(`createEnvironment: injected initial file: ${key}`);

      } catch (e) {
        postLog(
          `createEnvironment: failed to inject initial file ${rawKey}: ${
            String(e?.message ?? e)
          }`
        );
      }
    }

    // VFS の仮想 System を作成
    const system = vfs.createSystem(mapForEnv);

    // ルートファイルのパスを整形
    const rootPaths = (rootFiles || [])
      .map((r) => VfsCore.normalizeVfsPath(r));

    // compilerOptions をマージ
    const defaultOptions = VfsCore.getDefaultCompilerOptions();
    const opts = Object.assign({}, defaultOptions, compilerOptions);

    postLog(
      `createEnvironment: about to create env; roots: [${rootPaths.join(', ')}], `
      + `initialFiles: [${Object.keys(normalizedInitialFiles).join(', ')}], `
      + `opts: ${JSON.stringify(opts)}`
    );

    // 実際の Virtual TS Environment を生成
    const env = vfs.createVirtualTypeScriptEnvironment(
      system,
      rootPaths,
      ts,
      opts
    );

    postLog(`VFS environment created; roots: [${rootPaths.join(', ')}]`);

    // 追加の防御: 必ず sourceFile として適用されるよう同期反映
    for (const [path, content] of Object.entries(normalizedInitialFiles)) {
      try {
        if (env.getSourceFile && env.getSourceFile(path)) {
          env.updateFile(path, content);
        } else {
          env.createFile(path, content);
        }
      } catch (e) {
        postLog(
          `createEnvironment sync apply failed for ${path}: ${
            String(e?.message ?? e)
          }`
        );
      }
    }

    // getProgram を一度走らせて内部状態を確定
    try {
      env.languageService.getProgram();
    } catch (e) {
      postLog(
        `getProgram() failed after env creation: ${String(e?.message ?? e)}`
      );
    }

    return env;
  }

  // -------------------------------------------
  // テスト用リセット
  // -------------------------------------------
  static resetForTest() {
    VfsCore.cachedDefaultMap = null;
    VfsCore.vfsReady = false;
    VfsCore._ensurePromise = null;

    postLog('VfsCore resetForTest() called');
  }
}

// 旧 API 互換の名前付きエクスポート(削除してもよい)
export const VfsCoreAPI = VfsCore;
export const ensureReady = VfsCore.ensureReady;
export const createEnvironment = VfsCore.createEnvironment;
export const resetForTest = VfsCore.resetForTest;
export const getDefaultMap = VfsCore.getDefaultMap;
export const getDefaultCompilerOptions = VfsCore.getDefaultCompilerOptions;
