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
      ChartEditorState.js        ← Chart Editor（同上）
      animate/  template.js(HTML)  editor.js(ロジック)  partsPanel.js(パーツ管理パネル)
      sparrow/  template.js  editor.js
      character/ template.js  editor.js
      chart/     template.js  editor.js  chartData.js  audio.js  zip.js
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

## ファイルの山（pool）と読み込み方式（Stage Editor）

- 選んだファイルは全部 `pool`（`File` の配列。中身は読まない）に集まる。キャラの読み込みと prop 画像の自動結び付けは、必要になったときだけ pool から探して読む。
- 探し方（`atlas.js` の `matchFile`）: ①置き場所つきの名前の末尾が assetPath と一致 → ②ファイル名（拡張子なし）が一致。フォルダごと選ぶと `webkitRelativePath` が入るので、`images/characters/bf.png` のように完全に特定できる。
- **キャラの読み込みは2方式**:
  - 一括: character.json とアトラスを一度に選ぶ（従来どおり）。
  - 分散: ①character.json だけ選ぶ（`StageCharacter.setJsonFrom`）→ ②アトラスのファイルを別フォルダからでも何度でも足す（足すたびに `resolve(pool)` を再試行）。「mod フォルダ全体を登録」で pool に入れておけば②は不要。
- stage.json を開いたとき・ファイルを足したときに、画像の無い prop を pool から自動で結び付ける（`linkFromPool`）。

## 重さの対策（v3.8 / v3.9）

- **画像は ImageBitmap で持つ（v3.9。XML+PNG で固まる主因）**: `<img>` のままだと、ブラウザは「デコードした画像」を容量の上限つきのキャッシュに置き、あふれると捨てる。大きなアトラスが何十枚もあると、毎フレーム捨てられた PNG をデコードし直して画面が固まる。`loadImage`（`stage/sparrowAtlas.js`）は `createImageBitmap` を使い、デコード済みのピクセルを持ち続ける（`naturalWidth/Height` も付けて、既存コードと互換）。計測（40アトラス（2048²）・120 prop を再生）: 1フレーム約620ms → 16.7ms（60fps）、読み込み 4.1秒 → 1.2秒。
- **色（tint）はスプライト1枚単位（v3.9）**: 以前はアトラス全体を色付きで作り直していた（大きいと数百ms 固まる・メモリを食う）。今は使うスプライト1枚分だけ小さなキャンバスに作って覚える。
- **Autosave**: 以前は4秒ごとに Animation.json / spritemap 全体を `JSON.stringify` して変化を調べていた（数十MBだと周期的に固まる可能性）。今は「確実に変化したかも」の印（ポインタを離した・キー入力・入力欄の変更）と軽い指紋（Undo 件数・シンボル・フレーム・画像）で、変化がないときは何もしない。判定はポインタ操作中を避け、手すき（`requestIdleCallback`）に行い、判定で作った文字列を保存にも使い回す。
- **AnimateAtlas の描画**: フレームごとの「スプライト+行列」の一覧を初回だけ作って使い回す（毎回タイムラインをたどり直さない）。シンボルは表（Map）で引く。描画はスプライトごとの `save/restore` をやめ、`setTransform` に変更。
- **フレーム列の探し直し**: `frames()`（prefix での絞り込みと並べ替え）の結果を、アトラスごとに覚える。Character Editor の `sparrowFrames` も同様。
- **Stage Editor の描画ループ**: 画面の外の物は描かない。再生中の描画頻度は、アニメの最大フレームレートまでに抑える。
- 備考: Character Editor / Sparrow Editor / Animate Editor の画像は従来の `<img>` のまま（アトラスは基本1枚なので、上の問題は起きにくい）。


## 実行ランタイム（js/runtime/）— プレイテストで .hxc の演出を動かす
- **hscript.js**: HScript（Haxe のサブセット）の自前インタプリタ。class / extends / var / function / if / for / while / switch / try / 関数式 / アロー関数 / Map・配列・匿名オブジェクトリテラル / 文字列補間 / `??` `?.` に対応。未対応の構文は行番号つきで知らせる。知らない名前は「スタブ」（呼んでも落ちない代役）になり、使われたものが未対応APIとして集まる。無限ループは 400 万ステップで打ち切る。
- **runtime.js**: 演出に使われやすい API だけを再現した軽量な環境。`PlayState.instance`（camGame / camHUD / camCutscene、add / insert / remove / members）、`FlxSprite`（makeGraphic の単色）、`FlxText`、`FlxTypedGroup`、`FlxTween`（tween / num）、`FlxEase`（Flixel と同じ式）、`FlxColor`、`FlxG.signals.postUpdate`、`Conductor.instance.songPosition`、`ModuleHandler.getModule`、`NoteStyleRegistry`、`Grayscale` + `ShaderFilter` など。`SongEvent` / `Module` の基底クラス（`processOldEvents`・`onSongLoaded` / `onSongRetry` / `onSongEnd` / `onPause` / `onResume`）も同じ動き。開始のたびに `new Runtime` で作り直す（スクリプトの状態も新品）。
- **glpost.js**: シェーダー（フィルター）を持つカメラだけ、2D キャンバスの絵を WebGL のフラグメントシェーダーに通す（普通のカメラは追加コスト 0）。フィルター用の絵は最大幅 1280px に抑える。WebGL が無ければ素通し。
- **noteStyle.js**: V-Slice の notestyle JSON（note / holdNote / noteStrumline、fallback の連鎖）+ PNG/XML を読み、ノーツ・ホールド・ストラムを描く。`Change Note Skin` のスクリプトは本物と同じコードのまま動き、`strumline.noteStyle` が書き換わると描画も切り替わる。
- **未対応（スタブになる）**: ステージ上のキャラ（`currentStage.getBoyfriend()` など → Change Character / Force Play Animation / Sing Suffix は動作せず警告）、画像つきスプライト、フォント読み込み、`.frag` の読み込み。結果画面に「エラー」と「未対応API」の一覧が出る。

