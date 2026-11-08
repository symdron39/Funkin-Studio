/* ============================================================
   core/State.js — すべての画面の親クラス（Haxe の MusicBeatState / FlxState 相当）
   ------------------------------------------------------------
   画面を作るには、このクラスを extends して、必要なメソッドだけ上書き(override)する。

     export class MyState extends State {
       static id = "my";                 // 画面の名前（switchTo("my") で呼ぶ）
       static template = `<div>…</div>`; // 画面の HTML
       create() { ... }                  // ← MusicBeatState.create()
       destroy() { ... }                 // ← MusicBeatState.destroy()
     }

   ライフサイクル（呼ばれる順番）:
     new State(app)  →  create()  →  onShow()  …使われる…  onHide()  →  destroy()
                                       ↑                      ↑
                          persistent な画面は、隠れても destroy されず
                          onHide()/onShow() を繰り返す（Haxe の persistentUpdate に近い発想）

   Haxe との対応:
     create()      = create()        画面を作る。DOM 構築とボタンの配線
     onShow()      = postCreate()+resume   表示された（毎回）
     onHide()      = pause           隠された（再生タイマーを止めるなど）
     update(dt)    = update(elapsed) 毎フレーム（上書きしたときだけ動く）
     destroy()     = destroy()       後片付け
     canLeave()    = （Haxe には無い）画面を出てよいか。未保存の確認などに使う
     this.app      = FlxG            みんなが使う共有の入口（画面切替・イベント・HUD）

   JS メモ:
     ・static は「クラスそのものに付く値」。インスタンスを作る前に manager が読める（Haxe の static var と同じ）。
     ・Haxe の super.create() と同様、上書きしたら通常 super.create() を呼ぶ。（この基底は空なので省略しても動く）
   ============================================================ */
import { htmlToElement } from "./dom.js";

export class State {
  // ---- 画面ごとに上書きする「設定」（static） ----
  static id = ""; // 画面の一意な名前
  static template = ""; // 画面の HTML（最外側の要素が root になる）
  static persistent = false; // true: 隠れても破棄せず保持する（編集中データを守りたいエディタ用）
  static hud = false; // true: 上部の HUD（Undo/Redo/Home…）を表示する
  static hudLabel = ""; // HUD の「形式切替」ボタンに出す文字
  static hudBack = ""; // HUD の「形式切替」ボタンの行き先の State id

  /** @param app  App のインスタンス（FlxG のような共有の入口） */
  constructor(app) {
    this.app = app;
    this.root = null; // この画面の一番外側の要素。manager が作って入れてくれる
    this.active = false; // いま表示中か
    this._listeners = []; // listen() で登録したもの
    this._disposers = []; // destroy 時に呼ぶ後始末の関数
  }

  // ============ 上書きするメソッド（既定では何もしない） ============
  create() {}
  onShow(_params) {}
  onHide() {}
  update(_elapsed) {}
  destroy() {}
  /** 画面を出てよければ true。false を返すと遷移を中止する。confirm() など同期でも async でも OK */
  canLeave(_nextId) {
    return true;
  }

  // ============ 便利メソッド ============

  /** root の中から CSS セレクタで探す（Haxe でいう group.members.find に近い） */
  q(selector) {
    return this.root.querySelector(selector);
  }

  /**
   * root の中の要素にクリックを配線する。 this.click("#backHome", () => ...)
   * 要素は root と一緒に消えるので、後始末は不要。
   */
  click(selector, fn) {
    const el = this.q(selector);
    if (!el) throw new Error(`[${this.constructor.id}] click target not found: ${selector}`);
    el.addEventListener("click", fn);
    return el;
  }

  /** この画面の中のボタンから別の画面へ。 this.go("#backHome", "home") */
  goOnClick(selector, stateId) {
    return this.click(selector, () => this.app.switchTo(stateId));
  }

  /**
   * document / window など「画面の外」のイベントを聞く。
   * 画面が表示されている間だけ有効になり、隠れる/破棄されると自動で外れる。
   * （addEventListener を直接書くと外し忘れて、隠れた画面がキー入力に反応し続ける）
   */
  listen(target, type, handler, options) {
    const entry = { target, type, handler, options, attached: false };
    this._listeners.push(entry);
    if (this.active) this._attachOne(entry);
    return entry;
  }

  /** destroy() のときに呼んでほしい後始末を登録する（タイマー停止など） */
  addDisposer(fn) {
    this._disposers.push(fn);
  }

  // ============ manager だけが呼ぶ内部メソッド ============
  _mount(host) {
    this.root = htmlToElement(this.constructor.template);
    this.root.hidden = true;
    this.root.dataset.state = this.constructor.id;
    host.append(this.root);
    this.create();
  }
  _show(params) {
    this.active = true;
    this.root.hidden = false;
    this._listeners.forEach((e) => this._attachOne(e));
    this.onShow(params);
  }
  _hide() {
    this.onHide();
    this._listeners.forEach((e) => this._detachOne(e));
    this.active = false;
    this.root.hidden = true;
  }
  _destroy() {
    if (this.active) this._hide();
    this.destroy();
    this._disposers.splice(0).forEach((fn) => fn());
    this._listeners.length = 0;
    this.root.remove();
    this.root = null;
  }
  _attachOne(e) {
    if (e.attached) return;
    e.target.addEventListener(e.type, e.handler, e.options);
    e.attached = true;
  }
  _detachOne(e) {
    if (!e.attached) return;
    e.target.removeEventListener(e.type, e.handler, e.options);
    e.attached = false;
  }
}
