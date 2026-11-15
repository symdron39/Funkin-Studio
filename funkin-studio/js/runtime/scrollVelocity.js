/* ============================================================
   runtime/scrollVelocity.js — ScrollVelocity イベント（V-Slice 0.9 の ScrollVelocityTimeline.hx を移植）
   ------------------------------------------------------------
   ScrollSpeed は「ノーツの速さ」そのものを変えるのに対し、ScrollVelocity は「ノーツがいま描かれている曲の時刻（visual time）」を
   ずらす。velocity = 1 が通常、0 で止まり、負で戻る。変化が終わって 1 倍に戻るときは、ずれた分を戻りの ease で埋めて、
   判定の時刻にぴったり合うようにする（stretch / add）。
   ・visualTime(time)  : 実際の曲の時刻 → ノーツを描く基準の時刻
   ・stretchStartAt    : いま「1 倍ではない区間」の始まり（無ければ -1）
   ・stepLag / lagToVisual : スクロール速度が変わっても絵が跳ねないよう、ずれを px で持ち越す（Strumline.updateNotes）
   [出典] source/funkin/play/notes/ScrollVelocityTimeline.hx / Strumline.hx updateNotes
   ============================================================ */
import { easeByName } from "./runtime.js";

const SLICES = 32;
const NORMAL = 0.0001;
const isNormal = (v) => Math.abs(v - 1) <= NORMAL;
const isAway = (s) => !isNormal(s.to) || (s.setStart && !isNormal(s.from));

function velocityOf(seg, time) {
  const ease = seg.ease;
  if (!ease || seg.duration <= 0 || time >= seg.time + seg.duration) return seg.to;
  if (time <= seg.time) return seg.from;
  return seg.from + (seg.to - seg.from) * ease((time - seg.time) / seg.duration);
}
function integrate(seg, from, to) {
  if (to <= from) return 0;
  if (!seg.ease || seg.duration <= 0) return seg.to * (to - from);
  const easeEnd = Math.min(to, seg.time + seg.duration);
  let total = 0;
  if (easeEnd > from) {
    const slice = (easeEnd - from) / SLICES;
    for (let i = 0; i < SLICES; i++) total += velocityOf(seg, from + slice * (i + 0.5)) * slice;
  }
  if (to > easeEnd) total += seg.to * (to - Math.max(easeEnd, from));
  return total;
}

