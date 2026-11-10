# ANNON AI OFFICE — 実装仕様・運用設計（2026-11-10）

**機密区分：社内検討用 / ANON関係者限定。** この文書に含まれる番号体系・事業関係は、業務上の整理案であり法的な親子会社関係や正式な権限を保証しません。

## 1. 決定された初期条件

| 設定 | 決定 |
|---|---|
| `approval` | `delegated`：事業単位で正式に権限付与された管理者が承認可（自己承認不可） |
| `scope` | `anon`：ANON内の複数事業に対応。ただしアクセス権は継承せず明示的に付与 |
| `ui` | `web`：スマートフォン対応Webアプリ |
| `use` | `brief`：朝の経営ブリーフィング・優先順位の提示が最優先 |

**目的：** ANNON運営の判断時間と、各事業の進捗確認の反復作業を削減し、経営判断の根拠を明確にする。

## 2. MVPの対象／対象外

**対象：** Webログイン、組織別閲覧、タスク・決定事項の抽出、優先順位付きブリーフィング、タスク申請と委譲承認、履歴、AIへの質問。

**対象外（後期フェーズ）：** Google Calendar/Drive/Gmailの自動同期、LINE Webhook、音声文字起こし、出金・請求・契約の自動実行、AIによる未承認のタスク編集、他法人の機密資料横断検索。

初期データは動作確認用の架空デモであり、LINEや議事録の実データは自動収集しない。

## 3. 画面仕様

| 画面 | データ | 操作 |
|---|---|---|
| ログイン | 開発専用デモユーザー | メール＋パスワード |
| 経営ブリーフィング | 期限超過、停滞、重要タスク、判断待ち | 組織切替、優先順位確認 |
| タスク | 各組織のタスク、期限、状態、根拠状態 | 登録申請、完了申請 |
| 承認キュー | 承認待ち、申請者、内容 | 権限者の承認・却下、監査 |
| AI参謀 | 現在の閲覧スコープの業務データ | 日本語の自然言語質問 |

## 4. データベース（SQLite開発版 → PostgreSQL本番版）

SQLの正本は `db/schema.sql`。`organizations` / `users` / `memberships` / `sessions` / `projects` / `tasks` / `decisions` / `approvals` / `audit_logs`。

### 根拠状態・業務状態の分離

- `tasks.source_status`：`sample` / `reported` / `verified` / `approved`（情報の確度）
- `tasks.status`：`todo` / `doing` / `blocked` / `done`（進捗）
- `approvals.status`：`pending` / `approved` / `rejected`（承認処理）

「協賛が決まったとの報告」は、正式契約・請求・着金と異なる。これらを将来の `opportunities`, `contracts`, `payments` に分離して記録する。

### ANONの事業区分

`organizations.area` はANONのNo.Area（例：No.1, 5, 8）という業務上の属性。`organizations.relationship_note` は関係説明。**親子会社関係を表す外部キーではない**。ANON連携組織内のすべての情報にANNON管理者が当然アクセスできるわけではなく、`memberships` に明示的な許可が必要。

### PostgreSQL 本番移行例（概念）

```sql
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_member_read ON tasks FOR SELECT
USING (EXISTS (
  SELECT 1 FROM memberships m
  WHERE m.org_id = tasks.org_id
    AND m.user_id = current_setting('app.current_user_id')::uuid
));
```

上記は概念コード。`memberships` のキー型をUUIDへ統一し、DBアカウントがRLSを回避しないこと、`SET LOCAL app.current_user_id` をトランザクション単位で安全に設定すること、書き込みの `WITH CHECK`、ポリシーの循環を検証する必要がある。本番はPostgreSQLへ移行してから設計・テストする。

## 5. HTTP API契約

| Method | URL | 認可条件 | 内容 |
|---|---|---|---|
| `POST` | `/api/auth/login` | 未ログイン | ログイン・Cookie設定 |
| `POST` | `/api/auth/logout` | ログイン済 | セッション失効 |
| `GET` | `/api/me` | ログイン済 | 権限・組織の返却 |
| `GET` | `/api/organizations` | ログイン済 | 許可組織だけ返却 |
| `GET` | `/api/briefing?orgId=all` | 各組織メンバー | 朝の経営ブリーフィング |
| `GET` | `/api/tasks?orgId=gad` | 対象組織メンバー | タスク一覧 |
| `GET` | `/api/decisions?orgId=gad` | 対象組織メンバー | 判断待ち |
| `GET` | `/api/approvals?orgId=gad` | 対象組織メンバー | 申請・処理状況 |
| `POST` | `/api/approvals` | owner/manager/member | `task.create` または `task.complete` の申請 |
| `POST` | `/api/approvals/:id/decision` | owner/manager + can_approve | `approve` / `reject`、自己承認不可 |
| `POST` | `/api/ask` | 対象組織メンバー | 許可範囲だけの質問応答 |
| `GET` | `/api/health` | 公開 | 最低限のヘルスチェック |

