// test/v0.0.3/phase8-completion-hover.test.js
// Phase 8
//
// 目的:
// - textDocument/completion / hover が initialize 後にエラーなく応答すること
// - 内容は空でよい（経路成立のみを検証）
// - initialize 前は空 or null 応答であること

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 phase8-completion-hover.test loaded');

(async () => {
  const testName = 'phase8: completion / hover minimal path works';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');
    await waitForWorkerReady(worker);

    // --- VFS ready ---
    const ready = await sendRequest(worker, 'vfs/ensureReady');
    expect(ready.ok).to.equal(true);

    const uri = 'file:///test.ts';
    const content = 'const x: number = 1;';

    // --- openFile before initialize ---
    const openResult = await sendRequest(worker, 'vfs/openFile', {
      uri,
      content,
    });
    expect(openResult.ok).to.equal(true);

    // --- completion before initialize ---
    const preInitCompletion = await sendRequest(worker, 'textDocument/completion', {
      textDocument: { uri },
      position: { line: 0, character: 5 },
    });
    expect(preInitCompletion).to.satisfy((v) => v === null || Array.isArray(v) || typeof v === 'object');

    // --- hover before initialize ---
    const preInitHover = await sendRequest(worker, 'textDocument/hover', {
      textDocument: { uri },
      position: { line: 0, character: 5 },
    });
    expect(preInitHover).to.equal(null);

    // --- initialize ---
    const initResult = await sendRequest(worker, 'lsp/initialize', {
      rootUri: null,
      capabilities: {},
    });
    expect(initResult).to.be.an('object');

    // --- completion after initialize ---
    const completion = await sendRequest(worker, 'textDocument/completion', {
      textDocument: { uri },
      position: { line: 0, character: 5 },
    });

    expect(completion).to.be.an('object');
    expect(completion.isIncomplete).to.equal(false);
    expect(completion.items).to.be.an('array');

    // --- hover after initialize ---
    const hover = await sendRequest(worker, 'textDocument/hover', {
      textDocument: { uri },
      position: { line: 0, character: 5 },
    });

    expect(hover).to.be.an('object');
    expect(hover.contents).to.be.an('object');
    expect(hover.contents.value).to.be.a('string');

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
