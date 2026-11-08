# Funkin' Studio の構造（State 方式）

各画面を **1画面 = 1クラス = 1ファイル** に分け、`MusicBeatState` と同じ発想で切り替える作りです。

## フォルダ

```
index.html                      ← <div id="app"> と main.js を読むだけ（約20行）
funkin-studio/
  js/
    main.js                     ← 入口。部品を作り、画面を登録し、home を開く
    core/                       ← 画面の仕組み本体（汎用）
      State.js                  ← 全画面の親クラス（= MusicBeatState）
      StateManager.js           ← 画面の切り替え係（= FlxG.switchState）
      App.js                    ← 共有の入口（= FlxG）  app.switchTo / app.events / app.hud …
      EventBus.js               ← 画面どうしの伝言板（= FlxSignal）
      dom.js                    ← HTML文字列→要素、esc、$ など
    states/                     ← 画面。ここが主役
      HomeState.js  RenderMenuState.js  FunkinMenuState.js  OtherMenuState.js  ContributorsState.js
      EditorState.js            ← 3エディタ共通の親（persistent / HUD / 未保存確認）
      AnimateEditorState.js     ← 入れ物。中身は animate/ に分離
      SparrowEditorState.js
      CharacterEditorState.js
      StageEditorState.js        ← Stage Editor（Funkin' Editor の中。画面クラスは入れ物だけ）
      animate/  template.js(HTML)  editor.js(ロジック)  partsPanel.js(パーツ管理パネル)
      sparrow/  template.js  editor.js
      character/ template.js  editor.js
      stage/     template.js  editor.js  stageData.js  stageCharacter.js  atlas.js  sparrowAtlas.js
    ui/Hud.js                   ← 上部バー（Undo/Redo/Home/言語）
    ui/Viewport.js              ← 全画面プレビューのパン/ズーム（= FlxCamera）。グリッド・基準線も描く
    ui/HudPanels.js             ← Hud パネルの表示/非表示（個別・一括・記憶）
    services/                   ← 画面に属さない機能
      i18n.js  Autosave.js  ColorLab.js  UnsavedGuard.js  MobileFilePicker.js
    data/contributors.js        ← クレジットのデータ
  css/  images/  build.py  dist/      ← css/hud.css が「全画面プレビュー + Hud」の共通スタイル
```

## 画面遷移

```
home ─┬─ renderMenu ─┬─ animate   (HUD)
      │              └─ sparrow   (HUD)
      ├─ funkinMenu ──── character (HUD)
      └─ otherMenu ───── contributors
```

## State のライフサイクル

| メソッド | Haxe での相当 | 呼ばれるとき |
|---|---|---|
| `create()` | `create()` | 画面が作られた直後（HTML は挿入済み）。ボタンの配線はここ |
| `onShow(params)` | `postCreate` / resume | 表示されるたび |
| `onHide()` | pause | 隠れるたび（再生を止めるなど） |
| `update(elapsed)` | `update(elapsed)` | 毎フレーム。**上書きした画面でだけ**ループが回る |
| `destroy()` | `destroy()` | 破棄されるとき |
| `canLeave(nextId)` | （なし） | 画面を出る前。`false` で遷移を止める |

- **非 persistent**（メニュー系）: 離れると `destroy()` され、DOM も消える。入るたびに作り直し。
- **persistent**（エディタ系）: 離れても破棄せず `onHide()` だけ。戻ると `onShow()`。
  開いているアトラスと Undo 履歴を失わないための仕組みです（旧版も「隠すだけ」だったので挙動は同じ）。

## 新しい画面を作る手順

1. `states/SettingsState.js` を作る

   ```js
   import { State } from "../core/State.js";

   export class SettingsState extends State {
     static id = "settings";
     static template = `
       <div id="settingsScreen">
         <h1>Settings</h1>
         <button id="settingsBack">← 戻る</button>
       </div>`;

     create() {
       this.goOnClick("#settingsBack", "home");
     }
   }
   ```
2. `main.js` に `import { SettingsState } ...` を足し、`app.states.register(...)` に追加
3. どこかのボタンから `this.goOnClick("#ボタン", "settings")` で飛ぶ
4. HUD が要るなら `static hud = true; static hudLabel = "..."; static hudBack = "戻り先id"`
5. 開いたデータを保持したいなら `extends EditorState`（persistent になる）

