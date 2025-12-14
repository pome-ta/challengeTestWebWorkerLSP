// test/v0.0.3/vfs-class-singleton.test.js
// v0.0.3.2

import {expect} from 'chai';
import {addResult, createTestWorker, sendRequest, waitForWorkerReady,} from './test-utils.js';

console.log('🧩 vfs-class-singleton.test loaded');

(async () => {
  const testName =
    'VfsCore class: ensure singleton-like defaultMap and env identity';
  let worker;
  try {
    worker = createTestWorker('./js/worker.js');

    await waitForWorkerReady(worker);
    // reset just in case
    await sendRequest(worker, 'vfs/resetForTest');
    await sendRequest(worker, 'vfs/ensureReady');

    const info1 = await sendRequest(worker, 'vfs/_getEnvInfo');
    // call ensureReady again -> should not recreate default map
    await sendRequest(worker, 'vfs/ensureReady');
    const info2 = await sendRequest(worker, 'vfs/_getEnvInfo');

    expect(info1.defaultMapSize).to.be.a('number').that.is.greaterThan(0);
    expect(info1.defaultMapSize).to.equal(info2.defaultMapSize);
    // envId stays the same (or if you prefer, at least fileList identity same)
    expect(info1.envId).to.equal(info2.envId);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
