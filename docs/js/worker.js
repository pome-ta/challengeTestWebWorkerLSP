// js/worker.js

import { setupConsoleRedirect } from './worker-utils.js';

import * as vfs from 'https://esm.sh/@typescript/vfs';
import ts from 'https://esm.sh/typescript';

setupConsoleRedirect();
console.log('[worker] console redirected OK');

/**
 * LspServerCore
 * - TypeScript / vfs の初期化・シャットダウンなどの実処理を持つクラス
 */
class LspServerCore {
  #fsMap;
  #system;
  #env;

  constructor() {
    this.#fsMap = null;
    this.#system = null;
    this.#env = null;
  }

  /**
   * initialize: VFS を初期化して capabilities を返す
   * @returns {{capabilities: object}}
   */
  async initialize() {
    await this.#bootVfs();
    return {
      capabilities: {
        completionProvider: { resolveProvider: true },
      },
    };
  }

  /**
   * initialized (notification)
   * - initialized 通知を受けた時に行いたいことがあればここに追加
   */
  async initialized() {
    console.log('[worker] initialized notification received');
  }

  /**
   * ping: 簡易ヘルスチェック / echo
   * @param {{msg?: string}} params
   * @returns {{echoed: string}}
   */
  async ping(params) {
    return { echoed: params?.msg ?? '(no message)' };
  }

  
  async shutdown() {
    // 仮想FS をクリアし、参照解放
    try {
      this.#fsMap?.clear();
    } catch (e) {
      console.warn('[worker] shutdown: error clearing fsMap', e);
    }
    this.#system = null;
    this.#env = null;

    console.log('[worker] shutdown completed.');
    return { success: true };
  }

  /**
   * exit: notification(応答不要) → Worker 自己終了
   * - LSP 仕様に従い、サーバーが自分で終了する実装。
   * - exit は通知なのでクライアントは何も返ってこない。
   */
  async exit() {
    console.log('[worker] exit notification received. closing worker...');
    // 重要: self.close() は現在の Worker スレッドを終了する(非同期で即時)
    // この呼び出し以降 Worker 内のコードは実行されなくなります
    self.close();
  }
  
  /**
   * LSP: textDocument/completion の簡易実装
   * params: { textDocument: { uri }, position: { line, character } }
   */
  async completion(params) {
    const { textDocument, position } = params;
    const line = position.line;
    const ch = position.character;

    // 簡易例: 現在の行の文字列を取得して補完候補を作る
    const prefix = (textDocument.content?.[line] || '').slice(0, ch);

    // 仮の候補
    const items = [
      { label: 'console', kind: 3 },
      { label: 'const', kind: 14 },
      { label: 'let', kind: 14 },
      { label: 'function', kind: 3 },
    ].filter(i => i.label.startsWith(prefix));

    return { isIncomplete: false, items };
  }

  /**
   * #bootVfs: @typescript/vfs を使って仮想環境を構築する内部メソッド
   */
  async #bootVfs() {
    if (this.#fsMap) return;

    // CDN から TypeScript の lib を取得して仮想ファイルシステムを構築
    const fsMap = new Map();
    const env = await vfs.createDefaultMapFromCDN(
      { target: ts.ScriptTarget.ES2020 },
      ts.version,
      false,
      ts
    );

    // Map の key/value を fsMap にコピー
    env.forEach((v, k) => fsMap.set(k, v));
    this.#system = vfs.createSystem(fsMap);
    this.#fsMap = fsMap;
    this.#env = env;

    console.log(`[worker] vfs boot completed. TypeScript version: ${ts.version}`);
  }
}


class LSPWorker {
  #core;
  #handlers;

  constructor() {
    this.#core = new LspServerCore();

    // メソッド名 -> ハンドラ(this.#core のメソッド) を登録
    this.#handlers = {
      initialize: this.#core.initialize.bind(this.#core),
      initialized: this.#core.initialized.bind(this.#core),
      shutdown: this.#core.shutdown.bind(this.#core),
      exit: this.#core.exit.bind(this.#core),
      ping: this.#core.ping.bind(this.#core),
      'textDocument/completion': this.#core.completion.bind(this.#core),
    };

    // Worker の onmessage を設定(メインスレッドからの受信)
    self.onmessage = (event) => this.#handleMessage(event);
  }

  async #handleMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      console.warn('[worker] invalid message (not JSON):', event.data);
      return;
    }

    if (msg.id) {
      await this.#handleRequest(msg);
    } else {
      await this.#handleNotify(msg);
    }
  }

  // request (id がある) の処理
  async #handleRequest(msg) {
    const { id, method } = msg;
    const handler = this.#handlers[method];

    if (!handler) {
      this.#respondError(id, { code: -32601, message: `Method not found: ${method}` });
      return;
    }

    try {
      const result = await handler(msg.params || {});
      this.#respond(id, result);
    } catch (e) {
      this.#respondError(id, { code: -32000, message: String(e) });
    }
  }

  // notification (id がない) の処理
  async #handleNotify(msg) {
    const { method, params } = msg;
    const handler = this.#handlers[method];

    if (handler) {
      try {
        // 通知なので戻り値は返さない(LSP の notify)
        await handler(params || {});
      } catch (e) {
        console.warn(`[worker] notify handler error in ${method}:`, e);
      }
    } else {
      console.log('[worker notify] unknown method:', method, params ?? '(no params)');
    }
  }

  // JSON-RPC 形式で結果を返す(request のみ)
  #respond(id, result) {
    self.postMessage(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }


  
  #respondError(id, error) {
    const standardized = {
      code: typeof error.code === 'number' ? error.code : -32000, // Server error (default)
      message: String(error.message ?? error),
    };
    if (error.data !== undefined) standardized.data = error.data;

    self.postMessage(JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: standardized,
    }));
  }
}

// 起動
new LSPWorker();

