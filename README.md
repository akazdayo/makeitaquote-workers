# makeitaquote-workers

Discordで**メッセージを右クリック → アプリ → makeitquote**。その会話に、アイコン・本文・名前を使った名言風PNGを直接返すユーザーインストール型アプリです。WebUI・プレビュー画面・ブラウザー操作はありません。

TypeScript / Cloudflare Workers Free / pnpm / Nix devShell。画像は640×360のモノクロ、ドットフォントによる日本語対応です。有料のBrowser Renderingや外部画像生成サービスは使いません。

## ステートレス

- KV、D1、R2、Durable Objects、Queues、Cache API、セッション、Cookieを使いません。
- 署名検証後にDiscordへdefer応答を返し、そのリクエストの`waitUntil`内でPNGを生成。元のInteraction返信を画像に更新します。
- 本文・画像・Interaction tokenは処理中のメモリーにだけ保持します。DB、ファイル、永続キャッシュ、ログに保存しません。
- フォントはビルド時に同梱する固定リソースです。実行時のフォントダウンロードや外部レンダラーは不要です。
- Workerに必要な設定はApplication IDとPublic Keyのみ。Bot tokenはコマンド登録時にだけ使い、Workerに渡しません。
- 元メッセージ・投稿画像はDiscordに残ります。Discord/CDNやCloudflare自身の保存・通信記録をなくす保証ではありません。

独自の利用者別レート制限・処理履歴・リプレイ防止台帳は持ちません。同じ署名付きリクエストの有効期間内の再送を検出しませんが、画像の送信先はそのInteractionの元返信に固定しています。

## 開発環境

Nixとflakesを有効にしておきます。Node.jsとpnpmはdevShellのものを使います。

```sh
nix develop path:.
node --version
pnpm --version
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
```

`flake.lock`でnixpkgsを固定し、Node.js 22とpnpmを用意します。macOS/Linux、arm64/x86_64のdevShellを定義しています。`path:.`は初回の未追跡ファイルがある状態でも使える指定です。

`.dev.vars`はローカルのエディターで設定してください。Git管理対象外です。

| 変数 | 値 |
| --- | --- |
| `DISCORD_APPLICATION_ID` | Discord Developer PortalのApplication ID |
| `DISCORD_PUBLIC_KEY` | General InformationのPublic Key（16進数） |

```sh
pnpm dev
pnpm typecheck
pnpm build
```

- `pnpm dev`: 同梱フォントを変換してWranglerのローカルサーバーを起動します。
- `pnpm typecheck`: Wranglerで環境型を生成し、TypeScriptを検査します。
- `pnpm build`: フォントを変換し、Wranglerの`deploy --dry-run`でバンドルします。本番には送信しません。

フォント変換はNode.jsだけで実行し、ダウンロードやOSのインストール済みフォントに依存しません。変換元のチェックサムを検証します。生成される`src/font.bin`はGit管理せず、`dev`・`build`・`deploy`が自動生成します。

開発サーバーは通常`http://localhost:8787`です。`GET /`はヘルスチェック用JSONのみを返します。Discordからローカル環境を呼ぶ場合は別途HTTPSトンネルが必要です。通常はデプロイ先の公開HTTPS URLをDiscordに設定します。

## Discord側の設定

Discord Developer Portalで専用のApplicationを作成します。

1. **Installation → Installation Contexts**で**User Install**を有効化します。User Installのスコープは`applications.commands`。Guild InstallやサーバーへのBot招待は不要です。
2. **General Information**のApplication IDとPublic Keyを`.dev.vars`に記載します。
3. **Bot**のBot tokenを取得します。これはコマンド登録にだけ必要です。Gateway接続やMessage Content Intentは使いません。
4. デプロイ後、**General Information → Interactions Endpoint URL**に`https://<workerのホスト名>/interactions`を設定します。署名付きPINGに応答して保存できます。
5. devShell内で`pnpm register`を実行し、非表示の対話プロンプトにBot tokenを入力します。CIでは`DISCORD_BOT_TOKEN`を安全に環境変数として注入する方法も使えます。
6. 表示されるインストールURL、またはPortalのInstall Linkから**自分のアカウント**に追加します。

`pnpm register`は、このApplicationのグローバルコマンドを`makeitquote`の1個で置き換えます。既存Applicationとの共用には注意してください。

コマンドは`type: 3`（メッセージコンテキストメニュー）、`integration_types: [1]`（User Installのみ）、`contexts: [0, 1, 2]`（サーバー・Bot DM・プライベート会話）です。

