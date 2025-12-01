// test/v0.0.2/worker-didChange-incremental-min.test.js
// v0.0.2.14

import { expect } from 'chai';
import {
  createTestWorker,
  waitForWorkerReady,
  sendRequest,
  sendNotification,
  waitForNotification,
  addResult,
} from './test-utils.js';

console.log('🧩 worker-didChange-incremental-min.test loaded');

