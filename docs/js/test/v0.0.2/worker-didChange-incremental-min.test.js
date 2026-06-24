// test/v0.0.2/worker-didChange-incremental-min.test.js
// v0.0.2.14

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  waitForNotification,
  addResult,
} from './test-utils.js';

console.log('🧩 worker-didChange-incremental-min.test loaded');

(async () => {
  const testName =
    'LSP: didChange incremental minimal range-update should update diagnostics';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');

    // 1) Worker/VFS/TS 準備
    await waitForWorkerReady(worker);
    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', { capabilities: {} });

    // 2) didOpen: エラー無しの初期ファイル
    const fileUri = 'file:///didchange-incremental-min.ts';
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
    expect(initialDiag.diagnostics).to.be.an('array').that.is.empty;

    // 3) didChange incremental: a = 1 を a = "bad" に部分更新
    //    "1" の部分だけを書き換える最小例
    //
    // 初期行: export const a = 1;
    //                               ↑ 1 は column 17
    //
    // range は UTF-16 index に準拠
    const changeRange = {
      start: { line: 0, character: 17 },
      end: { line: 0, character: 18 }, // "1" の1文字
    };

    sendNotification(worker, 'textDocument/didChange', {
      textDocument: {
        uri: fileUri,
        version: 2,
      },
      contentChanges: [
        {
          range: changeRange,
          text: `"bad"`, // incremental 書き換え
        },
      ],
    });

    // 4) publishDiagnostics を確認
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
