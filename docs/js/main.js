// main.js
import {EditorState} from '@codemirror/state';
import {EditorView, highlightWhitespace} from '@codemirror/view';

import { LSPClient } from '@codemirror/lsp-client';

import {basicSetup} from 'codemirror';

import { createWorkerRpc } from './worker-client.js';



const view = new EditorView({
  state: EditorState.create({
    doc: '',
    extensions: [basicSetup, ],
  }),
  parent: document.body,
});

// Worker + LSPClient の接続
const rpc = createWorkerRpc('./js/worker.js');

const lsp = new LSPClient({
  send: (method, params) => rpc.client.send(method, params),
  serverCapabilities: {}, // 初期は空
});

// LSPClient を EditorView に登録
view.dispatch({
  effects: EditorView.appendConfig.of([lsp.extension]),
});




/*
(async () => {
  console.log('--- main start ---');

  // Worker を生成(相対パス)
  const rpc = createWorkerRpc('./js/worker.js');

  // initialize (request: await)
  const init = await rpc.initialize({ processId: null });
  console.log('initialize result:', init);

  // initialized (notification: no await)
  rpc.initialized({});

  // ping (request)
  const pong = await rpc.ping({ msg: 'Hello from main' });
  console.log('ping result:', pong);
  //const result = await rpc.client.send('unknownMethod');
  console.log('--- --- ---');
  
  try {
    const bad = await rpc.client.send('doesNotExist');
    console.log('bad result:', bad);
  } catch (e) {
    console.error('bad call error:', e);
  }

  // shutdown (request)
  const shutdown = await rpc.shutdown();
  console.log('shutdown result:', shutdown);

  // exit (notification) --- Worker 側で self.close() を呼び Worker が終了する
  rpc.exit();

  // 以降 client.terminate() を呼ぶ必要はない(Worker が自分で閉じる)
  console.log('--- done ---');
})();
*/