## 画面どうしの連携

`window.xxx` のグローバルは廃止しました。

- 呼ぶ → `this.app.switchTo("id")`、`this.app.hud.setHistory(...)`、`this.app.states.get("animate").api`
- 知らせる → `this.app.events.emit("asset-mutated")`、聞く → `this.app.events.on("language-changed", fn)`
  （`on` は解除関数を返す。`this.addDisposer(解除関数)` で破棄時に自動解除）
- `document` / `window` のイベントは `this.listen(document, "keydown", fn)`。
  その画面が表示されている間だけ有効になります。

## 「全画面プレビュー + Hud」方式（Character Editor 3.0〜。ステージエディタもこれで作る）

画面いっぱいの `<canvas>` を土台にして、操作パネルはすべて `.hudLayer` の上に重ねる。

```html
<section class="hudWorkspace" hidden>
  <canvas></canvas>                         ← Viewport（パン/ズーム）が操作する
  <div class="hudLayer">
    <button data-hud-all>👁</button>          ← 全 Hud を一括で隠す/戻す（H キー）
    <div data-hud-panel="bar" data-hud-always>… <button data-hud-toggle="files">…</div>
    <div class="hudDock hudDockLeft"><aside class="hudPanel" data-hud-panel="files">…</aside></div>
  </div>
</section>
```

```js
const vp = new Viewport(canvas, { state, originY: 0.72, onChange: draw });  // ホイール=ズーム / 中・右ドラッグ・Space+ドラッグ=パン
const panels = new HudPanels(state.root, { storageKey: "stage" });          // 表示状態は localStorage に記憶
// draw() の中: vp.drawGrid(ctx); const o = vp.origin(); ctx.translate(o.x, o.y); ctx.scale(vp.zoom, vp.zoom);
```

- 左クリックのドラッグは各エディタが自由に使える（`if (vp.panning) return;` でパン中だけ譲る）。
- 基準フレーム（足元の基準点）は V-Slice の `BaseCharacter.characterOrigin` に合わせ、`danceRight`/`danceLeft`/`idle` の先頭フレームから決める（XML の先頭ではない）。
- 狭い画面（<900px）では `narrowExclusive` に挙げたパネルは同時に1つしか開かない。

## Stage Editor（states/stage/）

「全画面プレビュー + Hud」方式の2つ目の画面。部品の役割:

| ファイル | 役割 |
|---|---|
| `stageData.js` | ステージ JSON（v1.0.2）の正規化・既定値・scale/色/blend の変換・保存用の文字列化。DOM に触らない純粋な関数群 |
| `sparrowAtlas.js` | PNG + XML / Packer TXT の読み込みと切り出し描画（Character Editor と同じロジック） |
| `atlas.js` | Sparrow / Packer / AnimateAtlas（新旧）を共通の「フレーム」にそろえる。ファイル群から assetPath に合うアトラスを探す（フォルダ選択の相対パス対応）。prop とキャラの両方が使う |
| `stageCharacter.js` | character.json + アトラスから、ステージ上での足元・枠・カメラ焦点を計算して描く（V-Slice の座標規則。出典はコメント参照）。renderType は sparrow / packer / multisparrow / animateatlas / multianimateatlas |
| `editor.js` | 描画・選択/ドラッグ・レイヤー一覧・プロパティ欄・履歴・保存 |

