# Phase 10 仕様（VFS 完全閉世界 + TS Language Service-lite）

## 目的
- ブラウザ環境のみで TypeScript 言語機能（completion / hover）を提供する。
- Node API、tsserver、ファイルシステムへの依存を排除する。
- すべての解決（lib 含む）を **仮想ファイルシステム（VFS）内で完結**させる。
- その結果として Phase 10 のテスト（completion / hover）が安定してグリーンとなる設計を確立する。

## スコープ
- textDocument/completion
- textDocument/hover
- 仮想ファイルの open / update
- VFS 初期化と ready 管理

## アウトオブスコープ（非目標）
- tsserver の起動
- Node.js API の利用
- 実ファイルシステム（localStorage / IndexedDB など含む）
- LSP 全機能の網羅実装

---

## 基本設計思想

### 1. Compiler API 直接利用ではなく **Virtual TypeScript Environment** を中核とする
- `createProgram` を直接叩かない
- `getDefaultLibFilePath` を使用しない
- 解決処理は TS に任せるが、解決対象は **VFS 内のみに限定**する

### 2. lib 型定義は CDN から取得し、VFS 内に格納する
- `createDefaultMapFromCDN()` を利用
- 取得結果を fsMap として保持
- `lib*.d.ts` はすべて仮想環境内に存在する前提とする

### 3. すべての言語機能は Language Service API 経由で提供する
- completion → `getCompletionsAtPosition()`
- hover → `getQuickInfoAtPosition()`
- 独自トークン走査や型推論実装は行わない

---

## アーキテクチャ構成

```
VfsCore
 ├ fsMap（CDN lib + user files）
 ├ system（仮想 System）
 ├ env = createVirtualTypeScriptEnvironment()
 │   ├ languageService
 │   └ program
 └ 公開 API
     ├ ensureReady()
     ├ writeFile(uri, text)
     ├ readFile(uri)
     └ getLanguageService()
```

Worker
```
RPC
 ├ vfs/ensureReady
 ├ vfs/openFile
 ├ lsp/initialize
 ├ textDocument/completion
 └ textDocument/hover
```

---

## 環境制約
- 実行環境はブラウザ（Web Worker）
- importmap 非依存
- ESM のみ
- ネットワークは **lib 取得時にのみ利用**

---

## 初期化ライフサイクル

1. Worker 起動
2. `worker/ready` 通知
3. `vfs/ensureReady`
   - CDN から lib を取得
   - fsMap を構築
   - `createVirtualTypeScriptEnvironment` を生成
4. `lsp/initialize`
   - フラグ `initialized = true`

エラー発生時
- 再試行可能
- 途中状態を残さない

---

## ドキュメント管理
- Map<uri, {version, text}>
- `vfs/openFile` により保存
- 同一 uri 呼び出し時は version をインクリメント
- VFS にも同時に反映

---

## completion 仕様

### 入力
- textDocument.uri
- position

### 処理
1. uri から対象テキスト取得
2. オフセットへ変換
3. `languageService.getCompletionsAtPosition()` を呼ぶ
4. 取得結果を LSP 互換の形へ正規化

### 出力
- `isIncomplete: false`
- `items: CompletionItem[]`

非成立条件
- initialized=false
- 対象ドキュメントなし
→ 空リストを返す

---

## hover 仕様

### 入力
- textDocument.uri
- position

### 処理
1. offset 算出
2. `languageService.getQuickInfoAtPosition()` を呼ぶ
3. displayParts を結合して文字列化

### 出力
```
contents:
  kind: plaintext
  value: 型情報またはシンボル情報
```

非成立条件
- 情報なし
→ null を返す

---

## 言語サービス構成ポリシー

- target: ES2022 以上
- module: ESNext
- strict: true
- skipLibCheck: true
- noEmit: true
- すべての lib は VFS 内のもののみ利用

Node 依存 API を内部で呼ばせないよう
- `getDefaultLibFilePath` 等に依存しない設定とする

---

## エラーハンドリング

- JSON-RPC error.code を使用
- 未定義メソッド: -32601
- VFS 未初期化: -32001
- 例外一般: -32000

---

## テスト受け入れ基準（Acceptance Criteria）

### Phase 9
- completion が具体的な item を返す
- hover が非空の文字列を返す

### Phase 10
- hover の value に **型情報が含まれる**
  - 例: `const x: number` → `number`
- completion が TS のスコープ解決結果になる
- Node 依存エラーが一切出ない

---

## 非機能要求
- 再初期化しても破綻しない
- レースコンディションがない
- CDN 取得のリトライ戦略を持つ

---

## 将来発展
- diagnostics（エラー表示）
- rename / definition
- incremental update 最適化

---

## まとめ
- Phase 10 は「VFS 完全閉世界 + TS Language Service-lite」
- Compiler API 直叩きではなく **env.languageService を唯一の経路**とする
- getDefaultLibFilePath 問題を構造的に排除する
- この仕様を満たす実装を worker.js に反映する

