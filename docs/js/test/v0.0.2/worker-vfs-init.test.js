// test/v0.0.2/worker-vfs-init.test.js
// v0.0.2.2

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

(async () => {
  const testName =
    'VFS: vfs/ensureReady should initialize the VFS on first call';
  let worker;
  let logs = [];

  try {
    worker = createTestWorker('./js/worker.js', (log) => logs.push(log));
    await waitForWorkerReady(worker); // 前提条件
    await sendRequest(worker, 'vfs/ensureReady');
    const vfsInitLog = logs.find((log) => log.includes('VFS init attempt'));
    const vfsReadyLog = logs.find((log) => log.includes('defaultMap size'));
    expect(vfsInitLog).to.exist;
    expect(vfsReadyLog).to.exist;
    addResult(testName, true);
  } catch (error) {
    addResult(testName, false, error.message);
  } finally {
    worker?.terminate();
  }
})();
