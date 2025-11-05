// worker.js
// v0.0.0.4


const DEBUG = true;

const log = (msg) => {
  if (DEBUG) self.postMessage({ __workerLog: msg });
};

log('👷 worker.js loaded');



self.addEventListener('message', (event) => {
  const { data } = event;

  if (data === 'ping') {
    log('📡 Received: ping');
    self.postMessage('pong');
  }


  if (data === 'shutdown') {
    log('👋 Worker shutting down...');
    self.postMessage('shutdown-complete');
    self.close(); // ワーカーを終了
  }
});

self.postMessage('ready');

