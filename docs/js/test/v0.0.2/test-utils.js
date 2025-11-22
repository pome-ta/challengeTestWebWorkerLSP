// test/v0.0.2/test-utils.js
// v0.0.2

export const createTestWorker = (path) => {
  const worker = new Worker(path, { type: 'module' });

  worker.addEventListener('message', (event) => {
    const { data } = event;
    data?.type === 'log' &&
      console.log(
        `[${new Date().toLocaleTimeString('ja-JP', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          fractionalSecondDigits: 3,
        })} | WorkerLog] ${data.message}`
      );
  });

  return worker;
};

export const waitForWorkerReady = (worker, timeout = 30000) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Worker Init Timeout (${timeout * 0.001}s)`)),
      timeout
    );

    const handler = (event) => {
      const { type, message } = event.data || {};
      if (type === 'response' && message === 'vfs-ready') {
        clearTimeout(timer);
        worker.removeEventListener('message', handler);
        resolve();
      } else if (type === 'error') {
        clearTimeout(timer);
        worker.removeEventListener('message', handler);
        reject(new Error(message));
      }
    };

    worker.addEventListener('message', handler);
    worker.postMessage('initialize'); // ハンドシェイク開始
  });
};
