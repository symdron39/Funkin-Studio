/* ============================================================
   runtime/stageScene.js — プレイテストの「ステージとキャラクター」
   ------------------------------------------------------------
   読み込んだ mod（Workspace）から、ステージ JSON と character JSON を探し、実際に描いて動かす。
     ・ステージの props（画像 / 単色 / Sparrow・Packer・AnimateAtlas のアニメ付き）を zIndex 順に描く
     ・BF / DAD / GF を character JSON から出し、拍で idle / dance、ノートで sing / miss
     ・カメラ: FocusCamera（キャラ追従）/ ZoomCamera / ステージの cameraZoom / 4 拍ごとの軽いズーム
     ・mod に無いアセット（ベースゲームのステージ・キャラなど）は、仮の絵（点線の枠 + 名前）にして警告を出す。
       → 絵が無くても BF・DAD・GF の「入れ物」は必ず存在するので、スクリプトの getBoyfriend() などで落ちない。
   座標・足元・カメラ焦点の計算は Stage Editor（states/stage/stageCharacter.js）と同じ規則を使う。

   ※ 近似・未確認の点（V-Slice のソースで確かめていないもの）:
     ・カメラの追従の速さ（lerp 0.04 / 60fps 相当） ・4 拍ごとのズーム量(0.015)と戻り方 ・sing から idle へ戻る時刻
     ・FocusCamera の ease（CLASSIC 以外は簡易な補間）   ・反転したキャラのアニメオフセットの符号
   ============================================================ */
import { findSpriteAtlas, findAnimateAtlas } from "../states/stage/atlas.js";
import { StageCharacter, atlasKindOf } from "../states/stage/stageCharacter.js";
import { loadImage } from "../states/stage/sparrowAtlas.js";
import { normalizeStage, isSolid, isAnimated, getScale, getScroll, parseColor, toRgbaCss, blendToCanvas, defaultCharacter } from "../states/stage/stageData.js";
import { originOf, infoOf } from "../services/ModPack.js";
import { easeByName } from "./runtime.js";

export const FRAME_W = 1280,
  FRAME_H = 720;
const ROLES = ["player", "opponent", "girlfriend"]; // 0 = BF, 1 = DAD, 2 = GF（FocusCamera の char 番号）
const STAGE_KEY = { player: "bf", opponent: "dad", girlfriend: "gf" };
const SING = ["singLEFT", "singDOWN", "singUP", "singRIGHT"];
// 標準ステージ（mainStage）の位置。ステージ JSON が無いときの仮配置
const FALLBACK_POS = { bf: [989.5, 885], dad: [335, 885], gf: [751.5, 787] };
const PLACEHOLDER_COLOR = { player: "#4fc3f7", opponent: "#ef5350", girlfriend: "#ab47bc" };
const smooth = (t) => t * t * (3 - 2 * t);
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);
const stripBom = (s) => s.replace(/^﻿/, "");

// ------------------------------------------------------------------ アニメを持つ絵（キャラ・prop 共通）
class Actor {
  /** anims: JSON の animations 配列 / atlasOf(anim) → { atlas, indexOnly } | null */
  constructor(anims, atlasOf, ref) {
    this.anims = anims || [];
    this.atlasOf = atlasOf;
    this.ref = ref; // 基準フレーム（枠の大きさと stageMatrix の基準）
    this.cur = null;
    this.t = 0; // 再生してからの秒
    this.frozen = false;
    this.danceLeft = true;
  }
  has(name) {
    return this.anims.some((a) => a.name === name);
  }
  animOf(name) {
    return this.anims.find((a) => a.name === name) || null;
  }
  play(name, force = true, reversed = false) {
    const a = this.animOf(name);
    if (!a) return false;
    if (!force && this.cur === a && !this.finished) return true; // 再生中の同じアニメは、restart でなければそのまま
    this.cur = a;
    this.t = 0;
    this.rev = !!reversed;
    return true;
  }
  get name() {
    return this.cur?.name ?? "";
  }
  get length() {
    const v = this.atlasOf(this.cur);
    return v ? v.atlas.frames(this.cur, { indexOnly: v.indexOnly }).length : 0;
  }
  get finished() {
    if (!this.cur) return true;
    if (this.cur.looped) return false;
    const n = this.length;
    return n <= 1 ? this.t > 0.05 : this.t * (num(this.cur.frameRate, 24) || 24) >= n;
  }
  update(dt) {
    if (!this.frozen) this.t += dt;
  }
  /** いまのフレーム（無ければ null） */
  frame() {
    const a = this.cur;
    if (!a) return null;
    const v = this.atlasOf(a);
    if (!v) return null;
    const seq = v.atlas.frames(a, { indexOnly: v.indexOnly });
    if (!seq.length) return null;
    const n = Math.floor(this.t * (num(a.frameRate, 24) || 24));
    const i = a.looped ? n % seq.length : Math.min(n, seq.length - 1);
    return seq[this.rev ? seq.length - 1 - i : i] ?? seq[0];
  }
  get offsets() {
    const o = this.cur?.offsets;
    return [num(o?.[0], 0), num(o?.[1], 0)];
  }
}

