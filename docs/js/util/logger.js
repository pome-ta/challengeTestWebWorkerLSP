let isDebugEnabled = false;

/**
 * デバッグモードの有効/無効を切り替えます。
 * @param {boolean} enabled
 */
export const setDebug = (enabled) => {
  isDebugEnabled = !!enabled;
};

function formatTime() {
  const now = new Date();
  return now.toLocaleTimeString('ja-JP', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

/**
 * Worker 内部からのログ送信
 * - debug モードのときのみ send
 * - payload は JSON-RPC notification 形式
 */
export const postLog = (message) => {
  if (!isDebugEnabled) return;
  try {
    self.postMessage({
      jsonrpc: '2.0',
      method: 'worker/log',
      params: {
        timestamp: formatTime(),
        message: `[Worker] ${message}`,
      },
    });
  } catch (e) {
    // postMessage が例外になっても沈黙（テストの邪魔をしない）
  }
};
