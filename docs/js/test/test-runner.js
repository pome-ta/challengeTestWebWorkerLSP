// test/test-runner.js
// v0.0.3.系

console.log('🚀 test-runner.js loaded');

//import './v0.0.3/vfs-ensureReady.test.js';
//import './v0.0.3/vfs-ensureReady-idempotent.test.js';
//import './v0.0.3/vfs-before-ensureReady.test.js';
//import './v0.0.3/vfs-resetForTest.test.js';
//import './v0.0.3/worker-ready-semantics.test.js';
//import './v0.0.3/lsp-initialize-before-vfs.test.js';
//import './v0.0.3/lsp-initialize-success.test.js';

import './v0.0.3/vfs-openFile.test.js';
import './v0.0.3/vfs-openFile-invalid-params.test.js';
import './v0.0.3/vfs-openFile-envId-stable.test.js';
import './v0.0.3/vfs-openFile-before-lsp-initialize.test.js';
import './v0.0.3/vfs-openFile-visible-to-lsp.test.js';

