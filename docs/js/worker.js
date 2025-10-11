// worker.js (改訂版)

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';




/**
 * send helper - main 側は JSON 文字列を期待する設計に揃えているので stringify する
 */
function _send(obj) {
  try { self.postMessage(JSON.stringify(obj)); }
  catch (e) {
    // 万が一オブジェクトで送れない環境がある場合の保険(通常は不要)
    try { self.postMessage(obj); } catch {}
  }
}

/**
 * LspServerCore - 実仕事 (vfs 初期化 / shutdown / exit / ping など)
 */
class LspServerCore {
  #fsMap = null;    // Map によるファイルコンテンツ(lib 等)
  #system = null;   // vfs system
  #env = null;      // createVirtualTypeScriptEnvironment の戻り(言語サービス等を含む)
  #bootPromise = null;

  constructor() {
  }
  


  // initialize: VFS を初期化して capabilities を返す
  async initialize() {
    await this.#bootVfs();
    return { capabilities: { completionProvider: { resolveProvider: true } } };
  }

  async initialized() {
    console.log('initialized notification received');
  }

  async ping(params) {
    return { echoed: params?.msg ?? '(no message)' };
  }

  // shutdown: release resources (同期的に安全に)
  async shutdown() {
    try {
      // 簡易クリーンアップ。実装次第でより丁寧に。
      if (this.#fsMap && typeof this.#fsMap.clear === 'function') this.#fsMap.clear();
    } catch (e) {
      console.warn('shutdown: error clearing fsMap', e);
    }
    this.#system = null;
    this.#env = null;
    this.#fsMap = null;
    console.log('shutdown completed.');
    return { success: true };
  }

  // exit: notification -> まず shutdown を順守してから閉じたいならここで await shutdown()
  async exit() {
    console.log('exit notification received.');
    // LSP の慣習: クライアントが先に shutdown request を呼び、最後に exit notification を送る。
    // ここでは強制的に self.close() を呼ぶ(クライアント実装に依存)
    try {
      // optionally await this.shutdown(); // もし自動 cleanup が望ましければ有効にする
    } catch (e) {}
    self.close();
  }

  /**
   * 内部: vfs を起動する(同時呼び出しを避けるため #bootPromise を使う)
   */
  async #bootVfs() {
    if (this.#env) return;            // 既に作られているなら早期 return
    if (this.#bootPromise) return this.#bootPromise; // すでに起動中なら待つ

    this.#bootPromise = (async () => {
      // defaultMap には TypeScript の lib *.d.ts が Map で入る
      const defaultMap = await vfs.createDefaultMapFromCDN({ target: ts.ScriptTarget.ES2020 }, ts.version, false, ts);
      // system を作る
      const system = vfs.createSystem(defaultMap);
      // createVirtualTypeScriptEnvironment を使い言語サービス環境を構築する
      const env = vfs.createVirtualTypeScriptEnvironment(system, [], ts, { allowJs: true });

      // 保持
      this.#fsMap = defaultMap;
      this.#system = system;
      this.#env = env;

      console.log('vfs boot completed. TypeScript version:', ts.version);
      return env;
    })();

    try {
      return await this.#bootPromise;
    } finally {
      // boot 完了後は promise をクリアする(将来の二重起動ガードのため)
      this.#bootPromise = null;
    }
  }

  // 将来: 文書同期・補完・diagnostics などのメソッドをここへ実装する(例: didOpen, didChange, completion, resolve...)
}

/**
 * LSPWorker - JSON-RPC のループ / ハンドラディスパッチ担当
 */
class LSPWorker {
  #core;
  #handlers;

  constructor() {
    this.#core = new LspServerCore();
    // 必要に応じてここに 'textDocument/didOpen' などを追加する
    this.#handlers = {
      initialize: this.#core.initialize.bind(this.#core),
      initialized: this.#core.initialized.bind(this.#core),
      shutdown: this.#core.shutdown.bind(this.#core),
      exit: this.#core.exit.bind(this.#core),
      ping: this.#core.ping.bind(this.#core),
      // 'textDocument/didOpen': this.#core.didOpen.bind(this.#core), // 例
    };

    self.onmessage = (event) => this.#handleMessage(event);
  }

  async #handleMessage(event) {
    let msg = event.data;
    try {
      if (typeof msg === 'string') msg = JSON.parse(msg);
      // else: main が既にオブジェクトで送った場合を考慮して受け入れる
    } catch (e) {
      // Parse error -> JSON-RPC の仕様に従い id があればエラー応答
      const raw = event.data;
      console.warn('invalid message (not JSON):', raw);
      // もし id を含む文字列だったら parse error を返す。ここでは文字列かつ parse 失敗なので応答しないのも選択肢
      return;
    }

    // JSON-RPC メッセージが "request/notification/response" のどれかを判定する
    // 我々は主に request/notification を受ける想定なので、'method' の有無で振り分ける
    if (!('method' in msg)) {
      // ここに response が来るべきではない。その場合はログのみ。
      console.warn('received message without method (ignored):', msg);
      return;
    }

    const method = msg.method;
    const isRequest = ('id' in msg) && (msg.id !== null && msg.id !== undefined);

    if (isRequest) {
      await this.#handleRequest(msg);
    } else {
      await this.#handleNotify(msg);
    }
  }

  async #handleRequest(msg) {
    const { id, method, params } = msg;
    const handler = this.#handlers[method];
    if (!handler) {
      // Method not found
      _send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` }});
      return;
    }
    try {
      const result = await handler(params ?? {});
      // result が undefined でも JSON-RPC では result: null ではなく result: undefined は OK だが
      _send({ jsonrpc: '2.0', id, result: result === undefined ? null : result });
    } catch (e) {
      // エラーを標準化して返す
      const err = (e && typeof e === 'object' && 'code' in e && 'message' in e)
        ? e
        : { code: -32000, message: String(e), data: (e && e.stack) ? { stack: e.stack } : undefined };
      _send({ jsonrpc: '2.0', id, error: err });
    }
  }

  async #handleNotify(msg) {
    const { method, params } = msg;
    const handler = this.#handlers[method];
    if (handler) {
      try {
        await handler(params ?? {});
      } catch (e) {
        console.warn(`[worker] notify handler error in ${method}:`, e);
      }
    } else {
      console.log('[notify] unknown method:', method, params ?? '(no params)');
    }
  }
}

// 起動
new LSPWorker();

