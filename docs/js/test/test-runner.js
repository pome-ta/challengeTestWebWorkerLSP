// test/test-runner.js
// v0.0.0.4


console.log('🚀 test-runner.js loaded');

// Worker ログ中継のための共通関数
export const createTestWorker = (path) => {
  const worker = new Worker(path, { type: 'module' });

  worker.addEventListener('message', (event) => {
    const { data } = event;
    if (data && data.__workerLog) {
      console.log(`[WorkerLog] ${data.__workerLog}`);
    }
  });

  return worker;
};




import './worker-init.test.js';
//import './worker-ping.test.js';
//import './worker-shutdown.test.js';



