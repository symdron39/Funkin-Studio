/* ============================================================
   stage/atlas.js — 絵の形式ごとの違いを「フレーム」にそろえる（Sparrow / Packer / AnimateAtlas）
   ------------------------------------------------------------
   Stage Editor が描く絵は、形式ごとにデータの形がまるで違う:
     ・Sparrow / Packer … 1枚の PNG から四角を切り出す（XML / TXT が切り出す位置を持つ）
     ・AnimateAtlas      … Animation.json の「タイムライン」が、spritemap の小さな四角を行列で並べて絵を作る
   この違いを呼び出し側（props・キャラ）に見せないよう、どちらも同じ形の「フレーム」を返す:

       frame = { w, h, bx, by, draw(ctx, x, y, ref, stageMatrix, img) }
         w, h   : フレームの枠の大きさ（V-Slice の frameWidth / frameHeight。ここから hitbox・足元・カメラ焦点が決まる）
         bx, by : 枠の左上の、アトラス座標での位置（Sparrow は 0,0）
         draw   : 枠の左上が (x, y) に来るように描く（Flixel と同じ）
                  AnimateAtlas だけ stageMatrix=true のとき、ステージ原点を基準枠（ref）に固定して描く

   二つの「アトラス」クラスは同じ口を持つ:   frames(anim, opts) → フレーム配列 / first() → 先頭フレーム

   [出典] FlxAnimationUtil.addAtlasAnimation / addTextureAtlasAnimation（frames の選び方）、
          Stage.hx（packer は frameIndices、animateatlas は frameLabel / symbol）、
          MultiSparrowCharacter / MultiAnimateAtlasCharacter（アニメごとの assetPath と renderType）
   ※ AnimateAtlas の描画ロジックは Character Editor（states/character/editor.js）と同じ。あちらは触らない方針のため重複している。
   ============================================================ */
import { loadImage, parseSparrowXml, parsePackerText, sparrowSequenceOf, paintSparrow } from "./sparrowAtlas.js";

// ============================================================
// 1. Sparrow / Packer（切り出す形式）
// ============================================================
class SpriteFrame {
  constructor(sp, image) {
    this.sp = sp;
    this.image = image;
    this.w = sp.frameWidth || sp.width;
    this.h = sp.frameHeight || sp.height;
    this.bx = 0;
    this.by = 0;
  }
  /** img を渡すと、その画像で描く（tint 済みの画像に差し替えるとき用） */
  draw(ctx, x, y, ref, stageMatrix, img) {
    const sp = this.sp;
    const sw = sp.rotated ? sp.height : sp.width,
      sh = sp.rotated ? sp.width : sp.height;
    // frameX / frameY は「トリミングされた分」の負のオフセット
    paintSparrow(ctx, sp, img || this.image, x - (sp.frameX || 0), y - (sp.frameY || 0), sw, sh);
  }
}

export class SpriteAtlas {
  /** kind: "sparrow" | "packer" */
  constructor(kind, image, sprites, label = "") {
    this.kind = kind;
    this.image = image;
    this.sprites = sprites;
    this.label = label;
    this._cache = new Map();
  }
  frameOf(sp) {
    let f = this._cache.get(sp);
    if (!f) this._cache.set(sp, (f = new SpriteFrame(sp, this.image)));
    return f;
  }
  /** ファイルの順のフレーム（Packer の frameIndices はこの番号） */
  all() {
    return this.sprites.map((s) => this.frameOf(s));
  }
  first() {
    return this.sprites[0] ? this.frameOf(this.sprites[0]) : null;
  }
  /** animations の雛形（新しい prop を作るとき用）。連番を除いた名前ごとに1つ。Packer は frameIndices（ファイル順の番号）を持つ */
  suggestAnimations() {
    const groups = new Map();
    this.sprites.forEach((sp, i) => {
      const pre = sp.name.replace(/\d+$/, "");
      if (!groups.has(pre)) groups.set(pre, []);
      groups.get(pre).push(i);
    });
    return [...groups].map(([pre, ix]) => ({
      name: pre.replace(/[\s_]+$/, "") || "anim",
      ...(this.kind === "packer" ? { frameIndices: ix } : { prefix: pre }),
      frameRate: 24,
      looped: true,
      offsets: [0, 0],
    }));
  }
  /**
   * アニメが再生するフレーム列。
   *   通常                : prefix で始まるスプライト（連番順）→ frameIndices で絞る
   *   indexOnly（packer の prop）: frameIndices をファイル順の番号としてそのまま使う（Stage.hx: animation.add(name, frameIndices)）
   */
  frames(anim, { indexOnly = false } = {}) {
    if (indexOnly) {
      const all = this.all(),
        ix = Array.isArray(anim?.frameIndices) && anim.frameIndices.length ? anim.frameIndices : null;
      return ix ? ix.map((i) => all[Number(i)]).filter(Boolean) : all;
    }
    return sparrowSequenceOf(this.sprites, anim || {}).map((s) => this.frameOf(s));
  }
}

