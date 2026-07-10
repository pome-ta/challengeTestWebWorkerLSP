import { minimalSetup, basicSetup } from 'codemirror';
import { Compartment, EditorState, StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightWhitespace,
  lineNumbers,
  ViewPlugin,
} from '@codemirror/view';

import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { bracketMatching } from '@codemirror/language';
import { javascriptLanguage } from '@codemirror/lang-javascript';

import { oneDark } from '@codemirror/theme-one-dark';

import { LSPClient, languageServerExtensions } from '@codemirror/lsp-client';

import { createWorkerTransport } from './workerTransport.js';

import DomFactory from './utils/domFactory.js';

/**
 * Code Background Block span
 */
const codeBgBlockClassName = 'cm-code-background-block';
const codeBgBlockMark = Decoration.mark({
  class: codeBgBlockClassName,
});
const codeBackgroundBlockTheme = EditorView.baseTheme({
  [`.${codeBgBlockClassName}`]: { backgroundColor: '#121212bb' },
});

function buildCodeBgDecorations(view) {
  const builder = new RangeSetBuilder();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      line.length ? builder.add(line.from, line.to, codeBgBlockMark) : null;
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const codeBackgroundBlockPlugin = ViewPlugin.fromClass(
  class {
    decorations;
    constructor(view) {
      this.decorations = buildCodeBgDecorations(view);
    }
    update(update) {
      if (!update.docChanged && !update.viewportChanged) {
        return;
      }
      this.decorations = buildCodeBgDecorations(update.view);
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

// todo: 今後の外出し用として`export`
export const codeBackgroundBlock = () => [codeBackgroundBlockPlugin, codeBackgroundBlockTheme];

// note: 配列渡しであれば、そのまま記載
//       関数渡しだと`codeBackgroundBlock()` と記載
// export const codeBackgroundBlock = [
//   codeBackgroundBlockPlugin,
//   codeBackgroundBlockTheme,
// ];

const resOutlineTheme = EditorView.baseTheme({
  '&.cm-editor': {
    '&.cm-focused': {
      outline: '0px dotted #212121',
    },
  },
});

const chalky = '#e5c07b',
  coral = '#e06c75',
  cyan = '#56b6c2',
  invalid = '#ffffff',
  ivory = '#abb2bf',
  stone = '#7d8799', // Brightened compared to original to increase contrast
  malibu = '#61afef',
  sage = '#98c379',
  whiskey = '#d19a66',
  violet = '#c678dd',
  darkBackground = '#2c313a80', // 元は、`highlightBackground` の色
  highlightBackground = '#282c3480', // 元は、`darkBackground` の色
  background = '#282c3400',
  tooltipBackground = '#353a42',
  selection = '#528bff80',
  // selection = '#ff00ff',
  // cursor = '#528bff';
  //cursor = '#fff';
  cursor = '#f0f';

const transparentTheme = EditorView.theme(
  {
    '&': {
      color: ivory,
      backgroundColor: background,
    },
    '.cm-content': {
      caretColor: cursor,
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: cursor },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: selection,
    },
    '.cm-panels': { backgroundColor: darkBackground, color: ivory },
    '.cm-panels.cm-panels-top': { borderBottom: '2px solid black' },
    '.cm-panels.cm-panels-bottom': { borderTop: '2px solid black' },
    '.cm-searchMatch': {
      backgroundColor: '#72a1ff59',
      outline: '1px solid #457dff',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: '#6199ff2f',
    },
    '.cm-activeLine': { backgroundColor: highlightBackground },
    '.cm-selectionMatch': { backgroundColor: '#aafe661a' },
    '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: '#bad0f847',
      // outline: '1px solid #515a6b',
      outline: '1px solid #aa5a6b',
    },
    '.cm-gutters': {
      backgroundColor: background,
      color: stone,
      border: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: highlightBackground,
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'transparent',
      border: 'none',
      color: '#ddd',
    },
    '.cm-tooltip': {
      border: 'none',
      backgroundColor: tooltipBackground,
    },
    '.cm-tooltip .cm-tooltip-arrow:before': {
      borderTopColor: 'transparent',
      borderBottomColor: 'transparent',
    },
    '.cm-tooltip .cm-tooltip-arrow:after': {
      borderTopColor: tooltipBackground,
      borderBottomColor: tooltipBackground,
    },
    '.cm-tooltip-autocomplete': {
      '& > ul > li[aria-selected]': {
        backgroundColor: highlightBackground,
        color: ivory,
      },
    },
  },
  { dark: true },
);

const updateCallback = EditorView.updateListener.of((update) => update.docChanged && bgRectangleSet(update.view));

const initTheme = EditorView.theme({
  '&': {
    fontSize: '0.72rem', //fontSize: '1rem',
    backgroundColor: background,
  },
  '.cm-scroller': {
    fontFamily: 'Consolas, Menlo, Monaco, source-code-pro, Courier New, monospace',
  },

  '.cm-line': {
    padding: '0 1px',
  },

  '&.cm-editor': {
    '&.cm-focused': {
      outline: '0px dotted #21212100',
    },
  },

  // `highlightWhitespace` 調整
  '.cm-highlightSpace': {
    backgroundImage: 'radial-gradient(circle at 50% 55%, #ababab 4%, transparent 24%)',
    opacity: 0.2,
  },
});

const tabSize = new Compartment();

const worker = new Worker('./js/lsp-worker/worker.js', {
  type: 'module',
});

const transport = createWorkerTransport(worker);

const LOG_LEVEL_MAP = {
  1: 'error',
  2: 'warn',
  3: 'info',
  4: 'log',
};

const LOG_ICON_MAP = {
  1: '🔴',
  2: '🟧',
  3: '🔵',
  4: '⬛',
};

const client = new LSPClient({
  extensions: languageServerExtensions(),
  notificationHandlers: {
    // Worker からの worker/log を受け取って console に流す
    'worker/log': (client, { type, message }) => {
      const logType = LOG_LEVEL_MAP[type] ?? 'log';
      console[logType](`${LOG_ICON_MAP[type]} : ${message}`);
      return true;
    },
  },
}).connect(transport);

/* --- load Source */
async function insertFetchDoc(filePath) {
  const fetchFilePath = async (path) => {
    const res = await fetch(path);
    return await res.text();
  };
  return await fetchFilePath(filePath);
}

const mainSketch = './sketchBooks/mainSketch.js';
const codeFilePath = mainSketch;

const initializeSetup = [
  minimalSetup,
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightActiveLine(),
  highlightWhitespace(),
  autocompletion(),
  closeBrackets(),
  bracketMatching(),
  EditorView.lineWrapping, // 改行
  tabSize.of(EditorState.tabSize.of(2)),
  javascriptLanguage,

  initTheme,
  transparentTheme,
  resOutlineTheme,
  codeBackgroundBlock(),

  client.plugin('file:///main.js'),
  //oneDark, // 最後に設定
];

/* --- editor(View) */
const editorDiv = DomFactory.create('div', {
  setAttrs: {
    id: 'editor-div',
  },
  setStyles: {
    width: '100%',
  },
});

const createEditorView = (editorDiv, doc = '', customSetup = null) => {
  const extensions = customSetup === null ? initializeSetup : customSetup;
  const state = EditorState.create({
    doc: doc,
    extensions: extensions,
  });
  const editorView = new EditorView({
    state: state,
    parent: editorDiv,
  });
  return editorView;
};

const editor = createEditorView(editorDiv);
//console.log(new URL(mainSketch))

const setLayout = () => {
  const rootMain = DomFactory.create('div', {
    setAttrs: {
      id: 'rootMain',
    },
    setStyles: {
      //display: 'grid',
      //'grid-template-rows': 'auto 1fr auto',
      //'grid-template-rows': 'auto',
      height: '100%',
      overflow: 'auto',
    },
    appendChildren: [editorDiv],
  });

  document.body.appendChild(rootMain);
};

document.addEventListener('DOMContentLoaded', () => {
  setLayout();
  insertFetchDoc(codeFilePath).then((loadedSource) => {
    // todo: 事前に`doc` が存在するなら、`doc` 以降にテキストを挿入
    editor.dispatch({
      changes: { from: editor.state?.doc.length, insert: loadedSource },
    });
  });
});
/*
const editor = new EditorView({
  state: EditorState.create({
    doc: initialCode,
    extensions: [basicSetup, javascriptLanguage, client.plugin('file:///main.js')],
  }),
  parent: document.body,
});
*/
