// test/v0.0.2/test-utils.js
// v0.0.2

let requestId = 0;

/**
 * Workerを生成し、ログメッセージをコンソールに出力するリスナーをセットアップします。
 * @param {string} path - Workerスクリプトのパス
 * @returns {Worker}
 */
export const createTestWorker = (path, onLog) => {
  const worker = new Worker(path, { type: 'module' });

  worker.addEventListener('message', (event) => {
    const { method, params } = event.data || {};
    if (method === 'worker/log' && params?.message) {
      const logMessage = `[${new Date().toLocaleTimeString('ja-JP', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      })} | WorkerLog] ${params.message}`;
      console.log(logMessage);
      onLog?.(logMessage);
    }
  });

  return worker;
};

/**
 * Workerが 'worker/ready' 通知を送信するまで待機します。
 * @param {Worker} worker
 * @param {number} timeout
 * @returns {Promise<void>}
 */
export const waitForWorkerReady = (worker, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Worker ready timeout (${timeout}ms)`)),
      timeout
    );

    const handler = (event) => {
      if (event.data?.method === 'worker/ready') {
        clearTimeout(timer);
        worker.removeEventListener('message', handler);
        resolve();
      }
    };

    worker.addEventListener('message', handler);
  });
};

/**
 * WorkerにJSON-RPCリクエストを送信し、対応するレスポンスを待ちます。
 * @param {Worker} worker
 * @param {string} method
 * @param {object} params
 * @param {number} timeout
 * @returns {Promise<any>}
 */
export const sendRequest = (worker, method, params = {}, timeout = 30000) => {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`Request timeout for method: ${method} (${timeout}ms)`)
        ),
      timeout
    );

    const handler = (event) => {
      const response = event.data;
      if (response?.id === id) {
        clearTimeout(timer);
        worker.removeEventListener('message', handler);
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response.result);
        }
      }
    };

    worker.addEventListener('message', handler);
    worker.postMessage({ jsonrpc: '2.0', id, method, params });
  });
};