## Chart Editor（states/chart/）
- **データ**（`chartData.js`）: V-Slice 0.8.x の `SongData.hx` に合わせた metadata / chart の既定値・整形・書き出し。`version` と `generatedBy` は書き出しのたびに上書き。知らない欄は消さずに残す。組み込みイベント7種（FocusCamera / ZoomCamera / ScrollSpeed / SetCameraBop / SetHealthIcon / PlayAnimation / SetTargetBopSpeed）は `EVENT_SCHEMAS`（0.8.6 の `getEventSchema` を写したもの）。フォームはこのスキーマから自動生成。スキーマに無いイベントは value を JSON で編集。
- **時間**: ノーツ・イベントは ms で保存。グリッドの位置は `Timing`（`Conductor.hx` と同じ式: beatLength = 60000/bpm × 4/分母、1拍 = 4 step）で step に変換する。
- **列**: 左から 相手(d=4-7) / プレイヤー(d=0-3) / イベント。`noteDataToGridColumn` と同じ入れ替え。
- **ファイル**: `.fnfc`（= ZIP。`manifest.json` + `<id>-chart[-var].json` + `<id>-metadata[-var].json` + `Inst[-id].ogg` + `Voices-<char>[-var].ogg`）を `zip.js` で読み書き（読みは DecompressionStream、書きは無圧縮）。JSON と音声は複数選択で一度に、または「追加」であとから足せる。
- **音声**（`audio.js`）: Web Audio。トラックごとに音量・ミュート・波形（10ms ごとのピーク）。いまのバリエーションで使うトラックだけが鳴る。再生位置は AudioContext の時計から計算。
- **履歴**: Stage Editor と同じ JSON スナップショット方式（variations 全体 + いまの難易度）。選択は Undo で解除。
- **背景**: Chart Editor は作業領域を固定の暗い色（`#161a21`）で描く。テーマの `--studio-canvas`（明るい色）は使わない（目が疲れるため）。
- **イベントのスクリプト**（`scriptEvents.js` の `parseHxc`）: `.hxc` の `SongEvent` / `ScriptedSongEvent` / `ScriptedNoteKind` を静的に読む（HScript は実行しない）。`super('ID')`・`getTitle`・`getEventSchema`（配列 / `new SongEventSchema([...])`、`SongEventFieldType.*`、`keys: ['表示' => '値']`）から、`registerEventSchema` で `EVENT_SCHEMAS` に追加し、フォームを自動生成。選択肢が関数で作られる enum は文字列欄にして警告。読み込んだ内容は localStorage（`funkinStudio.chart.eventScripts`）に残る。`.hxc/.hx/.txt/.zip/.fnfc` をまとめて読める。
- **プレイテスト**（`playtest.js`）: 現在の難易度・バリエーションの譜面をそのまま遊ぶ。キーは D/F/J/K（設定で変更可）、スマホは画面タップ。V-Slice PBOT1 の判定（sick ≤45ms / good ≤90 / bad ≤135 / shit ≤160）とスコア式を使用。入力時刻は `event.timeStamp` から押した瞬間の曲位置を逆算し、入力オフセットを引いて判定。結果にズレのヒストグラムと平均ズレ → 「ズレを補正」でオフセットへ反映。BOT・開始位置・速度・再生速度・ヒット音も設定可。
- **未対応**: ノーツ種類（kind）ごとの params スキーマ、スクリプトが定義するノーツ種類の params、beatTuplets（`bt`）の編集（値は残す）、ライブ入力。

## ModPack / 仮想ファイルシステム (v3.13)

`js/services/ModPack.js` が、フォルダ選択・zip・単体ファイルを同じ形で扱う。

- 原因: 以前は basename / 末尾フォルダ名 / 最初に見つかったものでアセットを探していたため、別 mod の同名ファイル（`sky.png` など）を取り違えた。
- 解決: `infoOf` でパスから「ルート(images/data 等)以降のパス・origin(mod フォルダ)」を求め、`scorePath` で点数付け。JSON と同じ origin を優先し、同点で候補が複数あれば `assetNote` で警告する。
- basename だけの一致は、ディレクトリ情報のない単体ファイルにだけ許す。
- zip は `openZipLazy` で一覧だけ読み、`LazyZipFile.blob()` で必要な時にだけ展開（スマホ向け）。
- ノートスキン（runtime/noteStyle.js）も同じ規則（パス + origin）で画像/XML を選ぶ。
- 次版: プレイテストへステージ・キャラ追加（同じ pool を使う）。
- v3.13.1: `assets/shared/images/…` や `preload/images/…` の shared / preload は「ラッパー」として飛ばし、images/ をルートにする（origin は shared の手前まで）。assetPath 末尾の `/*` はフォルダ指定として無視。
- v3.13.2: `resolveAsset(pool, kind, assetPath, {origin})` を追加。kind = image/xml/icon/sound/music/song/character/stage/notestyle/script。V-Slice と同じ指定（images/・sounds/・music/・songs/・data/characters/ …以降）で、shared/ や mod 直下のどちらにあっても、同じ mod を優先して 1 つ選ぶ。次版（プレイテストのステージ/キャラ/音）はこれを使う。

