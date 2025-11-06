// test/test-utils.js

export const createTestWorker = (path) => {
  const worker = new Worker(path, {type: 'module'});

  worker.addEventListener('message', (event) => {
    const {data} = event;
    data?.type === 'log' && console.log(`[${new Date().toLocaleTimeString('ja-JP', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })}|WorkerLog] ${data.message}`);
  });

  return worker;
};



