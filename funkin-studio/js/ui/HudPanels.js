/* ============================================================
   ui/HudPanels.js — 画面の上に重ねる「Hud パネル」の表示 / 非表示を管理する
   ------------------------------------------------------------
   Haxe でいう「FlxCamera を hud 用に分けて、visible を切り替える」発想。
   プレビュー(canvas)は画面いっぱいに置き、操作パネルはすべて Hud として上に重ねる。
   Character Editor と、今後のステージエディタで共有する。

   HTML の約束（data 属性だけで動く）:
     <div class="hudLayer">                              ← パネルを重ねる層（root の中に1つ）
       <aside data-hud-panel="anim">…</aside>            ← 名前付きパネル
       <div   data-hud-panel="bar" data-hud-always>…</div> ← always は個別の ON/OFF 対象外（全非表示のときだけ消える）
       <button data-hud-toggle="anim">🎞 アニメ</button>   ← そのパネルの表示/非表示ボタン
       <button data-hud-all>👁</button>                   ← すべての Hud を一括で隠す/戻す（常に表示される）
     </div>

   記憶: どのパネルを開いているかを localStorage に保存する（保存できない環境でも動く）。
   ============================================================ */
export class HudPanels {
  /**
   * @param root  パネルを含む要素（State の root）
   * @param opts  { storageKey: "character", defaults: ["anim", …]（省略=全部）, narrowDefaults: 画面が狭いときの初期表示,
   *               narrowExclusive: ["files","anim","char"]（画面が狭いとき、この中は同時に1つしか開かない） }
   */
  constructor(root, opts = {}) {
    this.root = root;
    this.layer = root.querySelector(".hudLayer") || root;
    this.key = "funkinStudio.hud." + (opts.storageKey || "default");
    this.panels = new Map();
    root.querySelectorAll("[data-hud-panel]").forEach((el) => this.panels.set(el.dataset.hudPanel, el));
    this.toggles = [...root.querySelectorAll("[data-hud-toggle]")];
    this.allBtns = [...root.querySelectorAll("[data-hud-all]")];

    const all = this.toggles.map((b) => b.dataset.hudToggle);
    const narrow = this._isNarrow();
    const initial = opts.narrowDefaults && narrow ? opts.narrowDefaults : opts.defaults || all;
    this.exclusive = opts.narrowExclusive || [];
    this.visible = new Set(this._load() ?? initial);
    // 狭い画面では左右のドックが重なるので、排他グループは1つだけにする（保存値が広い画面のものでも直す）
    if (this._isNarrow()) {
      const open = this.exclusive.filter((n) => this.visible.has(n));
      for (const n of open.slice(1)) this.visible.delete(n);
    }
    this.allHidden = false; // 全非表示は保存しない（次に開いたとき真っ暗で困らないように）

    for (const b of this.toggles) b.addEventListener("click", () => this.toggle(b.dataset.hudToggle));
    for (const b of this.allBtns) b.addEventListener("click", () => this.toggleAll());
    this._apply();
  }

  _isNarrow() {
    return window.innerWidth < 900;
  }
  /** 狭い画面で name を開くとき、同じ排他グループの他のパネルを閉じる */
  _closeOthers(name) {
    if (!this._isNarrow() || !this.exclusive.includes(name)) return;
    for (const n of this.exclusive) if (n !== name) this.visible.delete(n);
  }
  isVisible(name) {
    return !this.allHidden && this.visible.has(name);
  }
  show(name) {
    this._closeOthers(name);
    this.visible.add(name);
    this.allHidden = false;
    this._apply();
  }
  hide(name) {
    this.visible.delete(name);
    this._apply();
  }
  toggle(name) {
    if (this.allHidden) {
      // 全非表示中にボタンが押されたら、まず戻してからそのパネルを開く
      this.allHidden = false;
      this._closeOthers(name);
      this.visible.add(name);
    } else if (this.visible.has(name)) this.visible.delete(name);
    else {
      this._closeOthers(name);
      this.visible.add(name);
    }
    this._apply();
  }
  toggleAll() {
    this.allHidden = !this.allHidden;
    this._apply();
  }

  _apply() {
    this.panels.forEach((el, name) => {
      const always = el.dataset.hudAlways !== undefined;
      el.hidden = !(always || this.visible.has(name));
    });
    this.layer.dataset.allHidden = String(this.allHidden); // CSS が全パネルを隠す
    for (const b of this.toggles) {
      const on = !this.allHidden && this.visible.has(b.dataset.hudToggle);
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    for (const b of this.allBtns) b.setAttribute("aria-pressed", String(this.allHidden));
    this._save();
  }
  _load() {
    try {
      const v = JSON.parse(localStorage.getItem(this.key) || "null");
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }
  _save() {
    try {
      localStorage.setItem(this.key, JSON.stringify([...this.visible]));
    } catch {
      /* 保存できなくても動作には影響しない */
    }
  }
}
