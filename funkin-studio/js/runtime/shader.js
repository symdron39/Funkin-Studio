/* ============================================================
   runtime/shader.js — FlxRuntimeShader（スクリプトから使う .frag シェーダー）
   ------------------------------------------------------------
   ・OpenFL 形式の .frag（#pragma header / bitmap / openfl_TextureCoordv / flixel_texture2D）を、glpost.js で動く WebGL1 の GLSL に直す
   ・setFloat / setFloatArray / setInt / setBool … で uniform を溜めておき、描くときに GLPost が渡す
   ・スプライト（ステージの prop）の .shader と、カメラのフィルター（ShaderFilter）の両方で使える形（{ glsl, uniforms, types, active() }）
   ・.frag の中身は Assets.getText(Paths.frag('名前')) で取る（本体のものは funkin.assets から先に取得してある）
   ============================================================ */
const HEADER = `precision mediump float;
varying vec2 uv;
uniform sampler2D tex;
uniform vec2 openfl_TextureSize;
#define bitmap tex
#define openfl_TextureCoordv uv
#define openfl_Alphav 1.0
#define openfl_ColorMultiplierv vec4(1.0)
#define openfl_ColorOffsetv vec4(0.0)
#define flixel_texture2D texture2D
`;
/** OpenFL 形式の .frag → GLPost 用の GLSL */
export function glslFrom(frag) {
  let src = compat(String(frag ?? ""));
  // RuntimePostEffectShader 向けの .frag（screenCoord など）には、その分の宣言を足す（custom-blend / rain）
  const head = /\b(screenCoord|uCameraBounds|uFrameBounds|uScreenResolution|screenToWorld|worldToScreen)\b/.test(src) && !/uniform\s+vec4\s+uCameraBounds/.test(src) ? HEADER + POST_HEAD : HEADER;
  if (/#pragma\s+header/.test(src)) return src.replace(/#pragma\s+header/, head);
  return head + src;
}
/** デスクトップの GLSL では通るが、WebGL（GLSL ES 1.00）では通らない書き方の直し（int と float の混在）。見つけた分だけ */
function compat(src) {
  // 整数定数 / 整数ループ変数 を float の演算に混ぜている: `N / openfl_TextureSize[0]` → `float(N) / …`
  src = src.replace(/\b([A-Za-z_]\w*)\s*\/\s*(openfl_TextureSize)/g, "float($1) / $2");
  // `x /= INT_CONST;`
  for (const m of src.matchAll(/\bconst\s+int\s+(\w+)\s*=/g)) src = src.replace(new RegExp(`/=\\s*${m[1]}\\b`, "g"), `/= float(${m[1]})`);
  return src;
}
const arr = (a) => Array.from(a ?? [], Number);
/** メソッドの表（スクリプトの class X extends FlxRuntimeShader から super で届く分と、new FlxRuntimeShader(...) の分で共有） */
export const shaderMethods = {
  setFloat(n, v) {
    this.uniforms[n] = Number(v);
    delete this.types[n];
  },
  setFloatArray(n, a) {
    this.uniforms[n] = arr(a);
    delete this.types[n];
  },
  setInt(n, v) {
    this.uniforms[n] = Math.trunc(Number(v));
    this.types[n] = "i";
  },
  setIntArray(n, a) {
    this.uniforms[n] = arr(a).map(Math.trunc);
    this.types[n] = "i";
  },
  setBool(n, v) {
    this.uniforms[n] = v ? 1 : 0;
    this.types[n] = "i";
  },
  setBoolArray(n, a) {
    this.uniforms[n] = arr(a).map((x) => (x ? 1 : 0));
    this.types[n] = "i";
  },
  setSampler2D() {}, // 追加のテクスチャは未対応（bitmap だけ）
  getFloat(n) {
    return this.uniforms[n] ?? null;
  },
  getFloatArray(n) {
    return this.uniforms[n] ?? null;
  },
  getInt(n) {
    return this.uniforms[n] ?? null;
  },
  getBool(n) {
    return !!this.uniforms[n];
  },
  active() {
    return true;
  },
};
/** 継承元（script class）のインスタンスと、new FlxRuntimeShader の両方の初期化 */
export function shaderInit(inst, fragCode) {
  inst.glsl = glslFrom(fragCode);
  inst.uniforms = {};
  inst.types = {};
  inst.topLeft = true; // openfl_TextureCoordv は左上が (0,0)
  inst.onError = null;
}
export class FlxRuntimeShader {
  constructor(frag) {
    shaderInit(this, frag);
  }
}
Object.assign(FlxRuntimeShader.prototype, shaderMethods);

/** funkin.graphics.shaders.AdjustColorShader（Animate の「色調整」）。hue / saturation / brightness / contrast を代入すると uniform に反映する。.frag は getFrag("adjust-color") で受け取る */
export function makeAdjustColorShader(getFrag) {
  const TO_RAD = Math.PI / 180;
  return class AdjustColorShader {
    constructor() {
      shaderInit(this, getFrag("adjust-color"));
      this._h = this._s = this._b = this._c = 0;
      this.hue = 0;
      this.saturation = 0;
      this.brightness = 0;
      this.contrast = 0;
    }
    get hue() {
      return this._h;
    }
    set hue(v) {
      this._h = Number(v) || 0;
      const h = this._h * TO_RAD,
        c = Math.cos(h),
        s = Math.sin(h),
        wR = 0.299,
        wG = 0.587,
        wB = 0.114;
      this.uniforms.hueMatrix = [wR + (1 - wR) * c - wR * s, wG - wG * c - wG * s, wB - wB * c + (1 - wB) * s, wR - wR * c + 0.143 * s, wG + (1 - wG) * c + 0.14 * s, wB - wB * c - 0.283 * s, wR - wR * c - (1 - wR) * s, wG - wG * c + wG * s, wB + (1 - wB) * c + wB * s];
    }
    get saturation() {
      return this._s;
    }
    set saturation(v) {
      this._s = Number(v) || 0;
      let x = this._s;
      if (x > 0) x *= 3;
      x = 1 + x / 100;
      const lr = 0.2126,
        lg = 0.7152,
        lb = 0.0722,
        inv = 1 - x;
      this.uniforms.saturationMatrix = [lr * inv + x, lg * inv, lb * inv, lr * inv, lg * inv + x, lb * inv, lr * inv, lg * inv, lb * inv + x];
    }
    get brightness() {
      return this._b;
    }
    set brightness(v) {
      this._b = Number(v) || 0;
      this.uniforms.brightness = this._b / 255;
    }
    get contrast() {
      return this._c;
    }
    set contrast(v) {
      this._c = Number(v) || 0;
      let x = 1 + this._c / 100;
      if (x > 1) x = (0.00852259 * Math.exp(4.76454 * (x - 1)) * 1.01 - 0.0086078159) * 10 + 1;
      this.uniforms.contrast = x;
    }
    toString() {
      return `AdjustColorShader(${this._h}, ${this._s}, ${this._b}, ${this._c})`;
    }
  };
}

/** RuntimePostEffectShader の GLSL 側（screenCoord / uCameraBounds / screenToWorld など）。ポストエフェクトは画面全体に掛けるので screenCoord = uv */
const POST_HEAD = `
#define screenCoord uv
uniform vec2 uScreenResolution;
uniform vec4 uCameraBounds;
uniform vec4 uFrameBounds;
vec2 screenToWorld(vec2 sc) { return sc * vec2(uCameraBounds.z - uCameraBounds.x, uCameraBounds.w - uCameraBounds.y) + uCameraBounds.xy; }
vec2 worldToScreen(vec2 wc) { return (wc - uCameraBounds.xy) / vec2(uCameraBounds.z - uCameraBounds.x, uCameraBounds.w - uCameraBounds.y); }
vec2 screenToFrame(vec2 sc) {
  float w = uFrameBounds.z - uFrameBounds.x, h = uFrameBounds.w - uFrameBounds.y;
  return vec2((clamp(sc.x, uFrameBounds.x, uFrameBounds.z) - uFrameBounds.x) / w, (clamp(sc.y, uFrameBounds.y, uFrameBounds.w) - uFrameBounds.y) / h);
}
vec2 bitmapCoordScale() { return vec2(1.0); }
vec2 screenToBitmap(vec2 sc) { return sc; }
vec4 sampleBitmapScreen(vec2 sc) { return texture2D(bitmap, sc); }
vec4 sampleBitmapWorld(vec2 wc) { return sampleBitmapScreen(worldToScreen(wc)); }
`;
/** funkin.graphics.shaders.RuntimeRainShader（雨 + 水たまり）。.frag は ui/shaders/rain.frag（getFrag("rain")）。mask / lightMap / blurredScreen は未対応（本物でもコメントアウトされている） */
export function makeRainShader(getFrag) {
  return class RuntimeRainShader {
    constructor() {
      shaderInit(this, getFrag("rain"));
      this.glsl = this.glsl.replace(/precision mediump float;/, "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif");
      this.uniforms.uScreenResolution = [1280, 720];
      this.uniforms.uCameraBounds = [0, 0, 1280, 720];
      this.uniforms.uFrameBounds = [0, 0, 1, 1];
      this.time = 1;
      this.spriteMode = false;
      this.scale = 1;
      this.intensity = 0.5;
      this.puddleY = 0;
      this.puddleScaleY = 0;
      this.rainColor = 0xff6680cc;
      this.numLightsSwag = 0;
    }
    set time(v) { this._time = Number(v); this.uniforms.uTime = this._time; }
    get time() { return this._time; }
    set spriteMode(v) { this._sm = !!v; this.uniforms.uSpriteMode = this._sm ? 1 : 0; this.types.uSpriteMode = "i"; }
    get spriteMode() { return this._sm; }
    set scale(v) { this._scale = Number(v); this.uniforms.uScale = this._scale; }
    get scale() { return this._scale; }
    set intensity(v) { this._int = Number(v); this.uniforms.uIntensity = this._int; }
    get intensity() { return this._int; }
    set puddleY(v) { this._py = Number(v); this.uniforms.uPuddleY = this._py; }
    get puddleY() { return this._py; }
    set puddleScaleY(v) { this._ps = Number(v); this.uniforms.uPuddleScaleY = this._ps; }
    get puddleScaleY() { return this._ps; }
    set rainColor(c) { this._rc = c; const n = Number(c) >>> 0; this.uniforms.uRainColor = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
    get rainColor() { return this._rc; }
    set numLightsSwag(v) { this._nl = Math.trunc(Number(v)); this.uniforms.numLights = this._nl; this.types.numLights = "i"; }
    get numLightsSwag() { return this._nl; }
    set mask(v) { this._mask = v; }
    get mask() { return this._mask; }
    set lightMap(v) { this._lm = v; }
    get lightMap() { return this._lm; }
    set blurredScreen(v) { this._bs = v; }
    get blurredScreen() { return this._bs; }
    update(elapsed) { this.time = this._time + Number(elapsed); }
    /** updateViewInfo(FlxG.width, FlxG.height, FlxG.camera): カメラの見ている範囲（world px） */
    updateViewInfo(w, h, cam) {
      const sx = Number(cam?.scroll?.x) || 0, sy = Number(cam?.scroll?.y) || 0;
      this.uniforms.uScreenResolution = [Number(w) || 1280, Number(h) || 720];
      this.uniforms.uCameraBounds = [sx, sy, sx + (Number(w) || 1280), sy + (Number(h) || 720)];
    }
    updateFrameInfo() {}
    toString() { return "RuntimeRainShader"; }
  };
}

/**
 * 本体の「FlxRuntimeShader を継承した小さなシェーダークラス」（HSVShader / Grayscale / MosaicEffect / GaussianBlurShader / InverseDotsShader）。
 * 値をプロパティで受け取り、決まった uniform に流す（実ソース funkin/graphics/shaders/*.hx と同じ対応）。
 *   spec = { frag: "hsv", name, props: [[プロパティ名, uniform 名, 既定値]], methods: { setAmount: "amount" } }
 */
export function makeNativeShader(getFrag, spec) {
  const C = class {
    constructor(...args) {
      shaderInit(this, getFrag(spec.frag));
      spec.props.forEach(([prop, uni, def], i) => {
        this[prop] = args[i] ?? def;
      });
    }
    toString() {
      return spec.name;
    }
  };
  for (const [prop, uni] of spec.props)
    Object.defineProperty(C.prototype, prop, {
      get() {
        return this["_" + prop];
      },
      set(v) {
        this["_" + prop] = Number(v);
        this.uniforms[uni] = Number(v);
      },
    });
  for (const [m, prop] of Object.entries(spec.methods ?? {})) C.prototype[m] = function (v) { this[prop] = v; };
  Object.defineProperty(C, "name", { value: spec.name });
  return C;
}
export const NATIVE_SHADERS = [
  { name: "HSVShader", frag: "hsv", props: [["hue", "_hue", 1], ["saturation", "_sat", 1], ["value", "_val", 1]] },
  { name: "Grayscale", frag: "grayscale", props: [["amount", "_amount", 1]], methods: { setAmount: "amount" } },
  { name: "GaussianBlurShader", frag: "gaussian-blur", props: [["amount", "_amount", 1]], methods: { setAmount: "amount" } },
  { name: "InverseDotsShader", frag: "inverse-dots", props: [["amount", "_amount", 1]], methods: { setAmount: "amount" } },
];
/** MosaicEffect: blockSize（FlxPoint）→ uBlocksize [w, h] */
export function makeMosaicEffect(getFrag, Pt) {
  return class MosaicEffect {
    constructor() {
      shaderInit(this, getFrag("mosaic"));
      this.blockSize = new Pt(1, 1);
      this.setBlockSize(1, 1);
    }
    setBlockSize(w, h) {
      this.blockSize.set(Number(w), Number(h));
      this.uniforms.uBlocksize = [Number(w), Number(h)];
    }
    toString() {
      return "MosaicEffect";
    }
  };
}
