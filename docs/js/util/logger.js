// util/logger.js

let isDebugEnabled = false; // デフォルトを false に変更

/**
 * デバッグモードの有効/無効を切り替えます。
 * @param {boolean} enabled
 */
export const setDebug = (enabled) => {
  isDebugEnabled = !!enabled;
};

export const postLog = (message) =>
  isDebugEnabled &&
  self.postMessage({
    jsonrpc: '2.0',
    method: 'worker/log',
    params: {
      message: `[Worker] ${message}`,
    },
  });
