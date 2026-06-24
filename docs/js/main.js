import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { LSPClient } from '@codemirror/lsp-client';

console.log('[Main] スクリプトの実行を開始しました');

const worker = new Worker(new URL('./worker.js', import.meta.url), {
  type: 'module',
});
worker.addEventListener('error', (err) => {
  console.error('【Worker 死亡エラー】:', err.message);
});

class WorkerTransport {
  constructor(worker) {
    this.worker = worker;
    this.handlers = [];

    // ★修正1: onmessageではなくaddEventListenerを使う＆文字列だけをLSPに渡す
    this.worker.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        for (const handler of this.handlers) {
          handler(event.data);
        }
      }
    });
  }

  send(message) {
    this.worker.postMessage(message);
  }

  subscribe(handler) {
    this.handlers.push(handler);
  }

  unsubscribe(handler) {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }
}

const client = new LSPClient({ timeout: 10000 });

// ★修正2: transport をちゃんとインスタンス化する（これがないと後でエラーになります）
const transport = new WorkerTransport(worker);

worker.addEventListener('message', function readyListener(event) {
  if (event.data && event.data.type === '__ready') {
    console.log('[Main] WorkerのLSP準備完了を確認！通信を開始します。');
    worker.removeEventListener('message', readyListener);

    // ここでエラーなく接続される
    client.connect(transport);
  }
});

// 4. CodeMirrorのエディタを立ち上げる
const state = EditorState.create({
  doc: "console.log('Hello LSP!');",
  extensions: [basicSetup, client.plugin('file:///main.ts', 'typescript')],
});

// ★修正3: DOMがちゃんと取れているかチェック
const editorContainer = document.getElementById('editor-container');
if (!editorContainer) {
  console.error("【致命的エラー】 id='editor-container' の要素が見つかりません！");
} else {
  const view = new EditorView({
    state,
    parent: editorContainer,
  });
  console.log('[Main] CodeMirrorの描画が完了しました');
}
