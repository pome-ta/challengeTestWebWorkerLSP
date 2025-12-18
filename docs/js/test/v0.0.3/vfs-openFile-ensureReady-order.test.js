// test/v0.0.3/vfs-openFile-ensureReady-order.test.js
// v0.0.3.4

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-openFile-ensureReady-order.test loaded');

(async () => {
  const testName = 'vfs/openFile before ensureReady does not reinitialize envId';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    // --- 初期 envId 取得 ---
    const envBefore = await sendRequest(worker, 'vfs/getEnvInfo');
    const envIdBefore = envBefore.envId;

    // --- openFile (ensureReady 前なので失敗する想定) ---
    try {
      await sendRequest(worker, 'vfs/openFile', {
        uri: 'file:///test.ts',
        content: 'const x: number = 1;',
      });
    } catch (err) {
      expect(err.code).to.equal(-32001);
    }

    // --- ensureReady 実行 ---
    const readyResult = await sendRequest(worker, 'vfs/ensureReady');
    expect(readyResult.ok).to.equal(true);

    // --- ensureReady 後の envId 取得 ---
    const envAfter = await sendRequest(worker, 'vfs/getEnvInfo');
    const envIdAfter = envAfter.envId;

    // --- envId は変化しない ---
    expect(envIdAfter).to.equal(envIdBefore);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
