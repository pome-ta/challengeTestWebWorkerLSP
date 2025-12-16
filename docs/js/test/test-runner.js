// test/test-runner.js
// v0.0.3.系

console.log('🚀 test-runner.js loaded');

import './v0.0.3/vfs-ensureReady.test.js';
import './v0.0.3/vfs-ensureReady-idempotent.test.js';
import './v0.0.3/vfs-before-ensureReady.test.js';
import './v0.0.3/vfs-resetForTest.test.js';
import './v0.0.3/worker-ready-semantics.test.js';
import './v0.0.3/lsp-initialize-before-vfs.test.js';
import './v0.0.3/lsp-initialize-success.test.js';
