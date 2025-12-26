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

- Map\<uri, {version, text}>
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
- 対象ドキュメントなし → 空リストを返す

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

- 情報なし → null を返す

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


## Phase 10 における compilerOptions の選定理由

### 前提となる設計判断
- ブラウザ環境のみで動作
- VFS 完全閉世界（CDN + user files のみで完結）
- Virtual TypeScript Environment 主体
- tsserver 完全互換までは求めない
- completion / hover の安定提供が主目的
- Node 依存 API を使用しない

---

### 採用したオプションと理由
- **target: ES2022**
  - モダンブラウザで実用的な最低ライン
- **module: ESNext**
  - ESM 前提設計に整合
- **strict: true**
  - 型整合性と hover 情報の質を担保
- **skipLibCheck: true**
  - lib.d.ts 相互依存チェックを回避し高速化
- **noEmit: true**
  - 解析専用、出力は不要
- **allowImportingTsExtensions: true**
  - `.ts` などの拡張子付き import を許容
- **allowArbitraryExtensions: true**
  - VFS 上の多様な拡張子に対応
- **resolvePackageJsonExports / Imports: true**
  - import 解決の将来拡張に備える

---

### 意図して外したオプションと理由
- **moduleResolution: Bundler**
  - node_modules 仮定や外部 FS 参照を前提とする傾向
  - Phase 10 の「完全閉世界 VFS」方針と非整合
- **useDefineForClassFields: true**
  - emit 振る舞いに関する設定であり
  - `noEmit: true` の下では事実上意味を持たない

---

### まとめ
- Phase 10 の目的に対し、最小で本質的な設定のみ採用
- Node 的依存や過剰解決を誘発する可能性のある項目は除外
- hover / completion の安定性に寄与する実用的ミニマムセットとする


## TextDocumentManager 仕様・設計（確定版）

### 1. 役割と責務
- LSP Text Document Life-cycle の管理（open/change/close）
- VfsCore との整合性維持
- バージョン番号管理（incremental）
- テキストスナップショット提供
- LSP Position/Range とオフセット変換の委譲管理
- 例外発生時のフェイルセーフ（不整合を残さない）

### 2. 基本ポリシー
- 既存機能の活用を最優先（独自実装の最小化）
- LSP 仕様準拠（Protocol 準拠・互換性重視）
- 薄いラッパー構造
- 状態管理は厳密・保守性重視
- 破壊的更新は行わず、常に整合性を確認

---

## TextDocumentManager クラス骨格

```js
// core/text-document-manager.js

export class TextDocumentManager {
  constructor({ vfs }) {
    this.vfs = vfs;                  // VfsCore 依存注入
    this.documents = new Map();      // uri -> { version, languageId, text }
  }

  // LSP: textDocument/didOpen
  open({ uri, languageId, text }) {
    // 例外方針: 既に open 済みなら上書きせず version を 1 で再登録
  }

  // LSP: textDocument/didChange
  change({ uri, contentChanges }) {
    // version++ の厳密管理
    // full text / incremental の両対応（まずは full text 優先）
  }

  // LSP: textDocument/didClose
  close({ uri }) {
    // VFS 上の実体は残す（LSP 仕様通り）
    // manager の active-set から除外
  }

  getText(uri) {}
  getVersion(uri) {}
  has(uri) {}
}
```

---

## 例外方針
- 不明な URI → 例外ではなく安全失敗（no-op + ログ）
- VFS 書き込み失敗 → manager state をロールバックしない（不整合ログ）
- API 呼び出し元に throw しない（LSP ループを止めない）

---

## 同期モデル
- TextDocumentManager は state owner
- VfsCore は storage owner
- 書き込み順序:
  1) Manager state 更新
  2) VFS 反映
- いずれか失敗時:
  - LSP へは error を返さずログ通知
  - 次回操作で自己修復可能な形で保持

---

## LSP 連携
- didOpen → `open()`
- didChange → `change()`
- didClose → `close()`
- Hover/Completion 等は `getText()` と `getVersion()` を参照

---

## 堅牢実装要点
- version は 1 origin 整数連番
- close 後の didChange は無視
- open なしの didChange は no-op
- full-text change を優先採用（incremental は後続拡張）

---

## VfsCore との統合
- TextDocumentManager は VfsCore に依存する（逆依存禁止）
- open/change 時:
  - VFS `writeFile(uri, text)` を呼び出す
- close 時:
  - VFS は削除しない（LSP 準拠）

---

## 実装ステップ
1. クラス骨格の commit
2. didOpen/didChange/didClose API 準拠
3. version 管理実装
4. VfsCore 連携
5. 例外ハンドリング・ログ
6. incremental change への拡張余地確保

