// worker-transport-factory.js v0.8
// createWorkerTransportFactory(workerUrl, options)
//  - WorkerTransport を生成して返すファクトリ (transport専用)
//  - ID発行 / pending管理 は行わない（LSPClient 側で行う）
//  - Worker の起動完了を示す "__ready" 通知を待つオプション有り
//
// 期待される依存:
//   - export function createWorkerTransport(workerUrl, debug) from './worker-transport.js'
//   - export class LSPTransportAdapter from './worker-transport.js'
//
// 使い方例:
//   const { transport, rawTransport, worker } = await createWorkerTransportFactory('./js/worker.js', { debug:true, readyTimeout:3000 });
//   // transport は LSPClient に渡す (adapter済み)
//   // rawTransport は生の WorkerTransport (subscribe(..., {format:'raw'} ) などで使える)

import {
  createWorkerTransport,
  LSPTransportAdapter,
} from '../shared/worker-transport.js';

/**
 * createWorkerTransportFactory
 * @param {string} workerUrl - Worker スクリプトの URL (module)
 * @param {{ debug?: boolean, readyTimeout?: number, waitForReady?: boolean }} options
 * @returns {Promise<{ transport: LSPTransportAdapter, rawTransport: any, worker: Worker }>}
 */
export async function createWorkerTransportFactory(workerUrl, options = {}) {
  const { debug = false, readyTimeout = 3000, waitForReady = true } = options;

  // 1) create the underlying transport (which will spawn the Worker)
  const rawTransport = await createWorkerTransport(workerUrl, debug);
  const adapter = new LSPTransportAdapter(rawTransport);

  // 2) Optionally wait for a "__ready" notification from the worker.
  //    This is *not* required by the LSP protocol but helps avoid race conditions
  //    where the worker takes time to bootstrap dependencies (e.g. @typescript/vfs).
  //    The worker must postMessage({ method: '__ready' }) (object form) when ready.
  if (waitForReady) {
    await _awaitWorkerReady(rawTransport.worker, {
      debug,
      timeoutMs: readyTimeout,
    });
  } else {
    if (debug) console.debug('[worker-transport-factory] skip waitForReady');
  }

  if (debug)
    console.debug('[worker-transport-factory] transport ready', { workerUrl });

  return { transport: adapter, rawTransport, worker: rawTransport.worker };
}

/**
 * 内部ユーティリティ: Worker からの "ready" シグナルを待つ。
 * - メッセージ形式はオブジェクトで { method: '__ready', ... } を想定。
 * - タイムアウト時は resolve してノンブロッキングに続行（デフォルト動作）。
 *
 * @param {Worker} worker
 * @param {{ debug?: boolean, timeoutMs?: number }} opts
 * @returns {Promise<void>}
 */
function _awaitWorkerReady(worker, opts = {}) {
  const { debug = false, timeoutMs = 3000 } = opts;

  return new Promise((resolve) => {
    if (!worker) {
      if (debug)
        console.debug(
          '[worker-transport-factory] no worker instance; skipping ready wait'
        );
      resolve();
      return;
    }

    let done = false;
    const onMessage = (ev) => {
      try {
        const data = ev.data;
        // Accept object shape { method: "__ready" } OR { __ready: true } to be tolerant
        if (data && (data.method === '__ready' || data.__ready === true)) {
          if (debug)
            console.debug(
              '[worker-transport-factory] received __ready from worker'
            );
          cleanup();
          resolve();
        }
      } catch (e) {
        // ignore parse errors here
      }
    };

    const onTimeout = () => {
      if (done) return;
      done = true;
      worker.removeEventListener('message', onMessage);
      if (debug)
        console.warn(
          '[worker-transport-factory] worker ready timeout, proceeding anyway'
        );
      resolve();
    };

    const cleanup = () => {
      if (done) return;
      done = true;
      worker.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };

    worker.addEventListener('message', onMessage);

    const timer = timeoutMs > 0 ? setTimeout(onTimeout, timeoutMs) : null;
  });
}
