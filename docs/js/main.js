// main.js (ブラウザ側)

const worker = new Worker('./js/worker.js', { type: 'module' });

worker.onmessage = (ev) => {
  console.log('[main] got:', ev.data);
};

// initialize リクエスト送信
worker.postMessage(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {}
}));

