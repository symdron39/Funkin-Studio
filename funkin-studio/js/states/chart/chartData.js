/* ============================================================
   chart/chartData.js — Chart Editor のデータ（metadata / chart）と時間計算
   ------------------------------------------------------------
   出典: V-Slice 0.8.x data/song/SongData.hx, SongRegistry.hx, Conductor.hx, play/event/*.hx
   ・metadata.json : 曲の情報・キャラ・ステージ・難易度一覧・timeChanges（BPM）
   ・chart.json    : scrollSpeed（難易度ごと）・events（全難易度で共通）・notes（難易度ごと）
   ・時間はすべてミリ秒(ms)で持つ。グリッドの縦位置は「step（16分音符）」で数える。
   ・ノーツ d: 0-3 = プレイヤー側, 4-7 = 相手側（getStrumlineIndex）。グリッド上は 相手=左 / プレイヤー=右 / イベント=最右。
   ============================================================ */
import { GENERATED_BY } from "../../core/appInfo.js";

export const METADATA_VERSION = "2.2.4";
export const CHART_VERSION = "2.0.0";
export const STRUMLINE_SIZE = 4;
export const STEPS_PER_BEAT = 4;
export const DEFAULT_VARIATION = "default";
export const SNAP_QUANTS = [4, 8, 12, 16, 20, 24, 32, 48, 64, 96, 192];
export const BASE_QUANT_INDEX = 3; // 16分
export const DIR_NAMES = ["Left", "Down", "Up", "Right"];

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const round3 = (n) => Math.round(n * 1000) / 1000;

// ------------------------------------------------------------
// 組み込みイベント（0.8.x の play/event/*.hx の getEventSchema）
// type: float / int / string / bool / enum。frame の中身（advanced）は group で表す。
// ------------------------------------------------------------
const EASES = ["linear", "INSTANT", "CLASSIC", "sine", "quad", "cube", "quart", "quint", "expo", "smoothStep", "smootherStep", "elastic", "back", "bounce", "circ"];
const EASE_DIRS = ["In", "Out", "InOut"];
const easeField = (def, withClassic) => ({ name: "ease", title: "Easing", type: "enum", def, options: (withClassic ? EASES : EASES.filter((e) => e !== "CLASSIC")).map((v) => [v, v]) });
const easeDirField = { name: "easeDir", title: "Easing Direction", type: "enum", def: "In", options: EASE_DIRS.map((v) => [v === "InOut" ? "In/Out" : v, v]) };

