// test/test-utils.js

export const createTestWorker = (path) => {
  const worker = new Worker(path, {type: 'module'});
  
  // vfs 遅延テスト
  worker.postMessage({ type: "__injectTestDelay", value: true });
  //worker.postMessage({ type: "__injectTestDelay", value: false });

  worker.addEventListener('message', (event) => {
    const {data} = event;
    data?.type === 'log' &&
    console.log(
      `[${new Date().toLocaleTimeString('ja-JP', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
      })}|WorkerLog] ${data.message}`
    );
  });

  return worker;
};
