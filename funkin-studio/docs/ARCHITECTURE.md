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
      animate/  template.js(HTML)  editor.js(ロジック)  partsPanel.js(パーツ管理パネル)
      sparrow/  template.js  editor.js
      character/ template.js  editor.js
    ui/Hud.js                   ← 上部バー（Undo/Redo/Home/言語）
    ui/Viewport.js              ← 全画面プレビューのパン/ズーム（= FlxCamera）。グリッド・基準線も描く
    ui/HudPanels.js             ← Hud パネルの表示/非表示（個別・一括・記憶）
    services/                   ← 画面に属さない機能
      i18n.js  Autosave.js  ColorLab.js  UnsavedGuard.js
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
