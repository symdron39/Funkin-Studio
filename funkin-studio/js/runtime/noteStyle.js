/* ============================================================
   runtime/noteStyle.js — V-Slice のノートスキン（notestyles/*.json + PNG/XML）の読み込みと描画
   ------------------------------------------------------------
   ・JSON の書式は NoteStyleData.hx（note / holdNote / noteStrumline の assets）。fallback の連鎖もたどる。
   ・読み込むファイル: スキンの JSON と、そこから参照される画像（PNG + Sparrow XML）。ファイル名で結びつける
     （assetPath の最後の部分 = 画像のファイル名。"weeb:pixel-notes" のようなライブラリ接頭辞は無視）。
   ・描画の大きさは「1 レーン = 112px の 720p」を基準にした倍率 k で縮尺する（プレイテストのレーン幅に合わせる）。
   ・軽量化: 画像は ImageBitmap（デコード済み）で保持し、フレーム検索は prefix ごとにキャッシュする。
   ============================================================ */
import { loadImage, parseSparrowXml, sparrowFrames, paintSparrow } from "../states/stage/sparrowAtlas.js";
import { noteStyle as noteStyleFromRemote } from "../services/FunkinAssets.js";
import { infoOfPath, normAsset, scorePath, assetNote, openModZip } from "../services/ModPack.js";

const DIRS = ["left", "down", "up", "right"];
const STRUM_INIT = -28.6; // Strumline.INITIAL_OFFSET = -0.275 * 104
const NUDGE = 2; // Strumline の NUDGE
/**
 * prefix のフレーム列。"purple" のように短い prefix だと、"purple hold piece0000" のような別の絵まで前方一致してしまう。
 * 「prefix の直後が数字だけ」のフレームがあれば、それだけを使う（ノーツの頭を、ホールドの破片と取り違えない）。
 */
export function framesByPrefix(sprites, prefix) {
  const all = sparrowFrames(sprites, prefix);
  const strict = all.filter((f) => /^\d*$/.test(f.name.slice(String(prefix).length)));
  return strict.length ? strict : all;
}
const baseName = (p) => String(p).replace(/^.*[:\\/]/, "").replace(/\.(png|xml|json)$/i, "");

export class NoteStyle {
  constructor(set, id, data) {
    this.set = set;
    this.id = id;
    this.data = data;
    this.origin = set.origins?.get(id) ?? ""; // この JSON が属する mod（同じ mod の画像を優先する）
    this._frames = new Map();
  }
  get fallback() {
    return this.data.fallback ? this.set.get(this.data.fallback) : null;
  }
  getName() {
    return this.data.name ?? this.id;
  }
  getAuthor() {
    return this.data.author ?? "";
  }
  getFallbackID() {
    return this.data.fallback ?? null;
  }
  /** assets.<key> を、無ければ fallback をたどって探す */
  asset(key) {
    return this.data.assets?.[key] ?? this.fallback?.asset(key) ?? null;
  }
  // ---- HScript から呼ばれる API（V-Slice の NoteStyle と同名）
  getNoteScale() {
    return this.data.assets?.note?.scale ?? this.fallback?.getNoteScale() ?? 1;
  }
  getNoteOffsets() {
    return this.data.assets?.note?.offsets ?? this.fallback?.getNoteOffsets() ?? [0, 0];
  }
  getStrumlineScale() {
    return this.data.assets?.noteStrumline?.scale ?? this.fallback?.getStrumlineScale() ?? 1;
  }
  getStrumlineOffsets() {
    return this.data.assets?.noteStrumline?.offsets ?? this.fallback?.getStrumlineOffsets() ?? [0, 0];
  }
  fetchHoldNoteScale() {
    return this.data.assets?.holdNote?.scale ?? this.fallback?.fetchHoldNoteScale() ?? 1;
  }
  getHoldNoteOffsets() {
    return this.data.assets?.holdNote?.offsets ?? this.fallback?.getHoldNoteOffsets() ?? [0, 0];
  }
  isNoteSplashEnabled() {
    return this.data.assets?.noteSplash?.data?.enabled ?? this.fallback?.isNoteSplashEnabled() ?? false;
  }
  isHoldNoteCoverEnabled() {
    return this.data.assets?.holdNoteCover?.data?.enabled ?? this.fallback?.isHoldNoteCoverEnabled() ?? false;
  }
  isNoteAnimated() {
    return this.data.assets?.note?.animated ?? this.fallback?.isNoteAnimated() ?? false;
  }
  // 描画側が作る strumline の矢印（StrumlineNote）に対する操作は、見た目を strumline.noteStyle から引くので何もしない
  applyStrumlineFrames() {}
  applyStrumlineAnimations() {}
  buildNoteSprite() {}