export const EVENT_SCHEMAS = {
  FocusCamera: {
    title: "Focus Camera",
    fields: [
      { name: "char", title: "Target", type: "enum", def: 0, options: [["Position", -1], ["Player", 0], ["Opponent", 1], ["Girlfriend", 2]] },
      { name: "x", title: "X Position", type: "float", def: 0, step: 10, units: "px" },
      { name: "y", title: "Y Position", type: "float", def: 0, step: 10, units: "px" },
      { name: "duration", title: "Duration", type: "float", def: 4, min: 0, step: 0.5, units: "steps" },
      easeField("CLASSIC", true),
      easeDirField,
    ],
  },
  ZoomCamera: {
    title: "Zoom Camera",
    fields: [
      { name: "zoom", title: "Zoom", type: "float", def: 1, min: 0, step: 0.05, units: "x" },
      { name: "duration", title: "Duration", type: "float", def: 4, min: 0, step: 0.5, units: "steps" },
      easeField("linear", false),
      easeDirField,
      { name: "mode", title: "Mode", type: "enum", def: "direct", group: "advanced", options: [["Stage zoom", "stage"], ["Absolute zoom", "direct"]] },
      { name: "widescreenScaleX", title: "Widescreen Scale X", type: "float", def: 0, min: 0, max: 1, step: 0.05, group: "advanced", units: "x" },
      { name: "widescreenScaleY", title: "Widescreen Scale Y", type: "float", def: 0, min: 0, max: 1, step: 0.05, group: "advanced", units: "x" },
    ],
  },
  ScrollSpeed: {
    title: "Scroll Speed",
    fields: [
      { name: "scroll", title: "Scroll Speed", type: "float", def: 1, min: 0.1, step: 0.1, units: "x" },
      { name: "duration", title: "Duration", type: "float", def: 4, min: 0, step: 0.5, units: "steps" },
      easeField("linear", false),
      easeDirField,
      { name: "strumline", title: "Target Strumline", type: "enum", def: "both", group: "advanced", options: [["Both", "both"], ["Player", "player"], ["Opponent", "opponent"]] },
      { name: "absolute", title: "Absolute", type: "bool", def: false, group: "advanced" },
    ],
  },
  SetCameraBop: {
    title: "Set Camera Bop",
    fields: [
      { name: "intensity", title: "Intensity", type: "float", def: 1.015, min: 0, step: 0.1, units: "x" },
      { name: "offset", title: "Offset", type: "float", def: 0, step: 0.25, units: "beats" },
      { name: "rate", title: "Rate", type: "float", def: 4, min: 0, step: 0.25, units: "beats/zoom" },
    ],
  },
  SetHealthIcon: {
    title: "Set Health Icon",
    fields: [
      { name: "char", title: "Target", type: "enum", def: 0, options: [["Player", 0], ["Opponent", 1]] },
      { name: "id", title: "Icon ID", type: "string", def: "face" },
      { name: "shouldBop", title: "Should Bop", type: "bool", def: true },
      { name: "scale", title: "Scale", type: "float", def: 1, min: 0, step: 0.1 },
      { name: "flipX", title: "Flip X", type: "bool", def: false },
      { name: "isPixel", title: "Is Pixel", type: "bool", def: false, group: "advanced" },
      { name: "offsetX", title: "Offset X", type: "float", def: 0, group: "advanced" },
      { name: "offsetY", title: "Offset Y", type: "float", def: 0, group: "advanced" },
    ],
  },
  PlayAnimation: {
    title: "Play Animation",
    fields: [
      { name: "target", title: "Target", type: "string", def: "boyfriend" },
      { name: "anim", title: "Animation", type: "string", def: "idle" },
      { name: "force", title: "Force", type: "bool", def: false },
    ],
  },
  SetTargetBopSpeed: {
    title: "Set Bop Speed",
    fields: [
      { name: "target", title: "Target", type: "string", def: "boyfriend" },
      { name: "rate", title: "Rate", type: "float", def: 1, min: 0, step: 0.25, units: "beats/dance" },
    ],
  },
};
const BUILTIN = JSON.parse(JSON.stringify(EVENT_SCHEMAS));
/** いま使えるイベントの種類（組み込み + 読み込んだスクリプト） */
export const eventKinds = () => Object.keys(EVENT_SCHEMAS);
export const isCustomEvent = (kind) => !!EVENT_SCHEMAS[kind]?.custom;
/** HScript から読んだイベント定義を登録する（同じ ID の組み込みは上書き。外すと元に戻る） */
export function registerEventSchema(id, title, fields) {
  EVENT_SCHEMAS[id] = { title, fields, custom: true };
}
export function unregisterEventSchema(id) {
  if (BUILTIN[id]) EVENT_SCHEMAS[id] = JSON.parse(JSON.stringify(BUILTIN[id]));
  else delete EVENT_SCHEMAS[id];
}

export const getEventSchema = (kind) => EVENT_SCHEMAS[kind];

export function eventTitle(kind) {
  return getEventSchema(kind)?.title ?? kind;
}
/** スキーマの既定値だけで作った value */
export function defaultEventValue(kind) {
  const v = {};
  for (const f of getEventSchema(kind)?.fields ?? []) v[f.name] = f.def;
  return v;
}

/** 譜面の難しさの目安（プレイヤー側ノーツ中心） */
export function chartStats(notes) {
  const player = notes.filter((n) => n.d < STRUMLINE_SIZE).sort((a, b) => a.t - b.t);
  const opp = notes.length - player.length;
  const holds = player.filter((n) => n.l > 0).length;
  let peak = 0,
    j = 0;
  for (let i = 0; i < player.length; i++) {
    while (player[i].t - player[j].t > 1000) j++;
    peak = Math.max(peak, i - j + 1);
  }
  let chord = 0,
    run = 0;
  for (let i = 0; i < player.length; i++) {
    run = i > 0 && Math.abs(player[i].t - player[i - 1].t) < 1 ? run + 1 : 1;
    chord = Math.max(chord, run);
  }
  const span = player.length > 1 ? (player[player.length - 1].t - player[0].t) / 1000 : 0;
  return { player: player.length, opponent: opp, holds, peakNps: peak, avgNps: span > 0 ? player.length / span : 0, maxChord: chord, spanSec: span };
}

