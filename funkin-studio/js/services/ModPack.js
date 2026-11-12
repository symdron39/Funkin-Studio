/* ============================================================
   services/ModPack.js — mod パック（フォルダ / zip）のファイルを「パス付き」で扱う共通部品
   ------------------------------------------------------------
   なぜ必要か:
     以前は assetPath を「ファイル名だけ」や「末尾のフォルダ名だけ」で探していたため、
     別のフォルダに同じ名前のファイルがあると、先に見つかった方（= 間違った方）を拾うことがあった。
     ここでは、ファイルの置き場所を FNF の構造（images/ data/ scripts/ …）に合わせて正規化し、
     assetPath に「どれだけ正確に合うか」を点数で比べて選ぶ。同点（どちらか決められない）のときは、
     黙って選ばずに注意を出す。
   ・rootedOf(): "Mod/images/characters/bf.png" → "images/characters/bf"（最初の images/data/… から後ろ。拡張子なし・小文字）
   ・originOf(): "Mod/images/…" → "mod"（どの mod / フォルダに属するか。同じ origin のファイルを優先する）
   ・LazyZipFile: zip の中の 1 ファイル。File と同じ使い方ができ、中身は読まれたときだけ取り出す
   ============================================================ */
import { openZipLazy } from "../states/chart/zip.js";

/** FNF の mod / assets 直下に来るフォルダ名。この名前が最初に出てきた所を「ルート」とみなす */
const ANCHORS = new Set(["images", "data", "scripts", "sounds", "music", "songs", "shaders", "fonts", "videos", "preload", "shared"]);

const splitPath = (p) => String(p || "").replace(/\\/g, "/").split("/").filter(Boolean);
export const relPathOf = (f) => f.webkitRelativePath || f.name;

function makeInfo(path, stripExt) {
  const segs = splitPath(path).map((s) => s.toLowerCase());
  if (stripExt && segs.length) segs[segs.length - 1] = segs[segs.length - 1].replace(/\.[^./]+$/, "");
  // 最初に出てくる images / data / … から後ろを「ルート以降のパス」、手前を origin（mod フォルダ名）とする
  const isA = (i) => (stripExt ? i < segs.length - 1 : i < segs.length) && ANCHORS.has(segs[i]);
  let first = segs.findIndex((_, i) => isA(i));
  if (first < 0) first = 0;
  // assets/shared/images/… や assets/preload/images/… の shared / preload は「ラッパー」なので飛ばし、images/ を本当のルートにする
  let root = first;
  while ((segs[root] === "shared" || segs[root] === "preload") && isA(root + 1)) root++;
  return { segs, root, noExt: segs.slice(root).join("/"), origin: segs.slice(0, first).join("/"), flat: segs.length <= 1 };
}
const _cache = new WeakMap();
/** { segs: 小文字の各フォルダ名, root: ルートの位置, noExt: 拡張子なしのルート以降, origin } */
export function infoOf(f) {
  let v = _cache.get(f);
  if (!v) _cache.set(f, (v = makeInfo(relPathOf(f), true)));
  return v;
}
/** ファイルパス（文字列）版: { noExt, origin, flat, segs } */
export const infoOfPath = (path) => makeInfo(path, true);
/** フォルダのパス版（AnimateAtlas のフォルダ用） */
export const infoOfDir = (dir) => makeInfo(dir, false);
export const rootedOf = (f) => infoOf(f).noExt;
export const originOf = (f) => infoOf(f).origin;

/** assetPath を比べやすい形にする: "weeb:Characters/BF.png" → "characters/bf" */
export function normAsset(p) {
  return String(p || "")
    .replace(/^[^:/\\]+:/, "")
    .replace(/\\/g, "/")
    .replace(/\/\*+$/, "") // "stages/*" のような末尾のワイルドカードはフォルダ指定として扱う
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase();
}

/**
 * ファイル(path = ルート以降のパス)が assetPath にどれだけ合うか。0 = 合わない。
 *   100 : images/<assetPath> と完全一致（または assetPath が data/… で始まっていて一致）
 *    60+: 末尾が assetPath と一致（フォルダ階層が違うだけ。一致した階層数ぶん加点）
 *    20 : assetPath が 1 階層だけで、ファイル名が一致（弱い）
 *    10 : 置き場所の情報が無いファイル（スマホで直接選んだ等）の名前が一致
 */
export function scorePath(info, assetPath, dirPrefix = "images") {
  const want = normAsset(assetPath);
  if (!want) return 0;
  const ws = want.split("/");
  const full = info.segs;
  if (info.noExt === `${dirPrefix}/${want}` || info.noExt === want) return 100;
  // 末尾の一致
  let n = 0;
  while (n < ws.length && n < full.length && full[full.length - 1 - n] === ws[ws.length - 1 - n]) n++;
  if (n === ws.length && ws.length >= 2) return 60 + n;
  if (n === ws.length && ws.length === 1) return info.flat ? 10 : 20;
  return 0;
}

/**
 * pool から assetPath に合うファイルを順位づけして返す（高い順）。
 * @param opts { origin: 参照元の origin（同じ mod を優先）, dirPrefix, files: 点数計算に使う拡張子の正規表現は extRe }
 */
