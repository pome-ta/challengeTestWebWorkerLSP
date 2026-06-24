import ts from 'https://esm.sh/typescript';

console.log('[Worker] TypeScriptコンパイラを読み込みました！');

const files = new Map();
files.set('/main.ts', '');

// TSのホスト環境（仮想ファイルシステム）
const languageServiceHost = {
  getScriptFileNames: () => Array.from(files.keys()),
  getScriptVersion: () => Date.now().toString(),
  getScriptSnapshot: (fileName) => {
    if (!files.has(fileName)) return undefined;
    return ts.ScriptSnapshot.fromString(files.get(fileName));
  },
  getCurrentDirectory: () => '/',
  getCompilationSettings: () => ({
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    // ★ 読み込む標準ライブラリを明記
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  }),
  getDefaultLibFileName: () => 'lib.d.ts',
  fileExists: (fileName) => files.has(fileName),
  readFile: (fileName) => files.get(fileName),
};

const languageService = ts.createLanguageService(languageServiceHost);

// ==========================================
// ★ 外部ライブラリ (p5.js) + 標準ライブラリ (DOM等) の型定義を取得
// ==========================================
async function loadTypes() {
  console.log('[Worker] 📦 型定義（p5.js + 標準ライブラリ）をダウンロード中...');
  try {
    // TypeScriptのバージョンに合わせて、unpkgから標準ライブラリをフェッチする
    // ※今回は簡略化のため、ESNext系の基本とDOMだけを取得します
    const tsVersion = ts.version;

    const [p5Index, p5Global, domTypes, esTypes] = await Promise.all([
      // p5.js の型
      fetch('https://unpkg.com/@types/p5/index.d.ts').then((r) => r.text()),
      fetch('https://unpkg.com/@types/p5/global.d.ts').then((r) => r.text()),
      // ★ TS公式の DOM 型定義 (window, console, document 等)
      fetch(`https://unpkg.com/typescript@${tsVersion}/lib/lib.dom.d.ts`).then((r) => r.text()),
      // ★ TS公式の ES 基本型定義 (Array, String, Math 等)
      fetch(`https://unpkg.com/typescript@${tsVersion}/lib/lib.es2022.d.ts`).then((r) => r.text()),
    ]);

    files.set('/p5.d.ts', p5Index);
    files.set('/p5.global.d.ts', p5Global);
    // ★ 仮想ファイルシステムに標準ライブラリを登録
    files.set('lib.dom.d.ts', domTypes);
    files.set('lib.es2022.d.ts', esTypes);

    console.log('[Worker] ✨ 型定義ロード完了！');
    self.postMessage({ type: 'ready' });
  } catch (e) {
    console.error('[Worker] 型定義の取得に失敗しました', e);
  }
}
loadTypes();

// --- 以下、onmessage の処理はそのまま ---
self.onmessage = (e) => {
  const { type, id, code, cursorPosition } = e.data;

  if (code !== undefined) {
    files.set('/main.ts', code);
  }

  // ① 補完リストの要求
  if (type === 'complete') {
    const completions = languageService.getCompletionsAtPosition('/main.ts', cursorPosition, {});
    self.postMessage({ type: 'complete', id, completions });
  }

  // ② 赤い波線（エラー検知）の要求
  else if (type === 'diagnostics') {
    const syntactic = languageService.getSyntacticDiagnostics('/main.ts');
    const semantic = languageService.getSemanticDiagnostics('/main.ts');
    const allDiagnostics = [...syntactic, ...semantic];

    const errors = allDiagnostics.map((diag) => ({
      from: diag.start,
      to: diag.start + diag.length,
      message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
      severity: diag.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
    }));

    self.postMessage({ type: 'diagnostics', id, errors });
  }
};
