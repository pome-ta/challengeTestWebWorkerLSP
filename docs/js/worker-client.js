// worker-client.js v0.4
// Worker(JSON-RPC風) とやり取りする簡易クライアントラッパー。

import {
  createWorkerTransport,
  LSPTransportAdapter,
} from './worker-transport.js';

/** このクライアントが送信するリクエストIDの接頭辞 */
const CLIENT_ID_PREFIX = 'wc:';

/**
 * Web WorkerとJSON-RPC風の通信を行うためのクライアントクラス。
 * リクエストとレスポンスの対応付け、タイムアウト処理、LSPライフサイクルメソッドの呼び出しを管理する。
 *
 * @internal
 * @class WorkerClientImpl
 */
class WorkerClientImpl {
  /** @type {import('./worker-transport.js').WorkerTransport} - 通信の基盤となるTransportインスタンス */
  #transport;
  /** @type {number} - リクエストIDを生成するためのシーケンス番号 */
  #seq = 1;
  /** @type {Map<string, {resolve: Function, reject: Function}>} - 送信済みで応答待ちのリクエストを保持するマップ */
  #pending = new Map();
  /** @type {boolean} - デバッグモードの有効/無効フラグ */
  #debug = false;
  /** @type {Function | null} - Transportからメッセージを受け取るためのハンドラ */
  #messageHandler = null;

  /**
   * @param {object} options
   * @param {import('./worker-transport.js').WorkerTransport} options.transport - 通信に使用するTransportインスタンス。
   * @param {boolean} [options.debug=false] - デバッグモードを有効にするか。
   */
  constructor({ transport, debug = false }) {
    this.#transport = transport;
    this.#debug = !!debug;
    this.#messageHandler = this.#onMessage.bind(this);
    // Transportからのメッセージを、JSON文字列ではなく生のオブジェクトとして受け取るように購読する。
    this.#transport.subscribe(this.#messageHandler, { format: 'raw' });
    this.#debug &&
      console.debug('[WorkerClient] attached to transport', this.#transport);
  }

  /**
   * Transportからメッセージを受信したときに呼び出されるハンドラ。
   * @param {object} raw - Workerから受信したメッセージオブジェクト。
   */
  #onMessage(raw) {
    this.#debug && console.debug('[WorkerClient] onmessage:', raw);
    if (!raw || typeof raw !== 'object') {
      this.#debug &&
        console.debug(
          '[WorkerClient] received invalid message (not an object)'
        );
      return;
    }

    // このクライアント自身が送信したリクエストへの応答を処理する
    if (
      'id' in raw &&
      typeof raw.id === 'string' &&
      raw.id.startsWith(CLIENT_ID_PREFIX)
    ) {
      const pend = this.#pending.get(raw.id);
      // 応答に対応するリクエストが見つからない場合（タイムアウト後など）
      if (!pend) {
        this.#debug &&
          console.warn(
            // ワーニングなので console.warn は維持
            '[WorkerClient] response for unknown own id:',
            raw.id,
            raw
          );
        return;
      }

      pend.timeoutId && clearTimeout(pend.timeoutId);
      this.#pending.delete(raw.id);

      // エラー応答か、成功応答かを判断してPromiseを解決する
      if ('error' in raw && raw.error) {
        pend.reject(raw.error);
      } else {
        pend.resolve(raw.result);
      }
      // Workerからの通知（Notification）を処理する（現在はログ出力のみ）
    } else if ('method' in raw) {
      this.#debug &&
        console.debug('[WorkerClient] notification received (ignored):', raw);
      // 他のクライアント（例: @codemirror/lsp-client）への応答を処理する（無視）
    } else if ('id' in raw) {
      this.#debug &&
        console.debug(
          '[WorkerClient] ignoring response for external id:',
          raw.id
        );
      // 上記のいずれにも当てはまらない、未知の形式のメッセージ
    } else {
      this.#debug &&
        console.debug('[WorkerClient] received unknown message shape:', raw);
    }
  }

