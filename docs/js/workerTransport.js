/**
 * @param {Worker} worker
 * @returns {import("@codemirror/lsp-client").Transport}
 */
export function createWorkerTransport(worker) {
  const subscribers = new Set();
  worker.addEventListener('message', ({ data }) => {
    subscribers.forEach((subscriber) => {
      subscriber(JSON.stringify(data));
    });
  });
  return {
    send(message) {
      worker.postMessage(JSON.parse(message));
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
    },
    unsubscribe(subscriber) {
      subscribers.delete(subscriber);
    },
  };
}