// ------------------------------------------------------------------ キャラクター
class SceneChar {
  constructor(role) {
    this.role = role;
    this.id = "";
    this.json = null;
    this.sc = null; // StageCharacter（基準フレーム・位置計算）
    this.actor = null;
    this.holdTimer = 0; // sing してからの ms
    this.canPlayOther = true;
    this.ignoreExclusion = [];
    this.missing = true;
    this.pos = [0, 0];
    this.zIndex = 0;
    this.scaleStage = 1;
    this.camOffsets = [0, 0];
    this.scroll = [1, 1];
    this.alpha = 1;
    this.visible = true;
    this.extra = new Map(); // アニメ個別の assetPath → アトラス
  }
  get danceEvery() {
    return num(this.json?.danceEvery, 1);
  }
  get singTime() {
    return num(this.json?.singTime, 8);
  }
  get hasDanceLR() {
    return !!this.actor?.has("danceLeft");
  }
  /** sing で始まり -end で終わらないアニメの最中（実ソース BaseCharacter.isSinging） */
  get isSinging() {
    const n = this.actor?.name ?? "";
    return n.startsWith("sing") && !n.endsWith("-end");
  }
  get singing() {
    return this.isSinging;
  }
  /** Bopper.dance + BaseCharacter.dance。force=false のときは、歌っている間・特別なアニメが終わるまでは踊らない */
  dance(force = false) {
    const a = this.actor;
    if (!a) return;
    if (!force) {
      if (this.isSinging) return;
      const n = a.name;
      if (!n.startsWith("dance") && !n.startsWith("idle") && !a.finished) return;
    }
    if (a.has("danceLeft")) {
      a.hasDanced = !!a.hasDanced;
      this.playRaw(a.hasDanced ? "danceRight" : "danceLeft", false);
      a.hasDanced = !a.hasDanced;
    } else this.playRaw("idle", false);
  }
  /** 制限なしで再生（dance 用。無いアニメは -xxx を外して探す） */
  playRaw(name, restart) {
    const cn = this.correct(name);
    if (cn) this.actor.play(cn, restart);
  }
  /** correctAnimationName: 無ければ後ろの -xxx を 1 つずつ外して探す。最後まで無ければ null */
  correct(name) {
    const a = this.actor;
    while (name) {
      if (a?.has(name)) return name;
      const i = name.lastIndexOf("-");
      if (i < 0) return null;
      name = name.slice(0, i);
    }
    return null;
  }
  /** playAnimation(name, restart=false, ignoreOther=false, reversed=false)（実ソース Bopper.playAnimation） */
  playAnim(name, restart = false, ignoreOther = false, reversed = false) {
    if (this.building) this.pendingAnim = [name, restart, ignoreOther, reversed]; // アトラス読み込み中に呼ばれたら、読めた直後に再生する
    const a = this.actor;
    if (!a) return false;
    if (this.canPlayOther === false) {
      const same = a.name === name && restart;
      if (!same) {
        const ex = this.ignoreExclusion ?? [];
        if (!ex.length || !ex.some((e) => name.startsWith(e))) return false; // ignoreOther 中は他のアニメを受け付けない
      }
    }
    const cn = this.correct(name);
    if (!cn) return false;
    a.play(cn, restart, reversed);
    if (ignoreOther) this.canPlayOther = false;
    return true;
  }
  /** 足元・枠の大きさ・カメラ焦点。実キャラが無いときは仮の寸法 */
  /** unplaced（ステージ未配置）のキャラは、左上 (0,0) になる足元の位置に直す */
  materialize() {
    if (!this.unplaced || !this.sc?.view) return;
    this.unplaced = false;
    const v = this.sc.view,
      k = v.baseScale * (Number(this.scaleStage) || 1);
    this.pos = [(v.refW * k) / 2 - v.global[0], v.refH * k - v.global[1]];
  }
  place() {
    this.materialize();
    const sc = { position: this.pos, scale: this.scaleStage, cameraOffsets: this.camOffsets };
    if (this.sc?.view) {
      const v = this.sc.view,
        [ax, ay] = this.actor?.offsets ?? v.anim;
      const k = v.baseScale * (Number(sc.scale) || 1);
      const [gx, gy] = v.global;
      const w = v.refW * k,
        h = v.refH * k;
      return {
        k,
        feetX: sc.position[0] + gx + (gx - ax) * k,
        feetY: sc.position[1] + gy + (gy - ay) * k,
        w,
        h,
        focusX: sc.position[0] + gx + v.camera[0] + sc.cameraOffsets[0],
        focusY: sc.position[1] + gy - h / 2 + v.camera[1] + sc.cameraOffsets[1],
        flip: this.role === "player" ? !v.flipX : v.flipX,
        loaded: true,
      };
    }
    const k = Number(sc.scale) || 1,
      w = 120 * k,
      h = 240 * k;
    return {
      k, feetX: sc.position[0], feetY: sc.position[1], w, h,
      focusX: sc.position[0] + sc.cameraOffsets[0], focusY: sc.position[1] - h / 2 + sc.cameraOffsets[1], flip: false, loaded: false,
    };
  }
  draw(ctx, label) {
    const pl = this.place();
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, this.alpha));
    ctx.translate(pl.feetX, pl.feetY);
    if (pl.loaded) {
      const v = this.sc.view,
        f = this.actor.frame() || v.frame;
      ctx.scale(pl.k, pl.k);
      ctx.imageSmoothingEnabled = !this.json?.isPixel;
      if (pl.flip) ctx.scale(-1, 1);
      // AnimateAtlas は「タイムラインの原点」を固定して描く（フレームごとに枠の左上へ寄せると、動くたびに絵が跳ねる）。基準枠は先頭フレーム
      f.draw(ctx, -v.refW / 2, -v.refH, v.frame, f.sp ? v.stageMatrix : true);
    } else {
      placeholder(ctx, -pl.w / 2, -pl.h, pl.w, pl.h, `${label}（${this.id || "?"} は未読み込み）`, PLACEHOLDER_COLOR[this.role]);
    }
    ctx.restore();
  }
}