正常な画像生成では公開応答を要求し、公開可否の判定はDiscordに任せます。実行した利用者にサーバー内の**Use External Apps**権限がない場合、Discordによって本人限定になります。管理者権限（**Administrator**）はすべての権限を含みます。`app_permissions`はアプリ自身の権限であり、実行した利用者の公開可否の判定には使いません。入力エラーは本人限定で返します。

以前の実装で管理者でも本人限定になっていた場合は、修正版を`pnpm deploy`してからコマンドを再実行してください。既に本人限定になった応答の公開範囲は変更できません。

## Cloudflareへのデプロイ

Cloudflare WorkersのFreeプランを使い、devShell内で実行します。

```sh
pnpm exec wrangler login
pnpm exec wrangler secret bulk .dev.vars
pnpm deploy
pnpm register
```

初回の`secret bulk`でWorkerがない場合は作成確認に従います。`.dev.vars`にはApplication IDとPublic Keyだけを記載し、Bot tokenを入れないでください。Worker名の変更は事前に`wrangler.jsonc`の`name`を編集します。

表示されたWorker URLに`/interactions`を付けてDiscordに設定します。Cloudflare認証・Discord設定が必要なため、ローカルのビルドだけでは実際のインストール・本番稼働は完了しません。

## 制限

- 本文のあるメッセージが対象です。引用は240文字まで。長すぎる本文や改行が多すぎる本文にはエラーを返し、無断で切り詰めません。
- 名前が画像幅を超える場合は省略記号を付けます。メッセージ本文のMarkdownやメンション表記はそのまま描画します。投稿時にメンション通知は発生させません。
- 日本語・英数字は同梱のGNU Unifont Japaneseで描画します。BMP外の絵文字など未対応文字は`□`になります。カスタム絵文字やカラー絵文字の画像展開はしません。
- アイコンはDiscord CDNから64pxの静止PNGとして取得します。取得失敗・タイムアウト・アイコン未設定の場合は名前の頭文字で代替します。任意URLを取得する機能はありません。
- DiscordのEd25519署名・5分以内のタイムスタンプ・Application IDを検証します。公開画像の作成はコマンドを実行した利用者の操作に基づくもので、引用元の本人承認や改変防止を証明しません。
- **FreeのCPU予算への配慮:** 小さなグレースケール画像、事前変換済みビットマップフォント、ネイティブのCompressionStreamを使います。SVG/Canvas/WASMの重いラスタライズはしません。
- **本番CPU制限はローカルの検査だけでは保証できません。** Workers FreeのCPU・リクエスト上限やDiscordのレート制限は引き続き適用されます。公開後はCloudflare MetricsでCPU時間・エラーを確認してください。有料プランを要求する設定や有料サービスのバインディングはありません。
- アプリのリクエストログは無効です。診断を追加する場合も本文・Interaction token・署名・Bot tokenをログに出さないでください。

## ライセンス

このプロジェクト独自のアプリ本体・スクリプト・設定・ドキュメント・アイコンはMITライセンスです。全文は`LICENSE`を参照してください。第三者のコードやフォントをMITに再ライセンスするものではありません。

- 実行時の依存ライブラリ`fast-png`・`fflate`・`iobuffer`もMITです。それぞれの著作権表示とライセンス全文は`THIRD_PARTY_NOTICES.md`に記載しています。
- 同梱フォント`assets/quote-font.bdf.gz`と変換後の`src/font.bin`は、MITではなくSIL Open Font License 1.1です。ビルド成果物内のフォントデータも同じ扱いです。元データ・著作権表示・ライセンスは`assets/FONT-NOTICE.md`と`assets/FONT-LICENSE.txt`を参照してください。
- ソースやフォントデータ付きのビルド成果物を再配布するときは、`LICENSE`・`THIRD_PARTY_NOTICES.md`・`assets/FONT-NOTICE.md`・`assets/FONT-LICENSE.txt`も添付してください。`dist/`への自動コピーは行いません。
- 生成画像にこのフォントのライセンスは適用されません。ただし、引用文やアバターなど第三者の素材の権利を許諾するものではありません。

## 公式仕様

- [Discord: Application commands](https://docs.discord.com/developers/interactions/application-commands)
- [Discord: Receiving and responding](https://docs.discord.com/developers/interactions/receiving-and-responding)
- [Discord: Permissions](https://docs.discord.com/developers/topics/permissions)
- [Cloudflare: Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare: Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
