// js/worker-utils.js
/**
 * Worker 内の console.log を main スレッドへ転送するユーティリティ。
 *
 * - Worker 側で console.log(...) を呼ぶと、main 側の onmessage 経由で受け取り、
 *   main 側で通常の console.log として表示されるようにします。
 * - 文字列化に失敗した場合はフォールバックで元の console.log を呼びます。
 *
 * 使い方(worker.js の先頭で呼ぶ):
 *   import { setupConsoleRedirect } from './worker-utils.js';
 *   setupConsoleRedirect();
 */
export function setupConsoleRedirect() {
  const origLog = console.log;
  console.log = (...args) => {
    try {
      // main と同じ形で受け取れるように構造化可能なデータを string にして送る
      self.postMessage(JSON.stringify({ __workerLog: true, args }));
    } catch {
      // stringify などで例外が出た場合は Worker 内でそのままログ
      origLog(...args);
    }
  };
}

