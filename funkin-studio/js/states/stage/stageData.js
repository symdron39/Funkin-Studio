/* ============================================================
   stage/stageData.js — V-Slice の「ステージ JSON」（StageData.hx）を扱う純粋な関数群
   ------------------------------------------------------------
   DOM にも canvas にも触らない（= テストしやすい）データ層。Haxe でいう StageData / StageDataProp の typedef と、
   それを読み書きする StageRegistry 周りに相当する。

   ステージ JSON の形（v1.0.2。ソース: source/funkin/data/stage/StageData.hx）:
     {
       "version": "1.0.2", "name": "Main Stage", "cameraZoom": 0.9, "directory": "shared",
       "characters": { "bf": {position:[x,y], zIndex, scale, cameraOffsets:[x,y], scroll, alpha, angle}, "dad": {…}, "gf": {…} },
       "props": [ { name, assetPath, position:[x,y], zIndex, scale(数値 or [w,h]), scroll:[x,y], alpha, angle,
                    flipX, flipY, isPixel, color, blend, animations, danceEvery, … } ]
     }
   assetPath が "#" で始まる prop は画像ではなく「単色の矩形」（scale が幅・高さ(px)になる）。

   方針: 知らないキー（animations など）は消さずにそのまま持ち回す → 読み込んで保存しても情報が欠けない。
   エディタ専用の一時情報は `_ed`（隠す・ロック）に入れ、保存時に取り除く。
   ============================================================ */
export const STAGE_VERSION = "1.0.2";
export const CHAR_IDS = ["bf", "dad", "gf"];
export const CHAR_LABEL = { bf: "BF", dad: "DAD", gf: "GF" };

/** 深いコピー（JSON で往復する。関数や undefined を含まないデータ専用） */
export const clone = (o) => JSON.parse(JSON.stringify(o));
/** 小数の誤差（0.30000000000000004 など）を保存前に丸める */
export const round3 = (n) => Math.round(n * 1000) / 1000;
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);
const pair = (v, d0, d1) => [num(Array.isArray(v) ? v[0] : undefined, d0), num(Array.isArray(v) ? v[1] : undefined, d1)];

/** StageData.makeDefaultCharacters() と同じ初期値 */
export function defaultCharacter(id) {
  return {
    zIndex: 0,
    scale: 1,
    position: [0, 0],
    cameraOffsets: id === "bf" ? [-100, -100] : id === "dad" ? [100, -100] : [0, 0],
  };
}

export function defaultStage() {
  return {
    version: STAGE_VERSION,
    name: "New Stage",
    cameraZoom: 1,
    directory: "shared",
    characters: { bf: defaultCharacter("bf"), dad: defaultCharacter("dad"), gf: defaultCharacter("gf") },
    props: [],
  };
}

/**
 * 読み込んだ JSON を、エディタが前提にできる形に整える。足りない欄は V-Slice の既定値で補う。
 * 値が壊れていても例外にせず既定値にする（ただし JSON そのものが違う形なら Error）。
 */
export function normalizeStage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("ステージJSONではありません（オブジェクトが必要です）");
  if (raw.props !== undefined && !Array.isArray(raw.props)) throw Error("props が配列ではありません");
  const doc = clone(raw);
  doc.version = typeof doc.version === "string" ? doc.version : STAGE_VERSION;
  doc.name = typeof doc.name === "string" ? doc.name : "Unknown";
  doc.cameraZoom = num(doc.cameraZoom, 1);
  doc.directory = typeof doc.directory === "string" ? doc.directory : "shared";
  doc.characters = doc.characters && typeof doc.characters === "object" ? doc.characters : {};
  for (const id of CHAR_IDS) {
    const c = (doc.characters[id] = { ...defaultCharacter(id), ...(doc.characters[id] || {}) });
    c.position = pair(c.position, 0, 0);
    c.cameraOffsets = pair(c.cameraOffsets, defaultCharacter(id).cameraOffsets[0], defaultCharacter(id).cameraOffsets[1]);
    c.zIndex = Math.trunc(num(c.zIndex, 0));
    c.scale = num(c.scale, 1);
  }
  doc.props = (doc.props || []).filter((p) => p && typeof p === "object").map(normalizeProp);
  return doc;
}

export function normalizeProp(p) {
  p.assetPath = typeof p.assetPath === "string" ? p.assetPath : "";
  p.position = pair(p.position, 0, 0);
  p.zIndex = Math.trunc(num(p.zIndex, 0));
  if (Array.isArray(p.scale)) p.scale = pair(p.scale, 1, 1);
  else p.scale = num(p.scale, 1);
  return p;
}

