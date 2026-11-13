/* ============================================================
   runtime/runtime.js — V-Slice の演出スクリプト（SongEvent / Module）を動かす、軽量なゲーム環境
   ------------------------------------------------------------
   ・HScript（hscript.js）に「それっぽい FlxG / PlayState / FlxSprite / FlxTween ...」を渡して、
     .hxc のイベントやモジュールを実際に実行する。画面に出るもの（スプライト・テキスト・フィルター）は
     3 つのカメラ（camGame / camHUD / camCutscene）に描く。
   ・本物の V-Slice ではないので、再現しているのは「演出に使われやすい API」だけ。
     ない API は「スタブ」（何を呼んでも落ちない代役）になり、使われたものが warnings に集まる。
   ・軽量化: ・描画は 1280×720 の仮想座標を縮尺する 2D キャンバス描画  ・シェーダーを持つカメラだけ WebGL を通す
     ・画面外 / alpha 0 のものは描かない  ・Tween は 1 本のリストを 1 回なめるだけ
   ============================================================ */
import { HScript, HMap, makeStub } from "./hscript.js";
import { GLPost, GLSL_GRAYSCALE } from "./glpost.js";

const LAYER_MAX_W = 1280; // フィルターを掛けるカメラの絵の最大幅(px)
export const GAME_W = 1280,
  GAME_H = 720;

// ---------------------------------------------------------------- イージング（Flixel の FlxEase と同じ式）
const A = 1,
  P = 0.4,
  S = (P / (2 * Math.PI)) * Math.asin(1 / A);
const bounceOut = (t) => {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
  if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
  return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
};
const smoothInOut = (t) => t * t * (t * -2 + 3);
const smootherInOut = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const FlxEase = {
  linear: (t) => t,
  quadIn: (t) => t * t,
  quadOut: (t) => -t * (t - 2),
  quadInOut: (t) => (t <= 0.5 ? t * t * 2 : 1 - --t * t * 2),
  cubeIn: (t) => t * t * t,
  cubeOut: (t) => 1 + --t * t * t,
  cubeInOut: (t) => (t <= 0.5 ? t * t * t * 4 : 1 + --t * t * t * 4),
  quartIn: (t) => t * t * t * t,
  quartOut: (t) => 1 - (t -= 1) * t * t * t,
  quartInOut: (t) => (t <= 0.5 ? t * t * t * t * 8 : (1 - (t = t * 2 - 2) * t * t * t) / 2 + 0.5),
  quintIn: (t) => t * t * t * t * t,
  quintOut: (t) => (t = t - 1) * t * t * t * t + 1,
  quintInOut: (t) => (t <= 0.5 ? t * t * t * t * t * 16 : ((t = t * 2 - 2) * t * t * t * t + 2) / 2),
  sineIn: (t) => -Math.cos((Math.PI / 2) * t) + 1,
  sineOut: (t) => Math.sin((Math.PI / 2) * t),
  sineInOut: (t) => -Math.cos(Math.PI * t) / 2 + 0.5,
  bounceIn: (t) => 1 - bounceOut(1 - t),
  bounceOut,
  bounceInOut: (t) => (t < 0.5 ? (1 - bounceOut(1 - t * 2)) / 2 : bounceOut(t * 2 - 1) / 2 + 0.5),
  circIn: (t) => -(Math.sqrt(1 - t * t) - 1),
  circOut: (t) => Math.sqrt(1 - (t - 1) * (t - 1)),
  circInOut: (t) => (t <= 0.5 ? (Math.sqrt(1 - t * t * 4) - 1) / -2 : (Math.sqrt(1 - (t * 2 - 2) * (t * 2 - 2)) + 1) / 2),
  expoIn: (t) => Math.pow(2, 10 * (t - 1)),
  expoOut: (t) => -Math.pow(2, -10 * t) + 1,
  expoInOut: (t) => (t < 0.5 ? Math.pow(2, 10 * (t * 2 - 1)) / 2 : (-Math.pow(2, -10 * (t * 2 - 1)) + 2) / 2),
  backIn: (t) => t * t * (2.70158 * t - 1.70158),
  backOut: (t) => 1 - --t * t * (-2.70158 * t - 1.70158),
  backInOut: (t) => ((t *= 2) < 1 ? (t * t * (2.70158 * t - 1.70158)) / 2 : (1 - (t -= 2) * t * (-2.70158 * t - 1.70158)) / 2 + 0.5),
  elasticIn: (t) => -(A * Math.pow(2, 10 * (t -= 1)) * Math.sin(((t - S) * (2 * Math.PI)) / P)),
  elasticOut: (t) => A * Math.pow(2, -10 * t) * Math.sin(((t - S) * (2 * Math.PI)) / P) + 1,
  elasticInOut: (t) => (t < 0.5 ? -0.5 * (A * Math.pow(2, 10 * (t = t * 2 - 1)) * Math.sin(((t - S) * (2 * Math.PI)) / (P * 1.5))) : A * Math.pow(2, -10 * (t = t * 2 - 1)) * Math.sin(((t - S) * (2 * Math.PI)) / (P * 1.5)) * 0.5 + 1),
  smoothStepIn: (t) => 2 * smoothInOut(t / 2),
  smoothStepOut: (t) => 2 * smoothInOut(t / 2 + 0.5) - 1,
  smoothStepInOut: smoothInOut,
  smootherStepIn: (t) => 2 * smootherInOut(t / 2),
  smootherStepOut: (t) => 2 * smootherInOut(t / 2 + 0.5) - 1,
  smootherStepInOut: smootherInOut,
};

