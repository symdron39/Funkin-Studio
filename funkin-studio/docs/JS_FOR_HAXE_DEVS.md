# Haxe を知っている人のための JS 入門（Funkin' Studio のコードで学ぶ）

このプロジェクトのコードを読み進めるための手引きです。例は実際のファイルから取っています。
おすすめの読む順番: `core/EventBus.js` → `core/State.js` → `states/HomeState.js` → `core/StateManager.js` → `ui/Hud.js` → `states/SparrowEditorState.js` → `states/sparrow/editor.js`

---

## 0. 最初に知っておくこと

| | Haxe | JavaScript |
|---|---|---|
| 型 | 静的型（コンパイル時にチェック） | 動的型（実行して初めてエラーになる） |
| 実行 | コンパイル | そのままブラウザが実行 |
| 間違い | コンパイルエラーで止まる | 動いてから `undefined` になる |

→ **タイプミスがコンパイルで教えてもらえない**。ブラウザの開発者コンソール（F12。Android なら PC からリモートデバッグ）で赤いエラーを見る癖をつけるのが一番大事です。

---

## 1. 変数: `const` / `let`

```js
const name = "Reo";   // Haxe の final。再代入できない
let count = 0;        // Haxe の var。再代入できる
count++;
```
`var` もあるが古い書き方。使わない。
`const` でも **中身は変えられる**（`const list = []; list.push(1)` は OK）。再代入だけ禁止。

## 2. 等価比較: 必ず `===`

```js
1 == "1"    // true  ← 勝手に型変換される（事故のもと）
1 === "1"   // false ← Haxe の == と同じ感覚。常にこちらを使う
```

### 「ないかもしれない」の扱い

```js
a?.b        // a が null/undefined なら、エラーにせず undefined を返す（optional chaining）
a ?? "既定" // a が null/undefined のときだけ "既定"
a || "既定" // a が 0 や "" や false のときも "既定" になってしまう ← 違いに注意
```
例: `core/EventBus.js` の `this.#handlers.get(name)?.delete(fn)`

### 真偽値になる値（truthy / falsy）

`0` `""` `null` `undefined` `NaN` `false` は偽。それ以外は真（`"0"` や `[]` も真）。

## 3. 関数と `this`（最大の落とし穴）

```js
function add(a, b) { return a + b; }     // 普通の関数
const add = (a, b) => a + b;             // アロー関数（Haxe の (a, b) -> a + b）
```

`this` の決まり方が Haxe と違います。

- **クラスのメソッドを、そのままコールバックに渡すと `this` が失われる**
  ```js
  button.onclick = this.go;           // ✗ go の中で this が button になる
  button.onclick = () => this.go();   // ✓ アロー関数は外側の this をそのまま使う
  ```
  → このプロジェクトで `() => this.renderList()` のように書いているのはこのため（`states/ContributorsState.js`）。
- 迷ったら「コールバックは **アロー関数で包む**」。

## 4. クラス

```js
class Animal {
  static kind = "animal";         // static: クラスに付く値（Haxe と同じ）
  #secret = 1;                    // # は private（外から触れない）
  constructor(name) { this.name = name; }   // Haxe の new()
  speak() { return this.name; }
}
class Dog extends Animal {
  constructor(name) { super(name); }        // this を使う前に必ず super()
  speak() { return super.speak() + "!"; }   // override キーワードは無い。同名で上書きするだけ
}
```
- **インターフェイスは無い**。「このメソッドを持っていれば OK」という約束（ダックタイピング）。
  例: HUD は `state.undo?.()` と書き、`undo` を持っている State だけ反応する（`ui/Hud.js`）。
- `static` も継承される → `EditorState` の `static persistent = true` を、3つのエディタが引き継ぐ。
- フィールドは `this.xxx = ...` でいつでも増やせる（宣言が無くてもエラーにならない。タイプミスに注意）。

## 5. モジュール: `import` / `export`

