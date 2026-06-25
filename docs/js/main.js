import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { linter, lintGutter, forceLinting } from '@codemirror/lint';
import { keymap } from '@codemirror/view';

const worker = new Worker('./js/worker.js', { type: 'module' });
const statusEl = document.getElementById('status');

// ★ イベントリスナーの中で使うために、view(エディタ本体)の変数を先に作っておく
let view;

worker.addEventListener('message', (e) => {
  if (e.data.type === 'ready') {
    statusEl.textContent = '✅ 準備完了! p5.jsの関数に色付き補完とエラー検知が効きます。';
    statusEl.style.background = '#e8f5e9';
    statusEl.style.color = '#2e7d32';

    // ★ 解決策1: 準備完了の合図が来たら、強制的にエディタのエラー(波線)を再計算させる!
    if (view) {
      forceLinting(view);
    }
  }
});

// 1. 補完プロバイダ
async function tsCompletionProvider(context) {
  const code = context.state.doc.toString();
  const cursorPosition = context.pos;
  return new Promise((resolve) => {
    const messageId = Date.now() + Math.random();
    const listener = (event) => {
      if (event.data.type === 'complete' && event.data.id === messageId) {
        worker.removeEventListener('message', listener);
        const completions = event.data.completions?.entries || [];
        resolve({
          from: context.matchBefore(/\w*/)?.from || context.pos,
          options: completions.map((c) => ({
            label: c.name,
            type: c.kind,
          })),
        });
      }
    };
    worker.addEventListener('message', listener);
    worker.postMessage({
      type: 'complete',
      id: messageId,
      code,
      cursorPosition,
    });
  });
}

// 2. エラー波線プロバイダ
const tsLinter = linter(async (view) => {
  const code = view.state.doc.toString();
  return new Promise((resolve) => {
    const messageId = Date.now() + Math.random();
    const listener = (event) => {
      if (event.data.type === 'diagnostics' && event.data.id === messageId) {
        worker.removeEventListener('message', listener);
        resolve(event.data.errors);
      }
    };
    worker.addEventListener('message', listener);
    worker.postMessage({ type: 'diagnostics', id: messageId, code });
  });
});

const initialCode = `function setup() {
  createCanvas(400, 400);
  
}

function draw() {
  background(220);
 
  // ↓ わざと存在しない関数
  notExistFunction();
}
`;

// エディタの起動(変数 view に格納する)
view = new EditorView({
  doc: initialCode,
  extensions: [
    basicSetup,
    javascript({ typescript: true }),

    // ★ 解決策2: 補完の決定をスマホの「改行(Enter)」や「Tab」で出来るように、専用キーマップを明示的に登録
    keymap.of(completionKeymap),

    autocompletion({
      override: [tsCompletionProvider],
      // ★ 解決策2: 補完が出た瞬間に、一番上の候補を自動的に「選択状態」にする
      selectOnOpen: true,
    }),

    lintGutter(),
    tsLinter,
  ],
  parent: document.getElementById('editor-container'),
});
