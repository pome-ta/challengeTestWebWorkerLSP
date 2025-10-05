// main.js
const worker = new Worker('./js/worker.js', {type: 'module'});

let nextId = 1;
const pending = new Map();

worker.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);

  if (msg.__workerLog) {
    // Worker の console.log を main 側へリダイレクト
    console.log('[worker]', ...msg.args);
    return;
  }

  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else {
    console.log('[worker raw]', msg);
  }
};

function sendRequest(method, params = {}) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    worker.postMessage(JSON.stringify({jsonrpc: '2.0', id, method, params}));
  });
}

(async () => {
  console.log('--- main start ---');
  const initResult = await sendRequest('initialize', {
    processId: null,
    rootUri: null,
    capabilities: {},
  });
  console.log('initialize result:', initResult);
  console.log('--- done ---');
})();