- 座標: prop の `position` は「スケール後の左上」、キャラの `position` は「足元」（Stage.hx）。zIndex が小さいほど奥。
- 視差: `screen = pos − camera × scroll`。プレビューのカメラ位置（保存されない）を動かして scroll を確認する。
- 履歴: 確定のたびにステージ全体を JSON 文字列で積む（`history[hi]` が現在）。入力途中の `input` では積まず、`change` で積む。
- 知らないキー（animations / danceEvery など）は消さず、保存時もそのまま出す。エディタ専用の `_ed`（隠す）だけ取り除く。
- アニメ付き（Sparrow）prop: `animations` が1つ以上ある prop は PNG + 同名 XML で表示する（XML は「画像・XML を登録」で一緒に選ぶと assetPath と同名で自動結び付け。プロパティの「アニメ」で先頭フレームを切り替え、▶で再生プレビュー）。PNG と XML を同時に「＋画像prop」へ選ぶと animations の雛形を XML から作る。基準枠は XML 先頭フレーム、アニメの offsets は描画位置を −offset×scale ずらす（Bopper 準拠）。
- **形式ごとの読み込み**（`atlas.js`）:
  - prop の `animType`: `sparrow`（PNG+XML）/ `packer`（PNG+TXT。アニメは `frameIndices` = TXT の行順の番号）/ `animateatlas`（フォルダ = `Animation.json` + `spritemapN.json` + `spritemapN.png`）。
  - AnimateAtlas は assetPath がフォルダなので、フォルダ名（最後の1つ）で結び付ける。PC は「フォルダごと登録」、スマホはファイルをまとめて選ぶ（まだ画像の無い AnimateAtlas の prop が1つだけなら自動で結び付き、複数あるときは一覧の「選択」から）。
  - キャラは「基準アニメ」が使うアトラスだけあれば表示できる。Multi 系はアニメごとの `assetPath` / `renderType` で形式が決まる（multisparrow = 通常 Sparrow、`renderType: animateatlas` のアニメだけ AnimateAtlas / multianimateatlas = 通常 AnimateAtlas、`renderType: sparrow` のアニメだけ Sparrow）。
  - AnimateAtlas の枠 = 描いた全スプライトを囲む四角（基準は先頭フレーム）。`atlasSettings.applyStageMatrix` が true ならステージ原点を基準枠に固定、既定では各フレームの枠の左上を基準枠に合わせる。**この配置は FlxAnimate の実装を確認できていないための推定**で、実機とずれる可能性がある。
- 未対応: AnimateAtlas への色（Color）の反映、`custom` の renderType、拡大縮小ハンドル、複数選択、自動保存（復元パネルは Animate 専用）。

## 旧版からの挙動の違い（意図したもの）

- 編集画面から出るときの未保存確認は「編集画面を出るとき」に統一（旧版は Home 画面のボタンにも付いていた）
- Character Editor で、画面を離れると再生が止まる（旧版は裏で再生し続けていた）
- 見た目・HTML の id/class・CSS は変更なし（旧版とスクリーンショットがピクセル一致）
  ※ Character Editor だけは 3.0 で UI を刷新（id は従来どおり）。flipX プレビューのずれも修正

## ビルド

```bash
python funkin-studio/build.py      # → funkin-studio/dist/Funkin_Studio.html
```

- ES Modules は `file://` では読めないので、オフライン版は `build.py` が全モジュールを1つの `<script>` にまとめます。
- そのため **import は1行で書く**、**export は `export class/function/const/let` のみ**（`export default` は使わない）という規約があります。
- ローカルで動かすときは簡易サーバーが必要です: `python -m http.server` → `http://localhost:8000/`
  （GitHub Pages ではそのまま動きます）

## デバッグ

ブラウザの開発者コンソールで `app` が使えます。`app.switchTo("sparrow")`、`app.states.current` など。

## モバイル対応メモ

- **ファイル選択**: スマホでは `accept` が「画像だけ」以外の `<input type="file">` から `accept` を外す（`services/MobileFilePicker.js`）。`image/*` を含むと画像選択（フォト）画面になり XML が選べない／`.json` `.xml` だけだと MIME 不一致でグレーアウトするため。種類のチェックは拡張子と読み込み時のエラーで行う。PC では何もしない。

## アプリ情報（appInfo）

- `core/appInfo.js` に `SUPPORTED_VERSIONS`（対応している V-Slice のバージョン範囲）を1か所だけ置き、ヘッダー表示（`ui/Hud.js`）と、書き出す character.json の `generatedBy`（`Funkin' Studio (0.8.6-0.8.8)` の形）が同じ値を使う。
- `generatedBy` はユーザーが編集できない。Character Editor で書き出すとき、元ファイルに別の値があっても常にこの値へ上書きする。対応バージョンを上げるときは `SUPPORTED_VERSIONS` だけを書き換える。
