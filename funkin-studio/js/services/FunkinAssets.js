/* ============================================================
   services/FunkinAssets.js — 本体アセット（FunkinCrew/Funkin.assets）を GitHub から取得する
   ------------------------------------------------------------
   読み込んだ mod に無いキャラ / ステージ / ノートスタイル（と、それが使う画像・スクリプト・シェーダー）を、
   必要になったときだけ raw.githubusercontent.com から取ってくる。ページには本体の画像を入れない（一覧のパスだけ入っている）。
   ・毎回取得: 取得したものは保存しない（fetch は cache:"no-store"）。プレイテストを始めるたび・ブランチを変えるたびに
     reset() で前回取得分を捨て、Workspace に足したファイルも外して作り直す
   ・ブランチ: main（0.8 系の配置）/ preview/public-playtest（0.9 の配置）を切り替えられる（getBranch / setBranch）
   ・RemoteFile … LazyZipFile と同じ使い方（name / webkitRelativePath / blob() / text() / arrayBuffer()）。中身は読まれたときに取得
   ・ensureCharacter / ensureStage / ensureAtlas … ws（Workspace）に、必要なファイルだけ「funkin.assets」の origin で足す
   ・stageScripts(id) … 本体のステージスクリプト（.hxc）と、それが使う props / シェーダークラス / .frag のテキスト
   ・noteStyle(id) … ノートスタイルの JSON と画像を返す（runtime/noteStyle.js の NoteStyleSet が使う）
   ・mod 側に同じものがあれば、そちらが先。ここは「mod に無かったとき」だけ
   ・素材は Friday Night Funkin' のもの（© The Funkin' Crew Inc.）。エディタのプレビュー用で、書き出す mod の zip には含めない
   ・テスト・別のミラー用: globalThis.__FUNKIN_ASSETS = { raw: "http://…/", tree: "http://…/" }（末尾はブランチ名を足せる形）
   ============================================================ */
import { FUNKIN_ASSETS_PATHS } from "./funkinAssetsIndex.js";
import { infoOfPath, normAsset, detectLayout } from "./ModPack.js";

export const ORIGIN = "funkin.assets";
const KEY_ON = "studio.remoteAssets";
const KEY_BRANCH = "studio.remoteAssets.branch";

/** 取得できるブランチ。layout: 0.8 = data/<dir>/<id>.json + shared/preload の images / 0.9 = gameplay/<dir>/<id>/<id>.json、assetPath はリポジトリのパス */
export const BRANCHES = [
  { id: "main", label: "main（0.8 系）", layout: "0.8" },
  { id: "preview/public-playtest", label: "preview/public-playtest（0.9 プレビュー）", layout: "0.9" },
];
const conf = () => {
  const o = globalThis.__FUNKIN_ASSETS || {};
  return {
    raw: o.raw ?? "https://raw.githubusercontent.com/FunkinCrew/Funkin.assets/",
    tree: o.tree ?? "https://api.github.com/repos/FunkinCrew/Funkin.assets/git/trees/",
  };
};
export const isEnabled = () => {
  try {
    return localStorage.getItem(KEY_ON) !== "0";
  } catch {
    return true;
  }
};
export const setEnabled = (on) => {
  try {
    localStorage.setItem(KEY_ON, on ? "1" : "0");
  } catch {}
};
/** 設定値: "auto"（既定。読み込んだ mod の配置に合わせる）か、ブランチ名 */
export const getBranchMode = () => {
  try {
    const b = localStorage.getItem(KEY_BRANCH);
    if (b === "auto" || BRANCHES.some((x) => x.id === b)) return b;
  } catch {}
  return "auto";
};
let autoBranch = BRANCHES[0].id; // auto のときに使うブランチ（mod が 0.9 の配置なら 0.9 のブランチ）
/** いま実際に使うブランチ */
export const getBranch = () => {
  const m = getBranchMode();
  return m === "auto" ? autoBranch : m;
};
export const setBranch = (id) => {
  if (id !== "auto" && !BRANCHES.some((x) => x.id === id)) return;
  try {
    localStorage.setItem(KEY_BRANCH, id);
  } catch {}
};
/** auto のとき、読み込んだ mod の配置（"0.8" / "0.9"）から取得元のブランチを決める。mod が空なら 0.8（main）のまま */
export function syncLayout(ws) {
  const files = ws?.files?.filter?.((f) => !f.remote) ?? [];
  const layout = files.length ? detectLayout(files) : "0.8";
  autoBranch = (BRANCHES.find((b) => b.layout === layout) ?? BRANCHES[0]).id;
  return getBranch();
}
const layoutOf = (branch = getBranch()) => BRANCHES.find((x) => x.id === branch)?.layout ?? "0.8";