function placeholder(ctx, x, y, w, h, text, color = "#ff6b6b") {
  ctx.save();
  ctx.fillStyle = color + "33";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 9]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, x + w / 2, y + h / 2, Math.max(60, w - 8));
  ctx.restore();
}

// ------------------------------------------------------------------ ステージ全体
export class StageScene {
  /**
   * @param o { files: ()=>ファイルの山, origin, say(msg), timing(): {msToStep, stepToMs}, events(): 譜面のイベント }
   */
  constructor(o) {
    this.o = o;
    this.warnings = [];
    this.stageId = "";
    this.doc = null;
    this.stageMissing = true;
    this.props = []; // { ref, kind: solid|image|actor|missing, img?, actor?, w, h, z, ord }
    this.chars = Object.fromEntries(ROLES.map((r) => [r, new SceneChar(r)]));
    this.zoomBase = 1; // ステージの cameraZoom
    this.zoom = 1;
    this.bop = 0; // 4 拍ごとの一時的なズーム
    this.cam = { x: FRAME_W / 2, y: FRAME_H / 2 }; // 焦点（ワールド座標）
    this.extra = []; // スクリプトが stage.add したキャラ
    this.charFiles = new Map();
    this.focusEvents = [];
    this.zoomEvents = [];
    this.bopEvents = [];
    this.bi = 0;
    this.focusTarget = { x: FRAME_W / 2, y: FRAME_H / 2 };
    this.tweenZoom = null;
    this.lastBeat = -99;
    this.fi = 0;
    this.zi = 0;
    this.loaded = false;
  }
  warn(msg) {
    if (!this.warnings.includes(msg)) this.warnings.push(msg);
  }
  get pool() {
    return this.o.files();
  }
  resolveFile(kind, id) {
    return this.o.resolve(kind, id, { origin: this.o.origin, quiet: true });
  }

