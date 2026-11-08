/* ============================================================
   states/character/editor.js — Character Editor（V-Slice の character.json / Offset 編集）のロジック
   ------------------------------------------------------------
   役割:
     V-Slice(FNF) のキャラクター定義 character.json を読み込み、各アニメーションの
     オフセット(offsets)・fps・ループ・prefix などを、プレビューを見ながら編集して書き出す。

   character.json の主な項目（このファイルが触るもの）:
     name, flipX, generatedBy, scale, assetPath, renderType
     offsets            : [x, y] キャラ全体のオフセット
     animations[]       : { name, prefix, offsets:[x,y], frameRate, looped, frameIndices, animType, assetPath }
       prefix           : アトラス上の名前（Sparrow なら接頭辞 / AnimateAtlas ならシンボル名やラベル名）
       animType         : "prefix" | "indices" | "symbol" | "frameLabel"
       frameIndices     : 再生するフレーム番号を指定（省略なら全部）

   絵のデータは3形式に対応: ① Sparrow(XML+PNG) ② モダン AnimateAtlas ③ レガシー AnimateAtlas

   旧 character-editor.js からの変更点（挙動は同じ）:
     ・即時実行関数 → mountCharacterEditor(state) 関数。create() で呼ばれる
     ・window.offsetResize をやめ、return で onShow / onHide を返す
     ・window の resize は state.listen(...)

   目次: 1.状態変数 2.アトラスの登録 3.基本ヘルパーと Undo/Redo 4.再生するフレーム列の決め方
         5.描画 6.読み込みとアニメの追加・改名・削除 7.再生操作 8.オフセットの編集と書き出し
   ============================================================ */
