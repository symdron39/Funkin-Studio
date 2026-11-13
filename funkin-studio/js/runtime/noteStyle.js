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
import { infoOfPath, normAsset, scorePath, assetNote, openModZip } from "../services/ModPack.js";

const DIRS = ["left", "down", "up", "right"];
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

  /** ノーツの頭を中心 (cx, cy) に描く。k = レーン幅 / 112。描けたら true */
  drawNote(ctx, lane, cx, cy, k, alpha = 1) {
    const a = this.atlasOf("note");
    const nd = this.noteData(DIRS[lane]);
    if (!a || !nd) return false;
    const fr = this.framesOf("note", nd.prefix)?.[0];
    if (!fr) return false;
    const sc = this.getNoteScale() * k;
    return this._blit(ctx, a, fr, cx, cy, sc, alpha, nd.flipX, nd.flipY, this.getNoteOffsets(), k);
  }
  /** ストラム（受け皿）。mode = static / press / confirm。t = アニメの経過 0..1 */
  drawStrum(ctx, lane, mode, t, cx, cy, k, alpha = 1) {
    const a = this.atlasOf("noteStrumline");
    if (!a) return false;
    let sd = this.strumData(DIRS[lane], { static: "Static", press: "Press", confirm: "Confirm" }[mode]) ?? this.strumData(DIRS[lane], "Static");
    if (!sd) return false;
    const frs = this.framesOf("noteStrumline", sd.prefix);
    if (!frs?.length) return false;
    const fr = frs[Math.min(frs.length - 1, Math.floor(Math.max(0, Math.min(0.999, t)) * frs.length))];
    return this._blit(ctx, a, fr, cx, cy, this.getStrumlineScale() * k, alpha, sd.flipX, sd.flipY, this.getStrumlineOffsets(), k);
  }
  _blit(ctx, a, fr, cx, cy, sc, alpha, flipX, flipY, offs, k) {
    const fw = fr.frameWidth || fr.width,
      fh = fr.frameHeight || fr.height;
    // offsets はグループ全体の「ずらし」（ゲーム上のピクセル）。レーン幅に合わせた縮尺 k を掛けて足す
    const left = cx - (fw * sc) / 2 + -(fr.frameX || 0) * sc + (offs?.[0] || 0) * k;
    const top = cy - (fh * sc) / 2 + (-(fr.frameY || 0) * sc) + (offs?.[1] || 0) * k;
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
    return true;
  }
  /**
   * ホールドの胴体と終端。画像は 8 列（レーン 0-3 = 胴体、4-7 = 終端）の 1 枚絵。
   * x = レーン中心、yHead = 頭側の y、yTail = 尻尾側の y（downscroll でも「頭 → 尻尾」の向き）。
   */
  drawHold(ctx, lane, cx, yHead, yTail, k, alpha = 1) {
    const a = this.atlasOf("holdNote");
    if (!a || a.sprites) return false; // Sparrow ではなく 1 枚絵の想定
    const img = a.img;
    const cw = img.width / 8,
      ih = img.height;
    const sc = this.fetchHoldNoteScale() * k;
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
    for (let y = dir > 0 ? top : top + capH; y < (dir > 0 ? top + bodyLen : top + len); y += tile) ctx.drawImage(img, cw * lane, 0, cw, ih, x, y, w, tile);
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
    ctx.drawImage(img, cw * (lane + 4), 0, cw, ih * (capH / (ih * sc)), x, dir > 0 ? ey : top, w, capH);
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