  // ---------------- 読み込み ----------------
  async load({ stage, characters }) {
    this.stageId = stage || "";
    this.indexCharacters();
    await this.loadStage(stage);
    for (const role of ROLES) await this.loadChar(role, characters?.[role]);
    this.zoom = this.zoomBase;
    this.loaded = true;
  }
  /** mod 内の data/characters/*.json を id 別に控える（fetchCharacter を同期で呼べるように） */
  indexCharacters() {
    this.charFiles = new Map();
    for (const f of this.pool) {
      if (!/\.json$/i.test(f.name || "")) continue;
      if (!infoOf(f).noExt.startsWith("data/characters/")) continue;
      this.charFiles.set(String(f.name).replace(/^.*[\\/]/, "").replace(/\.json$/i, ""), f);
    }
  }
  /** CharacterDataParser.fetchCharacter(id): 新しいキャラを作る（ステージには add するまで出ない）。無ければ null */
  fetchCharacter(id) {
    const f = this.charFiles.get(id) || this.resolveFile("character", id);
    if (!f) {
      this.warn(`fetchCharacter("${id}"): 読み込んだ mod にキャラクターがありません（null を返しました）`);
      return null;
    }
    const c = new SceneChar("other");
    c.id = id;
    c.pos = [0, 0];
    c.unplaced = true; // ステージに置かれていないキャラは、スプライトの左上が (0, 0)（スクリプトが x / y を決めるまで）
    c.actor = new Actor([], () => null, null);
    c.building = true;
    c.built = this.buildChar(c, f, id, "bf").finally(() => {
      c.building = false;
      if (c.pendingAnim) c.playAnim(...c.pendingAnim);
      c.pendingAnim = null;
    });
    return this.apiOf(c);
  }
  addExtra(c) {
    if (c && !this.extra.includes(c)) this.extra.push(c);
  }
  removeExtra(c) {
    this.extra = this.extra.filter((x) => x !== c);
  }
  async loadStage(id) {
    let doc = null;
    const f = id ? this.resolveFile("stage", id) : null;
    if (f) {
      try {
        doc = normalizeStage(JSON.parse(stripBom(await f.text())));
        this.stageMissing = false;
        this.stageOrigin = originOf(f);
      } catch (e) {
        this.warn(`ステージ「${id}」のJSONを読めません: ${e.message}`);
      }
    } else if (id) this.warn(`ステージ「${id}」が読み込んだ mod の中に見つかりません（ベースゲームのステージなどは含まれません）。仮の背景で動かします。`);
    else this.warn("この曲にはステージが指定されていません（metadata の playData.stage）。仮の背景で動かします。");
    this.doc = doc || normalizeStage({ name: id || "(no stage)", props: [], characters: {} });
    if (!doc) for (const k of Object.keys(FALLBACK_POS)) this.doc.characters[k].position = FALLBACK_POS[k].slice();
    this.zoomBase = num(this.doc.cameraZoom, 1);
    this.props = [];
    let ord = 0;
    for (const p of this.doc.props) {
      const entry = { ref: p, ord: ord++, z: p.zIndex, kind: "missing", w: 200, h: 100 };
      try {
        await this.loadProp(entry);
      } catch (e) {
        this.warn(`prop「${p.name || p.assetPath}」: ${e.message}`);
        entry.kind = "missing";
      }
      this.props.push(entry);
    }
  }
  async loadProp(e) {
    const p = e.ref,
      [sx, sy] = getScale(p);
    if (isSolid(p)) {
      e.kind = "solid";
      e.w = Math.abs(sx);
      e.h = Math.abs(sy);
      return;
    }
    const origin = this.stageOrigin ?? this.o.origin;
    const type = String(p.animType || "sparrow").toLowerCase();
    if (isAnimated(p) && ["sparrow", "packer", "animateatlas"].includes(type)) {
      const pool = this.pool;
      let atlas;
      try {
        atlas = type === "animateatlas" ? await findAnimateAtlas(pool, p.assetPath, { origin }) : await findSpriteAtlas(pool, p.assetPath, type, { origin });
      } catch (err) {
        this.warn(`prop「${p.assetPath}」のアトラスが見つかりません（${err.message}）`);
        return;
      }
      const ref = atlas.first();
      if (!ref) return;
      const getter = () => ({ atlas, indexOnly: type === "packer" });
      e.actor = new Actor(p.animations, getter, ref);
      e.kind = "actor";
      e.w = ref.w * Math.abs(sx);
      e.h = ref.h * Math.abs(sy);
      e.ref = p;
      e.refFrame = ref;
      e.stageMatrix = !!p.atlasSettings?.applyStageMatrix;
      const start = p.startingAnimation && e.actor.has(p.startingAnimation) ? p.startingAnimation : p.animations[0]?.name;
      e.actor.play(start, true);
      e.danceEvery = num(p.danceEvery, 0);
      return;
    }
    const f = this.o.resolve("image", p.assetPath, { origin, quiet: true });
    if (!f) {
      this.warn(`画像「${p.assetPath}」が見つかりません（ベースゲームの画像などは含まれません）`);
      return;
    }
    e.img = await loadImage(f);
    e.kind = "image";
    e.w = e.img.naturalWidth * Math.abs(sx);
    e.h = e.img.naturalHeight * Math.abs(sy);
  }
  async loadChar(role, id) {
    const c = this.chars[role],
      key = STAGE_KEY[role];
    const sd = this.doc.characters[key] ?? defaultCharacter(key);
    c.id = id || "";
    c.pos = sd.position.slice();
    c.zIndex = sd.zIndex;
    c.scaleStage = num(sd.scale, 1);
    c.camOffsets = sd.cameraOffsets.slice();
    c.scroll = getScroll(sd);
    c.alpha = num(sd.alpha, 1);
    const f = id ? this.charFiles.get(id) || this.resolveFile("character", id) : null;
    if (!f) {
      this.warn(id ? `キャラクター「${id}」（${key}）が読み込んだ mod の中に見つかりません。仮の枠で動かします。` : `${key} に使うキャラクターが指定されていません。`);
      c.actor = new Actor([], () => null, null);
      return;
    }
    await this.buildChar(c, f, id, key);
  }
  /** character JSON とアトラスを読んで SceneChar に反映する（失敗しても仮の枠のまま動く） */
  async buildChar(c, f, id, key = "bf") {
    try {
      const sc = new StageCharacter(key);
      if (!(await sc.setJsonFrom([f]))) throw Error("animations を持つ JSON ではありません");
      await sc.resolve(this.pool);
      c.sc = sc;
      c.json = sc.json;
      c.missing = false;
      const json = sc.json,
        pool = this.pool,
        origin = originOf(f);
      const main = { atlas: sc.atlas, kind: sc.need.kind, path: sc.need.path };
      const cache = new Map([[main.path + "|" + main.kind, main]]);
      const loading = new Set();
      const atlasOf = (anim) => {
        const path = (anim?.assetPath || json.assetPath || "").trim();
        const kind = atlasKindOf(json, anim?.assetPath ? anim : null);
        const k = path + "|" + kind;
        const hit = cache.get(k);
        if (hit) return { atlas: hit.atlas, indexOnly: hit.kind === "packer" };
        if (!loading.has(k)) {
          loading.add(k);
          // 他のアトラスは使うときに非同期で読む（読めるまでは基準のアトラスで代用）
          (kind === "animate" ? findAnimateAtlas(pool, path, { origin }) : findSpriteAtlas(pool, path, kind, { origin }))
            .then((atlas) => cache.set(k, { atlas, kind, path }))
            .catch((e) => this.warn(`${id}: アトラス「${path}」が見つかりません（${e.message}）`));
        }
        return { atlas: main.atlas, indexOnly: main.kind === "packer" };
      };
      c.actor = new Actor(json.animations, atlasOf, sc.view.frame);
      c.dance(true);
      if (json.startingAnimation && c.actor.has(json.startingAnimation)) c.actor.play(json.startingAnimation, true);
    } catch (e) {
      this.warn(`キャラクター「${id}」を読み込めません: ${e.message}`);
      c.actor = new Actor([], () => null, null);
    }
  }

