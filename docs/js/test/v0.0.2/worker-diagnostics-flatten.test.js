// test/v0.0.2/worker-diagnostics-flatten.test.js
// v0.0.2.8

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  waitForNotification,
  addResult,
} from './test-utils.js';
import ts from 'https://esm.sh/typescript';

(async () => {
  const testName = 'Diagnostics flatten: TS DiagnosticMessageChain -> LSP message string';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');

    await waitForWorkerReady(worker);
    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', { capabilities: {} });

    // 1) まずチェーンを発生させ得る TypeScript コードを用意する
    //    例(型に関するチェーン的な詳細が出るケースを想定)
    const fileUri = 'file:///diag-chain.ts';
    // 内容は TS が詳細チェーンを返すようなものを選ぶ(例: generic constraints mismatch)
    const fileContent = `
      type A<T extends { x: number }> = T;
      // この次の行で、T の制約と一致しない型を使ってエラーを発生させる
      const v: A<{ x: string }> = { x: "bad" };
    `;

    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: { uri: fileUri, languageId: 'typescript', version: 1, text: fileContent }
    });

    // 2) publishDiagnostics を待つ
    const params = await waitForNotification(worker, 'textDocument/publishDiagnostics', p => p.uri === fileUri);

    // 3) 検証
    expect(params).to.have.property('diagnostics').that.is.an('array').and.is.not.empty;

    // 4) 追加検証: 生成された LSP diagnostics の message と ts.flattenDiagnosticMessageText の一致
    //    この検証は worker 内で変換に使っている diag オブジェクト (raw TS diag) を直接比較できない可能性があるので、
    //    精密検査用に Worker 側に raw diag text を返すテストフラグを追加するか、
    //    またはメッセージが期待する部分文字列を含むか確認する。
    const lspMessages = params.diagnostics.map(d => d.message);
    // 期待: 何らかのチェーン的メッセージが flatten されている(改行を含む)
    const hasNewline = lspMessages.some(m => typeof m === 'string' && m.includes('\n'));
    expect(hasNewline).to.be.true;

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
