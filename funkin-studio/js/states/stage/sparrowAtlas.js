/* ============================================================
   stage/sparrowAtlas.js — Sparrow アトラス（PNG + XML）の読み込みと切り出し描画
   ------------------------------------------------------------
   Character Editor（states/character/editor.js）にある同じ処理を、Stage Editor でも使えるよう
   モジュールとして独立させたもの。ロジックは Character Editor と同じ（rotated / frameX / frameWidth の扱いも同じ）。
   ※ Character Editor 側は動作確認済みのまま触らないため、同じコードが2か所にある。将来ここへ統合できる。
   ============================================================ */

/**
 * File → デコード済みの画像（ImageBitmap）。
 * <img> のままだと、ブラウザは「デコードした画像」を容量の上限つきのキャッシュに置き、あふれると捨てる。
 * 大きなアトラスが何十枚もあると、毎フレーム捨てられた画像を PNG からデコードし直して、画面が固まる。
 * ImageBitmap はデコード済みのピクセルをそのまま持ち続けるので、これが起きない。
 * 既存コードが使う naturalWidth / naturalHeight も付けておく。
 */
export async function loadImage(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file); // PNG / WebP / JPEG をデコード（メインスレッドを塞がない）
  } catch {
    // createImageBitmap が使えない・失敗したときは、従来どおり <img> で読む
    const img = new Image();
    const url = URL.createObjectURL(file);
    try {
      img.src = url;
      await img.decode();
    } finally {
      URL.revokeObjectURL(url);
    }
    return img;
  }
  Object.defineProperty(bmp, "naturalWidth", { value: bmp.width });
  Object.defineProperty(bmp, "naturalHeight", { value: bmp.height });
  return bmp;
}

/** XML 文字列 → スプライト一覧 [{name, x, y, width, height, frameX, frameY, frameWidth, frameHeight, rotated}] */
export function parseSparrowXml(text) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (xml.querySelector("parsererror")) throw Error("XML が不正です");
  return [...xml.querySelectorAll("SubTexture")].map((el) => {
    const n = (k) => Number(el.getAttribute(k) || 0);
    const rotated = ["true", "1"].includes((el.getAttribute("rotated") || "").toLowerCase());
    const width = n("width"),
      height = n("height");
    return {
      name: el.getAttribute("name") || "",
      x: n("x"),
      y: n("y"),
      width,
      height,
      frameX: n("frameX"),
      frameY: n("frameY"),
      frameWidth: n("frameWidth") || (rotated ? height : width),
      frameHeight: n("frameHeight") || (rotated ? width : height),
      rotated,
    };
  });
}

/**
 * Packer アトラス（Flixel の fromSpriteSheetPacker 形式の .txt）→ スプライト一覧。ファイルの行の順がそのままフレーム番号。
 * 1行 = 「名前 = x y 幅 高さ」。トリミングや回転の情報は無い（frameX/frameY は 0）。
 */
export function parsePackerText(text) {
  const out = [];
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const m = raw.trim().match(/^(.+?)\s*=\s*(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)$/);
    if (!m) continue;
    const [width, height] = [Number(m[4]), Number(m[5])];
    out.push({ name: m[1].trim(), x: Number(m[2]), y: Number(m[3]), width, height, frameX: 0, frameY: 0, frameWidth: width, frameHeight: height, rotated: false });
  }
  if (!out.length) throw Error("Packer の .txt として読めませんでした（「名前 = x y 幅 高さ」の行がありません）");
  return out;
}

/** prefix で始まるスプライトを、末尾の連番の順に並べる（FlxAtlasFrames.getByPrefix 相当） */
export function sparrowFrames(sprites, prefix) {
  const list = sprites.filter((x) => x.name.startsWith(prefix));
  const tail = (x) => x.name.slice(prefix.length);
  list.sort((a, b) => {
    const ma = tail(a).match(/(\d+)$/),
      mb = tail(b).match(/(\d+)$/);
    if (ma && mb) return Number(ma[1]) - Number(mb[1]) || a.name.localeCompare(b.name);
    if (ma) return -1;
    if (mb) return 1;
    return a.name.localeCompare(b.name);
  });
  return list;
}

/** アニメ定義（prefix と frameIndices）が再生するスプライト列 */
export function sparrowSequenceOf(sprites, anim) {
  const all = sparrowFrames(sprites, String(anim.prefix ?? anim.name ?? ""));
  const ix = Array.isArray(anim.frameIndices) && anim.frameIndices.length ? anim.frameIndices : null;
  return ix ? ix.map((i) => all[Number(i)]).filter(Boolean) : all;
}

/** アトラスから1フレームを (x, y) に w × h で描く。rotated は 90° 回して描く */
export function paintSparrow(ctx, sp, img, x, y, w, h) {
  if (!sp.rotated) {
    ctx.drawImage(img, sp.x, sp.y, sp.width, sp.height, x, y, w, h);
    return;
  }
  ctx.save();
  ctx.translate(x, y + h);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(img, sp.x, sp.y, sp.width, sp.height, 0, 0, h, w);
  ctx.restore();
}