// ============================================================
// 2. AnimateAtlas（タイムラインを描く形式）
// ============================================================
const IDENT = [1, 0, 0, 1, 0, 0];
/** 2×3 行列の積 m × n（canvas の transform(a,b,c,d,e,f) と同じ並び。n を先に適用する） */
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
/** 回転して格納された spritemap の四角を戻す行列（translate(0, w) → rotate(-90°)） */
const ROT = (w) => [0, -1, 1, 0, 0, w];

function timelineLength(layers) {
  return Math.max(0, ...layers.flatMap((l) => (l.FR || []).map((f) => (Number(f.I) || 0) + Math.max(1, Number(f.DU) || 1))));
}
function legacyDuration(timeline) {
  return Math.max(1, ...(timeline?.LAYERS || []).flatMap((l) => (l.Frames || []).map((f) => (Number(f.index) || 0) + Math.max(1, Number(f.duration) || 1))));
}

class AnimateFrame {
  /** spec: モダン { symbol: "__MAIN__" | シンボル名, atlasFrame } / レガシー { legacyName, atlasFrame } */
  constructor(atlas, spec) {
    this.atlas = atlas;
    this.spec = spec;
  }
  /** 枠（描画した全スプライトを囲む四角）。初回だけ計算してキャッシュする */
  get box() {
    if (!this._box) {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      this.atlas.traverse(this.spec, (sp, m) => {
        for (const [px, py] of [[0, 0], [sp.w, 0], [0, sp.h], [sp.w, sp.h]]) {
          const x = m[0] * px + m[2] * py + m[4],
            y = m[1] * px + m[3] * py + m[5];
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
      });
      this._box = Number.isFinite(x0) ? { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) } : { x: 0, y: 0, w: 1, h: 1 };
    }
    return this._box;
  }
  get w() {
    return this.box.w;
  }
  get h() {
    return this.box.h;
  }
  get bx() {
    return this.box.x;
  }
  get by() {
    return this.box.y;
  }
  draw(ctx, x, y, ref, stageMatrix) {
    // 既定: このフレーム自身の枠の左上を (x, y) に置く。stageMatrix: ステージ原点を基準枠に対して固定する
    const origin = stageMatrix && ref ? [x - ref.bx, y - ref.by] : [x - this.bx, y - this.by];
    this.atlas.traverse(this.spec, (sp, m) => {
      ctx.save();
      ctx.transform(1, 0, 0, 1, origin[0], origin[1]);
      ctx.transform(...m);
      ctx.drawImage(sp.image, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
      ctx.restore();
    });
  }
}

export class AnimateAtlas {
  /** animation: Animation.json / parts: [{ json: spritemap の JSON, image }]（spritemap が複数でもよい） */
  constructor(animation, parts, label = "") {
    this.kind = "animate";
    this.animation = animation;
    this.label = label;
    this.legacy = !!animation?.ANIMATION;
    this._frames = new Map(); // フレームの枠は計算が重いので、同じフレームは作り回す
    this.sprites = new Map(); // spritemap のスプライト名 → { x, y, w, h, rotated, image }
    for (const { json, image } of parts) {
      for (const item of json?.ATLAS?.SPRITES || []) {
        const s = item.SPRITE || item;
        this.sprites.set(String(s.name), { x: s.x, y: s.y, w: s.w, h: s.h, rotated: !!s.rotated, image });
      }
    }
    if (!this.sprites.size) throw Error("spritemap のスプライトが見つかりません（spritemap1.json などが必要です）");
    if (!this.legacy && !animation?.AN) throw Error("Animation.json の形式が分かりません（AN / ANIMATION がありません）");
  }

