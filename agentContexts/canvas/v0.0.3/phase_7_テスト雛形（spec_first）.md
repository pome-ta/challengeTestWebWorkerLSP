# Phase 7 テスト雛形（spec-first）

本ドキュメントは **Phase 7 仕様** に対するテストを、実装非依存で固定するための雛形である。

テストはすべて **観測可能な事実のみ** を assert し、Language Service の内部挙動には一切依存しない。

---

## テスト共通前提

- worker は新規生成されている
- Phase 6 までの全仕様が満たされている
- debug API が有効である

利用する debug RPC:

- `lsp/_debug/getLastDidChange`
- `lsp/_debug/getLastDiagnostics`

---

## Test 1: incremental didChange rebuilds text

### 識別子

`phase7: incremental didChange applies text delta correctly`

### 目的

- incremental sync による差分適用後の document.text が正しく再構築されることを保証する

### 手順

1. `vfs/ensureReady`
2. `lsp/initialize`
3. `vfs/openFile({ uri, content: "abc" })`
4. `vfs/openFile({ uri, content: incremental delta })`
5. `lsp/_debug/getLastDidChange`

### 期待結果

```json
{
  "uri": "file:///test.ts",
  "version": 2,
  "text": "<delta applied text>"
}
```

---

## Test 2: version increments on incremental change

### 識別子

`phase7: incremental didChange increments version monotonically`

### 目的

- incremental sync 適用ごとに version が必ず +1 されることを保証する

### 手順

1. initialize 後に openFile
2. 同一 uri に対して incremental update を 2 回行う
3. `getLastDidChange`

### 期待結果

- version === 初期値 + 更新回数

---

## Test 3: diagnostics emitted after didOpen

### 識別子

`phase7: diagnostics emitted after didOpen`

### 目的

- didOpen 後に diagnostics が 1 回発火することを保証する

### 手順

1. `vfs/ensureReady`
2. `lsp/initialize`
3. `vfs/openFile`
4. `lsp/_debug/getLastDiagnostics`

### 期待結果

```json
{
  "uri": "file:///test.ts",
  "diagnostics": []
}
```

---

## Test 4: diagnostics emitted after incremental didChange

### 識別子

`phase7: diagnostics emitted after incremental didChange`

### 目的

- incremental didChange 適用後に diagnostics が再発火することを保証する

### 手順

1. openFile
2. incremental change
3. `getLastDiagnostics`

### 期待結果

- diagnostics が object として取得できる
- diagnostics は配列である

---

## Test 5: no diagnostics before initialize

### 識別子

`phase7: no diagnostics before initialize`

### 目的

- initialize 前に diagnostics が一切発火しないことを保証する

### 手順

1. `vfs/ensureReady`
2. `vfs/openFile`
3. `lsp/_debug/getLastDiagnostics`

### 期待結果

- `null`

---

## Test 6: multi-file incremental isolation

### 識別子

`phase7: incremental change does not affect other documents`

### 目的

- file A の incremental change が file B の diagnostics / state に影響しないことを保証する

### 手順

1. openFile A
2. openFile B
3. incremental change A
4. diagnostics 取得

### 期待結果

- diagnostics.uri === A

---

## Phase 7 テスト完了条件

- 上記全テストが安定して通過する
- Phase 1〜6 のテストが一切破壊されていない
- incremental sync / diagnostics が **観測点として固定**された