  // ---- 画像
  /** 画像とフレーム一覧 { img, sprites|null }。見つからなければ null */
  atlasOf(key) {
    const def = this.data.assets?.[key];
    if (def?.assetPath) {
      const a = this.set.atlas(def.assetPath, this.origin);
      if (a) return { ...a, def };
    }
    const fb = this.fallback?.atlasOf(key);
    return fb ?? null;
  }
  /** key のアニメ定義（note.data.left など）の prefix → フレーム列 */
  framesOf(key, prefix) {
    const a = this.atlasOf(key);
    if (!a || !a.sprites) return null;
    const ck = key + "|" + prefix;
    if (!this._frames.has(ck)) this._frames.set(ck, framesByPrefix(a.sprites, prefix));
    return this._frames.get(ck);
  }
  noteData(dir) {
    return this.data.assets?.note?.data?.[dir] ?? this.fallback?.noteData(dir) ?? null;
  }
  strumData(dir, anim) {
    const k = dir + anim; // leftStatic / leftPress / leftConfirm / leftConfirmHold
    const d = this.data.assets?.noteStrumline?.data;
    if (d && Object.keys(d).some((x) => x.startsWith(dir))) return d[k] ?? null; // 方向のアニメが 1 つでもあれば、この style の物だけを使う
    return this.fallback?.strumData(dir, anim) ?? null;
  }
  /** 絵が使えるか（使えない場合、呼び出し側は既定の矢印を描く） */
  usable() {
    return !!(this.atlasOf("note") && this.noteData("left"));
  }

