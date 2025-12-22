# Phase 10 テスト雛形（spec-first）

## 対象フェーズ

- Phase 10: TypeScript Language Service 本接続
- 対象バージョン帯: v0.0.3.x

本テスト群は **Phase 9 までで確立した仕様・テストがすべて通過した状態** を前提とする。

---

## テスト設計方針

- Phase 10 は **「ダミー実装 → TS LS 実体」への差し替え検証フェーズ**
- JSON-RPC / document lifecycle / version 管理の挙動は **一切変更しない**
- テストは以下を保証する:

1. completion が TS LS 由来の内容を返す
2. hover が TS LS 由来の型・symbol 情報を返す
3. multi-file 状態で参照解決が行われる
4. Phase 9 のテスト期待値を破壊しない

---

## テスト 1: completion が TS LS 由来の候補を返す

### 前提

- VFS ready 済み
- initialize 済み
- document open 済み

### 入力例

```ts
const value = 123;
value.
```

### 期待

- completion.items.length > 0
- 少なくとも 1 件は以下を満たす:
  - label が TypeScript 標準プロパティ（例: `toString`, `valueOf`）
  - Phase 9 固定文字列ではない

---

## テスト 2: hover が型情報を返す

### 前提

```ts
const value = 123;
```

### 入力

- `value` 上で hover

### 期待

- hover.contents.value に `number` を含む
- Phase 9 の `uri / version` 文字列ではない

---

## テスト 3: multi-file 参照が解決される

### 前提

**a.ts**
```ts
export const answer = 42;
```

**b.ts**
```ts
import { answer } from './a';
answer
```

### 入力

- b.ts の `answer` 上で completion / hover

### 期待

- completion が有効
- hover が `number` または symbol 情報を含む

---

## テスト 4: Phase 9 テストが全通過する

### 目的

- Phase 10 実装が **Phase 9 仕様を破壊していない** ことを保証

### 期待

- phase9-completion-hover.test.js が無変更で通過

---

## 明示的に保証しない事項（Phase 10 では未検証）

- completion 並び順・精度
- overload / generic 表示
- diagnostics 精度
- CodeMirror 連携

---

## Phase 10 完了条件

- 本 spec に対応する全テストが green
- Phase 1〜9 の全テストが green
- worker.js の責務分離が破壊されていない

---

## 次フェーズ（Phase 11 予告）

- CodeMirror 実接続
- editor → worker → TS LS → response の end-to-end 検証

