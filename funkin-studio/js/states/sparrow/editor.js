import { queueExport } from "../../services/ModExport.js";
/* ============================================================
   states/sparrow/editor.js — Sparrow Editor（Sparrow形式のアトラス: XML + PNG の編集）のロジック
   ------------------------------------------------------------
   Sparrow形式: 1枚のPNGに複数のスプライトを詰め、各スプライトの位置を XML(TextureAtlas > SubTexture)に書いた形式。
   名前の末尾の連番を除いた部分を「アニメ名(prefix)」と呼び、同じ prefix のスプライトが1つのアニメになる。
     例: "BF idle0000", "BF idle0001" → アニメ名 "BF idle"

   できること: プレビュー再生 / 位置(frameX,frameY)の調整 / 名前変更・連番振り直し / 複製 / 削除 / 別アトラスとの結合 / XML・PNG書き出し

   旧 sparrow-editor.js からの変更点（挙動は同じ）:
     ・即時実行関数 → mountSparrowEditor(state) 関数。HTML が入ったあとの create() で呼ばれる
     ・window.refreshHudHistory / window.spResize をやめ、return で onShow / undo / redo を返す
     ・HUD の Undo/Redo は state.app.hud.setHistory(...) で更新（HUD 側のボタン配線は ui/Hud.js が持つ）
     ・document / window のイベントは state.listen(...)（この画面が表示中のときだけ有効）

   目次: 1.状態変数 2.Undo/Redo 3.補助関数 4.描画 5.XMLの読み込み 6.アニメの切り替え・再生
         7.位置の調整 8.選択・名前変更・複製・削除 9.書き出しと結合
   ============================================================ */
