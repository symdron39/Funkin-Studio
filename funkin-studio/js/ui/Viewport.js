/* ============================================================
   ui/Viewport.js — 画面いっぱいの「スクロール(パン)＆ズームできるプレビュー」
   ------------------------------------------------------------
   Haxe でいう FlxCamera（scroll + zoom）に相当。Character Editor と、今後作るステージエディタで共有する。

   座標の考え方:
     ・world  = 作品側の座標（キャラの足元の基準点が 0,0。単位は元画像のピクセル）
     ・screen = canvas 上の CSS ピクセル
       screen = origin + world × zoom      （origin = 「world の 0,0 が画面のどこにあるか」）
     origin の初期位置は「横は中央、縦は originY（0〜1）の高さ」。パンすると panX / panY ぶんずれる。

   操作（canvas の上で）:
     ・マウスホイール        … カーソル位置を中心にズーム
     ・中ボタン / 右ボタンのドラッグ … パン
     ・Space を押しながらドラッグ    … パン（ペンタブ・トラックパッド向け）
     ・panMode = true のとき、左ドラッグもパン（スマホ・タブレット向けの「✋」ボタン用）
   パン中は panning が true。エディタ側の pointerdown は「if (vp.panning) return;」で譲ること
   （Viewport の listener が先に登録されるので、先にこちらが判定する）。

   使い方:
     const vp = new Viewport(canvas, { state, originY: 0.72, onChange: () => draw() });
     // draw() の中で
     vp.drawGrid(ctx);
     const o = vp.origin();  // 画面上の 0,0
     ctx.translate(o.x, o.y); ctx.scale(vp.zoom, vp.zoom); …

   JS メモ: state.listen(window, …) は「その画面が表示されている間だけ」効くので、隠れた画面が Space を奪わない。
   ============================================================ */
const GRID_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

/** キー入力が「文字入力・ボタン操作」向けなら true（ショートカットを横取りしないための判定） */
export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || el.isContentEditable;
}

