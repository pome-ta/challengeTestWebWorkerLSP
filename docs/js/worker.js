// worker.js
// v0.0.0.2

console.log('👷 worker.js loaded');

self.onmessage = (event) => {
  if (event.data === 'ping') {
    self.postMessage('pong');
  }
};

self.postMessage('ready');

