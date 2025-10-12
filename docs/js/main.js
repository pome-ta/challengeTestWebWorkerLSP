import {EditorState,} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {typescriptLanguage} from '@codemirror/lang-javascript';

import {languageServerExtensions, LSPClient} from '@codemirror/lsp-client';

import {basicSetup} from 'codemirror';



const initialCode = `// demo\nconst x = 1;\nconsole.\n`;


const customTheme = EditorView.theme(
  {
    '&': {
      fontFamily: 'Consolas, Menlo, Monaco, source-code-pro, Courier New, monospace',
      fontSize: '0.72rem',
    },
  },
  { dark: false, },
);

const extensions = [
  basicSetup,
  customTheme,
  typescriptLanguage,
];

const state = EditorState.create({
  doc: initialCode,
  extensions: extensions,
});

const view = new EditorView({
  state: state,
  parent: document.body,
});



document.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded');
});