/** 矢印キーや文字キーを「入力欄が使う」ときだけ true（ボタン・チェックにフォーカスがあるだけなら false） */
export function isTextEntry(el) {
  if (!el) return false;
  if (el.tagName === "INPUT") return !["checkbox", "radio", "button", "file"].includes(el.type);
  return el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export class Viewport {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.originY = opts.originY ?? 0.5; // origin の縦位置（canvas の高さに対する割合）
    this.minZoom = opts.minZoom ?? 0.05;
    this.maxZoom = opts.maxZoom ?? 16;
    this.onChange = opts.onChange || (() => {});
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.panMode = false; // 「✋」ボタン: 左ドラッグでもパンする
    this.spaceDown = false;
    this.panning = false;
    this._drag = null;

    canvas.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });
    canvas.addEventListener("pointerdown", (e) => this._onDown(e));
    canvas.addEventListener("pointermove", (e) => this._onMove(e));
    for (const t of ["pointerup", "pointercancel"]) canvas.addEventListener(t, (e) => this._onUp(e));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault()); // 右ドラッグでパンするので、右クリックメニューは出さない

    const state = opts.state;
    if (state) {
      state.listen(window, "keydown", (e) => {
        if (e.code !== "Space" || isTypingTarget(e.target)) return;
        e.preventDefault(); // ページのスクロールを防ぐ
        this._setSpace(true);
      });
      state.listen(window, "keyup", (e) => {
        if (e.code === "Space") this._setSpace(false);
      });
      state.listen(window, "blur", () => this._setSpace(false));
    }
    this._updateCursor();
  }

  // ---------- 座標 ----------
  get width() {
    return this.canvas.clientWidth;
  }
  get height() {
    return this.canvas.clientHeight;
  }
  /** world の 0,0 が画面のどこか */
  origin() {
    return { x: this.width / 2 + this.panX, y: this.height * this.originY + this.panY };
  }
  toScreen(wx, wy) {
    const o = this.origin();
    return { x: o.x + wx * this.zoom, y: o.y + wy * this.zoom };
  }
  toWorld(sx, sy) {
    const o = this.origin();
    return { x: (sx - o.x) / this.zoom, y: (sy - o.y) / this.zoom };
  }

  // ---------- カメラ操作 ----------
  _clamp(z) {
    return Math.max(this.minZoom, Math.min(this.maxZoom, z));
  }
  /** 画面上の点 (sx, sy) を動かさずに、ズームを z にする */
  zoomAt(sx, sy, z) {
    z = this._clamp(z);
    const w = this.toWorld(sx, sy);
    this.zoom = z;
    // 新しい origin = 画面上の点 − world × 新ズーム
    this.panX = sx - w.x * z - this.width / 2;
    this.panY = sy - w.y * z - this.height * this.originY;
    this.onChange();
  }
  /** 画面中央を中心にズームを z にする（ズーム欄・＋/−ボタン用） */
  setZoom(z) {
    if (!Number.isFinite(z) || z <= 0) return;
    this.zoomAt(this.width / 2, this.height / 2, z);
  }
  panBy(dx, dy) {
    this.panX += dx;
    this.panY += dy;
    this.onChange();
  }
  /** ズーム 100%・パンなしに戻す */
  reset() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.onChange();
  }
  /** world の長方形 (x0,y0)-(x1,y1) が画面にちょうど収まるようにする（margin は余白の割合） */
  fit(x0, y0, x1, y1, margin = 0.15) {
    const bw = Math.max(1, x1 - x0),
      bh = Math.max(1, y1 - y0);
    const z = this._clamp(
      Math.min((this.width * (1 - margin * 2)) / bw, (this.height * (1 - margin * 2)) / bh),
    );
    this.zoom = z;
    const cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2;
    this.panX = this.width / 2 - cx * z - this.width / 2;
    this.panY = this.height / 2 - cy * z - this.height * this.originY;
    this.onChange();
  }
  setPanMode(on) {
    this.panMode = !!on;
    this._updateCursor();
  }

  // ---------- 描画の補助 ----------
  /** 背景のグリッドと、基準線（足元の横線 / 中心の縦線）を描く。背景色が明るい/暗いかを見て線の色を選ぶ */
  drawGrid(ctx) {
    const w = this.width,
      h = this.height,
      o = this.origin(),
      z = this.zoom;
    const bg = getComputedStyle(this.canvas).backgroundColor.match(/[\d.]+/g) || [0, 0, 0];
    const light = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255 > 0.55;
    const minor = light ? "rgba(20,35,60,0.10)" : "rgba(255,255,255,0.07)";
    const major = light ? "rgba(20,35,60,0.20)" : "rgba(255,255,255,0.15)";
    // 画面上で 28px 以上あく最小の間隔を選ぶ
    const step = GRID_STEPS.find((s) => s * z >= 28) || GRID_STEPS[GRID_STEPS.length - 1];
    const px = step * z;
    ctx.save();
    ctx.lineWidth = 1;
    const kx0 = Math.floor(-o.x / px),
      kx1 = Math.ceil((w - o.x) / px);
    const ky0 = Math.floor(-o.y / px),
      ky1 = Math.ceil((h - o.y) / px);
    for (let k = kx0; k <= kx1; k++) {
      ctx.strokeStyle = k % 5 === 0 ? major : minor;
      const x = Math.round(o.x + k * px) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let k = ky0; k <= ky1; k++) {
      ctx.strokeStyle = k % 5 === 0 ? major : minor;
      const y = Math.round(o.y + k * px) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // 基準線: 足元（横）と中心（縦）。どれだけパンしても無限に伸びる
    ctx.strokeStyle = light ? "#1a6fd1" : "#80baff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(o.x, 0);
    ctx.lineTo(o.x, h);
    ctx.moveTo(0, o.y);
    ctx.lineTo(w, o.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = light ? "#1a6fd1" : "#80baff";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(`0, 0   grid ${step}px`, o.x + 6, o.y + 14);
    ctx.restore();
  }

  // ---------- 入力 ----------
  _setSpace(on) {
    if (this.spaceDown === on) return;
    this.spaceDown = on;
    this._updateCursor();
  }
  _updateCursor() {
    const armed = this.panMode || this.spaceDown;
    this.canvas.style.cursor = this.panning ? "grabbing" : armed ? "grab" : "";
    // UnsavedGuard が「パン操作は編集ではない」と判断するための目印
    this.canvas.dataset.pan = armed ? "1" : "";
  }
  _onWheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const unit = e.deltaMode === 1 ? 16 : 1; // 行単位のホイールはピクセルに換算
    const k = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
    this.zoomAt(e.clientX - r.left, e.clientY - r.top, this.zoom * k);
  }
  _onDown(e) {
    const wants =
      e.button === 1 || e.button === 2 || (e.button === 0 && (this.panMode || this.spaceDown));
    if (!wants) return;
    e.preventDefault();
    this.panning = true;
    this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    this.canvas.setPointerCapture(e.pointerId);
    this._updateCursor();
  }
  _onMove(e) {
    if (!this.panning || this._drag?.id !== e.pointerId) return;
    this.panBy(e.clientX - this._drag.x, e.clientY - this._drag.y);
    this._drag.x = e.clientX;
    this._drag.y = e.clientY;
  }
  _onUp(e) {
    if (!this.panning || this._drag?.id !== e.pointerId) return;
    this.panning = false;
    this._drag = null;
    this._updateCursor();
  }
}