  // ---------------- 開始・更新 ----------------
  /** startMs の時点のカメラに合わせて開始する（イベントは譜面から取り込む） */
  start(startMs) {
    const evs = this.o.events?.() ?? [];
    this.focusEvents = evs.filter((e) => e.e === "FocusCamera").sort((a, b) => a.t - b.t);
    this.zoomEvents = evs.filter((e) => e.e === "ZoomCamera").sort((a, b) => a.t - b.t);
    this.bopEvents = evs.filter((e) => e.e === "BopCameraOnce").sort((a, b) => a.t - b.t);
    this.bi = 0;
    this.fi = 0;
    this.zi = 0;
    this.zoom = this.zoomBase;
    this.tweenZoom = null;
    this.tweenCam = null;
    this.bop = 0;
    this.lastBeat = -99;
    this.lastStep = undefined;
    this.focusTarget = this.focusPoint("opponent");
    this.advanceEvents(startMs, true);
    this.cam = { ...this.focusTarget };
    for (const c of Object.values(this.chars)) c.dance(true);
  }
  focusPointOf(c) {
    const p = c.place();
    return { x: p.focusX, y: p.focusY };
  }
  focusPoint(role) {
    const p = this.chars[role].place();
    return { x: p.focusX, y: p.focusY };
  }
  /** FocusCamera / ZoomCamera のうち、pos までに来たものを適用する */
  advanceEvents(pos, snap = false) {
    const stepMs = this.stepMs();
    while (this.fi < this.focusEvents.length && this.focusEvents[this.fi].t <= pos) {
      const e = this.focusEvents[this.fi++],
        v = e.v ?? {};
      const ch = Number(v.char ?? 0),
        ox = num(v.x, 0),
        oy = num(v.y, 0);
      const base = ch === -1 ? { x: 0, y: 0 } : this.focusPoint(ROLES[ch] ?? "player");
      const target = { x: base.x + ox, y: base.y + oy };
      // FocusCameraSongEvent: CLASSIC = 追従点を置くだけ（lerp で追う）/ INSTANT = 即座に移動 / それ以外 = ease で動かし、終わったら追従に戻る
      const fn = easeByName(v.ease ?? "CLASSIC", v.easeDir ?? "In"); // FocusCamera は ease 未指定なら CLASSIC
      const dur = Math.max(0, num(v.duration, 4)) * stepMs;
      this.focusTarget = target;
      if (fn === "classic") this.tweenCam = null;
      else if (fn === null || snap || dur <= 0 || pos - e.t >= dur) {
        this.cam = { ...target };
        this.tweenCam = null;
      } else this.tweenCam = { from: { ...this.cam }, to: target, t0: e.t, dur, fn };
    }
    // BopCameraOnce（0.9）: 拍と関係なく、カメラを 1 回だけ弾ませる（強さ 1 = 通常の 1.015 倍）
    while (this.bi < this.bopEvents.length && this.bopEvents[this.bi].t <= pos) {
      const e = this.bopEvents[this.bi++];
      if (!snap) this.bop += (1.015 * num(e.v?.camGame, 1) - 1) * this.zoomBase;
    }
    while (this.zi < this.zoomEvents.length && this.zoomEvents[this.zi].t <= pos) {
      const e = this.zoomEvents[this.zi++],
        v = e.v ?? {};
      const target = String(v.mode || "direct").toLowerCase() === "stage" ? num(v.zoom, 1) * this.zoomBase : num(v.zoom, 1);
      const dur = Math.max(0, num(v.duration, 4)) * stepMs;
      const fn = easeByName(v.ease ?? "linear", v.easeDir ?? "In");
      if (fn === null || fn === "classic" || snap || dur <= 0 || pos - e.t >= dur) {
        this.zoom = target;
        this.tweenZoom = null;
      } else this.tweenZoom = { from: this.zoom, to: target, t0: e.t, dur, fn };
    }
  }
  stepMs() {
    const tm = this.o.timing?.();
    return tm ? Math.max(1, tm.stepToMs(1) - tm.stepToMs(0)) : 125;
  }
  /** 毎フレーム: dtMs = 経過ms（再生速度込み）、pos = 曲の位置(ms) */
  update(dtMs, pos) {
    const dt = dtMs / 1000;
    this.advanceEvents(pos);
    const tm = this.o.timing?.();
    const stepMs = this.stepMs();
    // ステップごとのダンス（Bopper.onStepHit: step % (danceEvery × 4) == 0）
    if (tm && pos >= -4000) {
      const step = Math.floor(tm.msToStep(pos));
      if (this.lastStep !== undefined && step > this.lastStep && step - this.lastStep <= 8) {
        for (let s2 = this.lastStep + 1; s2 <= step; s2++)
          for (const c of [...Object.values(this.chars), ...this.extra]) {
            const ev = c.danceEvery;
            if (ev > 0 && s2 % (ev * 4) === 0) c.dance(false);
          }
      }
      this.lastStep = step;
    }
    // 拍
    if (tm && pos >= -4000) {
      const beat = Math.floor(tm.msToStep(pos) / 4);
      if (beat !== this.lastBeat) {
        if (this.lastBeat !== -99 && beat > this.lastBeat) this.onBeat(beat);
        this.lastBeat = beat;
      }
    }
    // キャラ・prop のアニメ（BaseCharacter.onUpdate 相当）
    for (const c of [...Object.values(this.chars), ...this.extra]) {
      const a = c.actor;
      if (!a) continue;
      a.update(dt);
      if (c.canPlayOther === false && a.finished) c.canPlayOther = true;
      // 終わったら「名前-hold」を続けて再生する
      if (a.cur && a.finished && !a.name.endsWith("-hold") && a.has(a.name + "-hold")) a.play(a.name + "-hold", false);
      if (c.isSinging) {
        c.holdTimer += dtMs;
        const lim = c.singTime * stepMs * (/miss$/.test(a.name) ? 2 : 1); // miss は 2 倍（実ソース）
        if (c.holdTimer > lim) {
          const base = a.name.replace(/-hold$/, "");
          c.holdTimer = 0;
          if (a.has(base + "-end")) a.play(base + "-end", false);
          else c.dance(true);
        }
      } else c.holdTimer = 0;
    }
    for (const p of this.props) p.actor?.update(dt);
    // ズーム（イベント → 4 拍ごとの揺れ）
    if (this.tweenZoom) {
      const z = this.tweenZoom,
        r = Math.min(1, (pos - z.t0) / z.dur);
      this.zoom = z.from + (z.to - z.from) * z.fn(r);
      if (r >= 1) this.tweenZoom = null;
    }
    this.bop *= Math.pow(0.95, dt * 60);
    // カメラ追従（lerp 0.04 を 60fps 基準に補正）
    if (this.tweenCam) {
      // ease 付きの移動: 追従を止めて動かし、終わったら追従点に合わせる（resetCamera）
      const tw = this.tweenCam,
        r = Math.min(1, (pos - tw.t0) / tw.dur),
        f = tw.fn(r);
      this.cam = { x: tw.from.x + (tw.to.x - tw.from.x) * f, y: tw.from.y + (tw.to.y - tw.from.y) * f };
      if (r >= 1) {
        this.cam = { ...tw.to };
        this.tweenCam = null;
      }
    } else {
      const a = 1 - Math.pow(1 - 0.04, Math.min(dt, 0.1) * 60);
      this.cam.x += (this.focusTarget.x - this.cam.x) * a;
      this.cam.y += (this.focusTarget.y - this.cam.y) * a;
    }
  }
  onBeat(beat) {
    for (const p of this.props) {
      if (p.actor && p.danceEvery > 0 && beat % p.danceEvery === 0) {
        const a = p.actor;
        if (a.has("danceLeft")) {
          a.danceLeft = !a.danceLeft;
          a.play(a.danceLeft ? "danceLeft" : "danceRight", true);
        } else if (a.has("idle")) a.play("idle", true);
      }
    }
    if (beat % 4 === 0) this.bop = 0.015 * this.zoomBase;
  }