## v3.14: Workspace / ModExport
- `services/Workspace.js`（`app.workspace`）: ホームで読み込んだ mod（zip / フォルダ）を全エディタで共有。`atlasFor`・`resolve`・`toFile`。増えると `workspace:changed` を流す。
- `ui/ModPicker.js` + `ui/modLists.js`: Sparrow / Animate / Character / Chart に「読み込み済みの mod から選ぶ」欄。既存の `<input type=file>` に流し込んで、いつもの読み込み処理を動かす。Character は assetPath のアトラスを自動登録。Stage は workspace を pool に取り込む。
- `services/ModExport.js`: 書き出しは mod の zip ごと（`exportMod` / `queueExport`）。編集したファイルを mod 内の正しい場所（data/stages・data/characters・data/songs・images …）に置き、元の mod 全体も含める（ホームの設定で切替）。
- 大きな PNG（辺 > 上限）は縮小してデコード（`loadImage` の `k`）。Stage の「大きな画像の縮小」で上限を変更。描画要求は `requestDraw` で 1 フレームに 1 回へ間引く。
- Character Editor: scale / singTime / danceEvery / isPixel / startingAnimation / cameraOffsets / healthIcon / death を編集可能。既定値のままで元から無い項目は JSON に書かない。

## v3.15: Note Editor
- `states/note/`（`nte*`）: noteStyle（data/notestyles/*.json）の編集。プレビューは runtime/noteStyle.js の NoteStyle を使い、1 レーン = 112px の実寸で 受け皿(Static/Press/Confirm)・ノーツ・ホールド・スプラッシュ・ホールドカバー を表示。絵のドラッグで offsets（グループ全体 / アニメ個別）が動く。fallback の連鎖（funkin など）も workspace から探して読む。
- `framesByPrefix`: 短い prefix（"purple"）が "purple hold piece0000" まで前方一致する問題を避け、「prefix の直後が数字だけ」のフレームを優先する。
- offsets はゲーム上のピクセル。プレイテストの描画にも offsets を反映（以前は無視していた）。
- 書き出し: 元の mod のファイルは、編集した mod のフォルダの分だけ zip に含める。出力先のフォルダ名は元の mod と同じ大文字小文字に戻す。
- v3.16: Note Editor に「判定・スクロール」。表示を「スクロールテスト」にすると、8 分音符のノーツ（たまにホールド）が `y = 受け皿の y ± (t − T) × 0.45 × 速度` で流れ、判定の時刻（受け皿の中心）で消えて Confirm / スプラッシュ / ホールドカバーが出る。アップ/ダウンスクロール・速度・BPM・判定幅（Sick/Good/Bad/Shit。初期値 45/90/135/160ms）を変えられる。ノーツと受け皿の offsets の差も表示。
- v3.17: 標準 noteStyle「funkin」を内蔵（`runtime/builtinFunkin.js`。自動生成の JSON + PNG(base64) + XML）。`NoteStyleSet.loadBuiltin("funkin")`。fallback に funkin があるのに mod に funkin.json が無いときに使う（mod 側にあればそちらを優先）。書き出す mod の zip には含めない。ホールドの offsets は `drawHold` が足す（プレイテストにも反映）。`parseSparrowXml` は BOM 付き XML も読める。

## v3.18 プレイテストのステージ・キャラクター（runtime/stageScene.js）
- `StageScene`: Workspace（読み込んだ mod）からステージ JSON / character JSON / アトラスを探して描画。props（単色・画像・Sparrow/Packer/AnimateAtlas）と BF/DAD/GF を zIndex 順に、1280×720 枠・カメラ（scroll/zoom/視差）で描く。
- 拍で idle/danceLeft/danceRight、ノートで singX / singXmiss、FocusCamera / ZoomCamera、4拍ごとの軽いズーム。
- mod に無いもの（ベースゲームのステージ・キャラ・画像）は点線の仮枠 + 警告（結果画面に表示）。入れ物は必ず存在するのでスクリプトが落ちない。
- `Runtime.attachScene(scene)`: `ps.getBoyfriend/getDad/getGirlfriend`, `ps.currentStage`, `currentCameraZoom`, `cameraFollowPoint` を代役として公開。
- 未確認の近似: カメラ追従 lerp 0.04、4拍ズーム 0.015、sing→idle の戻り時刻、反転キャラのオフセット符号。
- オプション「ステージとキャラクターを表示」（chtPlayScene）。

## v3.19 スクリプトからのキャラ生成・NoteKind
- `CharacterDataParser.fetchCharacter(id)` / `listCharacterIds()`（runtime.js `attachScene`）。mod の data/characters/*.json を id で引き、アトラスは裏で読む（読み終わるまでに呼ばれた `playAnimation` は読めた直後に再生）。見つからなければ null。
- `PlayState.currentStage.add/remove/insert/refresh`、`PlayState.currentStage` / `getBoyfriend()` 等の静的アクセス。`method.apply(対象, [引数])` / `.call` も受け付ける（hscript.js `callMethod`）。
- NoteKind（V-Slice 0.8.7 `NoteKindManager` 準拠）: `NoteKind` / `ScriptedNoteKind` 基底（noteKind/description/noteStyleId/params/noanim/suffix/scoreable、getNotes/getOtherNotes）、組み込み `noanim` / `non_scoreable`。そのノートの kind と全 Module に onNoteIncoming / onNoteHit / onNoteMiss / onNoteHoldDrop を送る。`event.cancel()` でヒット・ミスの標準処理を止められる。noanim で歌わない、suffix（alt など）付きの sing（無ければ `-xxx` を外して探す）、kind の noteStyleId でノートの絵を変える、scoreable=false は採点・分母から除外。
- 継承元の組み込みメソッドを `this` なしで呼べるようにした（`getNotes()` など）。
- 実ソースに合わせた修正: miss 後の戻りは singTime×2、`-hold` を終了後に続けて再生、`-end` があれば歌い終わりに再生。4拍ズーム(1.015倍・0.95減衰)と追従 lerp 0.04 は実ソースと一致を確認。
- 未確認/近似: onNoteIncoming を送る距離（2000ms 先）、Module の onCreate 等の呼び出し順、キャラの反転オフセット。

## v3.20（#32–#35）
- **playAnimation**: V-Slice の Bopper/BaseCharacter に合わせて `playAnim(name, restart, ignoreOther, reversed)`、`-alt` 落とし、未知アニメは無視、特殊アニメはビートの dance で潰さない。
- **NoteKind スクリプト**: `scripts/notekinds/*.hxc` を mod 読み込み時に自動取り込み（Chart Editor の scripts 欄にも手動追加可）。
- **未対応 API の実装**: `Paths.getSparrowAtlas/sound`、`FunkinSound.load/play/stop`、`HapticUtil.vibrate`（no-op）、`camGame.shake`、`Preferences.get_downscroll`、`NoteStyleRegistry.fetchDefault`、`NoteSprite.animation.addByPrefix/play`・`offset.set`・`frames`。スクリプトが絵を差し替えたノートは `drawNoteSprite` で描画。`songEnd` で `stopAll`。
- **Note Style Editor を V-Slice 0.8.7 の配置に合わせ直し**（`runtime/noteStyle.js` 冒頭コメント参照）:
  受け皿 = 左上 (lane*112−28.6+off.x, off.y)・大きさは atlas 最初のフレーム×scale / ノーツ中心 x = lane*112+50（note の offsets は無効）/ ホールドの offsets は引き算 / スプラッシュ・カバーは offsets×scale。アニメ個別 offsets は本編で読まれないので編集不可。strumline 既定位置: 上スクロール y=24、下は H−高さ−24−offsets.y。
  エディタは既定で内蔵 funkin を読み込み、ドラッグの移動量も上記の符号・scale で offsets に変換する。

## v3.20.1（バグ修正）
- ホールド画像の列順を修正: 8 列は「1の胴体・1の終端・2の胴体・2の終端…」。胴体 = 列 lane*2、終端 = lane*2+1（SustainTrail.hx の uv と同じ）。
- プレイテスト/ステージの AnimateAtlas（キャラ・アニメ付き prop）は、タイムラインの原点を基準フレームに固定して描く。フレームごとに枠の左上へ寄せていたため、動くたびに位置が跳ねていた。

## v3.21 — Public Playtest (0.9 preview) 対応
- ModPack: アンカーに `gameplay` / `ui` を追加。`gameplay/{characters,stages,notestyles}/<id>/<id>.json`（新配置）と `data/<dir>/<id>.json`（従来）の両方を `listData` / `resolveAsset` が解決する。
- ease: `INSTANT`（即座に移動）を FocusCamera / ZoomCamera / ScrollSpeed で実装。`easeByName()` が INSTANT のとき null を返し、各所で瞬時に適用。
- スクリプト側の `x/y/getMidPoint/feetPosition` は V-Slice と同じくグローバルオフセット込みで返す（見た目の `place()` は元から V-Slice 式）。
- 新イベント: ScrollVelocity（runtime/scrollVelocity.js の ScrollVelocityTimeline / VisualClock）、RenderDistance、BopCameraOnce、CustomEvent（Runtime.startCustom/updateCustom → `onCustomEvent`。継続は StageScene の timing で step→ms 変換）。
- 譜面メタデータ版 2.2.8。ScrollSpeed に useStart/startScroll。

### v3.22 — 0.9 の曲・書き出し配置
- 曲: 0.9 は `gameplay/songs/<id>/` に metadata / chart / Inst / Voices / 字幕をまとめる。`ui/modLists.songList` は 0.8（data/songs + songs）と 0.9 の両方を拾い、`resolveAsset("song")` も `gameplay/songs/<id>/…` を完全一致で解決。
- 書き出し: `ModPack.detectLayout(pool)`（gameplay/ があれば 0.9）・`songDirOf` / `songAudioDirOf` / `registryPath`。Chart Editor には配置の選択（自動 / 0.8 / 0.9）を追加。Stage / Character / Note Style も自動判定で `gameplay/<dir>/<id>/<id>.json` か `data/<dir>/<id>.json` に出す。

### v3.23 — 本体アセット（FunkinCrew/Funkin.assets）を GitHub から取得
- `services/FunkinAssets.js`: `RemoteFile`（LazyZipFile と同じ使い方。中身は読まれたとき raw.githubusercontent.com から取得・キャッシュ）、同梱のパス一覧 `funkinAssetsIndex.js`（画像は入れない）+ ツリー API での更新（1 日 1 回）、`ensureCharacter / ensureStage / ensureAtlas / ensureFor`、`noteStyle(id)`。
- 方針: mod に同じものがあれば mod が先。無いものだけ、必要な分（JSON と、それが使うアトラス）を Workspace に origin `funkin.assets` で足す。`defaultOrigin` / `summary` / 書き出し先には数えない。
- StageScene.load が `o.ensure()` を呼ぶ（ステージ・キャラ・props 画像）。スクリプトの `fetchCharacter(id)` も本体のキャラを取得して組み立てる。
- NoteStyleSet.loadBuiltin は本体から JSON+画像を取得（取れなければ内蔵の funkin）。プレイテストの既定ノートスタイルは `funkin`（矢印は「矢印（スキンなし）」）。
- ホーム画面にオン/オフ。テスト・ミラー用: `globalThis.__FUNKIN_ASSETS = { raw, tree }`。素材は © The Funkin' Crew Inc.（書き出す zip には含めない）。

### v3.23.1 — 本体画像の内蔵を廃止
- `runtime/builtinFunkin.js`（内蔵の標準 noteStyle・約 2.5MB）を削除。取れなかったとき（オフライン等）は従来どおり、ノートは矢印、キャラ/ステージは点線の仮の枠で動く（警告に理由が出る）。

### v3.23.2 — プレイテストのロングノーツ（ダウンスクロール / 相手側）
- `NoteStyle.drawHold` の yHead / yTail は「strumline 左上の y + 流れた距離」。playtest は `y - oy`（= 距離 + 57k）を渡していて、受け皿が画面上端付近にあるアップスクロールでだけ偶然合っていた → `oy + (y - strumY)` に修正（ダウンスクロールで胴体が受け皿から大きく離れていた）。
- 相手側のロングノーツは、終わっても `holding` が true のまま残り、受け皿の位置に描かれ続けていた → 終了時に `holding = false`。

### v3.24 — 毎回取得 / ブランチ切替 / ステージスクリプトとシェーダー
- 本体アセットは保存しない。プレイテスト開始のたびに `FunkinAssets.reset(ws)`（取得バイト列を破棄・Workspace の remote ファイルを `dropRemote()`）→ `refreshIndex()` → `noteStyles.dropBuiltin()` で作り直す。取得は `Promise.all` で並列（`ensureFor` / `ensureStage` / `ensureCharacter`）。`cache: "no-store"`。
- ブランチ: `BRANCHES` = `main`（0.8 配置）/ `preview/public-playtest`（0.9 配置）。ホームの `#homeBranch`。配置ごとにパス規則が違う（`rp()` で preload/shared を外す）。ツリー API のブランチ名は `encodeURIComponent`。
- ステージスクリプト: `stageScripts(id)` が main の .hxc と、そこから（推移的に）クラス名で参照されている props / シェーダー .hxc、`Paths.frag()` の .frag だけを取得。補助が取れなくても他は動かす。Runtime は `bases.Stage / ScriptedStage / FlxRuntimeShader` を持ち、`startStages()` と onUpdate / onStepHit / onBeatHit を呼ぶ。
- シェーダー: `runtime/shader.js`（FlxRuntimeShader の代役）＋ `runtime/glpost.js`（OpenFL の .frag を WebGL2 に翻訳、prop ごとに適用）。
- 効果音: `FunkinAssets.findSound(name)`（`sounds/*.ogg` を索引に追加）。`Runtime.makeSound` は mod に無ければ本体から取る。0.9 はリポジトリパスそのまま。
- 未対応: HScript の getter/setter 構文など（PicoBloodPool 等のスクリプト）は解析エラーとして報告される。

### v3.25 — 実スクリプト互換 / FNF テーマ / 描画の最適化
- **0.9 の全 .hxc（124 本）をパースできる**ようにした（実リポジトリの preview/public-playtest で検証）。hscript.js: アロー関数の本体 `{ … }` / `return x` / 式（`arrowBody()`）、条件付きコンパイル `#if … #else … #end`（FEATURE_* は常に偽）、`var x(default, set):T`（アクセサは無視してふつうの変数）、`import a.b.C as D`（別名 → `aliases`）。
- ランタイム: `FlxG.random.bool/sign`、`FlxCamera.fade/flash/stopFX`（`overlays()` で重ね描き）、`FlxTween.cancelTweensOf`、`FlxObject.velocity/acceleration`（`move(dt)`）、stage prop の `velocity/active`、`Assets.cacheSound/cacheFlxGraphic`、`FlxG.sound.list`、`PlayState.currentSong.id`、`loadGraphic()` がチェーンできる。
- ネイティブシェーダー: `AdjustColorShader`（`runtime/shader.js makeAdjustColorShader`。.frag は `NATIVE_FRAGS` で自動取得）。未実装: OverlayBlend / RuntimeRainShader / WiggleEffectRuntime / BlurFilter / SserafimShader（追加テクスチャが要る）、FlxTiledSprite / FunkinTiledSprite / FunkinSkewedSprite。
- 効果音: `FunkinAssets.findSound()`（`sounds/*.ogg` を索引に追加）。
- テーマ: `css/theme-fnf.css`（theme-navy を置き換え。暗いグレー + 黄色の強調 + 角を立てた枠）。英数字フォントは `services/uiFont.js` が funkin.assets の VCR OSD Mono（main: `fonts/vcr.ttf` / 0.9: `ui/fonts/VCR OSD Mono.ttf`）を FontFace で取得。日本語は端末の等幅フォント（`--font-ui` の後ろの候補）。フォントは同梱しない。
- ウォーターマーク: `core/appInfo.js` の `SUPPORTED_VERSIONS = "0.8.6-0.8.8 With 0.8.9+"`（書き出す generatedBy にも反映）。
- 最適化: シェーダーを掛けた prop は、フレーム・uniform・大きさが前回と同じなら出力を使い回す（`drawPropShaded` の `shadeMemo`。毎フレーム変わるものは 3 回外れたら使い回しをやめる）。ソフトウェア描画の計測で 1 フレーム 99ms → 34ms。

### v3.26 — Chart / Stage Editor を FNF 本体のエディタの配置に
- 本物の構成（`Funkin.assets/exclude/ui/editors/**`）: `main-view.xml` = 「上: メニューバー / 中: 空き / 下: playbar（Stage は bottom-bar）」、操作パネルは `toolboxes/*.xml` のドラッグできるウィンドウ。メニューは Chart: File / Edit / View / Audio / Test / Window / Help、Stage: File / Edit / View / Windows / Help。
- 新しい共有部品 `ui/FnfShell.js` + `css/fnf-shell.css`。既存の Hud 画面（HudPanels）に後から被せる:
  - メニューバー: `{ text, items: [{ text, click: "#id" | run | toggle: "panel", key, check }] }`。クリック項目は既存ボタンを `.click()` するだけなので、機能・id・イベントは変わらない。ホバーで隣のメニューへ切替、Esc / 外クリックで閉じる、✓ は HudPanels の開閉と連動。
  - ツールボックス: `.hudDock` の `.hudPanel` をタイトルバー付きの浮動ウィンドウにする（ドラッグ / 前面へ / × で閉じる / リサイズ / 位置とサイズを localStorage に記憶 / 画面外に出たら戻す）。id 付きの `<h2>`（`stgPropsTitle` など）はタイトルバーへ移す。
  - 旧ツールバーは `.fnfLegacyBar`（隠す）。パネル開閉ボタンだけ残す（HudPanels が使う）。
- Chart: 下は `.fnfPlaybar`（シークバー / 時間・小節・step / `|<` `<<` `▶` `>>` `>|`（1 小節戻る・進む）/ ツール・Var・Diff・Snap・ズーム・Test）。初期表示は Notes & Events のみ。プレイテスト中はメニューバーとウィンドウを隠す。
- Stage: 下は `.fnfStatusbar`（選択情報 + ズーム / 全体 / 原点 / 移動）。
- 右下の共通ウィジェット（ローカル復元・カラーテスト）は playbar を避けて上へ。
- 未適用: Character Editor / Note Editor（まだ従来の Hud のまま）。FNF のエディタの Help メニュー、コマンドパレット、右クリックのコンテキストメニューも未実装。

## v3.27 — Playtest / アセット管理の再修正

- **ステージスクリプト**: チャートエディタの `getScripts()` に mod 側のステージスクリプト（`modStageScripts()`）を含める。`playtest.js` の `prepareStageScripts()` は、mod に `super('<stageId>')` が無いときだけ本体のステージスクリプトを取得する。
- **ノートカインド**: `FunkinAssets.noteKindScripts(kinds, have)` が、譜面で使われている kind のうち mod が定義していないものを本体（0.8 `preload/scripts/notekinds/`、0.9 `gameplay/notekinds/`）から取得する。ファイル名 = kind 名、無ければ全 `.hxc` の `super('<kind>')` を探す。
- **PlayAnimation / SetTargetBopSpeed**: `StageScene.start()` で `animEvents` を作り、`advanceEvents` で順に `applyAnimEvent()`。target は boyfriend/bf/player・dad/opponent・girlfriend/gf、または名前付き prop。
- **0.9 モードの取得**: `findData` / `findAtlas` は現在のブランチで見つからなければ、もう一方のブランチも探す（ブランチ設定 auto は mod の配置から決定）。
- **文字間隔**: `theme-fnf.css` で全体の `letter-spacing: 2px`（canvas / 等幅 / 数値入力は 0）。
- **カラーテスト削除**: `ColorLab.js` / `color-lab.css` と関連 CSS を撤去。
- 修正: `StageScene` で `evs` を `start()` の外で参照していたバグ。

## v3.28 — 未実装クラス・Character / Note Editor の FNF レイアウト

- **FunkinTiledSprite / FlxTiledSprite / FunkinBackdrop / FlxBackdrop**（`runtime/runtime.js`）: スクリプトが `stage.add` すると `StageScene.addTiled()` で画像を読み、`drawTiled()` が zIndex 順の描画列に混ぜて敷き詰める（`scrollX/scrollY`・`velocity`・`scale`（中心基準）に対応。Backdrop は指定軸に無限に敷く。`color` / `blend` は未対応）。
- **RuntimeRainShader**（`runtime/shader.js` の `makeRainShader`）: 本体の `ui/shaders/rain.frag` に `RuntimePostEffectShader` 相当の GLSL（`screenCoord` / `uCameraBounds` / `screenToWorld` …）を足してカメラのフィルター / prop の `shader` として使う。`FunkinAssets.NATIVE_FRAGS` に `rain` を追加。`mask` / `lightMap` / `blurredScreen` は未対応（本物でもコメントアウト）。
- **BlurFilter**: new できるだけ（描画には使わない）。**MathUtil / FlxAngle / FlxG.console** の小さな互換、prop の `offset` と `animation.onFrameChange` を追加。
- **スクリプトが名指しする画像**: `playtest.js` の `prepareStageScripts()` が `Paths.image('…')` を拾って、mod に無ければ本体から足す。
- **Character / Note Editor**: `FnfShell`（メニューバー + 浮動ウィンドウ）と下の playbar に統一（上の旧バーは `fnfLegacyBar` で隠し、ボタンはメニューから `click` で呼ぶ）。`ModPicker` はウィンドウの中身側へ入れる。Note Editor は初めて表示された大きさで 1 回だけ fit する。
- 既知の残り: `PlayState.resetCamera.apply` / `comboPopUps` / `Character.abot`（phillyBlazin）、キャラのスクリプト（nene / darnell-blazin）、Help メニュー・コマンドパレット・右クリックメニュー。

## v3.29 — 部分欠損アセット / ノートスタイル選択 / シェーダー（One-Shot Collection で検証）

- **部分欠損アセット**: `ensureAtlas` → `completeFromMod` が、mod にある一部（Darnell の `Animation.json` と `hey.png/xml` だけ、`spritemap1.json/png` が無い等）を手がかりに、足りないファイルだけを本体から mod の同じフォルダ扱いで足す。mod にあるファイルは常に優先。実 mod（One-Shot Collection feat.Reo）で、Darnell の spritemap が本体から補完されることを確認。
- **ノートスタイル選択**: プレイテストのスキン選択に「（mod）/（本体）」と「★譜面の指定」を表示。mod のスキンが指す XML の無い単体画像（`note-holds.png`）も登録する。遊んでいる最中の切り替えもすぐ反映。
- **ノートイベントをステージのスクリプトへも送る**（`Runtime.noteEvent` の送信先に stages を追加）。phillyStreetsOne の `onNoteHit`（HIGH の残像）が動く。
- **FlxTypedSpriteGroup / CharacterRegistry.instance.fetchEntry / Stage.characters / addCharacter**、キャラの `kill / revive / alive / resetCharacter`、`FlxPoint.get / weak / put …`、`FlxTween.angle / quadPath / linearPath`。
- **ブレンド**: prop の `blend = 0`（openfl.display.BlendMode の数値: 0 = ADD, 9 = MULTIPLY …）に対応。Backdrop / TiledSprite にも反映し、`color` は明るさ（加算合成での強さ）に反映。
- **シェーダー**: `HSVShader / Grayscale / GaussianBlurShader / InverseDotsShader / MosaicEffect` を実ソースと同じ対応で追加（`makeNativeShader`）。`glslFrom` に GLSL ES 互換の直し（int / float 混在）と、RuntimePostEffectShader 向けの自動宣言を追加。本体の `ui/shaders/*.frag` 18 本すべてが WebGL でコンパイルできることを確認。
- **描画の安全策**: シェーダーつきキャラの大きさが決まらないとき（画像が届く前）はシェーダーなしで描く。
- 既知の残り: キャラのスクリプト（darnell.hxc の `onNoteHit` で lightCan など）、`Paths.sound` を `queryAssets` で名指しするキャラの効果音、`phillyBlazin` の 3 件。

## v3.30 — シェーダー描画の軽量化（ラグ修正）

- **原因**: シェーダーつきの描画は「2D キャンバス → GL テクスチャ転送」と「GL → 2D の読み戻し」が重く、キャラは毎フレーム描き直し・転送・読み戻しをしていた。カメラフィルターは GL キャンバス全体を描いており（キャンバスは大きくなる一方）、領域外まで読んでいた。
- **キャラのシェーダー結果を使い回し**（`StageScene.drawCharShaded`）: フレーム・向き・不透明度・位置・uniform・大きさが前回と同じなら前回の出力を描くだけ。毎フレーム変わる場合は 3 回続けて外れた時点で使い回しをやめ、コピーも作らない。
- **読み戻しは必ず `GLPost.blit()`**（apply() の結果の領域だけを切り出す）。prop / キャラ / カメラフィルターの全経路で統一。
- **自動解像度（`Quality`）を接続**: `Runtime.render()` の先頭で `Quality.tick()`。フレーム間隔が長引くとカメラフィルター用レイヤーとキャラのバッファを縮小（最小 0.35）、余裕があれば戻す。キャラのバッファ上限も 2048→1024px。
- 計測（ヘッドレス Chromium = ソフトウェア GL、相対比較）: 3.4Mpx→1.0Mpx/フレーム、約 4〜5fps → 約 8fps。実機の GPU ではさらに差が出る見込み。
- 既知の残り: カメラフィルター（rain など）は毎フレーム変わるため転送は避けられない。品質を固定する UI は未実装（`Quality.mode` で指定可能）。
- **FPS カウンター / シェーダー画質**（`playtest.js` の `drawFps`）: プレイテストのオプションに「FPS を表示」と「シェーダー画質（自動 / 100・75・50・35%）」。右上に FPS・平均フレーム時間・1%low・現在の画質を出す（直近 120 フレーム、250ms ごとに更新）。画質は `Quality.mode` に反映。

## v3.30.2 — 長時間で FPS が落ちる報告への対応

- 実機報告（学校の Chromebook）: 15FPS → 30 秒ほどで 3FPS。サンドボックスで 60 秒計測したが JS ヒープ・オブジェクト数・描画回数は増えず、**JS 側のリークは再現しない**（サンドボックスは常に床の 4FPS のため、実機の発熱 / GPU メモリ要因は切り分け未了）。
- 描画の内訳（drawImage の呼び出し元別）: カメラフィルターの読み戻し（1280×659）が最大、次いでキャラのシェーダー結果の読み戻し。AnimateAtlas は毎フレーム別コマになるのでキャラの使い回しは効きにくく、**1 回あたりの面積を減らす**方向に切り替えた。
- **キャラのシェーダー用バッファの余白をシェーダー別に**: 周りを読むもの（`openfl_TextureSize` を使う / texture2D が複数）は従来どおり広く、色を変えるだけのもの（adjustColor など）は 1.12×1.1 に。面積は約 1/3（1024×934 → 627×594 など）。
- **診断**: FPS 表示に GPU 名（SwiftShader / llvmpipe = ソフトウェア描画は赤）を出す。5 秒ごとに FPS・ヒープを記録し、「FPS ログをコピー」で取り出せる。

## v3.30.3 — FPS 表示に内訳（JS 処理 / GL 変換 / 読み戻し）

- 実機（Intel UHD 600 / Mesa, Chromebook）はハードウェア GL（SwiftShader ではない）。それでも 15FPS → 6FPS（168ms/フレーム）と低下し、ヒープは 52MB で平坦 → JS リークではなく、持続負荷による発熱での速度低下か GPU 待ちが疑わしい。
- `Prof`（glpost.js）が GL 変換（`apply`）と読み戻し（`blit`）の時間と回数を集計。FPS 表示の 3 行目に「JS 処理 ms（GL変換 ms×回数 読戻 ms×回数）」を出す。フレーム全体 ms と JS 処理 ms がほぼ同じなら CPU 側、JS 処理 ms ≪ フレーム ms なら GPU 待ち / 発熱。ログにも載る。

## v3.30.4 — FPS 表示の平均区間を修正 / 内訳を追加

- **FPS の平均は直近 1 秒のみ**: 以前は直近 120 フレーム平均で、遅い（≈3FPS）と 120 フレーム＝約 40 秒ぶんになり、開始直後の軽いフレームが混ざって「15FPS → 3FPS に落ちる」ように見えていた。実機ログ（JS 処理が 310〜330ms で一定）から、実際は最初から約 3FPS で一定と判明。
- 内訳の 4 行目: rt 全体 / 影キャラ / 素キャラ / 小物 の ms（`Prof`）。

## v3.30.5 — 自動画質を実機データに合わせて作り直し

- 実機（Chromebook / Intel UHD 600）: 画質 100% = 330ms/フレーム（3FPS, GL変換 ≈200ms）、35% = 約 55ms（17FPS 安定）。シェーダーのコストは画素数（画質²）にほぼ比例（約 8 倍の画素差で約 6 倍）。
- 旧 `Quality` 自動は「フレーム間隔 250ms 超は無視」だったため、100% で 330ms の端末では一度も反応しなかった。
- 新: 目標 34ms（約 30FPS）。遅いとき 4 フレームで `scale *= √(目標/実測)`（下限 0.25、1 回で最大 ×0.5）。戻すのは「上げても目標内に収まる見込み」のときだけ（往復防止）。落ち着いた値は localStorage（studio.quality.scale）に保存し、次回その値から始める。

## v3.30.6 — プレイテストのキャラ反転位置を V-Slice に合わせる

- **原因（Sparrow / Packer）**: Flixel は反転（flipX）を「いま表示中のフレーム自身の枠（frameWidth）」の中で行い、枠の左上は常にスプライトの左上に置く（`FlxFrame.prepareMatrix`）。プレイテストは足元中央（= 基準フレームの中心）を軸に反転していたため、基準フレームと幅の違うアニメ（sing 系・Multi の別アトラス）が反転キャラ（BF など）で `k × (frameWidth − refW)` ずれていた。Character Editor は元から正しい（`axis = −refW/2 + frameWidth/2`）ので、エディタと実行で食い違っていた。
- 修正: `SceneChar.draw` が同じ軸で反転。あわせて **アニメ個別の flipX / flipY**（`animations[].flipX`、`checkFlipX` = スプライト flipX ≠ アニメ flipX）も反映（以前はプレイテストで無視）。
- **未検証（AnimateAtlas）**: flixel-animate は反転を `matrix.scale(-1,1); translate(bounds.width, 0)`（bounds = アトラスのタイムライン全体の枠 `timeline._bounds`）で行う。こちらは「基準フレームの中心」を軸にしており、反転キャラ＋ AnimateAtlas では差が出る可能性がある。bounds の算出元（Timeline クラス）の実ソースが手元に無く、実データで確かめるまでは変更していない。

## v3.30.7 — AnimateAtlas の枠（hitbox）をタイムライン全体の枠に（Darnell の Sparrow が右下にずれる件）

- **原因**: flixel-animate（`FlxAnimate` / `FlxAnimateController.updateTimelineBounds` / `Timeline._bounds`）では、AnimateAtlas スプライトの `frameWidth / frameHeight` は **メインタイムライン全フレームの枠の和（`getWholeBounds`）** で、描画もその枠の左上（`matrix.translate(-bounds.x, -bounds.y)`）をスプライトの左上に置く。V-Slice の hitbox・足元（幅/2, 高さ）・カメラ焦点はこの寸法で決まる。こちらは先頭フレームの枠を使っていたため、Animate が基準の Multi に Sparrow が混ざると、Sparrow だけ基準の寸法差ぶん右下にずれた（Darnell: 先頭フレーム 382×485 / タイムライン全体 739×736）。
- 修正: `AnimateAtlas.timelineBounds()`（atlas.js）を追加。`StageCharacter.build` は Animate の refW/refH をそれにし、`AnimateFrame.draw(..., "tl")` でタイムライン枠の左上を基準枠の左上に置く（Stage Editor / プレイテスト / Character Editor で共通）。反転は `matrix.scale(-1,1); translate(bounds.width, 0)` と同じく、そのアトラスの枠の幅の中で行う。
- 確認: Darnell の idle（Animate）と hey（Sparrow, offsets [-53,-68]）が重なるようになった（従来は約 +180px / +250px ずれ）。
- 影響: Animate キャラの絶対位置とカメラ焦点が V-Slice 準拠に変わる（先頭フレームとタイムライン全体の枠が違うほど変化が大きい）。Character Editor は未実機確認。`applyStageMatrix: true`（sourceSize に matrix.a を掛ける）は未対応。