  // ======== V-Slice 0.8.7 と同じ置き方 ========
  // 座標は strumline の左上 = (0,0)、単位はゲーム上の px（描くときに k = レーン幅/112 を掛ける）。y は下向き。
  //   受け皿（StrumlineNote）: 左上 = (lane*112 − 28.6 + offsets.x, offsets.y)、大きさ = atlas の最初のフレーム × scale
  //   ノーツ（NoteSprite）   : 中心 x = lane*112 + 52 − 2、上端 y = 28.6 + (流れた距離)。offsets（note）は 0.8.7 では使われない
  //   ホールド（SustainTrail）: 中心 x = lane*112 + 52 − offsets.x、頭の y = 28.6 + 52 − offsets.y + 流れた距離（offsets は引き算）
  //   スプラッシュ           : 左上 = (lane*112 − 28.6 + off.x*scale, 28.6 + off.y*scale)。絵は 0.3 * 幅 ずれる（NoteSplash.hx の offset）
  //   ホールドカバー         : 中心 x = lane*112 + 52 + off.x*scale − 12、上端 y = −28.6 + 52 + off.y*scale − 96
  // どれも anim ごとの offsets（data.xxx.offsets）は読まれない。
  /** atlas の最初のフレームの大きさ（Flixel の sprite.width / height の元） */
  frame0Size(key) {
    const a = this.atlasOf(key);
    if (!a) return null;
    const f = a.sprites?.[0];
    if (f) return { w: f.frameWidth || f.width, h: f.frameHeight || f.height };
    return a.img ? { w: a.img.width, h: a.img.height } : null;
  }
  /** 受け皿の中心（strumline 基準の px） */
  strumCenter(lane) {
    const f = this.frame0Size("noteStrumline"),
      s = this.getStrumlineScale(),
      o = this.getStrumlineOffsets();
    if (!f) return [lane * 112 + 52, 52];
    return [lane * 112 + STRUM_INIT + o[0] + (f.w * s) / 2, o[1] + (f.h * s) / 2];
  }
  /** ノーツ頭の中心（流れた距離 = 0 のとき） */
  noteCenter(lane) {
    const nd = this.noteData(DIRS[lane]);
    const fr = nd ? this.framesOf("note", nd.prefix)?.[0] : null;
    const s = this.getNoteScale();
    const h = fr ? fr.frameHeight || fr.height : 154;
    return [lane * 112 + 52 - NUDGE, -STRUM_INIT + (h * s) / 2];
  }
  /** ノーツの頭を描く。(ox, oy) = strumline の左上（画面）、dy = 流れた距離（画面 px）。k = レーン幅 / 112。描けたら true */
  drawNote(ctx, lane, ox, oy, dy, k, alpha = 1) {
    const a = this.atlasOf("note");
    const nd = this.noteData(DIRS[lane]);
    if (!a || !nd) return false;
    const fr = this.framesOf("note", nd.prefix)?.[0];
    if (!fr) return false;
    const [cx, cy] = this.noteCenter(lane);
    return this._blit(ctx, a, fr, ox + cx * k, oy + cy * k + dy, this.getNoteScale() * k, alpha, nd.flipX, nd.flipY);
  }
  /** ストラム（受け皿）。mode = static / press / confirm。t = アニメの経過 0..1 */
  drawStrum(ctx, lane, mode, t, ox, oy, k, alpha = 1) {
    const a = this.atlasOf("noteStrumline");
    if (!a) return false;
    let sd = this.strumData(DIRS[lane], { static: "Static", press: "Press", confirm: "Confirm" }[mode]) ?? this.strumData(DIRS[lane], "Static");
    if (!sd) return false;
    const frs = this.framesOf("noteStrumline", sd.prefix);
    if (!frs?.length) return false;
    const fr = frs[Math.min(frs.length - 1, Math.floor(Math.max(0, Math.min(0.999, t)) * frs.length))];
    const [cx, cy] = this.strumCenter(lane);
    return this._blit(ctx, a, fr, ox + cx * k, oy + cy * k, this.getStrumlineScale() * k, alpha, sd.flipX, sd.flipY);
  }
  /** スプラッシュ 1 枚。fr = フレーム、(ox, oy) = strumline の左上 */
  drawSplash(ctx, lane, fr, ox, oy, k, alpha = 1) {
    const a = this.atlasOf("noteSplash");
    if (!a || !fr) return false;
    const def = this.asset("noteSplash"),
      s = def?.scale ?? 1,
      o = def?.offsets ?? [0, 0];
    const f0 = a.sprites?.[0] ?? fr;
    const fw = f0.frameWidth || f0.width,
      fh = f0.frameHeight || f0.height;
    // sprite 左上 → 0.3 * 大きさ ずらし、scale は中心まわり
    const x = lane * 112 + STRUM_INIT + o[0] * s,
      y = -STRUM_INIT + o[1] * s;
    const cx = x - 0.3 * fw * s + (fw * s) / 2,
      cy = y - 0.3 * fh * s + (fh * s) / 2;
    return this._blit(ctx, a, fr, ox + cx * k, oy + cy * k, s * k, alpha * (def?.alpha ?? 1));
  }
  /** ホールドカバー 1 枚（lane の assetPath の画像）。part のフレーム fr */
  drawCover(ctx, lane, atlas, fr, ox, oy, k, alpha = 1) {
    if (!atlas || !fr) return false;
    const def = this.asset("holdNoteCover"),
      s = def?.scale ?? 1,
      o = def?.offsets ?? [0, 0];
    const fh = fr.frameHeight || fr.height;
    const cx = lane * 112 + 52 + o[0] * s - 12,
      cy = STRUM_INIT + 52 + o[1] * s - 96 + (fh * s) / 2;
    return this._blit(ctx, atlas, fr, ox + cx * k, oy + cy * k, s * k, alpha * (def?.alpha ?? 1));
  }
  _blit(ctx, a, fr, cx, cy, sc, alpha, flipX, flipY) {
    const fw = fr.frameWidth || fr.width,
      fh = fr.frameHeight || fr.height;
    const left = cx - (fw * sc) / 2 - (fr.frameX || 0) * sc;
    const top = cy - (fh * sc) / 2 - (fr.frameY || 0) * sc;
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (a.def?.isPixel) ctx.imageSmoothingEnabled = false;
    if (flipX || flipY) {
      ctx.translate(cx, cy);
      ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      ctx.translate(-cx, -cy);
    }
    paintSparrow(ctx, fr, a.img, left, top, fr.width * sc, fr.height * sc);
    ctx.restore();
    return { x0: cx - (fw * sc) / 2, y0: cy - (fh * sc) / 2, x1: cx + (fw * sc) / 2, y1: cy + (fh * sc) / 2 }; // 描いた枠（truthy）
  }
  /**
   * ホールドの胴体と終端。画像は 8 列（レーンごとに「胴体, 終端」の順: 0,1 = 左、2,3 = 下…）の 1 枚絵。
   * ox = strumline 左上の x、yHead = strumline 左上の y + 流れた距離（画面 px）。
   * （旧: x = レーン中心）yHead = 頭側の y、yTail = 尻尾側の y（downscroll でも「頭 → 尻尾」の向き）。
   */
  drawHold(ctx, lane, ox, yHead, yTail, k, alpha = 1) {
    const a = this.atlasOf("holdNote");
    if (!a || a.sprites) return false; // Sparrow ではなく 1 枚絵の想定
    const img = a.img;
    const cw = img.width / 8,
      ih = img.height;
    const sc = this.fetchHoldNoteScale() * k;
    const off = this.getHoldNoteOffsets(); // V-Slice では「引き算」（正の値 = 左・上へ）
    const cx = ox + (lane * 112 + 52 - off[0]) * k;
    const dy = (-STRUM_INIT + 52 - off[1]) * k;
    yHead += dy;
    yTail += dy;
    const w = cw * sc;
    const dir = yTail >= yHead ? 1 : -1;
    const top = Math.min(yHead, yTail),
      len = Math.abs(yTail - yHead);
    if (len < 1) return true;
    const capH = Math.min(len, ih * sc * (a.def?.isPixel ? 1 : 0.5));
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (a.def?.isPixel) ctx.imageSmoothingEnabled = false;
    const x = cx - w / 2;
    // 胴体: 下スクロールでも同じ絵を縦に並べる
    const bodyLen = len - capH;
    ctx.beginPath();
    ctx.rect(x, dir > 0 ? top : top + capH, w, bodyLen);
    ctx.clip();
    const tile = ih * sc;
    for (let y = dir > 0 ? top : top + capH; y < (dir > 0 ? top + bodyLen : top + len); y += tile) ctx.drawImage(img, cw * lane * 2, 0, cw, ih, x, y, w, tile);
    ctx.restore();
    // 終端
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (dir < 0) {
      ctx.translate(0, top + capH / 2);
      ctx.scale(1, -1);
      ctx.translate(0, -(top + capH / 2));
    }
    const ey = dir > 0 ? top + len - capH : top;
    ctx.drawImage(img, cw * (lane * 2 + 1), 0, cw, ih * (capH / (ih * sc)), x, dir > 0 ? ey : top, w, capH);
    ctx.restore();
    return true;
  }
}