export function mountCharacterEditor(state) {
  // ============================================================
  // 1. 状態変数
  // ============================================================
  // $(id): getElementById の短縮形 / canvas, ctx: プレビューの描画先
  const $ = (id) => document.getElementById(id),
    canvas = $("offCanvas"),
    ctx = canvas.getContext("2d");
  // doc       : 読み込んだ character.json（編集対象。書き出すときはこれを出力）
  // image     : アトラス画像 / atlas : アトラス定義（Sparrow なら XML Document、AnimateAtlas なら spritemap JSON）
  // animation : Animation.json（AnimateAtlas のとき）/ sprites : Sparrow のスプライト一覧
  // frame     : 表示中のフレーム番号 / timer : 再生タイマー / drag : プレビューのドラッグ情報
  // history / future : Undo / Redo 用の履歴 / active : 選択中のアニメーションの番号
  let doc = null,
    image = null,
    atlas = null,
    animation = null,
    sprites = [],
    frame = 0,
    timer = null,
    drag = null,
    history = [],
    future = [],
    active = 0;

  // ============================================================
  // 2. アトラスの登録（assetPath ごと）
  // ============================================================
  // キャラは複数のアトラス(assetPath)を使えるので、assetPath → { image, atlas, animation, sprites } として登録し、アニメごとに切り替える。
  const atlasRegistry = new Map();
  // 選択中のアニメが使う assetPath（アニメ個別の指定が無ければ、キャラ共通のもの）
  function currentAssetPath() {
    return current()?.assetPath || doc?.assetPath || "";
  }
  // character.json が必要としている assetPath の一覧（重複なし）
  function requiredPaths(d) {
    const paths = new Set();
    if (d?.assetPath) paths.add(d.assetPath);
    for (const a of d?.animations || []) {
      const path = a.assetPath || d.assetPath;
      if (path) paths.add(path);
    }
    return [...paths];
  }
  // 「必要なアトラス」欄を作る: assetPath ごとに PNG / XML or spritemap JSON / Animation.json の選択欄と「登録」ボタンを並べる（登録済みは ✓）
  function updateRegistryUI() {
    const host = $("offRequiredAssets");
    host.replaceChildren();
    if (!doc) {
      host.textContent = "Character JSONを読み込むと必要なアトラスが表示されます。";
      return;
    }
    const paths = requiredPaths(doc);
    if (!paths.length) {
      host.textContent = "assetPathが見つかりません。Character JSONを確認してください。";
      return;
    }
    const heading = document.createElement("p");
    heading.className = "tiny";
    heading.textContent = `必要なアトラス: ${paths.length} セット（重複除外）`;
    host.append(heading);
    paths.forEach((path, index) => {
      const section = document.createElement("div");
      section.className = "panel";
      section.style.margin = "8px 0";
      section.style.padding = "10px";
      const title = document.createElement("div");
      title.style.overflowWrap = "anywhere";
      title.style.fontWeight = "bold";
      title.textContent = `${index + 1}. ${path}`;
      section.append(title);
      const state = document.createElement("p");
      state.className = "tiny";
      state.textContent = atlasRegistry.has(path) ? "✓ 登録済み" : "○ 未登録";
      section.append(state);
      const fields = document.createElement("div");
      fields.className = "row";
      const makeFile = (label, accept) => {
        const wrap = document.createElement("label");
        wrap.textContent = label;
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = accept;
        wrap.append(inp);
        fields.append(wrap);
        return inp;
      };
      const png = makeFile("PNG", "image/png");
      const def = makeFile("XML / spritemap JSON", ".xml,.json");
      const anim = makeFile("Animation.json（新旧AnimateAtlas対応）", ".json");
      section.append(fields);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "primary";
      button.textContent = "このアトラスを登録 / 更新";
      button.onclick = async () => {
        try {
          const data = await parseAssetFiles(png.files[0], def.files[0], anim.files[0]);
          if (!data.atlas?.documentElement && !data.animation?.AN && !data.animation?.ANIMATION)
            throw Error("AnimateAtlasには対応するAnimation.jsonが必要です");
          atlasRegistry.set(path, data);
          updateRegistryUI();
          refresh();
          say(`登録完了: ${path}（${atlasRegistry.size}/${paths.length} セット）`);
        } catch (e) {
          state.textContent = "⚠ " + e.message;
          say("登録エラー: " + e.message);
        }
      };
      section.append(button);
      host.append(section);
    });
  }
  // 選択中のアニメが使うアトラスを atlasRegistry から取り出し、image / atlas / animation / sprites を切り替える（未登録なら空にする）
  function switchAssets() {
    const path = currentAssetPath(),
      data = atlasRegistry.get(path);
    if (!data) {
      image = null;
      atlas = null;
      animation = null;
      sprites = [];
      return;
    }
    image = data.image;
    atlas = data.atlas;
    animation = data.animation;
    sprites = data.sprites;
  }
  // 3つのファイル（PNG・アトラス定義・Animation.json）を読み込んで { image, atlas, animation, sprites } にする。
  // アトラス定義が「<」で始まれば Sparrow XML、そうでなければ spritemap JSON（AnimateAtlas）として扱う。
  async function parseAssetFiles(png, def, anim) {
    if (!png || !def) throw Error("PNGとアトラス定義が必要です");
    const nextImg = new Image();
    const url = URL.createObjectURL(png);
    try {
      nextImg.src = url;
      await nextImg.decode();
    } finally {
      URL.revokeObjectURL(url);
    }
    const text = await def.text();
    let nextAtlas,
      nextSprites = [];
    if (text.trim().startsWith("<")) {
      nextAtlas = parseXML(text);
      nextSprites = [...nextAtlas.querySelectorAll("SubTexture")].map((el) => {
        const n = (k) => Number(el.getAttribute(k) || 0),
          rotated = ["true", "1"].includes((el.getAttribute("rotated") || "").toLowerCase());
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
    } else nextAtlas = JSON.parse(text.replace(/^\uFEFF/, ""));
    const nextAnimation = anim ? JSON.parse((await anim.text()).replace(/^\uFEFF/, "")) : null;
    return { image: nextImg, atlas: nextAtlas, animation: nextAnimation, sprites: nextSprites };
  }

  // ============================================================
  // 3. 基本ヘルパーと Undo / Redo
  // ============================================================
  // say(s)     : 状態欄にメッセージ表示
  // entries()  : アニメーション一覧（doc.animations）
  // current()  : 選択中のアニメーション
  // clone(o)   : 深いコピー
  const say = (s) => ($("offStatus").textContent = s);
  const entries = () => (Array.isArray(doc?.animations) ? doc.animations : []);
  const current = () => entries()[active];
  const clone = (o) => JSON.parse(JSON.stringify(o));
  // 名前・generatedBy・flipX の入力欄に、doc の値を反映する
  function syncMeta() {
    if (!doc) return;
    $("offCharName").value = doc.name ?? "";
    $("offGeneratedBy").value = doc.generatedBy ?? "";
    $("offFlipX").checked = !!doc.flipX;
  }
  // 変更の直前に呼ぶ: doc を丸ごと複製して履歴に積む（最大60件。Redo 履歴は破棄）
  function snapshot() {
    if (!doc) return;
    history.push(clone(doc));
    if (history.length > 60) history.shift();
    future = [];
  }
  // Undo(redo=false) / Redo(redo=true) を1回実行して、画面を更新する
  function restore(redo) {
    const from = redo ? future : history,
      to = redo ? history : future;
    if (!from.length) return;
    to.push(clone(doc));
    doc = from.pop();
    $("offGlobalX").value = doc.offsets?.[0] ?? 0;
    $("offGlobalY").value = doc.offsets?.[1] ?? 0;
    syncMeta();
    refresh();
    say(redo ? "やり直しました" : "元に戻しました");
  }
  $("offUndo").onclick = () => restore(false);
  $("offRedo").onclick = () => restore(true);

  // ============================================================
  // 4. 再生するフレーム列の決め方
  // ============================================================
  // format(): アトラス形式。選択が「自動判別」なら、XML があれば Sparrow、なければ AnimateAtlas とみなす
  function format() {
    const choice = $("offFormat").value;
    return choice === "auto" ? (atlas?.documentElement ? "sparrow" : "animate") : choice;
  }
  function parseXML(txt) {
    const xml = new DOMParser().parseFromString(txt, "application/xml");
    if (xml.querySelector("parsererror")) throw Error("XMLが不正です");
    return xml;
  }
  // names(): プルダウンに出すアニメ名の一覧 / getPrefix(a): アニメの prefix / indices(a): frameIndices（無ければ null）
  function names() {
    return entries().map((a, i) => a.name || a.anim || "Animation " + i);
  }
  function getPrefix(a) {
    return a?.prefix || a?.name || a?.anim || "";
  }
  function indices(a) {
    return Array.isArray(a?.frameIndices) ? a.frameIndices : null;
  }
  // Sparrow: prefix で始まるスプライトを、末尾の連番の順に並べて返す
  function sparrowFrames(prefix) {
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
  // AnimateAtlas: atlasTimelineLength(layers) はレイヤー全体の総フレーム数
  // Resolve a frame-label animation only within its own labeled segment.
  // The previous implementation extended every label to the end of the entire timeline.
  function atlasTimelineLength(layers) {
    return Math.max(
      0,
      ...layers.flatMap((l) =>
        (l.FR || []).map((f) => (Number(f.I) || 0) + Math.max(1, Number(f.DU) || 1)),
      ),
    );
  }
  // 現在のアニメが再生するフレームの候補を返す。
  //   Sparrow                : prefix に合うスプライト
  //   レガシー AnimateAtlas  : prefix と同名のシンボル全体
  //   モダン AnimateAtlas    : animType が "symbol" ならそのシンボル全体 / それ以外はフレームラベルの区間（次のラベルの手前まで）
  function candidates() {
    const a = current();
    if (!a) return [];
    const pref = getPrefix(a);
    if (format() === "sparrow") return sparrowFrames(pref);
    if (!animation) return [];
    if (animation.ANIMATION) {
      const a = current(),
        prefix = getPrefix(a),
        root = animation.ANIMATION;
      const sym = (animation.SYMBOL_DICTIONARY?.Symbols || []).find(
        (x) => x.SYMBOL_name === prefix,
      );
      const timeline = root.SYMBOL_name === prefix ? root.TIMELINE : sym?.TIMELINE;
      if (!timeline) return [];
      const length = legacyDuration(timeline);
      return Array.from({ length }, (_, i) => ({ atlasFrame: i, legacyName: prefix }));
    }
    const isSymbol = a.animType === "symbol";
    const sym = (animation.SD?.S || []).find((x) => x.SN === pref);
    if (isSymbol && !sym) return [];
    const layers = isSymbol ? sym.TL?.L : animation.AN?.TL?.L;
    if (!layers) return [];
    const total = atlasTimelineLength(layers);
    let start = 0,
      end = total;
    if (!isSymbol) {
      const labels = [];
      for (const layer of layers)
        for (const f of layer.FR || [])
          if (f.N) labels.push({ name: f.N, start: Number(f.I) || 0 });
      labels.sort((x, y) => x.start - y.start);
      const match = labels.find((x) => x.name === pref);
      if (a.animType === "frameLabel" && !match) return [];
      if (match) {
        start = match.start;
        end = Math.min(total, labels.find((x) => x.start > start)?.start ?? total);
      }
    }
    return Array.from({ length: Math.max(0, end - start) }, (_, i) => ({ atlasFrame: start + i }));
  }
  // 最終的な再生列: candidates() を、frameIndices（フレーム番号の指定）があればその順に絞り込む
  function sequence() {
    const all = candidates(),
      ix = indices(current());
    // frameIndices are indices into the full prefix animation, not atlas texture coordinates.
    return ix ? ix.map((i) => all[Number(i)]).filter(Boolean) : all;
  }
  // 画面更新: アニメ選択・各入力欄（オフセット・fps・ループ・prefix・animType・frameIndices・assetPath）を現在のアニメに合わせ、0フレーム目へ戻す
  function refresh() {
    switchAssets();
    $("offSelect").replaceChildren(
      ...names().map((n, i) => {
        let e = document.createElement("option");
        e.value = i;
        e.textContent = n;
        return e;
      }),
    );
    active = Math.max(0, Math.min(active, entries().length - 1));
    $("offSelect").value = active;
    const a = current();
    if (!a) {
      for (const id of ["offX", "offY", "offFps", "offPrefix", "offIndices"]) $(id).value = "";
      $("offAssetInfo").textContent = "";
      setFrame(0);
      return;
    }
    $("offX").value = a.offsets?.[0] ?? 0;
    $("offY").value = a.offsets?.[1] ?? 0;
    $("offFps").value = a.frameRate ?? 24;
    $("offLoop").value = String(a.looped ?? false);
    $("offPrefix").value = getPrefix(a);
    $("offAnimType").value = ["prefix", "indices", "symbol", "frameLabel"].includes(a.animType)
      ? a.animType
      : "";
    $("offIndices").value = indices(a)?.join(", ") ?? "";
    $("offAssetInfo").textContent =
      "assetPath: " +
      (a.assetPath || doc.assetPath || "未指定") +
      (a.assetPath ? " (個別指定)" : " (共通)") +
      (atlasRegistry.has(currentAssetPath()) ? " ✓ 登録済み" : "");
    setFrame(0);
  }
  // 表示フレームを n にする（範囲を超えたら反対側へ回り込む）。スライダー・カウンターを更新して描画
  function setFrame(n) {
    const len = Math.max(1, sequence().length);
    frame = (n + len) % len;
    $("offTimeline").max = len - 1;
    $("offTimeline").value = frame;
    $("offCounter").textContent = frame + 1 + " / " + len;
    draw();
  }
  // canvas の内部解像度を表示サイズ × devicePixelRatio に合わせて描き直す
  function resize() {
    const r = canvas.getBoundingClientRect(),
      d = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * d));
    canvas.height = Math.max(1, Math.round(r.height * d));
    ctx.setTransform(d, 0, 0, d, 0, 0);
    draw();
  }
  state.listen(window, "resize", resize); // 表示中のときだけ聞く

  // ============================================================
  // 5. 描画
  // ============================================================
  // 5-1. モダン AnimateAtlas
  //   atlasSymbol(name) / atlasKeyframe(layer, fr) : シンボルとキーフレームの検索
  //   atlasDraw(name, fr, depth)                   : name="__MAIN__" ならメイン、それ以外はシンボルを描く
  //                                                  （Animate Editor の drawSymbol と同じ考え方: 逆順レイヤー・入れ子は再帰・親キーからの経過フレームで子を再生）
  // AnimateAtlas hierarchy follows the verified Pico renderer: reverse layer order,
  // frame-local child playback, and direct MX matrices without extra TRP translation.
  const atlasSymbol = (name) => (animation?.SD?.S || []).find((x) => x.SN === name);
  function atlasKeyframe(layer, fr) {
    let found = null;
    for (const k of layer.FR || []) {
      const i = Number(k.I) || 0;
      if (i <= fr && fr < i + Math.max(1, Number(k.DU) || 1) && (!found || i > Number(found.I)))
        found = k;
    }
    return found;
  }
  function atlasDraw(name, fr, depth = 0) {
    if (depth > 20 || !animation || !atlas?.ATLAS?.SPRITES || !image) return;
    const sym = name === "__MAIN__" ? null : atlasSymbol(name);
    if (name !== "__MAIN__" && !sym) return;
    const layers = (sym ? sym.TL?.L : animation.AN?.TL?.L) || [];
    for (let li = layers.length - 1; li >= 0; li--) {
      const f = atlasKeyframe(layers[li], fr);
      if (!f) continue;
      for (const e of f.E || []) {
        const o = e.SI || e.ASI;
        if (!o) continue;
        const m = o.MX ||
          (o.M3D?.length === 16
            ? [o.M3D[0], o.M3D[1], o.M3D[4], o.M3D[5], o.M3D[12], o.M3D[13]]
            : null) || [1, 0, 0, 1, 0, 0];
        ctx.save();
        ctx.transform(...m);
        if (e.ASI) {
          const sp = (atlas.ATLAS.SPRITES || [])
            .map((x) => x.SPRITE)
            .find((x) => String(x.name) === String(o.N));
          if (sp) {
            if (sp.rotated) {
              ctx.translate(0, sp.w);
              ctx.rotate(-Math.PI / 2);
            }
            ctx.drawImage(image, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
          }
        } else {
          const child = atlasSymbol(o.SN);
          if (child) {
            const len = Math.max(1, atlasTimelineLength(child.TL?.L || []));
            const first = Math.max(0, Number(o.FF) || 0),
              elapsed = Math.max(0, fr - (Number(f.I) || 0));
            const mode = String(o.LP || "LP").toUpperCase();
            const cf =
              mode.includes("SF") || mode.includes("SINGLEFRAME")
                ? first
                : mode.includes("PO") || mode.includes("PLAYONCE")
                  ? Math.min(first + elapsed, len - 1)
                  : (first + elapsed) % len;
            atlasDraw(o.SN, cf, depth + 1);
          }
        }
        ctx.restore();
      }
    }
  }
  // 5-2. レガシー AnimateAtlas（ANIMATION / SYMBOL_DICTIONARY）
  //   legacyDuration / legacyKeyframe / legacyMatrix / legacyDraw / legacyTimeline : Animate Editor のレガシー描画と同じ仕組み
  // AnimateAtlas legacy schema (ANIMATION / SYMBOL_DICTIONARY) used by BF Fakeout.
  function legacyDuration(timeline) {
    return Math.max(
      1,
      ...(timeline?.LAYERS || []).flatMap((l) =>
        (l.Frames || []).map((f) => (Number(f.index) || 0) + Math.max(1, Number(f.duration) || 1)),
      ),
    );
  }
  function legacyKeyframe(layer, t) {
    return (layer.Frames || []).find(
      (f) => t >= Number(f.index) && t < Number(f.index) + Math.max(1, Number(f.duration) || 1),
    );
  }
  function legacyMatrix(m) {
    if (m)
      ctx.transform(
        Number(m.m00) || 0,
        Number(m.m01) || 0,
        Number(m.m10) || 0,
        Number(m.m11) || 0,
        Number(m.m30) || 0,
        Number(m.m31) || 0,
      );
  }
  function legacyDraw(name, fr) {
    const root = animation?.ANIMATION;
    const sym = (animation?.SYMBOL_DICTIONARY?.Symbols || []).find((s) => s.SYMBOL_name === name);
    const tl = root?.SYMBOL_name === name ? root.TIMELINE : sym?.TIMELINE;
    if (tl) legacyTimeline(tl, fr, 0);
  }
  function legacyTimeline(tl, t, depth) {
    if (depth > 25) return;
    const layers = tl?.LAYERS || [];
    // Legacy AnimateAtlas stores upper layers first; draw from back to front.
    for (let li = layers.length - 1; li >= 0; li--) {
      const layer = layers[li];
      const f = legacyKeyframe(layer, t);
      if (!f) continue;
      for (const item of f.elements || []) {
        const sp = item.ATLAS_SPRITE_instance;
        if (sp) {
          const sprite = (atlas?.ATLAS?.SPRITES || [])
            .map((v) => v.SPRITE)
            .find((v) => String(v.name) === String(sp.name));
          if (!sprite) continue;
          ctx.save();
          legacyMatrix(sp.Matrix3D);
          if (sprite.rotated) {
            ctx.translate(0, sprite.w);
            ctx.rotate(-Math.PI / 2);
          }
          ctx.drawImage(image, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, sprite.w, sprite.h);
          ctx.restore();
        } else if (item.SYMBOL_Instance) {
          const si = item.SYMBOL_Instance;
          const child = (animation?.SYMBOL_DICTIONARY?.Symbols || []).find(
            (s) => s.SYMBOL_name === si.SYMBOL_name,
          );
          if (!child) continue;
          ctx.save();
          legacyMatrix(si.Matrix3D);
          const len = legacyDuration(child.TIMELINE),
            first = Math.max(0, Number(si.firstFrame) || 0),
            elapsed = Math.max(0, t - (Number(f.index) || 0));
          const mode = String(si.loop || "loop").toLowerCase();
          const childFrame =
            mode === "singleframe"
              ? first
              : mode === "playonce"
                ? Math.min(first + elapsed, len - 1)
                : (first + elapsed) % len;
          legacyTimeline(child.TIMELINE, childFrame, depth + 1);
          ctx.restore();
        }
      }
    }
  }
  // 5-3. Sparrow（paintSparrow: 回転して格納されたスプライトを戻して描く）
  // Shared Sparrow renderer: same rotation and trim logic as the Sparrow workspace.
  function paintSparrow(ctx, sp, img, x, y, w, h) {
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

  // ============================================================
  // 5-4. 座標モデルとプレビュー描画
  // ============================================================
  // characterPose()      : 描画に使う値をまとめて返す（scale・左右反転・全体オフセット・アニメ別オフセット）
  // referenceFrameSize() : 基準にするフレームサイズ（最初のスプライトの frameWidth/Height）。
  //                        V-Slice は原点を最初のフレームで決めるので、アニメごとに中心を取り直さない。
  // （上の英語コメントのとおり）オフセットの + は絵を「左・上」へ動かす。
  // Character Editor 2.5: isolate engine coordinates from atlas rendering.
  // FlxSprite.offset is SUBTRACTED from screen coordinates (positive X -> left, positive Y -> up).
  // CharacterData.offsets shifts the sprite's world position in the opposite direction.
  // V-Slice coordinate model, validated with Murder! Sans Sparrow comparison.
  // Character's reference frame is established once and never re-centered per animation.
  function characterPose() {
    const a = current(),
      raw = Number(doc?.scale),
      sc = Number.isFinite(raw) && raw > 0 ? raw : 1;
    return {
      a,
      scale: sc,
      flip: $("offPreviewFacing").value === "json" && !!doc?.flipX,
      globalX: Number(doc?.offsets?.[0]) || 0,
      globalY: Number(doc?.offsets?.[1]) || 0,
      animX: Number(a?.offsets?.[0]) || 0,
      animY: Number(a?.offsets?.[1]) || 0,
    };
  }
  function referenceFrameSize() {
    // V-Slice FlxSprite origin is determined from the first loaded frame, not from each animation.
    if (format() === "sparrow") {
      const first = sprites[0];
      if (!first) return { w: 0, h: 0 };
      return { w: first.frameWidth || first.width, h: first.frameHeight || first.height };
    }
    return { w: 0, h: 0 };
  }
  // プレビューを描く:
  //   1. 十字のガイド線（縦は中央、横は高さの84%の位置 ＝ キャラの足元の基準）
  //   2. キャラの位置 = 基準点 + (全体オフセット − アニメのオフセット) × scale × ズーム
  //   3. Sparrow なら足元中央を基準に frameX/frameY の分ずらして描く / AnimateAtlas なら atlasDraw・legacyDraw
  function draw() {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const ox = w / 2,
      oy = h * 0.84,
      z = Math.max(0.1, Math.min(8, Number($("offZoom").value) || 1));
    ctx.strokeStyle = "#80baff";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(ox, 0);
    ctx.lineTo(ox, h);
    ctx.moveTo(0, oy);
    ctx.lineTo(w, oy);
    ctx.stroke();
    ctx.setLineDash([]);
    const pose = characterPose(),
      a = pose.a,
      sp = sequence()[frame];
    if (!a || !image || !sp) return;
    const ref = referenceFrameSize();
    // Bopper.getScreenPosition subtracts (animOffsets - globalOffsets) * sprite.scale.
    const x = ox + (pose.globalX - pose.animX) * pose.scale * z;
    const y = oy + (pose.globalY - pose.animY) * pose.scale * z;
    ctx.save();
    try {
      ctx.translate(x, y);
      ctx.scale(z * pose.scale, z * pose.scale);
      if (sp.atlasFrame !== undefined) {
        if (pose.flip) ctx.scale(-1, 1);
        if (animation?.ANIMATION) legacyDraw(sp.legacyName, sp.atlasFrame);
        else atlasDraw(a.animType === "symbol" ? getPrefix(a) : "__MAIN__", sp.atlasFrame);
      } else {
        const sw = sp.rotated ? sp.height : sp.width,
          sh = sp.rotated ? sp.width : sp.height;
        // Keep the same fixed origin for all frames, even when source sizes change.
        // FrameX / FrameY are negative trim offsets in Sparrow XML.
        const fx = sp.frameX || 0,
          fy = sp.frameY || 0;
        if (pose.flip) {
          ctx.scale(-1, 1);
          ctx.translate(-ref.w, 0);
        }
        paintSparrow(ctx, sp, image, -ref.w / 2 - fx, -ref.h - fy, sw, sh);
      }
    } catch (e) {
      say("プレビュー描画エラー: " + e.message);
    } finally {
      ctx.restore();
    }
  }

  // ============================================================
  // 6. character.json の読み込みと、アニメーションの追加・改名・削除
  // ============================================================
  // detectCharacter(): character.json を読み込む。animations 配列を確認 → 状態を全リセット → 必要な assetPath を一覧表示
  //                    （アトラスの PNG などは、このあと各欄から別途登録する）
  async function detectCharacter() {
    try {
      const f = $("offCharacter").files[0];
      if (!f) throw Error("character.json を選択してください");
      const parsed = JSON.parse(await f.text());
      if (!Array.isArray(parsed.animations)) throw Error("animations 配列が見つかりません");
      stopOffPlayback();
      atlasRegistry.clear();
      doc = parsed;
      image = null;
      atlas = null;
      animation = null;
      sprites = [];
      history = [];
      future = [];
      active = 0;
      syncMeta();
      $("offGlobalX").value = doc.offsets?.[0] ?? 0;
      $("offGlobalY").value = doc.offsets?.[1] ?? 0;
      $("offRenderType").value = doc.renderType || "";
      updateRegistryUI();
      refresh();
      resize();
      const paths = requiredPaths(doc);
      say(
        `JSON解析完了: ${parsed.animations.length} アニメーション、${paths.length} 種類のassetPath。各欄から対応するファイルを登録してください。`,
      );
    } catch (e) {
      say("JSON解析エラー: " + e.message);
    }
  }
  // 「解析」と「読み込み」ボタンは同じ処理
  $("offDetect").onclick = detectCharacter;
  $("offLoad").onclick = detectCharacter;
  // アニメーションの選択を切り替える
  $("offSelect").onchange = () => {
    active = Number($("offSelect").value) || 0;
    refresh();
    restartOffPlayback();
  };
  // 再生中なら停止する
  function stopOffPlayback() {
    if (timer) {
      clearInterval(timer);
      timer = null;
      $("offPlay").textContent = "▶ 再生";
    }
  }
  // 再生中なら、いまのアニメの fps で再生し直す（切り替え・fps変更を反映）
  function restartOffPlayback() {
    if (!timer) return;
    stopOffPlayback();
    $("offPlay").click();
  }
  // アニメ名として使えるか（空でなく、他と重複しない）
  function validAnimationName(name, exclude = -1) {
    return name.length > 0 && !entries().some((a, i) => i !== exclude && a.name === name);
  }
  // アニメーションを追加: 名前と prefix（アトラス上の名前・シンボル名）を prompt で聞き、オフセット [0, 0] で作る
  $("offAddAnim").onclick = () => {
    if (!doc) return say("先にcharacter.jsonを読み込んでください");
    const name = prompt("新しいアニメーション名を入力してください", "newAnimation");
    if (name === null) return;
    const n = name.trim();
    if (!validAnimationName(n)) return say("名前が空か、同名のアニメーションが存在します");
    const base = current();
    const prefix = prompt(
      "使用するアトラスのPrefix / Symbol名を入力してください",
      base?.prefix || n,
    );
    if (prefix === null) return;
    snapshot();
    stopOffPlayback();
    const item = { name: n, prefix: prefix.trim() || n, offsets: [0, 0] };
    if (base?.animType) item.animType = base.animType;
    doc.animations.push(item);
    active = doc.animations.length - 1;
    refresh();
    say("アニメーション「" + n + "」を追加しました。保存するとJSONに反映されます");
  };
  // アニメーション名を変更（prefix は変えない）
  $("offRenameAnim").onclick = () => {
    const a = current();
    if (!a) return say("名前を変更するアニメーションがありません");
    const value = prompt("アニメーション名を変更", a.name || "");
    if (value === null) return;
    const n = value.trim();
    if (!validAnimationName(n, active)) return say("名前が空か、同名のアニメーションが存在します");
    if (n === a.name) return;
    snapshot();
    a.name = n;
    refresh();
    say("アニメーション名を「" + n + "」に変更しました。Prefixは変更していません");
  };
  // アニメーションを削除（確認あり・Undo 可。保存するまで元のファイルは変わらない）
  $("offDeleteAnim").onclick = () => {
    const a = current();
    if (!a) return say("削除するアニメーションがありません");
    if (
      !confirm(
        "アニメーション「" +
          (a.name || active) +
          "」を削除しますか？\nこの操作はUndoで取り消せます。",
      )
    )
      return;
    snapshot();
    stopOffPlayback();
    const name = a.name;
    doc.animations.splice(active, 1);
    active = Math.max(0, Math.min(active, doc.animations.length - 1));
    refresh();
    if (!doc.animations.length) {
      $("offSelect").replaceChildren();
      $("offCounter").textContent = "0 / 0";
      draw();
    }
    say("「" + name + "」を削除しました。保存するまで元ファイルは変更されません");
  };

  // ============================================================
  // 7. 再生操作
  // ============================================================
  // プレビュー方式・ズーム・前へ/次へ・スライダー
  $("offFormat").onchange = () => setFrame(0);
  $("offZoom").oninput = draw;
  $("offPrev").onclick = () => setFrame(frame - 1);
  $("offNext").onclick = () => setFrame(frame + 1);
  $("offTimeline").oninput = () => setFrame(Number($("offTimeline").value));
  // 再生/停止: frameRate の間隔で次のフレームへ進める。looped が false なら最後のフレームで止まる
  $("offPlay").onclick = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
      $("offPlay").textContent = "▶ 再生";
      return;
    }
    timer = setInterval(
      () => {
        if (!current()) return;
        const len = sequence().length;
        if (!len) return;
        if (frame === len - 1 && current().looped === false) {
          $("offPlay").click();
          return;
        }
        setFrame(frame + 1);
      },
      1000 / Math.max(1, Number(current()?.frameRate) || 24),
    );
    $("offPlay").textContent = "⏸ 停止";
  };

  // ============================================================
  // 8. オフセットの編集と書き出し（このエディタの中心機能）
  // ============================================================
  // updateOffsets(x, y): 選択中アニメの offsets を設定（小数3桁に丸める）し、入力欄と描画を更新する
  function updateOffsets(x, y) {
    const a = current();
    if (!a) return;
    a.offsets = [Number(x.toFixed(3)), Number(y.toFixed(3))];
    $("offX").value = a.offsets[0];
    $("offY").value = a.offsets[1];
    draw();
  }
  // X・Y の入力欄を変更したとき: 履歴に積んでから反映
  for (const id of ["offX", "offY"])
    $(id).addEventListener("change", () => {
      if (!current()) return;
      snapshot();
      updateOffsets(Number($("offX").value), Number($("offY").value));
    });
  // 基本情報（name・generatedBy・flipX）を適用。generatedBy が空欄ならその項目を削除する
  $("offMetaApply").onclick = () => {
    if (!doc) return say("character.json を読み込んでください");
    const name = $("offCharName").value.trim();
    if (!name) return say("キャラクター名は空欄にできません");
    const generatedBy = $("offGeneratedBy").value.trim();
    if (
      doc.name === name &&
      (doc.generatedBy ?? "") === generatedBy &&
      !!doc.flipX === $("offFlipX").checked
    )
      return say("基本情報に変更はありません");
    snapshot();
    doc.name = name;
    doc.flipX = $("offFlipX").checked;
    if (generatedBy) doc.generatedBy = generatedBy;
    else delete doc.generatedBy;
    say("基本情報を適用しました。JSON保存で書き出せます。");
  };
  // プレビューの向き（JSON の flipX に従う / 常にそのまま）の切り替え
  $("offPreviewFacing").onchange = () => draw();
  // キャラ全体のオフセット（doc.offsets）を適用
  $("offGlobalApply").onclick = () => {
    if (!doc) return;
    snapshot();
    doc.offsets = [Number($("offGlobalX").value) || 0, Number($("offGlobalY").value) || 0];
    draw();
    say("キャラクター全体のオフセットを適用しました。");
  };
  // 選択中アニメのオフセットを 0, 0 に戻す
  $("offZero").onclick = () => {
    if (!current()) return;
    snapshot();
    updateOffsets(0, 0);
  };
  // プレビューをドラッグしてオフセットを調整する。
  // オフセットは「引かれる」値なので、マウスを右へ動かすと X が減り（絵は右へ動く）、下へ動かすと Y が減る（絵は下へ動く）。
  // 変化量は (ドラッグした px) ÷ (ズーム × scale)。
  canvas.addEventListener("pointerdown", (e) => {
    if (!current()) return;
    // 履歴は最初に実際に動かしたときに積む（クリックだけでUndo履歴が増えないように）
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      offsets: [...(current().offsets || [0, 0])],
      saved: false,
    };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.saved) {
      if (e.clientX === drag.x && e.clientY === drag.y) return;
      // pointerdown 時点のオフセットに戻した状態を履歴へ積む
      const a = current();
      const now = a.offsets;
      a.offsets = drag.offsets.slice();
      snapshot();
      a.offsets = now;
      drag.saved = true;
    }
    const z = Math.max(0.1, Number($("offZoom").value) || 1);
    updateOffsets(
      drag.offsets[0] - (e.clientX - drag.x) / (z * (Number(doc?.scale) || 1)),
      drag.offsets[1] - (e.clientY - drag.y) / (z * (Number(doc?.scale) || 1)),
    );
  });
  for (const ev of ["pointerup", "pointercancel"]) canvas.addEventListener(ev, () => (drag = null));
  // アニメ設定（オフセット・fps・ループ・prefix・animType・frameIndices）をまとめて適用。frameIndices は 0 以上の整数のカンマ区切りで、不正なら履歴を取り消して中止
  $("offApply").onclick = () => {
    const a = current();
    if (!a) return;
    snapshot();
    const raw = $("offIndices").value.trim();
    let ix = null;
    if (raw) {
      ix = raw.split(",").map((x) => Number(x.trim()));
      if (ix.some((x) => !Number.isInteger(x) || x < 0)) {
        history.pop();
        return say("frameIndices は0以上の整数をカンマ区切りで入力してください");
      }
    }
    a.offsets = [Number($("offX").value) || 0, Number($("offY").value) || 0];
    a.frameRate = Math.max(1, Number($("offFps").value) || 24);
    a.looped = $("offLoop").value === "true";
    a.prefix = $("offPrefix").value;
    if (ix) a.frameIndices = ix;
    else delete a.frameIndices;
    if ($("offAnimType").value) a.animType = $("offAnimType").value;
    refresh();
    restartOffPlayback();
    say("設定を適用しました。JSON保存で書き出せます。");
  };
  // character.json を character-offset-edited.json として書き出す。「最適化」ON なら空白・改行を省いて出力し、サイズの削減率を表示
  $("offExport").onclick = () => {
    if (!doc) return say("character.json を読み込んでください");
    let compact = $("offCompactExport").checked;
    let json;
    try {
      json = JSON.stringify(doc, null, compact ? 0 : 2);
      if (typeof json !== "string") throw Error("JSON変換に失敗しました");
      JSON.parse(json);
    } catch (err) {
      return say("書き出しエラー: " + err.message);
    }
    const before = new TextEncoder().encode(JSON.stringify(doc, null, 2)).length;
    const after = new TextEncoder().encode(json).length;
    const b = new Blob([json], { type: "application/json;charset=utf-8" }),
      u = URL.createObjectURL(b),
      a = document.createElement("a");
    a.href = u;
    a.download = "character-offset-edited.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1500);
    say(
      "character.json を保存しました。" +
        (compact
          ? " 最適化: " +
            before +
            " → " +
            after +
            " bytes (" +
            Math.round((1 - after / before) * 100) +
            "%削減)"
          : " 整形JSONで保存"),
    );
  };

  return {
    // 表示されたとき: canvas のサイズを測り直す（非表示のあいだは大きさ 0 のため）
    onShow() {
      resize();
    },
    // 離れるとき: 再生中なら止める（ボタンを押したことにして、ボタンの表示も戻す）
    // ※旧コードは画面を離れても再生タイマーが回り続けていた
    onHide() {
      if (timer) $("offPlay").click();
    },
  };
}