/** 新しい prop（保存時に余計なキーが増えないよう、V-Slice の標準ステージが使う最小限のキーだけ） */
export function newProp(assetPath, x = 0, y = 0, zIndex = 0) {
  return { name: baseName(assetPath), assetPath, scale: 1, position: [round3(x), round3(y)], scroll: [1, 1], zIndex };
}
/** 単色の矩形 prop（assetPath = "#RRGGBB"、scale = [幅, 高さ]） */
export function newRect(x, y, w = 200, h = 200, color = "#FF0000", zIndex = 0) {
  return { name: "rect", assetPath: color, scale: [w, h], position: [round3(x), round3(y)], scroll: [1, 1], zIndex };
}

// ---------- prop の読み書き補助 ----------
export const isSolid = (p) => typeof p.assetPath === "string" && p.assetPath.startsWith("#");
export const isAnimated = (p) => Array.isArray(p.animations) && p.animations.length > 0;
/** scale は「数値」か「[w, h]」。どちらでも [sx, sy] で読む */
export const getScale = (p) => (Array.isArray(p.scale) ? [num(p.scale[0], 1), num(p.scale[1], 1)] : [num(p.scale, 1), num(p.scale, 1)]);
/** sx == sy なら数値、違えば配列で書く（V-Slice の JSON は両方受け付ける）。単色は常に [w, h] */
export function setScale(p, sx, sy) {
  p.scale = isSolid(p) || sx !== sy ? [round3(sx), round3(sy)] : round3(sx);
}
export const getScroll = (p) => pair(p.scroll, 1, 1);

/** "folder/name.png" → "name"（拡張子とフォルダを除く） */
export function baseName(path) {
  return String(path || "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.[a-z0-9]+$/i, "");
}

// ---------- 色（FlxColor.fromString 相当の簡易版） ----------
const NAMED = {
  white: "#FFFFFF", black: "#000000", red: "#FF0000", green: "#008000", blue: "#0000FF", yellow: "#FFFF00",
  cyan: "#00FFFF", magenta: "#FF00FF", gray: "#808080", grey: "#808080", orange: "#FFA500", pink: "#FFC0CB",
  purple: "#800080", brown: "#A52A2A", lime: "#00FF00",
};
/** "#RGB" "#RRGGBB" "#AARRGGBB" "0xAARRGGBB" 色名 → {r,g,b,a(0..1)}。読めなければ null */
export function parseColor(str) {
  let s = String(str ?? "").trim();
  if (NAMED[s.toLowerCase()]) s = NAMED[s.toLowerCase()];
  s = s.replace(/^#/, "").replace(/^0x/i, "");
  if (!/^[0-9a-f]+$/i.test(s)) return null;
  if (s.length === 3) s = s.replace(/./g, (c) => c + c);
  if (s.length === 6) s = "FF" + s;
  if (s.length !== 8) return null;
  const v = (i) => parseInt(s.slice(i, i + 2), 16);
  return { a: v(0) / 255, r: v(2), g: v(4), b: v(6) };
}
export const toRgbaCss = (c) => `rgba(${c.r},${c.g},${c.b},${c.a})`;
/** <input type=color> 用に "#rrggbb" へ（読めなければ白） */
export function toHex6(str) {
  const c = parseColor(str);
  if (!c) return "#ffffff";
  const h = (n) => n.toString(16).padStart(2, "0");
  return "#" + h(c.r) + h(c.g) + h(c.b);
}
/** V-Slice の BlendMode 名 → canvas の globalCompositeOperation */
export function blendToCanvas(name) {
  switch (String(name || "").toLowerCase()) {
    case "add": return "lighter";
    case "multiply": return "multiply";
    case "screen": return "screen";
    case "overlay": return "overlay";
    case "darken": return "darken";
    case "lighten": return "lighten";
    case "difference": return "difference";
    case "hardlight": return "hard-light";
    default: return "source-over"; // alpha / layer / invert / subtract など canvas に無いものは通常合成
  }
}

/** 保存用の文字列にする。`_ed`（エディタ専用）を除き、数値を丸め、version を最新にする */
export function serializeStage(doc, compact = true) {
  const out = clone(doc);
  out.version = STAGE_VERSION;
  const strip = (o) => {
    delete o._ed;
    return o;
  };
  out.props.forEach(strip);
  const round = (a) => (Array.isArray(a) ? a.map(round3) : a);
  for (const p of out.props) {
    p.position = round(p.position);
    if (p.scale !== undefined) p.scale = Array.isArray(p.scale) ? p.scale.map(round3) : round3(p.scale);
    if (p.scroll) p.scroll = round(p.scroll);
  }
  for (const id of CHAR_IDS) {
    const c = out.characters[id];
    c.position = round(c.position);
    c.cameraOffsets = round(c.cameraOffsets);
    c.scale = round3(c.scale);
    if (c.scroll) c.scroll = round(c.scroll);
  }
  // 読みやすい順に並べ替える（キーの順序は意味を持たない）
  const ordered = {
    version: out.version,
    name: out.name,
    cameraZoom: out.cameraZoom,
    directory: out.directory,
    ...out,
  };
  return JSON.stringify(ordered, null, compact ? undefined : 2);
}
