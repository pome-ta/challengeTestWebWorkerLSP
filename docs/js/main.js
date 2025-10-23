// --- main.js v0.8

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { autocompletion } from '@codemirror/autocomplete';
import { typescriptLanguage } from '@codemirror/lang-javascript';
import { languageServerExtensions, LSPClient } from '@codemirror/lsp-client';
import { basicSetup } from 'codemirror';

import { createWorkerTransportFactory } from './worker-transport-factory.js';

const { transport } = await createWorkerTransportFactory('./js/worker.js', {
  debug: true,
});
// transport は LSPTransportAdapter -> LSPClient と互換
const client = new LSPClient({
  extensions: languageServerExtensions(),
}).connect(transport);

// Editor 設定
//const initialCode = `// demo\nconst x = 1;\nconsole.log();\nx = 1;\nhoge = 1;\n`;

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
}`

const customTheme = EditorView.theme(
  {
    '&': {
      fontFamily:
        'Consolas, Menlo, Monaco, source-code-pro, Courier New, monospace',
      fontSize: '0.72rem',
    },
  },
  { dark: false }
);

const extensions = [
  basicSetup,
  customTheme,
  typescriptLanguage,
  autocompletion({ activateOnTyping: true }),
  client.plugin('file:///main.ts'),
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

// --- LSP ライフサイクル cleanup
window.addEventListener('beforeunload', () => {
  // beforeunloadでは非同期完了は保証されないため、
  // Request系はawaitせず同期的に発火する。
  try {
    // LSP準拠: shutdown → exit の順
    transport.send({
      jsonrpc: '2.0',
      id: 9999,
      method: 'shutdown',
      params: {},
    });
    transport.send({ jsonrpc: '2.0', method: 'exit' });
  } catch (e) {
    console.warn('[main] LSP shutdown/exit failed', e);
  } finally {
    transport.close?.();
  }
});
