// test/v0.0.2/worker-vfs-file.test.js
// v0.0.2.6

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  waitForNotification,
  addResult,
} from './test-utils.js';

console.log('🧩 worker-vfs-file.test.js loaded');

(async () => {
  const testName =
    'LSP: should update diagnostics when a file is re-opened with fixes';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');

    // 1. LSPの前提条件をセットアップ
    await waitForWorkerReady(worker);
    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', { capabilities: {} });

    const fileUri = 'file:///test.ts';

    // 2. 最初に、型エラーのあるファイルを開く
    const initialContent = `const x: number = "this is a string";`;
    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: fileUri,
        languageId: 'typescript',
        version: 1,
        text: initialContent,
      },
    });

    // 3. エラーが1件含まれる診断通知が来ることを確認
    const diagnostics1 = await waitForNotification(
      worker,
      'textDocument/publishDiagnostics',
      (params) => params.uri === fileUri
    );
    expect(diagnostics1.diagnostics).to.be.an('array').with.lengthOf(1);
    expect(diagnostics1.diagnostics[0].message).to.include(
      "'string' is not assignable to type 'number'"
    );

    // 4. 次に、エラーを修正した内容で同じファイルを開き直す
    const fixedContent = `const x: number = 123;`;
    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: fileUri,
        languageId: 'typescript',
        version: 2, // versionをインクリメント
        text: fixedContent,
      },
    });

    // 5. エラーが0件になった診断通知が来ることを確認
    const diagnostics2 = await waitForNotification(
      worker,
      'textDocument/publishDiagnostics',
      (params) => params.uri === fileUri
    );
    expect(diagnostics2.diagnostics).to.be.an('array').that.is.empty;

    addResult(testName, true);
  } catch (error) {
    addResult(testName, false, error.message);
  } finally {
    worker?.terminate();
  }
})();
