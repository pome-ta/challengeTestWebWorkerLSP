// test/v0.0.3/vfs-openFile.test.js
// v0.0.3.3

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-openFile.test loaded');

(async () => {
  const testName = 'VfsCore openFile: basic create test';
  let worker;
  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    await sendRequest(worker, 'vfs/resetForTest');
    await sendRequest(worker, 'vfs/ensureReady');

    // 1. openFile を呼ぶ
    const filePath = '/src/foo.ts';
    const fileContent = 'export const x = 1;';
    const result = await sendRequest(worker, 'vfs/openFile', {
      path: filePath,
      content: fileContent,
    });

    // 2. openFile の基本仕様チェック
    expect(result.ok).to.equal(true);
    expect(result.path).to.equal(filePath);

    // 3. _getFile メソッドで内容確認
    const stored = await sendRequest(worker, 'vfs/_getFile', {
      path: filePath,
    });

    expect(stored.path).to.equal(filePath);
    expect(stored.content).to.equal(fileContent);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
