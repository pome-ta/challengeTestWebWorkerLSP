// util/logger.js
// v0.0.2.1

const DEBUG = true;

export const postLog = (message) =>
  DEBUG &&
  self.postMessage({
    jsonrpc: '2.0',
    method: 'worker/log',
    params: {
      message: `[Worker] ${message}`,
    },
  });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
