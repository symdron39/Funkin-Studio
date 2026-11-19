/* ============================================================
   ui/FnfShell.js — FNF 本体のエディタ（V-Slice の Chart / Stage Editor）風の画面枠
   ------------------------------------------------------------
   本物は main-view.xml が「上: メニューバー / 中: 空き / 下: バー」、操作パネルは「ツールボックス」という
   ドラッグできる小さなウィンドウ。これを、既存の Hud 画面（HudPanels）に後から被せる。
     1. メニューバー … 上に全幅で置く。項目は { text, run | click | toggle } の配列で渡す
     2. ツールボックス … .hudPanel を「タイトルバー付きの浮動ウィンドウ」にする（ドラッグ / 前面へ / 閉じる / サイズ変更 / 位置を記憶）
     3. 下のバー … 各エディタのテンプレートが .hudTransport を FNF の playbar の形で持つ（ここでは枠のスタイルだけ）
   既存のボタンやパネルの id・イベントはそのまま（要素を動かすだけ）。HudPanels の表示/非表示とも連動する。
   ============================================================ */

const LS = "funkinStudio.fnf.";
const lsGet = (k) => {
  try {
    return JSON.parse(localStorage.getItem(LS + k) || "null");
  } catch {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(LS + k, JSON.stringify(v));
  } catch {
    /* 保存できなくても動く */
  }
};

export class FnfShell {
  /**
   * @param root  State の root
   * @param hud   HudPanels のインスタンス
   * @param opts  { key: 保存名, menus: [{ text, items: [項目 | "-"] }], titles: { panel名: 見出し } }
   *   項目: { text, run: () => void } / { text, click: "#id" } / { text, toggle: "panel名" } / { text, check: () => bool, run }
   *         key: 右に出すショートカット表示（飾り）
   */
  constructor(root, hud, opts = {}) {
    this.root = root;
    this.hud = hud;
    this.key = opts.key || "default";
    this.layer = root.querySelector(".hudLayer");
    this.z = 20;
    this.wins = new Map();
    root.classList.add("fnfShell");
    if (opts.menus) this.buildMenubar(opts.menus);
    this.buildWindows(opts.titles || {});
    // 閉じたパネルは開き直したとき最前面へ。表示状態は HudPanels の hidden に従う
    const apply = hud._apply.bind(hud);
    hud._apply = () => {
      apply();
      this.syncChecks();
      for (const [name, w] of this.wins) if (!w.hidden) this.keepInside(w);
    };
    addEventListener("resize", () => this.wins.forEach((w) => this.keepInside(w)));
    this.syncChecks();
  }

