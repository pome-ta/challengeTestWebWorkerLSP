# Phase 5 テスト仕様・雛形（spec-first）

## 目的

Phase 5 仕様で確定した **イベント駆動型 document 同期** が、initialize 前後の状態差分に従って正しく発火することを、テスト先行で固定する。

本テストは **実装を一切仮定しない**。
観測できる事実のみを spec として定義する。

---

## Phase 5 テスト範囲

- initialize 前後での `vfs/openFile` 挙動差
- didOpen / didChange の発火条件
- version の単調増加

以下は **Phase 5 では扱わない**。

- hover / diagnostics 等の LSP 内容
- multi-file
- didClose
- incremental sync

---

## テスト共通前提

- worker は新規生成されている
- debug API が有効である

利用する debug RPC:

- `lsp/_debug/getLastDidOpen`
- `lsp/_debug/getLastDidChange`

---

## テスト 1

### 識別子

`phase5: openFile before initialize does not emit didOpen`

### 目的

- initialize 前の `vfs/openFile` が **didOpen を発行しない** ことを保証する

### 手順

1. `vfs/ensureReady`
2. `vfs/openFile({ uri, content })`
3. `lsp/_debug/getLastDidOpen`

### 期待結果

- `getLastDidOpen` は `null`

---

## テスト 2

### 識別子

`phase5: openFile after initialize emits didOpen`

### 目的

- initialize 後、初回 openFile で didOpen が **即時発行**されることを保証する

### 手順

1. `vfs/ensureReady`
2. `lsp/initialize`
3. `vfs/openFile({ uri, content })`
4. `lsp/_debug/getLastDidOpen`

### 期待結果

```json
{
  "uri": "file:///test.ts",
  "version": 1,
  "text": "<content>"
}
```

---

## テスト 3

### 識別子

`phase5: openFile after initialize updates same uri emits didChange`

### 目的

- initialize 後、同一 uri の再 open が didChange として扱われることを保証する

### 手順

1. `vfs/ensureReady`
2. `lsp/initialize`
3. `vfs/openFile({ uri, content: v1 })`
4. `vfs/openFile({ uri, content: v2 })`
5. `lsp/_debug/getLastDidChange`

### 期待結果

```json
{
  "uri": "file:///test.ts",
  "version": 2,
  "text": "<v2>"
}
```

---

## テスト 4

### 識別子

`phase5: openFile before initialize then initialize then update emits didChange`

### 目的

- initialize 前に open された document が
- initialize 後の更新で didChange に正しく遷移することを保証する

### 手順

1. `vfs/ensureReady`
2. `vfs/openFile({ uri, content: v1 })`
3. `lsp/initialize`
4. `vfs/openFile({ uri, content: v2 })`
5. `lsp/_debug/getLastDidChange`

### 期待結果

```json
{
  "uri": "file:///test.ts",
  "version": 2,
  "text": "<v2>"
}
```

---

## 非テスト項目（明示）

以下は **テスト失敗条件に含めない**。

- didOpen / didChange が実際に LSP クライアントへ送信されているか
- Language Service が内容を解釈できるか
- hover 等の応答内容

---

## Phase 5 完了条件（テスト観点）

- 上記 4 テストがすべて安定して通過する
- Phase 4 までのテストが破壊されていない
- initialize 集約ロジックが完全に不要になっている

---

## 次ステップ（実装フェーズ）

- Phase 5 クリーン版 worker.js 実装
  - initialize 集約ロジック削除
  - openFile イベント駆動化

