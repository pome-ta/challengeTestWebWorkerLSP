// test/v0.0.2/worker-vfs-cached-init.test.js
// v0.0.2.3

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 worker-vfs-cached-init.test.js loaded');

(async () => {
  const testName = 'VFS: vfs/ensureReady should use cache on second call';
  let worker;
  let logs = [];

  try {
    worker = createTestWorker('./js/worker.js', (log) => logs.push(log));
    await waitForWorkerReady(worker); // 前提条件
    await sendRequest(worker, 'vfs/ensureReady'); // 1回目の呼び出し

    logs = []; // ログをリセットして2回目の呼び出しをテスト
    await sendRequest(worker, 'vfs/ensureReady'); // 2回目の呼び出し
    const cachedLog = logs.find((log) =>
      log.includes('Using existing cachedDefaultMap')
    );
    expect(cachedLog).to.exist;
    addResult(testName, true);
  } catch (error) {
    addResult(testName, false, error.message);
  } finally {
    worker?.terminate();
  }
})();
