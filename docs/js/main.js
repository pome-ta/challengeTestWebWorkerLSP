// main.js
import { createWorkerRpc } from './worker-client.js';

(async () => {
  console.log('--- main start ---');
  const rpc = createWorkerRpc('./js/worker.js');

  const init = await rpc.initialize({ processId: null });
  console.log('initialize result:', init);

  rpc.initialized({});
  const pong = await rpc.ping({ msg: 'Hello from main' });
  console.log('ping result:', pong);
  
  const shutdown = await rpc.shutdown();
  console.log('shutdown result:', shutdown);

  // exit 通知+Worker終了
  rpc.exit();
  ///rpc.client.terminate();

  console.log('--- done ---');
})();