  // ---- タイムラインの走査（描かずに、スプライトと行列を emit に渡す） ----
  traverse(spec, emit) {
    if (this.legacy) {
      const root = this.animation.ANIMATION,
        sym = (this.animation.SYMBOL_DICTIONARY?.Symbols || []).find((s) => s.SYMBOL_name === spec.legacyName);
      const tl = root?.SYMBOL_name === spec.legacyName ? root.TIMELINE : sym?.TIMELINE;
      if (tl) this._legacy(tl, spec.atlasFrame, IDENT, 0, emit);
    } else this._modern(spec.symbol, spec.atlasFrame, IDENT, 0, emit);
  }
  _put(sp, m, emit) {
    if (sp) emit(sp, sp.rotated ? mul(m, ROT(sp.w)) : m);
  }
  _symbol(name) {
    return (this.animation.SD?.S || []).find((x) => x.SN === name);
  }
  _modern(name, fr, m, depth, emit) {
    if (depth > 20) return;
    const sym = name === "__MAIN__" ? null : this._symbol(name);
    if (name !== "__MAIN__" && !sym) return;
    const layers = (sym ? sym.TL?.L : this.animation.AN?.TL?.L) || [];
    for (let li = layers.length - 1; li >= 0; li--) {
      let f = null;
      for (const k of layers[li].FR || []) {
        const i = Number(k.I) || 0;
        if (i <= fr && fr < i + Math.max(1, Number(k.DU) || 1) && (!f || i > Number(f.I))) f = k;
      }
      if (!f) continue;
      for (const e of f.E || []) {
        const o = e.SI || e.ASI;
        if (!o) continue;
        const local = o.MX || (o.M3D?.length === 16 ? [o.M3D[0], o.M3D[1], o.M3D[4], o.M3D[5], o.M3D[12], o.M3D[13]] : null) || IDENT;
        const M = mul(m, local);
        if (e.ASI) this._put(this.sprites.get(String(o.N)), M, emit);
        else {
          const child = this._symbol(o.SN);
          if (!child) continue;
          const len = Math.max(1, timelineLength(child.TL?.L || []));
          const first = Math.max(0, Number(o.FF) || 0),
            elapsed = Math.max(0, fr - (Number(f.I) || 0));
          const mode = String(o.LP || "LP").toUpperCase();
          const cf = mode.includes("SF") || mode.includes("SINGLEFRAME") ? first : mode.includes("PO") || mode.includes("PLAYONCE") ? Math.min(first + elapsed, len - 1) : (first + elapsed) % len;
          this._modern(o.SN, cf, M, depth + 1, emit);
        }
      }
    }
  }
  _legacy(tl, t, m, depth, emit) {
    if (depth > 25) return;
    const layers = tl?.LAYERS || [];
    const mat = (x) => (x ? [Number(x.m00) || 0, Number(x.m01) || 0, Number(x.m10) || 0, Number(x.m11) || 0, Number(x.m30) || 0, Number(x.m31) || 0] : IDENT);
    for (let li = layers.length - 1; li >= 0; li--) {
      const f = (layers[li].Frames || []).find((k) => t >= Number(k.index) && t < Number(k.index) + Math.max(1, Number(k.duration) || 1));
      if (!f) continue;
      for (const item of f.elements || []) {
        if (item.ATLAS_SPRITE_instance) {
          const si = item.ATLAS_SPRITE_instance;
          this._put(this.sprites.get(String(si.name)), mul(m, mat(si.Matrix3D)), emit);
        } else if (item.SYMBOL_Instance) {
          const si = item.SYMBOL_Instance;
          const child = (this.animation.SYMBOL_DICTIONARY?.Symbols || []).find((s) => s.SYMBOL_name === si.SYMBOL_name);
          if (!child) continue;
          const len = legacyDuration(child.TIMELINE),
            first = Math.max(0, Number(si.firstFrame) || 0),
            elapsed = Math.max(0, t - (Number(f.index) || 0));
          const mode = String(si.loop || "loop").toLowerCase();
          const cf = mode === "singleframe" ? first : mode === "playonce" ? Math.min(first + elapsed, len - 1) : (first + elapsed) % len;
          this._legacy(child.TIMELINE, cf, mul(m, mat(si.Matrix3D)), depth + 1, emit);
        }
      }
    }
  }

