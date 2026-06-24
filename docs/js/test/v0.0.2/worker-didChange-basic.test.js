// test/v0.0.2/worker-didChange-basic.test.js
// v0.0.2.13

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  waitForNotification,
  addResult,
} from './test-utils.js';

console.log('🧩 worker-didChange-basic.test loaded');

(async () => {
  const testName =
    'LSP: didChange basic full-replace should update diagnostics';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');

    // 1) Worker/TS/VFS 準備
    await waitForWorkerReady(worker);
    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', { capabilities: {} });

    // 2) didOpen: 初期内容はエラー無し
    const fileUri = 'file:///didchange-basic.ts';
    const initialContent = `export const a = 1;`;

    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: fileUri,
        languageId: 'typescript',
        version: 1,
        text: initialContent,
      },
    });

    const initialDiag = await waitForNotification(
      worker,
      'textDocument/publishDiagnostics',
      (p) => p.uri === fileUri
    );

    expect(initialDiag.uri).to.equal(fileUri);
    expect(initialDiag.diagnostics).to.be.an('array').that.is.empty;

    // 3) didChange: full replace でエラーを発生させる内容に変更
    const changedContent = `export const a: number = "bad";`;

    sendNotification(worker, 'textDocument/didChange', {
      textDocument: {
        uri: fileUri,
        version: 2,
      },
      contentChanges: [
        {
          text: changedContent, // full replace
        },
      ],
    });

    // 4) publishDiagnostics (変更後の内容に基づく)
    const changedDiag = await waitForNotification(
      worker,
      'textDocument/publishDiagnostics',
      (p) => p.uri === fileUri
    );

    expect(changedDiag.uri).to.equal(fileUri);
    expect(changedDiag.diagnostics).to.be.an('array').with.lengthOf(1);
    expect(changedDiag.diagnostics[0].message).to.include(
      "Type 'string' is not assignable to type 'number'"
    );

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