export function mountSparrowEditor(state) {
  // ============================================================
  // 1. 状態変数
  // ============================================================
  // $(id): getElementById の短縮形
  const $ = (id) => document.getElementById(id);
  // items    : スプライト一覧。各要素 { name, x, y, w, h, fx, fy, fw, fh, rotated, extra }
  //              x,y,w,h = アトラス内の位置とサイズ / fx,fy = フレーム内でのずれ / fw,fh = フレーム(元の画像)のサイズ
  //              rotated = アトラス内で90度回転して格納されているか / extra = 上記以外のXML属性（そのまま保持）
  //   image, atlas : アトラス画像（読み込み時にどちらも同じ画像を入れる）
  //   xmlName  : 書き出す PNG のファイル名（読み込んだ PNG の名前）
  //   selected : 選択中のスプライトの Set
  //   prefix   : 表示中のアニメ名 / index : そのアニメの何枚目を表示しているか
  //   drag     : プレビュー上でドラッグ中の情報 / playing : 再生用タイマー
  let items = [],
    image = null,
    atlas = null,
    xmlName = "spritesheet",
    selected = new Set(),
    prefix = "",
    index = 0,
    drag = null,
    playing = null;

  // ============================================================
  // 2. Undo / Redo
  // ============================================================
  // Animate Editor とは別の履歴。変更を加える「直前」に checkpoint() で状態を積み、最大 MAX_HISTORY 件まで保持する。
  const undoStack = [],
    redoStack = [],
    MAX_HISTORY = 40;
  // 現在の状態を1件分のスナップショットにする（選択は「何番目か」で記録し、復元時に同じスプライトを選び直す）
  function snapshot() {
    return {
      items: items.map((o) => ({ ...o, extra: o.extra.map((a) => a.slice()) })),
      atlas,
      prefix,
      index,
      selectedIndices: items.map((o, i) => (selected.has(o) ? i : -1)).filter((i) => i >= 0),
    };
  }
  // Undo/Redo ボタン（画面内 + ヘッダーHUD）の有効・無効を更新。HUD は、この画面が表示中のときだけ
  function updateHistoryButtons() {
    $("spUndo").disabled = !undoStack.length;
    $("spRedo").disabled = !redoStack.length;
    if (state.active) state.app.hud.setHistory(undoStack.length > 0, redoStack.length > 0);
  }
  // 変更の直前に呼ぶ: 今の状態を Undo 履歴へ積み、Redo 履歴は破棄する
  function checkpoint() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    updateHistoryButtons();
  }
  // スナップショットの状態に戻して、画面を作り直す
  function restore(state) {
    items = state.items.map((o) => ({ ...o, extra: o.extra.map((a) => a.slice()) }));
    atlas = state.atlas;
    prefix = state.prefix;
    index = state.index;
    selected = new Set(state.selectedIndices.map((i) => items[i]).filter(Boolean));
    thumbnailCache.clear();
    render();
    updateHistoryButtons();
  }
  // Undo / Redo ボタン: 今の状態を反対側の履歴へ積んでから、積んであった状態を復元する
  $("spUndo").onclick = () => {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    alertStatus("Undo");
  };
  $("spRedo").onclick = () => {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    alertStatus("Redo");
  };
  // ショートカット: Ctrl/Cmd+Z = Undo、Ctrl/Cmd+Shift+Z または Ctrl/Cmd+Y = Redo（入力欄にフォーカス中は無効）
  state.listen(document, "keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    let t = e.target;
    if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
    if (e.key.toLowerCase() === "z") {
      e.preventDefault();
      (e.shiftKey ? $("spRedo") : $("spUndo")).click();
    } else if (e.key.toLowerCase() === "y") {
      e.preventDefault();
      $("spRedo").click();
    }
  });

  // ============================================================
  // 3. 補助関数
  // ============================================================
  // groups()      : アニメ名（末尾の連番を除いた名前）の一覧
  // current()     : 表示中のアニメ(prefix)に属するスプライトの一覧
  // alertStatus(t): 状態欄にメッセージを表示
  // decode(f)     : ファイルを Image として読み込む
  const groups = () => [...new Set(items.map((o) => o.name.replace(/\d+$/, "")))];
  const current = () => items.filter((o) => o.name.replace(/\d+$/, "") === prefix);
  const alertStatus = (t) => ($("spStatus").textContent = t);
  const decode = async (f) => {
    const i = new Image();
    i.src = URL.createObjectURL(f);
    await i.decode();
    return i;
  };

  // ============================================================
  // 4. 描画（プレビューとサムネイル）
  // ============================================================
  // resize(): canvas の内部解像度を表示サイズ × devicePixelRatio に合わせて描き直す
  function resize() {
    const c = $("spCanvas"),
      r = c.getBoundingClientRect(),
      d = devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(r.width * d));
    c.height = Math.max(1, Math.round(r.height * d));
    draw();
  }
  // thumbnailCache: サムネイルの使い回し用 / raf: 再描画の予約 / previewDrag: ドラッグ中の仮のずれ量
  let thumbnailCache = new Map(),
    raf = 0,
    previewDrag = null;
  // スプライトの表示上の幅と高さ。rotated(90度回転して格納)なら w と h が入れ替わる
  function spriteSize(o) {
    return { w: o.rotated ? o.h : o.w, h: o.rotated ? o.w : o.h };
  }
  // アトラスから o の範囲を (x, y, w, h) の位置へ描く。rotated なら90度戻して描く（元の画像は書き換えない）
  function paintSprite(ctx, o, x, y, w, h) {
    if (!o.rotated) {
      ctx.drawImage(atlas, o.x, o.y, o.w, o.h, x, y, w, h);
      return;
    }
    // Sparrow rotated=true: the source rectangle is stored 90° clockwise.
    // Undo rotation on canvas, without modifying the original atlas pixels.
    ctx.save();
    ctx.translate(x, y + h);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(atlas, o.x, o.y, o.w, o.h, 0, 0, h, w);
    ctx.restore();
  }
  // プレビューを描く: 表示中のスプライトを、枠（fw×fh の点線）の中央に、frameX/frameY のずれ分だけ動かして描く。
  // 拡大率は枠が収まる倍率（最大3倍）。ドラッグ中は previewDrag の仮ずれも足す。
  function draw() {
    const c = $("spCanvas"),
      ctx = c.getContext("2d"),
      d = Math.min(devicePixelRatio || 1, 2),
      w = c.width / d,
      h = c.height / d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    let a = current(),
      o = a[index];
    if (!o || !atlas) {
      $("spFrameInfo").textContent = "";
      return;
    }
    let sz = spriteSize(o),
      sw = o.fw || sz.w,
      sh = o.fh || sz.h,
      scale = Math.min((w - 40) / Math.max(1, sw), (h - 40) / Math.max(1, sh), 3);
    ctx.strokeStyle = "#77bdf4";
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(w / 2 - (sw * scale) / 2, h / 2 - (sh * scale) / 2, sw * scale, sh * scale);
    ctx.setLineDash([]);
    let dx = previewDrag ? previewDrag.dx : 0,
      dy = previewDrag ? previewDrag.dy : 0;
    let x = w / 2 + (-sw / 2 - o.fx) * scale + dx,
      y = h / 2 + (-sh / 2 - o.fy) * scale + dy;
    paintSprite(ctx, o, x, y, sz.w * scale, sz.h * scale);
    $("spFrameInfo").textContent = `${index + 1} / ${a.length} (${o.name})`;
    c.dataset.scale = scale;
  }
  // 再描画を1フレームに1回へまとめる（requestAnimationFrame）
  function requestDraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }
  // 画面全体を更新: アニメ名のプルダウン、全スプライトのサムネイル一覧（クリックで選択/解除）、プレビュー。サムネイルは thumbnailCache で使い回す
  function render() {
    let a = groups();
    if (!a.includes(prefix)) prefix = a[0] || "";
    let menu = $("spPrefix");
    menu.replaceChildren();
    for (let name of a) {
      let opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name || "(no prefix)";
      menu.append(opt);
    }
    menu.value = prefix;
    index = Math.max(0, Math.min(index, current().length - 1));
    let grid = $("spTiles");
    grid.replaceChildren();
    let frag = document.createDocumentFragment();
    items.forEach((o, i) => {
      let tile = document.createElement("div");
      tile.className = "spTile" + (selected.has(o) ? " active" : "");
      let canvas = thumbnailCache.get(o);
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = 96;
        canvas.height = 80;
        let ctx = canvas.getContext("2d");
        if (atlas) {
          let sz = spriteSize(o),
            z = Math.min(90 / Math.max(1, sz.w), 74 / Math.max(1, sz.h));
          paintSprite(ctx, o, (96 - sz.w * z) / 2, (80 - sz.h * z) / 2, sz.w * z, sz.h * z);
        }
        thumbnailCache.set(o, canvas);
      }
      let label = document.createElement("div");
      label.textContent = o.name;
      tile.append(canvas, label);
      tile.onclick = () => {
        if (selected.has(o)) {
          selected.delete(o);
          tile.classList.remove("active");
        } else {
          selected.add(o);
          tile.classList.add("active");
        }
        $("spSelectedCount").textContent = `${selected.size} / ${items.length} selected`;
      };
      frag.append(tile);
    });
    grid.append(frag);
    $("spSelectedCount").textContent = `${selected.size} / ${items.length} selected`;
    requestDraw();
  }

  // ============================================================
  // 5. XML の読み込み
  // ============================================================
  // parseXml(t): Sparrow XML（TextureAtlas > SubTexture）を読み、スプライトの配列にして返す。
  //   frameWidth/Height が無いときは w,h（rotated なら入れ替え）で補う。
  //   既知の属性以外は extra に残し、書き出し時にそのまま戻す。
  function parseXml(t) {
    let d = new DOMParser().parseFromString(t, "application/xml");
    if (d.querySelector("parsererror")) throw Error("Invalid XML");
    let root = d.documentElement;
    if (root.tagName !== "TextureAtlas") throw Error("TextureAtlas not found");
    return [...root.children]
      .filter((x) => x.tagName === "SubTexture")
      .map((x) => {
        let a = (k) => Number(x.getAttribute(k) || 0);
        return {
          name: x.getAttribute("name") || "",
          x: a("x"),
          y: a("y"),
          w: a("width"),
          h: a("height"),
          fx: a("frameX"),
          fy: a("frameY"),
          fw: a("frameWidth") || (x.getAttribute("rotated") === "true" ? a("height") : a("width")),
          fh: a("frameHeight") || (x.getAttribute("rotated") === "true" ? a("width") : a("height")),
          rotated: ["true", "1"].includes((x.getAttribute("rotated") || "").toLowerCase()),
          extra: [...x.attributes]
            .filter(
              (v) =>
                ![
                  "name",
                  "x",
                  "y",
                  "width",
                  "height",
                  "frameX",
                  "frameY",
                  "frameWidth",
                  "frameHeight",
                  "rotated",
                ].includes(v.name),
            )
            .map((v) => [v.name, v.value]),
        };
      });
  }
  // 「読み込む」: PNG と XML を読み、一覧を作る。履歴・選択はリセットする
  $("spLoad").onclick = async () => {
    try {
      if (!$("spPng").files[0] || !$("spXml").files[0]) throw Error("XML and PNG required");
      atlas = await decode($("spPng").files[0]);
      image = atlas;
      items = parseXml(await $("spXml").files[0].text());
      xmlName = $("spPng").files[0].name;
      selected.clear();
      thumbnailCache.clear();
      undoStack.length = 0;
      redoStack.length = 0;
      updateHistoryButtons();
      prefix = "";
      index = 0;
      render();
      resize();
      alertStatus(`${items.length} sprites loaded`);
    } catch (e) {
      alertStatus(e.message);
    }
  };

  // ============================================================
  // 6. アニメの切り替えと再生
  // ============================================================
  // アニメ名の変更 / 前へ・次へ（ループ）
  $("spPrefix").onchange = (e) => {
    prefix = e.target.value;
    index = 0;
    draw();
  };
  $("spPrev").onclick = () => {
    index = (index - 1 + current().length) % Math.max(1, current().length);
    draw();
  };
  $("spNext").onclick = () => {
    index = (index + 1) % Math.max(1, current().length);
    draw();
  };
  // 簡易再生: 24fps で次のフレームへ進める（もう一度押すと停止）
  $("spPlay").onclick = () => {
    if (playing) {
      clearInterval(playing);
      playing = null;
      $("spPlay").textContent = "▶ 再生";
    } else {
      playing = setInterval(() => $("spNext").click(), 1000 / 24);
      $("spPlay").textContent = "■ Stop";
    }
  };

  // ============================================================
  // 7. 位置の調整
  // ============================================================
  // move(dx, dy): スプライトの位置（frameX, frameY）をずらす。
  //   対象は spScope の選択に従う（"prefix" = 表示中のアニメ全体 / それ以外 = 表示中の1枚）。
  //   画像を (dx, dy) 動かして見せるために fx, fy からは引く。
  function move(dx, dy) {
    let arr = $("spScope").value === "prefix" ? current() : [current()[index]];
    if ((dx || dy) && arr.some(Boolean)) checkpoint();
    for (let o of arr.filter(Boolean)) {
      o.fx -= dx;
      o.fy -= dy;
    }
    requestDraw();
  }
  // 数値入力で移動（X・Y 欄の値だけ動かして、欄は 0 に戻す）
  $("spMove").onclick = () => {
    move(Number($("spX").value) || 0, Number($("spY").value) || 0);
    $("spX").value = 0;
    $("spY").value = 0;
    alertStatus("Position updated");
  };
  // プレビューをドラッグして移動:
  //   ドラッグ中は previewDrag で仮表示し、指を離したとき finishDrag が「移動量(px) ÷ 拡大率」を丸めて move() で確定する。
  $("spCanvas").addEventListener("pointerdown", (e) => {
    if (!current()[index]) return;
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      scale: Number($("spCanvas").dataset.scale) || 1,
    };
    previewDrag = { dx: 0, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  });
  $("spCanvas").addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    previewDrag = { dx: e.clientX - drag.x, dy: e.clientY - drag.y };
    requestDraw();
  });
  function finishDrag(e) {
    if (!drag || drag.id !== e.pointerId) return;
    let dx = Math.round((e.clientX - drag.x) / drag.scale),
      dy = Math.round((e.clientY - drag.y) / drag.scale);
    drag = null;
    previewDrag = null;
    if (dx || dy) move(dx, dy);
    else requestDraw();
  }
  $("spCanvas").addEventListener("pointerup", finishDrag);
  $("spCanvas").addEventListener("pointercancel", () => {
    drag = null;
    previewDrag = null;
    requestDraw();
  });

  // ============================================================
  // 8. 選択・名前変更・複製・削除
  // ============================================================
  // 選択: 表示中のアニメ全体 / すべて / 解除
  $("spSelectPrefix").onclick = () => {
    current().forEach((o) => selected.add(o));
    render();
  };
  $("spSelectAll").onclick = () => {
    selected = new Set(items);
    render();
  };
  $("spSelectNone").onclick = () => {
    selected.clear();
    render();
  };
  // 選択中のスプライトのアニメ名(接頭辞)を変更する。renumber=true なら連番を 0000 から振り直す。変更後に名前が重複するなら何もしない
  function rename(renumber) {
    let arr = items.filter((o) => selected.has(o));
    if (!arr.length) return alertStatus("Select sprites first");
    let p = $("spNewPrefix").value.trim();
    if (!p) return alertStatus("Enter a prefix");
    // 末尾が数字だと連番として扱われ、別のアニメ名にまとめられてしまう
    if (/\d$/.test(p)) return alertStatus("Prefix must not end with a number.");
    let proposal = new Map(
      arr.map((o, i) => [
        o,
        p + (renumber ? String(i).padStart(4, "0") : (o.name.match(/\d+$/) || ["0000"])[0]),
      ]),
    );
    let names = items.map((o) => proposal.get(o) || o.name);
    if (new Set(names).size !== names.length)
      return alertStatus("Duplicate sprite names. No changes made.");
    checkpoint();
    proposal.forEach((n, o) => (o.name = n));
    prefix = p;
    render();
    alertStatus("Prefix updated");
  }
  $("spRename").onclick = () => rename(false);
  $("spRenumber").onclick = () => rename(true);
  // source のスプライトを、新しいアニメ名で複製する（アトラスの画素は共有。XML の行だけが増える）
  function duplicate(source) {
    if (!source.length) return alertStatus("Select sprites first");
    let p = $("spNewPrefix").value.trim();
    if (!p) return alertStatus("Enter a new prefix");
    if (/\d$/.test(p)) return alertStatus("Prefix must not end with a number.");
    let proposal = source.map((o, i) => ({
      ...o,
      name: p + String(i).padStart(4, "0"),
      extra: o.extra.map((pair) => pair.slice()),
    }));
    let existing = new Set(items.map((o) => o.name));
    if (
      proposal.some((o) => existing.has(o.name)) ||
      new Set(proposal.map((o) => o.name)).size !== proposal.length
    )
      return alertStatus("Duplicate sprite names. No changes made.");
    checkpoint();
    items.push(...proposal);
    selected = new Set(proposal);
    prefix = p;
    index = 0;
    render();
    alertStatus(`Duplicated ${proposal.length} sprites. Atlas pixels are shared.`);
  }
  $("spDuplicate").onclick = () => duplicate(items.filter((o) => selected.has(o)));
  $("spDuplicatePrefix").onclick = () => duplicate(current());
  // 選択中のスプライトを削除（確認あり・Undo 可）
  $("spDeleteSelected").onclick = () => {
    let count = selected.size;
    if (!count) return alertStatus("Select sprites to delete");
    if (!confirm(`Delete ${count} selected sprites? You can undo this action.`)) return;
    checkpoint();
    items = items.filter((o) => !selected.has(o));
    selected.clear();
    index = 0;
    render();
    alertStatus(`Deleted ${count} sprites. Undo is available.`);
  };
  // 表示中のアニメ（同じ prefix のすべて）を削除
  $("spDelete").onclick = () => {
    if (!prefix || !confirm(`Delete all frames in ${prefix}?`)) return;
    checkpoint();
    items = items.filter((o) => !current().includes(o));
    selected.clear();
    prefix = "";
    index = 0;
    render();
    alertStatus("Prefix deleted. Export XML to save.");
  };

  // ============================================================
  // 9. 書き出しと結合
  // ============================================================
  // save(blob, name): Blob を指定のファイル名でダウンロードさせる
  // mod の zip ごと書き出す（services/ModExport.js）。置き場所は、読み込んだ PNG と同じフォルダ（images/…）
  function save(blob, name) {
    const src = $("spPng").files?.[0];
    const dir = (src?.__path ?? "images/" + (src?.name ?? "atlas.png")).split("/").slice(0, -1).join("/") || "images";
    const base = (src?.name ?? "spritesheet.png").replace(/\.[^.]+$/, "");
    const fixed = /\.xml$/i.test(name) ? base + ".xml" : name; // 読み込んだ PNG と同じ名前で置き換えられるように
    queueExport(state.app, { path: `${dir}/${fixed}`, data: blob }, { origin: src?.__origin, say: alertStatus });
  }
  // XML を spritesheet.xml として書き出す（読み込み時に保持した extra 属性も戻す）
  $("spExport").onclick = () => {
    if (!items.length) return alertStatus("Load files first");
    let d = document.implementation.createDocument("", "TextureAtlas");
    let root = d.documentElement;
    root.setAttribute("imagePath", xmlName);
    for (let o of items) {
      let el = d.createElement("SubTexture");
      for (let [k, v] of Object.entries({
        name: o.name,
        x: o.x,
        y: o.y,
        width: o.w,
        height: o.h,
        frameX: o.fx,
        frameY: o.fy,
        frameWidth: o.fw,
        frameHeight: o.fh,
        ...(o.rotated ? { rotated: "true" } : {}),
      }))
        el.setAttribute(k, String(v));
      for (let [k, v] of o.extra) el.setAttribute(k, v);
      root.append(el);
    }
    save(
      new Blob(
        ['<?xml version="1.0" encoding="utf-8"?>\n' + new XMLSerializer().serializeToString(d)],
        { type: "application/xml" },
      ),
      "spritesheet.xml",
    );
  };
  // アトラス画像を PNG として書き出す（結合後など、画像が変わったときに使う）
  $("spExportPng").onclick = () => {
    if (!atlas) return;
    let c = document.createElement("canvas");
    c.width = atlas.naturalWidth || atlas.width;
    c.height = atlas.naturalHeight || atlas.height;
    c.getContext("2d").drawImage(atlas, 0, 0);
    c.toBlob((b) => save(b, xmlName), "image/png");
  };
  // 別のアトラス(XML + PNG)を結合する: 元の画像の下に追加の PNG を縦に連結し、追加分の y を元の高さの分だけずらして末尾に加える。
  // 名前が重複していたら中止。結合後は XML と PNG の両方を書き出すこと。
  $("spMerge").onclick = async () => {
    try {
      let f = $("spMergeXml").files[0],
        p = $("spMergePng").files[0];
      if (!f || !p || !atlas) throw Error("Load original atlas and merge files first");
      let incoming = parseXml(await f.text()),
        im = await decode(p);
      let names = new Set(items.map((o) => o.name));
      if (incoming.some((o) => names.has(o.name)))
        throw Error("Duplicate sprite names in merged XML");
      let c = document.createElement("canvas");
      c.width = Math.max(atlas.width, im.width);
      c.height = atlas.height + im.height;
      let ctx = c.getContext("2d");
      ctx.drawImage(atlas, 0, 0);
      ctx.drawImage(im, 0, atlas.height);
      incoming.forEach((o) => (o.y += atlas.height));
      checkpoint();
      items.push(...incoming);
      atlas = await new Promise((resolve, reject) => {
        let n = new Image();
        n.onload = () => resolve(n);
        n.onerror = reject;
        n.src = c.toDataURL("image/png");
      });
      selected.clear();
      thumbnailCache.clear();
      render();
      alertStatus(`Merged ${incoming.length} sprites. Export XML and PNG.`);
    } catch (e) {
      alertStatus(e.message);
    }
  };
  // ウィンドウサイズが変わったら canvas を合わせ直す
  state.listen(window, "resize", resize);

  return {
    // 表示されたとき: HUD の履歴ボタンを合わせ、canvas のサイズを測り直す
    onShow() {
      updateHistoryButtons();
      resize();
    },
    // 離れるとき: 再生を止める
    onHide() {
      if (playing) $("spPlay").click();
    },
    undo: () => $("spUndo").click(),
    redo: () => $("spRedo").click(),
  };
}
