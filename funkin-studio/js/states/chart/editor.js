/* ============================================================
   chart/editor.js — Chart Editor（V-Slice の chart.json / metadata.json 編集）のロジック
   ------------------------------------------------------------
   できること:
     ・chart.json / metadata.json / .fnfc（zip）/ 音声の読み込み（複数選択・あとから追加も可）と書き出し
     ・Inst / Voices（複数）の再生・波形表示・音量/ミュート・再生速度・ヒット音
     ・ノーツの配置・削除・移動・ホールド長・種類(kind)/params、範囲選択、コピー/切り取り/貼り付け、ミラー/反転、重なり除去
     ・イベント（組み込み7種 + カスタム名）の配置・編集（スキーマからフォームを自動生成）
     ・BPM・拍子の変更（timeChanges）、バリエーション・難易度の追加/複製/削除、scrollSpeed・ratings
     ・metadata の全項目（キャラ・ステージ・noteStyle・オフセット・プレビュー区間など）
     ・Undo / Redo（JSON のスナップショット）
   座標: 縦=時間（下へ進む）。列は左から 相手(4) / プレイヤー(4) / イベント(1)。1マス = 1 step（16分）。

   目次: 1.状態 2.データ参照 3.履歴 4.音声と読み込み 5.描画 6.操作(ポインタ) 7.パネル 8.保存 9.再生・キーボード
   ============================================================ */
import { exportMod } from "../../services/ModExport.js";
import { isTextEntry } from "../../ui/Viewport.js";
import { HudPanels } from "../../ui/HudPanels.js";
import {
  DEFAULT_VARIATION, SNAP_QUANTS, BASE_QUANT_INDEX, STRUMLINE_SIZE, STEPS_PER_BEAT, DIR_NAMES, EVENT_SCHEMAS, eventKinds, isCustomEvent, registerEventSchema, unregisterEventSchema, eventTitle, defaultEventValue,
  defaultMetadata, defaultChart, normalizeMetadata, normalizeChart, serializeMetadata, serializeChart, Timing, clone, round3,
} from "./chartData.js";
import { AudioEngine, PEAK_MS } from "./audio.js";
import { readZip, writeZip } from "./zip.js";
import { parseHxc } from "./scriptEvents.js";
import { createPlayTest } from "./playtest.js";
import { NoteStyleSet } from "../../runtime/noteStyle.js";

const GRID = 40; // 1マスの基準ピクセル（V-Slice の GRID_SIZE）
const COLS = STRUMLINE_SIZE * 2 + 1; // 相手4 + プレイヤー4 + イベント1
const EVENT_COL = COLS - 1;
const NOTE_COLORS = ["#c24b99", "#00ffff", "#12fa05", "#f9393f"]; // Left / Down / Up / Right
const SEL_COLOR = "#ffb020";
const AUDIO_RE = /\.(ogg|mp3|wav|flac|m4a|aac)$/i;

/** d（0-3 プレイヤー / 4-7 相手）⇄ 列（0-3 相手 / 4-7 プレイヤー）。V-Slice の noteDataToGridColumn と同じ */
const dataToCol = (d) => (d >= STRUMLINE_SIZE ? d - STRUMLINE_SIZE : d + STRUMLINE_SIZE);
const colToData = dataToCol; // 対称
const isEvent = (o) => o && typeof o.e === "string";

