/* ============================================================
   services/FunkinAssets.js — 本体アセット（FunkinCrew/Funkin.assets）を GitHub から取得する
   ------------------------------------------------------------
   読み込んだ mod に無いキャラ / ステージ / ノートスタイル（と、それが使う画像）を、必要になったときだけ
   raw.githubusercontent.com から取ってくる。ページには本体の画像を入れない（一覧のパスだけ入っている）。
   ・RemoteFile … LazyZipFile と同じ使い方（name / webkitRelativePath / blob() / text() / arrayBuffer()）。中身は読まれたときに取得
   ・ensureCharacter / ensureStage / ensureAtlas … ws（Workspace）に、必要なファイルだけ「funkin.assets」の origin で足す
   ・noteStyle(id) … ノートスタイルの JSON と画像を返す（runtime/noteStyle.js の NoteStyleSet が使う）
   ・mod 側に同じものがあれば、そちらが先。ここは「mod に無かったとき」だけ
   ・素材は Friday Night Funkin' のもの（© The Funkin' Crew Inc.）。エディタのプレビュー用で、書き出す mod の zip には含めない
   ・テスト・別のミラー用: globalThis.__FUNKIN_ASSETS = { raw: "https://…/", tree: "https://…" }
   ============================================================ */
import { FUNKIN_ASSETS_PATHS } from "./funkinAssetsIndex.js";
import { infoOfPath, normAsset } from "./ModPack.js";

export const ORIGIN = "funkin.assets";
const KEY_ON = "studio.remoteAssets";
const KEY_TREE = "studio.remoteAssets.tree.v1";
const DAY = 24 * 3600 * 1000;

const conf = () => {
  const o = globalThis.__FUNKIN_ASSETS || {};
  return {
    raw: o.raw ?? "https://raw.githubusercontent.com/FunkinCrew/Funkin.assets/main/",
    tree: o.tree ?? "https://api.github.com/repos/FunkinCrew/Funkin.assets/git/trees/main?recursive=1",
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

// ---------------------------------------------------------------- 取得したファイル（キャッシュ付き）
const bytesCache = new Map(); // repoPath → Promise<ArrayBuffer>
function fetchBytes(repoPath) {
  let p = bytesCache.get(repoPath);
  if (!p) {
    const url = conf().raw + repoPath.split("/").map(encodeURIComponent).join("/");
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`funkin.assets から取得できません（${r.status}）: ${repoPath}`);
      return r.arrayBuffer();
    });
    p.catch(() => bytesCache.delete(repoPath)); // 失敗は覚えない（つながったら次は取れる）
    bytesCache.set(repoPath, p);
  }
  return p;
}
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", json: "application/json", xml: "application/xml" };

