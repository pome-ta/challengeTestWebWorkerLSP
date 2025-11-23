// test/v0.0.2/worker-ready.test.js
// v0.0.2.1

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  addResult,
} from './test-utils.js';

console.log('🧩 worker-ready.test loaded');

(async () => {
  const testName = 'Worker: should send worker/ready notification on startup';
  let worker;
  let logs = [];

  try {
    worker = createTestWorker('./js/worker.js', (log) => logs.push(log));
    await waitForWorkerReady(worker);
    const readyLog = logs.find((log) =>
      log.includes('Worker loaded and ready')
    );
    expect(readyLog).to.exist;
    addResult(testName, true);
  } catch (error) {
    addResult(testName, false, error.message);
  } finally {
    worker?.terminate();
  }
})();
