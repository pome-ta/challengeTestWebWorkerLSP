// worker.js
// v0.0.0.3

console.log('👷 worker.js loaded');

self.addEventListener('message', (event) => {
  const { data } = event;

  if (data === 'ping') {
    self.postMessage('pong');
  }


  if (data === 'shutdown') {
    console.log('👋 Worker shutting down...');
    self.postMessage('shutdown-complete');
    self.close(); // ワーカーを終了
  }
});

self.postMessage('ready');

