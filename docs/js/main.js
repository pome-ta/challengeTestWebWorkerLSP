import { createWorkerRpc } from './worker-client.js';

(async () => {
  console.log('--- main start ---');

  const rpc = createWorkerRpc('./js/worker.js');

  const init = await rpc.initialize({
    processId: null,
    rootUri: null,
    capabilities: {},
  });

  console.log('initialize result:', init);

  await rpc.initialized({});

  const shutdown = await rpc.shutdown();
  console.log('shutdown result:', shutdown);

  console.log('--- done ---');
})();
