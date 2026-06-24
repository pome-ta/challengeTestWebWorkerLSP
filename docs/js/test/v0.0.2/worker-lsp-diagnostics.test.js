// test/v0.0.2/worker-lsp-diagnostics.test.js
// v0.0.2.5

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  waitForNotification,
  addResult,
} from './test-utils.js';

console.log('🧩 worker-lsp-diagnostics.test.js loaded');

(async () => {
  const testName =
    'LSP: should receive diagnostics for a file with missing imports';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');

    // 1. LSPの前提条件をセットアップ
    await waitForWorkerReady(worker);
    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', { capabilities: {} });

    // 2. エラーを含むファイルを開いたことを通知 (didOpen)
    const fileUri = 'file:///test.ts';
    const fileContent = `import { a } from './non-existent-file';`;
    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: fileUri,
        languageId: 'typescript',
        version: 1,
        text: fileContent,
      },
    });

    // 3. Workerからエラー通知 (publishDiagnostics) が送られてくるのを待つ
    const diagnosticsParams = await waitForNotification(
      worker,
      'textDocument/publishDiagnostics'
    );

    // 4. 通知の内容を検証
    expect(diagnosticsParams.uri).to.equal(fileUri);
    expect(diagnosticsParams.diagnostics).to.be.an('array').with.lengthOf(1);
    expect(diagnosticsParams.diagnostics[0].message).to.include(
      "Cannot find module './non-existent-file'"
    );

    addResult(testName, true);
  } catch (error) {
    addResult(testName, false, error.message);
  } finally {
    worker?.terminate();
  }
})();