```js
// core/dom.js
export function esc(s) { ... }
// 使う側
import { esc } from "./dom.js";
```
- 1ファイル = 1スコープ。`export` しなければ外から見えない（Haxe の package private に近い）。
- パスは `./` から始め、**拡張子 `.js` が必須**。
- 旧版は全ファイルが `window` を共有していた（どのファイルからでも触れる = どこから壊されるか分からない）。今は import で依存が見える。

## 6. クロージャ（`mountAnimateEditor` の正体）

```js
export function mountAnimateEditor(state) {
  let anim = null;                  // この関数の中だけの変数
  function draw() { ... anim ... }  // 内側の関数は外側の変数を覚えている
  return { onShow() {...} };        // 関数が終わっても、anim は生き続ける
}
```
関数の中の変数を、中の関数が覚え続ける仕組みを「クロージャ」と呼びます。
Haxe なら「private フィールドを持つクラス」で書くものを、JS では「関数 + 変数」で書けます。
`animate/editor.js` が 3000 行の巨大な関数に見えるのはこのため。慣れたら、これをクラスに分けていくのが次の改善です。

## 7. DOM とイベント

- **DOM** = ブラウザが HTML を木構造のオブジェクトとして持っているもの。`FlxGroup` に `add` する感覚で `parent.append(child)`。
- 要素を探す: `document.getElementById("x")` / `root.querySelector("#x .cls")`
- イベントを聞く: `el.addEventListener("click", handler)`
  - **外すには同じ関数オブジェクトを渡す必要がある**（`() => ...` をその場で書くと外せない）。
    だから `State.listen()` が登録内容を覚えておいて、隠れるときに自動で外す。
- **capture（第3引数 `true`）**: イベントは「外側 → 目的の要素 → 外側」の順に通る。`true` だと行きの途中で先に受け取れる。`UnsavedGuard` の「押された瞬間に未保存にする」で使用。
- `innerHTML = "<div>..."` で HTML 文字列を差し込める。ユーザー入力を入れるときは `esc()` で必ずエスケープ（XSS 対策）。

## 8. 非同期: `async` / `await` と Promise

ファイル読み込みや画像の decode は「終わるまで待つ」必要があります。ブラウザは待っている間も止まらないので、「あとで終わる処理」は **Promise** で表します。

```js
async function load() {              // async 関数は Promise を返す
  const text = await file.text();    // 終わるまで、ここで待つ（他の処理は止まらない）
  const data = JSON.parse(text);
}
```
- `await` は `async` 関数の中でしか使えない。
- エラーは `try { await ... } catch (e) { ... }`。
- Haxe の `haxe.Timer.delay` やコールバック連鎖を、上から下へ素直に書ける形にしたもの。
- 例: `core/StateManager.js` の `switchTo`（`await prev.canLeave(id)`）。
  `canLeave` が `confirm()`（同期）でも Promise（非同期）でも `await` が同じように扱ってくれる。

## 9. 配列・Map・Set と便利な書き方

```js
const arr = [1, 2, 3];
arr.map(x => x * 2)        // Haxe の arr.map(x -> x * 2)
arr.filter(x => x > 1)     // filter
arr.find(x => x === 2)     // 最初の1個（無ければ undefined）
arr.includes(2)            // contains
for (const x of arr) {}    // for (x in arr)
const m = new Map(); m.set("a", 1); m.get("a");   // Map<String, Int>
const s = new Set([1, 1, 2]);                      // 重複なし。[...s] で配列へ

const { a, b } = obj;      // 分割代入（destructuring）: obj.a, obj.b を取り出す
const copy = { ...obj, a: 1 };   // スプレッド: コピーして一部だけ上書き
const all = [...list1, ...list2];
`こんにちは ${name}`        // テンプレートリテラル。文字列の中に式を埋め込める
```
`items.map(o => ({ ...o }))` のように、**オブジェクトを返すアロー関数は `({ ... })` と括弧で包む**（`{` がブロックと見分けられないため）。

## 10. 型変換の落とし穴

