// core/vfs-core.js
// v0.0.2.1

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';
import { postLog, sleep } from '../util/logger.js';

// design.md: VFSのMapを保持し共用
let cachedDefaultMap = null;
let vfsReady = false;

/**
 * CDNからTypeScriptのデフォルトライブラリファイルを取得し、VFS用のMapを生成します。
 * ネットワークエラーやタイムアウト時にリトライ処理を行います。
 * @param {number} retryCount - リトライ回数
 * @param {number} perAttemptTimeoutMs - 各試行のタイムアウト時間 (ミリ秒)
 * @returns {Promise<Map<string, string>>}
 */
async function createDefaultMapWithRetries(
  retryCount = 3,
  perAttemptTimeoutMs = 5000
) {
  let lastError = null;

  for (let attempt = 1; attempt <= retryCount; attempt++) {
    postLog(`🔄 VFS init attempt ${attempt}/${retryCount}`);
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), perAttemptTimeoutMs)
      );

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
        timeout,
      ]);

      postLog(`📦 defaultMap size: ${defaultMap.size}`);
      return defaultMap;
    } catch (error) {
      lastError = error;
      if (
        error.message.includes('fetch') ||
        error.message.includes('NetworkError')
      ) {
        postLog(`🚫 Network error: ${error.message}`);
        throw error;
      } else if (error.message.includes('timeout')) {
        postLog(`⏰ Timeout, retrying...`);
        await sleep(1000 * attempt);
        continue;
      } else {
        postLog(`❌ Unknown error: ${error.message}`);
        throw error;
      }
    }
  }
  throw lastError || new Error('VFS init failed after retries');
}

export const VfsCore = {
  isReady: () => vfsReady,
  getDefaultMap: () => cachedDefaultMap,
  ensureReady: async () => {
    if (cachedDefaultMap) {
      postLog('📦 Using existing cachedDefaultMap');
    } else {
      cachedDefaultMap = await createDefaultMapWithRetries(3);
    }
    vfsReady = true;
  },
};
