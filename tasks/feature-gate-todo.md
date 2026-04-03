# Feature Gate 実装（未着手）

> 設計仕様: `tasks/feature-gate.md` 参照

- [ ] Worker: 回数制限ミドルウェア追加（Redis INCR）
- [ ] Worker: 数量制限チェック追加（holdings, cash_balances）
- [ ] Worker: Pro 限定エンドポイント制限追加
- [ ] Frontend: `useMe()` で plan 取得 → 制限 UI 表示
- [ ] Frontend: `<UpgradePrompt>` コンポーネント作成
- [ ] Frontend: 運用モードセレクタの Free 制限
- [ ] テスト: Free/Pro 両プランでの動作確認
