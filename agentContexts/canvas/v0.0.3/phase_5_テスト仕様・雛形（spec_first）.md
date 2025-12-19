# Phase 5 テスト仕様・雛形（spec-first）

## 目的

Phase 5 仕様で確定した **イベント駆動型 document 同期** が、initialize 前後の状態差分に従って正しく発火することを、テスト先行で固定する。

本テストは **実装を一切仮定しない**。 観測できる事実のみを spec として定義する。

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

# Phase 6 仕様（didClose / multi-file）【確定】

## 目的

Phase 5 で確立した **単一 document の open / change 同期モデル** を拡張し、 LSP が前提とする **document lifecycle 完全形** を確定する。

本 Phase では以下のみを扱い、それ以外は意図的に扱わない。

- document close（didClose）
- multi-file（複数 uri 同時管理）

---

## Phase 6 スコープ

### 含む

- `textDocument/didClose` の発火条件
- close 後の document 状態破棄
- uri ごとに独立した document state 管理

### 含まない（明示）

- incremental sync
- diagnostics / hover 内容
- workspace / project 境界

---

## 用語整理

- **document**: uri 単位で管理される論理ファイル
- **open 状態**: didOpen 済み、もしくは openFile により管理下にある状態
- **closed 状態**: didClose 後、管理対象外

---

## didClose 仕様（最小）

### 発火条件

- open 状態の document に対して close 操作が行われたとき

### 効果

- 対象 document の state（text / version）を完全に破棄する
- 以降、その uri に対する didChange は発火しない

### version

- close 時点で version は意味を持たない
- 再 open 時は **必ず version = 1** から再開する

---

## multi-file 仕様（最小）

### 基本原則

- document state は **uri ごとに完全に独立**して管理される

### 保証事項

- file A の open / change / close は file B に影響しない
- version は uri ごとに単調増加

---

## initialize 前後ルール

Phase 5 のルールを **そのまま踏襲**する。

- initialize 前

  - openFile は state を保持するのみ
  - didOpen / didChange / didClose は発火しない

- initialize 後

  - openFile / update / close は即時イベント発火

---

## 観測方法（テスト専用）

Phase 6 でも引き続き **debug RPC のみ**を観測点とする。

- `lsp/_debug/getLastDidOpen`
- `lsp/_debug/getLastDidChange`
- `lsp/_debug/getLastDidClose`

---

## Phase 6 完了条件

- didClose が正しいタイミングで 1 回だけ観測できる
- close 後の update がイベントを発火しない
- multi-file 環境でも version / state が混線しない
- Phase 5 までのテストが一切破壊されていない


---

# Phase 6 テスト仕様・雛形（spec-first）

## 目的

Phase 6 仕様で確定した **didClose / multi-file document lifecycle** が、Phase 5 の挙動を一切破壊せずに成立していることを、テスト先行で固定する。

本テストも **実装を一切仮定しない**。 観測可能な debug API の結果のみを spec とする。

---

## Phase 6 テスト範囲

- didClose の発火条件
- close 後の state 破棄
- multi-file 環境での独立性

以下は **Phase 6 では扱わない**。

- incremental sync
- diagnostics / hover 内容
- project / workspace 境界

---

## テスト共通前提

- worker は新規生成されている
- debug API が有効である

利用する debug RPC:

- `lsp/_debug/getLastDidOpen`
- `lsp/_debug/getLastDidChange`
- `lsp/_debug/getLastDidClose`

---

## テスト 1

### 識別子

`phase6: didClose after initialize emits didClose`

### 目的

- initialize 後、open 状態の document を close したとき
- didClose が **1 回だけ** 発火することを保証する

### 手順

1. `vfs/ensureReady`
2. `lsp/initialize`
3. `vfs/openFile({ uri, content })`
4. `vfs/closeFile({ uri })`
5. `lsp/_debug/getLastDidClose`

### 期待結果

```json
{
  "uri": "file:///test.ts"
}
```

---

## テスト 2

### 識別子

`phase6: close then update does not emit didChange`

### 目的

- close 後の update が didChange を **発火しない** ことを保証する

### 手順

1. `vfs/ensureReady`
2. `lsp/initialize`
3. `vfs/openFile({ uri, content: v1 })`
4. `vfs/closeFile({ uri })`
5. `vfs/openFile({ uri, content: v2 })`
6. `lsp/_debug/getLastDidChange`

### 期待結果

- `getLastDidChange` は `null`

---

## テスト 3

### 識別子

`phase6: reopen after close emits didOpen with version 1`

### 目的

- close 後に再 open した document が
- **新規 document** として didOpen(version=1) を発火することを保証する

### 手順

1. `vfs/ensureReady`
2. `lsp/initialize`
3. `vfs/openFile({ uri, content: v1 })`
4. `vfs/closeFile({ uri })`
5. `vfs/openFile({ uri, content: v2 })`
6. `lsp/_debug/getLastDidOpen`

### 期待結果

```json
{
  "uri": "file:///test.ts",
  "version": 1,
  "text": "<v2>"
}
```

---

## テスト 4

### 識別子

`phase6: multi-file states are isolated`

### 目的

- 複数 uri の document state が完全に独立していることを保証する

### 手順

1. `vfs/ensureReady`
2. `lsp/initialize`
3. `vfs/openFile({ uri: A, content: a1 })`
4. `vfs/openFile({ uri: B, content: b1 })`
5. `vfs/openFile({ uri: A, content: a2 })`
6. `lsp/_debug/getLastDidChange`

### 期待結果

```json
{
  "uri": "<A>",
  "version": 2,
  "text": "<a2>"
}
```

---

## 非テスト項目（明示）

以下は **テスト失敗条件に含めない**。

- didClose が実際に LSP クライアントへ送信されているか
- close による Language Service 側の副作用
- file B の state を debug API で直接取得できるか

---

## Phase 6 完了条件（テスト観点）

- 上記 4 テストがすべて安定して通過する
- Phase 5 までの全テストが破壊されていない
- document lifecycle が uri 単位で閉じていることが確認できる

