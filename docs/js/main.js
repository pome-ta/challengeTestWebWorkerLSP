import WorkerClient from './worker-client.js';

(async () => {
  console.log('--- main start ---');

  const client = new WorkerClient('./js/worker.js');
  const initResult = await client.send('initialize', {
    processId: null,
    rootUri: null,
    capabilities: {},
  });

  console.log('initialize result:', initResult);
  console.log('--- done ---');
})();

