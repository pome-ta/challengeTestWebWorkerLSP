// worker.js
// v0.0.0.4

const DEBUG = true;

const postLog = (message) => {
  DEBUG && self.postMessage({type: 'log', message});
  // if (DEBUG) {
  //   self.postMessage({ type: 'log', message });
  // }
};

postLog('👷 worker.js loaded');

self.addEventListener('message', (event) => {
  const {data} = event;

  if (data === 'ping') {
    postLog('📡 Received: ping');
    self.postMessage({type: 'response', message: 'pong'});
  }

  if (data === 'shutdown') {
    postLog('👋 Worker shutting down...');
    self.postMessage({type: 'response', message: 'shutdown-complete'});
    self.close();
  }
});

// ready 通知
self.postMessage({type: 'ready'});
