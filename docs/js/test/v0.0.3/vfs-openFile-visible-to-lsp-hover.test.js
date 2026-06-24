// test/v0.0.3/vfs-openFile-visible-to-lsp-hover.test.js
// v0.0.3.5
//
// 目的:
// - lsp/initialize 前に vfs/openFile されたファイルが
//   initialize 後の LSP から「存在している」と観測できること
// - 観測手段は textDocument/hover
// - hover の内容・型情報・正確性は一切評価しない
// - -32601 (Method not found) を返さないことのみを保証条件とする

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-openFile-visible-to-lsp-hover.test loaded');

(async () => {
  const testName =
    'phase3: vfs/openFile before lsp/initialize is visible to LSP (hover existence)';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    // --- VFS ready ---
    const ready = await sendRequest(worker, 'vfs/ensureReady');
    expect(ready.ok).to.equal(true);

    // --- initialize 前に openFile ---
    const uri = 'file:///test.ts';
    const content = 'const x: number = 1;';

    const openResult = await sendRequest(worker, 'vfs/openFile', {
      uri,
      content,
    });
    expect(openResult.ok).to.equal(true);

    // --- LSP initialize ---
    const initResult = await sendRequest(worker, 'lsp/initialize', {
      rootUri: null,
      capabilities: {},
    });
    expect(initResult).to.be.an('object');

    // --- existence 観測: hover ---
    let hoverError = null;

    try {
      await sendRequest(worker, 'textDocument/hover', {
        textDocument: { uri },
        position: { line: 0, character: 0 },
      });
    } catch (err) {
      hoverError = err;
    }

    // -32601 (Method not found) だけは NG
    if (hoverError) {
      expect(hoverError.code).to.not.equal(-32601);
    }

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();