// --- main.js v0.9

import {EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {autocompletion} from '@codemirror/autocomplete';
import {typescriptLanguage} from '@codemirror/lang-javascript';
import {languageServerExtensions, LSPClient} from '@codemirror/lsp-client';

import {basicSetup} from 'codemirror';

import {createWorkerTransportFactory} from './client/worker-transport-factory.js';

const {transport} = await createWorkerTransportFactory(
  './js/server/worker.js',
  {
    waitForReady: true, // サーバーの準備完了通知(__ready)を待つ
    debug: true,
  }
);

// transport は LSPTransportAdapter -> LSPClient と互換
const client = new LSPClient({
  extensions: languageServerExtensions(),
}).connect(transport);

// Editor 設定

const initialCode = `// @ts-check

// Error: 存在しない変数を使用
console.log(notDefinedVar);

// Warning: 宣言したが未使用
const unusedValue = 42;

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

const customTheme = EditorView.theme(
  {
    '&': {
      fontFamily:
        'Consolas, Menlo, Monaco, source-code-pro, Courier New, monospace',
      fontSize: '0.72rem',
    },
  },
  {dark: false}
);

const extensions = [
  basicSetup,
  customTheme,
  typescriptLanguage,
  autocompletion({activateOnTyping: true}),
  client.plugin('file:///main.js'),
  //oneDark,
];

const state = EditorState.create({
  doc: initialCode,
  extensions,
});

const view = new EditorView({
  state,
  parent: document.body,
  // "wheel" イベントリスナーを passive として登録するように CodeMirror に指示し、
  // パフォーマンスに関するコンソールの警告を抑制します。
  // see: https://github.com/codemirror/view/blob/main/src/editorview.ts#L135
  // dispatch: (tr, view) => {
  //   view.update([tr]);
  // },
});

/**
 * LSPサーバーのクリーンアップ処理。
 * ページが非表示になる、または閉じられる際に呼び出される。
 */
const cleanupLsp = () => {
  // 非同期完了は保証されないため、Request系はawaitせず同期的に発火する。
  try {
    // LSP準拠: shutdown → exit の順
    transport.send({
      jsonrpc: '2.0',
      id: 9999,
      method: 'shutdown',
    });
    transport.send({jsonrpc: '2.0', method: 'exit'});
  } catch (e) {
    console.warn('[main] LSP shutdown/exit failed', e);
  } finally {
    transport.close?.();
  }
};

// --- LSP ライフサイクル cleanup ---
// モバイルでは beforeunload の信頼性が低いため、複数のイベントをリッスンする
window.addEventListener('beforeunload', cleanupLsp);
window.addEventListener('pagehide', cleanupLsp);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // cleanupLsp(); // バックグラウンド移行時に毎回終了させたい場合はこちらも有効にする
  }
});