  // ---------------- ノートからの操作 ----------------
  sing(role, lane, miss = false, suffix = "") {
    const c = this.chars[role];
    if (!c) return;
    // V-Slice: sing{DIR}{miss}{-suffix}。無ければ後ろの -xxx を 1 つずつ外して探す（correctAnimationName）
    let name = SING[lane] + (miss ? "miss" : "") + (suffix ? "-" + suffix : "");
    while (name && !c.actor?.has(name)) {
      const i = name.lastIndexOf("-");
      if (i < 0) break;
      name = name.slice(0, i);
    }
    if (!c.playAnim(name, true) && miss) c.playAnim(SING[lane], true); // miss 用が無ければ普通の sing
    c.holdTimer = 0;
  }
  keepSinging(role) {
    const c = this.chars[role];
    if (c?.singing) c.holdTimer = 0;
  }

  // ---------------- 描画 ----------------
  /** W×H の画面に、1280×720 の枠を中央に置いて描く（枠の外は切る） */
  draw(ctx, W, H) {
    const k = Math.min(W / FRAME_W, H / FRAME_H),
      ox = (W - FRAME_W * k) / 2,
      oy = (H - FRAME_H * k) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, FRAME_W * k, FRAME_H * k);
    ctx.clip();
    ctx.translate(ox, oy);
    ctx.scale(k, k);
    ctx.fillStyle = this.stageMissing ? "#1a1f2b" : "#000";
    ctx.fillRect(0, 0, FRAME_W, FRAME_H);
    const z = Math.max(0.05, this.zoom + this.bop);
    const scrollX = this.cam.x - FRAME_W / 2,
      scrollY = this.cam.y - FRAME_H / 2;
    const list = [
      ...this.props.map((p) => ({ z: p.z, ord: p.ord, prop: p })),
      ...[...ROLES.map((r) => this.chars[r]), ...this.extra].map((c, i) => ({ z: c.zIndex, ord: 1e6 + i, char: c })),
    ].sort((a, b) => a.z - b.z || a.ord - b.ord);
    if (this.stageMissing) {
      ctx.save();
      this.world(ctx, z, scrollX, scrollY, [1, 1]);
      ctx.fillStyle = "#262d3d";
      ctx.fillRect(-2000, 900, 6000, 1200); // 仮の床
      ctx.restore();
    }
    for (const o of list) {
      ctx.save();
      const sf = o.char ? o.char.scroll : getScroll(o.prop.ref);
      this.world(ctx, z, scrollX, scrollY, sf);
      if (o.char) {
        if (o.char.visible) o.char.draw(ctx, (STAGE_KEY[o.char.role] ?? "CHAR").toUpperCase());
      } else this.drawProp(ctx, o.prop);
      ctx.restore();
    }
    ctx.restore();
  }
  /** screen = center + (p − scroll × scrollFactor − center) × zoom */
  world(ctx, z, sx, sy, sf) {
    ctx.translate(FRAME_W / 2, FRAME_H / 2);
    ctx.scale(z, z);
    ctx.translate(-FRAME_W / 2 - sx * sf[0], -FRAME_H / 2 - sy * sf[1]);
  }
  drawProp(ctx, e) {
    const p = e.ref ?? e.p,
      [sx, sy] = getScale(p);
    const ex = e.w,
      eh = e.h;
    const cx = p.position[0] + ex / 2,
      cy = p.position[1] + eh / 2;
    ctx.translate(cx, cy);
    if (p.angle) ctx.rotate((p.angle * Math.PI) / 180);
    ctx.globalAlpha = Math.max(0, Math.min(1, num(p.alpha, 1)));
    ctx.globalCompositeOperation = blendToCanvas(p.blend);
    if (e.kind === "solid") {
      const c = parseColor(p.assetPath) || { r: 255, g: 0, b: 255, a: 1 };
      ctx.fillStyle = toRgbaCss(c);
      ctx.scale(p.flipX ? -1 : 1, p.flipY ? -1 : 1);
      ctx.fillRect(-ex / 2, -eh / 2, ex, eh);
    } else if (e.kind === "image") {
      ctx.imageSmoothingEnabled = !p.isPixel;
      ctx.scale(p.flipX ? -1 : 1, p.flipY ? -1 : 1);
      ctx.drawImage(e.img, -ex / 2, -eh / 2, ex, eh);
    } else if (e.kind === "actor") {
      const f = e.actor.frame() || e.refFrame;
      const [ox, oy] = e.actor.offsets;
      ctx.imageSmoothingEnabled = !p.isPixel;
      ctx.translate(-ox * Math.abs(sx), -oy * Math.abs(sy));
      ctx.scale(p.flipX ? -1 : 1, p.flipY ? -1 : 1);
      ctx.scale(Math.abs(sx), Math.abs(sy));
      const tint = p.color ? parseColor(p.color) : null;
      const white = !tint || (tint.r === 255 && tint.g === 255 && tint.b === 255);
      f.draw(ctx, -e.refFrame.w / 2, -e.refFrame.h / 2, e.refFrame, f.sp ? e.stageMatrix : true, e.refFrame.sp && !white ? tint : undefined);
    } else placeholder(ctx, -ex / 2, -eh / 2, ex, eh, `未読込: ${p.name || p.assetPath}`);
  }

  // ---------------- スクリプトに渡す入れ物 ----------------
  /** getBoyfriend() などが返す、キャラの代役（PlayState.instance 経由で触られる主な項目） */
  apiOf(who) {
    const c = typeof who === "string" ? this.chars[who] : who;
    this._api ??= new Map();
    if (!this._api.has(c)) this._api.set(c, this._makeApi(c));
    return this._api.get(c);
  }
  _makeApi(c) {
    const scene = this,
      role = c.role;
    // 見た目の大きさ（hitbox）と全体 offsets
    const geo = () => {
      c.materialize();
      const p = c.place();
      return { W: p.w, H: p.h, g: c.sc?.view?.global ?? [0, 0] };
    };
    return {
      __char: c,
      get isPlayer() {
        return role === "player";
      },
      characterId: c.id,
      characterType: role === "player" ? 0 : role === "opponent" ? 1 : 2,
      // V-Slice の x / y は「スプライトの左上」。ステージの位置（足元）= x + width/2 − 全体 offsets（BaseCharacter.setScale: x = feet − origin + globalOffsets）
      get x() {
        const q = geo();
        return c.pos[0] + q.g[0] - q.W / 2;
      },
      set x(v) {
        const q = geo();
        c.pos[0] = Number(v) - q.g[0] + q.W / 2;
      },
      get y() {
        const q = geo();
        return c.pos[1] + q.g[1] - q.H;
      },
      set y(v) {
        const q = geo();
        c.pos[1] = Number(v) - q.g[1] + q.H;
      },
      get width() {
        return geo().W;
      },
      get height() {
        return geo().H;
      },
      get globalOffsets() {
        return [...geo().g];
      },
      get characterOrigin() {
        const q = geo();
        return { x: q.W / 2, y: q.H };
      },
      get feetPosition() {
        const q = geo();
        return { x: c.pos[0] + q.g[0], y: c.pos[1] + q.g[1] };
      },
      get cornerPosition() {
        return { x: this.x, y: this.y };
      },
      set cornerPosition(v) {
        this.x = v.x;
        this.y = v.y;
      },
      get alpha() {
        return c.alpha;
      },
      set alpha(v) {
        c.alpha = Number(v);
      },
      get visible() {
        return c.visible;
      },
      set visible(v) {
        c.visible = !!v;
      },
      get zIndex() {
        return c.zIndex;
      },
      set zIndex(v) {
        c.zIndex = Number(v);
      },
      exists: true,
      alive: true,
      animation: {
        // FlxAnimationController.play(name, force, reversed, frame): 制限なしで直接再生
        play: (name, force = false, reversed = false) => void c.actor?.play(c.correct(String(name)) ?? String(name), !!force, !!reversed),
        get name() {
          return c.actor?.name ?? "";
        },
        get curAnim() {
          return { name: c.actor?.name ?? "", finished: c.actor?.finished ?? true };
        },
        get finished() {
          return c.actor?.finished ?? true;
        },
      },
      // Bopper.playAnimation(name, restart=false, ignoreOther=false, reversed=false)
      playAnimation: (name, restart = false, ignoreOther = false, reversed = false) => void c.playAnim(String(name), !!restart, !!ignoreOther, !!reversed),
      playAnim: (name, restart = false, ignoreOther = false, reversed = false) => void c.playAnim(String(name), !!restart, !!ignoreOther, !!reversed),
      isAnimationFinished: () => c.actor?.finished ?? true,
      isSinging: () => c.isSinging,
      forceAnimationForDuration: (name, duration) => {
        // その間は他のアニメを受け付けない（実ソース forceAnimationForDuration）
        c.playAnim(String(name), true, true);
        c.canPlayOther = false;
        clearTimeout(c._forceT);
        c._forceT = setTimeout(() => (c.canPlayOther = true), Number(duration) * 1000);
      },
      get canPlayOtherAnims() { return c.canPlayOther; },
      set canPlayOtherAnims(v) { c.canPlayOther = !!v; },
      get ignoreExclusionPref() { return c.ignoreExclusion; },
      set ignoreExclusionPref(v) { c.ignoreExclusion = Array.isArray(v) ? v : []; },
      get danceEvery() { return c.danceEvery; },
      set danceEvery(v) { c.json = { ...(c.json ?? {}), danceEvery: Number(v) }; },
      get singTimeSteps() { return c.singTime; },
      set singTimeSteps(v) { c.json = { ...(c.json ?? {}), singTime: Number(v) }; },
      get holdTimer() { return c.holdTimer / 1000; },
      set holdTimer(v) { c.holdTimer = Number(v) * 1000; },
      get shouldBop() { return c.shouldBop !== false; },
      set shouldBop(v) { c.shouldBop = !!v; },
      dance: (force) => c.dance(!!force),
      getCurrentAnimation: () => c.actor?.name ?? "",
      hasAnimation: (n) => !!c.actor?.has(n),
      // FlxSprite.getMidpoint = x + width/2, y + height/2（アニメの offsets は含まない）
      getMidPoint: () => {
        const q = geo();
        return { x: c.pos[0] + q.g[0], y: c.pos[1] + q.g[1] - q.H / 2 };
      },
      getFocusPoint: () => scene.focusPointOf(c),
      get cameraFocusPoint() {
        return scene.focusPointOf(c);
      },
      getBaseScale: () => c.sc?.view?.baseScale ?? 1,
      setPosition: (x, y) => {
        const q = geo();
        c.pos = [Number(x) - q.g[0] + q.W / 2, Number(y) - q.g[1] + q.H];
      },
      singTimeSec: c.singTime * (this.stepMs() / 1000),
    };
  }
  /** ステージの代役（PlayState.instance.currentStage） */
  stageApi() {
    const scene = this;
    return {
      stageId: this.stageId,
      stageName: this.doc?.name ?? "",
      cameraZoom: this.zoomBase,
      getBoyfriend: () => scene.apiOf("player"),
      getDad: () => scene.apiOf("opponent"),
      getGirlfriend: () => scene.apiOf("girlfriend"),
      add: (o) => (o?.__char ? scene.addExtra(o.__char) : null),
      remove: (o) => (o?.__char ? scene.removeExtra(o.__char) : null),
      insert: (_i, o) => (o?.__char ? scene.addExtra(o.__char) : null),
      refresh: () => {}, // 描画のたびに zIndex で並べ直すので何もしなくてよい
      getNamedProp: (name) => {
        const e = scene.props.find((p) => p.ref.name === name);
        return e ? { x: e.ref.position[0], y: e.ref.position[1], alpha: num(e.ref.alpha, 1), visible: true, playAnim: (n, f) => e.actor?.play(String(n), f !== false) } : null;
      },
      getProp: (name) => scene.props.find((p) => p.ref.name === name)?.ref ?? null,
    };
  }
}