/** 読み込んだスキンの集まり（レジストリ） */
export class NoteStyleSet {
  constructor() {
    this.styles = new Map();
    this.images = new Map(); // ルート以降のパス（拡張子なし）→ { img, origin }  ※別の mod / フォルダの同名ファイルを取り違えないよう、パスで持つ
    this.xmls = new Map(); // 同じ形で sprites
    this.origins = new Map(); // スキン id → origin
    this.raw = new Map(); // id → json（再構築用）
    this.version = 0;
  }
  clear() {
    this.styles.clear();
    this.images.clear();
    this.xmls.clear();
    this.raw.clear();
    this.origins.clear();
    this.version++;
  }
  ids() {
    return [...this.styles.keys()];
  }
  /**
   * 標準の noteStyle（"funkin" / "pixel"）を登録する。すでにあれば（mod の funkin.json など）何もしない。
   * まず本体アセット（FunkinCrew/Funkin.assets）から JSON と画像を取ってくる。取れなければ false を返し、描画側は矢印を描く（ページに本体の画像は内蔵しない）。画像のキーは images/…（ルート以降のパス）、origin は "builtin:<id>"
   */
  loadBuiltin(id) {
    if (this.raw.has(id)) return Promise.resolve(false);
    this._loading ??= new Map();
    let p = this._loading.get(id);
    if (!p) this._loading.set(id, (p = this._loadBuiltin(id).finally(() => this._loading.delete(id))));
    return p;
  }
  async _loadBuiltin(id) {
    if (this.raw.has(id)) return false;
    try {
      const r = await noteStyleFromRemote(id);
      if (r) {
        const origin = "builtin:" + id;
        this.raw.set(id, r.json);
        this.origins.set(id, origin);
        for (const im of r.images) this.images.set(im.key, { img: await loadImage(await im.file.blob()), origin });
        for (const x of r.xmls) this.xmls.set(x.key, { sprites: parseSparrowXml(await x.file.text()), origin });
        this.styles.set(id, new NoteStyle(this, id, r.json));
        this.version++;
        return true;
      }
    } catch (e) {
      this.raw.delete(id);
      this.origins.delete(id);
      console.warn(`標準ノートスタイル「${id}」を funkin.assets から取得できませんでした:`, e);
    }
    return false; // 取れなかったとき（オフラインなど）は、呼び出し側が従来の矢印の絵を使う
  }
  get(id) {
    return this.styles.get(id) ?? null;
  }
  /** assetPath → { img, sprites }。置き場所の点数で選び、決められないときは注意を出す */
  atlas(assetPath, origin = "") {
    const best = pickByPath(this.images, assetPath, origin);
    if (!best) return null;
    // XML は、選んだ画像と同じパスのものを優先（別の mod の XML と組み合わさらないように）
    const x = this.xmls.get(best.key) ?? pickByPath(this.xmls, assetPath, best.val.origin)?.val;
    return { img: best.val.img, sprites: x?.sprites ?? x ?? null };
  }
  /**
   * @param entries [{name, file?: File, text?, buffer?}]  JSON / PNG / XML が混ざっていてよい
   * @returns {added: [id], warnings: []}
   */
  async addFiles(entries) {
    const warnings = [],
      added = [];
    for (const e of entries) {
      const full = e.name.replace(/\\/g, "/");
      const n = full.replace(/^.*\//, "");
      const pinfo = infoOfPath(full);
      try {
        if (/\.json$/i.test(n)) {
          const txt = e.text ?? (await e.file.text());
          const data = JSON.parse(txt);
          if (data && data.assets && typeof data.assets === "object" && !Array.isArray(data)) {
            const id = baseName(n);
            this.raw.set(id, data);
            this.origins.set(id, pinfo.origin);
            added.push(id);
          }
        } else if (/\.(png|webp|jpe?g)$/i.test(n)) {
          const f = e.file ?? new File([e.buffer], n, { type: "image/png" });
          this.images.set(pinfo.noExt, { img: await loadImage(f), origin: pinfo.origin });
        } else if (/\.xml$/i.test(n)) {
          const txt = e.text ?? (await e.file.text());
          this.xmls.set(pinfo.noExt, { sprites: parseSparrowXml(txt), origin: pinfo.origin });
        }
      } catch (err) {
        warnings.push(`${n}: ${err.message}`);
      }
    }
    // fallback に "funkin" があるのに、読み込んだ mod に funkin.json が無いときは、内蔵の標準スタイルを使う
    for (const data of [...this.raw.values()]) if (data.fallback && !this.raw.has(data.fallback)) await this.loadBuiltin(data.fallback);
    for (const [id, data] of this.raw) this.styles.set(id, new NoteStyle(this, id, data));
    // 画像が足りないスキンを知らせる
    for (const id of added) {
      const s = this.styles.get(id);
      for (const key of ["note", "noteStrumline", "holdNote"]) {
        const def = s.data.assets?.[key];
        if (def?.assetPath && !this.atlas(def.assetPath)) warnings.push(`${id}: ${key} の画像「${baseName(def.assetPath)}.png」がありません（ある場合は同時に選んでください。無い部分は既定の矢印で描きます）`);
      }
    }
    this.version++;
    return { added, warnings };
  }
}

/** map（キー = ルート以降のパス）から assetPath に合うものを選ぶ。{ key, val } */
function pickByPath(map, assetPath, origin) {
  let best = null,
    ties = 0;
  for (const [key, val] of map) {
    const info = infoOfPath(key + ".x");
    let sc = scorePath(info, assetPath, "images");
    if (!sc) continue;
    if (origin && val.origin === origin) sc += 25;
    if (!best || sc > best.sc) {
      best = { key, val, sc };
      ties = 1;
    } else if (sc === best.sc) ties++;
  }
  if (best && ties > 1) assetNote(`ノートスキンの画像「${assetPath}」に合うファイルが複数あります。${best.key} を使いました（違う場合は、使いたい mod の分だけ読み込み直してください）`);
  return best;
}

/**
 * スクリプトが絵（frames / animation）を差し替えたノートを描く。
 * 位置は V-Slice の NoteSprite と同じく「頭の中心 (cx, cy)」基準、offset は frame のずらし（ゲーム上の px）。
 * 描けたら true。絵がまだ読み込み中・アニメ未選択なら false（呼び出し側は既定の絵を描く）
 */
export function drawNoteSprite(ctx, spr, cx, cy, k, alpha = 1) {
  const ov = spr?.ov,
    at = ov?.atlas;
  if (!at || !at.ready || !at.sprites || !ov.cur) return false;
  const frs = (ov._fc ??= new Map()).get(ov.cur.prefix) ?? (ov._fc.set(ov.cur.prefix, framesByPrefix(at.sprites, ov.cur.prefix)), ov._fc.get(ov.cur.prefix));
  if (!frs?.length) return false;
  const i = Math.floor(((performance.now() - ov.t0) / 1000) * ov.cur.fps);
  const fr = frs[ov.cur.loop ? ((i % frs.length) + frs.length) % frs.length : Math.min(frs.length - 1, Math.max(0, i))];
  const sx = (spr.scale?.x ?? 1) * k,
    sy = (spr.scale?.y ?? 1) * k;
  const fw = fr.frameWidth || fr.width,
    fh = fr.frameHeight || fr.height;
  const o = spr.offset ?? { x: NaN, y: NaN };
  const ox = Number.isFinite(o.x) ? o.x : 0,
    oy = Number.isFinite(o.y) ? o.y : 0;
  const left = cx - (fw * sx) / 2 - (fr.frameX || 0) * sx - ox * k;
  const top = cy - (fh * sy) / 2 - (fr.frameY || 0) * sy - oy * k;
  ctx.save();
  ctx.globalAlpha *= alpha * (Number.isFinite(spr.alpha) ? spr.alpha : 1);
  if (spr.antialiasing === false) ctx.imageSmoothingEnabled = false;
  ctx.translate(cx, cy);
  if (spr.angle) ctx.rotate((spr.angle * Math.PI) / 180);
  ctx.scale(spr.flipX ? -1 : 1, spr.flipY ? -1 : 1);
  ctx.translate(-cx, -cy);
  paintSparrow(ctx, fr, at.img, left, top, fr.width * sx, fr.height * sy);
  ctx.restore();
  return true;
}