  /**
   * Workerにリクエストを送信し、その応答を待つ。
   * @param {string} method - 呼び出すメソッド名。
   * @param {object} [params={}] - メソッドに渡すパラメータ。
   * @param {object} [opts={}] - オプション。
   * @param {number} [opts.timeoutMs=10000] - タイムアウト時間（ミリ秒）。
   * @returns {Promise<any>} Workerからの応答結果を解決するPromise。
   */
  async send(method, params = {}, opts = {}) {
    const timeoutMs =
      typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 10000;
    const msg = {
      jsonrpc: '2.0',
      id: `${CLIENT_ID_PREFIX}${this.#seq++}`,
      method,
      params,
    };

    try {
      // 1. ワーカーからの応答を待つPromise
      const responsePromise = new Promise((resolve, reject) => {
        this.#pending.set(msg.id, { resolve, reject });
      });

      // 2. タイムアウト用のPromise
      const timeoutPromise = new Promise((_, reject) => {
        if (timeoutMs > 0) {
          setTimeout(
            () =>
              reject({
                code: -32000, // 独自エラーコード
                message: `Request '${method}' timed out after ${timeoutMs}ms`,
              }),
            timeoutMs
          );
        }
      });

      // メッセージを送信
      this.#transport.send(msg);
      this.#debug && console.debug('[WorkerClient] sent', msg);

      // 応答とタイムアウトを競わせる
      return await Promise.race([responsePromise, timeoutPromise]);
    } finally {
      // 成功、失敗、タイムアウトに関わらず、保留中マップから削除する
      this.#pending.delete(msg.id);
    }
  }

  /**
   * Workerに通知（Notification）を送信する。応答は待たない。
   * @param {string} method - 呼び出すメソッド名。
   * @param {object} [params={}] - メソッドに渡すパラメータ。
   */
  notify(method, params = {}) {
    const msg = { jsonrpc: '2.0', method, params };
    try {
      this.#transport.send(msg);
    } catch (e) {
      this.#debug && console.warn('[WorkerClient] notify send failed:', e);
    }
  }

  /**
   * `initialize`リクエストを送信する。
   * @param {object} [params={}] - initializeパラメータ。
   * @returns {Promise<any>}
   */
  async initialize(params = {}) {
    return await this.send('initialize', params);
  }

  /**
   * `initialized`通知を送信する。
   */
  initialized() {
    this.notify('initialized', {});
  }

  /**
   * `shutdown`リクエストを送信する。
   * @returns {Promise<any>}
   */
  async shutdown() {
    return await this.send('shutdown', {});
  }

  /**
   * `exit`通知を送信する。
   */
  exit() {
    this.notify('exit', {});
  }

  /**
   * 疎通確認用の`ping`リクエストを送信する。
   * @param {string} [msg='ping'] - 送信するメッセージ。
   * @returns {Promise<any>}
   */
  async ping(msg = 'ping') {
    return await this.send('ping', { msg });
  }

  /**
   * クライアントを閉じてリソースを解放する。
   */
  close() {
    // 保留中のすべてのリクエストを reject してリソースリークを防ぐ
    for (const [_id, pend] of this.#pending) {
      pend.timeoutId && clearTimeout(pend.timeoutId);
      // エラーコード -32001 は独自定義: Client is closing
      pend.reject({ code: -32001, message: 'WorkerClient is closing.' });
    }
    this.#pending.clear();

    try {
      // Transportの購読を解除し、Workerを終了させる
      this.#transport.unsubscribe(this.#messageHandler);
      this.#transport.close?.();
    } catch (e) {
      this.#debug && console.warn('[WorkerClient] close failed:', e);
    }
    this.#debug && console.debug('[WorkerClient] closed');
  }

  /**
   * `@codemirror/lsp-client` と互換性のあるTransportアダプタを返す。
   * @returns {LSPTransportAdapter}
   */
  get transport() {
    return new LSPTransportAdapter(this.#transport);
  }
}

/**
 * WorkerClientのインスタンスを非同期で生成するファクトリ関数。
 * @export
 * @param {string} workerUrl - Web WorkerのスクリプトURL。
 * @param {object} [options={}] - オプション。
 * @param {boolean} [options.debug=false] - デバッグモードを有効にするか。
 * @returns {Promise<WorkerClientImpl>}
 */
export async function createWorkerClient(workerUrl, options = {}) {
  const { debug = false } = options;
  const transport = await createWorkerTransport(workerUrl, debug);
  const client = new WorkerClientImpl({ transport, debug });

  debug && console.debug('[createWorkerClient] initialized');
  return client;
}
