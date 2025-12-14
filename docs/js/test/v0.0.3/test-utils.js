// test/v0.0.2/test-utils.js
// v0.0.2

let requestId = 0;

/**
 * Workerを生成し、ログメッセージをコンソールに出力するリスナーをセットアップします。
 * @param {string} path - Workerスクリプトのパス
 * @returns {Worker}
 */
export const createTestWorker = (path, onLog) => {
  const worker = new Worker(path, {type: 'module'});

  worker.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data?.method === 'worker/log' && data.params?.message) {
      const formatted = `[${
        data.params.timestamp ?? new Date().toISOString()
      } | WorkerLog] ${data.params.message}`;
      console.log(formatted);
      onLog?.(formatted);
    }
  });

  // テスト環境では、デフォルトでデバッグログを有効にする
  worker.postMessage('debug:on');

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
    const timer = setTimeout(() => {
      worker.removeEventListener('message', handler);
      reject(new Error(`Request timeout for method: ${method} (${timeout}ms)`));
    }, timeout);

    const handler = (event) => {
      const response = event.data;
      if (response?.id === id) {
        clearTimeout(timer);
        worker.removeEventListener('message', handler);
        if (response.error) {
          reject(
            new Error(response.error.message || JSON.stringify(response.error))
          );
        } else {
          resolve(response.result);
        }
      }
    };

    worker.addEventListener('message', handler);
    worker.postMessage({jsonrpc: '2.0', id, method, params});
  });
};

/**
 * WorkerにJSON-RPC通知を送信します。レスポンスは待ちません。
 * @param {Worker} worker
 * @param {string} method
 * @param {object} params
 */
export const sendNotification = (worker, method, params = {}) => {
  worker.postMessage({jsonrpc: '2.0', method, params});
};

/**
 * Workerから特定のメソッドの通知が送信されるのを待ちます。
 * @param {Worker} worker
 * @param {string} expectedMethod - 待機する通知のメソッド名
 * @param {(params: any) => boolean} [paramsMatcher] - 通知のparamsが期待通りか判定する関数
 * @param {number} timeout
 * @returns {Promise<any>} 通知の `params` オブジェクト
 */
export const waitForNotification = (
  worker,
  expectedMethod,
  paramsMatcher = () => true, // デフォルトでは常にtrueを返す
  timeout = 5000
) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Timeout waiting for notification: ${expectedMethod} (${timeout}ms)`
          )
        ),
      timeout
    );

    const handler = (event) => {
      const notification = event.data;
      if (
        notification?.method === expectedMethod &&
        paramsMatcher(notification.params)
      ) {
        clearTimeout(timer);
        worker.removeEventListener('message', handler);
        resolve(notification.params);
      }
    };

    worker.addEventListener('message', handler);
  });
};

/**
 * テスト結果をHTMLリストに表示します。
 * @param {string} name - テスト名
 * @param {boolean} passed - 合否
 * @param {string} [details=''] - 詳細メッセージ
 */
export const addResult = (name, passed, details = '') => {
  const resultsList = document.getElementById('testOrdered');
  if (!resultsList) return;

  const li = document.createElement('li');
  const status = passed ? '✅' : '❌';
  const message = passed ? details || 'Passed' : details;
  li.textContent = `${status} ${name}: ${message}`;
  li.style.color = passed ? 'green' : 'red';
  resultsList.appendChild(li);
};
