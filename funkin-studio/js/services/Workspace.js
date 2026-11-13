/* ============================================================
   services/Workspace.js — 全エディタで共有する「読み込み済み mod のファイルの山」
   ------------------------------------------------------------
   ホーム画面で mod（zip / フォルダ）を読み込むと、ここに登録される。
   どのエディタも app.workspace から、同じファイルをパス付きで探せる（services/ModPack.js の規則）。
   ・files        … File / LazyZipFile の配列（中身はまだ読まない）
   ・add(files)   … 追加（同じファイルは無視）。増えたら events に "workspace:changed" を流す
   ・loadZip(f)   … zip を遅延展開で登録（スマホ可）
   ・toFile(f)    … 既存の <input type=file> ベースの処理へ渡すための、通常の File への変換
   ・atlasFor(assetPath, origin) … キャラ/prop 用の { png, def, anim } を探す
   ============================================================ */
import { openModZip, summarize, resolveAsset, infoOf, normAsset, relPathOf } from "./ModPack.js";

export class Workspace {
  constructor(app) {
    this.app = app;
    this.files = [];
    this.keys = new Set();
    this.names = []; // 読み込んだ mod の名前（表示用）
    this.outputOrigins = new Set(); // 書き出した（編集した）mod のフォルダ
    this.outputs = new Map(); // 編集して書き出したもの: mod 内のパス → データ（services/ModExport.js が zip にまとめる）
  }
  /** 小文字にした origin から、元の大文字小文字のままのフォルダ名を返す（書き出し先を元の mod と同じ綴りにするため） */
  rawOrigin(lower) {
    if (!lower) return lower ?? "";
    for (const f of this.files) {
      const i = infoOf(f);
      if (i.origin === lower) return relPathOf(f).replace(/\\/g, "/").split("/").filter(Boolean).slice(0, i.originLen).join("/");
    }
    return lower;
  }
  /** 読み込んだファイルのうち、いちばん多い origin（mod のフォルダ）。書き出し先の階層に使う */
  defaultOrigin() {
    const c = new Map();
    for (const f of this.files) {
      const o = infoOf(f).origin;
      c.set(o, (c.get(o) || 0) + 1);
    }
    return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }
  get size() {
    return this.files.length;
  }
  summary() {
    return summarize(this.files);
  }
  add(files, label) {
    let n = 0;
    for (const f of files) {
      const k = `${relPathOf(f)}|${f.size}|${f.lastModified}`;
      if (this.keys.has(k)) continue;
      this.keys.add(k);
      this.files.push(f);
      n++;
    }
    if (label && !this.names.includes(label)) this.names.push(label);
    if (n) this.app.events.emit("workspace:changed", { added: n });
    return n;
  }
  async loadZip(file) {
    return this.add(await openModZip(file), file.name);
  }
  clear() {
    this.files = [];
    this.keys.clear();
    this.names = [];
    this.outputs.clear();
    this.outputOrigins.clear();
    this.app.events.emit("workspace:changed", { added: 0, cleared: true });
  }
  /** 種類と assetPath から 1 つ選ぶ（ModPack.resolveAsset と同じ） */
  resolve(kind, assetPath, opts) {
    return resolveAsset(this.files, kind, assetPath, opts)?.file ?? null;
  }
  /** LazyZipFile → 通常の File（<input> や URL.createObjectURL に渡せる形）。File ならそのまま */
  async toFile(f) {
    if (!f?.lazy) return f;
    return new File([await f.blob()], f.name, { type: (await f.blob()).type });
  }
  /** assetPath に対応するアトラス一式を探す: { kind: "sparrow"|"animate", png, def, anim } / 見つからなければ null */
  atlasFor(assetPath, origin) {
    const png = this.resolve("image", assetPath, { origin, quiet: true });
    if (png) {
      const info = infoOf(png);
      // 同じパスの XML / TXT（Sparrow / Packer）
      const def = this.files.find((f) => /\.(xml|txt)$/i.test(f.name) && infoOf(f).noExt === info.noExt && infoOf(f).origin === info.origin);
      if (def) return { kind: "sparrow", png, def };
    }
    // AnimateAtlas: images/<assetPath>/ の下に Animation.json がある
    const want = "images/" + normAsset(assetPath) + "/";
    const inDir = this.files.filter((f) => {
      const i = infoOf(f);
      return (i.noExt + "/").startsWith(want) && (!origin || i.origin === origin || true);
    });
    const anim = inDir.find((f) => /^animation\.json$/i.test(f.name));
    if (anim) {
      const dir = infoOf(anim);
      const same = inDir.filter((f) => infoOf(f).origin === dir.origin);
      const def = same.find((f) => /^spritemap1\.json$/i.test(f.name)) || same.find((f) => /^spritemap\d*\.json$/i.test(f.name));
      const sp = def && same.find((f) => /\.png$/i.test(f.name) && f.name.replace(/\.png$/i, "") === def.name.replace(/\.json$/i, ""));
      if (def && sp) return { kind: "animate", png: sp, def, anim };
    }
    return null;
  }
}