// ------------------------------------------------------------
// 既定データ
// ------------------------------------------------------------
export function defaultMetadata(songName = "New Song") {
  return {
    version: METADATA_VERSION,
    songName,
    artist: "Unknown",
    charter: "",
    divisions: 96,
    looped: false,
    offsets: { instrumental: 0, altInstrumentals: {}, vocals: {}, altVocals: {} },
    playData: {
      songVariations: [],
      difficulties: ["normal"],
      characters: { player: "bf", girlfriend: "gf", opponent: "dad", instrumental: "" },
      stage: "mainStage",
      noteStyle: "funkin",
      ratings: { normal: 1 },
      album: "",
      previewStart: 0,
      previewEnd: 15000,
    },
    generatedBy: GENERATED_BY,
    timeFormat: "ms",
    timeChanges: [{ t: 0, bpm: 100, n: 4, d: 4 }],
  };
}
export function defaultChart() {
  return { version: CHART_VERSION, scrollSpeed: { normal: 1 }, events: [], notes: { normal: [] }, generatedBy: GENERATED_BY };
}

/** 読み込んだ metadata を整える（足りない欄を補う。知らない欄はそのまま残す） */
export function normalizeMetadata(raw) {
  const m = raw && typeof raw === "object" ? raw : {};
  const d = defaultMetadata(m.songName ?? "New Song");
  const out = { ...m };
  out.songName = m.songName ?? d.songName;
  out.artist = m.artist ?? d.artist;
  out.offsets = { ...d.offsets, ...(m.offsets || {}) };
  out.offsets.altInstrumentals ||= {};
  out.offsets.vocals ||= {};
  out.offsets.altVocals ||= {};
  const p = (out.playData = { ...d.playData, ...(m.playData || {}) });
  p.songVariations = Array.isArray(p.songVariations) ? p.songVariations : [];
  p.difficulties = Array.isArray(p.difficulties) && p.difficulties.length ? p.difficulties : ["normal"];
  p.characters = { ...d.playData.characters, ...(p.characters || {}) };
  p.ratings = p.ratings && typeof p.ratings === "object" ? p.ratings : {};
  out.timeFormat = m.timeFormat ?? "ms";
  out.looped = !!m.looped;
  out.divisions = m.divisions ?? 96;
  out.timeChanges = (Array.isArray(m.timeChanges) && m.timeChanges.length ? m.timeChanges : d.timeChanges)
    .map((tc) => ({ ...tc, t: Number(tc.t) || 0, bpm: Number(tc.bpm) || 100, n: Number(tc.n ?? 4) || 4, d: Number(tc.d ?? 4) || 4 }))
    .sort((a, b) => a.t - b.t);
  out.timeChanges[0].t = Math.min(0, out.timeChanges[0].t);
  return out;
}
export function normalizeChart(raw, difficulties = []) {
  const c = raw && typeof raw === "object" ? raw : {};
  const out = { ...c };
  out.scrollSpeed = c.scrollSpeed && typeof c.scrollSpeed === "object" ? c.scrollSpeed : {};
  out.events = (Array.isArray(c.events) ? c.events : []).map((e) => ({ t: Number(e.t) || 0, e: String(e.e ?? ""), v: e.v ?? {} })).sort((a, b) => a.t - b.t);
  out.notes = {};
  for (const [diff, list] of Object.entries(c.notes && typeof c.notes === "object" ? c.notes : {})) {
    out.notes[diff] = (Array.isArray(list) ? list : []).map((n) => normNote(n)).sort((a, b) => a.t - b.t || a.d - b.d);
  }
  for (const df of difficulties) out.notes[df] ||= [];
  return out;
}
function normNote(n) {
  const o = { t: Number(n.t) || 0, d: Number(n.d) | 0 };
  if (n.l) o.l = Number(n.l) || 0;
  if (n.k) o.k = String(n.k);
  if (Array.isArray(n.p) && n.p.length) o.p = n.p.map((x) => ({ n: String(x.n), v: x.v }));
  return o;
}

