// worker.js

// Web Worker内ではimportmapが効かないケースがあるため、直接esm.shからURLでインポートします
import ts from 'https://esm.sh/typescript@5.4.5';
import {
  createDefaultMapFromCDN,
  createSystem,
  createVirtualCompilerHost,
  createVirtualTypeScriptEnvironment,
} from 'https://esm.sh/@typescript/vfs@1.5.0?deps=typescript@5.4.5';

// ==========================================
// 1. 通信ヘルパー (LSP JSON-RPC 2.0 完全準拠)
// ==========================================

// リクエストに対する成功レスポンスを返す
function sendResponse(id, result) {
  self.postMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id,
      result: result,
    }),
  );
}

// リクエストに対するエラーレスポンスを返す
function sendError(id, code, message) {
  self.postMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id,
      error: { code, message },
    }),
  );
}

// 投げっぱなしの通知 (Notification) を送る
function sendNotification(method, params = {}) {
  self.postMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      method: method,
      params: params,
    }),
  );
}

// 独自定義: ログ送信
function postLog(message) {
  sendNotification('worker/log', {
    timestamp: new Date().toLocaleTimeString('ja-JP', {
      hour12: false,
      fractionalSecondDigits: 3,
    }),
    message: `[Worker] ${message}`,
  });
}

// ==========================================
// 2. 状態管理
// ==========================================
let languageService = null;
let updateFile = null;
let isReady = false;

// ==========================================
// 3. VFS と TS Compiler API の初期化
// ==========================================
async function init() {
  postLog('TypeScriptコンパイラを読み込みました！');

  /*
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  };
  */
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    lib: ['ES2022', 'DOM'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowArbitraryExtensions: true,
    allowJs: true,
    checkJs: true,
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
  };

  postLog('📦 標準ライブラリをダウンロード中...');

  // ★ localStorageエラー回避: 第3引数(shouldCache)を false に設定し、ブラウザのHTTPキャッシュに任せる
  const fsMap = await createDefaultMapFromCDN(compilerOptions, ts.version, false, ts);

  postLog('📦 p5.jsの型定義をダウンロード中...');

  const [p5Index, p5Global] = await Promise.all([
    fetch('https://unpkg.com/@types/p5/index.d.ts').then((r) => r.text()),
    fetch('https://unpkg.com/@types/p5/global.d.ts').then((r) => r.text()),
  ]);
  fsMap.set("/node_modules/@types/p5/index.d.ts", p5Index);

fsMap.set("/node_modules/@types/p5/global.d.ts", p5Global);


  // ユーザーが編集するメインファイルを空で登録
  fsMap.set('/main.ts', '');

  // 仮想システムとコンパイラホストの作成
  const system = createSystem(fsMap);
  //const hostConfig = createVirtualCompilerHost(system, compilerOptions, ts);
  postLog([...fsMap.keys()]);
  const env = createVirtualTypeScriptEnvironment(
    system,

    ['/main.ts'],

    ts,

    compilerOptions,
  );

  languageService = env.languageService;

  //updateFile = hostConfig.updateFile;
  //languageService = ts.createLanguageService(languageService);

  isReady = true;
  postLog('✨ 準備完了！');

  // メインスレッドへ準備完了を通知
  sendNotification('worker/ready');
}

init().catch((err) => {
  postLog(`初期化エラー: ${err.message}`);
});

// ==========================================
// 4. メッセージ受信 (LSP サーバーとしての振る舞い)
// ==========================================
self.onmessage = (event) => {
  let msg;
  try {
    // 送られてきた文字列を JSON オブジェクトにパース
    msg = JSON.parse(event.data);
  } catch (e) {
    postLog(`JSON parse error: ${e.message}`);
    return;
  }

  // ------------------------------------------
  // ★ 最重要: initialize リクエストへの応答 (Handshake)
  // これを返さないと LSPClient がタイムアウトエラーを起こす
  // ------------------------------------------
  if (msg.method === 'initialize') {
    sendResponse(msg.id, {
      capabilities: {
        // ドキュメントの同期をフル(ファイル全体)で行うことを宣言: 1 = Full
        textDocumentSync: 1,
        // 補完機能を提供することを宣言
        completionProvider: {
          resolveProvider: false,
          triggerCharacters: ['.'], // 補完を自動トリガーする文字
        },
        // 今後、hoverProvider: true などをここに追加していく
      },
    });
    return;
  }

  // initialize リクエスト以外は、準備が終わるまで処理しない
  if (!isReady) return;

  // ------------------------------------------
  // リクエスト (返事が必要なメッセージ) の処理
  // ------------------------------------------
  if (msg.id !== undefined) {
    if (msg.method === 'textDocument/completion') {
      // TODO: Phase 4 で実装。今回はプレースホルダーとして空を返す
      sendResponse(msg.id, {
        isIncomplete: false,
        items: [],
      });
    } else {
      sendError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }
  // ------------------------------------------
  // 通知 (返事が不要なメッセージ) の処理
  // ------------------------------------------
  else {
    if (msg.method === 'textDocument/didChange') {
      // TODO: Phase 2, 3 で実装。
      // ここで updateFile() を呼び、直後に診断(Diagnostics)をメインスレッドに publish する
    } else if (msg.method === 'textDocument/didOpen') {
      // TODO: 初期コードの受け取り処理
    }
  }
};