export class ScrollVelocityTimeline {
  /** events: 譜面のイベント { t, e, v }。strumline: "player" | "opponent"。stepMsAt(ms): その時刻の 1 ステップの長さ(ms) */
  constructor(events, strumline, stepMsAt) {
    this.segments = [{ time: 0, from: 1, to: 1, duration: 0, ease: null, setStart: false }];
    const list = events.filter((e) => e.e === "ScrollVelocity").sort((a, b) => a.t - b.t);
    for (const ev of list) {
      const v = ev.v ?? {};
      const target = v.strumline ?? "both";
      if (target !== "both" && target !== strumline) continue;
      const time = Math.max(0, ev.t);
      while (this.segments.length > 1 && this.segments[this.segments.length - 1].time > time) this.segments.pop(); // 後のイベントが前を打ち切る
      const useStart = !!v.useStart;
      const from = useStart ? Number(v.startVelocity ?? this.velocityAt(time)) : this.velocityAt(time);
      const fn = easeByName(v.ease ?? "linear", v.easeDir ?? "In");
      const easeFunction = typeof fn === "function" ? fn : null; // INSTANT は null
      const steps = Number(v.duration ?? 4);
      const duration = easeFunction && steps > 0 ? steps * stepMsAt(time) : 0;
      this.segments.push({ time, from, to: Number(v.velocity ?? 1), duration, ease: duration > 0 ? easeFunction : null, setStart: useStart && duration > 0 });
    }
    this.rawStarts = [0];
    for (let i = 1; i < this.segments.length; i++) {
      const prev = this.segments[i - 1];
      this.rawStarts.push(this.rawStarts[i - 1] + integrate(prev, prev.time, this.segments[i].time));
    }
    this.buildStretches();
  }
  get hasEvents() {
    return this.segments.length > 1;
  }
  buildStretches() {
    const segs = this.segments;
    this.stretches = [];
    let index = 1;
    while (index < segs.length) {
      if (!isAway(segs[index])) {
        index++;
        continue;
      }
      const start = segs[index].time;
      let back = index;
      while (back < segs.length && !isNormal(segs[back].to)) back++;
      if (back >= segs.length) {
        this.stretches.push({ start, returnStart: Infinity, end: Infinity, returnEase: null, add: 0 });
        break;
      }
      const ret = segs[back];
      let end = ret.time + ret.duration;
      if (back + 1 < segs.length) end = Math.min(end, segs[back + 1].time);
      this.stretches.push({ start, returnStart: ret.time, end, returnEase: ret.ease, add: end - start - (this.rawTime(end) - this.rawTime(start)) });
      index = back + 1;
    }
  }
  segmentIndexAt(time) {
    let low = 0,
      high = this.segments.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.segments[mid].time <= time) low = mid;
      else high = mid - 1;
    }
    return low;
  }
  rawTime(time) {
    const i = this.segmentIndexAt(time);
    const seg = this.segments[i];
    return this.rawStarts[i] + integrate(seg, seg.time, time);
  }
  velocityAt(time) {
    return velocityOf(this.segments[this.segmentIndexAt(time)], time);
  }
  stretchStartAt(time) {
    if (!this.hasEvents || time <= 0) return -1;
    for (const s of this.stretches) {
      if (time < s.start) break;
      if (time < s.end) return s.start;
    }
    return -1;
  }
  visualTime(time) {
    if (!this.hasEvents || time <= 0) return time;
    for (const s of this.stretches) {
      if (time < s.start) break;
      if (time >= s.end) continue;
      const visual = s.start + this.rawTime(time) - this.rawTime(s.start);
      if (time < s.returnStart) return visual;
      const length = s.end - s.returnStart;
      let progress = 1;
      if (length > 0) progress = s.returnEase ? s.returnEase((time - s.returnStart) / length) : (time - s.returnStart) / length;
      return visual + s.add * progress;
    }
    return time; // どの区間にも入っていなければ 1 倍で、ノーツは時刻どおり
  }
  static stepLag(lagPixels, previousLag, lag, speed) {
    if (Math.abs(lag) < Math.abs(previousLag)) return (lagPixels * lag) / previousLag;
    return lagPixels + (lag - previousLag) * speed;
  }
  static lagToVisual(time, lagPixels, lag, speed) {
    if (Math.abs(speed) < NORMAL) return time - lag;
    return time - lagPixels / speed;
  }
}

/** Strumline.updateNotes の「visualSongPosition」を、1 フレームごとに更新して返す状態つきのヘルパー */
export class VisualClock {
  constructor(timeline) {
    this.tl = timeline;
    this.reset();
  }
  reset() {
    this.stretchStart = -1;
    this.lagPixels = 0;
    this.lagPrev = 0;
    this.lastTime = -Infinity;
  }
  update(songTime, speed) {
    const tl = this.tl;
    if (!tl?.hasEvents) return songTime;
    const stretchStart = tl.stretchStartAt(songTime);
    const lag = songTime - tl.visualTime(songTime);
    if (stretchStart !== this.stretchStart || songTime < this.lastTime) {
      this.stretchStart = stretchStart;
      this.lagPixels = lag * speed;
    } else this.lagPixels = ScrollVelocityTimeline.stepLag(this.lagPixels, this.lagPrev, lag, speed);
    this.lagPrev = lag;
    this.lastTime = songTime;
    return stretchStart < 0 ? songTime - lag : ScrollVelocityTimeline.lagToVisual(songTime, this.lagPixels, lag, speed);
  }
}
