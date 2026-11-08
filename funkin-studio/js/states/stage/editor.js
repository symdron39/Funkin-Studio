/* ============================================================
   stage/editor.js — Stage Editor（V-Slice のステージ JSON の編集）のロジック
   ------------------------------------------------------------
   画面いっぱいのプレビュー（パン / ズーム）の上に、操作パネルを Hud として重ねる方式（Character Editor 3.0 と同じ）。
   v1 でできること:
     ・prop（画像 / 単色の矩形）の追加・複製・削除・移動・各プロパティ編集（scale / alpha / angle / zIndex / scroll / flip / color / blend）
     ・BF / DAD / GF の位置・scale・zIndex・cameraOffsets など。character.json + アトラスを読むと「実物」で表示
     ・レイヤー一覧（zIndex の順）・表示/非表示（エディタ上のみ）
     ・ゲームカメラの枠（1280×720 / cameraZoom）と、視差（scroll）のプレビュー
     ・Undo / Redo（HUD のボタン・Ctrl+Z / Ctrl+Y）・stage.json の読み込みと保存
   アニメ付き prop は Sparrow（PNG+XML）/ Packer（PNG+TXT）/ AnimateAtlas（Animation.json+spritemap）に対応。
   キャラは renderType sparrow / packer / multisparrow / animateatlas / multianimateatlas に対応（stageCharacter.js）
   未対応（値は消さずに保存される）: 色（tint）の AnimateAtlas への反映、custom の renderType

   座標: world の (0,0) = ステージの原点。prop の position は「スケール後の左上」、キャラの position は「足元」。
         （出典: play/stage/Stage.hx — propSprite.updateHitbox() / character.x = position − characterOrigin）

   目次: 1.状態 2.画像アセット 3.履歴 4.図形の計算 5.描画 6.選択とドラッグ 7.レイヤー一覧 8.プロパティ欄
         9.ステージ全体・ファイル 10.ビューとキーボード
   ============================================================ */
import { Viewport, isTextEntry } from "../../ui/Viewport.js";
import { HudPanels } from "../../ui/HudPanels.js";
import { defaultStage, normalizeStage, newProp, newRect, serializeStage, clone, round3, CHAR_IDS, CHAR_LABEL, isSolid, isAnimated, getScale, setScale, getScroll, baseName, parseColor, toRgbaCss, toHex6, blendToCanvas } from "./stageData.js";
import { loadImage, parseSparrowXml, parsePackerText } from "./sparrowAtlas.js";
import { SpriteAtlas, animateGroups, buildAnimateAtlas, isSpritemapPng } from "./atlas.js";
import { StageCharacter } from "./stageCharacter.js";

const SEL_COLOR = "#ffb020"; // 選択枠の色
const PLACEHOLDER = { bf: "#4a8cff", dad: "#a15cff", gf: "#ff6fb1" }; // キャラ未読み込み時のシルエット色
const CHAR_DRAW_ORDER = ["gf", "bf", "dad"]; // PlayState が addCharacter を呼ぶ順（同じ zIndex のとき後ろほど手前）

