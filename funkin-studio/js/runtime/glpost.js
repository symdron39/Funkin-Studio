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
  /** src(2D キャンバス)にシェーダーを掛けた結果の canvas を返す。失敗時は null（呼び出し側は素通し） */
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
    if (this.canvas.width !== src.width || this.canvas.height !== src.height) {
      this.canvas.width = src.width;
      this.canvas.height = src.height;
    }
    gl.viewport(0, 0, src.width, src.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !shader.topLeft);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.uniform1i(gl.getUniformLocation(prog, "tex"), 0);
    const ts = gl.getUniformLocation(prog, "openfl_TextureSize");
    if (ts) gl.uniform2f(ts, src.width, src.height);
    for (const [k, v] of Object.entries(shader.uniforms ?? {})) {
      const loc = gl.getUniformLocation(prog, k);
      if (!loc) continue;
      const isInt = shader.types?.[k] === "i";
      if (Array.isArray(v)) {
        if (isInt) [null, gl.uniform1iv, gl.uniform2iv, gl.uniform3iv, gl.uniform4iv][v.length]?.call(gl, loc, v);
        else if (v.length === 9) gl.uniformMatrix3fv(loc, false, v);
        else if (v.length === 16) gl.uniformMatrix4fv(loc, false, v);
        else [null, gl.uniform1fv, gl.uniform2fv, gl.uniform3fv, gl.uniform4fv][v.length]?.call(gl, loc, v);
      } else if (isInt) gl.uniform1i(loc, Number(v) | 0);
      else gl.uniform1f(loc, Number(v) || 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.canvas;
  }
}