  // ---- フレーム列 ----
  /** メインタイムラインの先頭フレーム（アニメを再生する前の姿。V-Slice の updateHitbox の基準） */
  first() {
    return this.legacy ? this._mk({ legacyName: this.animation.ANIMATION.SYMBOL_name, atlasFrame: 0 }) : this._mk({ symbol: "__MAIN__", atlasFrame: 0 });
  }
  _mk(spec) {
    const key = `${spec.symbol ?? spec.legacyName}|${spec.atlasFrame}`;
    let f = this._frames.get(key);
    if (!f) this._frames.set(key, (f = new AnimateFrame(this, spec)));
    return f;
  }
  /** animations の雛形（新しい prop を作るとき用）。モダンはフレームラベルごと、レガシーはシンボルごとに1つ */
  suggestAnimations() {
    const base = { frameRate: 24, looped: true, offsets: [0, 0] };
    let names = [];
    if (this.legacy) {
      const root = this.animation.ANIMATION;
      names = [root.SYMBOL_name, ...(this.animation.SYMBOL_DICTIONARY?.Symbols || []).map((s) => s.SYMBOL_name)].filter(Boolean);
    } else {
      for (const l of this.animation.AN?.TL?.L || []) for (const f of l.FR || []) if (f.N && !names.includes(f.N)) names.push(f.N);
    }
    if (!names.length) return [{ name: "idle", prefix: "idle", ...base }];
    return names.map((n) => ({ name: n, prefix: n, ...(this.legacy ? {} : { animType: "frameLabel" }), ...base }));
  }
  /**
   * アニメが再生するフレーム列（Character Editor の candidates / sequence と同じ規則）。
   *   レガシー        : prefix と同名のシンボル全体
   *   モダン          : animType が "symbol" ならそのシンボル全体 / それ以外はフレームラベルの区間（次のラベルの手前まで）
   *   frameIndices    : 全体の中の番号で絞り込む
   */
  frames(anim) {
    const a = anim || {};
    const pref = String(a.prefix ?? a.name ?? "");
    let all = [];
    if (this.legacy) {
      const root = this.animation.ANIMATION;
      const sym = (this.animation.SYMBOL_DICTIONARY?.Symbols || []).find((x) => x.SYMBOL_name === pref);
      const tl = root.SYMBOL_name === pref ? root.TIMELINE : sym?.TIMELINE;
      if (tl) all = Array.from({ length: legacyDuration(tl) }, (_, i) => this._mk({ legacyName: pref, atlasFrame: i }));
    } else {
      const isSymbol = String(a.animType || "").toLowerCase() === "symbol";
      const sym = this._symbol(pref);
      const layers = isSymbol ? sym?.TL?.L : this.animation.AN?.TL?.L;
      if (layers) {
        const total = timelineLength(layers);
        let start = 0,
          end = total,
          ok = true;
        if (!isSymbol) {
          const labels = [];
          for (const l of layers) for (const f of l.FR || []) if (f.N) labels.push({ name: f.N, start: Number(f.I) || 0 });
          labels.sort((x, y) => x.start - y.start);
          const match = labels.find((x) => x.name === pref);
          if (String(a.animType || "").toLowerCase() === "framelabel" && !match) ok = false;
          if (match) {
            start = match.start;
            end = Math.min(total, labels.find((x) => x.start > start)?.start ?? total);
          }
        }
        if (ok) all = Array.from({ length: Math.max(0, end - start) }, (_, i) => this._mk({ symbol: isSymbol ? pref : "__MAIN__", atlasFrame: start + i }));
      }
    }
    const ix = Array.isArray(a.frameIndices) && a.frameIndices.length ? a.frameIndices : null;
    return ix ? ix.map((i) => all[Number(i)]).filter(Boolean) : all;
  }
}

// ============================================================
// 3. ファイルから作る
// ============================================================
// ファイルの置き場所の手がかり:
//   フォルダごと選んだとき（PC）は webkitRelativePath に「フォルダ/…/ファイル名」が入る。
//   スマホなど、ファイルを直接選ぶと空（= フラット）。フラットなら、置き場所は「同じ」とみなす。
const relDir = (f) => (f.webkitRelativePath || "").split("/").slice(0, -1).join("/");
const norm = (p) => String(p || "").replace(/^[^:/\\]+:/, "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
const lastSeg = (p) => norm(p).split("/").pop();
/** 拡張子を除いた名前（小文字） */
const stem = (name) => String(name).replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "").toLowerCase();
export const isAnimationJsonName = (n) => /^animation\.json$/i.test(n);
export const isSpritemapJsonName = (n) => /^spritemap\d*\.json$/i.test(n);

async function readJson(file) {
  return JSON.parse((await file.text()).replace(/^﻿/, ""));
}

/**
 * 1フォルダ分のファイル（Animation.json + spritemap*.json + 同名 PNG）から AnimateAtlas を作る。
 * spritemap が複数あってもよい（スプライト名は全部まとめて引く）。
 */
export async function buildAnimateAtlas(files, label = "") {
  const list = [...files];
  const animFile = list.find((f) => isAnimationJsonName(f.name));
  if (!animFile) throw Error("Animation.json が見つかりません");
  const animation = await readJson(animFile);
  const parts = [];
  for (const f of list) {
    if (!/\.json$/i.test(f.name) || f === animFile) continue;
    let json;
    try {
      json = await readJson(f);
    } catch {
      continue; // metadata.json など、読めなくても支障のないものは無視
    }
    if (!json?.ATLAS?.SPRITES) continue;
    const png = list.find((g) => /\.png$/i.test(g.name) && stem(g.name) === stem(f.name) && relDir(g) === relDir(f));
    if (!png) throw Error(`${f.name} と同名の PNG（${stem(f.name)}.png）が見つかりません`);
    parts.push({ json, image: await loadImage(png) });
  }
  if (!parts.length) throw Error("spritemap（spritemap1.json と spritemap1.png など）が見つかりません");
  return new AnimateAtlas(animation, parts, label || animFile.webkitRelativePath || animFile.name);
}

/** ファイル群の中の「Animation.json を含むフォルダ」ごとの組。[{ dir, files }] */
export function animateGroups(files) {
  const list = [...files],
    dirs = [...new Set(list.filter((f) => isAnimationJsonName(f.name)).map(relDir))];
  return dirs.map((dir) => ({ dir, files: list.filter((f) => relDir(f) === dir) }));
}

/**
 * assetPath（フォルダ）に対応する AnimateAtlas を、選ばれたファイルから探して作る。
 *   1. フォルダ名が assetPath と合う組  2. 候補が1組だけならそれ
 * 見つからなければ Error（何をどう選べばよいか書く）
 */
export async function findAnimateAtlas(files, assetPath) {
  const groups = animateGroups(files);
  if (!groups.length) throw Error(`AnimateAtlas「${assetPath}」の Animation.json が選択されていません（spritemap1.json / spritemap1.png も一緒に）`);
  const want = norm(assetPath);
  const hit = groups.find((g) => norm(g.dir) === want || (g.dir && (norm(g.dir).endsWith("/" + want) || want.endsWith("/" + norm(g.dir)) || lastSeg(g.dir) === lastSeg(want))));
  const pick = hit || (groups.length === 1 ? groups[0] : null);
  if (!pick) throw Error(`AnimateAtlas が ${groups.length} セットあり、「${assetPath}」がどれか分かりません。フォルダごと選ぶか、1セットずつ選んでください`);
  return buildAnimateAtlas(pick.files, assetPath);
}

/**
 * assetPath に対応する Sparrow / Packer アトラスを、選ばれたファイルから探して作る。
 * ファイル名（拡張子なし）が assetPath の末尾と合う PNG + (XML | TXT)。合うものが無くて PNG と定義が1つずつなら、それを使う。
 */
export async function findSpriteAtlas(files, assetPath, kind) {
  const list = [...files];
  const pngs = list.filter((f) => /\.(png|webp|jpe?g)$/i.test(f.name) && !isSpritemapPng(f, list));
  const defs = list.filter((f) => (kind === "packer" ? /\.txt$/i.test(f.name) : /\.xml$/i.test(f.name)));
  const key = lastSeg(assetPath);
  const png = pngs.find((f) => stem(f.name) === key) || (pngs.length === 1 && defs.length === 1 ? pngs[0] : null);
  const def = defs.find((f) => stem(f.name) === key) || (defs.length === 1 && png ? defs[0] : null);
  const ext = kind === "packer" ? "TXT" : "XML";
  if (!png) throw Error(`「${assetPath}」の画像（${key}.png）が選択されていません`);
  if (!def) throw Error(`「${assetPath}」の ${ext}（${key}.${ext.toLowerCase()}）が選択されていません`);
  const text = await def.text();
  const sprites = kind === "packer" ? parsePackerText(text) : parseSparrowXml(text);
  return new SpriteAtlas(kind, await loadImage(png), sprites, `${png.name} + ${def.name}`);
}
/** spritemapN.png（AnimateAtlas の部品）か。同じ場所に Animation.json があれば、そちらの部品として扱う */
export function isSpritemapPng(f, list) {
  return /^spritemap\d*\.png$/i.test(f.name) && list.some((g) => isAnimationJsonName(g.name) && relDir(g) === relDir(f));
}
