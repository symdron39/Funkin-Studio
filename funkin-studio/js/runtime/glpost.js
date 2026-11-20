/* ============================================================
   runtime/glpost.js — カメラの「フィルター（シェーダー）」を WebGL で掛ける後処理
   ------------------------------------------------------------
   ・2D キャンバスに描いたカメラの絵をテクスチャにして、フラグメントシェーダーで 1 枚の板に描き直す。
   ・シェーダーを持つカメラだけがここを通る（普通のカメラは追加コスト 0）。WebGL が使えない環境では null を返して素通し。
   ・シェーダーの形: { glsl?: フラグメントのソース, uniforms: {名前: 数値}, active(): 効果が掛かっているか }
     glsl の中では varying vec2 uv; uniform sampler2D tex; が使える。出力は「アルファ乗算済み」の色。
   ・組み込み: grayscale（Grayscale イベント用）。
   ============================================================ */
const VERT = "attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }";
const VERT_TL = "attribute vec2 p; varying vec2 uv; void main(){ uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }"; // 左上が (0,0)（OpenFL / .frag 用）
export const GLSL_GRAYSCALE = `precision mediump float; varying vec2 uv; uniform sampler2D tex; uniform float amount;
void main(){ vec4 c = texture2D(tex, uv); float g = dot(c.rgb, vec3(0.299, 0.587, 0.114)); gl_FragColor = vec4(mix(c.rgb, vec3(g), amount), c.a); }`;

export class GLPost {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.gl = null;
    this.progs = new Map();
    this.failed = new Set();
    try {
      this.gl = this.canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
    } catch {}
    const gl = this.gl;
    if (!gl) return;
    try {
      // 描画に使われている GPU の名前（"SwiftShader" や "llvmpipe" ならソフトウェア描画で、シェーダーが極端に遅くなる）
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      GLPost.renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).replace(/ANGLE \((.*)\)/, "$1").replace(/\s*\(0x[0-9a-f]+\)/gi, "").replace(/^Google, /, "").slice(0, 48);
    } catch {}
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }
  get ok() {
    return !!this.gl;
  }
  program(glsl, topLeft = false) {
    const pk = (topLeft ? "T|" : "B|") + glsl;
    if (this.progs.has(pk)) return this.progs.get(pk);
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s) || "シェーダーをコンパイルできません");
      return s;
    };
    let prog = null;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, topLeft ? VERT_TL : VERT));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, glsl));
      gl.bindAttribLocation(prog, 0, "p");
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(prog) || "リンクできません");
    } catch (e) {
      prog = { error: e.message };
    }
    this.progs.set(pk, prog);
    return prog;
  }
  /**
   * src(2D キャンバス)にシェーダーを掛けた結果の canvas を返す。失敗時は null（呼び出し側は素通し）。
   * 結果は GL キャンバスの「左下から src と同じ大きさ」の領域に入る（キャンバス自体は大きくなる一方で作り直さない = 毎回のバッファ再確保を避ける）。
   * 読むときは必ず blit()（領域を切り出して描く）を使うこと。
   */
  apply(src, shader) {
    const gl = this.gl;
    if (!gl) return null;
    const glsl = shader.glsl ?? GLSL_GRAYSCALE;
    const prog = this.program(glsl, !!shader.topLeft);
    if (prog.error) {
      if (!this.failed.has(glsl)) {
        this.failed.add(glsl);
        shader.onError?.(prog.error);
      }
      return null;
    }
    const w = src.width,
      h = src.height;
    if (this.canvas.width < w || this.canvas.height < h) {
      this.canvas.width = Math.max(this.canvas.width, w);
      this.canvas.height = Math.max(this.canvas.height, h);
    }
    const ch = this.canvas.height;
    this.sub = { x: 0, y: ch - h, w, h };
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.cur !== prog) {
      gl.useProgram(prog);
      this.cur = prog;
      if (!prog.locs) prog.locs = new Map();
      if (!prog.last) prog.last = new Map();
    }
    if (!this.attrib) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.attrib = true;
    }
    const loc = (n) => {
      let l = prog.locs.get(n);
      if (l === undefined) prog.locs.set(n, (l = gl.getUniformLocation(prog, n)));
      return l;
    };
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    const flip = !shader.topLeft;
    if (this.flip !== flip) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
      this.flip = flip;
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    // 変わっていない uniform は送り直さない（texture のサンプラー番号は最初の 1 回だけ）
    const last = prog.last;
    const setOnce = (k, v, fn) => {
      const key = Array.isArray(v) ? v.join(",") : v;
      if (last.get(k) === key) return;
      last.set(k, key);
      fn();
    };
    const lt = loc("tex");
    if (lt) setOnce("tex", 0, () => gl.uniform1i(lt, 0));
    const ts = loc("openfl_TextureSize");
    if (ts) setOnce("openfl_TextureSize", `${w},${h}`, () => gl.uniform2f(ts, w, h));
    const u = shader.uniforms;
    if (u)
      for (const k in u) {
        const l = loc(k);
        if (!l) continue;
        const v = u[k];
        const isInt = shader.types?.[k] === "i";
        setOnce(k, v, () => {
          if (Array.isArray(v)) {
            if (isInt) [null, gl.uniform1iv, gl.uniform2iv, gl.uniform3iv, gl.uniform4iv][v.length]?.call(gl, l, v);
            else if (v.length === 9) gl.uniformMatrix3fv(l, false, v);
            else if (v.length === 16) gl.uniformMatrix4fv(l, false, v);
            else [null, gl.uniform1fv, gl.uniform2fv, gl.uniform3fv, gl.uniform4fv][v.length]?.call(gl, l, v);
          } else if (isInt) gl.uniform1i(l, Number(v) | 0);
          else gl.uniform1f(l, Number(v) || 0);
        });
      }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
  /** apply() の結果（左下の領域）を ctx に描く。(dx, dy, dw, dh) は描き先。res が GL の出力でなければ普通の drawImage */
  blit(res, ctx, dx, dy, dw, dh) {
    if (res === this.canvas && this.sub) {
      const s = this.sub;
      ctx.drawImage(res, s.x, s.y, s.w, s.h, dx, dy, dw ?? s.w, dh ?? s.h);
    } else ctx.drawImage(res, dx, dy, dw ?? res.width, dh ?? res.height);
  }
}

/**
 * 描画の品質の自動調整（シェーダーまわり）。フレームの間隔が長引いたらシェーダーに掛ける絵を縮小し、余裕があれば戻す。
 *   mode: "auto" | 1 | 0.75 | 0.5 | 0.35（固定）。scale が実際に使う倍率。
 */
GLPost.renderer = "";

export const Quality = {
  mode: "auto",
  scale: 1,
  _last: 0,
  _slow: 0,
  _fast: 0,
  /** フレームごとに 1 回呼ぶ（draw の先頭）。dt が極端に長い（タブ復帰・一時停止）ものは無視する */
  tick(now = performance.now()) {
    const dt = now - this._last;
    this._last = now;
    if (this.mode !== "auto") {
      this.scale = Number(this.mode) || 1;
      return;
    }
    if (dt > 250 || dt <= 0) return;
    if (dt > 26) {
      this._fast = 0;
      if (++this._slow >= 12) {
        this._slow = 0;
        this.scale = Math.max(0.35, this.scale * 0.8);
      }
    } else if (dt < 19) {
      this._slow = 0;
      if (++this._fast >= 150) {
        this._fast = 0;
        this.scale = Math.min(1, this.scale * 1.15);
      }
    }
  },
};