export function mountChartEditor(state) {
  // ============================================================
  // 1. 状態
  // ============================================================
  const $ = (id) => document.getElementById(id),
    canvas = $("chtCanvas"),
    ctx = canvas.getContext("2d");
  const panels = new HudPanels(state.root, {
    storageKey: "chart",
    defaults: ["files", "edit", "transport"],
    narrowDefaults: ["transport"],
    narrowExclusive: ["files", "song", "diff", "timing", "edit", "audio"],
  });

  let songId = "";
  let variations = { [DEFAULT_VARIATION]: { meta: defaultMetadata(), chart: defaultChart() } };
  let curVar = DEFAULT_VARIATION,
    curDiff = "normal";
  let timing = new Timing(variations[DEFAULT_VARIATION].meta.timeChanges);

  const audio = new AudioEngine();
  let sel = new Set(); // 選択中のノーツ / イベント（オブジェクトそのもの）
  let clipboard = null;
  let tool = "place"; // place / select / pan
  let snapIdx = BASE_QUANT_INDEX;
  let zoom = 1; // 1 = 40px/マス
  let posMs = 0;
  let dirty = true;
  let hover = null; // { col, step }
  let drag = null;
  let hitSound = false;

  let toastTimer = null;
  const say = (s) => {
    $("chtStatus").textContent = s;
    const t = $("chtToast");
    t.textContent = s;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 4500);
  };
  state.addDisposer(() => clearTimeout(toastTimer));
  const markDirty = () => state.app.unsaved?.mark();
  const redraw = () => (dirty = true);

  // ============================================================
  // 2. データ参照
  // ============================================================
  const curData = () => variations[curVar] ?? variations[DEFAULT_VARIATION];
  const meta = () => curData().meta;
  const chart = () => curData().chart;
  const notes = () => (chart().notes[curDiff] ??= []);
  const events = () => chart().events;
  const snapQuant = () => SNAP_QUANTS[snapIdx];
  const snapSteps = () => 16 / snapQuant() / (16 / 16) * (STEPS_PER_BEAT / 4) ; // 16分=1step。quant 4 = 4step、32 = 0.5step
  const cell = () => GRID * zoom;
  const difficulties = () => meta().playData.difficulties;
  const songLengthMs = () => {
    let end = audio.durationMs;
    for (const n of notes()) end = Math.max(end, n.t + (n.l || 0) + 2000);
    for (const e of events()) end = Math.max(end, e.t + 2000);
    return Math.max(end, 10000);
  };
  const retiming = () => {
    timing = new Timing(meta().timeChanges);
    redraw();
  };
  const sortNotes = () => notes().sort((a, b) => a.t - b.t || a.d - b.d);
  const sortEvents = () => events().sort((a, b) => a.t - b.t);
  const stepOf = (ms) => timing.msToStep(ms);
  const msOf = (step) => round3(timing.stepToMs(step));

  // ============================================================
  // 3. 履歴（Undo / Redo）
  // ============================================================
  let history = [],
    hi = -1;
  const snapshot = () => JSON.stringify({ variations, curVar, curDiff, songId });
  function resetHistory() {
    history = [snapshot()];
    hi = 0;
    syncHud();
  }
  function commit() {
    const s = snapshot();
    if (s === history[hi]) return;
    history.length = hi + 1;
    history.push(s);
    hi++;
    if (history.length > 60) (history.shift(), hi--);
    markDirty();
    syncHud();
  }
  function restoreAt(i) {
    blurFocus();
    hi = i;
    const d = JSON.parse(history[hi]);
    variations = d.variations;
    songId = d.songId;
    curVar = variations[d.curVar] ? d.curVar : DEFAULT_VARIATION;
    curDiff = difficulties().includes(d.curDiff) ? d.curDiff : difficulties()[0];
    sel.clear();
    retiming();
    refreshAll();
    updateActiveTracks();
    markDirty();
    syncHud();
  }
  const undo = () => hi > 0 && restoreAt(hi - 1);
  const redo = () => hi < history.length - 1 && restoreAt(hi + 1);
  function syncHud() {
    if (state.active) state.app.hud.setHistory(hi > 0, hi < history.length - 1);
  }
  function blurFocus() {
    const a = document.activeElement;
    if (a && a !== document.body && state.root.contains(a)) a.blur();
  }

  // ============================================================
  // 4. 音声と読み込み
  // ============================================================
  const baseName = (n) => n.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const lc = (s) => String(s ?? "").toLowerCase();

  /** いまのバリエーションで鳴らすトラックを決める（Inst-<id> / Voices-<char>[-<variation>] の名前の約束） */
  function updateActiveTracks() {
    const instId = meta().playData.characters.instrumental || "";
    const expect = lc("inst" + (instId ? "-" + instId : ""));
    const insts = audio.tracks.filter((t) => t.kind === "inst");
    const hasExpected = insts.some((t) => lc(t.id) === expect);
    const others = Object.keys(variations).filter((v) => v !== DEFAULT_VARIATION);
    for (const t of audio.tracks) {
      const id = lc(t.id);
      if (t.kind === "inst") t.active = hasExpected ? id === expect : insts.length === 1 || id === "inst";
      else if (id.startsWith("voices-")) {
        const rest = id.slice(7);
        if (curVar !== DEFAULT_VARIATION) t.active = rest.endsWith("-" + lc(curVar));
        else t.active = !others.some((v) => rest.endsWith("-" + lc(v)));
      } else t.active = true;
    }
    renderTracks();
    redraw();
  }
  async function loadAudioBytes(name, bytes) {
    const id = baseName(name);
    const kind = /^inst/i.test(id) ? "inst" : "vocal";
    try {
      const tr = await audio.load(id, kind, name, bytes);
      tr.ext = (name.match(/\.[^.]+$/) || [".ogg"])[0].toLowerCase();
      return true;
    } catch (e) {
      say(`音声「${name}」を読み込めませんでした: ${e.message || e}`);
      return false;
    }
  }

  /** ファイル（chart / metadata / .fnfc / 音声）を種類ごとに仕分けして取り込む */
  async function ingest(files, { merge }) {
    const got = { metas: new Map(), charts: new Map(), audios: [], songId: "", warn: [] };
    const sortJson = (name, text) => {
      let j;
      try {
        j = JSON.parse(text.replace(/^﻿/, ""));
      } catch {
        got.warn.push(`${name}: JSON として読めません`);
        return;
      }
      if (/(^|[\\/])manifest\.json$/i.test(name)) {
        if (j.songId) got.songId = j.songId;
        return;
      }
      const m = name.replace(/^.*[\\/]/, "").match(/^(.*?)-(metadata|chart)(?:-(.+?))?\.json$/i);
      const v = m?.[3] || DEFAULT_VARIATION;
      if (m && !got.songId) got.songId = m[1];
      if (j.playData || (m && /metadata/i.test(m[2]))) got.metas.set(v, j);
      else if (j.notes || j.scrollSpeed || (m && /chart/i.test(m[2]))) got.charts.set(v, j);
      else if (j.songId && !got.songId) got.songId = j.songId; // manifest.json
      else got.warn.push(`${name}: chart でも metadata でもないので無視しました`);
    };
    for (const f of files) {
      const n = f.name;
      if (/\.(fnfc|zip)$/i.test(n)) {
        try {
          const entries = await readZip(await f.arrayBuffer());
          for (const [en, data] of entries) {
            if (/\.json$/i.test(en)) sortJson(en, new TextDecoder().decode(data));
            else if (AUDIO_RE.test(en)) got.audios.push({ name: en, bytes: data });
          }
        } catch (e) {
          got.warn.push(`${n}: ${e.message}`);
        }
      } else if (/\.json$/i.test(n)) sortJson(n, await f.text());
      else if (AUDIO_RE.test(n)) got.audios.push({ name: n, bytes: new Uint8Array(await f.arrayBuffer()) });
      else got.warn.push(`${n}: 対応していない種類のファイルです`);
    }
    if (!got.metas.size && !got.charts.size && !got.audios.length) {
      say(got.warn.join("\n") || "読み込めるファイルがありませんでした。");
      return;
    }
    if (!merge && (got.metas.size || got.charts.size)) {
      if (!state.app.unsaved.confirmReplace()) return;
      audio.clear();
      variations = {};
    }
    if (got.metas.size || got.charts.size) {
      const names = new Set([...got.metas.keys(), ...got.charts.keys()]);
      if (!names.has(DEFAULT_VARIATION) && !variations[DEFAULT_VARIATION]) names.add(DEFAULT_VARIATION);
      for (const v of names) {
        const m = got.metas.has(v) ? normalizeMetadata(got.metas.get(v)) : variations[v]?.meta ?? defaultMetadata(got.songId || "New Song");
        const c = normalizeChart(got.charts.get(v) ?? variations[v]?.chart ?? defaultChart(), m.playData.difficulties);
        // chart にしか無い難易度も一覧に入れる
        for (const df of Object.keys(c.notes)) if (!m.playData.difficulties.includes(df)) m.playData.difficulties.push(df);
        variations[v] = { meta: m, chart: c };
      }
      if (!merge) {
        const first = variations[DEFAULT_VARIATION] ?? Object.values(variations)[0];
        if (!variations[DEFAULT_VARIATION]) variations[DEFAULT_VARIATION] = first;
        songId = got.songId || songId || slug(first.meta.songName);
        curVar = DEFAULT_VARIATION;
        curDiff = difficulties().includes("normal") ? "normal" : difficulties()[0];
        posMs = 0;
        sel.clear();
      } else if (got.songId && !songId) songId = got.songId;
      // デフォルトの songVariations に、読み込んだバリエーションを反映
      const dv = variations[DEFAULT_VARIATION].meta.playData;
      for (const v of Object.keys(variations)) if (v !== DEFAULT_VARIATION && !dv.songVariations.includes(v)) dv.songVariations.push(v);
      retiming();
    }
    let loadedAudio = 0;
    for (const a of got.audios) if (await loadAudioBytes(a.name, a.bytes)) loadedAudio++;
    updateActiveTracks();
    resetHistory();
    refreshAll();
    if (!merge) state.app.unsaved?.clean();
    const parts = [];
    if (got.metas.size || got.charts.size) parts.push(`metadata ${got.metas.size} / chart ${got.charts.size}`);
    if (loadedAudio) parts.push(`音声 ${loadedAudio} 本`);
    const missing = [];
    for (const v of Object.keys(variations)) {
      if (!got.metas.has(v) && !merge && Object.keys(variations).length) missing.push(`${v}: metadata`);
      if (!got.charts.has(v) && !merge) missing.push(`${v}: chart`);
    }
    const unknownKinds = new Set();
    for (const v of Object.values(variations)) for (const ev of v.chart.events) if (!EVENT_SCHEMAS[ev.e]) unknownKinds.add(ev.e);
    if (unknownKinds.size) got.warn.push(`定義が未登録のイベント: ${[...unknownKinds].join(", ")}（ファイルタブの「イベントのスクリプト」で .hxc を読み込むと項目が出ます）`);
    say(`読み込みました（${parts.join("・")}）。${missing.length ? "\n見つからなかったので既定で補いました: " + missing.join(", ") : ""}${got.warn.length ? "\n" + got.warn.join("\n") : ""}`);
  }
  const slug = (s) => String(s || "song").trim().toLowerCase().replace(/[^\w\-]+/g, "-").replace(/^-+|-+$/g, "") || "song";

  // ============================================================
  // 5. 描画
  // ============================================================
  function resize() {
    const dpr = window.devicePixelRatio || 1,
      w = canvas.clientWidth,
      h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }
  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(canvas);
  state.addDisposer(() => resizeObserver.disconnect());

  const layout = () => {
    const ch = cell(),
      W = canvas.clientWidth,
      H = canvas.clientHeight;
    return { ch, W, H, left: Math.round((W - COLS * ch) / 2), playY: Math.round(H * 0.38) };
  };
  const stepToY = (step, L, curStep) => L.playY + (step - curStep) * L.ch;

  function draw() {
    const L = layout(),
      { ch, W, H, left, playY } = L;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#161a21"; // 背景はテーマに左右されない暗色（明るいテーマでも目が疲れないように）
    ctx.fillRect(0, 0, W, H);
    const curStep = stepOf(posMs);
    const s0 = Math.floor(curStep - playY / ch) - 1,
      s1 = Math.ceil(curStep + (H - playY) / ch) + 1;
    const gw = COLS * ch;

    // 列の背景（市松模様）
    for (let s = s0; s <= s1; s++) {
      if (s < 0) continue;
      const y = stepToY(s, L, curStep);
      for (let c = 0; c < COLS; c++) {
        const even = (s + c) % 2 === 0;
        ctx.fillStyle = c === EVENT_COL ? (even ? "#3a3326" : "#342e22") : c < STRUMLINE_SIZE ? (even ? "#2a2f3d" : "#252a37") : even ? "#2d3446" : "#283043";
        ctx.fillRect(left + c * ch, y, ch, ch);
      }
    }
    // 波形（チェックしたトラックを重ねる）
    drawWaveforms(L, curStep, gw);

    // 線: step（薄い）/ beat / 小節（太い + 番号）/ BPM 変更
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (let s = Math.max(0, s0); s <= s1; s++) {
      const y = Math.round(stepToY(s, L, curStep)) + 0.5;
      const m = timing.measureAtStep(s);
      const isMeasure = Math.abs(s - m.start) < 1e-6;
      const isBeat = Math.abs(((s - m.start) % STEPS_PER_BEAT) / STEPS_PER_BEAT - Math.round(((s - m.start) % STEPS_PER_BEAT) / STEPS_PER_BEAT)) < 1e-6 && (s - m.start) % STEPS_PER_BEAT === 0;
      ctx.strokeStyle = isMeasure ? "rgba(255,255,255,.7)" : isBeat ? "rgba(255,255,255,.3)" : "rgba(255,255,255,.1)";
      ctx.lineWidth = isMeasure ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + gw, y);
      ctx.stroke();
      if (isMeasure) {
        ctx.fillStyle = "rgba(255,255,255,.75)";
        ctx.textAlign = "right";
        ctx.fillText(String(m.number + measureOffsetOf(m)), left - 6, y + 10);
      }
    }
    // 列の区切り
    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 2;
    for (const c of [0, STRUMLINE_SIZE, EVENT_COL, COLS]) {
      ctx.beginPath();
      ctx.moveTo(left + c * ch + 0.5, 0);
      ctx.lineTo(left + c * ch + 0.5, H);
      ctx.stroke();
    }
    // BPM / 拍子の変更点
    ctx.textAlign = "left";
    meta().timeChanges.forEach((tc, i) => {
      const y = stepToY(timing.beatAtIndex(i) * STEPS_PER_BEAT, L, curStep);
      if (y < -20 || y > H + 20) return;
      ctx.fillStyle = "#ffd36b";
      ctx.fillRect(left + gw + 6, y - 1, 10, 2);
      ctx.fillText(`${tc.bpm} BPM ${tc.n}/${tc.d}`, left + gw + 20, y - 7);
    });
    // プレビュー区間
    const pd = meta().playData;
    for (const [ms, label] of [[pd.previewStart, "preview▶"], [pd.previewEnd <= 1 ? pd.previewEnd * songLengthMs() : pd.previewEnd, "preview■"]]) {
      if (!Number.isFinite(ms)) continue;
      const y = stepToY(stepOf(ms), L, curStep);
      if (y < 0 || y > H) continue;
      ctx.strokeStyle = "rgba(120,200,255,.8)";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left - 60, y);
      ctx.lineTo(left + gw, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(120,200,255,.9)";
      ctx.textAlign = "right";
      ctx.fillText(label, left - 36, y - 6);
    }
    // 曲の外（先頭より前）を暗く
    const y0 = stepToY(0, L, curStep);
    if (y0 > 0) {
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fillRect(left, 0, gw, Math.min(H, y0));
    }

    // イベント
    const playing = audio.playing;
    ctx.textAlign = "left";
    for (const e of events()) {
      const y = stepToY(stepOf(e.t), L, curStep);
      if (y < -ch || y > H + ch) continue;
      const x = left + EVENT_COL * ch,
        isSel = sel.has(e);
      ctx.globalAlpha = playing && e.t < posMs ? 0.45 : 1;
      ctx.fillStyle = "#ffb43a";
      ctx.beginPath();
      ctx.moveTo(x + ch / 2, y + ch * 0.08);
      ctx.lineTo(x + ch * 0.92, y + ch / 2);
      ctx.lineTo(x + ch / 2, y + ch * 0.92);
      ctx.lineTo(x + ch * 0.08, y + ch / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = isSel ? "#fff" : "rgba(0,0,0,.5)";
      ctx.lineWidth = isSel ? 3 : 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = isSel ? "#fff" : "#ffd9a0";
      ctx.fillText(eventTitle(e.e), x + ch + 6 + (BPM_LABEL_PAD), y + ch / 2);
    }
    // ノーツ
    for (const n of notes()) {
      const y = stepToY(stepOf(n.t), L, curStep);
      const yEnd = n.l > 0 ? stepToY(stepOf(n.t + n.l), L, curStep) : y;
      if (yEnd < -ch || y > H + ch) continue;
      drawNote(n, left + dataToCol(n.d) * ch, y, yEnd, ch, sel.has(n), playing && n.t < posMs);
    }
    // ホバー（置く位置の予告）
    if (hover && tool === "place" && !drag) {
      const x = left + hover.col * ch,
        y = stepToY(hover.step, L, curStep);
      ctx.fillStyle = "rgba(255,255,255,.18)";
      ctx.fillRect(x, y, ch, ch * Math.min(1, snapSteps()));
      ctx.strokeStyle = "rgba(255,255,255,.6)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, ch - 1, ch * Math.min(1, snapSteps()) - 1);
    }
    // 範囲選択の枠
    if (drag?.kind === "box") {
      ctx.strokeStyle = SEL_COLOR;
      ctx.fillStyle = "rgba(255,176,32,.15)";
      ctx.lineWidth = 1;
      const r = drag.rect;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    }
    // 列の見出し
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.textAlign = "center";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.fillText("Opponent", left + (STRUMLINE_SIZE * ch) / 2, HEAD_Y);
    ctx.fillText("Player", left + STRUMLINE_SIZE * ch * 1.5, HEAD_Y);
    ctx.fillText("Events", left + EVENT_COL * ch + ch / 2, HEAD_Y);
    // 再生位置（プレイヘッド）
    ctx.strokeStyle = "#ff5577";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left - 14, playY);
    ctx.lineTo(left + gw + 14, playY);
    ctx.stroke();
    ctx.fillStyle = "#ff5577";
    ctx.beginPath();
    ctx.moveTo(left - 16, playY - 7);
    ctx.lineTo(left - 2, playY);
    ctx.lineTo(left - 16, playY + 7);
    ctx.fill();
  }
  const BPM_LABEL_PAD = 0;
