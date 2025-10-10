// main.js (検証用スクリプト)
// - CodeMirror はまだ入れない。LSP レイヤーだけを検証するための簡易フロー。
import { createWorkerRpc } from './worker-client.js';

(async () => {
  console.log('--- main start ---');

  // debug: true にすると send/receive の raw ログが出る
  const rpc = createWorkerRpc('./js/worker.js', { debug: true });

  try {
    // 1) initialize
    const init = await rpc.initialize({ processId: null, rootUri: null, capabilities: {} });
    console.log('initialize result:', init);
    
    // 2) initialized (notification)
    rpc.initialized({});
    console.log('initialized notification sent');

    // 3) ping (request)
    const pong = await rpc.ping({ msg: 'Hello from main' });
    console.log('ping result:', pong);

    // 4) didOpen (notification) - sample file content
    const uri = 'file:///main.ts';
    const text = `// demo\nconst x = 1;\nconsole.\n`;
    rpc.client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescript', version: 1, text } });
    console.log('didOpen sent');

    // small delay to allow worker to register file
    await new Promise(r => setTimeout(r, 200));

    // 5) textDocument/completion (request) at the line with "console." (line 2, character after dot)
    try {
      const completion = await rpc.client.send('textDocument/completion', {
        textDocument: { uri },
        position: { line: 2, character: 'console.'.length } // NOTE: position.character should be number; this is just example
      }, { timeoutMs: 5000 });

      console.log('completion result (raw):', completion);
    } catch (e) {
      console.warn('completion call failed or timed out', e);
    }

    // 6) unknown method -> should return -32601 error
    try {
      await rpc.client.send('doesNotExist', {});
    } catch (err) {
      console.log('expected error for unknown method:', err);
    }

    // 7) shutdown (request)
    const shutdown = await rpc.shutdown();
    console.log('shutdown result:', shutdown);

    // 8) exit (notification) -> worker self.close()
    rpc.exit();
    console.log('exit notification sent');
    

    // Give the worker a short time to print exit log (if it does)
    await new Promise(r => setTimeout(r, 200));
  } catch (err) {
    console.error('main flow error:', err);
  }
  

  console.log('--- main done ---');
})();

