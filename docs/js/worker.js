// worker.js (ESM Worker)
//
// この Worker は JSON-RPC 形式でメッセージを受け取り、
// `initialize` リクエストに応答して TypeScript VFS を初期化する。
// まだ didOpen や completion などは実装していない。

import * as vfs from 'https://esm.sh/@typescript/vfs';
import tsModule from 'https://esm.sh/typescript';

/**
 * LSP 風の Worker 実装
 * - JSON-RPC の initialize リクエストを受け付ける
 * - @typescript/vfs を boot して capabilities を返す
 */
class LspWorker {
  constructor() {
    // メッセージハンドラを登録
    self.onmessage = (ev) => this.onMessage(ev);
  }

  /**
   * メインのメッセージディスパッチャ
   * @param {MessageEvent} ev - 受信したメッセージイベント
   */
  async onMessage(ev) {
    const msg = JSON.parse(ev.data);

    // JSON-RPC のリクエスト (id があるもの) のみ処理
    if (!msg.id) {
      return; // 通知は未対応
    }

    if (msg.method === 'initialize') {
      await this.handleInitialize(msg);
    } else {
      this.respondError(msg.id, { code: -32601, message: 'Method not found' });
    }
  }

  /**
   * initialize リクエストを処理する
   * - VFS を初期化して、サーバーの capabilities を返す
   * @param {object} msg - JSON-RPC リクエストオブジェクト
   */
  async handleInitialize(msg) {
    // TypeScript VFS を初期化
    const fsMap = vfs.createDefaultMapFromNodeModules({ ts: tsModule });
    const system = vfs.createSystem(fsMap);
    const host = vfs.createVirtualTypeScriptEnvironment(system, ['index.ts'], tsModule);

    // 今後 didOpen や completion で利用するために保持
    this.vfsEnv = host;

    // JSON-RPC レスポンス送信
    this.respond(msg.id, {
      capabilities: {
        completionProvider: { resolveProvider: true }
      }
    });
  }

  /**
   * JSON-RPC の正常レスポンスを送信
   * @param {number|string} id - 対応するリクエストの ID
   * @param {any} result - レスポンスの結果
   */
  respond(id, result) {
    self.postMessage(JSON.stringify({
      jsonrpc: '2.0',
      id,
      result
    }));
  }

  /**
   * JSON-RPC のエラーレスポンスを送信
   * @param {number|string} id - 対応するリクエストの ID
   * @param {{code:number,message:string}} error - エラーオブジェクト
   */
  respondError(id, error) {
    self.postMessage(JSON.stringify({
      jsonrpc: '2.0',
      id,
      error
    }));
  }
}

// エントリーポイント: Worker インスタンスを生成
new LspWorker();