### 例：タスク登録申請

```json
{
  "orgId": "gad",
  "actionType": "task.create",
  "title": "協賛掲載条件を確認",
  "priority": "P0",
  "dueOn": "2026-11-12",
  "description": "営業と制作の双方で確認する"
}
```

返答は `201 {"id":"...","status":"pending"}`。承認されるまで `tasks` には反映されない。

## 6. AI参謀の判断フロー

1. 認証した利用者の`memberships`から閲覧対象の組織を決定する。
2. その組織内のタスク・判断待ちのみを取得し、サマリーを作る。
3. 期限超過、停滞、P0タスクを優先し、根拠状態を明示する。
4. APIキーが設定されていればResponses APIで日本語回答する。設定がなければDBに基づく定型回答を返す。
5. **AIは提案だけを行い、承認済みの操作以外を実行しない。**

初期版は毎朝の定時通知を自動で送信しない。Webでアクセスすると最新の状態を生成する。将来、朝8時の自動生成・通知を追加する場合は、ジョブ、受信者同意、監視、再試行ルールを実装する。

## 7. セキュリティ／監査と制限

- 初期版はHTTPのlocalhostでのみ起動。セッションはHttpOnly + SameSite Strict Cookie。
- ユーザーパスワードは `scrypt` のソルト付きハッシュで保存。初期デモアカウントは本番で削除する。
- 業務APIで毎回組織メンバー確認。承認操作には専用権限と自己承認禁止、DBトランザクションと監査ログを使用。
- 更新APIに簡易的なOrigin検証があるが、実運用ではCSRFトークンやOAuth/OIDCを追加。
- モデルへは許可されたデータのみ送信。プロンプトインジェクション対策として、DB内容は指示ではないことを明示する。
- 経営判断へのAI助言を過信しない。財務・契約・労務情報は公開前に必ず人間が確認する。
- 監査ログの改ざん防止、外部鍵管理、バックアップ、異常検知、連携アプリのトークンローテーションは本番化の要件。

## 8. 実装ロードマップ（目標日程）

| 期間 | フェーズ | 成果物／完了基準 |
|---|---|---|
| 11/10–11/12 | Phase 0：仕様固定 | 事業範囲・承認者・画面・MVP合格基準を確定 |
| 11/13–11/16 | Phase 1：ローカルMVP | このリポジトリの画面・組織分離・タスク・委譲承認が動作 |
| 11/17–11/20 | Phase 2：Launchで読み取り試験 | 既存業務を妨げない範囲で実データ投入前の精度検証 |
| 11/21–12/04 | Phase 3：連携・本番要件 | Workspace OAuth、PostgreSQL/RLS、承認・監査強化 |
| 12/05–12/31 | Phase 4：ANON拡張 | 事業責任者ごとの権限設定、少数事業から段階導入 |

**日程は合意済み納期ではなく開発目標案。** 実際の接続許可やGoogle OAuthアプリ審査に左右される。

## 9. MVPの受け入れテスト

| テスト | 合格条件 |
|---|---|
| ① 権限外の事業データ | API側で403、漏えいなし |
| ② 非管理者の承認 | 403 |
| ③ 自分の申請の自己承認 | 403 |
| ④ 承認前のタスク | 未作成 |
| ⑤ 承認後のタスク | 作成、監査ログ記録 |
| ⑥ 二重承認 | 409 |
| ⑦ APIキーなし | ローカル定型回答で動く |
| ⑧ サンプルの表示 | 実績と区別して明示 |

## 10. 運用の費用・効果の確認方法

**最初はコスト見積より実測を優先**：ユーザー1日当たりの質問数、平均入力・出力トークン、AI API費用、サーバー費用、1日の朝の確認時間、見落とした期限、承認までの時間を計測する。

試験初期の提案指標：朝の状況確認時間30%削減、承認の記録率100%、重要回答の根拠明記100%。これらは目標値であり効果の保証ではない。

## 11. 外部連携の実装順

1. `Google Calendar`：読み取り専用予定検索 → 承認付き登録。
2. `Google Drive`：許可フォルダのみの議事録・資料検索。部署別の共有範囲と同意を設定。
3. `Google Sheets`：現在の業務台帳から段階的に同期。双方向同期は競合解決方式を定めてから。
4. `LINE公式アカウント`：参加可能なグループでWebhook。旧トーク履歴の自動遡及はしない。
5. `Gmail`：許可ラベル・明確な送信承認付きで実装。

コネクター導入は利用者・法人の許可を得た後に行う。タスクの正本は1つのDB/台帳に揃える。

## 12. 将来の他社向け提供

ANNON AI OFFICEの価値を評価するには、GAD・ANON内で時間削減・承認の見落とし減少などを実測し、再現可能な機能を切り出す必要がある。将来の販売・知財権は別途関係者と合意する。名称や組織情報をそのまま他社向け商品に転用しない。
