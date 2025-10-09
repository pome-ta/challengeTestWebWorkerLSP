// main.js (トップレベル ESM)
// - createWorkerRpc を使った LSP 的なライフサイクルの例
import { createWorkerRpc } from './worker-client.js';

(async () => {
  console.log('--- main start ---');

  // Worker を生成(相対パス)
  const rpc = createWorkerRpc('./js/worker.js');

  // initialize (request: await)
  const init = await rpc.initialize({ processId: null });
  console.log('initialize result:', init);

  // initialized (notification: no await)
  rpc.initialized({});

  // ping (request)
  const pong = await rpc.ping({ msg: 'Hello from main' });
  console.log('ping result:', pong);

  // shutdown (request)
  const shutdown = await rpc.shutdown();
  console.log('shutdown result:', shutdown);

  // exit (notification) --- Worker 側で self.close() を呼び Worker が終了する
  rpc.exit();

  // 以降 client.terminate() を呼ぶ必要はない(Worker が自分で閉じる)
  console.log('--- done ---');
})();
