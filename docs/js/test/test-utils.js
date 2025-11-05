// test/test-utils.js

export const createTestWorker = (path) => {
  const worker = new Worker(path, {type: 'module'});

  worker.addEventListener('message', (event) => {
    const {data} = event;
    data?.type === 'log' && console.log(`[WorkerLog] ${data.message}`);
    // if (data?.type === 'log') {
    //   console.log(`[WorkerLog] ${data.message}`);
    // }
  });

  return worker;
};
