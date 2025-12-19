// test/v0.0.3/vfs-openFile-didOpen.test.js
// v0.0.3.5
//
// 目的:
// - vfs/openFile → lsp/initialize の流れで
//   textDocument/didOpen が「1回」発行されたことを観測する
// - 内容の差分・再送・version 増分は扱わない
// - 観測はテスト専用 debug API に限定する

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 vfs-openFile-didOpen.test loaded');

(async () => {
  const testName =
    'phase4: vfs/openFile before lsp/initialize triggers didOpen on initialize';
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

    // --- didOpen 観測(テスト専用) ---
    const didOpen = await sendRequest(
      worker,
      'lsp/_debug/getLastDidOpen'
    );

    expect(didOpen).to.be.an('object');
    expect(didOpen.uri).to.equal(uri);
    expect(didOpen.text).to.equal(content);
    expect(didOpen.version).to.equal(1);

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