```js
Number("")        // 0   （空欄が 0 になる！）
Number("abc")     // NaN （NaN === NaN も false。Number.isFinite() で調べる）
"5" + 1           // "51"（文字列結合）
"5" - 1           // 4   （数値になる）
```
入力欄の値は常に **文字列**。計算前に `Number(el.value)` で変換する。このコードで `Number($("offX").value) || 0` と書いているのは「数値にして、NaN や 0 は 0 にする」ため。

## 11. このコードで見つけられる「JS ならでは」

| 場所 | 学べること |
|---|---|
| `core/EventBus.js` | `Map` / `Set` / 解除関数を返す設計 / `#private` |
| `core/State.js` | クラス・static・ライフサイクル |
| `core/StateManager.js` | `async/await`・`requestAnimationFrame`（毎フレーム処理） |
| `states/ContributorsState.js` | DOM の組み立て・`replaceChildren`・`??` |
| `services/i18n.js` | `MutationObserver`（DOM の変化を監視）・`WeakMap`・正規表現 |
| `services/Autosave.js` | `IndexedDB`（ブラウザ内DB）・`Promise` を自分で作る |
| `states/animate/editor.js` | クロージャ・canvas 描画・ファイル読み書き（Blob / URL.createObjectURL） |
| `build.py` | ES Modules を1枚に束ねる仕組み（バンドラの原理） |
| `ui/Viewport.js` | ポインタイベント（`setPointerCapture`）・ホイールズーム・座標変換（world ↔ screen） |
| `states/stage/stageData.js` | 純粋関数だけのモジュール・`structured` なデータの正規化・`??` と `Number.isFinite` |
| `states/stage/editor.js` | 履歴を「JSON 文字列のスナップショット」で持つ Undo/Redo・`Set` / `Map`・`replaceChildren` |

### Stage Editor で出てくる小ネタ

- **深いコピー**: `JSON.parse(JSON.stringify(x))` は関数や `undefined` を含まないデータなら手軽。Undo の履歴は、これで作った文字列をそのまま積んでいる（Haxe の `Reflect.copy` の深い版のイメージ）。
- **`input` と `change`**: `<input>` は打鍵ごとに `input`、確定（Enter / フォーカスが外れる）で `change`。「途中は見た目だけ、確定で履歴に積む」に使い分けている。
- **ポインタキャプチャ**: `canvas.setPointerCapture(e.pointerId)` をすると、ドラッグ中にカーソルが canvas の外へ出ても `pointermove` / `pointerup` が届き続ける。
- **座標変換**: `screen = origin + world × zoom`。ホイールズームは「カーソル下の world 点が動かない」ように origin を引き直す（`Viewport.zoomAt`）。
- **`??` と `||` の違い**: `a ?? 1` は `a` が null/undefined のときだけ 1、`a || 1` は 0 や "" でも 1 になる。`alpha ?? 1` と書くのは「alpha = 0 は有効な値」だから。

## 12. 練習問題（易 → 難）

1. `HomeState` のボタンの文言を変えてみる（`template` の中を編集 → ブラウザをリロード）
2. `ARCHITECTURE.md` の手順で `SettingsState` を作り、Home にボタンを足す
3. `SettingsState` に「言語切替ボタン」を置く（ヒント: `this.app.i18n.setLanguage("en")`）
4. `update(elapsed)` を上書きして、経過秒を画面に表示する（ヒント: `this.elapsedTotal += elapsed`）
5. 新しいイベント `"studio-ping"` を `app.events.emit` し、別の State で `on` して受け取る
6. `states/sparrow/editor.js` をクラス `SparrowEditor` に作り直す（クロージャ → クラスの練習）
7. Stage Editor の矢印キーを、Shift で 10 ではなく 5 ずつ動くよう変える（`states/stage/editor.js` の `step`）
8. Stage Editor の選択枠の色を変える（`SEL_COLOR`）
9. （難）Stage Editor に「選択 prop の四隅をドラッグして scale を変える」ハンドルを足す（ヒント: `corners()` と `pick()` を参考に、ハンドルの当たり判定を作る）

## 参考

- MDN Web Docs（日本語）: https://developer.mozilla.org/ja/ — `MDN addEventListener` のように検索するのが早い
- javascript.info（日本語あり）: https://ja.javascript.info/