export function rankFiles(pool, assetPath, extRe, opts = {}) {
  const out = [];
  for (const f of pool) {
    if (!extRe.test(f.name)) continue;
    const info = infoOf(f);
    let s = scorePath(info, assetPath, opts.dirPrefix ?? "images");
    if (!s) continue;
    if (opts.origin !== undefined && info.origin === opts.origin) s += 25;
    out.push({ f, score: s, info });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** 同点 1 位が複数あるか（= どれか決められない） */
export function topTies(ranked) {
  if (!ranked.length) return [];
  const top = ranked[0].score;
  const ties = ranked.filter((r) => r.score === top);
  const key = (r) => r.info.origin + "|" + r.info.noExt;
  return new Set(ties.map(key)).size > 1 ? ties : ties.slice(0, 1); // 別の場所のものが同点で並んだときだけ「決められない」
}

// ---------------------------------------------------------------- 注意の通知
const notes = new Set();
let sink = null;
/** 取り違えそうなときの注意文の受け取り先（Stage Editor が say に繋ぐ） */
export function setAssetNoteSink(fn) {
  sink = fn;
}
export function assetNote(msg) {
  if (notes.has(msg)) return;
  notes.add(msg);
  sink?.(msg);
}
export const clearAssetNotes = () => notes.clear();

// ---------------------------------------------------------------- zip の 1 ファイル（File と同じ使い方）
export class LazyZipFile {
  constructor(entry, zipName) {
    this._e = entry;
    this.name = entry.name.split("/").pop();
    this.webkitRelativePath = entry.name; // zip 内のパス（mod フォルダの入れ子もそのまま）
    this.size = entry.size;
    this.lastModified = 0;
    this.zip = zipName;
    this.lazy = true;
  }
  async arrayBuffer() {
    const u8 = await this._e.read();
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }
  async blob() {
    const u8 = await this._e.read();
    const ext = (this.name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
    const type = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[ext] || "";
    return new Blob([u8], { type });
  }
  async text() {
    return new TextDecoder().decode(await this._e.read());
  }
  slice(...a) {
    return this.blob().then((b) => b.slice(...a));
  }
}

/** zip（File）→ LazyZipFile[]。中身は読まない（名前と位置だけ） */
export async function openModZip(file) {
  const entries = await openZipLazy(file);
  return entries.filter((e) => !/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(e.name)).map((e) => new LazyZipFile(e, file.name));
}

// ---------------------------------------------------------------- mod の中身の一覧
/** data/stages/*.json などを一覧にする。{ id, file, origin } */
export function listData(pool, dir) {
  const out = [];
  for (const f of pool) {
    if (!/\.json$/i.test(f.name)) continue;
    const info = infoOf(f);
    const m = info.noExt.match(new RegExp(`^data/${dir}/(.+)$`));
    if (m) out.push({ id: m[1], file: f, origin: info.origin });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
/** mod のざっくりした要約 */
export function summarize(pool) {
  const c = { images: 0, scripts: 0, data: 0, other: 0 };
  for (const f of pool) {
    const r = infoOf(f).noExt.split("/")[0];
    if (r === "images") c.images++;
    else if (r === "scripts") c.scripts++;
    else if (r === "data") c.data++;
    else c.other++;
  }
  return {
    ...c,
    stages: listData(pool, "stages"),
    characters: listData(pool, "characters"),
    noteStyles: listData(pool, "notestyles"),
    origins: [...new Set(pool.map(originOf))].filter(Boolean),
  };
}

// ---------------------------------------------------------------- 種類別の解決（image / sound / music / song / icon / character / stage …）
/** 種類ごとの「ルートのフォルダ」と拡張子。assetPath はその直下からの相対（V-Slice と同じ指定）で渡す */
const AUDIO = /\.(ogg|mp3|wav|flac)$/i;
const KINDS = {
  image: { dir: "images", ext: /\.png$/i },
  xml: { dir: "images", ext: /\.(xml|txt)$/i },
  icon: { dir: "images", ext: /\.png$/i }, // 例: "icons/icon-bf" / "freeplay/icons/bfpixel"
  sound: { dir: "sounds", ext: AUDIO },
  music: { dir: "music", ext: AUDIO },
  song: { dir: "songs", ext: AUDIO }, // 例: "bopeebo/Inst" / "bopeebo/Voices-bf"
  character: { dir: "data/characters", ext: /\.json$/i },
  stage: { dir: "data/stages", ext: /\.json$/i },
  notestyle: { dir: "data/notestyles", ext: /\.json$/i },
  script: { dir: "scripts", ext: /\.hx[cs]?$/i },
};
/**
 * pool から、V-Slice と同じ指定（assetPath）でファイルを 1 つ選ぶ。
 * shared/ や preload/ の中でも、mod ルート直下でも同じように見つかる。
 * @returns {{file, ambiguous: Array}|null} ambiguous = 同点で決められなかった候補（あれば注意を出す）
 */
export function resolveAsset(pool, kind, assetPath, opts = {}) {
  const k = KINDS[kind];
  if (!k) throw new Error(`未対応の種類: ${kind}`);
  const dirPrefix = k.dir;
  const ranked = rankFiles(pool, assetPath, k.ext, { dirPrefix, origin: opts.origin });
  if (!ranked.length) return null;
  const ties = topTies(ranked);
  if (ties.length > 1 && !opts.quiet) assetNote(`${kind}「${assetPath}」に合うファイルが複数あります: ${ties.map((t) => t.info.origin + "/" + t.info.noExt).join(" , ")}（先頭を使います）`);
  return { file: ranked[0].f, ambiguous: ties.length > 1 ? ties.map((t) => t.f) : [] };
}
