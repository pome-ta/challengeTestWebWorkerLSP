// test/v0.0.2/worker-lsp-multi-file.test.js
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

console.log('🧩 worker-lsp-multi-file.test.js loaded');

(async () => {
  const testName =
    'LSP: should handle multiple files and resolve imports correctly';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');

    // 1. LSPの前提条件をセットアップ
    await waitForWorkerReady(worker);
    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', { capabilities: {} });

    // 2. 依存関係のある2つのファイルを開く
    // まず、エクスポートする側のファイルを開く
    const file1Uri = 'file:///file1.ts';
    const file1Content = `export const a = 1;`;
    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: file1Uri,
        languageId: 'typescript',
        version: 1,
        text: file1Content,
      },
    });
    // `file1.ts` の診断結果を待つ（エラーがないことを確認）
    const diagnostics1 = await waitForNotification(
      worker,
      'textDocument/publishDiagnostics',
      (params) => params.uri === file1Uri // file1.tsの通知だけを待つ
    );
    expect(diagnostics1.uri).to.equal(file1Uri);
    expect(diagnostics1.diagnostics).to.be.an('array').that.is.empty;

    // 次に、インポートする側のファイルを開く
    const file2Uri = 'file:///file2.ts';
    const file2Content = `import { a } from './file1.ts'; console.log(a);`;
    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: file2Uri,
        languageId: 'typescript',
        version: 1,
        text: file2Content,
      },
    });

    // 3. `file2.ts` の診断結果を待ち、エラーがないことを確認する
    const diagnostics2 = await waitForNotification(
      worker,
      'textDocument/publishDiagnostics',
      (params) => params.uri === file2Uri // file2.tsの通知だけを待つ
    );
    expect(diagnostics2.uri).to.equal(file2Uri);
    expect(diagnostics2.diagnostics).to.be.an('array').that.is.empty;

    addResult(testName, true);
  } catch (error) {
    addResult(testName, false, error.message);
  } finally {
    worker?.terminate();
  }
})();
