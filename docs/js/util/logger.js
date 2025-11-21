// util/logger.js
// v0.0.2.1

export const postLog = (msg) => {
  self.postMessage({ type: 'log', message: msg });
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