  /* ---------- メニューバー ---------- */
  buildMenubar(menus) {
    const nav = document.createElement("nav");
    nav.className = "fnfMenubar";
    nav.setAttribute("role", "menubar");
    this.menus = [];
    for (const m of menus) {
      const wrap = document.createElement("div");
      wrap.className = "fnfMenu";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fnfMenuBtn";
      btn.textContent = m.text;
      const drop = document.createElement("div");
      drop.className = "fnfDrop";
      drop.hidden = true;
      for (const it of m.items) drop.append(this.menuItem(it));
      wrap.append(btn, drop);
      nav.append(wrap);
      const menu = { wrap, btn, drop };
      this.menus.push(menu);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openMenu(drop.hidden ? menu : null);
      });
      // 1つ開いている間は、ほかのメニューにカーソルを乗せるだけで切り替わる（本物と同じ）
      btn.addEventListener("pointerenter", () => {
        if (this.menus.some((x) => !x.drop.hidden) && drop.hidden) this.openMenu(menu);
      });
    }
    this.layer.prepend(nav);
    document.addEventListener("pointerdown", (e) => {
      if (!nav.contains(e.target)) this.openMenu(null);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.openMenu(null);
    });
    this.nav = nav;
    // 一括トグル（👁）は右端へ
    const eye = this.layer.querySelector(".hudEye");
    if (eye) nav.append(eye);
  }
  menuItem(it) {
    if (it === "-") {
      const hr = document.createElement("div");
      hr.className = "fnfSep";
      return hr;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fnfItem";
    b.innerHTML = `<span class="fnfTick"></span><span class="fnfLabel"></span><span class="fnfKey"></span>`;
    b.querySelector(".fnfLabel").textContent = it.text;
    b.querySelector(".fnfKey").textContent = it.key || "";
    if (it.toggle) b.dataset.toggle = it.toggle;
    if (it.check) b._check = it.check;
    b.addEventListener("click", () => {
      this.openMenu(null);
      if (it.toggle) this.hud.toggle(it.toggle);
      else if (it.click) this.root.querySelector(it.click)?.click();
      if (it.run) it.run();
      this.syncChecks();
    });
    return b;
  }
  openMenu(menu) {
    for (const m of this.menus) {
      m.drop.hidden = m !== menu;
      m.btn.classList.toggle("on", m === menu);
    }
    if (menu) this.syncChecks();
  }
  /** ✓ の表示を、パネルの開閉・各項目の check() に合わせる */
  syncChecks() {
    if (!this.nav) return;
    for (const b of this.nav.querySelectorAll(".fnfItem")) {
      let on = null;
      if (b.dataset.toggle) on = this.hud.isVisible(b.dataset.toggle);
      else if (b._check) on = !!b._check();
      if (on !== null) b.querySelector(".fnfTick").textContent = on ? "✓" : "";
    }
  }

  /* ---------- ツールボックス（浮動ウィンドウ） ---------- */
  buildWindows(titles) {
    const panels = [...this.root.querySelectorAll(".hudDock > .hudPanel[data-hud-panel]")];
    let i = 0;
    for (const el of panels) {
      const name = el.dataset.hudPanel;
      const right = !!el.closest(".hudDockRight");
      const h2 = el.querySelector(":scope > h2");
      if (h2) h2.remove(); // 本体に取り込まれないよう一旦外す（下でタイトルバーへ）
      const title = titles[name] || h2?.textContent || name;
      // 中身をスクロールする本体に、上にタイトルバーを固定する
      const body = document.createElement("div");
      body.className = "fnfBody";
      while (el.firstChild) body.append(el.firstChild);
      const bar = document.createElement("div");
      bar.className = "fnfTitle";
      bar.innerHTML = `<span class="fnfTitleText"></span><button type="button" class="fnfClose" title="閉じる" aria-label="閉じる">×</button>`;
      const tt = bar.querySelector(".fnfTitleText");
      // id 付きの見出し（エディタが文字を書き換えるもの）は、その要素ごとタイトルバーへ移す。ほかは見出しを捨てて指定の題にする
      if (h2?.id) {
        h2.classList.add("fnfTitleText");
        tt.replaceWith(h2);
      } else tt.textContent = title;
      el.append(bar, body);
      el.classList.add("fnfWin");
      this.layer.append(el);
      this.wins.set(name, el);

      const saved = lsGet(`${this.key}.${name}`);
      const W = this.layer.clientWidth || innerWidth;
      const w = saved?.w ?? 340;
      el.style.width = w + "px";
      if (saved?.h) el.style.height = saved.h + "px";
      el.style.left = (saved?.x ?? (right ? Math.max(10, W - w - 14 - (i % 3) * 56) : 14 + (i % 4) * 22)) + "px";
      el.style.top = (saved?.y ?? 40 + (i % 4) * 26) + "px";
      i++;
      this.keepInside(el);

      bar.querySelector(".fnfClose").addEventListener("click", () => this.hud.hide(name));
      el.addEventListener("pointerdown", () => this.front(el), true);
      this.dragSetup(el, bar, name);
      new ResizeObserver(() => this.remember(el, name)).observe(el);
    }
  }
  front(el) {
    el.style.zIndex = String(++this.z);
  }
  remember(el, name) {
    if (el.hidden) return;
    lsSet(`${this.key}.${name}`, { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.style.height ? el.offsetHeight : null });
  }
  /** 画面の外に出てしまったウィンドウを、タイトルバーが掴める範囲へ戻す */
  keepInside(el) {
    const W = this.layer.clientWidth,
      H = this.layer.clientHeight;
    if (!W || !H) return;
    const x = Math.min(Math.max(el.offsetLeft, 60 - el.offsetWidth), W - 60);
    const y = Math.min(Math.max(el.offsetTop, 30), H - 40);
    if (x !== el.offsetLeft) el.style.left = x + "px";
    if (y !== el.offsetTop) el.style.top = y + "px";
    // 下にはみ出さない高さに（playbar の分を残す）
    el.style.maxHeight = Math.max(120, H - y - 70) + "px";
  }
  dragSetup(el, bar, name) {
    bar.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button") || e.button > 0) return;
      e.preventDefault();
      const sx = e.clientX,
        sy = e.clientY,
        ox = el.offsetLeft,
        oy = el.offsetTop;
      bar.setPointerCapture(e.pointerId);
      const move = (ev) => {
        el.style.left = ox + ev.clientX - sx + "px";
        el.style.top = oy + ev.clientY - sy + "px";
      };
      const up = () => {
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
        bar.removeEventListener("pointercancel", up);
        this.keepInside(el);
        this.remember(el, name);
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
      bar.addEventListener("pointercancel", up);
    });
  }
}
