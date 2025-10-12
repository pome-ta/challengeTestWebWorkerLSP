import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { typescriptLanguage } from '@codemirror/lang-javascript';
import { languageServerExtensions, LSPClient } from '@codemirror/lsp-client';
import { basicSetup } from 'codemirror';

import { autocompletion, startCompletion } from '@codemirror/autocomplete';
import { createWorkerTransport } from './worker-transport.js';

const customCompletionKeymap = [{ key: 'Ctrl-.', run: startCompletion }];

const transport = await createWorkerTransport('./js/worker.js');

const client = new LSPClient({
  extensions: languageServerExtensions(),
}).connect(transport);

// console.log(client);

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
  autocompletion(),
  keymap.of(customCompletionKeymap),
  client.plugin('file:///main.ts'),
];

const state = EditorState.create({
  doc: initialCode,
  extensions: extensions,
});

const view = new EditorView({
  state: state,
  parent: document.body,
});

// (async () => {
//   const transport = await createWorkerTransport('./js/worker.js');
//   const client = new LSPClient({ extensions: languageServerExtensions() }).connect(transport);
//
//   new EditorView({
//     extensions: [
//       basicSetup,
//       typescriptLanguage,
//       client.plugin('file:///main.ts'),
//     ],
//     parent: document.getElementById('editor'),
//   });
// })();

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded');
});
