// test/v0.0.3/vfs-openFile.test.js
// v0.0.3.4

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-openFile.test loaded');

(async () => {
  const testName = 'vfs/openFile minimal contract';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    // --- 1. ensureReady 前は失敗する ---
    let errorCaught = false;
    try {
      await sendRequest(worker, 'vfs/openFile', {
        uri: 'file:///test.ts',
        content: 'const x: number = 1;',
      });
    } catch (err) {
      errorCaught = true;
      expect(err.code).to.equal(-32001);
    }

    expect(errorCaught).to.equal(true);

    // --- 2. ensureReady 後は成功する ---
    const readyResult = await sendRequest(worker, 'vfs/ensureReady');
    expect(readyResult.ok).to.equal(true);

    const openResult = await sendRequest(worker, 'vfs/openFile', {
      uri: 'file:///test.ts',
      content: 'const x: number = 1;',
    });

    expect(openResult.ok).to.equal(true);

    // --- 3. 同一 uri は上書き扱い ---
    const overwriteResult = await sendRequest(worker, 'vfs/openFile', {
      uri: 'file:///test.ts',
      content: 'const x: number = 2;',
    });

    expect(overwriteResult.ok).to.equal(true);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
