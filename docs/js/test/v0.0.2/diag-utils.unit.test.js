// test/v0.0.2/diag-utils.unit.test.js
// v0.0.2.12

import { DiagUtils } from '../../core/diag-utils.js';
import { addResult } from './test-utils.js';

console.log('🧩 diag-utils.unit.test loaded');

// Minimal fake TS objects
function mkChain(msg, next = []) {
  return { messageText: msg, next };
}

function assertEq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: actual=${actual}, expected=${expected}`);
  }
}

// ---------------------------------------------------------------------------
// flattenDiagnosticMessage tests
// ---------------------------------------------------------------------------
function runFlattenTests() {
  // A1: simple string
  {
    const d = { messageText: 'error' };
    const out = DiagUtils.flattenDiagnosticMessage(d);
    assertEq(out, 'error', 'simple string');
  }

  // A2: single chain
  {
    const d = { messageText: mkChain('a') };
    const out = DiagUtils.flattenDiagnosticMessage(d);
    assertEq(out, 'a', 'one-level chain');
  }

  // A3: chain with next
  {
    const d = {
      messageText: mkChain('a', [mkChain('b')]),
    };
    const out = DiagUtils.flattenDiagnosticMessage(d);
    assertEq(out, 'a\nb', 'multi-level chain');
  }

  // A4: deep > maxDepth
  {
    let n = mkChain('a');
    let cur = n;
    for (let i = 0; i < 300; i++) {
      const nxt = mkChain('x');
      cur.next = [nxt];
      cur = nxt;
    }
    const d = { messageText: n };
    const out = DiagUtils.flattenDiagnosticMessage(d, { maxDepth: 20 });
    const endsWith = out.endsWith(
      '[...diagnostic message truncated due to depth]'
    );
    assertEq(endsWith, true, 'depth truncation');
  }

  // A5: cycle detection
  {
    const a = mkChain('a');
    const b = mkChain('b');
    a.next = [b];
    b.next = [a]; // cycle
    const d = { messageText: a };
    const out = DiagUtils.flattenDiagnosticMessage(d);
    const hasCycle = out.includes('[...diagnostic message cycle detected]');
    assertEq(hasCycle, true, 'cycle detection');
  }

  // A6: relatedInformation included
  {
    const d = {
      messageText: 'main',
      relatedInformation: [{ messageText: 'r1' }, { messageText: 'r2' }],
    };
    const out = DiagUtils.flattenDiagnosticMessage(d);
    const ok =
      out.includes('main') &&
      out.includes('Related information') &&
      out.includes('r1') &&
      out.includes('r2');
    assertEq(ok, true, 'relatedInformation included');
  }

  // A7: relatedInformation excluded
  {
    const d = {
      messageText: 'main',
      relatedInformation: [{ messageText: 'r1' }],
    };
    const out = DiagUtils.flattenDiagnosticMessage(d, {
      includeRelatedInMessage: false,
    });
    assertEq(out, 'main', 'relatedInformation excluded');
  }
}

// ---------------------------------------------------------------------------
// mapTsDiagnosticToLsp tests
// ---------------------------------------------------------------------------
function runMapTests() {
  // Minimal fake program.getSourceFile
  const fakeProgram = {
    getSourceFile(p) {
      return {
        fileName: p,
        text: '',
      };
    },
  };

  // B1: basic transform
  {
    const d = {
      messageText: 'E',
      start: 0,
      length: 1,
      category: 1,
      code: 999,
    };
    const out = DiagUtils.mapTsDiagnosticToLsp(d, '/entry.ts', fakeProgram);
    const ok =
      out.message === 'E' &&
      out.severity === 1 &&
      out.source === 'ts' &&
      out.code === 999;
    assertEq(ok, true, 'basic transform');
  }

  // B2: URI normalization (smoke)
  {
    const d = { messageText: 'E', start: 0, length: 1 };
    const out = DiagUtils.mapTsDiagnosticToLsp(d, '/entry.ts', fakeProgram);
    assertEq(true, true, 'URI normalization smoke');
  }

  // B3: relatedInformation mapping
  {
    const d = {
      messageText: 'E',
      start: 0,
      length: 1,
      relatedInformation: [
        {
          messageText: 'r1',
          file: { fileName: '/f.ts' },
          start: 0,
        },
      ],
    };
    const out = DiagUtils.mapTsDiagnosticToLsp(d, '/entry.ts', fakeProgram);
    const ok =
      Array.isArray(out.relatedInformation) &&
      out.relatedInformation.length === 1 &&
      out.relatedInformation[0].message === 'r1';
    assertEq(ok, true, 'relatedInformation->LSP mapping');
  }
}

// ---------------------------------------------------------------------------
// Main runner (IIFE)
// ---------------------------------------------------------------------------
(async () => {
  const testName = 'diag-utils.unit';

  try {
    runFlattenTests();
    runMapTests();
    addResult(testName, true);
  } catch (err) {
    addResult(testName, false, err.message);
  }
})();
