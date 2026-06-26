import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { LSPClient } from '@codemirror/lsp-client';

import DomFactory from './utils/domFactory.js';

// ==========================================
// 1. UIの構築 (DomFactoryを使用)
// ==========================================
const titleEl = DomFactory.create('h2', {
  textContent: 'p5.js TypeScript Editor',
});
const statusEl = DomFactory.create('div', {
  setAttrs: {
    id: 'status',
  },
  textContent: '⏳ WorkerとTSコンパイラを起動中...',
  setStyles: {
    padding: '10px',
    background: '#e3f2fd',
    color: '#1565c0',
    'margin-bottom': '10px',
    'font-weight': 'bold',
    'border-radius': '4px',
  },
});
const editorContainerEl = DomFactory.create('div', {
  setStyles: {
    border: '1px solid #ccc',
    height: 'calc(100dvh - 100px)',
    background: '#fff',
  },
});

DomFactory.create(document.body, {
  appendChildren: [titleEl, statusEl, editorContainerEl],
});

// ==========================================
// 2. Workerの起動と Transport (通信層) の定義
// ==========================================
const worker = new Worker('./js/worker.js', { type: 'module' });

// codemirror/lsp-client に渡すための極薄の通信アダプター
// Worker とメインスレッド間は「文字列」で通信することが確定しているため、
// 余計な JSON.parse/stringify は行わず、右から左へ受け流します。
const listeners = new Map();
const transport = {
  send(message) {
    // message はすでに JSON 文字列
    worker.postMessage(message);
  },
  subscribe(handler) {
    // worker から受け取った文字列をそのまま handler に渡す
    const listener = (event) => handler(event.data);
    listeners.set(handler, listener);
    worker.addEventListener('message', listener);
  },
  unsubscribe(handler) {
    const listener = listeners.get(handler);
    if (listener) {
      worker.removeEventListener('message', listener);
      listeners.delete(handler);
    }
  },
};

// ==========================================
// 3. LSP Client の初期化
// ==========================================
const client = new LSPClient({
  // 独自ログなどの Notification をここでハンドリングする
  notificationHandlers: {
    'worker/log': (client, params) => {
      console.log(params.timestamp, params.message); // eruda等に出力
      return true; // 処理済みであることを返す
    },
    'worker/ready': (client, params) => {
      statusEl.textContent = '✅ 準備完了！ TypeScript Compiler API が稼働しています。';
      statusEl.style.background = '#e8f5e9';
      statusEl.style.color = '#2e7d32';
      return true;
    },
  },
});

// Transport を接続し、自動的に `initialize` リクエストを Worker に送信開始
client.connect(transport);

// ==========================================
// 4. CodeMirror の起動と LSP プラグインの適用
// ==========================================
const fileUri = 'file:///main.ts';
const initialCode = `function setup() {\n  createCanvas(400, 400);\n}\n`;

const view = new EditorView({
  doc: initialCode,
  extensions: [
    basicSetup,
    javascript({ typescript: true }),
    // LSPClient のプラグインを登録 (これで補完や波線が自動で繋がります)
    client.plugin(fileUri, 'typescript'),
  ],
  parent: editorContainerEl,
});
