import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { javascriptLanguage } from '@codemirror/lang-javascript';

import { LSPClient, languageServerExtensions } from '@codemirror/lsp-client';

/**
 * @param {Worker} worker
 * @returns {import("@codemirror/lsp-client").Transport}
 */
function createWorkerTransport(worker) {
  const subscribers = new Set();
  worker.addEventListener('message', ({ data }) => {
    subscribers.forEach((subscriber) => {
      subscriber(JSON.stringify(data));
    });
  });
  return {
    send(message) {
      worker.postMessage(JSON.parse(message));
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
    },
    unsubscribe(subscriber) {
      subscribers.delete(subscriber);
    },
  };
}

const worker = new Worker('./js/lsp-worker/worker.js', {
  type: 'module',
});

const transport = createWorkerTransport(worker);

const logHandlers = new Map([
  [1, (msg) => console.error(msg)],
  [2, (msg) => console.warn(msg)],
  [3, (msg) => console.info(msg)],
]);

// ファイルの上部やクラスのプロパティとして定義しておく
const LOG_LEVEL_MAP = {
  1: 'error',
  2: 'warn',
  3: 'info',
  4: 'log',
};

const client = new LSPClient({
  extensions: languageServerExtensions(),
  notificationHandlers: {
    // // Worker からの window/logMessage を受け取って console に流す
    // 'window/logMessage': (client, { type, message }) => {
    //   (logHandlers.get(type) ?? ((msg) => console.log(`${msg}`)))(`${type}:  ${message}`);
    //   return true;
    // },
    // Worker からの window/logMessage を受け取って console に流す
    'worker/log': (client, { type, message }) => {
      const logType = LOG_LEVEL_MAP[type] ?? 'log';
      console[logType](`${logType} : ${message}`);
      return true;
    },

    // Worker からの window/logMessage を受け取って console に流す
    // 'window/logMessage': (client, params) => {
    //   if (params.type === 1) console.error(`${params.type}:${params.message}`);
    //   else if (params.type === 2) console.warn(`${params.type}:${params.message}`);
    //   else console.log(`${params.type}:${params.message}`);

    //   return true; // デフォルトのハンドラを上書きする
    // },
  },
}).connect(transport);
// @ts-check
const initialCode = `
// Error: 存在しない変数を使用
console.log(notDefinedVar);

// Warning: 宣言したが未使用
const unusedValue = 42;

function test() {
  // Warning: 宣言したが未使用 (ここに波線が出ます)
  const unusedValueuu = 42;
}

// Information: JSDoc コメントからの型推論表示を確認
/**
 * Adds two numbers together.
 * @param {number} a
 * @param {number} b
 */
function add(a, b) {
  return a + b;
}

// Hint: 意図的に '==' を使用 → LSP が "use '===' instead" の提案を出す場合がある
if (1 == '1') {
  console.log('hint test');
}`;

const editor = new EditorView({
  state: EditorState.create({
    doc: initialCode,
    extensions: [basicSetup, javascriptLanguage, client.plugin('file:///main.js')],
  }),
  parent: document.body,
});
