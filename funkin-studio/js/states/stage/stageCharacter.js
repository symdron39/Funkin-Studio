/* ============================================================
   stage/stageCharacter.js — ステージ上に「実物のキャラクター」を出すための部品
   ------------------------------------------------------------
   character.json + アトラスのファイルを読み、ステージ上の描画に必要な値をまとめる。
   対応する renderType: sparrow / packer / multisparrow / animateatlas / multianimateatlas（custom は不可）
   座標の規則は V-Slice のソースに合わせてある（コメントの [出典] は source/funkin/ 以下のファイル）。

   [出典] play/character/BaseCharacter.hx / play/stage/Stage.hx / play/stage/Bopper.hx
          play/character/{Sparrow,Packer,MultiSparrow,AnimateAtlas,MultiAnimateAtlas}Character.hx
   ■ 基準フレーム: characterOrigin = (幅/2, 高さ)。幅・高さは dance(true) の直後の updateHitbox() で決まる
       → danceLeft があれば danceRight（無ければ danceLeft）の先頭フレーム / 無ければ idle の先頭フレーム
         / どれも無ければアトラス先頭。（Character Editor と同じ規則）
   ■ 使うアトラス: 基準アニメの assetPath（アニメ個別の指定が無ければキャラ共通の assetPath）。
       Multi 系では、アニメごとに別のアトラスを使える。このエディタが描くのは基準フレームだけなので、
       基準アニメが使うアトラスのファイルだけあれば表示できる（他のアニメ用のファイルは不要）。
       アニメごとの形式: multisparrow は renderType "animateatlas" のアニメだけ AnimateAtlas、
                         multianimateatlas は renderType "sparrow" のアニメだけ Sparrow（他は AnimateAtlas）
   ■ Stage.addCharacter:
       x = stagePos.x − origin.x                       （足元がステージ上の位置に来る）
       setScale(base × stageScale) → x = feet − newOrigin + globalOffsets      （※ここで global が1回足される）
       描画位置 = x − (animOffsets − globalOffsets) × scale                    （Bopper.getScreenPosition。もう1回 global × scale）
     → 描画上の「足元」 = stagePos + global + (global − anim) × scale
   ■ 左右反転: BF は !flipX、DAD / GF は flipX（Stage.addCharacter）。反転は「表示中フレーム自身の枠」の中で行う。
   ■ カメラ焦点: originalPosition + (幅/2, 高さ/2) + キャラの cameraOffsets + ステージ側の cameraOffsets
   ============================================================ */
import { findSpriteAtlas, findAnimateAtlas } from "./atlas.js";

export const RENDER_TYPES = ["sparrow", "packer", "multisparrow", "animateatlas", "multianimateatlas"];

/** アトラスの種類: "sparrow" | "packer" | "animate"。anim が無ければキャラ共通の assetPath の種類 */
export function atlasKindOf(json, anim) {
  const rt = String(json?.renderType || "sparrow").toLowerCase();
  if (rt === "multisparrow") return anim?.assetPath && String(anim.renderType).toLowerCase() === "animateatlas" ? "animate" : "sparrow";
  if (rt === "multianimateatlas") return anim?.assetPath && String(anim.renderType).toLowerCase() === "sparrow" ? "sparrow" : "animate";
  if (rt === "animateatlas") return "animate";
  if (rt === "packer") return "packer";
  return "sparrow";
}
/** 基準アニメ（danceRight → danceLeft → idle の順。どれも無ければ null） */
export function referenceAnimOf(json) {
  const anims = json?.animations || [],
    has = (n) => anims.some((a) => a.name === n);
  const name = has("danceLeft") ? (has("danceRight") ? "danceRight" : "danceLeft") : has("idle") ? "idle" : "";
  return name ? anims.find((a) => a.name === name) : null;
}

export class StageCharacter {
  constructor(id) {
    this.id = id;
    this.reset();
  }
  reset() {
    this.json = null; // character.json
    this.jsonName = "";
    this.need = null; // 表示に必要なアトラス { path, kind, ref }（json を読んだ時点で決まる）
    this.atlas = null; // SpriteAtlas / AnimateAtlas
    this.view = null; // 描画用にまとめた値（下の build）
    this.fileNames = [];
    this.error = "";
  }
  get loaded() {
    return !!this.view;
  }
  /** json は読めたが、アトラスのファイルを待っている状態 */
  get waiting() {
    return !!this.json && !this.view;
  }

