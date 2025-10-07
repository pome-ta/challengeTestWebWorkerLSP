/**
 * Worker 内の console.log を main スレッドへ転送する。
 * 失敗時は元の console.log にフォールバック。
 */
export function setupConsoleRedirect() {
  const origLog = console.log;

  console.log = (...args) => {
    try {
      self.postMessage(JSON.stringify({ __workerLog: true, args }));
    } catch {
      // stringify 失敗などの安全策
      origLog(...args);
    }
  };
}
