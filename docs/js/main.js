// main.js
import { createWorkerRpc } from './worker-client.js';

(async () => {
  console.log('--- main start ---');
  const rpc = createWorkerRpc('./js/worker.js');

  const init = await rpc.initialize({ processId: null });
  console.log('initialize result:', init);

  rpc.initialized({}); // ← notify(応答なし)

  const shutdown = await rpc.shutdown();
  console.log('shutdown result:', shutdown);
  console.log('--- done ---');
})();

