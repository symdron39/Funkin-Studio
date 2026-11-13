/* ============================================================
   note/editor.js — Note Editor（noteStyle の編集）
   ------------------------------------------------------------
   V-Slice 本体には無いエディタ。data/notestyles/<id>.json を編集し、ノーツ・受け皿・ホールド・
   スプラッシュ・ホールドカバーを「1 レーン = 112px」の実寸でプレビューする。絵をドラッグすると offsets が動く。
   ・画像の探し方は他のエディタと同じ（services/ModPack.js のパス付き探索。同じ mod を優先）
   ・プレビューの描画は runtime/noteStyle.js（プレイテストと同じ NoteStyle）を使う。fallback の連鎖もたどる
   ・書き出しは mod の zip ごと（services/ModExport.js）→ data/notestyles/<id>.json
   ============================================================ */
import { Viewport } from "../../ui/Viewport.js";
import { HudPanels } from "../../ui/HudPanels.js";
import { mountModPicker } from "../../ui/ModPicker.js";
import { NoteStyleSet, NoteStyle, framesByPrefix } from "../../runtime/noteStyle.js";
import { loadImage, parseSparrowXml, sparrowFrames, paintSparrow } from "../stage/sparrowAtlas.js";
import { infoOf } from "../../services/ModPack.js";
import { exportMod } from "../../services/ModExport.js";

const DIRS = ["left", "down", "up", "right"];
const LANE = 112; // 1 レーンの幅（V-Slice の Strumline.NOTE_SPACING）
const FPS = 24;
const SEL = "#ffb020";
const baseName = (n) => String(n).replace(/^.*[:\\/]/, "").replace(/\.(json|png|xml)$/i, "");
const laneX = (l) => (l - 1.5) * LANE;
// プレビューの行（world の y）
const ROW = { static: 0, press: 150, confirm: 300, note: 480, splash: 860, cover: 1010 };
const HOLD_LEN = 230;
const GROUPS = ["noteStrumline", "note", "holdNote", "noteSplash", "holdNoteCover"];

export function defaultStyle() {
  return {
    version: "1.1.0",
    name: "New NoteStyle",
    author: "",
    fallback: "funkin",
    assets: {
      note: { assetPath: "", scale: 0.7, data: { left: { prefix: "noteLeft" }, down: { prefix: "noteDown" }, up: { prefix: "noteUp" }, right: { prefix: "noteRight" } } },
      noteStrumline: { assetPath: "", scale: 0.7, offsets: [0, 0], data: {} },
    },
  };
}