export function mountStageEditor(state) {
  // ============================================================
  // 1. 状態
  // ============================================================
  const $ = (id) => document.getElementById(id),
    canvas = $("stgCanvas"),
    ctx = canvas.getContext("2d");
  const vp = new Viewport(canvas, {
      state,
      originY: 0.5,
      onChange: () => {
        $("stgZoom").value = Number(vp.zoom.toFixed(2));
        draw();
      },
    }),
    panels = new HudPanels(state.root, {
      storageKey: "stage",
      defaults: ["files", "layers", "props"],
      narrowDefaults: ["layers"],
      narrowExclusive: ["files", "layers", "props", "stage"],
    });

  let doc = defaultStage(); // いま編集しているステージ JSON
  const chars = { bf: new StageCharacter("bf"), dad: new StageCharacter("dad"), gf: new StageCharacter("gf") };
  let sel = null; // 選択中: { kind: "prop", i } か { kind: "char", id }。無ければ null
  const hiddenChars = new Set(); // エディタ上で隠しているキャラ（保存しない）
  let camX = 0,
    camY = 0; // 視差プレビュー用のカメラ位置（保存しない）

  let toastTimer = null;
  const say = (s) => {
    $("stgStatus").textContent = s;
    const t = $("stgToast");
    t.textContent = s;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 4500);
  };
  state.addDisposer(() => clearTimeout(toastTimer));
  const markDirty = () => state.app.unsaved?.mark();

  // ============================================================
  // 2. 画像アセット
  // ============================================================
  // prop の assetPath と画像ファイルの結び付け:
  //   byBase : ファイル名（拡張子なし・小文字）→ 画像   … 自動で結び付く（assetPath のフォルダ部分は無視して比べる）
  //   linked : assetPath → 画像                         … 一覧の「選択」で手動指定したもの（こちらが優先）
  //   xml / linkedXml : 同じ仕組みの Sparrow XML 版（アニメ付き prop 用。{ sprites, name }）
  //   animate / linkedAnimate : AnimateAtlas（Animation.json + spritemap）の版。assetPath はフォルダなので、フォルダ名（最後の1つ）で結び付ける
  const assets = { byBase: new Map(), linked: new Map(), xml: new Map(), linkedXml: new Map(), animate: new Map(), linkedAnimate: new Map() };
  const segOf = (path) => String(path).replace(/\\/g, "/").split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
  const animateFor = (path) => (!path || path.startsWith("#") ? null : (assets.linkedAnimate.get(path) ?? assets.animate.get(segOf(path)) ?? null));
  const xmlFor = (path) =>
    !path || path.startsWith("#") ? null : (assets.linkedXml.get(path) ?? assets.xml.get(baseName(path).toLowerCase()) ?? null);
  const isXmlFile = (f) => /\.xml$/i.test(f.name);
  const assetFor = (path) =>
    !path || path.startsWith("#") ? null : (assets.linked.get(path) ?? assets.byBase.get(baseName(path).toLowerCase()) ?? null);

  async function registerImages(files) {
    const list = [...files];
    const out = [];
    out.xmls = [];
    out.animates = [];
    // AnimateAtlas: Animation.json があるフォルダごとに1セット（JSON と spritemap の PNG はここで使う）
    const used = new Set();
    for (const g of animateGroups(list)) {
      const name = g.dir || "選択したファイル";
      try {
        const atlas = await buildAnimateAtlas(g.files, g.dir);
        const key = g.dir ? segOf(g.dir) : "";
        if (key) assets.animate.set(key, atlas);
        else {
          // フォルダ名が分からない（スマホなど）: まだ画像の無い AnimateAtlas の prop が1つだけなら、それに結び付ける
          const open = [...new Set(doc.props.filter((p) => !isSolid(p) && animTypeOf(p) === "animateatlas" && isAnimated(p)).map((p) => p.assetPath))].filter((x) => !animateFor(x));
          if (open.length === 1) assets.linkedAnimate.set(open[0], atlas);
          else out.unlinked = (out.unlinked || 0) + 1;
        }
        out.animates.push({ key, dir: g.dir, atlas });
      } catch (e) {
        say(`AnimateAtlas を読み込めませんでした: ${name}（${e.message}）`);
      }
      g.files.filter((f) => /\.json$/i.test(f.name) || isSpritemapPng(f, list)).forEach((f) => used.add(f));
    }
    for (const f of list) {
      if (used.has(f)) continue;
      try {
        if (isXmlFile(f) || /\.txt$/i.test(f.name)) {
          const packer = /\.txt$/i.test(f.name);
          const x = { sprites: packer ? parsePackerText(await f.text()) : parseSparrowXml(await f.text()), name: f.name, kind: packer ? "packer" : "sparrow" };
          assets.xml.set(baseName(f.name).toLowerCase(), x);
          out.xmls.push({ file: f, xml: x });
          continue;
        }
        if (/\.json$/i.test(f.name)) continue; // stage.json や character.json はここでは使わない
        const entry = { image: await loadImage(f), name: f.name, tints: new Map() };
        assets.byBase.set(baseName(f.name).toLowerCase(), entry);
        out.push({ file: f, entry });
      } catch (e) {
        say(`読み込めませんでした: ${f.name}（${e.message}）`);
      }
    }
    return out;
  }
  /** 色を掛けた（tint）画像。Flixel の sprite.color は乗算なので、multiply で塗ってから元の形で切り抜く */
  function tinted(entry, color) {
    const key = toRgbaCss(color);
    let c = entry.tints.get(key);
    if (c) return c;
    const img = entry.image;
    c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(img, 0, 0);
    entry.tints.set(key, c);
    return c;
  }

  // ---- アニメ付き prop（Sparrow / Packer / AnimateAtlas）----
  // V-Slice (Stage.hx): animations が1つ以上ある prop は animType に応じて読み込む:
  //   sparrow（既定）: PNG + 同名の XML / packer: PNG + 同名の TXT（アニメは frameIndices = ファイル順の番号） / animateatlas: フォルダ（Animation.json + spritemap）
  //   animations が無ければ PNG 全体を1枚絵として使う。
  const animTypeOf = (p) => String(p.animType || "sparrow").toLowerCase();
  const isAtlasProp = (p) => isAnimated(p) && ["sparrow", "packer", "animateatlas"].includes(animTypeOf(p));
  let playing = false,
    playStart = 0,
    rafId = 0;
  /** 今プレビューするアニメ: _ed.anim（選択中）→ startingAnimation → 先頭 */
  function previewAnimOf(p) {
    const list = p.animations;
    return list.find((a) => a.name === p._ed?.anim) || list.find((a) => a.name === p.startingAnimation) || list[0];
  }
  /** prop が使うアトラス { atlas, entry?, type } 。作れなければ { why } */
  function propAtlas(p) {
    const type = animTypeOf(p);
    if (type === "animateatlas") {
      const a = animateFor(p.assetPath);
      return a ? { atlas: a, type } : { why: "AnimateAtlas が未登録" };
    }
    const entry = assetFor(p.assetPath),
      x = xmlFor(p.assetPath),
      ext = type === "packer" ? "TXT" : "XML";
    if (!entry || !x) return { why: !entry ? "画像が未登録" : `${ext} が未登録` };
    if (!x.sprites.length) return { why: `${ext} にスプライトがありません` };
    if (!x.atlas || x.atlasImage !== entry.image) {
      x.atlas = new SpriteAtlas(type === "packer" ? "packer" : "sparrow", entry.image, x.sprites);
      x.atlasImage = entry.image;
    }
    return { atlas: x.atlas, entry, type };
  }
  /** 表示するフレームの情報 { frame, ref, entry, refW, refH, ox, oy, stageMatrix } 。作れなければ { why } */
  function atlasView(p) {
    const v = propAtlas(p);
    if (!v.atlas) return v;
    // 基準の枠 = アトラス先頭フレーム（V-Slice は load 直後に updateHitbox するため）
    const ref = v.atlas.first();
    if (!ref) return { why: "フレームがありません" };
    const anim = previewAnimOf(p);
    const seq = v.atlas.frames(anim, { indexOnly: v.type === "packer" });
    let idx = 0;
    if (seq.length > 1 && playing) {
      const n = Math.floor(((performance.now() - playStart) / 1000) * (Number(anim.frameRate) || 24));
      idx = anim.looped === false ? Math.min(n, seq.length - 1) : n % seq.length;
    }
    const frame = seq[idx] || seq[0];
    if (!frame) return { why: `アニメ「${anim.name}」のフレームが見つかりません` };
    const off = anim.offsets || [0, 0];
    return {
      frame,
      ref,
      entry: v.entry,
      refW: ref.w,
      refH: ref.h,
      ox: Number(off[0]) || 0,
      oy: Number(off[1]) || 0,
      stageMatrix: !!(anim.atlasSettings ?? p.atlasSettings)?.applyStageMatrix,
    };
  }
  function setPlaying(on) {
    playing = on;
    if (on) {
      playStart = performance.now();
      const tick = () => {
        if (!playing) return;
        draw();
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafId);
      draw();
    }
  }
  state.addDisposer(() => {
    playing = false;
    cancelAnimationFrame(rafId);
  });
  // 左パネルの「画像アセット」一覧: prop が使っている assetPath ごとに、結び付き状況を表示
  /** 「選択」ボタン付きの1行。pick(files) は選ばれたファイルを受け取る */
  function assetRow(ok, text, title, { accept = "", multiple = false, pick }) {
    const row = document.createElement("div");
    row.className = "stgAsset" + (ok ? " ok" : " missing");
    const label = document.createElement("span");
    label.className = "stgAssetName";
    label.title = title;
    label.textContent = text;
    const btn = document.createElement("label");
    btn.className = "stgFileBtn";
    btn.textContent = "選択";
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.multiple = multiple;
    input.hidden = true;
    input.onchange = async () => {
      const files = [...input.files];
      input.value = "";
      if (files.length) await pick(files);
    };
    btn.append(input);
    row.append(label, btn);
    return row;
  }
  function renderAssets() {
    const box = $("stgAssetList");
    box.replaceChildren();
    const paths = [...new Set(doc.props.filter((p) => !isSolid(p) && p.assetPath).map((p) => p.assetPath))];
    if (!paths.length) {
      const t = document.createElement("p");
      t.className = "tiny";
      t.textContent = "画像を使う prop がありません。";
      box.append(t);
      return;
    }
    // path ごとの使われ方: animateatlas / packer / sparrow（アニメ付き）/ static（1枚絵）
    const typeOfPath = (path) => {
      const ps = doc.props.filter((p) => p.assetPath === path && isAtlasProp(p));
      if (ps.some((p) => animTypeOf(p) === "animateatlas")) return "animateatlas";
      if (ps.some((p) => animTypeOf(p) === "packer")) return "packer";
      return ps.length ? "sparrow" : "static";
    };
    const after = () => {
      renderAssets();
      refreshInspector();
      draw();
    };
    for (const path of paths) {
      const type = typeOfPath(path);
      if (type === "animateatlas") {
        // AnimateAtlas は「フォルダ」。Animation.json と spritemap（JSON + PNG）をまとめて選ぶ
        const a = animateFor(path);
        box.append(
          assetRow(!!a, (a ? "✅ " : "⚠ ") + path + (a ? `  ← ${a.label}` : "  (AnimateAtlas)"), path, {
            multiple: true,
            pick: async (files) => {
              try {
                assets.linkedAnimate.set(path, await buildAnimateAtlas(files, path));
              } catch (e) {
                say(`AnimateAtlas を読み込めませんでした: ${e.message}`);
              }
              after();
            },
          }),
        );
        continue;
      }
      const entry = assetFor(path);
      box.append(
        assetRow(!!entry, (entry ? "✅ " : "⚠ ") + path + (entry ? `  ← ${entry.name}` : ""), path, {
          accept: "image/*",
          pick: async (files) => {
            const [r] = await registerImages([files[0]]);
            if (r) assets.linked.set(path, r.entry);
            after();
          },
        }),
      );
      if (type === "sparrow" || type === "packer") {
        // アニメ付き prop は XML（packer は TXT）も必要
        const ext = type === "packer" ? "TXT" : "XML";
        const x = xmlFor(path);
        box.append(
          assetRow(!!x, (x ? `✅ ${ext} ` : `⚠ ${ext} `) + path + (x ? `  ← ${x.name}` : ""), `${path}.${ext.toLowerCase()}`, {
            accept: type === "packer" ? ".txt,text/plain" : ".xml,text/xml,application/xml",
            pick: async (files) => {
              const r = await registerImages([files[0]]);
              if (r.xmls[0]) assets.linkedXml.set(path, r.xmls[0].xml);
              after();
            },
          }),
        );
      }
    }
  }

  // ============================================================
  // 3. 履歴（Undo / Redo）
  // ============================================================
  // 「変更が確定するたびに、ステージ全体を JSON 文字列にして積む」方式。
  //   history[hi] が現在の状態。Undo = hi を戻して JSON.parse し直す。
  //   入力欄の途中経過（input）では積まず、確定（change）・ドラッグの終わり・ボタン操作のときに commit() する。
  let history = [],
    hi = -1,
    lastNudgeAt = 0;
  function resetHistory() {
    history = [JSON.stringify(doc)];
    hi = 0;
    syncHud();
  }
  function commit(merge = false) {
    const s = JSON.stringify(doc);
    if (s === history[hi]) return;
    if (merge && hi > 0) history[hi] = s; // 矢印キーの連打は1つにまとめる
    else {
      history.length = hi + 1; // やり直し側の履歴は捨てる
      history.push(s);
      hi++;
      if (history.length > 100) {
        history.shift();
        hi--;
      }
    }
    markDirty();
    syncHud();
  }
  function restoreAt(i) {
    blurFocus();
    hi = i;
    doc = JSON.parse(history[hi]);
    if (sel?.kind === "prop" && sel.i >= doc.props.length) sel = null;
    refreshAll();
    markDirty();
    syncHud();
  }
  const undo = () => hi > 0 && restoreAt(hi - 1);
  const redo = () => hi < history.length - 1 && restoreAt(hi + 1);
  function syncHud() {
    if (state.active) state.app.hud.setHistory(hi > 0, hi < history.length - 1);
  }

  // ============================================================
  // 4. 図形の計算
  // ============================================================
  // 描く物（prop とキャラ）を「奥 → 手前」の順に並べる。zIndex が小さいほど奥。同じなら props（JSONの順）→ キャラ。
  function objects() {
    const list = doc.props.map((ref, i) => ({ kind: "prop", i, ref, z: ref.zIndex || 0, ord: i }));
    CHAR_DRAW_ORDER.forEach((id, n) => {
      const ref = doc.characters[id];
      list.push({ kind: "char", id, ref, z: ref.zIndex || 0, ord: 1e6 + n });
    });
    return list.sort((a, b) => a.z - b.z || a.ord - b.ord);
  }
  const isHidden = (o) => (o.kind === "prop" ? !!o.ref._ed?.hidden : hiddenChars.has(o.id));
  const isSelected = (o) => !!sel && sel.kind === o.kind && (o.kind === "prop" ? sel.i === o.i : sel.id === o.id);
  const selectedObj = () => (!sel ? null : sel.kind === "prop" ? (doc.props[sel.i] ? { kind: "prop", i: sel.i, ref: doc.props[sel.i] } : null) : { kind: "char", id: sel.id, ref: doc.characters[sel.id] });

  // 視差: scroll が 1 より小さい物は、カメラの動きより遅れて動く。screen = pos − camera × scroll なので、
  // 「世界と一緒に動く」場合(scroll=1)からのずれは camera × (1 − scroll)。
  // （ref = prop かキャラの定義。scroll が無ければ [1, 1] = 視差なし）
  const parallax = (ref) => {
    const [sx, sy] = getScroll(ref);
    return [camX * (1 - sx), camY * (1 - sy)];
  };

  /** キャラの配置。実キャラを読み込んでいれば V-Slice と同じ計算（StageCharacter.place）、無ければ仮のシルエット */
  function charPlace(id) {
    const sc = doc.characters[id];
    if (chars[id].loaded) return { ...chars[id].place(sc), loaded: true };
    const k = Number(sc.scale) || 1,
      w = 120 * k,
      h = 240 * k;
    return {
      k, feetX: sc.position[0], feetY: sc.position[1], w, h, loaded: false,
      focusX: sc.position[0] + sc.cameraOffsets[0], focusY: sc.position[1] - h / 2 + sc.cameraOffsets[1],
      flip: false,
    };
  }

  /** 当たり判定と選択枠に使う形: 中心 (cx, cy)・幅高さ・角度（度）・視差のずれ */
  function geom(o) {
    if (o.kind === "char") {
      const pl = charPlace(o.id),
        [dx, dy] = parallax(o.ref);
      return { cx: pl.feetX, cy: pl.feetY - pl.h / 2, w: pl.w, h: pl.h, angle: o.ref.angle || 0, dx, dy, pl };
    }
    const p = o.ref,
      [sx, sy] = getScale(p),
      [dx, dy] = parallax(p);
    let w, h;
    if (isSolid(p)) [w, h] = [Math.abs(sx), Math.abs(sy)];
    else if (isAnimated(p)) {
      const v = isAtlasProp(p) ? atlasView(p) : null;
      [w, h] = v?.frame ? [v.refW * Math.abs(sx), v.refH * Math.abs(sy)] : [120, 120];
    } else {
      const a = assetFor(p.assetPath);
      [w, h] = a ? [a.image.naturalWidth * Math.abs(sx), a.image.naturalHeight * Math.abs(sy)] : [200, 100];
    }
    return { cx: p.position[0] + w / 2, cy: p.position[1] + h / 2, w, h, angle: p.angle || 0, dx, dy };
  }

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
    draw();
  }
  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(canvas);
  state.addDisposer(() => resizeObserver.disconnect());

  /** 点線の枠 + 文字（未登録の画像・アニメ付き prop・キャラ未読み込みの表示用）。中心が (0,0) の座標系で描く */
  function placeholderBox(w, h, label, stroke, fill) {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2 / vp.zoom;
    ctx.setLineDash([8 / vp.zoom, 5 / vp.zoom]);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = stroke;
    ctx.font = `${Math.max(11, 13 / vp.zoom)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(label, 0, 4 / vp.zoom, w);
    ctx.restore();
  }

  function drawProp(p, g) {
    ctx.save();
    ctx.translate(g.cx, g.cy);
    if (g.angle) ctx.rotate((g.angle * Math.PI) / 180);
    ctx.scale(p.flipX ? -1 : 1, p.flipY ? -1 : 1);
    ctx.globalAlpha = Math.max(0, Math.min(1, Number(p.alpha ?? 1)));
    ctx.globalCompositeOperation = blendToCanvas(p.blend);
    if (isSolid(p)) {
      const c = parseColor(p.assetPath) || { r: 255, g: 0, b: 255, a: 1 };
      ctx.fillStyle = toRgbaCss(c);
      ctx.fillRect(-g.w / 2, -g.h / 2, g.w, g.h);
    } else if (isAnimated(p)) {
      const v = isAtlasProp(p) ? atlasView(p) : null;
      if (!v?.frame) {
        const why = !isAtlasProp(p) ? `${p.animType} は未対応` : v.why;
        placeholderBox(g.w, g.h, `アニメ付き: ${p.name || p.assetPath}（${why}）`, "#9aa4b5", "rgba(150,160,180,0.15)");
      } else {
        const [sx, sy] = getScale(p);
        ctx.imageSmoothingEnabled = !p.isPixel;
        // アニメのオフセットは「描画位置を −offset × scale ずらす」（Bopper.getScreenPosition）。回転・反転より前に適用する
        ctx.restore();
        ctx.save();
        ctx.translate(g.cx, g.cy);
        if (g.angle) ctx.rotate((g.angle * Math.PI) / 180);
        ctx.translate(-v.ox * Math.abs(sx), -v.oy * Math.abs(sy));
        ctx.scale(p.flipX ? -1 : 1, p.flipY ? -1 : 1);
        ctx.globalAlpha = Math.max(0, Math.min(1, Number(p.alpha ?? 1)));
        ctx.globalCompositeOperation = blendToCanvas(p.blend);
        ctx.scale(Math.abs(sx), Math.abs(sy));
        // 色（tint）は Sparrow / Packer のときだけ反映する（AnimateAtlas は未対応）
        const tint = p.color ? parseColor(p.color) : null;
        const white = !tint || (tint.r === 255 && tint.g === 255 && tint.b === 255);
        const img = v.entry && !white ? tinted(v.entry, tint) : undefined;
        // 基準枠の左上 = (−refW/2, −refH/2)。frame が自分の枠をそこに合わせて描く
        v.frame.draw(ctx, -v.refW / 2, -v.refH / 2, v.ref, v.stageMatrix, img);
      }
    } else {
      const a = assetFor(p.assetPath);
      if (!a) placeholderBox(g.w, g.h, `未登録: ${p.assetPath}`, "#ff6b6b", "rgba(255,80,80,0.12)");
      else {
        ctx.imageSmoothingEnabled = !p.isPixel;
        const tint = p.color ? parseColor(p.color) : null;
        const white = !tint || (tint.r === 255 && tint.g === 255 && tint.b === 255);
        ctx.drawImage(white ? a.image : tinted(a, tint), -g.w / 2, -g.h / 2, g.w, g.h);
      }
    }
    ctx.restore();
  }

  function drawChar(id, g) {
    const sc = doc.characters[id],
      pl = g.pl;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, Number(sc.alpha ?? 1)));
    ctx.translate(pl.feetX, pl.feetY);
    // 角度は枠の中心まわりに回す（FlxSprite.origin = フレームの中心）
    ctx.translate(0, -pl.h / 2);
    if (g.angle) ctx.rotate((g.angle * Math.PI) / 180);
    ctx.translate(0, pl.h / 2);
    if (pl.loaded) {
      ctx.scale(pl.k, pl.k);
      chars[id].paint(ctx, pl.flip);
    } else {
      ctx.translate(0, -pl.h / 2);
      placeholderBox(pl.w, pl.h, `${CHAR_LABEL[id]}（キャラ未読み込み）`, PLACEHOLDER[id], PLACEHOLDER[id] + "33");
    }
    ctx.restore();
  }

  /** 傾いた長方形の4隅（world 座標） */
  function corners(g) {
    const r = (g.angle * Math.PI) / 180,
      c = Math.cos(r),
      s = Math.sin(r);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([ax, ay]) => {
      const lx = (ax * g.w) / 2,
        ly = (ay * g.h) / 2;
      return [g.cx + g.dx + lx * c - ly * s, g.cy + g.dy + lx * s + ly * c];
    });
  }

  function draw() {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    vp.drawGrid(ctx);
    const o = vp.origin(),
      z = vp.zoom,
      list = objects();

    // --- 物を奥から順に描く（world 座標系: 原点を画面の o に置き、zoom 倍する） ---
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(z, z);
    for (const obj of list) {
      if (isHidden(obj)) continue;
      const g = geom(obj);
      ctx.save();
      ctx.translate(g.dx, g.dy);
      if (obj.kind === "prop") drawProp(obj.ref, g);
      else drawChar(obj.id, g);
      ctx.restore();
    }
    ctx.restore();

    // --- 目印（画面座標で描く: 線の太さが拡大率に左右されない） ---
    const S = (x, y) => vp.toScreen(x, y);
    ctx.save();
    ctx.font = "11px system-ui, sans-serif";
    for (const id of CHAR_IDS) {
      if (hiddenChars.has(id)) continue;
      const sc = doc.characters[id],
        [dx, dy] = parallax(sc),
        p = S(sc.position[0] + dx, sc.position[1] + dy);
      // 足元のマーカー = JSON の position（ここがキャラの足元）
      ctx.strokeStyle = PLACEHOLDER[id];
      ctx.fillStyle = PLACEHOLDER[id];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - 9, p.y);
      ctx.lineTo(p.x + 9, p.y);
      ctx.moveTo(p.x, p.y - 9);
      ctx.lineTo(p.x, p.y + 9);
      ctx.stroke();
      ctx.fillText(CHAR_LABEL[id], p.x + 11, p.y + 14);
    }
    // 選択枠
    const so = selectedObj();
    if (so && !isHidden(so)) {
      const pts = corners(geom(so)).map(([x, y]) => S(x, y));
      ctx.strokeStyle = SEL_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    }
    // ゲームカメラの枠: 焦点 = キャラの中心 + cameraOffsets。見える範囲 = (1280 × 720) / cameraZoom
    const target = $("stgCamTarget").value;
    if (target) {
      const pl = charPlace(target),
        zoom = Number(doc.cameraZoom) || 1,
        cw = 1280 / zoom,
        ch = 720 / zoom;
      const a = S(pl.focusX - cw / 2, pl.focusY - ch / 2),
        b = S(pl.focusX + cw / 2, pl.focusY + ch / 2),
        f = S(pl.focusX, pl.focusY);
      ctx.strokeStyle = "#35d0ff";
      ctx.fillStyle = "#35d0ff";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(f.x, f.y - 7);
      ctx.lineTo(f.x + 7, f.y);
      ctx.lineTo(f.x, f.y + 7);
      ctx.lineTo(f.x - 7, f.y);
      ctx.closePath();
      ctx.fill();
      ctx.fillText(`カメラ(${CHAR_LABEL[target]}) zoom ${zoom}`, a.x + 6, a.y + 14);
    }
    ctx.restore();
    updateReadout();
  }

  function updateReadout() {
    const so = selectedObj();
    $("stgReadout").textContent = so
      ? `${so.kind === "prop" ? so.ref.name || so.ref.assetPath : CHAR_LABEL[so.id]}  (${round3(so.ref.position[0])}, ${round3(so.ref.position[1])})`
      : `props ${doc.props.length}`;
  }

  // ============================================================
  // 6. 選択とドラッグ
  // ============================================================
  /** world の点 (x, y) にある、いちばん手前の物（隠しているものは除く） */
  function pick(x, y) {
    const list = objects().reverse();
    for (const obj of list) {
      if (isHidden(obj)) continue;
      const g = geom(obj),
        r = (-g.angle * Math.PI) / 180,
        px = x - (g.cx + g.dx),
        py = y - (g.cy + g.dy);
      const lx = px * Math.cos(r) - py * Math.sin(r),
        ly = px * Math.sin(r) + py * Math.cos(r);
      if (Math.abs(lx) <= g.w / 2 && Math.abs(ly) <= g.h / 2) return obj;
    }
    return null;
  }
  // 入力欄にフォーカスが残っていると、setVal が「入力中の欄」として更新をスキップしてしまう。
  // 先に blur する（未確定の入力は、ここで change が発火して今の選択に確定される）
  function blurFocus() {
    const a = document.activeElement;
    if (a instanceof HTMLElement && state.root.contains(a)) a.blur();
  }
  function select(obj) {
    blurFocus();
    sel = obj ? (obj.kind === "prop" ? { kind: "prop", i: obj.i } : { kind: "char", id: obj.id }) : null;
    refreshInspector();
    renderLayers();
    draw();
  }
  const pointerWorld = (e) => {
    const r = canvas.getBoundingClientRect();
    return vp.toWorld(e.clientX - r.left, e.clientY - r.top);
  };

  let drag = null; // { id, start: {x,y}, orig: [x,y], moved }
  canvas.addEventListener("pointerdown", (e) => {
    // パン操作（中/右ドラッグ・Space・✋）は Viewport が先に処理している。左クリックだけが選択・移動
    if (vp.panning || e.button !== 0) return;
    const w = pointerWorld(e),
      hit = pick(w.x, w.y);
    select(hit);
    if (!hit) return;
    drag = { id: e.pointerId, start: w, orig: [...hit.ref.position], moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const so = selectedObj();
    if (!so) return;
    const w = pointerWorld(e);
    let dx = w.x - drag.start.x,
      dy = w.y - drag.start.y;
    if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0); // Shift: 縦横どちらかに固定
    const q = e.altKey ? round3 : Math.round; // Alt: 小数のまま / 通常は整数に吸着
    so.ref.position = [q(drag.orig[0] + dx), q(drag.orig[1] + dy)];
    drag.moved = true;
    syncPositionFields();
    draw();
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const moved = drag.moved;
    drag = null;
    if (moved) commit();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  // ============================================================
  // 7. レイヤー一覧
  // ============================================================
  function renderLayers() {
    const box = $("stgLayers");
    box.replaceChildren();
    for (const obj of objects().reverse()) {
      // 上ほど手前
      const row = document.createElement("div");
      row.className = "stgLayer" + (isSelected(obj) ? " sel" : "") + (isHidden(obj) ? " off" : "");
      row.setAttribute("role", "option");
      row.dataset.kind = obj.kind;
      if (obj.kind === "prop") row.dataset.i = obj.i;
      else row.dataset.id = obj.id;
      const eye = document.createElement("button");
      eye.type = "button";
      eye.className = "stgVis";
      eye.dataset.vis = "1";
      eye.title = "エディタ上の表示 / 非表示";
      eye.textContent = isHidden(obj) ? "🚫" : "👁";
      const name = document.createElement("span");
      name.className = "stgLname";
      name.textContent = obj.kind === "char" ? `🧍 ${CHAR_LABEL[obj.id]}` : (isSolid(obj.ref) ? "▭ " : "🖼 ") + (obj.ref.name || obj.ref.assetPath || "(無名)");
      const z = document.createElement("span");
      z.className = "stgLz";
      z.textContent = "z" + (obj.ref.zIndex || 0);
      row.append(eye, name, z);
      box.append(row);
    }
  }
  $("stgLayers").addEventListener("click", (e) => {
    const row = e.target.closest(".stgLayer");
    if (!row) return;
    const obj = row.dataset.kind === "prop" ? { kind: "prop", i: Number(row.dataset.i), ref: doc.props[Number(row.dataset.i)] } : { kind: "char", id: row.dataset.id, ref: doc.characters[row.dataset.id] };
    if (e.target.closest("[data-vis]")) {
      if (obj.kind === "prop") obj.ref._ed = { ...obj.ref._ed, hidden: !obj.ref._ed?.hidden };
      else hiddenChars.has(obj.id) ? hiddenChars.delete(obj.id) : hiddenChars.add(obj.id);
      renderLayers();
      draw();
      return;
    }
    select(obj);
  });

  // 追加・複製・削除・手前/奥
  const maxZ = () => doc.props.reduce((m, p) => Math.max(m, p.zIndex || 0), 0);
  function addProp(p) {
    doc.props.push(p);
    select({ kind: "prop", i: doc.props.length - 1 });
    renderAssets();
    commit();
  }
  $("stgAddImage").onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    const regs = await registerImages(files);
    const c = vp.toWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
    let animated = 0;
    regs.forEach(({ entry, file }, n) => {
      const x = c.x - entry.image.naturalWidth / 2 + n * 30,
        y = c.y - entry.image.naturalHeight / 2 + n * 30;
      const prop = newProp(baseName(file.name), Math.round(x), Math.round(y), maxZ() + 1);
      // 同名の XML / TXT も一緒に選ばれていれば、アニメ付き prop として追加する
      const xml = xmlFor(prop.assetPath);
      if (xml?.sprites.length) {
        const atlas = new SpriteAtlas(xml.kind === "packer" ? "packer" : "sparrow", entry.image, xml.sprites);
        prop.animations = atlas.suggestAnimations();
        prop.startingAnimation = prop.animations[0].name;
        if (xml.kind === "packer") prop.animType = "packer";
        animated++;
      }
      addProp(prop);
    });
    // AnimateAtlas（Animation.json + spritemap）は、フォルダごとに1つの prop にする
    regs.animates.forEach(({ key, dir, atlas }, n) => {
      const ref = atlas.first(),
        name = key ? dir.split("/").filter(Boolean).pop() : `atlas${n + 1}`;
      const prop = newProp(name, Math.round(c.x - (ref?.w || 0) / 2 + n * 30), Math.round(c.y - (ref?.h || 0) / 2 + n * 30), maxZ() + 1);
      prop.animType = "animateatlas";
      prop.animations = atlas.suggestAnimations();
      prop.startingAnimation = prop.animations[0].name;
      if (!key) assets.linkedAnimate.set(prop.assetPath, atlas);
      addProp(prop);
      animated++;
    });
    const n = regs.length + regs.animates.length;
    if (n) say(`${n} 個の prop を追加しました${animated ? `。うち ${animated} 個はアトラスからアニメを作成` : ""}。`);
    else if (regs.xmls.length) say(`${regs.xmls[0].xml.kind === "packer" ? "TXT" : "XML"} を ${regs.xmls.length} 個登録しました。PNG と同時に選ぶとアニメ付き prop になります。`);
  };
  $("stgAddRect").onclick = () => {
    const c = vp.toWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
    addProp(newRect(Math.round(c.x - 100), Math.round(c.y - 100), 200, 200, "#FF0000", maxZ() + 1));
  };
  $("stgDup").onclick = () => {
    if (sel?.kind !== "prop") return say("複製できるのは prop だけです。");
    const src = clone(doc.props[sel.i]);
    delete src._ed;
    src.name = (src.name || baseName(src.assetPath)) + "_copy";
    src.position = [src.position[0] + 24, src.position[1] + 24];
    src.zIndex = (src.zIndex || 0) + 1;
    addProp(src);
  };
  $("stgDel").onclick = deleteSelected;
  function deleteSelected() {
    if (sel?.kind !== "prop") return say(sel ? "キャラは削除できません（非表示にするには👁を使います）。" : "削除する物を選んでください。");
    doc.props.splice(sel.i, 1);
    sel = null;
    refreshAll();
    commit();
  }
  function shiftZ(d) {
    const so = selectedObj();
    if (!so) return;
    so.ref.zIndex = (so.ref.zIndex || 0) + d;
    refreshInspector();
    renderLayers();
    draw();
    commit();
  }
  $("stgUp").onclick = () => shiftZ(1);
  $("stgDown").onclick = () => shiftZ(-1);

  // ============================================================
  // 8. プロパティ欄
  // ============================================================
  // 欄を作る（refreshInspector）: 選択中の物の値を各入力欄へ。
  // 欄を編集する（onEdit）: input = 途中経過（描画だけ更新）/ change = 確定（履歴に積む）。
  function setVal(id, v) {
    const el = $(id);
    if (document.activeElement === el) return; // 入力中の欄は上書きしない（カーソルが飛ぶため）
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v ?? "";
  }
  /** ドラッグ・矢印キーで位置が変わったとき、X / Y 欄だけ更新 */
  function syncPositionFields() {
    const so = selectedObj();
    if (!so) return;
    const [x, y] = so.ref.position;
    if (so.kind === "prop") (setVal("stgPX", x), setVal("stgPY", y));
    else (setVal("stgCX", x), setVal("stgCY", y));
    updateReadout();
  }

  function refreshInspector() {
    const so = selectedObj();
    $("stgNoSel").hidden = !!so;
    $("stgPropFields").hidden = so?.kind !== "prop";
    $("stgCharFields").hidden = so?.kind !== "char";
    $("stgPropsTitle").textContent = !so ? "プロパティ" : so.kind === "prop" ? "プロパティ — prop" : `プロパティ — ${CHAR_LABEL[so.id]}`;
    if (!so) return;
    const r = so.ref;
    if (so.kind === "prop") {
      const solid = isSolid(r),
        [sx, sy] = getScale(r),
        [cx, cy] = getScroll(r);
      setVal("stgPName", r.name);
      setVal("stgPAsset", r.assetPath);
      setVal("stgPX", r.position[0]);
      setVal("stgPY", r.position[1]);
      $("stgPScaleXLabel").textContent = solid ? "幅 (px)" : "Scale X";
      $("stgPScaleYLabel").textContent = solid ? "高さ (px)" : "Scale Y";
      setVal("stgPSX", sx);
      setVal("stgPSY", sy);
      setVal("stgPAlpha", r.alpha ?? 1);
      setVal("stgPAngle", r.angle ?? 0);
      setVal("stgPZ", r.zIndex ?? 0);
      setVal("stgPScrX", cx);
      setVal("stgPScrY", cy);
      setVal("stgPFlipX", r.flipX);
      setVal("stgPFlipY", r.flipY);
      setVal("stgPPixel", r.isPixel);
      const col = solid ? r.assetPath : (r.color ?? "#FFFFFF");
      setVal("stgPColor", col);
      $("stgPColorPick").value = toHex6(col);
      setVal("stgPBlend", r.blend ?? "");
      const animRow = $("stgPAnimRow"),
        sparrow = !solid && isAtlasProp(r);
      animRow.hidden = !sparrow;
      if (sparrow) {
        const sel = $("stgPAnim");
        sel.replaceChildren(...r.animations.map((a) => Object.assign(document.createElement("option"), { value: a.name, textContent: a.name })));
        sel.value = previewAnimOf(r).name;
        $("stgPPlay").checked = playing;
      }
      const type = animTypeOf(r),
        TYPE_LABEL = { sparrow: "Sparrow", packer: "Packer", animateatlas: "AnimateAtlas" };
      $("stgPNote").textContent = isAnimated(r)
        ? !sparrow
          ? `animType「${r.animType}」は未対応です（枠で表示。値はそのまま保存されます）。`
          : propAtlas(r).atlas
            ? `アニメ付き（${TYPE_LABEL[type]}）。選んだアニメの先頭フレームを表示します。▶で再生プレビュー（保存されません）。${type === "animateatlas" ? "色（Color）は AnimateAtlas には反映されません。" : ""}`
            : type === "animateatlas"
              ? "AnimateAtlas が未登録です。左の「画像アセット」から、Animation.json と spritemap（JSON + PNG）を登録してください。"
              : `${type === "packer" ? "TXT" : "XML"} が未登録です。左の「画像アセット」から同名のファイルを登録してください。`
        : solid
          ? "単色の矩形です。幅・高さは scale に [w, h] で保存されます。Color 欄が assetPath（色）です。"
          : assetFor(r.assetPath) ? "" : "画像が未登録です。左の「画像アセット」から登録してください。";
    } else {
      setVal("stgCX", r.position[0]);
      setVal("stgCY", r.position[1]);
      setVal("stgCScale", r.scale);
      setVal("stgCZ", r.zIndex ?? 0);
      setVal("stgCCamX", r.cameraOffsets[0]);
      setVal("stgCCamY", r.cameraOffsets[1]);
      setVal("stgCAlpha", r.alpha ?? 1);
      setVal("stgCAngle", r.angle ?? 0);
      const [cx, cy] = getScroll(r);
      setVal("stgCScrX", cx);
      setVal("stgCScrY", cy);
      const ch = chars[so.id];
      $("stgCharInfo").textContent = ch.loaded
        ? `読み込み済み: ${ch.view.name}（${ch.fileNames.join(" / ")}）\n基準フレーム: ${ch.view.label} ${ch.view.refW}×${ch.view.refH}、キャラ scale ${ch.view.baseScale}\nposition は「足元」の位置です。`
        : ch.error || "未読み込み（仮のシルエットで表示中）。position は「足元」の位置です。";
    }
  }

  // 値が「既定値と同じ」ならキーを消す（JSON を小さく保つ。V-Slice は欠けたキーを既定値として読むので同じ意味）
  function setOpt(ref, key, v, def) {
    if (v === def || v === "" || v === undefined) delete ref[key];
    else ref[key] = v;
  }
  const numOf = (el) => (el.value === "" || !Number.isFinite(Number(el.value)) ? null : Number(el.value));

  function onEdit(id, kind, fn, { extra } = {}) {
    const el = $(id);
    const run = () => {
      const so = selectedObj();
      if (!so || so.kind !== kind) return false;
      return fn(so.ref, el, so) !== false;
    };
    const after = () => {
      renderLayers();
      draw();
    };
    if (el.type === "checkbox" || el.tagName === "SELECT") {
      el.addEventListener("change", () => {
        if (run()) (after(), commit(), extra?.());
      });
    } else {
      el.addEventListener("input", () => {
        if (run()) after();
      });
      el.addEventListener("change", () => {
        if (run()) (after(), commit(), extra?.());
      });
    }
  }
  // --- prop ---
  onEdit("stgPName", "prop", (r, el) => setOpt(r, "name", el.value, ""));
  onEdit("stgPAsset", "prop", (r, el) => { r.assetPath = el.value; }, { extra: () => (renderAssets(), refreshInspector()) });
  onEdit("stgPX", "prop", (r, el) => { const n = numOf(el); if (n === null) return false; r.position = [n, r.position[1]]; });
  onEdit("stgPY", "prop", (r, el) => { const n = numOf(el); if (n === null) return false; r.position = [r.position[0], n]; });
  // Scale: 縦横比を固定しているときは、片方を変えるともう片方も同じ比率で変わる（単色の矩形は常に独立）
  const scaleEdit = (axis) => (r, el) => {
    const n = numOf(el);
    if (n === null) return false;
    let [sx, sy] = getScale(r);
    const lock = $("stgPLock").checked && !isSolid(r);
    if (axis === 0) {
      if (lock && sx) sy = (sy / sx) * n;
      sx = n;
    } else {
      if (lock && sy) sx = (sx / sy) * n;
      sy = n;
    }
    setScale(r, sx, sy);
    if (lock) (setVal("stgPSX", round3(sx)), setVal("stgPSY", round3(sy)));
  };
  onEdit("stgPSX", "prop", scaleEdit(0));
  onEdit("stgPSY", "prop", scaleEdit(1));
  onEdit("stgPAlpha", "prop", (r, el) => { const n = numOf(el); if (n === null) return false; setOpt(r, "alpha", n, 1); });
  onEdit("stgPAngle", "prop", (r, el) => { const n = numOf(el); if (n === null) return false; setOpt(r, "angle", n, 0); });
  onEdit("stgPZ", "prop", (r, el) => { const n = numOf(el); if (n === null) return false; r.zIndex = Math.trunc(n); });
  onEdit("stgPScrX", "prop", (r, el) => { const n = numOf(el); if (n === null) return false; r.scroll = [n, getScroll(r)[1]]; });
  onEdit("stgPScrY", "prop", (r, el) => { const n = numOf(el); if (n === null) return false; r.scroll = [getScroll(r)[0], n]; });
  onEdit("stgPFlipX", "prop", (r, el) => setOpt(r, "flipX", el.checked, false));
  onEdit("stgPFlipY", "prop", (r, el) => setOpt(r, "flipY", el.checked, false));
  onEdit("stgPPixel", "prop", (r, el) => setOpt(r, "isPixel", el.checked, false));
  // Color: 画像 prop では色味（乗算）、単色の矩形では assetPath そのもの
  const colorWrite = (r, value) => {
    if (isSolid(r)) r.assetPath = value.startsWith("#") ? value : "#" + value.replace(/^0x/i, "");
    else setOpt(r, "color", value.toUpperCase() === "#FFFFFF" ? "" : value, "");
  };
  onEdit("stgPColor", "prop", (r, el) => colorWrite(r, el.value.trim()));
  onEdit("stgPColorPick", "prop", (r, el) => {
    colorWrite(r, el.value.toUpperCase());
    setVal("stgPColor", el.value.toUpperCase());
  });
  onEdit("stgPBlend", "prop", (r, el) => setOpt(r, "blend", el.value, ""));
  // --- キャラ ---
  onEdit("stgCX", "char", (r, el) => { const n = numOf(el); if (n === null) return false; r.position = [n, r.position[1]]; });
  onEdit("stgCY", "char", (r, el) => { const n = numOf(el); if (n === null) return false; r.position = [r.position[0], n]; });
  onEdit("stgCScale", "char", (r, el) => { const n = numOf(el); if (n === null || n <= 0) return false; r.scale = n; });
  onEdit("stgCZ", "char", (r, el) => { const n = numOf(el); if (n === null) return false; r.zIndex = Math.trunc(n); });
  onEdit("stgCCamX", "char", (r, el) => { const n = numOf(el); if (n === null) return false; r.cameraOffsets = [n, r.cameraOffsets[1]]; });
  onEdit("stgCCamY", "char", (r, el) => { const n = numOf(el); if (n === null) return false; r.cameraOffsets = [r.cameraOffsets[0], n]; });
  onEdit("stgCAlpha", "char", (r, el) => { const n = numOf(el); if (n === null) return false; setOpt(r, "alpha", n, 1); });
  onEdit("stgCAngle", "char", (r, el) => { const n = numOf(el); if (n === null) return false; setOpt(r, "angle", n, 0); });
  onEdit("stgCScrX", "char", (r, el) => { const n = numOf(el); if (n === null) return false; r.scroll = [n, getScroll(r)[1]]; });
  onEdit("stgCScrY", "char", (r, el) => { const n = numOf(el); if (n === null) return false; r.scroll = [getScroll(r)[0], n]; });

  // キャラの実物を読み込む / 外す
  const onCharFiles = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (sel?.kind !== "char" || !files.length) return;
    const ch = chars[sel.id];
    try {
      await ch.loadFiles(files);
      say(`${CHAR_LABEL[sel.id]} に ${ch.view.name} を読み込みました（基準: ${ch.view.label}）。`);
    } catch (err) {
      ch.error = "読み込みエラー: " + err.message;
      say(ch.error);
    }
    refreshInspector();
    draw();
  };
  $("stgCharFiles").onchange = onCharFiles;
  $("stgCharDir").onchange = onCharFiles;
  $("stgCharClear").onclick = () => {
    if (sel?.kind !== "char") return;
    chars[sel.id].reset();
    refreshInspector();
    draw();
  };

  // ============================================================
  // 9. ステージ全体・ファイル
  // ============================================================
  function refreshStageFields() {
    setVal("stgName", doc.name);
    setVal("stgCamZoom", doc.cameraZoom);
    setVal("stgDirectory", doc.directory);
  }
  const stageEdit = (id, fn) => {
    const el = $(id);
    el.addEventListener("input", () => (fn(el), draw()));
    el.addEventListener("change", () => (fn(el), draw(), commit()));
  };
  stageEdit("stgName", (el) => (doc.name = el.value));
  stageEdit("stgCamZoom", (el) => {
    const n = numOf(el);
    if (n && n > 0) doc.cameraZoom = n;
  });
  stageEdit("stgDirectory", (el) => (doc.directory = el.value));
  $("stgCamTarget").onchange = draw;
  const viewCam = () => {
    camX = Number($("stgViewCamX").value) || 0;
    camY = Number($("stgViewCamY").value) || 0;
    draw();
  };
  $("stgViewCamX").oninput = viewCam;
  $("stgViewCamY").oninput = viewCam;
  $("stgViewCamReset").onclick = () => {
    $("stgViewCamX").value = $("stgViewCamY").value = 0;
    viewCam();
  };

  function refreshAll() {
    refreshStageFields();
    renderAssets();
    renderLayers();
    refreshInspector();
    draw();
  }
  function loadDoc(next, message) {
    doc = next;
    sel = null;
    hiddenChars.clear();
    resetHistory();
    refreshAll();
    fitAll();
    state.app.unsaved?.clean();
    if (message) say(message);
  }

  $("stgNew").onclick = () => {
    if (!state.app.unsaved.confirmReplace()) return;
    loadDoc(defaultStage(), "新しいステージを作りました。");
  };
  $("stgFile").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = ""; // 同じファイルをもう一度選べるように
    if (!f) return;
    if (!state.app.unsaved.confirmReplace()) return;
    try {
      const next = normalizeStage(JSON.parse((await f.text()).replace(/^﻿/, "")));
      loadDoc(next, `「${next.name}」を読み込みました（prop ${next.props.length} 個）。画像は左の「画像アセット」から登録してください。`);
    } catch (err) {
      say("読み込みエラー: " + err.message);
    }
  };
  const onRegisterFiles = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    const regs = await registerImages(files);
    renderAssets();
    refreshInspector();
    draw();
    const msg = [];
    if (regs.length) msg.push(`画像 ${regs.length} 枚`);
    if (regs.xmls.length) msg.push(`XML / TXT ${regs.xmls.length} 個`);
    if (regs.animates.length) msg.push(`AnimateAtlas ${regs.animates.length} セット`);
    if (msg.length) say(`${msg.join("・")}を登録しました。${regs.unlinked ? "フォルダ名が分からない AnimateAtlas は、一覧の「選択」から結び付けてください。" : ""}`);
  };
  $("stgImages").onchange = onRegisterFiles;
  $("stgAtlasDir").onchange = onRegisterFiles;

  // アニメ選択・再生（保存されない _ed に持つ）
  $("stgPAnim").onchange = (e) => {
    if (sel?.kind !== "prop") return;
    const p = doc.props[sel.i];
    p._ed = { ...p._ed, anim: e.target.value };
    playStart = performance.now();
    draw();
  };
  $("stgPPlay").onchange = (e) => setPlaying(e.target.checked);

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function save() {
    const file = (doc.name || "stage").trim().replace(/[^\w\-.]+/g, "_").replace(/^_+|_+$/g, "") || "stage";
    download(file + ".json", serializeStage(doc, !$("stgCompact").checked));
    state.app.unsaved?.clean();
    say(`${file}.json を保存しました。`);
  }
  $("stgSave").onclick = save;

  // ============================================================
  // 10. ビューとキーボード
  // ============================================================
  $("stgZoom").oninput = () => vp.setZoom(Number($("stgZoom").value));
  $("stgZoom").onchange = () => ($("stgZoom").value = Number(vp.zoom.toFixed(2)));
  $("stgZoomIn").onclick = () => vp.setZoom(vp.zoom * 1.25);
  $("stgZoomOut").onclick = () => vp.setZoom(vp.zoom / 1.25);
  $("stgResetView").onclick = () => vp.reset();
  $("stgPanTool").onclick = () => {
    vp.setPanMode(!vp.panMode);
    $("stgPanTool").setAttribute("aria-pressed", String(vp.panMode));
  };
  $("stgFit").onclick = () => fitAll();

  /** 見えている物すべてが収まるようにする（何も無ければ 100% に戻す） */
  function fitAll() {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const obj of objects()) {
      if (isHidden(obj)) continue;
      for (const [x, y] of corners(geom(obj))) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    if (!Number.isFinite(x0)) return vp.reset();
    vp.fit(x0, y0, x1, y1, 0.12);
  }

  function nudge(dx, dy) {
    const so = selectedObj();
    if (!so) return;
    const now = performance.now(),
      merge = now - lastNudgeAt < 700;
    lastNudgeAt = now;
    so.ref.position = [round3(so.ref.position[0] + dx), round3(so.ref.position[1] + dy)];
    syncPositionFields();
    draw();
    commit(merge);
  }
  state.listen(window, "keydown", (e) => {
    if (isTextEntry(e.target) || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey) {
      if (k === "z" || k === "y") (e.preventDefault(), k === "y" || e.shiftKey ? redo() : undo());
      else if (k === "d") (e.preventDefault(), $("stgDup").click());
      else if (k === "s") (e.preventDefault(), save());
      return;
    }
    const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const arrows = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
    if (arrows[k]) (e.preventDefault(), nudge(...arrows[k]));
    else if (k === "delete" || k === "backspace") (e.preventDefault(), deleteSelected());
    else if (k === "escape") select(null);
    else if (k === "h") panels.toggleAll();
    else if (k === "f") fitAll();
  });

  // 初期表示
  resetHistory();
  refreshAll();

  return {
    // 表示されたとき: canvas のサイズを測り直し、HUD の Undo/Redo の状態を合わせる
    onShow() {
      resize();
      syncHud();
    },
    onHide() {},
    undo,
    redo,
  };
}
