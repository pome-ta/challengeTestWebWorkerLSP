// --- main.js v0.1
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { autocompletion } from '@codemirror/autocomplete';
import { typescriptLanguage } from '@codemirror/lang-javascript';
import { languageServerExtensions, LSPClient } from '@codemirror/lsp-client';
import { basicSetup } from 'codemirror';

import { createWorkerClient } from './worker-client.js';

// Worker クライアントの初期化
const workerClient = await createWorkerClient('./js/worker.js', {debug:true});

// LSPClient を生成して接続
const client = new LSPClient({
  extensions: languageServerExtensions(),
}).connect(workerClient.transport);

// Editor 設定
const initialCode = `// demo\nconst x = 1;\nconsole.\n`;

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
});


// cleanup on unload
window.addEventListener('beforeunload', async (ev) => {
  try {
    await workerClient.shutdown();
    workerClient.exit();
  } catch (e) {
    // ignore
  } finally {
    workerClient.close();
  }
});
