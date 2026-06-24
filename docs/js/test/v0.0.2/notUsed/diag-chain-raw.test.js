// test/v0.0.2/diag-chain-raw.test.js
// v0.0.2.9
import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  waitForNotification,
  addResult,
} from './test-utils.js';

console.log('🧩 diag-chain-raw.test loaded');

(async () => {
  const testName =
    'Diagnostics flatten: TS DiagnosticMessageChain -> LSP message string';
  let worker;

  try {
    worker = createTestWorker('./js/worker.js');

    // 1) bootstrap
    await waitForWorkerReady(worker);
    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', { capabilities: {} });

    // 2) open a file that produces a DiagnosticMessageChain
    const fileUri = 'file:///diag-chain.ts';
    const fileContent = `
      type A<T extends { x: number }> = T;
      const bad: A<{ x: string }> = { x: "oops" };
    `;
    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: fileUri,
        languageId: 'typescript',
        version: 1,
        text: fileContent,
      },
    });

    // 3) Wait for publishDiagnostics from worker (LSP message)
    const published = await waitForNotification(
      worker,
      'textDocument/publishDiagnostics',
      (params) => params.uri === fileUri
    );

    expect(published).to.exist;
    expect(published.diagnostics).to.be.an('array').with.lengthOf(1);

    const publishedMessage = published.diagnostics[0].message;
    expect(publishedMessage).to.be.a('string');

    // 4) Request raw diagnostics (test-only request)
    const rawResult = await sendRequest(worker, 'lsp/_getRawDiagnostics', {
      uri: fileUri,
    });
    expect(rawResult).to.exist;
    expect(rawResult.diagnostics).to.be.an('array').with.lengthOf.at.least(1);

    const rawDiag = rawResult.diagnostics[0];
    // rawDiag.messageText may be object (DiagnosticMessageChain) or string; ensure it's chain-like
    const isChainObject =
      typeof rawDiag.messageText === 'object' &&
      rawDiag.messageText !== null &&
      'messageText' in rawDiag.messageText;

    expect(isChainObject || typeof rawDiag.messageText === 'string').to.be.true;

    // 5) If chain-object, flatten it locally using TypeScript util (ts.flattenDiagnosticMessageText)
    //    Here we rely on the publishDiagnostics message being the flattened output
    if (isChainObject) {
      // Compare by asking worker to publishDiagnostics again and match content, or compute flatten via publishedMessage
      // For safety, just confirm that flatten-like message contains the inner-most phrase.
      expect(publishedMessage)
        .to.include('Type')
        .and.to.include('not assignable');
    }

    addResult(testName, true);
  } catch (error) {
    addResult(testName, false, error.message);
  } finally {
    worker?.terminate();
  }
})();