export function mountNoteEditor(state) {
  const $ = (id) => document.getElementById(id),
    canvas = $("nteCanvas"),
    ctx = canvas.getContext("2d");
  const ws = () => state.app.workspace;

  let doc = defaultStyle();
  let docId = "newstyle",
    docOrigin = "";
  let selGroup = "noteStrumline",
    selEntry = "";
  const set = new NoteStyleSet();
  const loaded = new Set(); // 読み込み済みの画像（assetPath|origin）
  let missing = [];
  let hits = [];
  let t0 = performance.now();
  // ---- 判定・スクロールテスト ----
  let view = "board"; // "board" | "scroll"
  const sc = { speed: 2, bpm: 120, down: false, windows: true, win: [["Sick", 45, "#4cd964"], ["Good", 90, "#5ac8fa"], ["Bad", 135, "#ffcc00"], ["Shit", 160, "#ff6b6b"]] };
  const PX_PER_MS = 0.45; // V-Slice の Constants.PIXELS_PER_MS
  let clockBase = 0,
    clockStart = performance.now(),
    clockPlaying = true;
  /** 曲の時刻（ms）。一時停止中は止まる */
  const songMs = () => (clockPlaying ? clockBase + (performance.now() - clockStart) : clockBase);

  // ---------- 通知 ----------
  let toastTimer = null;
  const say = (s) => {
    $("nteStatus").textContent = s;
    const t = $("nteToast");
    t.textContent = s;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 4500);
  };
  state.addDisposer(() => clearTimeout(toastTimer));
  const markDirty = () => state.app.unsaved?.mark();

  // ---------- ビュー ----------
  const vp = new Viewport(canvas, {
    state,
    originY: 0.5,
    onChange: () => {
      $("nteZoom").value = Number(vp.zoom.toFixed(2));
      requestDraw();
    },
  });
  new HudPanels(state.root, { storageKey: "note", defaults: ["files", "group"], narrowDefaults: ["group"], narrowExclusive: ["files", "group", "entry"] });
  $("nteZoom").oninput = () => vp.setZoom(Number($("nteZoom").value));
  $("nteZoomIn").onclick = () => vp.setZoom(vp.zoom * 1.25);
  $("nteZoomOut").onclick = () => vp.setZoom(vp.zoom / 1.25);
  $("nteResetView").onclick = () => vp.reset();
  $("ntePanTool").onclick = () => {
    vp.panMode = !vp.panMode;
    $("ntePanTool").setAttribute("aria-pressed", String(vp.panMode));
    vp._updateCursor?.();
  };
  const fit = () => (view === "scroll" ? vp.fit(-660, -380, 660, 380) : vp.fit(-420, -130, 420, ROW.cover + 130));
  $("nteFit").onclick = fit;

  // ---------- 履歴 ----------
  let history = [JSON.stringify(doc)],
    hi = 0;
  const syncHud = () => state.active && state.app.hud.setHistory(hi > 0, hi < history.length - 1);
  function commit() {
    const s = JSON.stringify(doc);
    if (s === history[hi]) return;
    history.length = hi + 1;
    history.push(s);
    if (history.length > 100) history.shift();
    hi = history.length - 1;
    markDirty();
    syncHud();
    rebuild();
    syncPanels();
    requestDraw();
  }
  function resetHistory() {
    history = [JSON.stringify(doc)];
    hi = 0;
    syncHud();
  }
  function restoreAt(i) {
    hi = i;
    doc = JSON.parse(history[hi]);
    rebuild();
    syncPanels();
    markDirty();
    syncHud();
    requestDraw();
  }
  const undo = () => hi > 0 && restoreAt(hi - 1);
  const redo = () => hi < history.length - 1 && restoreAt(hi + 1);

  // ---------- noteStyle の読み書き ----------
  const A = (g, create) => (create ? (doc.assets[g] ??= { data: {} }) : doc.assets?.[g]);
  /** グループ内の 1 要素（{prefix, offsets…}）。create=true なら無ければ作る */
  function entry(g, key, create = false) {
    const a = A(g, create);
    if (!a) return null;
    const d = create ? (a.data ??= {}) : a.data;
    if (!d) return null;
    if (g === "noteSplash") {
      const [dir, i] = key.split("#");
      const arr = create ? (d[dir + "Splashes"] ??= []) : d[dir + "Splashes"];
      if (!arr) return null;
      return create ? (arr[+i] ??= { prefix: "" }) : (arr[+i] ?? null);
    }
    if (g === "holdNoteCover") {
      const [dir, part] = key.split(".");
      const l = create ? (d[dir] ??= {}) : d[dir];
      if (!l) return null;
      return create ? (l[part] ??= { prefix: "" }) : (l[part] ?? null);
    }
    return create ? (d[key] ??= { prefix: "" }) : (d[key] ?? null);
  }
  function entryKeys(g) {
    if (g === "noteStrumline") return DIRS.flatMap((d) => ["Static", "Press", "Confirm", "ConfirmHold"].map((s) => d + s));
    if (g === "note") return [...DIRS];
    if (g === "noteSplash") return DIRS.flatMap((d) => [0, 1].map((i) => `${d}#${i}`));
    if (g === "holdNoteCover") return DIRS.flatMap((d) => ["start", "hold", "end"].map((p) => `${d}.${p}`));
    return [];
  }

  /** doc（と fallback 先）から NoteStyle を作り直す */
  function rebuild() {
    set.raw.set(docId, doc);
    set.origins.set(docId, docOrigin);
    for (const [id, data] of set.raw) set.styles.set(id, new NoteStyle(set, id, data));
    set.version++;
  }
  const style = () => set.get(docId);

  /** workspace から noteStyle の JSON を探す（fallback 先など）。id.json */
  function findStyleFile(id) {
    const c = ws().files.filter((f) => /\.json$/i.test(f.name) && baseName(f.name).toLowerCase() === String(id).toLowerCase());
    return c.sort((a, b) => (infoOf(b).origin === docOrigin) - (infoOf(a).origin === docOrigin) || /notestyles/i.test(relOf(b)) - /notestyles/i.test(relOf(a)))[0] ?? null;
  }
  const relOf = (f) => f.webkitRelativePath || f.name;
  const readText = async (f) => (f.lazy ? (await f.blob()).text() : f.text());

  /** doc と fallback 連鎖に必要な画像・XML を workspace から読み込む */
  async function loadAssets() {
    const w = ws();
    missing = [];
    // 1. fallback の連鎖の JSON
    let cur = doc;
    for (let depth = 0; depth < 6 && cur?.fallback; depth++) {
      const id = cur.fallback;
      if (!set.raw.has(id)) {
        const f = findStyleFile(id);
        if (!f) {
          // 読み込んだ mod に無ければ、内蔵の標準 noteStyle（funkin）を使う
          if (await set.loadBuiltin(id)) {
            cur = set.raw.get(id);
            continue;
          }
          missing.push(`fallback「${id}」の JSON`);
          break;
        }
        try {
          const j = JSON.parse((await readText(f)).replace(/^﻿/, ""));
          set.raw.set(id, j);
          set.origins.set(id, infoOf(f).origin);
        } catch (e) {
          missing.push(`${id}.json（${e.message}）`);
          break;
        }
      }
      cur = set.raw.get(id);
    }
    rebuild();
    // 2. 各スタイルが使う画像
    for (const [id, data] of set.raw) {
      const origin = set.origins.get(id) ?? "";
      if (origin.startsWith("builtin:")) continue; // 内蔵スタイルの画像は、すでに入っている
      const paths = new Set();
      for (const [k, def] of Object.entries(data.assets ?? {})) {
        if (!["note", "noteStrumline", "holdNote", "noteSplash"].includes(k)) continue;
        if (def?.assetPath) paths.add(def.assetPath);
      }
      for (const d of DIRS) {
        const p = data.assets?.holdNoteCover?.data?.[d]?.assetPath;
        if (p) paths.add(p);
      }
      for (const p of paths) {
        const key = p + "|" + origin;
        if (loaded.has(key)) continue;
        const png = w.resolve("image", p, { origin, quiet: true });
        if (!png) {
          missing.push(`${id}: 画像「${p}」`);
          continue;
        }
        loaded.add(key);
        const info = infoOf(png);
        try {
          set.images.set(info.noExt, { img: await loadImage(png), origin: info.origin });
          const xml = w.files.find((f) => /\.xml$/i.test(f.name) && infoOf(f).noExt === info.noExt && infoOf(f).origin === info.origin);
          if (xml) set.xmls.set(info.noExt, { sprites: parseSparrowXml(await readText(xml)), origin: info.origin });
        } catch (e) {
          missing.push(`${p}（${e.message}）`);
        }
      }
    }
    rebuild();
    $("nteMissing").textContent = missing.length ? "⚠ 見つからない: " + missing.join(" / ") : "";
    syncPanels();
    requestDraw();
  }

  async function openDoc(file, text) {
    let json;
    try {
      json = JSON.parse((text ?? (await readText(file))).replace(/^﻿/, ""));
    } catch (e) {
      return say("JSON を読み込めません: " + e.message);
    }
    if (!json || typeof json.assets !== "object") return say("noteStyle の JSON ではありません（assets がありません）");
    set.raw.clear();
    set.styles.clear();
    set.images.clear();
    set.xmls.clear();
    set.origins.clear();
    loaded.clear();
    doc = json;
    doc.assets ??= {};
    docId = baseName(file.name);
    docOrigin = file.__origin ?? (file.webkitRelativePath || file.lazy ? infoOf(file).origin : "");
    selGroup = "noteStrumline";
    selEntry = "";
    resetHistory();
    state.app.unsaved?.clean();
    rebuild();
    syncPanels();
    say(`「${doc.name ?? docId}」を読み込みました。画像を探しています…`);
    await loadAssets();
    say(missing.length ? `読み込みました（見つからないもの ${missing.length} 件）。` : `「${doc.name ?? docId}」を読み込みました。`);
    fit();
  }
  $("nteFile").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f || !state.app.unsaved.confirmReplace()) return;
    ws().add([f]);
    await openDoc(f);
  };
  $("nteAssets").onchange = async (e) => {
    const fs = [...e.target.files];
    e.target.value = "";
    if (!fs.length) return;
    ws().add(fs); // 他のエディタと共有
    loaded.clear();
    for (const k of [...set.raw.keys()]) if (k !== docId) set.raw.delete(k);
    await loadAssets();
    say(`${fs.length} 個のファイルを追加しました。`);
  };
  state.addDisposer(state.app.events.on("workspace:changed", () => ws().size && loadedOnce && loadAssets()));
  let loadedOnce = false;
  $("nteNew").onclick = () => {
    if (!state.app.unsaved.confirmReplace()) return;
    doc = defaultStyle();
    docId = "newstyle";
    docOrigin = ws().defaultOrigin();
    set.raw.clear();
    set.styles.clear();
    loaded.clear();
    selGroup = "noteStrumline";
    resetHistory();
    state.app.unsaved?.clean();
    rebuild();
    syncPanels();
    loadAssets();
    say("新しい noteStyle を作りました。グループの assetPath と prefix を設定してください。");
  };
  $("nteSave").onclick = () => {
    const id = docId.replace(/[^\w\-.]+/g, "_") || "notestyle";
    exportMod(state.app, [{ path: `data/notestyles/${id}.json`, data: JSON.stringify(doc, null, $("nteCompact").checked ? 2 : 0) }], { origin: docOrigin || undefined, say })
      .then(() => state.app.unsaved?.clean())
      .catch((e) => say("書き出しエラー: " + e.message));
  };

  // 「読み込み済みの mod から選ぶ」: ホームで読み込んだ mod の noteStyle
  mountModPicker(state, state.root.querySelector('[data-hud-panel="files"]'), {
    title: "読み込み済みの mod から noteStyle を選ぶ",
    list: (w) => {
      const out = [];
      for (const f of w.files) {
        if (!/\.json$/i.test(f.name)) continue;
        const i = infoOf(f);
        if (/(^|\/)notestyles\//i.test(i.noExt) || /^(data\/)?notestyles?\//i.test(i.noExt)) out.push({ label: baseName(f.name) + (i.origin ? `（${i.origin}）` : ""), files: { nteFile: f } });
      }
      return out.sort((a, b) => a.label.localeCompare(b.label));
    },
    fire: ["nteFile"],
    wait: 100,
  });

  // ---------- 描画 ----------
  function frameAt(frames, t, loop = true) {
    if (!frames?.length) return null;
    const i = Math.floor(t * FPS);
    return frames[loop ? i % frames.length : Math.min(i, frames.length - 1)];
  }
  /** フレーム fr を中心 (cx, cy) に描き、当たり判定を登録 */
  function blit(a, fr, cx, cy, sc, pixel, tag) {
    const fw = fr.frameWidth || fr.width,
      fh = fr.frameHeight || fr.height;
    const left = cx - (fw * sc) / 2 - (fr.frameX || 0) * sc,
      top = cy - (fh * sc) / 2 - (fr.frameY || 0) * sc;
    ctx.save();
    ctx.imageSmoothingEnabled = !pixel;
    paintSparrow(ctx, fr, a.img, left, top, fr.width * sc, fr.height * sc);
    ctx.restore();
    const r = { x0: cx - (fw * sc) / 2, y0: cy - (fh * sc) / 2, x1: cx + (fw * sc) / 2, y1: cy + (fh * sc) / 2, ...tag };
    hits.push(r);
    if (tag.group === selGroup && (tag.key === selEntry || !selEntry)) {
      ctx.save();
      ctx.strokeStyle = SEL;
      ctx.lineWidth = 2 / vp.zoom;
      ctx.strokeRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      ctx.restore();
    }
  }
  const sub = (key, f) => ctx.fillText(key, -400, f);
  const missBox = (x, y, label, tag) => {
    ctx.save();
    ctx.strokeStyle = "#ff6b6b";
    ctx.setLineDash([6 / vp.zoom, 4 / vp.zoom]);
    ctx.lineWidth = 1.5 / vp.zoom;
    ctx.strokeRect(x - 40, y - 40, 80, 80);
    ctx.fillStyle = "#ff6b6b";
    ctx.font = `${11 / vp.zoom}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText(label, x, y + 3 / vp.zoom);
    ctx.restore();
    hits.push({ x0: x - 40, y0: y - 40, x1: x + 40, y1: y + 40, ...tag });
  };

  function draw() {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    vp.drawGrid(ctx);
    hits = [];
    if (view === "scroll") return drawScroll();
    const st = style();
    const o = vp.origin(),
      z = vp.zoom;
    const time = ($("ntePlay").checked ? (performance.now() - t0) / 1000 : 0) || 0;
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(z, z);
    ctx.font = `${13 / z}px system-ui`;
    ctx.fillStyle = "#9aa4b5";
    ctx.textAlign = "left";
    for (const [name, y] of [["受け皿 Static", ROW.static], ["受け皿 Press", ROW.press], ["受け皿 Confirm", ROW.confirm], ["ノーツ + ホールド", ROW.note], ["スプラッシュ", ROW.splash], ["ホールドカバー", ROW.cover]]) ctx.fillText(name, -520, y + 4);
    if ($("nteGuide").checked) {
      ctx.strokeStyle = "rgba(150,170,200,.25)";
      ctx.lineWidth = 1 / z;
      for (const y of Object.values(ROW)) for (let l = 0; l < 4; l++) ctx.strokeRect(laneX(l) - 52, y - 52, 104, 104);
    }
    if (st) {
      const gOff = (g) => st.asset(g)?.offsets ?? [0, 0];
      // ---- 受け皿
      const sa = st.atlasOf("noteStrumline");
      const sOff = gOff("noteStrumline"),
        sSc = st.getStrumlineScale();
      for (const [mode, key, y] of [["Static", "Static", ROW.static], ["Press", "Press", ROW.press], ["Confirm", "Confirm", ROW.confirm]]) {
        for (let l = 0; l < 4; l++) {
          const k = DIRS[l] + key,
            tag = { group: "noteStrumline", key: k, lane: l };
          const sd = st.strumData(DIRS[l], mode);
          const fr = sa && sd ? frameAt(st.framesOf("noteStrumline", sd.prefix), mode === "Static" ? 0 : time) : null;
          if (!fr) {
            missBox(laneX(l), y, k, tag);
            continue;
          }
          const eo = sd.offsets ?? [0, 0];
          blit(sa, fr, laneX(l) + sOff[0] + eo[0], y + sOff[1] + eo[1], sSc, sa.def?.isPixel, tag);
        }
      }
      // ---- ノーツ + ホールド
      const na = st.atlasOf("note"),
        nOff = gOff("note"),
        nSc = st.getNoteScale(),
        hOff = gOff("holdNote");
      for (let l = 0; l < 4; l++) {
        ctx.save();
        ctx.translate(laneX(l), 0); // ホールドの offsets は drawHold が足す
        const ok = st.drawHold(ctx, l, 0, ROW.note + 20, ROW.note + HOLD_LEN, 1, 1);
        ctx.restore();
        if (ok) {
          const hw = (st.atlasOf("holdNote")?.img.width / 8) * st.fetchHoldNoteScale();
          hits.push({ x0: laneX(l) + hOff[0] - hw / 2, y0: ROW.note + hOff[1], x1: laneX(l) + hOff[0] + hw / 2, y1: ROW.note + HOLD_LEN + hOff[1], group: "holdNote", key: "", lane: l });
        }
        const nd = st.noteData(DIRS[l]),
          tag = { group: "note", key: DIRS[l], lane: l };
        const fr = na && nd ? st.framesOf("note", nd.prefix)?.[0] : null;
        if (!fr) missBox(laneX(l), ROW.note, DIRS[l], tag);
        else {
          const eo = nd.offsets ?? [0, 0];
          blit(na, fr, laneX(l) + nOff[0] + eo[0], ROW.note + nOff[1] + eo[1], nSc, na.def?.isPixel, tag);
        }
      }
      // ---- スプラッシュ
      const sp = st.asset("noteSplash");
      if (sp?.data?.enabled !== false && sp) {
        const spa = st.atlasOf("noteSplash"),
          spOff = sp.offsets ?? [0, 0];
        for (let l = 0; l < 4; l++) {
          const list = sp.data?.[DIRS[l] + "Splashes"] ?? [];
          const idx = Math.floor(time / 1.2) % Math.max(1, list.length);
          const e = list[idx];
          const tag = { group: "noteSplash", key: `${DIRS[l]}#${idx}`, lane: l };
          const fr = spa && e ? frameAt(st.framesOf("noteSplash", e.prefix), time % 1.2, false) : null;
          if (!fr) missBox(laneX(l), ROW.splash, DIRS[l] + " splash", tag);
          else {
            ctx.save();
            ctx.globalAlpha = sp.alpha ?? 1;
            blit(spa, fr, laneX(l) + spOff[0] + (e.offsets?.[0] ?? 0), ROW.splash + spOff[1] + (e.offsets?.[1] ?? 0), sp.scale ?? 1, spa.def?.isPixel, tag);
            ctx.restore();
          }
        }
      }
      // ---- ホールドカバー: start → hold → end を繰り返す
      const hc = st.asset("holdNoteCover");
      if (hc?.data?.enabled !== false && hc) {
        const phase = time % 3,
          part = phase < 0.8 ? "start" : phase < 2.2 ? "hold" : "end";
        const pt = part === "start" ? phase : part === "hold" ? phase - 0.8 : phase - 2.2;
        const hcOff = hc.offsets ?? [0, 0];
        for (let l = 0; l < 4; l++) {
          const lane = hc.data?.[DIRS[l]];
          const tag = { group: "holdNoteCover", key: `${DIRS[l]}.${part}`, lane: l };
          const a = lane?.assetPath ? set.atlas(lane.assetPath, set.origins.get(docId) ?? "") : null;
          const fr = a?.sprites && lane?.[part] ? frameAt(framesByPrefix(a.sprites, lane[part].prefix), pt, part === "hold") : null;
          if (!fr) missBox(laneX(l), ROW.cover, DIRS[l] + " cover", tag);
          else blit({ img: a.img }, fr, laneX(l) + hcOff[0] + (lane[part].offsets?.[0] ?? 0), ROW.cover + hcOff[1] + (lane[part].offsets?.[1] ?? 0), hc.scale ?? 1, false, tag);
        }
      }
    } else {
      ctx.fillStyle = "#9aa4b5";
      ctx.font = `${16 / z}px system-ui`;
      ctx.fillText("noteStyle を開くか、「新規」で作り始めてください", -240, 40);
    }
    ctx.restore();
    $("nteReadout").textContent = `${doc.name ?? docId}　${selGroup}${selEntry ? " / " + selEntry : ""}`;
  }
  // ---- スクロールテストの描画 ----
  /** 時刻 T（ms）の前後に流れるノーツ。8 分音符ごとに 1 つ、たまにホールド */
  const PATTERN = [0, 2, 1, 3, 2, 0, 3, 1];
  function notesBetween(a, b, step) {
    const out = [];
    for (let i = Math.max(0, Math.floor(a / step)); i * step <= b; i++) {
      out.push({ i, t: i * step, lane: PATTERN[i % 8], len: i % 10 === 3 ? step * 2 : 0 });
    }
    return out;
  }
  function drawScroll() {
    const st = style(),
      z = vp.zoom,
      o = vp.origin();
    const T = songMs(),
      step = 60000 / sc.bpm / 2,
      k = PX_PER_MS * sc.speed; // 1ms あたりに進む px
    const sy = sc.down ? 282 : -282; // 受け皿の中心（V-Slice の strumline y から、アイコン 1 つ分を足した位置）
    const dir = sc.down ? -1 : 1; // 上スクロールは下から上へ（y が減る）…ノーツの y = sy + dir * (t - T) * k
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(z, z);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(-640, -360, 1280, 720);
    ctx.strokeStyle = "rgba(150,170,200,.5)";
    ctx.lineWidth = 1.5 / z;
    ctx.strokeRect(-640, -360, 1280, 720);
    ctx.beginPath();
    ctx.rect(-640, -360, 1280, 720);
    ctx.clip();
    // 判定の幅（大きい順に重ねる）
    if (sc.windows) {
      const x0 = laneX(0) - 62,
        x1 = laneX(3) + 62;
      ctx.font = `${12 / z}px system-ui`;
      for (const [name, ms, col] of [...sc.win].reverse()) {
        const d = ms * k;
        ctx.fillStyle = col + "22";
        ctx.fillRect(x0, sy - d, x1 - x0, d * 2);
        ctx.strokeStyle = col + "99";
        ctx.lineWidth = 1 / z;
        ctx.strokeRect(x0, sy - d, x1 - x0, d * 2);
        ctx.fillStyle = col;
        ctx.textAlign = "left";
        ctx.fillText(`${name} ±${ms}ms（±${Math.round(d)}px）`, x1 + 8, sy - d + 12 / z);
      }
    }
    // 判定線（受け皿の中心）
    ctx.strokeStyle = "rgba(255,255,255,.7)";
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    ctx.moveTo(-640, sy);
    ctx.lineTo(640, sy);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!st) {
      ctx.restore();
      return;
    }
    const gOff = (g) => st.asset(g)?.offsets ?? [0, 0];
    const sa = st.atlasOf("noteStrumline"),
      sOff = gOff("noteStrumline"),
      sSc = st.getStrumlineScale();
    const na = st.atlasOf("note"),
      nOff = gOff("note"),
      nSc = st.getNoteScale(),
      hOff = gOff("holdNote");
    const horizon = 740 / k; // 画面の端までに相当する時間
    const list = notesBetween(T - 700, T + horizon + 100, step);
    // ホールド（胴体は頭より先に描く）
    for (const n of list) {
      if (!n.len || T > n.t + n.len) continue;
      const headY = sy + dir * Math.max(0, n.t - T) * k,
        tailY = sy + dir * (n.t + n.len - T) * k;
      ctx.save();
      ctx.translate(laneX(n.lane), 0); // ホールドの offsets は drawHold が足す
      const ok = st.drawHold(ctx, n.lane, 0, headY, tailY, 1, 1);
      ctx.restore();
      if (ok) {
        const hw = (st.atlasOf("holdNote")?.img.width / 8) * st.fetchHoldNoteScale();
        hits.push({ x0: laneX(n.lane) + hOff[0] - hw / 2, y0: Math.min(headY, tailY), x1: laneX(n.lane) + hOff[0] + hw / 2, y1: Math.max(headY, tailY), group: "holdNote", key: "", lane: n.lane });
      }
    }
    // 受け皿: 直近に打ったノーツ・押さえているホールドで Confirm にする
    for (let l = 0; l < 4; l++) {
      let mode = "Static",
        age = 0;
      for (const n of list) {
        if (n.lane !== l || n.t > T) continue;
        if (n.len && T <= n.t + n.len) {
          mode = "ConfirmHold";
          age = (T - n.t) / 1000;
        } else if (T - (n.t + n.len) < 180 && mode === "Static") {
          mode = "Confirm";
          age = (T - (n.t + n.len)) / 1000;
        }
      }
      const sd = st.strumData(DIRS[l], mode) ?? st.strumData(DIRS[l], "Confirm");
      const tag = { group: "noteStrumline", key: DIRS[l] + mode, lane: l };
      const fr = sa && sd ? frameAt(st.framesOf("noteStrumline", sd.prefix), mode === "Static" ? 0 : age, mode === "ConfirmHold") : null;
      if (!fr) missBox(laneX(l), sy, DIRS[l] + mode, tag);
      else {
        const eo = sd.offsets ?? [0, 0];
        blit(sa, fr, laneX(l) + sOff[0] + eo[0], sy + sOff[1] + eo[1], sSc, sa.def?.isPixel, tag);
      }
    }
    // ノーツの頭（打つ前のものだけ。判定の時刻で消える）
    for (const n of list) {
      if (n.t < T) continue;
      const y = sy + dir * (n.t - T) * k;
      const nd = st.noteData(DIRS[n.lane]),
        tag = { group: "note", key: DIRS[n.lane], lane: n.lane };
      const fr = na && nd ? st.framesOf("note", nd.prefix)?.[0] : null;
      if (!fr) continue;
      const eo = nd.offsets ?? [0, 0];
      blit(na, fr, laneX(n.lane) + nOff[0] + eo[0], y + nOff[1] + eo[1], nSc, na.def?.isPixel, tag);
    }
    // スプラッシュ・ホールドカバー
    const sp = st.asset("noteSplash"),
      hc = st.asset("holdNoteCover");
    for (const n of list) {
      const hitT = n.t;
      if (sp && sp.data?.enabled !== false && !n.len && T >= hitT && T - hitT < 600) {
        const l = sp.data?.[DIRS[n.lane] + "Splashes"] ?? [];
        const e = l[n.i % Math.max(1, l.length)];
        const spa = st.atlasOf("noteSplash");
        const fr = spa && e ? frameAt(st.framesOf("noteSplash", e.prefix), (T - hitT) / 1000, false) : null;
        const frames = e ? st.framesOf("noteSplash", e.prefix) : [];
        if (fr && (T - hitT) / 1000 * FPS < frames.length) {
          ctx.save();
          ctx.globalAlpha = sp.alpha ?? 1;
          blit(spa, fr, laneX(n.lane) + (sp.offsets?.[0] ?? 0) + (e.offsets?.[0] ?? 0), sy + (sp.offsets?.[1] ?? 0) + (e.offsets?.[1] ?? 0), sp.scale ?? 1, spa.def?.isPixel, { group: "noteSplash", key: `${DIRS[n.lane]}#0`, lane: n.lane });
          ctx.restore();
        }
      }
      if (hc && hc.data?.enabled !== false && n.len && T >= hitT && T <= hitT + n.len + 300) {
        const lane = hc.data?.[DIRS[n.lane]];
        const part = T < hitT + 150 ? "start" : T <= hitT + n.len ? "hold" : "end";
        const pt = (part === "start" ? T - hitT : part === "hold" ? T - hitT - 150 : T - hitT - n.len) / 1000;
        const a = lane?.assetPath ? set.atlas(lane.assetPath, set.origins.get(docId) ?? "") : null;
        const fr = a?.sprites && lane?.[part] ? frameAt(framesByPrefix(a.sprites, lane[part].prefix), pt, part === "hold") : null;
        if (fr) blit({ img: a.img }, fr, laneX(n.lane) + (hc.offsets?.[0] ?? 0) + (lane[part].offsets?.[0] ?? 0), sy + (hc.offsets?.[1] ?? 0) + (lane[part].offsets?.[1] ?? 0), hc.scale ?? 1, false, { group: "holdNoteCover", key: `${DIRS[n.lane]}.${part}`, lane: n.lane });
      }
    }
    ctx.restore();
    $("nteReadout").textContent = `${doc.name ?? docId}　速度 ${sc.speed}（${(k * 1000).toFixed(0)}px/秒）　${sc.down ? "ダウン" : "アップ"}スクロール　${selGroup}${selEntry ? " / " + selEntry : ""}`;
  }
  let drawQueued = false;
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => {
      drawQueued = false;
      draw();
    });
  }
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  state.addDisposer(() => ro.disconnect());
  // アニメ再生: 24fps で描く（表示中だけ）
  let raf = 0,
    lastTick = 0;
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    if (!state.active || !$("ntePlay").checked) return;
    // 再生中は 24fps（スクロールテストはなめらかさが見たいので、画面更新ごと）
    if (view === "scroll") {
      draw();
      return;
    }
    if (now - lastTick >= 1000 / FPS - 2) {
      lastTick = now;
      draw();
    }
  };
  raf = requestAnimationFrame(tick);
  state.addDisposer(() => cancelAnimationFrame(raf));
  $("ntePlay").onchange = () => {
    t0 = performance.now();
    if ($("ntePlay").checked) {
      clockStart = performance.now();
      clockPlaying = true;
    } else {
      clockBase = songMs();
      clockPlaying = false;
    }
    draw();
  };
  $("nteGuide").onchange = () => draw();

  // ---------- ドラッグ（offsets を動かす） ----------
  let drag = null;
  const worldOf = (e) => {
    const r = canvas.getBoundingClientRect();
    return vp.toWorld(e.clientX - r.left, e.clientY - r.top);
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (vp.panning || e.button !== 0) return;
    const p = worldOf(e);
    const hit = [...hits].reverse().find((h) => p.x >= h.x0 && p.x <= h.x1 && p.y >= h.y0 && p.y <= h.y1);
    if (!hit) return;
    selGroup = hit.group;
    selEntry = hit.key;
    const perEntry = $("nteDragEntry").checked && hit.key;
    const target = perEntry ? entry(hit.group, hit.key, true) : A(hit.group, true);
    drag = { id: e.pointerId, start: p, orig: [...(target.offsets ?? [0, 0])], perEntry, hit, moved: false };
    canvas.setPointerCapture(e.pointerId);
    syncPanels();
    requestDraw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const p = worldOf(e);
    let dx = p.x - drag.start.x,
      dy = p.y - drag.start.y;
    if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
    const q = e.altKey ? (v) => Math.round(v * 1000) / 1000 : Math.round;
    const target = drag.perEntry ? entry(drag.hit.group, drag.hit.key, true) : A(drag.hit.group, true);
    target.offsets = [q(drag.orig[0] + dx), q(drag.orig[1] + dy)];
    drag.moved = true;
    syncOffsetFields();
    syncAlign?.();
    requestDraw();
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const moved = drag.moved;
    drag = null;
    if (moved) commit();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  // ---------- パネル ----------
  const num = (v, fb) => (v === "" || !Number.isFinite(Number(v)) ? fb : Number(v));
  function activeOffsets() {
    const a = A(selGroup);
    return a?.offsets ?? [0, 0];
  }
  function syncOffsetFields() {
    const o = $("nteDragEntry").checked && selEntry ? (entry(selGroup, selEntry)?.offsets ?? [0, 0]) : activeOffsets();
    $("nteOffX").value = o[0];
    $("nteOffY").value = o[1];
    const eo = entry(selGroup, selEntry)?.offsets ?? [0, 0];
    $("nteEntryOffX").value = eo[0];
    $("nteEntryOffY").value = eo[1];
  }
  function frameInfo() {
    const st = style();
    const e = entry(selGroup, selEntry);
    if (!st || !e || !selEntry) return "";
    let a = null;
    if (selGroup === "holdNoteCover") {
      const lp = A("holdNoteCover")?.data?.[selEntry.split(".")[0]]?.assetPath;
      a = lp ? set.atlas(lp, set.origins.get(docId) ?? "") : null;
    } else a = st.atlasOf(selGroup);
    if (!a) return "⚠ 画像がまだありません（assetPath を確認してください）";
    if (!a.sprites) return "⚠ この画像の XML がありません";
    const n = framesByPrefix(a.sprites, e.prefix ?? "").length;
    return n ? `✓ このプレフィックスで ${n} フレーム` : "⚠ このプレフィックスのフレームがありません";
  }
  function syncPanels() {
    $("nteName").value = doc.name ?? "";
    $("nteAuthor").value = doc.author ?? "";
    $("nteFallback").value = doc.fallback ?? "";
    $("nteIds").innerHTML = ws().files.filter((f) => /\.json$/i.test(f.name) && /notestyles/i.test(relOf(f))).map((f) => `<option value="${baseName(f.name)}">`).join("");
    $("nteGroup").value = selGroup;
    const a = A(selGroup);
    const st = style();
    const eff = st?.asset(selGroup);
    $("nteAssetPath").value = a?.assetPath ?? "";
    $("nteAssetPath").placeholder = eff?.assetPath ? `(fallback: ${eff.assetPath})` : "notes/corrupt/corrupt_note";
    $("nteScale").value = a?.scale ?? "";
    $("nteScale").placeholder = eff?.scale ?? "1";
    $("nteAlpha").value = a?.alpha ?? "";
    $("nteIsPixel").checked = !!a?.isPixel;
    syncOffsetFields();
    $("nteGroupInfo").textContent = a ? "" : `このスタイルには ${selGroup} がありません（fallback の物を使います）。値を入れるとここに作られます。`;
    // アニメの一覧
    const keys = entryKeys(selGroup);
    $("nteEntry").textContent = "";
    for (const k of keys) $("nteEntry").append(new Option(k + (entry(selGroup, k) ? "" : "（未設定）"), k));
    if (!keys.includes(selEntry)) selEntry = keys[0] ?? "";
    $("nteEntry").value = selEntry;
    $("nteEntry").disabled = !keys.length;
    const e = entry(selGroup, selEntry);
    $("nteEntryPrefix").value = e?.prefix ?? "";
    $("nteEntryPrefix").disabled = !keys.length;
    $("nteFrameInfo").textContent = frameInfo();
    syncOffsetFields();
    renderSpecial();
    syncAlign?.();
  }
  function renderSpecial() {
    const box = $("nteSpecial");
    const a = A(selGroup);
    box.textContent = "";
    if (selGroup === "noteSplash" || selGroup === "holdNoteCover") {
      const lab = document.createElement("label");
      lab.className = "hudCheck";
      lab.innerHTML = `<input type="checkbox" id="nteEnabled" /> enabled（${selGroup === "noteSplash" ? "スプラッシュを出す" : "カバーを出す"}）`;
      box.append(lab);
      $("nteEnabled").checked = a?.data?.enabled !== false && !!a;
      $("nteEnabled").onchange = () => {
        A(selGroup, true).data.enabled = $("nteEnabled").checked;
        commit();
      };
    }
    if (selGroup === "holdNoteCover") {
      for (const d of DIRS) {
        const l = document.createElement("label");
        l.innerHTML = `${d} の assetPath<input type="text" data-cover="${d}" />`;
        l.querySelector("input").value = a?.data?.[d]?.assetPath ?? "";
        box.append(l);
      }
      box.onchange = (ev) => {
        const d = ev.target?.dataset?.cover;
        if (!d) return;
        (A("holdNoteCover", true).data[d] ??= {}).assetPath = ev.target.value.trim();
        commit();
        loaded.clear();
        loadAssets();
      };
    } else box.onchange = null;
    if (selGroup === "holdNote") {
      const p = document.createElement("p");
      p.className = "tiny";
      p.textContent = "ホールドの画像は 8 列の 1 枚絵（左から 4 列が胴体、右の 4 列が終端）です。assetPath・scale・offsets を設定します。";
      box.append(p);
    }
  }

  // 入力 → doc
  const onChange = (id, fn) => ($(id).onchange = () => (fn(), commit()));
  onChange("nteName", () => (doc.name = $("nteName").value));
  onChange("nteAuthor", () => (doc.author = $("nteAuthor").value));
  $("nteFallback").onchange = async () => {
    doc.fallback = $("nteFallback").value.trim() || null;
    for (const k of [...set.raw.keys()]) if (k !== docId) set.raw.delete(k);
    commit();
    await loadAssets();
  };
  $("nteGroup").onchange = () => {
    selGroup = $("nteGroup").value;
    selEntry = "";
    syncPanels();
    requestDraw();
  };
  $("nteAssetPath").onchange = async () => {
    A(selGroup, true).assetPath = $("nteAssetPath").value.trim();
    commit();
    loaded.clear();
    await loadAssets();
  };
  const setOptNum = (key, id, def) => () => {
    const v = $(id).value;
    const a = A(selGroup, true);
    if (v === "" || (def !== undefined && Number(v) === def && !(key in a))) delete a[key];
    else a[key] = num(v, def);
  };
  onChange("nteScale", setOptNum("scale", "nteScale"));
  onChange("nteAlpha", setOptNum("alpha", "nteAlpha", 1));
  onChange("nteIsPixel", () => {
    const a = A(selGroup, true);
    if ($("nteIsPixel").checked) a.isPixel = true;
    else delete a.isPixel;
  });
  const offChange = () => {
    const target = $("nteDragEntry").checked && selEntry ? entry(selGroup, selEntry, true) : A(selGroup, true);
    target.offsets = [num($("nteOffX").value, 0), num($("nteOffY").value, 0)];
  };
  onChange("nteOffX", offChange);
  onChange("nteOffY", offChange);
  $("nteOffZero").onclick = () => {
    $("nteOffX").value = 0;
    $("nteOffY").value = 0;
    offChange();
    commit();
  };
  $("nteDragEntry").onchange = () => syncOffsetFields();
  $("nteEntry").onchange = () => {
    selEntry = $("nteEntry").value;
    syncPanels();
    requestDraw();
  };
  onChange("nteEntryPrefix", () => (entry(selGroup, selEntry, true).prefix = $("nteEntryPrefix").value));
  const entryOff = () => (entry(selGroup, selEntry, true).offsets = [num($("nteEntryOffX").value, 0), num($("nteEntryOffY").value, 0)]);
  onChange("nteEntryOffX", entryOff);
  onChange("nteEntryOffY", entryOff);

  // ---- 判定・スクロールパネル ----
  const readScroll = () => {
    sc.speed = Math.min(12, Math.max(0.1, num($("nteSpeed").value, 2)));
    sc.bpm = Math.min(300, Math.max(30, num($("nteBpm").value, 120)));
    sc.down = $("nteDown").checked;
    sc.windows = $("nteWindows").checked;
    sc.win = [["Sick", "nteWSick", "#4cd964"], ["Good", "nteWGood", "#5ac8fa"], ["Bad", "nteWBad", "#ffcc00"], ["Shit", "nteWShit", "#ff6b6b"]].map(([n, id, c]) => [n, Math.max(1, num($(id).value, 1)), c]);
    $("nteSpeedRange").value = sc.speed;
    requestDraw();
  };
  for (const id of ["nteSpeed", "nteBpm", "nteDown", "nteWindows", "nteWSick", "nteWGood", "nteWBad", "nteWShit"]) $(id).oninput = $(id).onchange = readScroll;
  $("nteSpeedRange").oninput = () => {
    $("nteSpeed").value = $("nteSpeedRange").value;
    readScroll();
  };
  $("nteView").onchange = () => {
    view = $("nteView").value;
    fit();
    draw();
  };
  /** ノーツと受け皿の絵のずれ（offsets の差）。判定の瞬間の見た目の重なりの目安 */
  function alignInfo() {
    const st = style();
    if (!st) return "";
    const sg = st.asset("noteStrumline")?.offsets ?? [0, 0],
      ng = st.asset("note")?.offsets ?? [0, 0];
    const rows = DIRS.map((d) => {
      const se = st.strumData(d, "Confirm")?.offsets ?? [0, 0],
        ne = st.noteData(d)?.offsets ?? [0, 0];
      return `${d}: ノーツ − 受け皿 = (${ng[0] + ne[0] - sg[0] - se[0]}, ${ng[1] + ne[1] - sg[1] - se[1]}) px`;
    });
    return "判定の瞬間の、ノーツと受け皿（Confirm）の位置のずれ（0,0 なら中心が揃う）\n" + rows.join("\n");
  }
  $("nteAlign").style.whiteSpace = "pre-line";
  const syncAlign = () => ($("nteAlign").textContent = alignInfo());
  rebuild();
  syncPanels();
  loadedOnce = true;
  fit();
  return {
    onShow() {
      resize();
      syncHud();
      syncPanels();
    },
    onHide() {},
    undo,
    redo,
  };
}
