/* ============================================================
   chart/audio.js — Chart Editor の音声（Inst / Voices の複数トラック）
   ------------------------------------------------------------
   Web Audio API。トラックごとに AudioBuffer・音量・ミュート・波形ピーク（10ms ごとの最大振幅）を持つ。
   再生中の位置は AudioContext の時計から求める（setInterval 等のズレが出ない）。
   曲の位置 posMs に対して、音声側の位置は (posMs − offset)。offset > 0 なら音声が遅れて始まる。
   ============================================================ */
export const PEAK_MS = 10;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.tracks = []; // { id, kind: "inst"|"vocal", name, bytes(Uint8Array), buffer, peaks, gain, volume, muted, wave, offset }
    this.playing = false;
    this.rate = 1;
    this._startCtx = 0;
    this._startPos = 0;
    this._sources = [];
  }
  _ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") this.ctx.resume?.();
    return this.ctx;
  }
  /** バイト列から読み込む。同じ id があれば置き換える */
  async load(id, kind, name, bytes) {
    const ctx = this._ensure();
    const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
    const old = this.tracks.findIndex((t) => t.id === id);
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const tr = { id, kind, name, bytes, buffer, peaks: computePeaks(buffer), gain, volume: 1, muted: false, wave: kind === "inst", offset: 0, active: true };
    if (old >= 0) {
      const prev = this.tracks[old];
      tr.volume = prev.volume;
      tr.muted = prev.muted;
      tr.wave = prev.wave;
      tr.offset = prev.offset;
      this.tracks[old] = tr;
    } else this.tracks.push(tr);
    this._applyGain(tr);
    if (this.playing) this.pause();
    return tr;
  }
  remove(id) {
    this.pause();
    this.tracks = this.tracks.filter((t) => t.id !== id);
  }
  clear() {
    this.pause();
    this.tracks = [];
  }
  _applyGain(t) {
    t.gain.gain.value = t.muted ? 0 : t.volume;
  }
  setVolume(id, v) {
    const t = this.tracks.find((x) => x.id === id);
    if (t) ((t.volume = v), this._applyGain(t));
  }
  setMuted(id, m) {
    const t = this.tracks.find((x) => x.id === id);
    if (t) ((t.muted = m), this._applyGain(t));
  }
  get durationMs() {
    return this.tracks.reduce((m, t) => (t.active === false ? m : Math.max(m, t.buffer.duration * 1000 + t.offset)), 0);
  }
  /** 再生中なら現在位置、停止中なら止めた位置 */
  position() {
    if (!this.playing) return this._startPos;
    return this._startPos + (this.ctx.currentTime - this._startCtx) * 1000 * this.rate;
  }
  seek(ms) {
    const was = this.playing;
    if (was) this.pause();
    this._startPos = ms;
    if (was) this.play();
  }
  play() {
    if (this.playing) return;
    const ctx = this._ensure();
    this._startCtx = ctx.currentTime + 0.03;
    this._sources = [];
    for (const t of this.tracks) {
      if (t.active === false) continue;
      const startAt = (this._startPos - t.offset) / 1000; // 音声ファイル内の開始位置（秒）
      const src = ctx.createBufferSource();
      src.buffer = t.buffer;
      src.playbackRate.value = this.rate;
      src.connect(t.gain);
      if (startAt >= 0) {
        if (startAt < t.buffer.duration) src.start(this._startCtx, startAt);
      } else src.start(this._startCtx + -startAt / this.rate, 0);
      this._sources.push(src);
    }
    this.playing = true;
  }
  pause() {
    if (!this.playing) return;
    this._startPos = this.position();
    for (const s of this._sources) {
      try {
        s.stop();
      } catch {}
    }
    this._sources = [];
    this.playing = false;
  }
  setRate(r) {
    const was = this.playing;
    if (was) this.pause();
    this.rate = r;
    if (was) this.play();
  }
  /** ヒット音（短いクリック） */
  tick(high = false) {
    const ctx = this._ensure();
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.frequency.value = high ? 1500 : 1000;
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.06);
  }
}

/** 10ms ごとの最大振幅（0〜1）。全チャンネルの最大 */
function computePeaks(buffer) {
  const per = Math.max(1, Math.round(buffer.sampleRate * (PEAK_MS / 1000)));
  const n = Math.ceil(buffer.length / per);
  const peaks = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let m = peaks[i];
      const end = Math.min(d.length, (i + 1) * per);
      for (let j = i * per; j < end; j += 2) {
        const a = d[j] < 0 ? -d[j] : d[j];
        if (a > m) m = a;
      }
      peaks[i] = m;
    }
  }
  return peaks;
}
