// test/v0.0.3/phase5-openFile-before-init-no-didOpen.test.js
// v0.0.3.6

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 phase5-openFile-before-init-no-didOpen.test loaded');

(async () => {
  const testName =
    'phase5: openFile before initialize does not emit didOpen';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    await sendRequest(worker, 'vfs/ensureReady');

    await sendRequest(worker, 'vfs/openFile', {
      uri: 'file:///test.ts',
      content: 'const x = 1;',
    });

    const didOpen = await sendRequest(
      worker,
      'lsp/_debug/getLastDidOpen'
    );

    expect(didOpen).to.equal(null);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();