  /**
   * ファイルの中から character.json を探して読む（animations 配列を持つ JSON）。見つかれば true。
   * アトラスはまだ読まない（= 分散方式の1段階目。resolve で後から探す）
   */
  async setJsonFrom(files) {
    for (const f of [...files].filter((f) => /\.json$/i.test(f.name))) {
      let j;
      try {
        j = JSON.parse((await f.text()).replace(/^\uFEFF/, ""));
      } catch {
        continue; // spritemap などは character.json ではない。次へ
      }
      if (!Array.isArray(j?.animations)) continue;
      const rt = String(j.renderType || "sparrow").toLowerCase();
      if (!RENDER_TYPES.includes(rt)) throw Error(`renderType「${j.renderType}」は未対応です（${RENDER_TYPES.join(" / ")} に対応）`);
      const ref = referenceAnimOf(j),
        path = (ref?.assetPath || j.assetPath || "").trim();
      if (!path) throw Error("assetPath がありません（character.json か、基準アニメに assetPath が必要です）");
      this.reset();
      this.json = j;
      this.jsonName = f.name;
      this.need = { path, kind: atlasKindOf(j, ref?.assetPath ? ref : null), ref };
      return true;
    }
    return false;
  }

  /**
   * ファイルの山（pool）から、表示に必要なアトラスを探して読む。無ければ Error（何が足りないか書く）。
   * 成功すると view ができる。呼び直してもよい（足りないファイルを足したあとなど）
   */
  async resolve(pool) {
    if (!this.json) throw Error("character.json がまだ選択されていません");
    const { path, kind, ref } = this.need;
    const list = [...pool];
    const atlas = kind === "animate" ? await findAnimateAtlas(list, path) : await findSpriteAtlas(list, path, kind);
    this.atlas = atlas;
    this.fileNames = [this.jsonName, atlas.label];
    this.view = this.build(ref, path, kind);
    this.error = "";
  }

  /**
   * 一括方式: character.json とアトラスのファイルを一緒に渡す。pool は、それまでに集めたファイル（分散方式で足したもの）
   * ファイルの中に character.json が無くても、すでに json を読んでいればそれを使う
   */
  async loadFiles(files, pool = []) {
    const list = [...files];
    if (!(await this.setJsonFrom(list)) && !this.json) throw Error("character.json（animations 配列を持つ JSON）が選択されていません");
    await this.resolve([...list, ...pool]);
  }

  /** 基準フレームなど、描画に必要な値を決める */
  build(ref, path, kind) {
    const atlas = this.atlas;
    const first = ref ? atlas.frames(ref)[0] : null;
    const frame = first || atlas.first();
    if (!frame) throw Error("アトラスにフレームがありません");
    const ao = ref?.offsets || [0, 0];
    const settings = ref?.atlasSettings || this.json.atlasSettings || {};
    return {
      frame,
      kind,
      assetPath: path,
      renderType: String(this.json.renderType || "sparrow").toLowerCase(),
      stageMatrix: !!settings.applyStageMatrix,
      refW: frame.w,
      refH: frame.h,
      label: first ? `${ref.name} の先頭フレーム` : kind === "animate" ? "メインタイムラインの先頭" : "アトラス先頭",
      anim: [Number(ao[0]) || 0, Number(ao[1]) || 0],
      global: [Number(this.json.offsets?.[0]) || 0, Number(this.json.offsets?.[1]) || 0],
      baseScale: Number(this.json.scale) > 0 ? Number(this.json.scale) : 1,
      flipX: !!this.json.flipX,
      camera: [Number(this.json.cameraOffsets?.[0]) || 0, Number(this.json.cameraOffsets?.[1]) || 0],
      name: this.json.name || this.id,
    };
  }

  /**
   * ステージ上の配置を計算する。sc = ステージ側の scale。
   * 返す値: k（最終スケール）/ feetX, feetY（描画上の足元）/ w, h（スケール後の枠）/ focusX, focusY（カメラ焦点）/ flip
   */
  place(stageChar, stageCamOffsets = [0, 0]) {
    const v = this.view;
    const k = v.baseScale * (Number(stageChar.scale) || 1);
    const [px, py] = stageChar.position;
    const [gx, gy] = v.global,
      [ax, ay] = v.anim;
    const feetX = px + gx + (gx - ax) * k;
    const feetY = py + gy + (gy - ay) * k;
    const w = v.refW * k,
      h = v.refH * k;
    const co = stageChar.cameraOffsets || stageCamOffsets;
    return {
      k,
      feetX,
      feetY,
      w,
      h,
      focusX: px + gx + v.camera[0] + co[0],
      focusY: py + gy - h / 2 + v.camera[1] + co[1],
      flip: this.id === "bf" ? !v.flipX : v.flipX,
    };
  }

  /**
   * ctx は「足元(0,0)・最終スケール適用済み」の座標系にしてから呼ぶ。枠の左上は (−refW/2, −refH)。
   * 表示するのは基準フレームそのものなので、反転の軸は枠の中心（x = 0）。
   */
  paint(ctx, flip) {
    const v = this.view;
    ctx.save();
    if (flip) ctx.scale(-1, 1);
    v.frame.draw(ctx, -v.refW / 2, -v.refH, v.frame, v.stageMatrix);
    ctx.restore();
  }
}
