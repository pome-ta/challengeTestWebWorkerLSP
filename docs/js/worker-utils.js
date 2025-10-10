// js/worker-utils.js
/**
 * setupConsoleRedirect()
 * Worker 内での console.log 等を main 側に転送するユーティリティ。
 * - main 側は event.data を JSON.parse して受け取る前提(文字列で転送)
 * - 転送できない場合は元の console を使用する(フォールバック)
 *
 * 使い方:
 *   import { setupConsoleRedirect } from './worker-utils.js';
 *   setupConsoleRedirect();
 */
export function setupConsoleRedirect() {
  // 保存
  const orig = {
    log: console.log,
    warn: console.warn,
    info: console.info,
    error: console.error,
  };

  function safePost(obj) {
    try {
      self.postMessage(JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  function makeRedirect(fnName) {
    return (...args) => {
      const payload = { __workerLog: true, level: fnName, args };
      if (!safePost(payload)) {
        // 転送に失敗したら通常のコンソールへ
        orig[fnName].apply(console, args);
      }
    };
  }

  console.log = makeRedirect('log');
  console.info = makeRedirect('info');
  console.warn = makeRedirect('warn');
  console.error = makeRedirect('error');
}
