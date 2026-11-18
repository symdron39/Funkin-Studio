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
  const src = String(frag ?? "");
  if (/#pragma\s+header/.test(src)) return src.replace(/#pragma\s+header/, HEADER);
  return HEADER + src;
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
