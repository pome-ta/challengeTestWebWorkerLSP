// test/v0.0.2/worker-lsp-initialize.test.js
// v0.0.2.4

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  addResult,
} from './test-utils.js';

console.log('🧩 worker-lsp-initialize.test.js loaded');

(async () => {
  const testName =
    'LSP: should handle initialize request and return capabilities';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');

    // 1. Workerの準備を待つ
    await waitForWorkerReady(worker);

    // 2. VFSの準備を完了させる (LSP初期化の前提条件)
    await sendRequest(worker, 'vfs/ensureReady');

    // 3. `lsp/initialize` リクエストを送信する
    const initializeParams = {
      processId: 1234,
      rootUri: 'file:///app/',
      capabilities: {}, // クライアントの機能 (今回は空でOK)
    };
    const result = await sendRequest(
      worker,
      'lsp/initialize',
      initializeParams
    );

    // 4. Workerからのレスポンスに `capabilities` が含まれていることを確認する
    expect(result).to.be.an('object');
    expect(result).to.have.property('capabilities');
    expect(result.capabilities).to.be.an('object');

    // serverInfoの存在と構造をチェックする
    expect(result).to.have.property('serverInfo');
    expect(result.serverInfo).to.be.an('object');
    expect(result.serverInfo).to.have.property('name').and.to.be.a('string');

    addResult(testName, true);
  } catch (error) {
    addResult(testName, false, error.message);
  } finally {
    worker?.terminate();
  }
})();