// ------------------------------------------------------------
// 書き出し（version と generatedBy は常に上書き）
// ------------------------------------------------------------
const stripNote = (n) => {
  const o = { t: round3(n.t), d: n.d };
  if (n.l > 0) o.l = round3(n.l);
  if (n.k) o.k = n.k;
  if (n.p?.length) o.p = n.p;
  return o;
};
export function serializeMetadata(meta, pretty = true) {
  const out = clone(meta);
  out.version = METADATA_VERSION;
  out.generatedBy = GENERATED_BY;
  out.timeFormat = "ms";
  const timing = new Timing(out.timeChanges);
  out.timeChanges = out.timeChanges.map((tc, i) => {
    const o = { t: round3(tc.t), bpm: tc.bpm, n: tc.n, d: tc.d };
    if (tc.b !== undefined || i === 0) o.b = round3(timing.beatAtIndex(i));
    if (tc.bt) o.bt = tc.bt;
    return o;
  });
  for (const k of ["charter", "album", "stickerPack", "discordRPCImage"]) {
    if (out[k] === "") delete out[k];
    if (out.playData[k] === "") delete out.playData[k];
  }
  if (!out.charter) delete out.charter;
  return JSON.stringify(out, null, pretty ? 2 : undefined);
}
export function serializeChart(chart, pretty = true) {
  const out = { ...chart };
  out.version = CHART_VERSION;
  out.generatedBy = GENERATED_BY;
  out.events = chart.events.map((e) => ({ t: round3(e.t), e: e.e, v: e.v }));
  out.notes = {};
  for (const [diff, list] of Object.entries(chart.notes)) out.notes[diff] = list.map(stripNote);
  return JSON.stringify(out, null, pretty ? 2 : undefined);
}

// ------------------------------------------------------------
// 時間 ↔ step（Conductor.hx と同じ式）
//   beatLengthMs = 60000 / bpm × (4 / 分母)   stepLengthMs = beatLengthMs / 4   measure = beat × 分子
// ------------------------------------------------------------
export class Timing {
  constructor(timeChanges) {
    this.tc = timeChanges;
    this.beats = []; // 各 timeChange の開始 beat
    let beat = 0;
    for (let i = 0; i < timeChanges.length; i++) {
      if (i > 0) beat += (timeChanges[i].t - timeChanges[i - 1].t) / this.beatLen(i - 1);
      this.beats.push(beat);
    }
  }
  beatLen(i) {
    const c = this.tc[i];
    return (60000 / c.bpm) * (4 / c.d);
  }
  beatAtIndex(i) {
    return this.beats[i];
  }
  indexAtMs(ms) {
    let i = 0;
    for (let k = 1; k < this.tc.length; k++) if (ms >= this.tc[k].t) i = k;
    return i;
  }
  indexAtStep(step) {
    let i = 0;
    for (let k = 1; k < this.tc.length; k++) if (step >= this.beats[k] * STEPS_PER_BEAT - 1e-6) i = k;
    return i;
  }
  msToStep(ms) {
    const i = this.indexAtMs(ms);
    return this.beats[i] * STEPS_PER_BEAT + (ms - this.tc[i].t) / (this.beatLen(i) / STEPS_PER_BEAT);
  }
  stepToMs(step) {
    const i = this.indexAtStep(step);
    return this.tc[i].t + (step - this.beats[i] * STEPS_PER_BEAT) * (this.beatLen(i) / STEPS_PER_BEAT);
  }
  bpmAt(ms) {
    return this.tc[this.indexAtMs(ms)].bpm;
  }
  /** この step がある小節の開始 step と、小節の step 数 */
  measureAtStep(step) {
    const i = this.indexAtStep(step);
    const c = this.tc[i];
    const stepsPerMeasure = c.n * STEPS_PER_BEAT * (4 / c.d) * (c.d / 4); // 分子拍 × 4 step（分母に関わらず 1拍=4step）
    const start0 = this.beats[i] * STEPS_PER_BEAT;
    const k = Math.floor((step - start0 + 1e-6) / stepsPerMeasure);
    return { start: start0 + k * stepsPerMeasure, len: stepsPerMeasure, index: i, number: k };
  }
}
