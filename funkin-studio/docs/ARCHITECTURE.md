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
