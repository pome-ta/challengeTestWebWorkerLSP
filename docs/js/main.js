import { minimalSetup, basicSetup } from 'codemirror';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightWhitespace,
  lineNumbers,
} from '@codemirror/view';

import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { bracketMatching } from '@codemirror/language';
import { javascriptLanguage } from '@codemirror/lang-javascript';

import { oneDark } from '@codemirror/theme-one-dark';

import { LSPClient, languageServerExtensions } from '@codemirror/lsp-client';

import { createWorkerTransport } from './workerTransport.js';

import DomFactory from './utils/domFactory.js';

/**
 * backGround Rectangle span
 */
const bgRectangleClassName = 'cm-bgRectangle';
const bgRectangleMark = Decoration.mark({ class: bgRectangleClassName });
const bgRectangleTheme = EditorView.baseTheme({
  '.cm-bgRectangle': { backgroundColor: '#121212bb' },
});
const bgRectEffect = {
  add: StateEffect.define({ from: 0, to: 0 }),
  remove: StateEffect.define({ from: 0, to: 0 }),
};

const bgRectangleField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(bgRectangles, tr) {
    bgRectangles = bgRectangles.map(tr.changes);
    for (const ef of tr.effects) {
      if (ef.is(bgRectEffect.add)) {
        bgRectangles = bgRectangles.update({
          add: [bgRectangleMark.range(ef.value.from, ef.value.to)],
        });
      } else if (ef.is(bgRectEffect.remove)) {
        bgRectangles = bgRectangles.update({
          filter: (f, t, value) => !(value.class === bgRectangleClassName),
        });
      }
    }
    return bgRectangles;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function bgRectangleSet(view) {
  const { state, dispatch } = view;
  const { from, to } = state.selection.main.extend(0, state.doc.length);
  if (!from && !to) {
    return;
  }
  const decoSet = state.field(bgRectangleField, false);

  const addFromTO = (from, to) => bgRectEffect.add.of({ from, to });
  const removeFromTO = (from, to) => bgRectEffect.remove.of({ from, to });

  let effects = [];
  effects.push(!decoSet ? StateEffect.appendConfig.of([bgRectangleField]) : null);
  decoSet?.between(from, to, (decoFrom, decoTo) => {
    if (from === decoTo || to === decoFrom) {
      return;
    }
    effects.push(removeFromTO(from, to));
    effects.push(removeFromTO(decoFrom, decoTo));
    effects.push(decoFrom < from ? addFromTO(decoFrom, from) : null);
    effects.push(decoTo > to ? addFromTO(to, decoTo) : null);
  });
  effects.push(addFromTO(from, to));
  if (!effects.length) {
    return false;
  }
  dispatch({ effects: effects.filter((ef) => ef) });
  return true;
}

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

const logHandlers = new Map([
  [1, (msg) => console.error(msg)],
  [2, (msg) => console.warn(msg)],
  [3, (msg) => console.info(msg)],
]);

// ファイルの上部やクラスのプロパティとして定義しておく
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
    //   return true; // デフォルトのハンドラを上書きする
    // },
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
  
  //initTheme,
  transparentTheme,
  //resOutlineTheme,
  //bgRectangleTheme,
  //updateCallback,
  
  client.plugin('file:///main.js'),
  oneDark, // 最後に設定
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
