// test/v0.0.2/worker-vfs-init.test.js
// v0.0.2.1

import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
} from './test-utils.js';

const resultsList = document.getElementById('testOrdered');

const addResult = (name, passed, details = '') => {
  const li = document.createElement('li');
  const status = passed ? '✅' : '❌';
  li.textContent = `${status} ${name}: ${details}`;
  li.style.color = passed ? 'green' : 'red';
  resultsList.appendChild(li);
};

const runTests = async () => {
  let worker;

  try {
    // --- Test 1: Worker Ready Handshake ---
    const test1Name = 'Worker Ready Handshake';
    let logs = [];
    worker = createTestWorker('../../js/worker.js', (log) => logs.push(log));

    await waitForWorkerReady(worker);
    /*
    const readyLog = logs.find((log) => log.includes('Worker loaded and ready'));
    addResult(
      test1Name,
      !!readyLog,
      'Worker should send worker/ready notification on startup.'
    );
    

    // --- Test 2: VFS Initialization ---
    const test2Name = 'VFS Initialization';
    logs = [];
    await sendRequest(worker, 'vfs/ensureReady');
    const vfsInitLog = logs.find((log) => log.includes('VFS init attempt'));
    const vfsReadyLog = logs.find((log) => log.includes('defaultMap size'));
    addResult(
      test2Name,
      !!vfsInitLog && !!vfsReadyLog,
      'vfs/ensureReady should initialize the VFS.'
    );

    // --- Test 3: VFS Cached Initialization ---
    const test3Name = 'VFS Cached Initialization';
    logs = [];
    await sendRequest(worker, 'vfs/ensureReady');
    const cachedLog = logs.find((log) =>
      log.includes('Using existing cachedDefaultMap')
    );
    addResult(
      test3Name,
      !!cachedLog,
      'Calling vfs/ensureReady again should use the cache.'
    );
    */
  } catch (error) {
    console.error('❌ Test failed:', error);
    addResult('VFS Init Test Suite', false, error.message);
  } finally {
    worker?.terminate();
  }
};

runTests();