// ---------------------------------------------------------------- 取得したファイル（保存しない。同じ回の中だけ使い回す）
const bytesCache = new Map(); // "branch|repoPath" → Promise<ArrayBuffer>
function fetchBytes(branch, repoPath) {
  const key = `${branch}|${repoPath}`;
  let p = bytesCache.get(key);
  if (!p) {
    const url = conf().raw + branch + "/" + repoPath.split("/").map(encodeURIComponent).join("/");
    p = fetch(url, { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error(`funkin.assets（${branch}）から取得できません（${r.status}）: ${repoPath}`);
      return r.arrayBuffer();
    });
    p.catch(() => bytesCache.delete(key)); // 失敗は覚えない
    bytesCache.set(key, p);
  }
  return p;
}
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", json: "application/json", xml: "application/xml" };

export class RemoteFile {
  constructor(repoPath, branch) {
    this.repoPath = repoPath;
    this.branch = branch;
    this.name = repoPath.split("/").pop();
    this.webkitRelativePath = `${ORIGIN}/${repoPath}`; // ModPack の規則で origin = "funkin.assets"（週フォルダ付きなら "funkin.assets/week6"）
    this.size = 0;
    this.lastModified = 0;
    this.lazy = true;
    this.remote = true;
  }
  /** 先に取りに行かせる（結果は読まれたときに使う）。失敗はここでは無視 */
  prefetch() {
    fetchBytes(this.branch, this.repoPath).catch(() => {});
  }
  arrayBuffer() {
    return fetchBytes(this.branch, this.repoPath).then((b) => b.slice(0));
  }
  async blob() {
    const ext = (this.name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
    return new Blob([await fetchBytes(this.branch, this.repoPath)], { type: MIME[ext] || "" });
  }
  async text() {
    return new TextDecoder().decode(await fetchBytes(this.branch, this.repoPath));
  }
  slice(...a) {
    return this.blob().then((b) => b.slice(...a));
  }
}

// ---------------------------------------------------------------- ファイル一覧（ブランチごと）
const indexes = new Map(); // branch → { files: Map<repoPath, RemoteFile>, byNoExt: Map<noExt, RemoteFile[]> }
function indexOf(branch = getBranch()) {
  let ix = indexes.get(branch);
  if (!ix) {
    ix = { files: new Map(), byNoExt: new Map() };
    indexes.set(branch, ix);
    for (const p of FUNKIN_ASSETS_PATHS[branch] ?? []) addPath(ix, branch, p); // 最初から同梱の一覧が使える（ネットが無くても、どの id があるかは分かる）
  }
  return ix;
}
function addPath(ix, branch, p) {
  if (ix.files.has(p)) return;
  const f = new RemoteFile(p, branch);
  ix.files.set(p, f);
  const k = infoOfPath(f.webkitRelativePath).noExt;
  (ix.byNoExt.get(k) ?? ix.byNoExt.set(k, []).get(k)).push(f);
}
const noExtOf = (ix) => ix.byNoExt;
const wantExt = /\.(json|png|jpg|xml|txt|hxc|frag|vert)$|(^|\/)sounds\/.*\.ogg$/i;
const skipDir = /^(\.github|exclude|sserafim)\//;

/** GitHub のツリー API で、いまのブランチの一覧を新しくする（保存はしない。失敗しても同梱の一覧のまま） */
export async function refreshIndex() {
  const branch = getBranch();
  try {
    const r = await fetch(conf().tree + encodeURIComponent(branch) + "?recursive=1", { cache: "no-store" });
    if (!r.ok) return 0;
    const j = await r.json();
    const ix = indexOf(branch);
    let n = 0;
    for (const e of j.tree || []) {
      if (e.type !== "blob" || !wantExt.test(e.path) || skipDir.test(e.path) || ix.files.has(e.path)) continue;
      addPath(ix, branch, e.path);
      n++;
    }
    return n;
  } catch {
    return 0; // オフラインなど: 同梱の一覧を使う
  }
}

/** 前回取得したものを全部捨てる（取得したバイト列・Workspace に足したファイル）。次の使用で取り直す。ws は省略できる */
export function reset(ws) {
  syncLayout(ws);
  bytesCache.clear();
  ws?.dropRemote?.();
}

// ---------------------------------------------------------------- 探す
const LIB_ORDER = ["shared", "preload"];
const libOf = (f) => f.repoPath.split("/")[0];
const libRank = (lib) => {
  const i = LIB_ORDER.indexOf(lib);
  return i >= 0 ? i : 10;
};
/** assetPath の "lib:" 部分（あれば） */
const libHint = (assetPath) => String(assetPath || "").match(/^([^:/\\]+):/)?.[1]?.toLowerCase() ?? "";
function pickLib(list, hint) {
  return [...list].sort((a, b) => (libOf(b).toLowerCase() === hint ? 1 : 0) - (libOf(a).toLowerCase() === hint ? 1 : 0) || libRank(libOf(a)) - libRank(libOf(b)) || a.repoPath.localeCompare(b.repoPath));
}

/** id がある種類（character / stage / notestyle）の JSON。0.8: data/<dir>/<id> / 0.9: gameplay/<dir>/<id>/<id>（どちらの配置でも探す） */
export function findData(kind, id) {
  return findData1(kind, id, getBranch()) ?? findData1(kind, id, otherBranch()); // 見つからなければ、もう一方のブランチも探す
}
const otherBranch = (b = getBranch()) => (BRANCHES.find((x) => x.id !== b) ?? BRANCHES[0]).id;
function findData1(kind, id, branch) {
  const dir = { character: "characters", stage: "stages", notestyle: "notestyles" }[kind];
  if (!dir || !id) return null;
  const n = normAsset(id);
  const ix = noExtOf(indexOf(branch));
  const keys = layoutOf(branch) === "0.9" ? [`gameplay/${dir}/${n}/${n}`, `data/${dir}/${n}`] : [`data/${dir}/${n}`, `gameplay/${dir}/${n}/${n}`];
  for (const k of keys) {
    const list = (ix.get(k) ?? []).filter((f) => /\.json$/i.test(f.name));
    if (list.length) return pickLib(list, "")[0];
  }
  return null;
}
export const has = (kind, id) => isEnabled() && !!findData(kind, id);

/** 本体の効果音（Paths.sound("train_passes") など）。sounds/<名前>.ogg を、shared → preload → 週フォルダの順で探す。無ければ null */
export function findSound(name) {
  if (!isEnabled() || !name) return null;
  const n = String(name).replace(/^[^:/\\]+:/, "").replace(/\.(ogg|mp3|wav)$/i, "").replace(/^sounds\//, "").toLowerCase();
  const hits = [...indexOf().files.values()].filter((f) => /\.ogg$/i.test(f.name) && f.repoPath.toLowerCase().replace(/\.ogg$/, "").endsWith(`sounds/${n}`));
  const exact = [...indexOf().files.values()].find((f) => /\.ogg$/i.test(f.name) && f.repoPath.toLowerCase().replace(/\.ogg$/, "") === n); // 0.9: リポジトリのパスそのまま
  return exact ?? pickLib(hits, "")[0] ?? null;
}

/** assetPath のアトラス一式。Sparrow / Packer = png + xml(txt)、AnimateAtlas = フォルダの中身全部、1 枚絵 = png だけ。0.8 は images/<path>、0.9 はリポジトリのパスそのまま */
export function findAtlas(assetPath) {
  const a = findAtlas1(assetPath, getBranch());
  return a.length ? a : findAtlas1(assetPath, otherBranch());
}
function findAtlas1(assetPath, branch) {
  const n = normAsset(assetPath);
  if (!n) return [];
  const hint = libHint(assetPath);
  const ix = noExtOf(indexOf(branch));
  for (const key of [`images/${n}`, n]) {
    const same = ix.get(key) ?? [];
    const png = pickLib(same.filter((f) => /\.(png|jpg)$/i.test(f.name)), hint)[0];
    if (png) {
      const lib = libOf(png);
      return same.filter((f) => libOf(f) === lib && /\.(png|jpg|xml|txt)$/i.test(f.name));
    }
    // AnimateAtlas: <key>/ の下
    const prefix = key + "/";
    const dirs = new Map(); // lib → files
    for (const [k, list] of ix) {
      if (!k.startsWith(prefix)) continue;
      for (const f of list) if (/\.(png|jpg|json|xml|txt)$/i.test(f.name)) (dirs.get(libOf(f)) ?? dirs.set(libOf(f), []).get(libOf(f))).push(f);
    }
    if (dirs.size) {
      const libs = [...dirs.keys()].sort((a, b) => (b.toLowerCase() === hint ? 1 : 0) - (a.toLowerCase() === hint ? 1 : 0) || libRank(a) - libRank(b));
      return dirs.get(libs[0]);
    }
  }
  return [];
}

// ---------------------------------------------------------------- Workspace へ足す
const note = (ws, msg) => {
  try {
    ws.app?.events?.emit?.("remote:note", msg);
  } catch {}
};
function addToWorkspace(ws, list) {
  const fresh = list.filter((f) => !ws.keys.has(`${f.webkitRelativePath}|${f.size}|${f.lastModified}`));
  if (fresh.length) {
    ws.add(fresh);
    for (const f of fresh) f.prefetch(); // 並列で先に取りに行く（使うときには届いている）
  }
  return fresh.length;
}
const parseJson = async (f) => JSON.parse((await f.text()).replace(/^﻿/, ""));

/** アトラス（assetPath）が mod に無いときだけ、本体のものを足す */
export async function ensureAtlas(ws, assetPath) {
  syncLayout(ws);
  if (!assetPath || /^#|^none$/i.test(String(assetPath).trim())) return 0;
  if (ws.atlasFor?.(assetPath)) return 0;
  const list = findAtlas(assetPath);
  if (!list.length) return 0;
  return addToWorkspace(ws, completeFromMod(ws, list));
}

/**
 * 一部だけ mod にあるアトラス（Animation.json だけ / png だけ …）を、足りないファイルだけの補完にする。
 *  ・mod に同じ相対パスのファイルがあれば、本体のものは足さない（mod のものが優先）
 *  ・足すファイルは、mod の同じフォルダにあるものとして登録し直す（mod のファイルと同じ origin でないと、アトラスとして組み合わせられないため）
 * mod に手がかり（同じ名前のファイル）が全く無ければ、そのまま全部足す
 */
function completeFromMod(ws, list) {
  const mods = (ws.files ?? []).filter((f) => !f.remote);
  const segs = (p) => String(p).replace(/\\/g, "/").split("/").filter(Boolean);
  const low = (a) => a.map((x) => x.toLowerCase());
  // 手がかり: 本体のファイルと「後ろ（ファイル名 + 親フォルダ…）が同じ」mod のファイル。後ろが長く合うものを選ぶ
  let best = null;
  for (const r of list) {
    const rs = low(segs(r.repoPath));
    for (const m of mods) {
      const ms = low(segs(m.webkitRelativePath || m.name));
      let k = 0;
      while (k < rs.length && k < ms.length && rs[rs.length - 1 - k] === ms[ms.length - 1 - k]) k++;
      if (k >= 2 && (!best || k > best.k)) best = { k, r, m };
    }
  }
  if (!best) return list;
  const rSegs = segs(best.r.repoPath),
    mSegs = segs(best.m.webkitRelativePath || best.m.name);
  const rBase = rSegs.slice(0, rSegs.length - best.k).join("/").toLowerCase(),
    mBase = mSegs.slice(0, mSegs.length - best.k).join("/");
  const have = new Set(mods.map((m) => segs(m.webkitRelativePath || m.name).join("/").toLowerCase()));
  const out = [];
  for (const f of list) {
    const rp = segs(f.repoPath).join("/");
    if (rBase && !rp.toLowerCase().startsWith(rBase + "/")) continue; // 別の場所のものは足さない
    const rest = rBase ? rp.slice(rBase.length + 1) : rp;
    const target = (mBase ? mBase + "/" : "") + rest;
    if (have.has(target.toLowerCase())) continue; // mod にある
    const c = new RemoteFile(f.repoPath, f.branch);
    c.webkitRelativePath = target;
    out.push(c);
  }
  return out;
}

/**
 * キャラ id の JSON が mod に無く本体にあるとき、JSON を足す。JSON が mod にあっても、使うアトラスが mod に無ければ（ベースゲームの画像など）本体のものを足す。
 * 足したファイル数（何も足していなければ 0）
 */
export async function ensureCharacter(ws, id) {
  syncLayout(ws);
  if (!isEnabled() || !id) return 0;
  let f = ws.resolve("character", id, { quiet: true }),
    n = 0;
  if (!f) {
    f = findData("character", id);
    if (!f) return 0;
    n += addToWorkspace(ws, [f]);
  }
  const j = await parseJson(f);
  const paths = new Set([j.assetPath, ...(j.animations || []).map((a) => a?.assetPath)].filter(Boolean));
  for (const p of paths) n += await ensureAtlas(ws, p);
  if (n) note(ws, `キャラクター「${id}」の足りないファイルを funkin.assets から取得しました（${n} 件）`);
  return n;
}

/** ステージも同じ: stage.json が無ければ足し、props の画像が mod に無ければ本体のものを足す */
export async function ensureStage(ws, id) {
  syncLayout(ws);
  if (!isEnabled() || !id) return 0;
  let f = ws.resolve("stage", id, { quiet: true }),
    n = 0;
  if (!f) {
    f = findData("stage", id);
    if (!f) return 0;
    n += addToWorkspace(ws, [f]);
  }
  const j = await parseJson(f);
  const paths = new Set((j.props || []).map((p) => p?.assetPath).filter((p) => p && !String(p).startsWith("#")));
  for (const p of paths) n += await ensureAtlas(ws, p);
  if (n) note(ws, `ステージ「${id}」の足りないファイルを funkin.assets から取得しました（${n} 件）`);
  return n;
}

/** { stage, characters: {player, girlfriend, opponent, …} | [id…] } にあるものを、無ければ取ってくる（並列）。失敗は例外にせず { errors } で返す */
export async function ensureFor(ws, spec = {}) {
  syncLayout(ws);
  const errors = [];
  const run = async (fn, label) => {
    try {
      return await fn();
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
      return 0;
    }
  };
  const jobs = [];
  if (spec.stage) jobs.push(run(() => ensureStage(ws, spec.stage), `ステージ「${spec.stage}」`));
  const ids = Array.isArray(spec.characters) ? spec.characters : Object.values(spec.characters || {});
  for (const id of new Set(ids.filter(Boolean))) jobs.push(run(() => ensureCharacter(ws, id), `キャラクター「${id}」`));
  const added = (await Promise.all(jobs)).reduce((a, b) => a + b, 0);
  return { added, errors };
}

// ---------------------------------------------------------------- ステージスクリプト・シェーダー
const norm = (s) => String(s ?? "").toLowerCase().replace(/[-_ ]/g, "");
/** シェーダー名のゆれ（adjustColor / adjust-color）をそろえるためのキー */
export const fragKey = (name) => norm(String(name ?? "").replace(/^.*[\\/]/, "").replace(/\.frag$/i, ""));
/**
 * ステージ id の本体スクリプトを取る（無ければ null）。
 * 0.8: scripts/stages/<id>.hxc + scripts/stages/props/*.hxc + scripts/shaders/*.hxc / 0.9: gameplay/stages/<id>/*.hxc + ui/shaders/*.hxc
 * → { scripts: [{ name, text, main }], frags: { <fragKey>: text } }。.frag は、スクリプトの中で Paths.frag('名前') と書かれているものだけ取る
 */
/** 本体のノーツ kind のスクリプト（preload/scripts/notekinds/ または gameplay/notekinds/）。kinds = 譜面で使われている kind、have = mod が定義済みの kind は除く。
 *  ファイル名 = kind 名のものを取る。見つからない kind は、全ファイルの `super('kind')` を調べる */
export async function noteKindScripts(kinds, have = []) {
  if (!isEnabled()) return [];
  const want = [...new Set(kinds)].filter((k) => k && !have.includes(k));
  if (!want.length) return [];
  const ix = indexOf(getBranch());
  const rp = (f) => f.repoPath.toLowerCase().replace(/^(preload|shared)\//, "");
  const files = [...ix.files.values()].filter((f) => /\.hxc$/i.test(f.name) && /^(scripts|gameplay)\/notekinds\//.test(rp(f)));
  const out = new Map();
  const rest = [];
  for (const k of want) {
    const f = files.find((x) => x.name.replace(/\.hxc$/i, "").toLowerCase() === String(k).toLowerCase());
    if (f) out.set(f.repoPath, f);
    else rest.push(k);
  }
  if (rest.length) {
    await Promise.all(
      files.map(async (f) => {
        if (out.has(f.repoPath)) return;
        const t = await f.text().catch(() => "");
        if (rest.some((k) => new RegExp(`super\\(\\s*['"]${String(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`).test(t))) out.set(f.repoPath, f);
      }),
    );
  }
  const list = [...out.values()];
  return Promise.all(list.map(async (f) => ({ name: `funkin.assets/${f.repoPath}`, text: await f.text() }))).then((a) => a.filter((x) => x.text));
}

/** 本体の Haxe シェーダークラスのうち、runtime 側で作ってあるもの → 使う .frag */
const NATIVE_FRAGS = { AdjustColorShader: "adjust-color", RuntimeRainShader: "rain", HSVShader: "hsv", Grayscale: "grayscale", GaussianBlurShader: "gaussian-blur", InverseDotsShader: "inverse-dots", MosaicEffect: "mosaic" };
export async function stageScripts(stageId) {
  if (!isEnabled() || !stageId) return null;
  const branch = getBranch();
  const ix = indexOf(branch);
  const id = normAsset(stageId);
  const is09 = layoutOf(branch) === "0.9";
  const all = [...ix.files.values()];
  const rp = (f) => f.repoPath.toLowerCase().replace(/^(preload|shared)\//, ""); // 0.8 は preload/ の下
  const main = is09 ? all.filter((f) => /\.hxc$/i.test(f.name) && rp(f).startsWith(`gameplay/stages/${id}/`)) : all.filter((f) => rp(f) === `scripts/stages/${id}.hxc`);
  if (!main.length) return null;
  const aux = is09 ? all.filter((f) => /\.hxc$/i.test(f.name) && rp(f).startsWith("ui/shaders/")) : all.filter((f) => /\.hxc$/i.test(f.name) && (rp(f).startsWith("scripts/stages/props/") || rp(f).startsWith("scripts/shaders/")));
  // 補助スクリプトは「main のスクリプトが名前で参照しているクラス」だけ（参照先が参照するものも含めて）読む。関係ないものを読むと、未対応構文の解析エラーが出るため
  const mainTexts = await Promise.all(main.map((f) => f.text()));
  const auxTexts = new Map();
  const classOf = (f) => f.name.replace(/\.[^.]+$/, "");
  const picked = [];
  let pool = [...mainTexts];
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of aux) {
      if (auxTexts.has(f)) continue;
      const cn = classOf(f);
      if (!pool.some((t) => new RegExp(`\\b${cn}\\b`).test(t))) continue;
      const t = await f.text().catch(() => null); // 補助が取れなくても、他は動かす
      if (t == null) {
        auxTexts.set(f, "");
        continue;
      }
      auxTexts.set(f, t);
      picked.push(f);
      pool.push(t);
      grew = true;
    }
  }
  const list = [...main, ...picked];
  const texts = [...mainTexts, ...picked.map((f) => auxTexts.get(f))];
  const scripts = list.map((f, i) => ({ name: `funkin.assets/${f.repoPath}`, text: texts[i], main: i < main.length }));
  const frags = await fragsFor(texts);
  return { scripts, frags };
}

/** スクリプト（texts）が使う .frag を本体から取る: Paths.frag('名前') で名指ししたもの + ネイティブ実装のシェーダークラス（AdjustColorShader / RuntimeRainShader）が使うもの。{ <fragKey>: text } */
export async function fragsFor(texts) {
  if (!isEnabled() || !texts?.length) return {};
  const branch = getBranch();
  const is09 = layoutOf(branch) === "0.9";
  const rp = (f) => f.repoPath.toLowerCase().replace(/^(preload|shared)\//, "");
  const wanted = new Set();
  for (const t of texts) for (const m of t.matchAll(/Paths\.frag\(\s*['"]([^'"]+)['"]\s*\)/g)) wanted.add(fragKey(m[1]));
  for (const [cls, frag] of Object.entries(NATIVE_FRAGS)) if (texts.some((t) => new RegExp(`\\b${cls}\\b`).test(t))) wanted.add(fragKey(frag));
  const fragFiles = [...indexOf(branch).files.values()].filter((f) => /\.frag$/i.test(f.name) && wanted.has(fragKey(f.name)) && (is09 ? rp(f).startsWith("ui/shaders/") : rp(f).startsWith("shaders/")));
  const frags = {};
  await Promise.all(fragFiles.map(async (f) => (frags[fragKey(f.name)] = await f.text().catch(() => ""))));
  for (const k of Object.keys(frags)) if (!frags[k]) delete frags[k];
  return frags;
}

// ---------------------------------------------------------------- ノートスタイル
/** 取りに行く画像のキー（カウントダウンや判定の画像は、ここでは使わない） */
const NOTE_KEYS = ["note", "noteStrumline", "holdNote", "noteSplash", "holdNoteCover"];
function collectAssetPaths(def, out) {
  if (!def || typeof def !== "object") return;
  if (typeof def.assetPath === "string" && def.assetPath.trim() && !/^none$/i.test(def.assetPath)) out.add(def.assetPath);
  for (const v of Object.values(def)) if (v && typeof v === "object") collectAssetPaths(v, out);
}
/**
 * 本体のノートスタイルを取る。{ json, images: [{ key, file }], xmls: [{ key, file }] } / 無ければ null
 * key は ModPack の規則でのルート以降・拡張子なし（"images/notes" / 0.9 は "gameplay/notestyles/funkin/notes"）。origin は "builtin:<id>" として使う
 */
export async function noteStyle(id) {
  if (!isEnabled()) return null;
  const f = findData("notestyle", id);
  if (!f) return null;
  const json = await parseJson(f);
  const paths = new Set();
  for (const k of NOTE_KEYS) collectAssetPaths(json.assets?.[k], paths);
  const images = [],
    xmls = [];
  for (const p of paths) {
    for (const rf of findAtlas(p)) {
      rf.prefetch();
      const key = infoOfPath(rf.webkitRelativePath).noExt;
      if (/\.(png|jpg)$/i.test(rf.name)) images.push({ key, file: rf });
      else if (/\.xml$/i.test(rf.name)) xmls.push({ key, file: rf });
    }
  }
  return { json, images, xmls };
}

/** 画面に出す短い説明 */
export const describe = () => `本体アセット: ${isEnabled() ? `GitHub（FunkinCrew/Funkin.assets の ${getBranch()}）から毎回取得` : "オフ"}（一覧 ${indexOf().files.size} 件）`;