const HEAD_Y = 84; // 見出しの高さ（上の Hud バーの下）
  /** timeChanges の小節番号は「その変更点で 0 から数え直す」のではなく、通算で数える（V-Slice と同じ） */
  function measureOffsetOf(m) {
    let off = 0;
    for (let i = 0; i < m.index; i++) {
      const c = meta().timeChanges[i];
      const len = c.n * STEPS_PER_BEAT;
      const span = (timing.beatAtIndex(i + 1) - timing.beatAtIndex(i)) * STEPS_PER_BEAT;
      off += Math.round(span / len);
    }
    return off;
  }

  function drawNote(n, x, y, yEnd, ch, isSel, past) {
    const d = n.d % STRUMLINE_SIZE;
    const color = NOTE_COLORS[d] ?? "#aaa";
    ctx.globalAlpha = past ? 0.4 : 1;
    if (n.l > 0) {
      const bw = ch * 0.34;
      ctx.fillStyle = color;
      ctx.globalAlpha *= 0.75;
      ctx.fillRect(x + (ch - bw) / 2, y + ch / 2, bw, Math.max(0, yEnd - y));
      ctx.globalAlpha = past ? 0.4 : 1;
      ctx.fillRect(x + (ch - bw) / 2 - 2, yEnd + ch / 2 - 4, bw + 4, 6);
    }
    const pad = ch * 0.06;
    ctx.fillStyle = color;
    roundRect(x + pad, y + pad, ch - pad * 2, ch - pad * 2, ch * 0.18);
    ctx.fill();
    drawArrow(x + ch / 2, y + ch / 2, ch, d);
    ctx.strokeStyle = isSel ? "#fff" : "rgba(0,0,0,.55)";
    ctx.lineWidth = isSel ? 3 : 1.5;
    roundRect(x + pad, y + pad, ch - pad * 2, ch - pad * 2, ch * 0.18);
    ctx.stroke();
    if (n.k) {
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.max(9, ch * 0.28)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(n.k[0].toUpperCase(), x + ch * 0.82, y + ch * 0.2);
    }
    ctx.globalAlpha = 1;
  }
  /** 方向の矢印（d: 0=Left 1=Down 2=Up 3=Right） */
  function drawArrow(cx, cy, ch, d) {
    const ang = [Math.PI, Math.PI / 2, -Math.PI / 2, 0][d]; // 右向きを基準に回す
    const a = ch * 0.24;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.beginPath();
    ctx.moveTo(a * 1.1, 0);
    ctx.lineTo(-a * 0.2, -a);
    ctx.lineTo(-a * 0.2, -a * 0.38);
    ctx.lineTo(-a * 1.1, -a * 0.38);
    ctx.lineTo(-a * 1.1, a * 0.38);
    ctx.lineTo(-a * 0.2, a * 0.38);
    ctx.lineTo(-a * 0.2, a);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  const WAVE_COLORS = ["#6ec1ff", "#ff8fb1", "#9bff8f", "#ffd36b", "#c9a2ff", "#7fffe0"];
  function drawWaveforms(L, curStep, gw) {
    const list = audio.tracks.filter((t) => t.active !== false && t.wave);
    if (!list.length) return;
    const { H, left, playY } = L;
    const cx = left + gw / 2;
    list.forEach((t, ti) => {
      ctx.fillStyle = WAVE_COLORS[ti % WAVE_COLORS.length];
      ctx.globalAlpha = 0.32;
      for (let y = 0; y < H; y += 2) {
        const stepA = curStep + (y - playY) / L.ch,
          stepB = curStep + (y + 2 - playY) / L.ch;
        if (stepB < 0) continue;
        const a = (timing.stepToMs(Math.max(0, stepA)) - t.offset) / PEAK_MS,
          b = (timing.stepToMs(Math.max(0, stepB)) - t.offset) / PEAK_MS;
        if (b < 0 || a > t.peaks.length) continue;
        let m = 0;
        const i0 = Math.max(0, Math.floor(a)),
          i1 = Math.min(t.peaks.length - 1, Math.max(i0, Math.floor(b)));
        const stride = Math.max(1, Math.floor((i1 - i0) / 24));
        for (let i = i0; i <= i1; i += stride) if (t.peaks[i] > m) m = t.peaks[i];
        const w = Math.min(1, m * 1.4) * (gw / 2 - 2);
        ctx.fillRect(cx - w, y, w * 2, 2);
      }
    });
    ctx.globalAlpha = 1;
  }

  // 描画ループ（変化があったときと再生中だけ描く）
  let raf = 0,
    lastTickMs = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!state.active) return;
    if (audio.playing) {
      const p = audio.position();
      const end = songLengthMs();
      if (p >= end) {
        audio.pause();
        posMs = end;
        syncTransport();
      } else {
        if (hitSound) {
          for (const n of notes()) {
            if (n.t > p) break;
            if (n.t > lastTickMs) {
              audio.tick(n.d >= STRUMLINE_SIZE);
              break;
            }
          }
        }
        lastTickMs = p;
        posMs = p;
      }
      dirty = true;
      syncTransport();
    }
    if (dirty) {
      dirty = false;
      draw();
    }
  }
  raf = requestAnimationFrame(frame);
  state.addDisposer(() => cancelAnimationFrame(raf));

  // ============================================================
  // 6. 操作（ポインタ）
  // ============================================================
  /** 画面座標 → { col, stepF(連続値), step(スナップ後) } */
  function pointerInfo(ev) {
    const r = canvas.getBoundingClientRect(),
      x = ev.clientX - r.left,
      y = ev.clientY - r.top,
      L = layout(),
      curStep = stepOf(posMs);
    const col = Math.floor((x - L.left) / L.ch);
    const stepF = curStep + (y - L.playY) / L.ch;
    const sn = snapSteps();
    return { x, y, col, stepF, step: Math.floor(stepF / sn + 1e-9) * sn, inGrid: col >= 0 && col < COLS };
  }
  const colOfObj = (o) => (isEvent(o) ? EVENT_COL : dataToCol(o.d));
  function hitTest(col, stepF) {
    // 手前（後ろの要素）から探す
    const eps = 0.02;
    if (col === EVENT_COL) {
      for (let i = events().length - 1; i >= 0; i--) {
        const s = stepOf(events()[i].t);
        if (stepF >= s - eps && stepF < s + 1) return events()[i];
      }
      return null;
    }
    const list = notes();
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (dataToCol(n.d) !== col) continue;
      const s = stepOf(n.t),
        e = n.l > 0 ? stepOf(n.t + n.l) : s;
      if (stepF >= s - eps && (stepF < s + 1 || stepF <= e + 0.5)) return n;
    }
    return null;
  }
  const isEndHandle = (n, stepF) => !isEvent(n) && n.l > 0 && Math.abs(stepF - stepOf(n.t + n.l)) < 0.6;

  function setPos(ms, { seek = true } = {}) {
    posMs = Math.max(0, Math.min(songLengthMs(), ms));
    if (seek && audio.playing) (audio.seek(posMs), (lastTickMs = posMs));
    else if (seek) audio._startPos = posMs;
    syncTransport();
    redraw();
  }
  const scrollBySteps = (ds) => setPos(msOf(Math.max(0, stepOf(posMs) + ds)));

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
        return;
      }
      scrollBySteps((e.deltaY / cell()) * (e.shiftKey ? 4 : 1.2));
    },
    { passive: false },
  );
  function setZoom(z) {
    zoom = Math.max(0.3, Math.min(3, z));
    redraw();
  }

  let spaceDown = false;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.focus?.();
    blurFocus();
    const p = pointerInfo(e);
    const touch = e.pointerType === "touch";
    canvas.setPointerCapture?.(e.pointerId);
    // 右クリック: 削除
    if (e.button === 2) {
      const h = p.inGrid ? hitTest(p.col, p.stepF) : null;
      if (h) {
        sel = new Set([h]);
        deleteSelected();
      }
      return;
    }
    // スクロール（中ボタン・Space・移動ツール）
    if (e.button === 1 || spaceDown || tool === "pan") {
      drag = { kind: "scroll", y0: p.y, ms0: posMs, step0: stepOf(posMs) };
      return;
    }
    const hit = p.inGrid ? hitTest(p.col, p.stepF) : null;
    if (hit) {
      if (e.shiftKey || e.ctrlKey) {
        sel.has(hit) ? sel.delete(hit) : sel.add(hit);
        refreshEdit();
        redraw();
        return;
      }
      if (!sel.has(hit)) sel = new Set([hit]);
      if (sel.size === 1 && isEndHandle(hit, p.stepF)) {
        drag = { kind: "extend", note: hit, moved: false };
      } else {
        drag = { kind: "move", p0: p, base: [...sel].map((o) => ({ o, t: o.t, d: o.d })), moved: false, steps0: stepOf(hit.t), col0: colOfObj(hit), anchor: hit };
      }
      refreshEdit();
      redraw();
      return;
    }
    // 何もない所
    if (tool === "select" || !p.inGrid) {
      drag = { kind: "box", x0: p.x, y0: p.y, rect: { x: p.x, y: p.y, w: 0, h: 0 }, add: e.shiftKey || e.ctrlKey, touch };
      return;
    }
    if (touch) {
      // 指: タップなら置く / ドラッグならスクロール
      drag = { kind: "tap", p0: p, y0: p.y, ms0: posMs, scrolled: false };
      return;
    }
    placeAt(p);
  });
  function placeAt(p) {
    if (p.step < 0) return;
    if (p.col === EVENT_COL) {
      const kind = paletteKind();
      if (!kind) return;
      const ev = { t: msOf(p.step), e: kind, v: EVENT_SCHEMAS[kind] ? defaultEventValue(kind) : {} };
      events().push(ev);
      sortEvents();
      sel = new Set([ev]);
      drag = { kind: "placed" };
      commit();
    } else {
      const d = colToData(p.col);
      const t = msOf(p.step);
      const dup = notes().find((n) => n.d === d && Math.abs(n.t - t) < 0.5);
      if (dup) {
        sel = new Set([dup]);
        refreshEdit();
        redraw();
        return;
      }
      const n = { t, d };
      const k = $("chtPlaceKind").value.trim();
      if (k && k !== "normal") n.k = k;
      notes().push(n);
      sortNotes();
      sel = new Set([n]);
      drag = { kind: "hold", note: n, step0: p.step, moved: false };
    }
    refreshEdit();
    redraw();
  }
  canvas.addEventListener("pointermove", (e) => {
    const p = pointerInfo(e);
    if (!drag) {
      const prev = hover;
      hover = p.inGrid && p.step >= 0 ? { col: p.col, step: p.step } : null;
      if (JSON.stringify(prev) !== JSON.stringify(hover)) redraw();
      return;
    }
    if (drag.kind === "scroll") {
      setPos(msOf(Math.max(0, drag.step0 - (p.y - drag.y0) / cell())));
    } else if (drag.kind === "tap") {
      if (Math.abs(p.y - drag.y0) > 8) drag.scrolled = true;
      if (drag.scrolled) setPos(msOf(Math.max(0, stepOf(drag.ms0) - (p.y - drag.y0) / cell())));
    } else if (drag.kind === "box") {
      drag.rect = { x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) };
      redraw();
    } else if (drag.kind === "hold") {
      const len = Math.max(0, p.stepF - drag.step0);
      const sn = snapSteps();
      const snapped = Math.floor(len / sn) * sn;
      const end = msOf(drag.step0 + snapped);
      const l = snapped >= 1 - 1e-6 || snapped >= sn * 1 && snapped >= 0.99 ? round3(end - drag.note.t) : 0;
      if (l !== (drag.note.l || 0)) {
        if (l > 0) drag.note.l = l;
        else delete drag.note.l;
        drag.moved = true;
        refreshEdit();
        redraw();
      }
    } else if (drag.kind === "extend") {
      const sn = snapSteps();
      const end = msOf(Math.max(stepOf(drag.note.t), Math.round(p.stepF / sn) * sn));
      const l = round3(end - drag.note.t);
      if (l !== (drag.note.l || 0)) {
        if (l > 0) drag.note.l = l;
        else delete drag.note.l;
        drag.moved = true;
        refreshEdit();
        redraw();
      }
    } else if (drag.kind === "move") {
      const sn = snapSteps();
      const dStep = Math.round((p.stepF - drag.p0.stepF) / sn) * sn;
      let dCol = p.col - drag.p0.col;
      if (!drag.moved && dStep === 0 && dCol === 0) return;
      // 列は 0-7 の範囲に収める（イベントは列を動かさない）
      const cols = drag.base.filter((b) => !isEvent(b.o)).map((b) => dataToCol(b.d));
      if (cols.length) dCol = Math.max(-Math.min(...cols), Math.min(STRUMLINE_SIZE * 2 - 1 - Math.max(...cols), dCol));
      else dCol = 0;
      for (const b of drag.base) {
        const s = Math.max(0, stepOf(b.t) + dStep);
        b.o.t = msOf(s);
        if (!isEvent(b.o)) b.o.d = colToData(dataToCol(b.d) + dCol);
      }
      drag.moved = true;
      redraw();
    }
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === "box") {
      const r = d.rect;
      const L = layout(),
        curStep = stepOf(posMs);
      if (r.w < 4 && r.h < 4) {
        if (!d.add) sel = new Set();
      } else {
        const picked = new Set(d.add ? sel : []);
        const inRect = (x, y, w, h) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y;
        for (const n of notes()) {
          const y = stepToY(stepOf(n.t), L, curStep);
          if (inRect(L.left + dataToCol(n.d) * L.ch, y, L.ch, L.ch)) picked.add(n);
        }
        for (const ev of events()) {
          const y = stepToY(stepOf(ev.t), L, curStep);
          if (inRect(L.left + EVENT_COL * L.ch, y, L.ch, L.ch)) picked.add(ev);
        }
        sel = picked;
      }
      refreshEdit();
      redraw();
    } else if (d.kind === "tap") {
      if (!d.scrolled) placeAt(d.p0);
    } else if (d.kind === "hold" || d.kind === "extend" || d.kind === "move") {
      if (d.kind === "move" && d.moved) {
        sortNotes();
        sortEvents();
        removeStacked(true);
      }
      commit();
      refreshEdit();
      redraw();
    } else if (d.kind === "placed") {
      commit();
    }
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => {
    if (!drag && hover) ((hover = null), redraw());
  });

  // ---- 編集操作 ----
  function deleteSelected() {
    if (!sel.size) return;
    chart().events = events().filter((e) => !sel.has(e));
    chart().notes[curDiff] = notes().filter((n) => !sel.has(n));
    sel.clear();
    commit();
    refreshEdit();
    redraw();
  }
  function removeStacked(silent = false) {
    const seen = new Map();
    let removed = 0;
    const keep = [];
    for (const n of notes()) {
      const k = `${n.d}|${Math.round(n.t * 100)}`;
      if (seen.has(k)) {
        removed++;
        sel.delete(n);
        continue;
      }
      seen.set(k, n);
      keep.push(n);
    }
    if (removed) {
      chart().notes[curDiff] = keep;
      if (!silent) (commit(), refreshEdit(), redraw(), say(`重なったノーツを ${removed} 個消しました。`));
    } else if (!silent) say("重なったノーツはありません。");
  }
  function copySel(cut) {
    if (!sel.size) return;
    const items = [...sel];
    const first = Math.min(...items.map((o) => stepOf(o.t)));
    clipboard = items.map((o) => ({ o: clone(o), ds: stepOf(o.t) - first }));
    say(`${items.length} 個をコピーしました。`);
    if (cut) deleteSelected();
  }
  function pasteAtHead() {
    if (!clipboard?.length) return say("クリップボードが空です。");
    const base = Math.max(0, Math.floor(stepOf(posMs) / snapSteps() + 1e-9) * snapSteps());
    const added = new Set();
    for (const { o, ds } of clipboard) {
      const c = clone(o);
      c.t = msOf(base + ds);
      if (isEvent(c)) events().push(c);
      else notes().push(c);
      added.add(c);
    }
    sortNotes();
    sortEvents();
    sel = added;
    removeStacked(true);
    commit();
    refreshEdit();
    redraw();
  }
  function mirrorSel(flip) {
    let n = 0;
    for (const o of sel) {
      if (isEvent(o)) continue;
      o.d = flip ? (o.d + STRUMLINE_SIZE) % (STRUMLINE_SIZE * 2) : o.d - (o.d % STRUMLINE_SIZE) + (STRUMLINE_SIZE - 1 - (o.d % STRUMLINE_SIZE));
      n++;
    }
    if (n) (sortNotes(), commit(), refreshEdit(), redraw());
  }
  function selectAll() {
    sel = new Set([...notes(), ...events()]);
    refreshEdit();
    redraw();
  }
  $("chtDel").onclick = deleteSelected;
  $("chtCopy").onclick = () => copySel(false);
  $("chtCut").onclick = () => copySel(true);
  $("chtPaste").onclick = pasteAtHead;
  $("chtSelAll").onclick = selectAll;
  $("chtMirror").onclick = () => mirrorSel(false);
  $("chtFlip").onclick = () => mirrorSel(true);
  $("chtUnstack").onclick = () => removeStacked(false);

  // ツール・ズーム・スナップ
  function setTool(t) {
    tool = t;
    for (const [id, name] of [["chtToolPlace", "place"], ["chtToolSelect", "select"], ["chtToolPan", "pan"]]) $(id).setAttribute("aria-pressed", String(tool === name));
    canvas.style.cursor = tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair";
  }
  $("chtToolPlace").onclick = () => setTool("place");
  $("chtToolSelect").onclick = () => setTool("select");
  $("chtToolPan").onclick = () => setTool("pan");
  $("chtZoomIn").onclick = () => setZoom(zoom * 1.2);
  $("chtZoomOut").onclick = () => setZoom(zoom / 1.2);
  const snapSel = $("chtSnap");
  SNAP_QUANTS.forEach((q, i) => snapSel.append(new Option(`1/${q}`, i)));
  snapSel.value = snapIdx;
  snapSel.onchange = () => setSnap(Number(snapSel.value));
  function setSnap(i) {
    snapIdx = Math.max(0, Math.min(SNAP_QUANTS.length - 1, i));
    snapSel.value = snapIdx;
    redraw();
  }

  // ============================================================
  // 7. パネル
  // ============================================================
  const setVal = (el, v) => {
    if (document.activeElement === el) return;
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v ?? "";
  };
  const csv = (s) => String(s).split(",").map((x) => x.trim()).filter(Boolean);
  const num = (s, d = 0) => (Number.isFinite(Number(s)) && String(s).trim() !== "" ? Number(s) : d);

  // ---- 曲情報（metadata） ----
  // [要素ID, 読む, 書く]
  const metaBinds = [
    ["chtSongName", (m) => m.songName, (m, v) => (m.songName = v)],
    ["chtArtist", (m) => m.artist, (m, v) => (m.artist = v)],
    ["chtCharter", (m) => m.charter ?? "", (m, v) => (m.charter = v)],
    ["chtStage", (m) => m.playData.stage, (m, v) => (m.playData.stage = v)],
    ["chtNoteStyle", (m) => m.playData.noteStyle, (m, v) => (m.playData.noteStyle = v)],
    ["chtCharPlayer", (m) => m.playData.characters.player, (m, v) => (m.playData.characters.player = v)],
    ["chtCharGf", (m) => m.playData.characters.girlfriend, (m, v) => (m.playData.characters.girlfriend = v)],
    ["chtCharOpp", (m) => m.playData.characters.opponent, (m, v) => (m.playData.characters.opponent = v)],
    ["chtCharInst", (m) => m.playData.characters.instrumental ?? "", (m, v) => { m.playData.characters.instrumental = v; updateActiveTracks(); }],
    ["chtCharAltInst", (m) => (m.playData.characters.altInstrumentals ?? []).join(", "), (m, v) => setList(m.playData.characters, "altInstrumentals", csv(v), true)],
    ["chtCharPVoc", (m) => (m.playData.characters.playerVocals ?? []).join(", "), (m, v) => setList(m.playData.characters, "playerVocals", csv(v), false)],
    ["chtCharOVoc", (m) => (m.playData.characters.opponentVocals ?? []).join(", "), (m, v) => setList(m.playData.characters, "opponentVocals", csv(v), false)],
    ["chtAlbum", (m) => m.playData.album ?? "", (m, v) => (m.playData.album = v)],
    ["chtSticker", (m) => m.playData.stickerPack ?? "", (m, v) => (m.playData.stickerPack = v)],
    ["chtPrevStart", (m) => m.playData.previewStart, (m, v) => (m.playData.previewStart = num(v))],
    ["chtPrevEnd", (m) => m.playData.previewEnd, (m, v) => (m.playData.previewEnd = num(v))],
    ["chtDiscord", (m) => m.playData.discordRPCImage ?? "", (m, v) => (m.playData.discordRPCImage = v)],
    ["chtLooped", (m) => m.looped, (m, v) => (m.looped = !!v)],
    ["chtDivisions", (m) => m.divisions, (m, v) => (m.divisions = num(v, 96))],
    ["chtOffInst", (m) => m.offsets.instrumental ?? 0, (m, v) => { m.offsets.instrumental = num(v); applyOffsets(); }],
    ["chtOffVoc", (m) => firstVocalOffset(m), (m, v) => { setAllVocalOffsets(m, num(v)); applyOffsets(); }],
  ];
  /** 空の配列は欄ごと消す（V-Slice は無い=既定に任せる）。alt は空配列でもよいが、消して問題ない */
  function setList(obj, key, arr, keepEmpty) {
    if (arr.length || keepEmpty) obj[key] = arr;
    else delete obj[key];
  }
  const vocalIds = (m) => {
    const c = m.playData.characters;
    return [...new Set([...(c.playerVocals ?? [c.player]), ...(c.opponentVocals ?? [c.opponent])])];
  };
  const firstVocalOffset = (m) => {
    const ids = [...Object.keys(m.offsets.vocals ?? {})];
    return ids.length ? m.offsets.vocals[ids[0]] : 0;
  };
  function setAllVocalOffsets(m, v) {
    m.offsets.vocals ||= {};
    for (const id of vocalIds(m)) m.offsets.vocals[id] = v;
    for (const id of Object.keys(m.offsets.vocals)) m.offsets.vocals[id] = v;
    if (!v) for (const id of Object.keys(m.offsets.vocals)) if (!m.offsets.vocals[id]) delete m.offsets.vocals[id];
  }
  function applyOffsets() {
    const m = meta();
    for (const t of audio.tracks) {
      if (t.kind === "inst") t.offset = m.offsets.instrumental || 0;
      else {
        const id = lc(t.id).replace(/^voices-/, "").replace(new RegExp(`-${lc(curVar)}$`), "");
        const key = Object.keys(m.offsets.vocals ?? {}).find((k) => lc(k) === id);
        t.offset = key ? m.offsets.vocals[key] : 0;
      }
    }
    redraw();
  }
  for (const [id, get, set] of metaBinds) {
    const el = $(id);
    el.addEventListener("change", () => {
      set(meta(), el.type === "checkbox" ? el.checked : el.value);
      commit();
      redraw();
    });
  }
  $("chtPrevFromHead").onclick = () => ((meta().playData.previewStart = Math.round(posMs)), commit(), refreshSong());
  $("chtPrevToHead").onclick = () => ((meta().playData.previewEnd = Math.round(posMs)), commit(), refreshSong());
  const refreshSong = () => {
    for (const [id, get] of metaBinds) setVal($(id), get(meta()));
    setVal($("chtSongId"), songId);
  };
  $("chtSongId").onchange = (e) => {
    songId = e.target.value.replace(/[\/\\:*?"<>|]/g, "").trim();
    e.target.value = songId;
    commit();
  };

  // ---- バリエーション・難易度 ----
  const varSel = $("chtVariation"),
    diffSel = $("chtDifficulty");
  function refreshDiff() {
    varSel.replaceChildren(...Object.keys(variations).map((v) => new Option(v, v)));
    varSel.value = curVar;
    diffSel.replaceChildren(...difficulties().map((v) => new Option(v, v)));
    diffSel.value = curDiff;
    const table = $("chtDiffTable");
    table.replaceChildren();
    for (const df of difficulties()) {
      const row = document.createElement("div");
      row.className = "chtRow";
      const name = Object.assign(document.createElement("span"), { className: "chtRowName", textContent: df, title: df });
      const spd = Object.assign(document.createElement("input"), { type: "number", step: "0.1", min: "0.1", title: "scrollSpeed", value: chart().scrollSpeed[df] ?? chart().scrollSpeed.default ?? 1 });
      const rate = Object.assign(document.createElement("input"), { type: "number", step: "1", min: "0", title: "rating（難易度の数字）", value: meta().playData.ratings[df] ?? 0 });
      spd.onchange = () => ((chart().scrollSpeed[df] = num(spd.value, 1)), commit());
      rate.onchange = () => ((meta().playData.ratings[df] = Math.round(num(rate.value, 0))), commit());
      row.append(name, label("speed", spd), label("rating", rate));
      table.append(row);
    }
  }
  function label(text, el) {
    const l = document.createElement("label");
    l.style.margin = "0";
    l.style.flex = "1 1 0";
    l.append(Object.assign(document.createElement("span"), { className: "chtUnits", textContent: text }), el);
    return l;
  }
  varSel.onchange = () => switchTo(varSel.value, curDiff);
  diffSel.onchange = () => switchTo(curVar, diffSel.value);
  function switchTo(v, df) {
    if (audio.playing) audio.pause();
    curVar = variations[v] ? v : DEFAULT_VARIATION;
    curDiff = difficulties().includes(df) ? df : difficulties()[0];
    sel.clear();
    retiming();
    applyOffsets();
    updateActiveTracks();
    commit(); // 画面の状態も履歴に入れておく
    refreshAll();
  }
  const askName = (msg) => (window.prompt(msg) || "").trim().replace(/[^\w\-]+/g, "");
  $("chtAddVar").onclick = () => {
    const v = askName("新しいバリエーションの名前（例: erect）");
    if (!v || variations[v]) return v && say("その名前はすでにあります。");
    const base = variations[DEFAULT_VARIATION].meta;
    const m = normalizeMetadata({ ...clone(base), playData: { ...clone(base.playData), songVariations: [] } });
    const c = normalizeChart(defaultChart(), m.playData.difficulties);
    for (const df of m.playData.difficulties) c.scrollSpeed[df] = 1;
    variations[v] = { meta: m, chart: c };
    base.playData.songVariations.push(v);
    switchTo(v, m.playData.difficulties[0]);
    say(`バリエーション「${v}」を追加しました（metadata は default のコピー）。`);
  };
  $("chtDelVar").onclick = () => {
    if (curVar === DEFAULT_VARIATION) return say("default は削除できません。");
    if (!window.confirm(`バリエーション「${curVar}」を削除しますか？（Undo で戻せます）`)) return;
    const v = curVar;
    delete variations[v];
    const sv = variations[DEFAULT_VARIATION].meta.playData.songVariations;
    variations[DEFAULT_VARIATION].meta.playData.songVariations = sv.filter((x) => x !== v);
    switchTo(DEFAULT_VARIATION, curDiff);
  };
  function addDifficulty(copy) {
    const df = askName("新しい難易度の名前（例: hard）");
    if (!df) return;
    if (difficulties().includes(df)) return say("その難易度はすでにあります。");
    meta().playData.difficulties.push(df);
    chart().notes[df] = copy ? clone(notes()) : [];
    chart().scrollSpeed[df] = chart().scrollSpeed[curDiff] ?? 1;
    meta().playData.ratings[df] = meta().playData.ratings[curDiff] ?? 1;
    switchTo(curVar, df);
  }
  $("chtAddDiff").onclick = () => addDifficulty(false);
  $("chtDupDiff").onclick = () => addDifficulty(true);
  $("chtDelDiff").onclick = () => {
    if (difficulties().length <= 1) return say("最後の難易度は削除できません。");
    if (!window.confirm(`難易度「${curDiff}」のノーツを削除しますか？（Undo で戻せます）`)) return;
    const df = curDiff;
    meta().playData.difficulties = difficulties().filter((x) => x !== df);
    delete chart().notes[df];
    delete chart().scrollSpeed[df];
    delete meta().playData.ratings[df];
    switchTo(curVar, difficulties()[0]);
  };

  // ---- BPM・拍子 ----
  function refreshTiming() {
    const list = $("chtTimeList");
    list.replaceChildren();
    meta().timeChanges.forEach((tc, i) => {
      const row = document.createElement("div");
      row.className = "chtRow";
      const mk = (key, title, step, min) => {
        const el = Object.assign(document.createElement("input"), { type: "number", step, min, title, value: tc[key] });
        el.onchange = () => changeTime(i, key, num(el.value, tc[key]));
        return label(title, el);
      };
      row.append(mk("t", "ms", "1", i === 0 ? "" : "0"), mk("bpm", "BPM", "0.1", "1"), mk("n", "拍/小節", "1", "1"), mk("d", "分母", "1", "1"));
      if (i > 0) {
        const del = Object.assign(document.createElement("button"), { type: "button", textContent: "🗑", title: "この変更点を削除" });
        del.onclick = () => {
          applyRetime(() => meta().timeChanges.splice(i, 1));
        };
        row.append(del);
      }
      list.append(row);
    });
  }
  /** timeChanges を変える。「step 位置を保つ」がオンなら、ノーツ・イベントの ms を新しい BPM に合わせて計算し直す */
  function applyRetime(change) {
    const old = timing;
    const keep = $("chtKeepSteps").checked;
    const snapNotes = keep ? chartsOfCurrentVariation().map((c) => c.map((o) => stepOf2(old, o.t))) : null;
    const curStepKeep = old.msToStep(posMs);
    change();
    meta().timeChanges.sort((a, b) => a.t - b.t);
    timing = new Timing(meta().timeChanges);
    if (keep) {
      chartsOfCurrentVariation().forEach((list, li) => list.forEach((o, i) => (o.t = round3(timing.stepToMs(snapNotes[li][i])))));
      posMs = timing.stepToMs(curStepKeep);
    }
    commit();
    refreshAll();
  }
  const stepOf2 = (tm, ms) => tm.msToStep(ms);
  /** 再計算の対象: このバリエーションの全難易度のノーツ + イベント */
  const chartsOfCurrentVariation = () => [...Object.values(chart().notes), events()];
  function changeTime(i, key, value) {
    if (key === "t" && i === 0) value = Math.min(0, value);
    applyRetime(() => {
      meta().timeChanges[i][key] = value;
    });
  }
  $("chtAddTime").onclick = () => {
    const m = timing.measureAtStep(Math.max(0, stepOf(posMs)));
    const ms = Math.round(timing.stepToMs(Math.max(m.start, 0)));
    if (meta().timeChanges.some((tc) => Math.abs(tc.t - ms) < 1)) return say("この位置にはすでに変更点があります。");
    const at = meta().timeChanges[timing.indexAtMs(ms)];
    applyRetime(() => meta().timeChanges.push({ t: ms, bpm: at.bpm, n: at.n, d: at.d }));
    say(`${ms}ms（小節の頭）に変更点を追加しました。BPM を書き換えてください。`);
  };

  // ---- 音声トラック一覧 ----
  function renderTracks() {
    const box = $("chtTracks");
    box.replaceChildren();
    if (!audio.tracks.length) {
      box.append(Object.assign(document.createElement("p"), { className: "tiny", textContent: "音声がまだありません。ファイルタブの「開く」「Inst を選ぶ」「Voices を追加」から読み込めます。" }));
      return;
    }
    for (const t of audio.tracks) {
      const row = document.createElement("div");
      row.className = "chtRow" + (t.active === false ? " chtOff" : "");
      const name = Object.assign(document.createElement("span"), { className: "chtRowName", textContent: t.id, title: t.active === false ? `${t.name}（このバリエーションでは使いません）` : t.name });
      const vol = Object.assign(document.createElement("input"), { type: "range", min: "0", max: "1", step: "0.05", value: t.volume, title: "音量" });
      vol.oninput = () => audio.setVolume(t.id, Number(vol.value));
      const mute = Object.assign(document.createElement("input"), { type: "checkbox", checked: !t.muted, title: "音を出す" });
      mute.onchange = () => audio.setMuted(t.id, !mute.checked);
      const wave = Object.assign(document.createElement("input"), { type: "checkbox", checked: t.wave, title: "波形を表示" });
      wave.onchange = () => ((t.wave = wave.checked), redraw());
      const del = Object.assign(document.createElement("button"), { type: "button", textContent: "✕", title: "このトラックを外す" });
      del.onclick = () => (audio.remove(t.id), renderTracks(), redraw());
      row.append(name, vol, label("🔊", mute), label("〜", wave), del);
      box.append(row);
    }
  }
  $("chtRate").onchange = (e) => audio.setRate(Number(e.target.value));
  $("chtHitSound").onchange = (e) => (hitSound = e.target.checked);

  // ---- 編集パネル（選択中の中身・イベント） ----
  const palette = $("chtPalette");
  function refreshPalette() {
    const keep = palette.value;
    const builtin = eventKinds().filter((k) => !isCustomEvent(k)),
      custom = eventKinds().filter(isCustomEvent);
    const g1 = Object.assign(document.createElement("optgroup"), { label: "組み込み" });
    g1.append(...builtin.map((k) => new Option(eventTitle(k), k)));
    palette.replaceChildren(g1);
    if (custom.length) {
      const g2 = Object.assign(document.createElement("optgroup"), { label: "スクリプト" });
      g2.append(...custom.map((k) => new Option(eventTitle(k) + (eventTitle(k) !== k ? ` (${k})` : ""), k)));
      palette.append(g2);
    }
    palette.append(new Option("名前を入力…（未登録のイベント）", "__custom"));
    if ([...palette.options].some((o) => o.value === keep)) palette.value = keep;
  }
  refreshPalette();
  const paletteKind = () => (palette.value === "__custom" ? $("chtCustomKind").value.trim() : palette.value);
  palette.onchange = () => ($("chtCustomRow").hidden = palette.value !== "__custom");
  $("chtAddEventHead").onclick = () => {
    const kind = paletteKind();
    if (!kind) return say("イベントの名前を入れてください。");
    const ev = { t: msOf(Math.max(0, Math.floor(stepOf(posMs) / snapSteps() + 1e-9) * snapSteps())), e: kind, v: EVENT_SCHEMAS[kind] ? defaultEventValue(kind) : {} };
    events().push(ev);
    sortEvents();
    sel = new Set([ev]);
    commit();
    refreshEdit();
    redraw();
  };
  const dirSel = $("chtNDir");
  dirSel.replaceChildren(...[0, 1, 2, 3].flatMap((i) => [new Option(`Player ${DIR_NAMES[i]}`, i), ]), ...[4, 5, 6, 7].map((i) => new Option(`Opponent ${DIR_NAMES[i - 4]}`, i)));

  function selectedNotes() {
    return [...sel].filter((o) => !isEvent(o));
  }
  function selectedEvents() {
    return [...sel].filter(isEvent);
  }
  function refreshEdit() {
    const ns = selectedNotes(),
      es = selectedEvents();
    $("chtSelTitle").textContent = sel.size ? `選択中（ノーツ ${ns.length} / イベント ${es.length}）` : "選択中";
    $("chtNoSel").hidden = sel.size > 0;
    $("chtNoteFields").hidden = !ns.length || es.length > 0;
    $("chtEventFields").hidden = es.length !== 1 || ns.length > 0;
    if (!$("chtNoteFields").hidden) {
      const n = ns[0],
        multi = ns.length > 1;
      setVal($("chtNLen"), multi ? "" : n.l || 0);
      $("chtNLen").placeholder = multi ? "（複数）" : "";
      setVal($("chtNKind"), ns.every((x) => (x.k || "") === (n.k || "")) ? n.k || "" : "");
      setVal($("chtNTime"), multi ? "" : n.t);
      $("chtNTime").disabled = multi;
      dirSel.disabled = multi;
      if (!multi) dirSel.value = n.d;
      renderParams(ns);
    }
    if (!$("chtEventFields").hidden) renderEventForm(es[0]);
  }
  $("chtNLen").onchange = (e) => {
    const v = Math.max(0, num(e.target.value));
    for (const n of selectedNotes()) v > 0 ? (n.l = v) : delete n.l;
    commit();
    redraw();
  };
  $("chtNKind").onchange = (e) => {
    const v = e.target.value.trim();
    for (const n of selectedNotes()) v && v !== "normal" ? (n.k = v) : delete n.k;
    commit();
    redraw();
  };
  $("chtNTime").onchange = (e) => {
    const n = selectedNotes()[0];
    if (!n) return;
    n.t = Math.max(0, num(e.target.value, n.t));
    sortNotes();
    commit();
    redraw();
  };
  dirSel.onchange = () => {
    const n = selectedNotes()[0];
    if (!n) return;
    n.d = Number(dirSel.value);
    sortNotes();
    commit();
    redraw();
  };
  function renderParams(ns) {
    const box = $("chtNParams");
    box.replaceChildren();
    if (ns.length !== 1) return $("chtNAddParam").setAttribute("hidden", "");
    $("chtNAddParam").removeAttribute("hidden");
    const n = ns[0];
    (n.p ?? []).forEach((pr, i) => {
      const row = document.createElement("div");
      row.className = "chtRow";
      const k = Object.assign(document.createElement("input"), { type: "text", value: pr.n, placeholder: "name" });
      const v = Object.assign(document.createElement("input"), { type: "text", value: typeof pr.v === "string" ? pr.v : JSON.stringify(pr.v), placeholder: "value" });
      k.onchange = () => ((pr.n = k.value), commit());
      v.onchange = () => ((pr.v = parseLoose(v.value)), commit());
      const del = Object.assign(document.createElement("button"), { type: "button", textContent: "✕" });
      del.onclick = () => {
        n.p.splice(i, 1);
        if (!n.p.length) delete n.p;
        commit();
        refreshEdit();
      };
      row.append(k, v, del);
      box.append(row);
    });
  }
  /** 文字列 → 値。数値・true/false・JSON ならそれに、それ以外は文字列のまま */
  function parseLoose(s) {
    const t = String(s).trim();
    if (t === "") return "";
    try {
      return JSON.parse(t);
    } catch {
      return s;
    }
  }
  $("chtNAddParam").onclick = () => {
    const n = selectedNotes()[0];
    if (!n) return;
    (n.p ??= []).push({ n: "param", v: "" });
    commit();
    refreshEdit();
  };

  const eKind = $("chtEKind");
  function renderEventForm(ev) {
    const known = EVENT_SCHEMAS[ev.e];
    eKind.replaceChildren(...eventKinds().map((k) => new Option(eventTitle(k) + (isCustomEvent(k) ? " ※" : ""), k)));
    if (!known) eKind.append(new Option(ev.e + "（未登録）", ev.e));
    eKind.value = ev.e;
    setVal($("chtETime"), ev.t);
    const form = $("chtEForm");
    form.replaceChildren();
    if (!known) {
      // スキーマが分からないイベント: JSON をそのまま編集
      const ta = Object.assign(document.createElement("textarea"), { rows: 6, value: JSON.stringify(ev.v, null, 1), spellcheck: false });
      ta.style.width = "100%";
      ta.onchange = () => {
        try {
          ev.v = JSON.parse(ta.value);
          commit();
          say("value を更新しました。");
        } catch (e) {
          say("JSON が正しくありません: " + e.message);
        }
      };
      form.append(Object.assign(document.createElement("p"), { className: "tiny", textContent: "このイベントの定義がまだ読み込まれていません。ファイルタブの「イベントのスクリプト」で .hxc を読み込むと、項目が出ます。いまは value を JSON で編集できます。" }), ta);
      return;
    }
    if (ev.v === null || typeof ev.v !== "object" || Array.isArray(ev.v)) ev.v = defaultEventValue(ev.e);
    const main = [],
      adv = [];
    for (const f of known.fields) (f.group === "advanced" ? adv : main).push(f);
    for (const f of main) form.append(fieldEl(ev, f));
    if (adv.length) {
      const d = document.createElement("details");
      d.className = "chtField";
      d.append(Object.assign(document.createElement("summary"), { textContent: "advanced" }));
      for (const f of adv) d.append(fieldEl(ev, f));
      form.append(d);
    }
  }
  function fieldEl(ev, f) {
    const wrap = document.createElement("label");
    wrap.className = "chtField";
    const cur = ev.v[f.name] ?? f.def;
    wrap.append(document.createTextNode(f.title + " "));
    if (f.units) wrap.append(Object.assign(document.createElement("span"), { className: "chtUnits", textContent: `(${f.units})` }));
    let el;
    if (f.type === "enum") {
      el = document.createElement("select");
      for (const [t, v] of f.options) el.append(new Option(t, JSON.stringify(v)));
      el.value = JSON.stringify(cur);
      if (el.value !== JSON.stringify(cur)) el.append(new Option(String(cur), JSON.stringify(cur)), (el.value = JSON.stringify(cur)));
      el.onchange = () => ((ev.v[f.name] = JSON.parse(el.value)), commit());
    } else if (f.type === "bool") {
      el = Object.assign(document.createElement("input"), { type: "checkbox", checked: !!cur });
      el.onchange = () => ((ev.v[f.name] = el.checked), commit());
    } else if (f.type === "string") {
      el = Object.assign(document.createElement("input"), { type: "text", value: cur });
      el.onchange = () => ((ev.v[f.name] = el.value), commit());
    } else {
      el = Object.assign(document.createElement("input"), { type: "number", value: cur });
      if (f.step) el.step = f.step;
      if (f.min !== undefined) el.min = f.min;
      if (f.max !== undefined) el.max = f.max;
      el.onchange = () => {
        let v = num(el.value, f.def);
        if (f.min !== undefined) v = Math.max(f.min, v);
        if (f.max !== undefined) v = Math.min(f.max, v);
        ev.v[f.name] = f.type === "int" ? Math.round(v) : v;
        commit();
      };
    }
    wrap.append(el);
    return wrap;
  }
  eKind.onchange = () => {
    const ev = selectedEvents()[0];
    if (!ev) return;
    ev.e = eKind.value;
    ev.v = defaultEventValue(ev.e);
    commit();
    refreshEdit();
    redraw();
  };
  $("chtETime").onchange = (e) => {
    const ev = selectedEvents()[0];
    if (!ev) return;
    ev.t = Math.max(0, num(e.target.value, ev.t));
    sortEvents();
    commit();
    redraw();
  };
  // ---- イベントのスクリプト（HScript）----
  const SCRIPT_LS = "funkinStudio.chart.eventScripts";
  let scripts = {}; // ファイル名 → { text, ids: [イベントID], warn: [] }
  function registerScript(name, text) {
    const r = parseHxc(text);
    for (const e of r.events) registerEventSchema(e.id, e.title, e.fields);
    const warnings = [...r.warnings, ...r.events.flatMap((e) => e.warnings.map((w) => `${e.id}: ${w}`))];
    const modules = [...text.matchAll(/class\s+(\w+)\s+extends\s+(?:Module|ScriptedModule)\b/g)].map((m) => m[1]); // プレイテストで実行する Module
    scripts[name] = { text, ids: r.events.map((e) => e.id), kinds: r.noteKinds.map((k) => k.id), modules, warn: warnings };
    return { count: r.events.length + r.noteKinds.length + modules.length, warnings };
  }
  function saveScripts() {
    try {
      localStorage.setItem(SCRIPT_LS, JSON.stringify(Object.fromEntries(Object.entries(scripts).map(([k, v]) => [k, v.text]))));
    } catch {}
  }
  try {
    const saved = JSON.parse(localStorage.getItem(SCRIPT_LS) || "{}");
    for (const [name, text] of Object.entries(saved)) registerScript(name, text);
  } catch {}
  function renderScripts() {
    const box = $("chtScriptList");
    box.replaceChildren();
    for (const [name, sc] of Object.entries(scripts)) {
      const row = document.createElement("div");
      row.className = "chtRow";
      const label = Object.assign(document.createElement("span"), {
        className: "chtRowName",
        style: "max-width:none;flex:1",
        textContent: `${name} → ${[...sc.ids, ...sc.kinds.map((k) => k + "(ノーツ種類)"), ...(sc.modules ?? []).map((k) => k + "(Module)")].join(", ") || "対象なし"}`,
        title: sc.warn.join("\n") || name,
      });
      const del = Object.assign(document.createElement("button"), { type: "button", textContent: "✕", title: "外す" });
      del.onclick = () => {
        for (const id of sc.ids) unregisterEventSchema(id);
        delete scripts[name];
        saveScripts();
        refreshAfterScripts();
      };
      row.append(label, del);
      box.append(row);
    }
  }
  function refreshAfterScripts() {
    refreshPalette();
    renderScripts();
    refreshEdit();
    redraw();
  }
  $("chtScripts").onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    const found = [],
      warns = [];
    for (const f of files) {
      const texts = [];
      if (/\.(zip|fnfc)$/i.test(f.name)) {
        try {
          for (const [en, data] of await readZip(await f.arrayBuffer())) if (/\.(hxc|hx)$/i.test(en)) texts.push([en.replace(/^.*[\\/]/, ""), new TextDecoder().decode(data)]);
        } catch (err) {
          warns.push(`${f.name}: ${err.message}`);
        }
      } else if (/\.(hxc|hx|txt)$/i.test(f.name)) texts.push([f.name, await f.text()]);
      else warns.push(`${f.name}: .hxc / .hx のファイルを選んでください`);
      for (const [name, text] of texts) {
        if (!/extends\s+(SongEvent|ScriptedSongEvent|ScriptedNoteKind|NoteKind|Module|ScriptedModule)\b/.test(text)) continue; // イベント / ノーツ種類 / Module 以外のスクリプトは読み飛ばす
        const r = registerScript(name, text);
        if (r.count) found.push(`${name} → ${[...scripts[name].ids, ...scripts[name].kinds.map((k) => k + "(ノーツ種類)"), ...scripts[name].modules.map((k) => k + "(Module)")].join(", ")}`);
        warns.push(...r.warnings);
      }
    }
    saveScripts();
    refreshAfterScripts();
    say(found.length ? `イベントを読み込みました:\n${found.join("\n")}${warns.length ? "\n\n注意:\n" + warns.join("\n") : ""}` : `SongEvent を継承したスクリプトが見つかりませんでした。${warns.length ? "\n" + warns.join("\n") : ""}`);
  };
  renderScripts();

  // 置くノーツの kind の候補（読み込んだチャートに出てくる種類）
  function refreshKinds() {
    const kinds = new Set();
    for (const v of Object.values(variations)) for (const list of Object.values(v.chart.notes)) for (const n of list) if (n.k) kinds.add(n.k);
    for (const sc of Object.values(scripts)) for (const k of sc.kinds) kinds.add(k); // スクリプトで定義されたノーツ種類
    $("chtKinds").replaceChildren(...[...kinds].map((k) => Object.assign(document.createElement("option"), { value: k })));
  }

  function refreshAll() {
    refreshSong();
    refreshDiff();
    refreshTiming();
    refreshKinds();
    renderTracks();
    refreshEdit();
    syncTransport();
    redraw();
  }

  // ============================================================
  // 8. ファイル保存
  // ============================================================
  function download(name, data, type = "application/json") {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  /** 保存前の整合: 難易度の一覧・notes・scrollSpeed がそろっているか */
  function ensureConsistent() {
    for (const { meta: m, chart: c } of Object.values(variations)) {
      for (const df of m.playData.difficulties) {
        c.notes[df] ??= [];
        c.scrollSpeed[df] ??= c.scrollSpeed.default ?? 1;
      }
    }
  }
  const fileId = () => songId || slug(variations[DEFAULT_VARIATION].meta.songName);
  const names = (v) => ({
    chart: `${fileId()}-chart${v === DEFAULT_VARIATION ? "" : "-" + v}.json`,
    meta: `${fileId()}-metadata${v === DEFAULT_VARIATION ? "" : "-" + v}.json`,
  });
  const pretty = () => !$("chtCompact").checked;
  const jsonEntries = () => {
    ensureConsistent();
    const out = [];
    for (const [v, { meta: m, chart: c }] of Object.entries(variations)) {
      const n = names(v);
      out.push({ name: n.meta, data: new TextEncoder().encode(serializeMetadata(m, pretty())) }, { name: n.chart, data: new TextEncoder().encode(serializeChart(c, pretty())) });
    }
    return out;
  };
  // mod の zip ごと書き出す（services/ModExport.js）。曲の JSON は data/songs/<id>/、音声は songs/<id>/
  const songPath = (n) => `data/songs/${fileId()}/${n}`;
  const modOut = (files) => exportMod(state.app, files, { say }).catch((e) => say("書き出しエラー: " + e.message));
  $("chtSaveChart").onclick = () => {
    ensureConsistent();
    modOut([{ path: songPath(names(curVar).chart), data: serializeChart(chart(), pretty()) }]);
  };
  $("chtSaveMeta").onclick = () => {
    ensureConsistent();
    modOut([{ path: songPath(names(curVar).meta), data: serializeMetadata(meta(), pretty()) }]);
  };
  $("chtSaveAllJson").onclick = () => {
    const files = jsonEntries().map((e) => ({ path: songPath(e.name), data: e.data }));
    for (const t of audio.tracks) files.push({ path: `songs/${fileId()}/${t.id}${t.ext || ".ogg"}`, data: t.bytes });
    modOut(files).then(() => state.app.unsaved?.clean());
  };
  function saveFnfc() {
    const entries = jsonEntries();
    entries.push({ name: "manifest.json", data: new TextEncoder().encode(JSON.stringify({ version: "1.0.0", songId: fileId() }, null, 2)) });
    const warn = [];
    for (const t of audio.tracks) {
      const ext = t.ext || ".ogg";
      if (ext !== ".ogg") warn.push(t.id + ext);
      entries.push({ name: t.id + ext, data: t.bytes });
    }
    download(`${fileId()}.fnfc`, writeZip(entries), "application/zip");
    state.app.unsaved?.clean();
    say(`${fileId()}.fnfc を保存しました（${entries.length} ファイル）。${warn.length ? "\n注意: 公式の Chart Editor は音声が .ogg であることを期待します: " + warn.join(", ") : ""}`);
  }
  $("chtSaveFnfc").onclick = saveFnfc;

  $("chtNew").onclick = () => {
    if (!state.app.unsaved.confirmReplace()) return;
    audio.clear();
    variations = { [DEFAULT_VARIATION]: { meta: defaultMetadata(), chart: defaultChart() } };
    curVar = DEFAULT_VARIATION;
    curDiff = "normal";
    songId = "";
    posMs = 0;
    sel.clear();
    retiming();
    resetHistory();
    refreshAll();
    state.app.unsaved?.clean();
    say("新しい譜面を作りました。曲情報と音声を設定してください。");
  };
  const onFiles = (merge) => async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) await ingest(files, { merge });
  };
  $("chtOpen").onchange = onFiles(false);
  $("chtAdd").onchange = onFiles(true);
  $("chtInst").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const instId = meta().playData.characters.instrumental || "";
    const ext = (f.name.match(/\.[^.]+$/) || [".ogg"])[0];
    const ok = await loadAudioBytes("Inst" + (instId ? "-" + instId : "") + ext, new Uint8Array(await f.arrayBuffer()));
    updateActiveTracks();
    if (ok) say(`Inst を読み込みました（${f.name}）。`);
  };
  $("chtVoices").onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    let n = 0;
    for (const f of files) {
      const ext = (f.name.match(/\.[^.]+$/) || [".ogg"])[0];
      // 名前が Voices- で始まらなければ、プレイヤー/相手のキャラ名を補う
      let nm = baseName(f.name);
      if (!/^voices/i.test(nm)) nm = "Voices-" + nm;
      if (await loadAudioBytes(nm + ext, new Uint8Array(await f.arrayBuffer()))) n++;
    }
    updateActiveTracks();
    if (n) say(`Voices を ${n} 本読み込みました。`);
  };

  // ============================================================
  // 9. 再生・キーボード
  // ============================================================
  const seek = $("chtSeek");
  let seeking = false;
  function syncTransport() {
    const len = songLengthMs();
    seek.max = Math.round(len);
    if (!seeking) seek.value = Math.round(posMs);
    const step = stepOf(posMs),
      m = timing.measureAtStep(Math.max(0, step));
    const inMeasure = Math.floor(Math.max(0, step) - m.start + 1e-6);
    const tc = meta().timeChanges[timing.indexAtMs(posMs)];
    $("chtTime").textContent = `${fmtTime(posMs)} (${Math.round(posMs)}ms)`;
    $("chtReadout").textContent = `小節 ${m.number + measureOffsetOf(m)} · step ${inMeasure} · ${tc.bpm} BPM · ${tc.n}/${tc.d}`;
    $("chtPlay").textContent = audio.playing ? "⏸" : "▶";
    $("chtHint").textContent = `${curVar} / ${curDiff}　ノーツ ${notes().length}・イベント ${events().length}　速度 ${chart().scrollSpeed[curDiff] ?? 1}×`;
  }
  const fmtTime = (ms) => {
    const s = Math.max(0, ms) / 1000;
    return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
  };
  seek.oninput = () => {
    seeking = true;
    setPos(Number(seek.value));
  };
  seek.onchange = () => (seeking = false);
  function togglePlay() {
    if (audio.playing) audio.pause();
    else {
      audio._startPos = posMs;
      lastTickMs = posMs;
      audio.play();
    }
    syncTransport();
  }
  $("chtPlay").onclick = togglePlay;
  $("chtStop").onclick = () => (audio.pause(), setPos(0));

  state.listen(window, "keyup", (e) => {
    if (e.code === "Space") spaceDown = false;
  });
  state.listen(window, "keydown", (e) => {
    if (!state.active || isTextEntry(e.target) || e.metaKey || playtest.isOpen()) return;
    const k = e.key.toLowerCase();
    if (e.code === "Space") {
      e.preventDefault();
      if (e.shiftKey) spaceDown = true;
      else togglePlay();
      return;
    }
    if (e.ctrlKey) {
      if (k === "z" || k === "y") (e.preventDefault(), k === "y" || e.shiftKey ? redo() : undo());
      else if (k === "a") (e.preventDefault(), selectAll());
      else if (k === "c") (e.preventDefault(), copySel(false));
      else if (k === "x") (e.preventDefault(), copySel(true));
      else if (k === "v") (e.preventDefault(), pasteAtHead());
      else if (k === "s") (e.preventDefault(), saveFnfc());
      return;
    }
    const sn = snapSteps();
    if (k === "arrowup" || k === "arrowdown") (e.preventDefault(), scrollBySteps((k === "arrowup" ? -1 : 1) * (e.shiftKey ? 4 : sn)));
    else if (k === "arrowleft") (e.preventDefault(), setSnap(snapIdx - 1));
    else if (k === "arrowright") (e.preventDefault(), setSnap(snapIdx + 1));
    else if (k === "pageup" || k === "pagedown") {
      e.preventDefault();
      const m = timing.measureAtStep(Math.max(0, stepOf(posMs)));
      const dir = k === "pageup" ? -1 : 1;
      const target = dir > 0 ? m.start + m.len : Math.abs(stepOf(posMs) - m.start) > 1e-3 ? m.start : m.start - 1;
      setPos(msOf(dir > 0 ? target : timing.measureAtStep(Math.max(0, target)).start));
    } else if (k === "home") (e.preventDefault(), setPos(0));
    else if (k === "end") (e.preventDefault(), setPos(songLengthMs()));
    else if (k === "delete" || k === "backspace") (e.preventDefault(), deleteSelected());
    else if (k === "escape") ((sel = new Set()), refreshEdit(), redraw());
    else if (k === "m") (e.preventDefault(), mirrorSel(e.shiftKey));
    else if (k === "h") panels.toggleAll();
    else if (k === "p") openPlayTest();
    else if (k === "1") setTool("place");
    else if (k === "2") setTool("select");
    else if (k === "3") setTool("pan");
  });

  // ---- プレイテスト ----
  const noteStyles = new NoteStyleSet(); // プレイテスト用のノートスキン（JSON + PNG/XML。画面を開いている間だけ保持）
  const playtest = createPlayTest(state.root, {
    audio,
    noteStyles,
    getScripts: () => Object.fromEntries(Object.entries(scripts).map(([k, v]) => [k, v.text])),
    getStage: () => meta()?.playData?.stage ?? "",
    getWorkspace: () => state.app.workspace,
    getCharacters: () => {
      const c = meta()?.playData?.characters ?? {};
      return { player: c.player ?? "bf", girlfriend: c.girlfriend ?? "gf", opponent: c.opponent ?? "dad" };
    },
    listen: (t, type, fn) => state.listen(t, type, fn),
    say,
    getNotes: () => notes(),
    getEvents: () => events(),
    getTiming: () => timing,
    getBaseSpeed: () => chart().scrollSpeed[curDiff] ?? chart().scrollSpeed.default ?? 1,
    onExit: () => closePlayTest(),
  });
  function openPlayTest() {
    if (playtest.isOpen()) return;
    audio.pause();
    syncTransport();
    playtest.open(posMs);
  }
  function closePlayTest() {
    playtest.close();
    $("chtRate").dispatchEvent(new Event("change")); // 再生速度を編集用の設定に戻す
    redraw();
  }
  $("chtPlayBtn").onclick = openPlayTest;

  // 初期表示
  resetHistory();
  refreshAll();

  return {
    onShow() {
      resize();
      syncHud();
      redraw();
    },
    onHide() {
      playtest.close();
      audio.pause(); // 別の画面へ移ったら止める
      syncTransport();
    },
    undo,
    redo,
    // テスト・デバッグ用（開発者コンソールから app.states.get("chart").editor.api で触れる）
    api: {
      get doc() { return { variations, curVar, curDiff, songId }; },
      get audio() { return audio; },
      setPos, timing: () => timing, ingest,
      select(o) { sel = new Set([o]); refreshEdit(); redraw(); },
    },
  };
}
