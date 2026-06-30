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
 * Worker 内部からのログ送信（eruda等での表示用）
 * @param {string} message - 送信するメッセージ
 * @param {number} type - 1:Error, 2:Warning, 3:Info, 4:Log
 */
export function postLog(message, type = 3) {
  try {
    self.postMessage({
      jsonrpc: '2.0',
      method: 'worker/log',
      params: {
        type,
        message: `[${formatTime()}] [Worker] ${message}`,
      },
    });
  } catch (e) {
    // postMessage が例外になっても沈黙
  }
}
