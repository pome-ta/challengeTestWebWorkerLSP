import { createWorkerRpc } from './worker-client.js';

(async () => {
  const rpc = createWorkerRpc('./js/worker.js');

  console.log('--- LSP initialize ---');
  const initResult = await rpc.initialize();
  console.log('initialize result:', initResult);

  rpc.initialized(); // 通知(await 不要)

  console.log('--- Open document ---');
  const textDocument = {
    uri: 'file:///test.ts',
    languageId: 'typescript',
    version: 1,
    text: `function greet(name: string) {
  return 'Hello, ' + name;
}

gre`
  };

  await rpc.send('textDocument/didOpen', { textDocument });
  console.log('didOpen sent');

  console.log('--- Request completion ---');
  const completionResult = await rpc.send('textDocument/completion', {
    textDocument: { uri: textDocument.uri },
    position: { line: 4, character: 3 } // "gre" の直後
  });
  console.log('completion result:', completionResult);

  if (completionResult?.items?.length) {
    console.log('--- Resolve first completion item ---');
    const item = completionResult.items[0];
    const resolved = await rpc.send('completionItem/resolve', item);
    console.log('resolved item:', resolved);
  }

  console.log('--- Diagnostics check ---');
  const diagnostics = await rpc.send('textDocument/diagnostics', {
    textDocument: { uri: textDocument.uri }
  });
  console.log('diagnostics:', diagnostics);

  console.log('--- Ping ---');
  const pingResult = await rpc.send('ping', { msg: 'hello worker' });
  console.log('ping result:', pingResult);

  console.log('--- Shutdown ---');
  const shutdown = await rpc.shutdown();
  console.log('shutdown result:', shutdown);

  console.log('--- Exit ---');
  rpc.notify('exit');
})();

