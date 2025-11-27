// test/v0.0.2/diag-chain-related.test.js
// v0.0.2.10
import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  waitForNotification,
  addResult,
} from './test-utils.js';

console.log('diag-chain-related.test loaded');

(async () => {
  const testName =
    'Diagnostics flatten (relatedInformation): message chain + related info flatten consistency';

  let worker;

  try {
    worker = createTestWorker('./js/worker.js');

    // 1) bootstrap / initialize
    await waitForWorkerReady(worker);
    await sendRequest(worker, 'vfs/ensureReady');
    await sendRequest(worker, 'lsp/initialize', { capabilities: {} });

    // 2) multi-file setup: helper.ts + entry.ts
    const helperUri = 'file:///helper.ts';
    const helperContent = `
      export type NumBox = { value: number };
    `;
    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: helperUri,
        languageId: 'typescript',
        version: 1,
        text: helperContent,
      },
    });

    const entryUri = 'file:///entry.ts';
    const entryContent = `
      import { NumBox } from "./helper";
      const wrong: NumBox = { value: "oops" };
    `;
    sendNotification(worker, 'textDocument/didOpen', {
      textDocument: {
        uri: entryUri,
        languageId: 'typescript',
        version: 1,
        text: entryContent,
      },
    });

    // 3) Wait for publishDiagnostics for entry.ts
    const published = await waitForNotification(
      worker,
      'textDocument/publishDiagnostics',
      (params) => params.uri === entryUri
    );

    expect(published).to.exist;
    expect(published.diagnostics).to.be.an('array').with.lengthOf.at.least(1);

    const pubDiag = published.diagnostics[0];
    const flattened = pubDiag.message;

    expect(flattened).to.be.a('string');
    expect(flattened).to.include('not assignable');

    // 4) Request raw diagnostics (test-only)
    const rawResult = await sendRequest(worker, 'lsp/_getRawDiagnostics', {
      uri: entryUri,
    });
    expect(rawResult).to.exist;
    expect(rawResult.diagnostics).to.be.an('array');

    const rawDiag = rawResult.diagnostics[0];
    const messageText = rawDiag.messageText;

    const isChain =
      messageText &&
      typeof messageText === 'object' &&
      'messageText' in messageText;

    expect(isChain).to.be.true;

    // 5) relatedInformation must exist
    expect(messageText.relatedInformation).to.exist;
    expect(messageText.relatedInformation).to.be.an('array');
    expect(messageText.relatedInformation.length).to.be.greaterThan(0);

    const related0 = messageText.relatedInformation[0];
    expect(related0).to.have.property('messageText');

    // 6) Validate that the relatedInformation message is included in published flatten
    const relatedMessage = related0.messageText;

    if (typeof relatedMessage === 'string') {
      expect(flattened).to.include(relatedMessage);
    }

    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  } finally {
    worker?.terminate();
  }
})();