// ---------------------------------------------------------------- 色（Flixel の FlxColor は Int の ARGB）
const NAMED = { BLACK: 0xff000000, WHITE: 0xffffffff, GRAY: 0xff808080, GREEN: 0xff008000, LIME: 0xff00ff00, YELLOW: 0xffffff00, ORANGE: 0xffffa500, RED: 0xffff0000, PURPLE: 0xff800080, BLUE: 0xff0000ff, BROWN: 0xff8b4513, PINK: 0xffffc0cb, MAGENTA: 0xffff00ff, CYAN: 0xff00ffff, TRANSPARENT: 0x00000000 };
const u32 = (n) => n >>> 0;
const rgbOf = (c) => [(c >>> 16) & 255, (c >>> 8) & 255, c & 255];
export const FlxColor = {
  ...NAMED,
  fromString(s) {
    if (s == null) return null;
    s = String(s).trim();
    const u = s.toUpperCase();
    if (NAMED[u] !== undefined) return NAMED[u];
    let m = s.match(/^(?:#|0x)([0-9a-fA-F]{6})$/);
    if (m) return u32(0xff000000 | parseInt(m[1], 16));
    m = s.match(/^(?:#|0x)([0-9a-fA-F]{8})$/);
    if (m) return u32(parseInt(m[1], 16));
    return null;
  },
  fromRGB: (r, g, b, a = 255) => u32((a << 24) | (r << 16) | (g << 8) | b),
  interpolate(c1, c2, f = 0.5) {
    const a = [c1 >>> 24, ...rgbOf(c1)],
      b = [c2 >>> 24, ...rgbOf(c2)];
    const m = a.map((v, i) => Math.round(v + (b[i] - v) * f));
    return u32((m[0] << 24) | (m[1] << 16) | (m[2] << 8) | m[3]);
  },
};

// ---------------------------------------------------------------- 表示物
class Pt {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  set(x, y = x) {
    this.x = x;
    this.y = y;
    return this;
  }
}
class FlxBasic {
  constructor() {
    this.exists = true;
    this.alive = true;
    this.visible = true;
    this.active = true;
    this.cameras = null;
  }
  destroy() {
    this.exists = false;
    this.alive = false;
  }
  kill() {
    this.alive = false;
    this.exists = false;
  }
}
class FlxObject extends FlxBasic {
  constructor(x = 0, y = 0) {
    super();
    this.x = x;
    this.y = y;
    this.alpha = 1;
    this.angle = 0;
    this.scrollFactor = new Pt(1, 1);
    this.scale = new Pt(1, 1);
    this.offset = new Pt(0, 0);
    this.antialiasing = true;
    this.width = 0;
    this.height = 0;
  }
  screenCenter(axes = "xy") {
    if (axes === "x" || axes === "xy") this.x = (GAME_W - this.width) / 2;
    if (axes === "y" || axes === "xy") this.y = (GAME_H - this.height) / 2;
    return this;
  }
}
export class FlxSprite extends FlxObject {
  constructor(x = 0, y = 0) {
    super(x, y);
    this.color = 0xffffffff;
    this.fw = 0;
    this.fh = 0;
    this.gfx = 0xffffffff; // makeGraphic の色
    this.hb = false; // updateHitbox 済みか
    this.flipX = false;
    this.flipY = false;
  }
  makeGraphic(w, h, color = 0xffffffff) {
    this.fw = w;
    this.fh = h;
    this.gfx = u32(color);
    this.width = w * this.scale.x;
    this.height = h * this.scale.y;
    return this;
  }
  setGraphicSize(w = 0, h = 0) {
    if (w > 0) this.scale.x = w / (this.fw || 1);
    if (h > 0) this.scale.y = h / (this.fh || 1);
    if (w > 0 && h <= 0) this.scale.y = this.scale.x;
    if (h > 0 && w <= 0) this.scale.x = this.scale.y;
    return this;
  }
  updateHitbox() {
    this.width = this.fw * Math.abs(this.scale.x);
    this.height = this.fh * Math.abs(this.scale.y);
    this.hb = true;
  }
  loadGraphic() {} // 画像の読み込みは未対応（スタブ扱い）
  draw(ctx) {
    if (!this.fw || !this.fh) return;
    const sx = Math.abs(this.scale.x),
      sy = Math.abs(this.scale.y);
    const w = this.fw * sx,
      h = this.fh * sy;
    // updateHitbox 前は、中心を基準に拡大される
    const x = this.hb ? this.x : this.x + (this.fw - w) / 2,
      y = this.hb ? this.y : this.y + (this.fh - h) / 2;
    const [r1, g1, b1] = rgbOf(this.gfx),
      [r2, g2, b2] = rgbOf(this.color);
    const a = (this.gfx >>> 24) / 255;
    ctx.globalAlpha = this.alpha * a;
    ctx.fillStyle = `rgb(${((r1 * r2) / 255) | 0},${((g1 * g2) / 255) | 0},${((b1 * b2) / 255) | 0})`;
    if (this.angle) {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate((this.angle * Math.PI) / 180);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    } else ctx.fillRect(x, y, w, h);
  }
}
let measureCtx = null;
export class FlxText extends FlxObject {
  constructor(x = 0, y = 0, fieldWidth = 0, text = "", size = 8) {
    super(x, y);
    this._text = text;
    this.fieldWidth = fieldWidth;
    this.size = size;
    this.color = 0xffffffff;
    this.font = null;
    this.alignment = "left";
    this.borderStyle = "none";
    this.borderColor = 0xff000000;
    this.borderSize = 1;
    this.fontFamily = "system-ui, 'Hiragino Sans', 'Noto Sans JP', sans-serif";
  }
  get text() {
    return this._text;
  }
  set text(v) {
    this._text = String(v ?? "");
  }
  fontStr() {
    return `bold ${this.size}px ${this.fontFamily}`;
  }
  get width() {
    if (this.fieldWidth > 0) return this.fieldWidth;
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = this.fontStr();
    return Math.max(...String(this._text).split("\n").map((l) => measureCtx.measureText(l).width), 0) + 4;
  }
  set width(v) {}
  get height() {
    return this.size * 1.25 * String(this._text).split("\n").length + 4;
  }
  set height(v) {}
  setFormat(font, size, color, align, borderStyle, borderColor) {
    if (font) this.font = font;
    if (size) this.size = size;
    if (color != null) this.color = u32(color);
    if (align) this.alignment = align;
    if (borderStyle) this.borderStyle = borderStyle;
    if (borderColor != null) this.borderColor = u32(borderColor);
    return this;
  }
  draw(ctx) {
    if (!this._text) return;
    ctx.globalAlpha = this.alpha;
    ctx.font = this.fontStr();
    ctx.textBaseline = "top";
    const w = this.width,
      lines = String(this._text).split("\n");
    ctx.textAlign = this.alignment === "center" ? "center" : this.alignment === "right" ? "right" : "left";
    const ax = this.alignment === "center" ? this.x + w / 2 : this.alignment === "right" ? this.x + w : this.x;
    const [r, g, b] = rgbOf(this.color);
    lines.forEach((ln, i) => {
      const y = this.y + 2 + i * this.size * 1.25;
      if (this.borderStyle === "outline" || this.borderStyle === "outline_fast") {
        ctx.lineJoin = "round";
        const [br, bg, bb] = rgbOf(this.borderColor);
        ctx.strokeStyle = `rgb(${br},${bg},${bb})`;
        ctx.lineWidth = this.borderSize * 2;
        ctx.strokeText(ln, ax, y);
      } else if (this.borderStyle === "shadow") {
        ctx.fillStyle = "rgba(0,0,0,.6)";
        ctx.fillText(ln, ax + this.borderSize, y + this.borderSize);
      }
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillText(ln, ax, y);
    });
  }
}
export class FlxTypedGroup extends FlxBasic {
  constructor() {
    super();
    this.members = [];
  }
  get length() {
    return this.members.length;
  }
  add(o) {
    if (o && !this.members.includes(o)) this.members.push(o);
    return o;
  }
  insert(i, o) {
    if (o && !this.members.includes(o)) this.members.splice(Math.max(0, Math.min(i, this.members.length)), 0, o);
    return o;
  }
  remove(o) {
    const i = this.members.indexOf(o);
    if (i >= 0) this.members.splice(i, 1);
    return o;
  }
  destroy() {
    for (const m of this.members) m?.destroy?.();
    this.members = [];
    super.destroy();
  }
}

export class FlxCamera {
  constructor(name) {
    this.name = name;
    this.filters = [];
    this.alpha = 1;
    this.zoom = 1;
    this.width = GAME_W;
    this.height = GAME_H;
    this.layer = null; // フィルター用のオフスクリーン
  }
}
export class FlxCamFilter {
  // ShaderFilter(shader)
  constructor(shader) {
    this.shader = shader;
  }
}
/** Grayscale シェーダー（amount 0 = 元の色、1 = 白黒） */
export class Grayscale {
  constructor(amount = 0) {
    this.amount = amount;
    this.glsl = GLSL_GRAYSCALE;
  }
  get uniforms() {
    return { amount: this.amount };
  }
  setAmount(a) {
    this.amount = a;
  }
  active() {
    return this.amount > 0.0005;
  }
}

// ---------------------------------------------------------------- Tween
class Tween {
  constructor(mgr, o) {
    Object.assign(this, { mgr, active: true, finished: false, elapsed: 0, value: 0, delay: o.delay || 0 });
    this.duration = Math.max(0.0001, o.duration);
    this.ease = o.ease || FlxEase.linear;
    this.onUpdate = o.onUpdate;
    this.onComplete = o.onComplete;
    this.setup = o.setup; // elapsed 比率 → 値を反映
    this.loop = o.loop;
  }
  cancel() {
    this.finished = true;
    this.active = false;
    this.mgr.remove(this);
  }
  destroy() {
    this.cancel();
  }
  step(dt) {
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay > 0) return;
      dt = -this.delay;
      this.delay = 0;
    }
    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / this.duration);
    this.setup(this.ease(t), this);
    this.onUpdate?.(this);
    if (t >= 1) {
      if (this.loop) {
        this.elapsed = 0;
        return;
      }
      this.finished = true;
      this.mgr.remove(this);
      this.onComplete?.(this);
    }
  }
}
class TweenManager {
  constructor() {
    this.list = [];
  }
  remove(t) {
    const i = this.list.indexOf(t);
    if (i >= 0) this.list.splice(i, 1);
  }
  clear() {
    this.list = [];
  }
  update(dt) {
    for (const t of this.list.slice()) if (t.active && !t.finished) t.step(dt);
  }
}

// ---------------------------------------------------------------- ランタイム本体
const withStubs = (obj, path, stub) =>
  new Proxy(obj, {
    get(t, p) {
      if (typeof p === "symbol" || p in t) return Reflect.get(t, p);
      if (String(p).startsWith("__") || p === "then" || p === "toJSON") return undefined; // インタプリタの内部探索に反応しない
      return stub(`${path}.${String(p)}`);
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  });

export class Runtime {
  /**
   * @param opts { noteStyles: NoteStyleSet, getOpts(): {down, ...}, onLog(msg) }
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.gl = null; // 必要になったときだけ作る
    this.scripts = new Map(); // ファイル名 → テキスト
    this.reset();
  }
  /** 全部作り直す（プレイテストを始めるたびに呼ぶ。スクリプトの内部状態も新品になる） */
  reset() {
    this.warnings = new Set(); // 未対応 API
    this.errors = []; // スクリプトの実行エラー
    this.tweens = new TweenManager();
    this.postUpdate = [];
    this.pos = 0;
    this.modules = new Map();
    this.eventInst = new Map(); // kind → {inst, processOld}
    this.cams = { camGame: new FlxCamera("camGame"), camHUD: new FlxCamera("camHUD"), camCutscene: new FlxCamera("camCutscene") };
    this.ps = null;
    this.hs = null;
    this.logs = [];
    this.loaded = [];
    this.build();
  }
  warn(msg) {
    if (!this.warnings.has(msg)) {
      this.warnings.add(msg);
    }
  }
  fail(where, e) {
    const msg = `${where}: ${e instanceof Error ? e.message : String(e)}`;
    if (!this.errors.includes(msg)) this.errors.push(msg);
  }
  stub(path) {
    if (!this._stubs) this._stubs = new Map();
    if (!this._stubs.has(path)) this._stubs.set(path, makeStub(path, (p, isSet) => this.warn(isSet ? `${p}（代入）` : `${p}()`)));
    return this._stubs.get(path);
  }

  build() {
    const rt = this;
    const stub = (p) => rt.stub(p);
    const ns = this.opts.noteStyles;
    const arrows = () => Array.from({ length: 4 }, (_, i) => withStubs({ direction: i, x: 0, y: 0, scale: new Pt(1, 1), updateHitbox() {}, playStatic() {}, playPress() {}, playConfirm() {} }, "StrumlineNote", stub));
    const strumline = (name) =>
      withStubs({ noteStyle: null, notes: { members: [] }, holdNotes: { members: [] }, strumlineNotes: { members: arrows() }, strumlineScale: new Pt(1, 1) }, name, stub);
    const ps = {
      camGame: this.cams.camGame,
      camHUD: this.cams.camHUD,
      camCutscene: this.cams.camCutscene,
      members: [],
      isMinimalMode: false,
      playerStrumline: strumline("PlayState.playerStrumline"),
      opponentStrumline: strumline("PlayState.opponentStrumline"),
      currentChart: { scrollSpeed: 1, characters: this.opts.characters ?? { player: "bf", girlfriend: "gf", opponent: "dad" } },
      add(o) {
        if (o && !this.members.includes(o)) this.members.push(o);
        return o;
      },
      insert(i, o) {
        if (o && !this.members.includes(o)) this.members.splice(Math.max(0, Math.min(i, this.members.length)), 0, o);
        return o;
      },
      remove(o) {
        const i = this.members.indexOf(o);
        if (i >= 0) this.members.splice(i, 1);
        return o;
      },
    };
    this.ps = withStubs(ps, "PlayState", stub);
    const psRef = this.ps;
    const baseGroup = FlxTypedGroup;
    const G = {
      // ---- ゲームの基本
      PlayState: { instance: psRef },
      FlxG: withStubs(
        {
          width: GAME_W,
          height: GAME_H,
          elapsed: 1 / 60,
          signals: { postUpdate: { add: (f) => rt.postUpdate.push(f), remove: (f) => (rt.postUpdate = rt.postUpdate.filter((x) => x !== f)) }, preUpdate: { add() {}, remove() {} } },
          random: { int: (a = 0, b = 1) => a + Math.floor(Math.random() * (b - a + 1)), float: (a = 0, b = 1) => a + Math.random() * (b - a) },
          camera: this.cams.camGame,
          cameras: { list: Object.values(this.cams) },
        },
        "FlxG",
        stub,
      ),
      Conductor: {
        instance: withStubs(
          {
            get songPosition() {
              return rt.pos;
            },
            bpm: 100,
          },
          "Conductor.instance",
          stub,
        ),
      },
      Preferences: withStubs(
        {
          flashingLights: true,
          get downscroll() {
            return !!rt.opts.getOpts?.().down;
          },
        },
        "Preferences",
        stub,
      ),
      Save: { instance: withStubs({ modOptions: { get: () => null, set() {} } }, "Save.instance", stub) },
      ModuleHandler: { getModule: (id) => rt.modules.get(id) ?? null },
      Paths: withStubs({ font: (f) => f }, "Paths", stub),
      Assets: { exists: () => false },
      // ---- 表示物
      FlxSprite,
      FlxText,
      FlxTypedGroup: baseGroup,
      FlxGroup: baseGroup,
      FlxSpriteGroup: baseGroup,
      FlxColor,
      FlxEase,
      FlxTextAlign: { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFY: "left" },
      FlxTextBorderStyle: { NONE: "none", SHADOW: "shadow", OUTLINE: "outline", OUTLINE_FAST: "outline_fast" },
      FlxAxes: { X: "x", Y: "y", XY: "xy" },
      FlxPoint: Pt,
      ShaderFilter: FlxCamFilter,
      Grayscale,
      FlxTween: {
        tween(obj, props, duration, o = {}) {
          const from = {};
          for (const k of Object.keys(props)) from[k] = obj[k];
          const tw = new Tween(rt.tweens, {
            duration,
            ease: o.ease,
            delay: o.startDelay,
            onUpdate: o.onUpdate,
            onComplete: o.onComplete,
            loop: o.type === 2 || o.type === "looping",
            setup: (e) => {
              for (const k of Object.keys(props)) obj[k] = from[k] + (props[k] - from[k]) * e;
            },
          });
          rt.tweens.list.push(tw);
          return tw;
        },
        num(a, b, duration, o = {}, fn) {
          const tw = new Tween(rt.tweens, {
            duration,
            ease: o.ease,
            delay: o.startDelay,
            onUpdate: (t) => {
              o.onUpdate?.(t);
              fn?.(t.value);
            },
            onComplete: o.onComplete,
            setup: (e, t) => (t.value = a + (b - a) * e),
          });
          tw.value = a;
          rt.tweens.list.push(tw);
          return tw;
        },
      },
      // ---- ノートスキン
      NoteStyleRegistry: {
        instance: {
          fetchEntry: (id) => ns?.get(id) ?? null,
          listEntryIds: () => ns?.ids() ?? [],
        },
      },
      FunkinMemory: withStubs({ cacheNoteStyle() {} }, "FunkinMemory", stub),
      // ---- スクリプトの土台
      SongEventSchema: class {
        constructor(fields) {
          this.fields = fields;
        }
      },
      SongEventFieldType: { STRING: "string", INTEGER: "integer", FLOAT: "float", BOOL: "bool", ENUM: "enum", FRAME: "frame" },
      // ---- Haxe 標準
      Std: {
        int: (x) => Math.trunc(x),
        string: (x) => (x == null ? "null" : String(x)),
        parseInt: (s) => {
          const n = parseInt(s);
          return Number.isNaN(n) ? null : n;
        },
        parseFloat: (s) => parseFloat(s),
        isOfType: (v, T) => (T === G.Int ? Number.isInteger(v) : T === G.Float ? typeof v === "number" : T === G.String ? typeof v === "string" : T === G.Bool ? typeof v === "boolean" : T === G.Array ? Array.isArray(v) : v != null),
        random: (n) => Math.floor(Math.random() * n),
      },
      Int: { __t: "Int" },
      Float: { __t: "Float" },
      String: { __t: "String", fromCharCode: (c) => String.fromCharCode(c) },
      Bool: { __t: "Bool" },
      Array: { __t: "Array" },
      Dynamic: { __t: "Dynamic" },
      Math: Object.assign(Object.create(Math), { isNaN: Number.isNaN, isFinite: Number.isFinite, NaN: NaN, POSITIVE_INFINITY: Infinity, NEGATIVE_INFINITY: -Infinity }),
      Reflect: {
        field: (o, n) => (o == null ? null : o[n] === undefined ? null : o[n]),
        setField: (o, n, v) => void (o[n] = v),
        hasField: (o, n) => o != null && n in o,
        fields: (o) => Object.keys(o),
        callMethod: (o, f, a) => f.apply(o, a),
      },
      StringMap: HMap,
      IntMap: HMap,
      ObjectMap: HMap,
      StringTools: { trim: (s) => s.trim(), startsWith: (s, p) => s.startsWith(p), endsWith: (s, p) => s.endsWith(p), replace: (s, a, b) => s.split(a).join(b) },
      trace: (...a) => rt.log(a.join(" ")),
    };
    this.G = G;
    // スクリプトの基底クラス
    const noop = () => null;
    const bases = {
      SongEvent: {
        init(inst, args) {
          inst.__eventId = args[0];
          inst.__opts = args[1] ?? {};
          rt.eventInst.set(args[0], { inst, processOld: !!inst.__opts.processOldEvents });
        },
        methods: {
          getTitle() {
            return this.__eventId;
          },
          getEventSchema: noop,
          handleEvent: noop,
        },
      },
      Module: {
        init(inst, args) {
          inst.__moduleId = args[0];
          rt.modules.set(args[0], inst);
        },
        methods: {
          scriptCall(name, args = []) {
            return rt.hs.has(this, name) ? rt.hs.call(this, name, args) : null;
          },
          scriptGet: (n) => null,
        },
      },
    };
    bases.ScriptedSongEvent = bases.SongEvent;
    bases.ScriptedModule = bases.Module;
    this.hs = new HScript({ globals: G, bases, onStub: (p, isSet) => this.warn(isSet ? `${p}（代入）` : `${p}()`) });
  }
  log(msg) {
    this.logs.push(msg);
    if (this.logs.length > 200) this.logs.shift();
    this.opts.onLog?.(msg);
  }

  // ---------------------------------------------------------------- スクリプト
  /** テキストを読み込み、中の SongEvent / Module を作る。 → {events:[kind], modules:[id]} */
  loadScript(text, name) {
    const before = { e: new Set(this.eventInst.keys()), m: new Set(this.modules.keys()) };
    try {
      const defs = this.hs.load(text, name);
      for (const c of defs) {
        const root = this.hs.rootBase(c);
        if (root === "SongEvent" || root === "ScriptedSongEvent" || root === "Module" || root === "ScriptedModule") {
          try {
            this.hs.instantiate(c);
          } catch (e) {
            this.fail(`${name}: ${c.name} を作れません`, e);
          }
        }
      }
    } catch (e) {
      this.fail(`${name}: 読み込めません`, e);
    }
    return { events: [...this.eventInst.keys()].filter((k) => !before.e.has(k)), modules: [...this.modules.keys()].filter((k) => !before.m.has(k)) };
  }
  /** ステージとキャラ（StageScene）を PlayState の代役につなぐ: getBoyfriend / getDad / getGirlfriend / currentStage など */
  attachScene(scene) {
    this.scene = scene;
    const ps = this.ps,
      stub = (p) => this.stub(p);
    const wrap = new Map();
    const w = (key, make, path) => (wrap.has(key) ? wrap.get(key) : (wrap.set(key, withStubs(make(), path, stub)), wrap.get(key)));
    ps.currentStage = w("stage", () => scene.stageApi(), "PlayState.currentStage");
    ps.currentStageId = scene.stageId;
    const who = { getBoyfriend: "player", getDad: "opponent", getGirlfriend: "girlfriend" };
    for (const [fn, role] of Object.entries(who)) ps[fn] = () => w(role, () => scene.apiOf(role), "Character");
    ps.currentStage.getBoyfriend = ps.getBoyfriend;
    ps.currentStage.getDad = ps.getDad;
    ps.currentStage.getGirlfriend = ps.getGirlfriend;
    Object.defineProperty(ps, "currentCameraZoom", { get: () => scene.zoom, set: (v) => (scene.zoom = Number(v)), configurable: true });
    Object.defineProperty(ps, "defaultCameraZoom", { get: () => scene.zoomBase, set: (v) => (scene.zoomBase = Number(v)), configurable: true });
    ps.cameraFollowPoint = { get x() { return scene.focusTarget.x; }, set x(v) { scene.focusTarget.x = Number(v); }, get y() { return scene.focusTarget.y; }, set y(v) { scene.focusTarget.y = Number(v); }, setPosition(x, y) { scene.focusTarget = { x: Number(x), y: Number(y) }; } };
  }
  hasEvent(kind) {
    return this.eventInst.has(kind);
  }
  /** 曲の読み込み通知（Module が onSongLoaded で events を見る） */
  songLoaded(events) {
    this.events = events.map((e) => this.eventData(e));
    this.broadcast("onSongLoaded", { events: this.events });
  }
  eventData(e) {
    const v = e.v && typeof e.v === "object" ? e.v : {};
    const g = (n) => (v[n] === undefined ? null : v[n]);
    return {
      time: e.t,
      eventKind: e.e,
      value: v,
      getString: (n) => (g(n) == null ? null : String(g(n))),
      getFloat: (n) => (g(n) == null ? null : Number(g(n))),
      getInt: (n) => (g(n) == null ? null : Math.trunc(Number(g(n)))),
      getBool: (n) => (g(n) == null ? null : g(n) === true || g(n) === "true"),
      getArray: (n) => g(n),
      getDynamic: (n) => g(n),
    };
  }
  broadcast(hook, ev = {}) {
    const all = [...this.eventInst.values()].map((x) => x.inst).concat([...this.modules.values()]);
    for (const inst of all) {
      if (!this.hs.has(inst, hook)) continue;
      try {
        this.hs.call(inst, hook, [ev]);
      } catch (e) {
        this.fail(`${inst.__cls.name}.${hook}`, e);
      }
    }
  }
  /** イベントを 1 つ実行する */
  fire(e) {
    const rec = this.eventInst.get(e.e);
    if (!rec) return false;
    try {
      this.hs.call(rec.inst, "handleEvent", [this.eventData(e)]);
    } catch (err) {
      this.fail(`イベント「${e.e}」（${(e.t / 1000).toFixed(2)}s）`, err);
    }
    return true;
  }
  /** 途中から始めるとき: processOldEvents のイベントを、始める位置より前の分だけ順に実行する */
  fireOld(events, startMs) {
    for (const e of events) if (e.t < startMs && this.eventInst.get(e.e)?.processOld) this.fire(e);
  }
  /** 毎フレーム: dt = 経過秒、pos = 曲の位置(ms) */
  update(dt, pos) {
    this.pos = pos;
    this.tweens.update(dt);
    for (const f of this.postUpdate.slice()) {
      try {
        f();
      } catch (e) {
        this.fail("postUpdate", e);
        this.postUpdate = this.postUpdate.filter((x) => x !== f);
      }
    }
  }
  pause() {
    for (const t of this.tweens.list) t.__wasActive = t.active;
    this.broadcast("onPause", {});
  }
  resume() {
    this.broadcast("onResume", {});
  }
  /** 終了・やり直し時の後始末通知 */
  songEnd() {
    this.broadcast("onSongEnd", {});
  }

  // ---------------------------------------------------------------- 描画
  hasContent() {
    return this.ps.members.length > 0 || Object.values(this.cams).some((c) => c.filters.length);
  }
  *objectsOf(list, cam, inherited) {
    for (const o of list) {
      if (!o || !o.exists || !o.visible) continue;
      const cams = o.cameras ?? inherited ?? [this.cams.camGame];
      if (o.members) {
        yield* this.objectsOf(o.members, cam, cams);
        continue;
      }
      if (cams.includes(cam)) yield o;
    }
  }
  /**
   * カメラ 1 枚ぶんの描画。mainCtx は CSS ピクセル座標（dpr 倍率は設定済み）。
   * @param draw { bg(ctx), hud(ctx) }  カメラごとの「基本の絵」。game に背景、hud にレーンとノーツ
   */
  render(mainCtx, W, H, dpr, draw) {
    const k = Math.min(W / GAME_W, H / GAME_H),
      ox = (W - GAME_W * k) / 2,
      oy = (H - GAME_H * k) / 2;
    for (const cam of [this.cams.camGame, this.cams.camHUD, this.cams.camCutscene]) {
      const shaders = cam.filters.map((f) => f.shader).filter((s) => s && (s.active ? s.active() : true));
      let ctx = mainCtx;
      if (shaders.length) {
        const L = this.layerFor(cam, W, H, dpr);
        ctx = L.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, L.width, L.height);
        const q = Math.min(1, LAYER_MAX_W / Math.max(1, W * dpr)); // 高解像度の画面ではフィルター用の絵を縮小（GPU への転送量を減らす）
        ctx.setTransform(dpr * q, 0, 0, dpr * q, 0, 0);
      }
      draw.begin?.(cam.name, ctx);
      // 基本の絵 → スクリプトの表示物
      let drawn = false;
      ctx.save();
      for (const o of this.objectsOf(this.ps.members, cam, null)) {
        if (!drawn) {
          // カメラは 1280×720 の枠で切り取られる（本物と同じく、はみ出した分は見えない）
          ctx.beginPath();
          ctx.rect(ox, oy, GAME_W * k, GAME_H * k);
          ctx.clip();
          ctx.translate(ox, oy);
          ctx.scale(k, k);
          drawn = true;
        }
        if (o.alpha <= 0.002) continue;
        o.draw?.(ctx);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      draw.end?.(cam.name, ctx);
      if (shaders.length) {
        let src = ctx.canvas;
        for (const sh of shaders) {
          if (!this.gl) this.gl = new GLPost();
          if (!this.gl.ok) {
            this.warn("WebGL が使えないため、シェーダー（フィルター）は無効です");
            break;
          }
          sh.onError ??= (m) => this.fail("シェーダー", Error(m));
          const out = this.gl.apply(src, sh);
          if (out) src = out;
        }
        mainCtx.save();
        mainCtx.setTransform(1, 0, 0, 1, 0, 0);
        mainCtx.globalAlpha = cam.alpha;
        mainCtx.drawImage(src, 0, 0, Math.round(W * dpr), Math.round(H * dpr));
        mainCtx.restore();
      }
    }
  }
  layerFor(cam, W, H, dpr) {
    const q = Math.min(1, LAYER_MAX_W / Math.max(1, W * dpr));
    const w = Math.max(1, Math.round(W * dpr * q)),
      h = Math.max(1, Math.round(H * dpr * q));
    if (!cam.layer) cam.layer = document.createElement("canvas");
    if (cam.layer.width !== w || cam.layer.height !== h) {
      cam.layer.width = w;
      cam.layer.height = h;
    }
    return cam.layer;
  }
}