export class RemoteFile {
  constructor(repoPath) {
    this.repoPath = repoPath;
    this.name = repoPath.split("/").pop();
    this.webkitRelativePath = `${ORIGIN}/${repoPath}`; // ModPack の規則で origin = "funkin.assets"（週フォルダ付きなら "funkin.assets/week6"）
    this.size = 0;
    this.lastModified = 0;
    this.lazy = true;
    this.remote = true;
  }
  arrayBuffer() {
    return fetchBytes(this.repoPath).then((b) => b.slice(0));
  }
  async blob() {
    const ext = (this.name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
    return new Blob([await fetchBytes(this.repoPath)], { type: MIME[ext] || "" });
  }
  async text() {
    return new TextDecoder().decode(await fetchBytes(this.repoPath));
  }
  slice(...a) {
    return this.blob().then((b) => b.slice(...a));
  }
}

// ---------------------------------------------------------------- ファイル一覧
const files = new Map(); // repoPath → RemoteFile
const byNoExt = new Map(); // "images/characters/bf" など（ルート以降・拡張子なし・小文字）→ RemoteFile[]
let indexReady = null;

function addPath(p) {
  if (files.has(p)) return;
  const f = new RemoteFile(p);
  files.set(p, f);
  const k = infoOfPath(f.webkitRelativePath).noExt;
  (byNoExt.get(k) ?? byNoExt.set(k, []).get(k)).push(f);
}
for (const p of FUNKIN_ASSETS_PATHS) addPath(p); // 最初から同梱の一覧が使える（ネットが無くても、どの id があるかは分かる）

/** GitHub のツリー API で一覧を新しくする（1 日 1 回まで。失敗しても同梱の一覧のまま） */
export function refreshIndex() {
  if (indexReady) return indexReady;
  indexReady = (async () => {
    try {
      let paths = null;
      try {
        const c = JSON.parse(localStorage.getItem(KEY_TREE) || "null");
        if (c && Date.now() - c.t < DAY && c.tree === conf().tree) paths = c.paths;
      } catch {}
      if (!paths) {
        const r = await fetch(conf().tree);
        if (!r.ok) return;
        const j = await r.json();
        paths = (j.tree || []).filter((e) => e.type === "blob" && /\.(json|png|xml|txt)$/i.test(e.path) && !/^(\.github|exclude|sserafim)\//.test(e.path)).map((e) => e.path);
        try {
          localStorage.setItem(KEY_TREE, JSON.stringify({ t: Date.now(), tree: conf().tree, paths }));
        } catch {}
      }
      for (const p of paths) addPath(p);
    } catch {
      /* オフラインなど: 同梱の一覧を使う */
    }
  })();
  return indexReady;
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
const noExtKey = (dir, id) => `${dir}/${normAsset(id)}`;

/** id がある種類（character / stage / notestyle）の JSON */
export function findData(kind, id) {
  const dir = { character: "data/characters", stage: "data/stages", notestyle: "data/notestyles" }[kind];
  if (!dir || !id) return null;
  const list = (byNoExt.get(noExtKey(dir, id)) ?? []).filter((f) => /\.json$/i.test(f.name));
  return list.length ? pickLib(list, "")[0] : null;
}
export const has = (kind, id) => isEnabled() && !!findData(kind, id);

/** assetPath のアトラス一式。Sparrow / Packer = png + xml(txt)、AnimateAtlas = フォルダの中身全部、1 枚絵 = png だけ */
export function findAtlas(assetPath) {
  const n = normAsset(assetPath);
  if (!n) return [];
  const hint = libHint(assetPath);
  const key = `images/${n}`;
  const same = byNoExt.get(key) ?? [];
  const png = pickLib(same.filter((f) => /\.png$/i.test(f.name)), hint)[0];
  if (png) {
    const lib = libOf(png);
    return same.filter((f) => libOf(f) === lib && /\.(png|xml|txt)$/i.test(f.name));
  }
  // AnimateAtlas: images/<n>/ の下
  const prefix = key + "/";
  const dirs = new Map(); // lib → files
  for (const [k, list] of byNoExt) {
    if (!k.startsWith(prefix)) continue;
    for (const f of list) (dirs.get(libOf(f)) ?? dirs.set(libOf(f), []).get(libOf(f))).push(f);
  }
  if (!dirs.size) return [];
  const libs = [...dirs.keys()].sort((a, b) => (b.toLowerCase() === hint ? 1 : 0) - (a.toLowerCase() === hint ? 1 : 0) || libRank(a) - libRank(b));
  return dirs.get(libs[0]);
}

// ---------------------------------------------------------------- Workspace へ足す
const note = (ws, msg) => {
  try {
    ws.app?.events?.emit?.("remote:note", msg);
  } catch {}
};
function addToWorkspace(ws, list) {
  const fresh = list.filter((f) => !ws.keys.has(`${f.webkitRelativePath}|${f.size}|${f.lastModified}`));
  if (fresh.length) ws.add(fresh);
  return fresh.length;
}
const parseJson = async (f) => JSON.parse((await f.text()).replace(/^﻿/, ""));

/** アトラス（assetPath）が mod に無いときだけ、本体のものを足す */
export async function ensureAtlas(ws, assetPath) {
  if (!assetPath || /^#|^none$/i.test(String(assetPath).trim())) return 0;
  if (ws.atlasFor?.(assetPath)) return 0;
  const list = findAtlas(assetPath);
  return list.length ? addToWorkspace(ws, list) : 0;
}

/**
 * キャラ id の JSON が mod に無く本体にあるとき、JSON を足す。JSON が mod にあっても、使うアトラスが mod に無ければ（ベースゲームの画像など）本体のものを足す。
 * 足したファイル数（何も足していなければ 0）
 */
export async function ensureCharacter(ws, id) {
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

/** { stage, characters: {player, girlfriend, opponent, …} | [id…] } にあるものを、無ければ取ってくる。失敗は例外にせず { errors } で返す */
export async function ensureFor(ws, spec = {}) {
  const errors = [];
  const run = async (fn, label) => {
    try {
      return await fn();
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
      return 0;
    }
  };
  let n = 0;
  if (spec.stage) n += await run(() => ensureStage(ws, spec.stage), `ステージ「${spec.stage}」`);
  const ids = Array.isArray(spec.characters) ? spec.characters : Object.values(spec.characters || {});
  for (const id of new Set(ids.filter(Boolean))) n += await run(() => ensureCharacter(ws, id), `キャラクター「${id}」`);
  return { added: n, errors };
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
 * key は "images/…"（ルート以降・拡張子なし）。同じ origin（"builtin:<id>"）として使う
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
      const key = infoOfPath(rf.webkitRelativePath).noExt;
      if (/\.png$/i.test(rf.name)) images.push({ key, file: rf });
      else if (/\.xml$/i.test(rf.name)) xmls.push({ key, file: rf });
    }
  }
  return { json, images, xmls };
}

/** 画面に出す短い説明 */
export const describe = () => `本体アセット: ${isEnabled() ? "GitHub（FunkinCrew/Funkin.assets）から取得" : "オフ"}（一覧 ${files.size} 件）`;
