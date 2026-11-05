/* ============================================================
   animate-editor.js — Animate Editor（AnimateAtlas）本体
   ------------------------------------------------------------
   役割:
     Animate CC が書き出す AnimateAtlas（Animation.json + spritemap JSON + アトラスPNG）を読み込み、
     プレビュー・編集・書き出しを行う。ホーム画面〜ワークスペースの画面切り替えもここ。

   構造:
     全体が1つの即時実行関数 (() => { ... })() で、中の変数は外から見えない。
     他のファイルから使う必要のあるものだけ、window に公開している:
       window.FunkinAnimate         … 状態と一部の関数（末尾。autosave.js が使う）
       window.anHistoryActivate     … Undo/Redo ボタンの状態更新
       window.frameLabelGet/Set/Remove/Refresh … フレームラベル操作
       window.__fsGetRefs / __fsUnlinkAllSprite … スプライト参照チェック・配置解除（parts-manager.js が使う）

   目次（各セクションは「=====」の見出しで区切ってあります）:
      1. 画面の切り替え              11. 要素一覧
      2. 共通の道具と状態            12. キーフレーム操作
      3. Undo / Redo                 13. フレーム移動・再生・ズーム
      4. レガシー形式の対応          14. 要素の編集（回転・移動・重なり順）
      5. モダン形式のデータ構造      15. 書き出し
      6. フレームラベル              16. シンボル・アニメ・レイヤーの追加と削除
      7. 要素の変換行列              17. スプライトの一覧と配置
      8. ファイルの読み込み          18. スプライトの参照チェックと配置解除
      9. プレビュー描画              19. アトラスの再構築
     10. シンボルのナビゲーション    20. PNG追加と ZIP の書き出し・復元
   ============================================================ */
(() => {
  // ============================================================
  // 1. 画面の切り替え（ホーム → ウェルカム画面 → ワークスペース）
  // ============================================================
  // 画面の流れ:
  //   studioHome(ホーム)
  //     ├─ Animate/Sparrow を選ぶ → renderWelcome → animateWorkspace / sparrowWorkspace
  //     └─ Funkin' を選ぶ        → funkinWelcome → offsetWorkspace (Character Editor)
  //
  // openWorkspace(mode): mode は "animate" | "sparrow" | "offset"。
  //   指定したワークスペースだけ表示し、他は hidden にする。
  //   HUD の Undo/Redo は一度無効にして、モードごとの履歴側(anHistoryActivate など)で再度有効化する。
  function openWorkspace(mode) {
    for (const id of ["animateWorkspace", "sparrowWorkspace", "offsetWorkspace"])
      document.getElementById(id).hidden = id !== mode + "Workspace";
    document.getElementById("renderWelcome").hidden = true;
    const label = { animate: "AnimateAtlas", sparrow: "Sparrow", offset: "Offset Editor" }[mode];
    document.getElementById("changeRenderer").textContent = label + " ▾";
    document.getElementById("hudUndo").disabled = true;
    document.getElementById("hudRedo").disabled = true;
    if (mode === "animate") {
      window.anHistoryActivate?.();
    }
    if (mode === "sparrow") {
      window.refreshHudHistory?.();
      window.spResize?.();
    }
    if (mode === "offset") {
      window.offsetResize?.();
    }
  }
  // ホーム/ウェルカム画面のボタン配線。
  // 各画面は hidden 属性の ON/OFF で出し入れしている（画面遷移＝hiddenの付け替え）。
  document.getElementById("homeAnimate").onclick = () => {
    document.getElementById("studioHome").hidden = true;
    document.getElementById("renderWelcome").hidden = false;
  };
  document.getElementById("homeFunkin").onclick = () => {
    document.getElementById("studioHome").hidden = true;
    document.getElementById("funkinWelcome").hidden = false;
  };
  document.getElementById("chooseCharacter").onclick = () => {
    document.getElementById("funkinWelcome").hidden = true;
    openWorkspace("offset");
  };
  document.getElementById("funkinBackHome").onclick = () => {
    document.getElementById("funkinWelcome").hidden = true;
    document.getElementById("studioHome").hidden = false;
  };
  document.getElementById("backHome").onclick = () => {
    document.getElementById("renderWelcome").hidden = true;
    document.getElementById("studioHome").hidden = false;
  };

  document.getElementById("chooseAnimate").onclick = () => openWorkspace("animate");
  document.getElementById("chooseSparrow").onclick = () => openWorkspace("sparrow");
  // Language controls are owned by the shared localization module below.
  // どの画面からでもホーム画面へ戻る
  function goHome() {
    document.getElementById("renderWelcome").hidden = true;
    document.getElementById("funkinWelcome").hidden = true;
    document.getElementById("studioHome").hidden = false;
  }
  document.getElementById("goHome").onclick = goHome;
  // ヘッダーの「レンダラー ▾」ボタン: Offset Editor 表示中ならキャラ選択、それ以外ならAnimate/Sparrow選択画面を開き直す
  document.getElementById("changeRenderer").onclick = () => {
    if (!document.getElementById("offsetWorkspace").hidden) {
      document.getElementById("funkinWelcome").hidden = false;
    } else {
      document.getElementById("renderWelcome").hidden = false;
    }
  };

  // ============================================================
  // 2. 共通の道具と、Animate Editor の状態
  // ============================================================
  // $(id): document.getElementById の短縮形
  // cv / ctx: プレビュー用 canvas (#stage) とその 2D 描画コンテキスト
  const $ = (id) => document.getElementById(id),
    cv = $("stage"),
    ctx = cv.getContext("2d");
  // エディタの状態（これらが「いま開いているデータ」のすべて）
  //   img         : アトラス画像 (spritemap の PNG)
  //   anim        : Animation.json をパースしたオブジェクト
  //   map         : spritemap の JSON（アトラス内の各スプライトの位置・サイズ）
  //   playing/timer : 再生中かどうかと、再生用タイマー
  //   sel / selKey  : 選択中の要素 / 選択中のキーフレーム
  //   symbol      : 表示中のシンボル名（"__AN__" がルート＝メインのアニメ）
  //   pngFileName : 書き出し時に使う PNG のファイル名
  //   dragState   : ステージ上でドラッグ操作中の情報（していなければ null）
  let img = new Image(),
    anim = null,
    map = null,
    playing = false,
    timer = null,
    sel = null,
    selKey = null,
    symbol = "__AN__",
    pngFileName = "spritemap1.png",
    dragState = null;

  // ============================================================
  // 3. Undo / Redo（元に戻す・やり直す）
  // ============================================================
  // 仕組み: データを変更する「直前」に anCheckpoint() で今の状態を anUndo に積む。
  //         Undo すると今の状態を anRedo に積んでから、積んであった状態を復元する。
  //         Sparrow Editor の履歴とは別（こちらは Animate 専用）。AN_LIMIT 件まで保持。
  // AnimateAtlas editing history (independent from Sparrow history).
  const anUndo = [],
    anRedo = [],
    AN_LIMIT = 40;
  // 現在の編集状態を1件分のスナップショットとして返す（JSONは文字列化して複製、画像は参照のみ）
  function anSnapshot() {
    return {
      anim: JSON.stringify(anim),
      map: JSON.stringify(map),
      img,
      pngFileName,
      symbol,
      frame: Number($("frame").value) || 0,
    };
  }
  // HUD の Undo/Redo ボタンの有効・無効を、履歴の有無に合わせて更新（Animate画面が非表示なら何もしない）
  function anButtons() {
    if ($("animateWorkspace").hidden) return;
    $("hudUndo").disabled = !anUndo.length;
    $("hudRedo").disabled = !anRedo.length;
  }
  // 変更を加える『直前』に呼ぶ。今の状態を Undo 履歴へ積み、Redo 履歴は破棄する。上限を超えたら古いものから捨てる
  function anCheckpoint() {
    if (!anim) return;
    anUndo.push(anSnapshot());
    if (anUndo.length > AN_LIMIT) anUndo.shift();
    anRedo.length = 0;
    anButtons();
  }
  // スナップショットの状態に戻す。データを差し替えたあと、シンボル選択・スプライト一覧・タイムライン・プレビューなど画面側も作り直す
  function anRestore(s) {
    symbolNavStack.length = 0;
    anim = JSON.parse(s.anim);
    map = JSON.parse(s.map);
    img = s.img;
    pngFileName = s.pngFileName;
    symbol = s.symbol;
    sel = selKey = null;
    const opts = animateSymbolOptions();
    $("symbol").replaceChildren();
    for (const o of opts) {
      let e = document.createElement("option");
      e.value = o.name;
      e.textContent = o.label;
      $("symbol").append(e);
    }
    $("symbol").value = symbol;
    $("sprite").replaceChildren();
    for (const x of map.ATLAS?.SPRITES || []) {
      let sp = x.SPRITE,
        o = document.createElement("option");
      o.value = sp.name;
      o.textContent = sp.name;
      $("sprite").append(o);
    }
    updateAddSpriteList();
    $("timeline").max = duration(symbol) - 1;
    $("frame").max = $("timeline").max;
    setFrame(Math.min(s.frame, duration(symbol) - 1));
    parts();
    updateKeyUI();
    draw();
    legacyEditRefresh();
    anButtons();
  }
  // Undo(redo=false) / Redo(redo=true) を1回実行。今の状態を反対側の履歴へ積んでから復元する
  function anStep(redo) {
    const from = redo ? anRedo : anUndo,
      to = redo ? anUndo : anRedo;
    if (!from.length) return;
    to.push(anSnapshot());
    anRestore(from.pop());
    status(redo ? "やり直しました。" : "元に戻しました。");
  }
  // openWorkspace から呼べるように window に公開（Animate を開いたときにボタン状態を更新する）
  window.anHistoryActivate = anButtons;
  // 自動チェックポイント: 下の編集系ボタンが押された「瞬間」(capture=true で他の処理より先に実行)に
  // 自動で anCheckpoint() を呼ぶ。各ボタンの処理側で呼び忘れても Undo できるようにするための仕組み。
  // anMutations … チェックポイントを取る対象のボタン id 一覧
  // Capture the state before editor actions, including the first pointer drag.
  const anMutations = new Set([
    "keyCopy",
    "keyBlank",
    "keyDelete",
    "keyExtend",
    "rotateApply",
    "apply",
    "layerUp",
    "layerDown",
    "addpart",
    "unlink",
    "deleteSprite",
    "importpng",
    "restorezip",
  ]);
  document.addEventListener(
    "click",
    (e) => {
      if ($("animateWorkspace").hidden) return;
      let b = e.target.closest("button");
      if (b && anMutations.has(b.id) && anim) anCheckpoint();
    },
    true,
  );
  cv.addEventListener(
    "pointerdown",
    () => {
      if (sel && anim) anCheckpoint();
    },
    true,
  );
  // ショートカット: Ctrl/Cmd+Z = Undo、Ctrl/Cmd+Shift+Z または Ctrl/Cmd+Y = Redo。入力欄にフォーカス中は無効（文字入力のUndoと衝突させない）
  document.addEventListener(
    "keydown",
    (e) => {
      if ($("animateWorkspace").hidden || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const tag = e.target?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        anStep(e.shiftKey);
      } else if (e.key.toLowerCase() === "y") {
        e.preventDefault();
        anStep(true);
      }
    },
    true,
  );
  // ヘッダーの Undo / Redo ボタン（Animate 画面のときだけ反応）
  $("hudUndo").addEventListener(
    "click",
    () => {
      if (!$("animateWorkspace").hidden) anStep(false);
    },
    true,
  );
  $("hudRedo").addEventListener(
    "click",
    () => {
      if (!$("animateWorkspace").hidden) anStep(true);
    },
    true,
  );
  // status(s): 画面下のステータス欄にメッセージを表示
  // esc(s)   : HTML に埋め込む文字列のエスケープ（& < > " ' を実体参照へ）
  const status = (s) => ($("status").textContent = s),
    esc = (s) =>
      String(s).replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
      );
  // canvas の内部解像度を「表示サイズ × devicePixelRatio」に合わせる（高DPI画面でもくっきり描く）。ウィンドウサイズが変わったら再描画
  function resize() {
    let r = cv.getBoundingClientRect(),
      d = window.devicePixelRatio || 1;
    cv.width = Math.max(1, r.width * d);
    cv.height = Math.max(1, r.height * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    draw();
  }
  window.addEventListener("resize", resize);

  // ============================================================
  // 4. レガシー形式（ANIMATION / SYMBOL_DICTIONARY）の対応
  // ============================================================
  // Animate の JSON には2種類の形式がある。
  //   モダン形式   : { AN, SD, MD ... }  キー名が短縮されている（TL=タイムライン, L=レイヤー, FR=フレーム, E=要素, MX=行列 など）
  //   レガシー形式 : { ANIMATION, SYMBOL_DICTIONARY }  Character Editor と同じ形式（Layers / Frames / elements / Matrix3D）
  // レガシー形式は変換すると情報が欠けるので、元の形のまま「プレビュー」と「編集」を行う。
  // 4-1. プレビュー描画
  // Legacy AnimateAtlas preview shares the Character Editor's ANIMATION / SYMBOL_DICTIONARY schema.
  // Keep original legacy JSON untouched; conversion to the modern editing schema would be lossy.
  // 読み込んだ JSON がレガシー形式か判定（ANIMATION と SYMBOL_DICTIONARY を両方持っていればレガシー）
  const isLegacyAnimate = () => !!(anim?.ANIMATION && anim?.SYMBOL_DICTIONARY);
  // レガシー形式の読み取り用ヘルパー:
  //   legacySymbolList()   : シンボル一覧
  //   legacyRootName()     : ルート（メイン）アニメの名前
  //   legacyTimelineFor(n) : シンボル名 n のタイムライン（"__AN__" ならルート）
  //   legacyLength(t)      : タイムラインの総フレーム数（最後のキーフレームの終端）
  const legacySymbolList = () => anim?.SYMBOL_DICTIONARY?.Symbols || [];
  const legacyRootName = () => anim?.ANIMATION?.SYMBOL_name || "Main";
  const legacyTimelineFor = (n) =>
    n === "__AN__"
      ? anim?.ANIMATION?.TIMELINE
      : legacySymbolList().find((x) => x.SYMBOL_name === n)?.TIMELINE;
  const legacyLength = (t) =>
    Math.max(
      1,
      ...(t?.LAYERS || []).flatMap((l) =>
        (l.Frames || []).map((f) => (Number(f.index) || 0) + Math.max(1, Number(f.duration) || 1)),
      ),
    );
  // Matrix3D の値(m00,m01,m10,m11 = 拡大縮小・回転 / m30,m31 = 移動)を canvas の変換に適用する
  function legacyPreviewMatrix(m) {
    if (!m) return;
    ctx.transform(
      Number(m.m00 ?? 1),
      Number(m.m01 ?? 0),
      Number(m.m10 ?? 0),
      Number(m.m11 ?? 1),
      Number(m.m30 ?? 0),
      Number(m.m31 ?? 0),
    );
  }
  // タイムライン t を fr フレーム目の状態で描画する（シンボルの入れ子は再帰）。
  //   - 配列の末尾のレイヤーから先に描く ＝ 先頭のレイヤーが一番手前
  //   - depth は無限再帰の保険（25段まで）
  function legacyPreviewTimeline(t, fr, depth = 0) {
    if (depth > 25) return;
    const layers = t?.LAYERS || [];
    for (let li = layers.length - 1; li >= 0; li--) {
      const l = layers[li],
        f = (l.Frames || []).find(
          (k) =>
            fr >= Number(k.index) && fr < Number(k.index) + Math.max(1, Number(k.duration) || 1),
        );
      if (!f) continue;
      for (const e of f.elements || []) {
        // 要素の種類で分岐: ATLAS_SPRITE_instance = アトラス画像そのもの / SYMBOL_Instance = 別シンボルの配置
        const sp = e.ATLAS_SPRITE_instance;
        if (sp) {
          const sprite = (map?.ATLAS?.SPRITES || [])
            .map((x) => x.SPRITE)
            .find((x) => String(x.name) === String(sp.name));
          if (!sprite) continue;
          ctx.save();
          legacyPreviewMatrix(sp.Matrix3D);
          // measuringBounds が設定されているときは、描画と同時に「画面上で占める範囲(外接矩形)」も記録する（全体表示の自動フィット用）
          if (measuringBounds) {
            const pts = [
              [0, 0],
              [sprite.w, 0],
              [0, sprite.h],
              [sprite.w, sprite.h],
            ];
            const m = ctx.getTransform();
            for (const [x, y] of pts) {
              const px = m.a * x + m.c * y + m.e,
                py = m.b * x + m.d * y + m.f;
              measuringBounds.minX = Math.min(measuringBounds.minX, px);
              measuringBounds.maxX = Math.max(measuringBounds.maxX, px);
              measuringBounds.minY = Math.min(measuringBounds.minY, py);
              measuringBounds.maxY = Math.max(measuringBounds.maxY, py);
            }
          }
          // アトラス内で90度回転して詰められている画像は、描画時に元の向きへ戻す
          if (sprite.rotated) {
            ctx.translate(0, sprite.w);
            ctx.rotate(-Math.PI / 2);
          }
          ctx.drawImage(img, sprite.x, sprite.y, sprite.w, sprite.h, 0, 0, sprite.w, sprite.h);
          ctx.restore();
        } else if (e.SYMBOL_Instance) {
          const si = e.SYMBOL_Instance,
            child = legacySymbolList().find((x) => x.SYMBOL_name === si.SYMBOL_name);
          if (!child) continue;
          ctx.save();
          legacyPreviewMatrix(si.Matrix3D);
          const len = legacyLength(child.TIMELINE),
            first = Math.max(0, Number(si.firstFrame) || 0),
            elapsed = Math.max(0, fr - (Number(f.index) || 0));
          // 子シンボルの再生モード: singleframe = firstFrame で固定 / playonce = 最後のフレームで止まる / それ以外 = ループ
          const mode = String(si.loop || "loop").toLowerCase();
          const childFrame =
            mode === "singleframe"
              ? first
              : mode === "playonce"
                ? Math.min(first + elapsed, len - 1)
                : (first + elapsed) % len;
          legacyPreviewTimeline(child.TIMELINE, childFrame, depth + 1);
          ctx.restore();
        }
      }
    }
  }
  // シンボル選択プルダウン用の一覧 [{name,label}] を作る。先頭は常にルート("__AN__")。形式(レガシー/モダン)で取り出し元が違う
  function animateSymbolOptions() {
    return isLegacyAnimate()
      ? [
          { name: "__AN__", label: "Animation: " + legacyRootName() },
          ...legacySymbolList().map((x) => ({
            name: x.SYMBOL_name,
            label: "Symbol: " + x.SYMBOL_name,
          })),
        ]
      : [
          { name: "__AN__", label: "Animation: " + (anim.AN?.SN || anim.AN?.N || "Main") },
          ...(anim.SD?.S || []).map((x) => ({ name: x.SN, label: "Symbol: " + x.SN })),
        ];
  }

  // ============================================================
  // 4-2. レガシー編集パネル（行列の数値編集 / 位置の微調整 / ドラッグ移動 / レイヤー順 など）
  // ============================================================
  // Legacy editor operates on original ANIMATION / SYMBOL_DICTIONARY objects.
  // No conversion to modern FR/E/MX is performed, avoiding lossy exports.
  // パネルで選択中のレイヤー番号と要素番号
  let legacySelectedLayer = 0,
    legacySelectedElement = 0;
  // 現在のフレーム位置を含むキーフレームを返す（index 〜 index+duration の範囲で判定）
  function legacyActiveFrame(layer) {
    const frame = Math.max(0, Number($("frame").value) || 0);
    return (layer?.Frames || []).find(
      (f) =>
        frame >= Number(f.index) && frame < Number(f.index) + Math.max(1, Number(f.duration) || 1),
    );
  }
  // レガシー編集パネルの表示を、今の状態に合わせて作り直す（レイヤー/要素プルダウン・行列の値・ボタンの有効無効・状態表示）。レガシー形式でなければパネルごと隠す
  function legacyEditRefresh() {
    const panel = $("legacyEditPanel");
    if (!panel) return;
    const legacy = isLegacyAnimate();
    $("animateWorkspace").dataset.schema = legacy ? "legacy" : "modern";
    panel.hidden = !legacy;
    if (!legacy) return;
    const layers = legacyTimelineFor(symbol)?.LAYERS || [];
    const layerSelect = $("legacyLayer"),
      elementSelect = $("legacyElement");
    layerSelect.replaceChildren();
    layers.forEach((l, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = l.Layer_name || "Layer " + i;
      layerSelect.append(o);
    });
    legacySelectedLayer = Math.min(
      Math.max(0, legacySelectedLayer),
      Math.max(0, layers.length - 1),
    );
    layerSelect.value = String(legacySelectedLayer);
    const elements = legacyActiveFrame(layers[legacySelectedLayer])?.elements || [];
    elementSelect.replaceChildren();
    elements.forEach((e, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent =
        (e.ATLAS_SPRITE_instance?.name || e.SYMBOL_Instance?.SYMBOL_name || "Element") + " #" + i;
      elementSelect.append(o);
    });
    legacySelectedElement = Math.min(
      Math.max(0, legacySelectedElement),
      Math.max(0, elements.length - 1),
    );
    elementSelect.value = String(legacySelectedElement);
    const inst =
      elements[legacySelectedElement]?.ATLAS_SPRITE_instance ||
      elements[legacySelectedElement]?.SYMBOL_Instance;
    const m = inst?.Matrix3D;
    const vals = [m?.m00 ?? 1, m?.m01 ?? 0, m?.m10 ?? 0, m?.m11 ?? 1, m?.m30 ?? 0, m?.m31 ?? 0];
    vals.forEach((v, i) => {
      $("legacyM" + i).value = inst ? String(v) : "";
    });
    $("legacyPosX").value = inst ? String(vals[4]) : "";
    $("legacyPosY").value = inst ? String(vals[5]) : "";
    for (const id of [
      "legacyPositionApply",
      "legacyNudgeLeft",
      "legacyNudgeRight",
      "legacyNudgeUp",
      "legacyNudgeDown",
    ])
      $(id).disabled = !inst;
    $("legacyApply").disabled = !inst;
    $("legacyUp").disabled = !layers.length || legacySelectedLayer === 0;
    $("legacyDown").disabled = !layers.length || legacySelectedLayer === layers.length - 1;
    $("legacyZ").value = String(legacySelectedLayer);
    $("legacyZ").max = String(Math.max(0, layers.length - 1));
    const active = legacyActiveFrame(layers[legacySelectedLayer]);
    $("legacyKeyStart").value = active ? String(active.index) : "";
    $("legacyKeyDuration").value = active ? String(active.duration) : "";
    $("legacySetDuration").disabled = !active;
    $("legacyDeleteFrame").disabled = !active;
    $("legacyRemoveLayer").disabled = !layers.length;
    $("legacyElementFront").disabled = !inst || legacySelectedElement === 0;
    $("legacyElementBack").disabled = !inst || legacySelectedElement === elements.length - 1;
    $("legacyEditStatus").textContent = inst
      ? (document.documentElement.lang === "en" ? "Editing: " : "編集中: ") +
        (inst.name || inst.SYMBOL_name || "Element") +
        " · " +
        (document.documentElement.lang === "en" ? "frame " : "フレーム ") +
        $("frame").value
      : document.documentElement.lang === "en"
        ? "No editable element at this frame."
        : "このフレームに編集できる要素はありません。";
  }
  // 選択中の要素の実体（ATLAS_SPRITE_instance か SYMBOL_Instance）を返す。無ければ undefined
  function legacySelectedInstance() {
    const layers = legacyTimelineFor(symbol)?.LAYERS || [];
    const f = legacyActiveFrame(layers[legacySelectedLayer]);
    const e = f?.elements?.[legacySelectedElement];
    return e?.ATLAS_SPRITE_instance || e?.SYMBOL_Instance;
  }
  // プルダウンの選択を内部変数へ反映して、パネルを更新する
  $("legacyLayer").onchange = () => {
    legacySelectedLayer = Number($("legacyLayer").value) || 0;
    legacySelectedElement = 0;
    legacyEditRefresh();
  };
  $("legacyElement").onchange = () => {
    legacySelectedElement = Number($("legacyElement").value) || 0;
    legacyEditRefresh();
  };
  // 「適用」: 6つの数値欄を選択要素の行列に書き込む。DecomposedMatrix(分解済みの値)は行列と食い違うため削除する
  $("legacyApply").onclick = () => {
    const inst = legacySelectedInstance();
    if (!inst) return;
    const values = Array.from({ length: 6 }, (_, i) => Number($("legacyM" + i).value));
    if (values.some((v) => !Number.isFinite(v))) {
      $("legacyEditStatus").textContent = "Invalid matrix values";
      return;
    }
    anCheckpoint();
    const m = inst.Matrix3D || (inst.Matrix3D = {});
    ["m00", "m01", "m10", "m11", "m30", "m31"].forEach((k, i) => (m[k] = values[i]));
    if (inst.DecomposedMatrix) {
      delete inst.DecomposedMatrix;
    }
    draw();
    legacyEditRefresh();
    $("legacyEditStatus").textContent = "Matrix updated. Export Animation.json to save.";
  };
  // 選択要素の位置(m30,m31)を設定して再描画。checkpoint=false はドラッグ中用（Undo用の保存はドラッグ開始時に1回だけ行う）
  function legacySetPosition(x, y, checkpoint = true) {
    const inst = legacySelectedInstance();
    if (!inst || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (checkpoint) anCheckpoint();
    const m = inst.Matrix3D || (inst.Matrix3D = {});
    m.m30 = x;
    m.m31 = y;
    if (inst.DecomposedMatrix) delete inst.DecomposedMatrix;
    $("legacyM4").value = String(x);
    $("legacyM5").value = String(y);
    $("legacyPosX").value = String(x);
    $("legacyPosY").value = String(y);
    draw();
    return true;
  }
  $("legacyPositionApply").onclick = () => {
    if (legacySetPosition(Number($("legacyPosX").value), Number($("legacyPosY").value)))
      legacyNotice("選択要素の位置を変更しました。", "Selected element position updated.");
  };
  // 矢印ボタンで 1px ずつ移動
  for (const [id, dx, dy] of [
    ["legacyNudgeLeft", -1, 0],
    ["legacyNudgeRight", 1, 0],
    ["legacyNudgeUp", 0, -1],
    ["legacyNudgeDown", 0, 1],
  ]) {
    $(id).onclick = () => {
      const inst = legacySelectedInstance();
      if (!inst) return;
      const m = inst.Matrix3D || {};
      legacySetPosition((Number(m.m30) || 0) + dx, (Number(m.m31) || 0) + dy);
      legacyNotice("選択要素を移動しました。", "Selected element moved.");
    };
  }
  // Capture-phase pointer handling prevents the modern editor drag listener from
  // changing a different selected element when the legacy editor is active.
  // ドラッグ中の情報（開始座標・元の位置・拡大率）。null ならドラッグしていない
  let legacyDrag = null;
  $("stage").addEventListener(
    "pointerdown",
    (e) => {
      if (!isLegacyAnimate() || !legacySelectedInstance()) return;
      const inst = legacySelectedInstance(),
        m = inst.Matrix3D || {};
      legacyDrag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        px: Number(m.m30) || 0,
        py: Number(m.m31) || 0,
        scale: stageScale() || 1,
      };
      anCheckpoint();
      $("stage").setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  $("stage").addEventListener(
    "pointermove",
    (e) => {
      if (!legacyDrag || legacyDrag.id !== e.pointerId) return;
      legacySetPosition(
        legacyDrag.px + (e.clientX - legacyDrag.x) / legacyDrag.scale,
        legacyDrag.py + (e.clientY - legacyDrag.y) / legacyDrag.scale,
        false,
      );
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  // ドラッグ終了（指を離す / キャンセル）
  function legacyEndDrag(e) {
    if (!legacyDrag || legacyDrag.id !== e.pointerId) return;
    legacyDrag = null;
    legacyNotice(
      "ドラッグした位置を反映しました。JSONを保存してください。",
      "Drag position applied. Export the JSON to save.",
    );
    e.stopImmediatePropagation();
  }
  $("stage").addEventListener("pointerup", legacyEndDrag, true);
  $("stage").addEventListener("pointercancel", legacyEndDrag, true);
  // 選択レイヤーをリスト上で1つ上(-1)/下(+1)に入れ替える
  function legacyMoveLayer(delta) {
    const layers = legacyTimelineFor(symbol)?.LAYERS || [];
    const from = legacySelectedLayer,
      to = from + delta;
    if (to < 0 || to >= layers.length) return;
    anCheckpoint();
    [layers[from], layers[to]] = [layers[to], layers[from]];
    legacySelectedLayer = to;
    legacyEditRefresh();
    draw();
    $("legacyEditStatus").textContent = "Layer order updated.";
  }
  $("legacyUp").onclick = () => legacyMoveLayer(-1);
  $("legacyDown").onclick = () => legacyMoveLayer(1);
  // 表示言語(html の lang)に合わせて日本語/英語のメッセージを状態欄に出す
  function legacyNotice(ja, en) {
    $("legacyEditStatus").textContent = document.documentElement.lang === "en" ? en : ja;
  }
  // legacyLayer(): 選択中のレイヤー / legacyFrames(): そのレイヤーのキーフレーム配列（無ければ作る）
  function legacyLayer() {
    return legacyTimelineFor(symbol)?.LAYERS?.[legacySelectedLayer];
  }
  function legacyFrames() {
    const l = legacyLayer();
    if (!l) return null;
    return l.Frames || (l.Frames = []);
  }
  // タイムラインの長さ(最大フレーム)を計算し直し、frame 位置へ移動して再描画する
  function legacyRefreshAt(frame) {
    const max = Math.max(0, duration(symbol) - 1);
    $("timeline").max = max;
    $("frame").max = max;
    setFrame(Math.min(Math.max(0, frame), max));
    legacyEditRefresh();
    draw();
  }
  // キーフレームを現在のフレーム位置に追加する。blank=false なら今のキーの複製、blank=true なら空のキー。
  // すでにキーがある位置には追加しない。
  function legacyInsertFrame(blank) {
    const frames = legacyFrames();
    if (!frames) return;
    const t = Math.max(0, Number($("frame").value) || 0);
    const active = legacyActiveFrame(legacyLayer());
    if (frames.some((f) => Number(f.index) === t)) {
      legacyNotice("この位置には既にキーがあります。", "A key already exists here.");
      return;
    }
    anCheckpoint();
    let entry;
    // 今のキーの途中なら、そこで2つに分割: entry(複製)=後半 / active=前半（長さを t までに縮める）
    if (active) {
      const end = Number(active.index) + Math.max(1, Number(active.duration) || 1);
      entry = JSON.parse(JSON.stringify(active));
      entry.index = t;
      entry.duration = Math.max(1, end - t);
      active.duration = t - Number(active.index);
    // キーが無い位置なら、次のキーの手前までを長さとする新しいキーを作る
    } else {
      const next = frames.filter((f) => Number(f.index) > t).sort((a, b) => a.index - b.index)[0];
      entry = { index: t, duration: Math.max(1, next ? Number(next.index) - t : 1), elements: [] };
    }
    if (blank) entry.elements = [];
    frames.push(entry);
    frames.sort((a, b) => Number(a.index) - Number(b.index));
    legacySelectedElement = 0;
    legacyRefreshAt(t);
    legacyNotice(
      blank ? "空のキーを追加しました。" : "キーを複製しました。",
      blank ? "Blank key added." : "Key duplicated.",
    );
  }
  // 「キーを複製」「空のキーを追加」ボタン
  $("legacyDuplicate").onclick = () => legacyInsertFrame(false);
  $("legacyBlank").onclick = () => legacyInsertFrame(true);
  // 現在位置のキーを削除
  $("legacyDeleteFrame").onclick = () => {
    const frames = legacyFrames(),
      f = legacyActiveFrame(legacyLayer());
    if (!frames || !f) return;
    anCheckpoint();
    frames.splice(frames.indexOf(f), 1);
    legacyRefreshAt(Number($("frame").value));
    legacyNotice("キーを削除しました。", "Key deleted.");
  };
  // キーの長さを変更（1以上の整数）。次のキーと重なる場合は拒否する
  $("legacySetDuration").onclick = () => {
    const f = legacyActiveFrame(legacyLayer()),
      frames = legacyFrames();
    if (!f || !frames) return;
    const n = Number($("legacyKeyDuration").value);
    if (!Number.isInteger(n) || n < 1) {
      legacyNotice("長さは1以上の整数にしてください。", "Duration must be a positive integer.");
      return;
    }
    const next = frames
      .filter((x) => x !== f && Number(x.index) > Number(f.index))
      .sort((a, b) => a.index - b.index)[0];
    if (next && Number(f.index) + n > Number(next.index)) {
      legacyNotice("次のキーと重なっています。", "Duration overlaps the next key.");
      return;
    }
    anCheckpoint();
    f.duration = n;
    legacyRefreshAt(Number($("frame").value));
    legacyNotice("キーの長さを変更しました。", "Key duration updated.");
  };
  // レイヤーの重なり順を番号で指定して移動（配列から抜いて、指定位置へ差し込む）
  $("legacySetZ").onclick = () => {
    const layers = legacyTimelineFor(symbol)?.LAYERS || [];
    const from = legacySelectedLayer,
      to = Number($("legacyZ").value);
    if (!Number.isInteger(to) || to < 0 || to >= layers.length) return;
    if (from === to) return;
    anCheckpoint();
    const [layer] = layers.splice(from, 1);
    layers.splice(to, 0, layer);
    legacySelectedLayer = to;
    legacyEditRefresh();
    draw();
    legacyNotice("重なり順を変更しました。", "Layer order updated.");
  };
  // 新しいレイヤーを先頭（＝一番手前）に追加
  $("legacyAddLayer").onclick = () => {
    const tl = legacyTimelineFor(symbol);
    if (!tl) return;
    anCheckpoint();
    tl.LAYERS ||= [];
    tl.LAYERS.unshift({ Layer_name: "Layer " + (tl.LAYERS.length + 1), Frames: [] });
    legacySelectedLayer = 0;
    legacyEditRefresh();
    draw();
    legacyNotice("レイヤーを追加しました。", "Layer added.");
  };
  // 選択中のレイヤーを、確認ダイアログのあと削除
  $("legacyRemoveLayer").onclick = () => {
    const layers = legacyTimelineFor(symbol)?.LAYERS;
    if (!layers?.length) return;
    if (
      !confirm(
        document.documentElement.lang === "en"
          ? "Delete this layer and all its frames?"
          : "このレイヤーと全フレームを削除しますか？",
      )
    )
      return;
    anCheckpoint();
    layers.splice(legacySelectedLayer, 1);
    legacySelectedLayer = Math.max(0, Math.min(legacySelectedLayer, layers.length - 1));
    legacyEditRefresh();
    draw();
    legacyNotice("レイヤーを削除しました。", "Layer deleted.");
  };
  // 選択中の要素の重なり順を入れ替える（フレーム内の elements 配列の順 ＝ 描画順）
  function legacyMoveElement(delta) {
    const elements = legacyActiveFrame(legacyLayer())?.elements || [];
    const from = legacySelectedElement,
      to = from + delta;
    if (to < 0 || to >= elements.length) return;
    anCheckpoint();
    [elements[from], elements[to]] = [elements[to], elements[from]];
    legacySelectedElement = to;
    legacyEditRefresh();
    draw();
    legacyNotice("要素の重なり順を変更しました。", "Element order updated.");
  }
  $("legacyElementFront").onclick = () => legacyMoveElement(-1);
  $("legacyElementBack").onclick = () => legacyMoveElement(1);
  // レガシー形式の編集結果を Animation-legacy-edited.json としてダウンロード
  $("legacySave").onclick = () => {
    if (!isLegacyAnimate()) return;
    downloadBlob(
      new Blob([JSON.stringify(anim)], { type: "application/json" }),
      "Animation-legacy-edited.json",
    );
    $("legacyEditStatus").textContent = "Legacy Animation.json exported.";
  };
  // レガシー形式のデータに対してモダン用の編集ボタンが押されたときの案内メッセージ。常に true を返す
  function legacyReadOnly() {
    if (!isLegacyAnimate()) return false;
    status(
      "旧形式の編集は専用パネルから行ってください。 / Use the legacy editor panel for editing.",
    );
    return true;
  }

  // ============================================================
  // 5. モダン形式のデータ構造と、基本ヘルパー
  // ============================================================
  // モダン形式の Animation.json は、キー名が短縮されている（読むときの早見表）:
  //   MD            : メタデータ { W, H = 書き出しサイズ, FRT = フレームレート(fps) }
  //   AN            : メインのアニメ { SN = 名前, TL = タイムライン }
  //   SD.S          : シンボル一覧 [ { SN = シンボル名, TL = タイムライン } ]
  //   TL.L          : レイヤー一覧 [ { LN = レイヤー名, FR = キーフレーム一覧 } ]
  //   FR の各要素   : { I = 開始フレーム, DU = 長さ, N = フレームラベル名, E = 要素一覧 }
  //   E の各要素    : { ASI = アトラス画像 { N = スプライト名, MX = 変換行列 } }
  //                   または { SI = シンボル配置 { SN = シンボル名, FF = 開始フレーム, LP = ループ方式, MX } }
  //   MX            : 変換行列 [a, b, c, d, tx, ty]（tx, ty が位置）。M3D という16要素の形式のこともある
  //
  // tl(n)       : シンボル n のタイムライン（"__AN__" ならメイン）。レガシー形式なら null
  // duration(n) : シンボル n の総フレーム数（各キーの I + DU の最大値）
  const tl = (n) =>
    isLegacyAnimate()
      ? null
      : n === "__AN__"
        ? anim?.AN?.TL
        : (anim?.SD?.S || []).find((s) => s.SN === n)?.TL;
  function duration(n) {
    if (isLegacyAnimate()) return legacyLength(legacyTimelineFor(n));
    let m = 1;
    for (const l of tl(n)?.L || [])
      for (const f of l.FR || []) m = Math.max(m, (f.I || 0) + (f.DU || 1));
    return m;
  }
  // 読み込み時の補正: 各レイヤーの最後のキーを、タイムライン全体の終端まで延ばす（再生の最後で急に消えないように）。戻り値 = 変更したキーの数。
  // Extend only the final populated keyframe of each layer. Empty keys remain intentional hiding points.
  function extendLastVisibleKeys() {
    if (!anim) return 0;
    let changed = 0;
    const timelines = [anim.AN?.TL, ...(anim.SD?.S || []).map((x) => x.TL)].filter(Boolean);
    for (const t of timelines) {
      const layers = t.L || [];
      let end = 1;
      for (const l of layers)
        for (const f of l.FR || [])
          end = Math.max(end, (Number(f.I) || 0) + Math.max(1, Number(f.DU) || 1));
      for (const l of layers) {
        const frames = [...(l.FR || [])].sort((a, b) => (Number(a.I) || 0) - (Number(b.I) || 0));
        const last = frames[frames.length - 1];
        if (!last || (last.E || []).length === 0) continue;
        const start = Number(last.I) || 0;
        const needed = Math.max(1, end - start);
        if ((Number(last.DU) || 1) < needed) {
          last.DU = needed;
          changed++;
        }
      }
    }
    return changed;
  }
  // レイヤー l の n フレーム目で有効なキーフレームを返す（無ければ null）
  function keyframe(l, n) {
    let b = null;
    for (const f of l.FR || []) {
      const start = Number(f.I) || 0,
        end = start + Math.max(1, Number(f.DU) || 1);
      if (start <= n && n < end && (!b || start > Number(b.I))) b = f;
    }
    return b;
  }

  // ============================================================
  // 6. フレームラベル（キーフレームの N = 名前。アニメ名の目印）
  // ============================================================
  // window に公開しているので、他のスクリプトからも呼べる。
  //   frameLabelGet()                : ラベル一覧を返す（メインのタイムラインのみ）
  //   frameLabelSet(frame, name)     : その位置にラベルを付ける（キーが無ければ、前のキーを分割して作る）
  //   frameLabelRemove(layer, frame) : ラベルを削除
  window.frameLabelGet = () => {
    if (!anim) return [];
    let result = [];
    (anim.AN?.TL?.L || []).forEach((layer, li) =>
      (layer.FR || []).forEach((fr) => {
        if (fr.N)
          result.push({
            layer: li,
            layerName: layer.LN || "Layer " + li,
            start: Number(fr.I) || 0,
            name: fr.N,
          });
      }),
    );
    return result.sort((a, b) => a.start - b.start);
  };
  window.frameLabelSet = (frame, name) => {
    if (!anim?.AN?.TL?.L?.length) throw Error("Load Animation.json first");
    let layers = anim.AN.TL.L;
    let hit = null;
    for (let l of layers) {
      hit = (l.FR || []).find((f) => Number(f.I) === frame);
      if (hit) break;
    }
    anCheckpoint();
    if (!hit) {
      let l = layers.find((l) => (l.FR || []).some((f) => f.N)) || layers[0];
      if (!l.FR) l.FR = [];
      let sorted = l.FR.slice().sort((a, b) => Number(a.I) - Number(b.I));
      let next = sorted.find((f) => Number(f.I) > frame);
      let prev = sorted.filter((f) => Number(f.I) < frame).pop();
      if (prev && frame < Number(prev.I) + Number(prev.DU || 1)) {
        let oldEnd = Number(prev.I) + Number(prev.DU || 1);
        prev.DU = frame - Number(prev.I);
        hit = {
          I: frame,
          DU: (next ? Math.min(Number(next.I), oldEnd) : oldEnd) - frame,
          E: JSON.parse(JSON.stringify(prev.E || [])),
        };
      } else {
        hit = { I: frame, DU: next ? Math.max(1, Number(next.I) - frame) : 1, E: [] };
      }
      l.FR.push(hit);
      l.FR.sort((a, b) => Number(a.I) - Number(b.I));
    }
    hit.N = name;
    window.frameLabelRefresh?.();
    updateKeyUI();
    draw();
  };
  window.frameLabelRemove = (layer, frame) => {
    let f = anim?.AN?.TL?.L?.[layer]?.FR?.find((f) => Number(f.I) === frame);
    if (!f?.N) throw Error("Label not found");
    anCheckpoint();
    delete f.N;
    window.frameLabelRefresh?.();
  };

  // ラベル編集パネル(画面側)。refreshIntegratedLabels() が一覧を作り直し、以降の各ボタンが上の3関数を呼ぶ。
  // FrameLabel is now a native panel of AnimateAtlas, sharing the same animation state and history.
  function refreshIntegratedLabels() {
    const list = $("anLabelList");
    if (!list) return;
    const previous = list.value;
    list.replaceChildren();
    for (const x of window.frameLabelGet()) {
      const o = document.createElement("option");
      o.value = x.layer + "|" + x.start;
      o.textContent = x.start + "F · " + x.name + " (" + x.layerName + ")";
      list.append(o);
    }
    if ([...list.options].some((o) => o.value === previous)) list.value = previous;
    const selected = list.selectedOptions[0];
    if (selected) {
      const [layer, frame] = selected.value.split("|").map(Number);
      const x = window.frameLabelGet().find((v) => v.layer === layer && v.start === frame);
      if (x) {
        $("anLabelFrame").value = x.start;
        $("anLabelName").value = x.name;
      }
    }
  }
  window.frameLabelRefresh = refreshIntegratedLabels;
  $("anLabelList").onchange = () => {
    const [layer, frame] = ($("anLabelList").value || "").split("|").map(Number);
    const x = window.frameLabelGet().find((v) => v.layer === layer && v.start === frame);
    if (x) {
      $("anLabelFrame").value = x.start;
      $("anLabelName").value = x.name;
    }
  };
  $("anLabelCurrent").onclick = () => {
    $("anLabelFrame").value = $("frame").value;
  };
  $("anLabelJump").onclick = () => {
    const frame = Number($("anLabelFrame").value);
    if (Number.isFinite(frame)) {
      symbol = "__AN__";
      $("symbol").value = symbol;
      $("timeline").max = Math.max(0, duration(symbol) - 1);
      setFrame(frame);
    }
  };
  $("anLabelSave").onclick = () => {
    try {
      const frame = Number($("anLabelFrame").value),
        name = $("anLabelName").value.trim();
      if (!Number.isInteger(frame) || frame < 0 || !name)
        throw Error("Enter a valid frame and label");
      window.frameLabelSet(frame, name);
      $("anLabelStatus").textContent = "Saved to working Animation.json";
      refreshIntegratedLabels();
    } catch (e) {
      $("anLabelStatus").textContent = e.message;
    }
  };
  $("anLabelDelete").onclick = () => {
    try {
      const value = $("anLabelList").value;
      if (!value) throw Error("Select a label");
      const [layer, frame] = value.split("|").map(Number);
      window.frameLabelRemove(layer, frame);
      $("anLabelStatus").textContent = "Label deleted";
      refreshIntegratedLabels();
    } catch (e) {
      $("anLabelStatus").textContent = e.message;
    }
  };

  // ============================================================
  // 7. 要素の変換行列の読み書き
  // ============================================================
  // matrix(e)         : 要素の変換行列を [a, b, c, d, tx, ty] で返す。MX があればそれ、M3D(16要素)なら必要な6つを取り出す。無ければ単位行列
  // writeMatrix(e, m) : 行列を書き戻す。元が M3D ならM3Dの形のまま、MX なら MX に書く（元の保存形式を変えない）
  // name(e)           : 一覧に表示する要素名（シンボルならその名前、画像なら "Atlas 番号"）
  const matrix = (e) => {
    const o = e?.SI || e?.ASI;
    if (o?.MX) return o.MX;
    if (o?.M3D?.length === 16) {
      const m = o.M3D;
      return [m[0], m[1], m[4], m[5], m[12], m[13]];
    }
    return [1, 0, 0, 1, 0, 0];
  };
  function writeMatrix(e, m) {
    const o = e?.SI || e?.ASI;
    if (!o) return;
    if (o.M3D?.length === 16) {
      const a = o.M3D.slice();
      a[0] = m[0];
      a[1] = m[1];
      a[4] = m[2];
      a[5] = m[3];
      a[12] = m[4];
      a[13] = m[5];
      o.M3D = a;
    } else o.MX = m;
  }
  const name = (e) => e?.SI?.SN || "Atlas " + (e?.ASI?.N ?? "?");
  // 安全装置: レガシー形式のデータをモダン用の編集・書き出し処理に通さないよう、該当ボタンのクリックを先回りして止め、案内を表示する。
  // Legacy data must not pass through modern editing/export handlers.
  const legacyBlockedActions = [
    "export",
    "exportmap",
    "exportpng",
    "restorezip",
    "importpng",
    "apply",
    "reset",
    "front",
    "back",
    "elemfront",
    "elemback",
    "addanim",
    "addsymbol",
    "addpart",
    "addlayer",
    "deleteLayer",
    "unlink",
    "deleteSprite",
    "keyCopy",
    "keyBlank",
    "keyDelete",
    "keyExtend",
    "anLabelSave",
    "anLabelDelete",
    "rotateApply",
    "extractZip",
  ];
  for (const id of legacyBlockedActions) {
    const el = $(id);
    if (el)
      el.addEventListener(
        "click",
        (e) => {
          if (isLegacyAnimate()) {
            e.preventDefault();
            e.stopImmediatePropagation();
            legacyReadOnly();
          }
        },
        true,
      );
  }

  // ============================================================
  // 8. ファイルの読み込み
  // ============================================================
  // 「読み込む」ボタン: PNG・spritemap JSON・Animation.json を読み込み、画面一式を初期化する。
  $("load").onclick = async () => {
    try {
      const p = $("png").files[0],
        m = $("mapfile").files[0],
        a = $("animfile").files[0];
      if (p) {
        pngFileName = p.name || "spritemap1.png";
        img.src = URL.createObjectURL(p);
        await img.decode();
      }
      if (m) map = JSON.parse(await m.text());
      if (a) anim = JSON.parse(await a.text());
      if (!map || !anim || !img.naturalWidth)
        throw Error("3つのファイルをすべて指定してください。");
      // モダン形式なら、最後のキーを終端まで延ばす補正をかける
      if (!isLegacyAnimate()) extendLastVisibleKeys();
      // 新しいファイルを開いたので Undo/Redo 履歴は空にする
      anUndo.length = 0;
      anRedo.length = 0;
      anButtons();
      $("zoom").value = 3;
      // シンボル選択・スプライト一覧のプルダウンを作る
      const opts = animateSymbolOptions();
      $("symbol").innerHTML = opts
        .map((o) => `<option value="${esc(o.name)}">${esc(o.label)}</option>`)
        .join("");
      symbol = "__AN__";
      symbolNavStack.length = 0;
      $("symbol").value = symbol;
      $("sprite").innerHTML = (map.ATLAS.SPRITES || [])
        .map((x) => x.SPRITE)
        .map((s) => `<option value="${esc(s.name)}">${esc(s.name)} — ${s.w}×${s.h}</option>`)
        .join("");
      updateAddSpriteList();
      $("timeline").max = duration(symbol) - 1;
      $("frame").max = $("timeline").max;
      // 読み込み結果（画像サイズ・シンボル数・スプライト数・FPS）を状態欄に表示
      status(
        `読み込み成功\n画像: ${img.naturalWidth}×${img.naturalHeight}\nシンボル: ${isLegacyAnimate() ? legacySymbolList().length : (anim.SD?.S || []).length}\nAtlas sprites: ${(map.ATLAS.SPRITES || []).length}\nFPS: ${anim.MD?.FRT || anim.metadata?.framerate || 24}${isLegacyAnimate() ? "\n旧形式: 専用パネルで編集・保存できます" : ""}`,
      );
      // プレビューの中心を測り直し、画面の各部分を更新する
      centerReady = false;
      resize();
      parts();
      updateKeyUI();
      recenterPreview();
      window.frameLabelRefresh?.();
      legacySelectedLayer = 0;
      legacySelectedElement = 0;
      legacyEditRefresh();
      if (isLegacyAnimate()) {
        $("legacyEditPanel").open = true;
        $("anLabelStatus").textContent = "Legacy AnimateAtlas: edit using the legacy panel";
      }
    } catch (e) {
      status("読み込みエラー: " + e.message);
    }
  };

  // ============================================================
  // 9. プレビュー描画（モダン形式）
  // ============================================================
  // childFrame(si, elapsed, childName): 子シンボルの「何フレーム目を描くか」を返す。
  //   si.FF = 開始フレーム / si.LP = ループ方式（LP=ループ, PO=1回だけ再生して止まる, SF=1フレーム固定）
  function childFrame(si, elapsed, childName) {
    const start = Math.max(0, Number(si.FF) || 0);
    const len = Math.max(1, duration(childName));
    const lp = String(si.LP || "LP").toUpperCase();
    if (lp.includes("SF") || lp.includes("SINGLEFRAME")) return start;
    const raw = start + Math.max(0, elapsed);
    if (lp.includes("PO") || lp.includes("PLAYONCE")) return Math.min(raw, len - 1);
    return raw % len;
  }
  // BTA MX is the element transform. TRP is symbol pivot metadata; it must not be
  // added as an extra translation for every nested symbol.
  // measuringBounds: 自動センタリング用。null 以外のとき、描画した範囲の外接矩形(minX, minY, maxX, maxY)を記録する。
  let measuringBounds = null;
  // シンボル n を fr フレーム目の状態で描画する（子シンボルは再帰で描く。深さ20まで）。
  // レイヤーは配列の末尾から先に描く（＝先頭のレイヤーが一番手前）。
  function drawSymbol(n, fr, depth = 0) {
    if (depth > 20) return;
    const layers = tl(n)?.L || [];
    // FlxAnimate renders layers in reverse list order (back-to-front).
    for (let li = layers.length - 1; li >= 0; li--) {
      const l = layers[li],
        f = keyframe(l, fr);
      if (!f) continue;
      for (const e of f.E || []) {
        const m = matrix(e);
        ctx.save();
        ctx.transform(
          Number(m[0] ?? 1),
          Number(m[1] ?? 0),
          Number(m[2] ?? 0),
          Number(m[3] ?? 1),
          Number(m[4] ?? 0),
          Number(m[5] ?? 0),
        );
        // 要素の種類で分岐: ASI = アトラスから画像を切り出して描く / SI = 子シンボルを再帰で描く
        if (e.ASI) {
          const s = (map.ATLAS.SPRITES || [])
            .map((x) => x.SPRITE)
            .find((x) => String(x.name) === String(e.ASI.N));
          if (s && img.complete) {
            if (measuringBounds) {
              const t = ctx.getTransform(),
                ww = Number(s.rotated ? s.h : s.w) || 0,
                hh = Number(s.rotated ? s.w : s.h) || 0;
              for (const [xx, yy] of [
                [0, 0],
                [ww, 0],
                [0, hh],
                [ww, hh],
              ]) {
                const px = t.a * xx + t.c * yy + t.e,
                  py = t.b * xx + t.d * yy + t.f;
                measuringBounds.minX = Math.min(measuringBounds.minX, px);
                measuringBounds.maxX = Math.max(measuringBounds.maxX, px);
                measuringBounds.minY = Math.min(measuringBounds.minY, py);
                measuringBounds.maxY = Math.max(measuringBounds.maxY, py);
              }
            }
            if (s.rotated) {
              ctx.translate(0, s.w);
              ctx.rotate(-Math.PI / 2);
              ctx.drawImage(img, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
            } else {
              ctx.drawImage(img, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
            }
          }
        } else if (e.SI) {
          const child = e.SI.SN;
          drawSymbol(child, childFrame(e.SI, fr - (f.I || 0), child), depth + 1);
        }
        ctx.restore();
      }
    }
  }
  // ステージの拡大率: 書き出しサイズ(MD.W/H)を canvas に収める倍率 × ズーム欄の値(0.1〜16)
  function stageScale() {
    const bw = Number(anim?.MD?.W) || 1920,
      bh = Number(anim?.MD?.H) || 1080,
      z = Math.max(0.1, Math.min(16, Number($("zoom").value) || 1));
    return Math.min(cv.clientWidth / bw, cv.clientHeight / bh) * z;
  }
  // previewCenter: 自動センタリングで使う中心座標 / centerReady: 中心を計算済みか
  let previewCenter = { x: 0, y: 0 },
    centerReady = false;
  // 現在フレームの描画範囲を測って中心を求め、プレビューをその中心に固定する（パーツの座標自体は変えない）
  function recenterPreview() {
    if (!anim || !map || !img.complete) return;
    const frame = Math.max(0, Number($("frame").value) || 0);
    measuringBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (isLegacyAnimate()) legacyPreviewTimeline(legacyTimelineFor(symbol), frame);
    else drawSymbol(symbol, frame);
    ctx.restore();
    const b = measuringBounds;
    measuringBounds = null;
    if (Number.isFinite(b.minX)) {
      previewCenter = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
      centerReady = true;
    }
    draw();
  }
  // プレビューを1回描画する（毎回 canvas 全体を描き直す）。画面中央を原点にして拡大率を掛け、自動センタリングが ON ならその分ずらす
  function draw() {
    const w = cv.clientWidth,
      h = cv.clientHeight;
    if (!w || !h || !anim || !map || !img.complete) return;
    ctx.clearRect(0, 0, w, h);
    const bw = Number(anim.MD?.W) || 1920,
      bh = Number(anim.MD?.H) || 1080;
    const z = Math.max(0.1, Math.min(16, Number($("zoom").value) || 1)),
      scale = Math.min(w / bw, h / bh) * z;
    const frame = Math.max(0, Number($("frame").value) || 0);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    if ($("autoCenter").checked && centerReady) ctx.translate(-previewCenter.x, -previewCenter.y);
    if (isLegacyAnimate()) legacyPreviewTimeline(legacyTimelineFor(symbol), frame);
    else drawSymbol(symbol, frame);
    ctx.restore();
  }
  // 「自動センタリング」のON/OFFと「中心を固定」ボタン
  $("autoCenter").onchange = draw;
  $("recenter").onclick = () => {
    recenterPreview();
    status("プレビューの中心を現在のフレームで固定しました。パーツの座標は変更されません。");
  };

  // ============================================================
  // 10. シンボルの入れ子ナビゲーション
  // ============================================================
  // symbolNavStack                  : 「親へ戻る」用の履歴 [{symbol, frame}]
  // navSymbol(target, frame, remember): 別のシンボルのタイムラインを開く（remember=true なら戻り先を履歴に積む）
  // renderSymbolNavigation()        : 上部のナビ（編集中の名前・戻るボタン）を作り直す
  // Modern AnimateAtlas: select an instance in the current timeline, then open
  // its referenced Symbol to edit the actual child frames and sprite elements.
  // Never mutate a parent FrameLabel's empty E array to simulate child editing.
  const symbolNavStack = [];
  function navSymbol(target, frame = 0, remember = true) {
    if (isLegacyAnimate()) return;
    if (target !== "__AN__" && !(anim?.SD?.S || []).some((x) => x.SN === target)) {
      status("参照先のSymbolが見つかりません: " + target);
      return;
    }
    if (remember) symbolNavStack.push({ symbol, frame: Number($("frame").value) || 0 });
    symbol = target;
    $("symbol").value = target;
    sel = selKey = null;
    $("timeline").max = Math.max(0, duration(symbol) - 1);
    $("frame").max = $("timeline").max;
    setFrame(Math.min(Math.max(0, frame), duration(symbol) - 1));
    centerReady = false;
    recenterPreview();
    renderSymbolNavigation();
  }
  function renderSymbolNavigation() {
    const bar = $("symbolNav");
    if (!bar) return;
    bar.replaceChildren();
    if (isLegacyAnimate()) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const info = document.createElement("span");
    info.className = "tiny";
    info.textContent =
      (document.documentElement.lang === "en" ? "Editing: " : "編集中: ") +
      (symbol === "__AN__" ? "Main / FrameLabel" : symbol);
    bar.append(info);
    if (symbolNavStack.length) {
      const back = document.createElement("button");
      back.type = "button";
      back.textContent =
        document.documentElement.lang === "en" ? "← Back to parent" : "← 親のタイムラインへ戻る";
      back.onclick = () => {
        const prev = symbolNavStack.pop();
        navSymbol(prev.symbol, prev.frame, false);
      };
      bar.append(back);
    }
    if (symbol !== "__AN__") {
      const root = document.createElement("button");
      root.type = "button";
      root.textContent = document.documentElement.lang === "en" ? "Main timeline" : "メインへ";
      root.onclick = () => {
        symbolNavStack.length = 0;
        navSymbol("__AN__", 0, false);
      };
      bar.append(root);
    }
  }

  // ============================================================
  // 11. 要素一覧（現在フレームに存在する要素）
  // ============================================================
  // parts(): 現在のフレームに存在する要素を全レイヤーから集め、一覧 (#layers) にボタンとして並べる。
  //   各要素の key は「レイヤー番号:キーの開始フレーム:要素番号」。クリックすると選択(sel/selKey)する。
  function parts() {
    const list = [],
      frame = Math.max(0, Number($("frame").value) || 0);
    for (const [li, l] of (tl(symbol)?.L || []).entries()) {
      const f = keyframe(l, frame);
      for (let i = 0; i < (f?.E || []).length; i++)
        list.push({ l, e: f.E[i], key: `${li}:${f.I}:${i}`, f });
    }
    const container = $("layers");
    container.replaceChildren();
    renderSymbolNavigation();
    if (!list.length) {
      const note = document.createElement("div");
      note.className = "tiny";
      note.textContent =
        document.documentElement.lang === "en"
          ? "No direct elements in this frame. Choose a layer with a Symbol instance or open a child Symbol."
          : "このフレームに直接配置された要素はありません。別レイヤーのSymbol参照、または子Symbolを開いて編集してください。";
      container.append(note);
      return;
    }
    for (const x of list) {
      const item = document.createElement("div");
      item.className = "item" + (selKey === x.key ? " active" : "");
      item.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap";
      const pick = document.createElement("button");
      pick.type = "button";
      pick.style.cssText = "flex:1;text-align:left;min-width:140px";
      pick.textContent = `${x.l.LN} · ${name(x.e)} · ${x.f.I}F`;
      // 要素ボタンのクリック: 選択状態にして、行列の入力欄(m0〜m5)に値を入れる
      pick.onclick = () => {
        sel = x;
        selKey = x.key;
        matrix(x.e).forEach((v, i) => ($("m" + i).value = v));
        $("keyLayer").value = String((tl(symbol)?.L || []).indexOf(x.l));
        parts();
        updateKeyUI();
      };
      item.append(pick);
      // シンボル配置の要素には「内部を編集」ボタンも付ける（その子シンボルのタイムラインへ潜る）
      const child = x.e?.SI?.SN;
      if (child && (anim?.SD?.S || []).some((s) => s.SN === child)) {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "primary";
        open.textContent =
          document.documentElement.lang === "en" ? "Edit inside ↳" : "内部を編集 ↳";
        open.onclick = () =>
          navSymbol(child, childFrame(x.e.SI, frame - (Number(x.f.I) || 0), child));
        item.append(open);
      }
      container.append(item);
    }
  }

  // ============================================================
  // 12. キーフレーム操作（フレーム帯とキーの追加・削除・延長）
  // ============================================================
  // updateKeyUI(): キーフレーム関係の画面を更新する。
  //   - レイヤー選択プルダウン（keyLayer / パーツ追加先 partTargetLayer）
  //   - フレーム帯(#keyStrip): ◆ = キーがある位置 / · = ない位置 / 現在のフレームは緑で強調
  function updateKeyUI() {
    const layers = tl(symbol)?.L || [],
      select = $("keyLayer"),
      before = select.value;
    select.innerHTML = layers
      .map((l, i) => `<option value="${i}">${esc(l.LN || "Layer " + i)}</option>`)
      .join("");
    select.value = layers[Number(before)] ? before : "0";
    const targetLayerSelect = $("partTargetLayer");
    if (targetLayerSelect) {
      const prior = targetLayerSelect.value;
      targetLayerSelect.replaceChildren();
      layers.forEach((l, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = l.LN || "Layer " + (i + 1);
        targetLayerSelect.append(opt);
      });
      targetLayerSelect.value = layers[Number(prior)] ? prior : select.value;
    }
    const frame = Math.max(0, Number($("frame").value) || 0);
    const max = Math.min(500, Math.max(duration(symbol) + 8, frame + 8, 24));
    const target = layers[Number(select.value)];
    const starts = new Set((target?.FR || []).map((f) => Number(f.I) || 0));
    const strip = $("keyStrip");
    strip.innerHTML = "";
    for (let i = 0; i < max; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = (starts.has(i) ? "◆" : "·") + "\n" + i;
      b.style.cssText =
        "flex:0 0 37px;white-space:pre-line;padding:5px 2px;font-size:11px;" +
        (i === frame ? "border-color:#57d6a0;background:#214b3c;" : "");
      b.onclick = () => setFrame(i);
      strip.appendChild(b);
    }
  }
  $("keyLayer").onchange = updateKeyUI;
  // キーフレームを編集する。mode:
  //   "copy"   : 直前のキーを複製して現在位置に追加
  //   "blank"  : 空のキー（要素なし）を現在位置に追加
  //   "delete" : 現在位置のキーを削除
  // 追加時は、前のキーの長さを現在位置までに縮め、新しいキーは次のキー（無ければタイムライン末尾）まで続ける。
  function editKey(mode) {
    const layers = tl(symbol)?.L || [];
    if (sel?.l && layers.includes(sel.l)) $("keyLayer").value = String(layers.indexOf(sel.l));
    const layer = layers[Number($("keyLayer").value)];
    if (!layer) {
      status("編集するレイヤーを選択してください。");
      return;
    }
    const at = Math.max(0, Math.floor(Number($("frame").value) || 0));
    layer.FR = layer.FR || [];
    const exact = layer.FR.find((f) => Number(f.I) === at);
    if (mode === "delete") {
      if (!exact) {
        status("この位置には削除できるキーフレームがありません。");
        return;
      }
      if (!confirm("フレーム " + at + " のキーフレームを削除しますか？")) return;
      layer.FR.splice(layer.FR.indexOf(exact), 1);
      sel = selKey = null;
      draw();
      parts();
      updateKeyUI();
      status("キーフレームを削除しました。前のキーフレームの表示範囲に戻る場合があります。");
      return;
    }
    if (exact) {
      status("この位置には既にキーフレームがあります。");
      return;
    }
    const prev = [...layer.FR]
      .filter((f) => Number(f.I) < at)
      .sort((a, b) => Number(b.I) - Number(a.I))[0];
    const next = [...layer.FR]
      .filter((f) => Number(f.I) > at)
      .sort((a, b) => Number(a.I) - Number(b.I))[0];
    const end = next ? Number(next.I) : Math.max(duration(symbol), at + 1);
    const originalEnd = prev ? Number(prev.I) + Math.max(1, Number(prev.DU) || 1) : 0;
    let source = null;
    if (mode === "copy" && prev) source = prev;
    if (mode === "copy" && !source) {
      status(
        "この位置に引き継げる前のキーフレームがありません。空のキーフレームを使ってください。",
      );
      return;
    }
    // 新しいキー: copy なら前のキーの複製（ラベル名 N などは引き継がない）、blank なら空の要素リスト
    const fresh = source ? JSON.parse(JSON.stringify(source)) : { E: [] };
    fresh.I = at;
    fresh.DU = Math.max(1, end - at);
    if (source) {
      delete fresh.N;
      delete fresh.LB;
    }
    if (prev && at < originalEnd) prev.DU = at - Number(prev.I);
    layer.FR.push(fresh);
    layer.FR.sort((a, b) => Number(a.I) - Number(b.I));
    extendLastVisibleKeys();
    sel = selKey = null;
    $("timeline").max = Math.max(duration(symbol) - 1, at);
    $("frame").max = $("timeline").max;
    draw();
    parts();
    updateKeyUI();
    status(
      (mode === "copy" ? "複製" : "空のキーフレーム") +
        "を " +
        at +
        "F に追加しました。Animation JSONを保存してください。",
    );
  }
  $("keyCopy").onclick = () => editKey("copy");
  $("keyBlank").onclick = () => editKey("blank");
  $("keyDelete").onclick = () => editKey("delete");
  // 選択レイヤーの最後のキーを、タイムライン末尾まで延長する
  $("keyExtend").onclick = () => {
    const layers = tl(symbol)?.L || [],
      layer = layers[Number($("keyLayer").value)];
    if (!layer?.FR?.length) {
      status("延長するキーフレームがありません。");
      return;
    }
    const last = [...layer.FR].sort((a, b) => (Number(b.I) || 0) - (Number(a.I) || 0))[0];
    const end = duration(symbol),
      start = Number(last.I) || 0,
      oldEnd = start + Math.max(1, Number(last.DU) || 1);
    if (oldEnd >= end) {
      status("このレイヤーの最後のキーフレームは、すでにタイムライン末尾まで続いています。");
      return;
    }
    last.DU = end - start;
    draw();
    parts();
    updateKeyUI();
    status(
      "「" +
        (layer.LN || "Layer") +
        "」の最後のキーフレームを " +
        (end - 1) +
        "F まで延長しました。Animation JSONを保存してください。",
    );
  };

  // ============================================================
  // 13. フレーム移動・再生・ズーム
  // ============================================================
  // setFrame(v): 表示するフレームを v にする。数値欄とスライダーを同期し、プレビュー・要素一覧・フレーム帯・レガシーパネルを更新する。
  //              （フレームを動かす操作はすべてここを通る）
  function setFrame(v) {
    let n = Math.max(0, Math.floor(Number(v) || 0));
    $("frame").value = n;
    $("timeline").value = n;
    draw();
    parts();
    updateKeyUI();
    legacyEditRefresh();
  }
  // シンボル選択プルダウンの変更: 別のシンボルへ切り替える（0フレーム目へ。ナビ履歴・選択はリセット）
  $("symbol").onchange = () => {
    symbolNavStack.length = 0;
    symbol = $("symbol").value;
    sel = selKey = null;
    $("timeline").max = duration(symbol) - 1;
    $("frame").max = $("timeline").max;
    setFrame(0);
    centerReady = false;
    recenterPreview();
    legacySelectedLayer = 0;
    legacySelectedElement = 0;
    legacyEditRefresh();
  };
  // フレーム番号欄・スライダーの操作
  $("frame").onchange = () => setFrame($("frame").value);
  $("timeline").oninput = () => setFrame($("timeline").value);
  // ズーム: 数値欄（0.1〜16に丸める）/ ＋ − ボタン（×1.25 ずつ）/ 全体表示ボタン（1倍）
  $("zoom").onchange = () => {
    let v = Number($("zoom").value);
    $("zoom").value = Number.isFinite(v) ? Math.max(0.1, Math.min(16, v)) : 1;
    draw();
  };
  $("zoomin").onclick = () => {
    $("zoom").value = Math.min(16, (Number($("zoom").value) || 1) * 1.25).toFixed(2);
    draw();
  };
  $("zoomout").onclick = () => {
    $("zoom").value = Math.max(0.1, (Number($("zoom").value) || 1) / 1.25).toFixed(2);
    draw();
  };
  // 前のフレーム / 次のフレーム
  $("prev").onclick = () => setFrame(+$("frame").value - 1);
  $("next").onclick = () => setFrame(+$("frame").value + 1);
  $("fit").onclick = () => {
    $("zoom").value = 1;
    draw();
  };
  // 再生/一時停止。setTimeout で fps の間隔ごとに次のフレームへ進める。最後まで行ったら 0 に戻る（ループ再生）
  $("play").onclick = () => {
    playing = !playing;
    $("play").textContent = playing ? "⏸ 一時停止" : "▶ 再生";
    if (playing) {
      const tick = () => {
        if (!playing) return;
        let n = +$("frame").value + 1;
        if (n >= duration(symbol)) n = 0;
        setFrame(n);
        timer = setTimeout(tick, 1000 / Math.max(1, +$("fps").value || 24));
      };
      tick();
    } else clearTimeout(timer);
  };

  // ============================================================
  // 14. 要素の編集（回転 / 数値指定 / ドラッグ移動 / 重なり順）
  // ============================================================
  // 選択要素を指定した角度(度)だけ回転する。
  // 行列の回転成分(a,b,c,d)に回転行列を掛けるだけで、位置(tx,ty)と既存の拡大縮小は保つ。正の角度 = 時計回り。
  $("rotateApply").onclick = () => {
    if (!sel) {
      status("回転するパーツを選択してください。");
      return;
    }
    const deg = Number($("rotateAngle").value);
    if (!Number.isFinite(deg)) {
      status("有効な角度を入力してください。");
      return;
    }
    const r = (deg * Math.PI) / 180,
      c = Math.cos(r),
      q = Math.sin(r),
      m = matrix(sel.e).slice();
    // Screen coordinates: positive angles rotate clockwise; negative angles counterclockwise.
    // Pre-multiply the linear portion, preserving translation and existing scaling/shear.
    const a = Number(m[0]),
      b = Number(m[1]),
      cc = Number(m[2]),
      d = Number(m[3]);
    m[0] = c * a - q * b;
    m[1] = q * a + c * b;
    m[2] = c * cc - q * d;
    m[3] = q * cc + c * d;
    writeMatrix(sel.e, m);
    m.forEach((v, i) => ($("m" + i).value = Number(v.toFixed(6))));
    draw();
    status(deg + "° 回転しました。座標・既存の拡大縮小は保持しています。JSONを保存してください。");
  };
  // 数値欄(m0〜m5)の値を、選択要素の変換行列として書き込む
  $("apply").onclick = () => {
    if (!sel) {
      status("先にパーツを選択してください。");
      return;
    }
    anCheckpoint();
    const m = Array.from({ length: 6 }, (_, i) => Number($("m" + i).value) || 0);
    writeMatrix(sel.e, m);
    draw();
    status("変更を適用しました。JSONを書き出して保存してください。");
  };
  // プレビュー上のドラッグで選択要素を移動する。
  //   pointerdown で開始位置を記録 → pointermove で更新 → pointerup/cancel で終了。
  //   画面上の移動量(px) ÷ 拡大率 = モデル座標での移動量。
  // Drag the currently selected direct element on the preview. Coordinates are converted from canvas pixels to BTA local units.
  cv.style.touchAction = "none";
  cv.addEventListener("pointerdown", (e) => {
    if (!sel) return;
    const m = matrix(sel.e);
    dragState = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      tx: Number(m[4]) || 0,
      ty: Number(m[5]) || 0,
      scale: stageScale() || 1,
    };
    cv.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  cv.addEventListener("pointermove", (e) => {
    if (!dragState || dragState.id !== e.pointerId || !sel) return;
    const m = matrix(sel.e).slice();
    m[4] = dragState.tx + (e.clientX - dragState.x) / dragState.scale;
    m[5] = dragState.ty + (e.clientY - dragState.y) / dragState.scale;
    writeMatrix(sel.e, m);
    m.forEach((v, i) => ($("m" + i).value = Number(v.toFixed(3))));
    draw();
  });
  function endDrag(e) {
    if (dragState && dragState.id === e.pointerId) {
      dragState = null;
      status("プレビュー上で位置を調整しました。Animation JSONを保存できます。");
    }
  }
  cv.addEventListener("pointerup", endDrag);
  cv.addEventListener("pointercancel", endDrag);
  // 選択を解除して、行列の入力欄を空にする
  $("reset").onclick = () => {
    sel = selKey = null;
    parts();
    for (let i = 0; i < 6; i++) $("m" + i).value = "";
  };
  // 選択要素のレイヤーを重なり順で移動する。direction = -1 で手前へ、+1 で奥へ（配列の先頭ほど手前に描かれる）
  function reorderLayer(direction) {
    if (!sel) {
      status("先にパーツを選択してください。");
      return;
    }
    const layers = tl(symbol)?.L || [],
      idx = layers.indexOf(sel.l),
      to = idx + direction;
    if (idx < 0 || to < 0 || to >= layers.length) {
      status("これ以上その方向へ移動できません。");
      return;
    }
    // Renderer draws layers in reverse array order; lower index is visually in front.
    const [layer] = layers.splice(idx, 1);
    layers.splice(to, 0, layer);
    parts();
    draw();
    status(
      "レイヤー「" +
        layer.LN +
        "」の描画順を変更しました。前面/背面の見え方をプレビューで確認し、Animation JSONを保存してください。",
    );
  }
  $("front").onclick = () => reorderLayer(-1);
  $("back").onclick = () => reorderLayer(1);
  // 同じキーの中での要素の順番を入れ替える。配列の後ろの要素ほど手前に描かれる（direction = +1 で手前へ）
  function reorderElement(direction) {
    if (!sel) {
      status("先にパーツを選択してください。");
      return;
    }
    const arr = sel.f?.E || [],
      idx = arr.indexOf(sel.e),
      to = idx + direction;
    if (idx < 0 || to < 0 || to >= arr.length) {
      status("同一レイヤー内でこれ以上移動できません。");
      return;
    }
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    sel.e = arr[to];
    parts();
    draw();
    status("同一レイヤー内の要素順を変更しました。");
  }
  $("elemfront").onclick = () => reorderElement(1);
  $("elemback").onclick = () => reorderElement(-1);

  // ============================================================
  // 15. 書き出し（ダウンロード）
  // ============================================================
  // downloadBlob(blob, name): Blob を指定のファイル名でダウンロードさせる
  function downloadBlob(blob, name) {
    const u = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1500);
  }
  // Animation JSON を Animation-edited.json として書き出す（書き出す直前に、最後のキーの延長補正をかける）
  $("export").onclick = () => {
    if (!anim) {
      status("先にファイルを読み込んでください。");
      return;
    }
    const fixed = extendLastVisibleKeys();
    draw();
    parts();
    downloadBlob(
      new Blob([JSON.stringify(anim)], { type: "application/json" }),
      "Animation-edited.json",
    );
    status("Animation JSONを書き出しました。最終キーの表示期間を自動調整: " + fixed + " レイヤー");
  };
  // spritemap JSON を spritemap-edited.json として書き出す
  $("exportmap").onclick = () => {
    if (!map) {
      status("先にファイルを読み込んでください。");
      return;
    }
    downloadBlob(
      new Blob([JSON.stringify(map)], { type: "application/json" }),
      "spritemap-edited.json",
    );
    status("spritemap JSONを書き出しました。");
  };
  // アトラス画像を「元のファイル名-edited.png」として書き出す（canvasに描いてPNG化）
  $("exportpng").onclick = () => {
    if (!img.complete || !img.naturalWidth) {
      status("先にアトラスPNGを読み込んでください。");
      return;
    }
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    c.toBlob((b) => {
      if (b) downloadBlob(b, pngFileName.replace(/\.(png|webp)$/i, "") + "-edited.png");
    }, "image/png");
    status("アトラス画像を書き出しました。");
  };

  // ============================================================
  // 16. シンボル・アニメーション・レイヤーの追加と削除
  // ============================================================
  // uniqueName(base, existing): existing と重ならない名前を返す（被ったら 'base 2', 'base 3' ... と番号を付ける）
  function uniqueName(base, existing) {
    let n = base,
      i = 2;
    while (existing.includes(n)) {
      n = base + " " + i;
      i++;
    }
    return n;
  }
  // シンボル選択プルダウンを作り直し、selectName を選ぶ（無ければメイン）。0フレーム目へ移動する
  function refreshSymbols(selectName) {
    const opts = animateSymbolOptions();
    $("symbol").innerHTML = opts
      .map((o) => `<option value="${esc(o.name)}">${esc(o.label)}</option>`)
      .join("");
    symbol = opts.some((o) => o.name === selectName) ? selectName : "__AN__";
    $("symbol").value = symbol;
    $("timeline").max = Math.max(0, duration(symbol) - 1);
    $("frame").max = $("timeline").max;
    setFrame(0);
  }
  // 選択中のシンボルを複製して追加する（名前は prompt で入力。同名は拒否）
  $("addsymbol").onclick = () => {
    if (!anim) {
      status("先にファイルを読み込んでください。");
      return;
    }
    const srcName = symbol === "__AN__" ? anim.SD?.S?.[0]?.SN : symbol;
    const src = (anim.SD?.S || []).find((x) => x.SN === srcName);
    if (!src) {
      status("複製元のシンボルを選択してください。");
      return;
    }
    const requested = prompt(
      "追加するシンボル名を入力してください",
      uniqueName(
        src.SN + " Copy",
        (anim.SD.S || []).map((x) => x.SN),
      ),
    );
    if (!requested) return;
    const name = requested.trim();
    if (!name) return;
    if ((anim.SD.S || []).some((x) => x.SN === name)) {
      status("同じ名前のシンボルが存在します。");
      return;
    }
    const copy = JSON.parse(JSON.stringify(src));
    copy.SN = name;
    anim.SD.S.push(copy);
    refreshSymbols(name);
    status("シンボルを複製しました: " + name + "。編集後にAnimation JSONを保存してください。");
  };
  // シンボル管理（モダン形式・レガシー形式の両対応。それぞれ元の形式のまま追加・削除する）
  // Symbol management: preserve each original AnimateAtlas schema, including legacy.
  // 表示言語(日本語/English)に合わせて状態欄にメッセージを出す
  function symbolMessage(ja, en) {
    status(document.documentElement.lang === "en" ? en : ja);
  }
  // シンボルの追加・削除のあとの画面更新（選択をリセットして name を表示する）
  function symbolSetSelection(name) {
    sel = selKey = null;
    legacySelectedLayer = 0;
    legacySelectedElement = 0;
    refreshSymbols(name);
    legacyEditRefresh();
    parts();
    draw();
  }
  // シンボル name を配置しているタイムライン名の一覧（＝参照元）を返す。削除してよいかの判定に使う
  function symbolReferences(name) {
    const refs = [];
    if (isLegacyAnimate()) {
      const scan = (t, owner) => {
        for (const layer of t?.LAYERS || [])
          for (const f of layer.Frames || [])
            for (const el of f.elements || [])
              if (el.SYMBOL_Instance?.SYMBOL_name === name) refs.push(owner);
      };
      scan(anim.ANIMATION?.TIMELINE, "Animation");
      for (const s of legacySymbolList())
        if (s.SYMBOL_name !== name) scan(s.TIMELINE, s.SYMBOL_name);
    } else {
      const scan = (t, owner) => {
        for (const layer of t?.L || [])
          for (const f of layer.FR || [])
            for (const e of f.E || []) if ((e.SI || e.ASI)?.SN === name) refs.push(owner);
      };
      scan(anim.AN?.TL, "Animation");
      for (const s of anim.SD?.S || []) if (s.SN !== name) scan(s.TL, s.SN);
    }
    return [...new Set(refs)];
  }
  // シンボルを新規追加(duplicate=false: 空のシンボル)または複製(true)。名前は prompt で入力し、空・"__AN__"・重複は拒否する
  function symbolCreate(duplicate = false) {
    if (!anim) {
      symbolMessage("先にAnimation.jsonを読み込んでください。", "Load Animation.json first.");
      return;
    }
    const legacy = isLegacyAnimate(),
      list = legacy ? legacySymbolList() : anim.SD?.S || [];
    const key = legacy ? "SYMBOL_name" : "SN",
      existing = list.map((x) => x[key]);
    const src = list.find((x) => x[key] === symbol) || list[0];
    if (duplicate && !src) {
      symbolMessage("複製元のSymbolがありません。", "No source Symbol to duplicate.");
      return;
    }
    const initial = uniqueName(duplicate ? src[key] + " Copy" : "New Symbol", existing);
    const input = prompt(
      document.documentElement.lang === "en" ? "Symbol name:" : "Symbol名を入力してください:",
      initial,
    );
    if (input === null) return;
    const n = input.trim();
    if (!n || n === "__AN__" || existing.includes(n)) {
      symbolMessage(
        "Symbol名が空、予約済み、または重複しています。",
        "Symbol name is empty, reserved or already exists.",
      );
      return;
    }
    anCheckpoint();
    let obj;
    if (legacy) {
      obj = duplicate
        ? JSON.parse(JSON.stringify(src))
        : { SYMBOL_name: n, TIMELINE: { LAYERS: [] } };
      obj.SYMBOL_name = n;
      anim.SYMBOL_DICTIONARY.Symbols.push(obj);
    } else {
      obj = duplicate ? JSON.parse(JSON.stringify(src)) : { SN: n, TL: { L: [] } };
      obj.SN = n;
      anim.SD ||= {};
      anim.SD.S ||= [];
      anim.SD.S.push(obj);
    }
    symbolSetSelection(n);
    symbolMessage(
      "Symbol「" + n + "」を追加しました。Animation.jsonを保存してください。",
      'Symbol "' + n + '" added. Export Animation.json to save.',
    );
  }
  // 選択中のシンボルを削除。他から配置(参照)されている間は削除できない（先に配置を消す）。Undo で戻せる
  function symbolDelete() {
    if (!anim || symbol === "__AN__") {
      symbolMessage(
        "削除するSymbolを選択してください。",
        "Select a Symbol to delete (not the main Animation).",
      );
      return;
    }
    const legacy = isLegacyAnimate(),
      list = legacy ? legacySymbolList() : anim.SD?.S || [],
      key = legacy ? "SYMBOL_name" : "SN";
    const index = list.findIndex((x) => x[key] === symbol);
    if (index < 0) return;
    const refs = symbolReferences(symbol);
    if (refs.length) {
      symbolMessage(
        "削除できません。参照中: " + refs.join(", ") + "。先に配置を削除してください。",
        "Cannot delete: referenced by " + refs.join(", ") + ". Remove those instances first.",
      );
      return;
    }
    const msg =
      document.documentElement.lang === "en"
        ? 'Delete Symbol "' + symbol + '"? This cannot be undone except with Undo.'
        : "Symbol「" + symbol + "」を削除しますか？ Undoで元に戻せます。";
    if (!confirm(msg)) return;
    const removed = symbol;
    anCheckpoint();
    list.splice(index, 1);
    symbolSetSelection("__AN__");
    symbolMessage("Symbol「" + removed + "」を削除しました。", 'Symbol "' + removed + '" deleted.');
  }
  $("newSymbol").onclick = () => symbolCreate(false);
  $("deleteSymbol").onclick = symbolDelete;
  $("legacyNewSymbol").onclick = () => symbolCreate(false);
  $("legacyCloneSymbol").onclick = () => symbolCreate(true);
  $("legacyDeleteSymbol").onclick = symbolDelete;
  // 新しいアニメーションを追加する。メインタイムラインの末尾に次の2つのキーを作る:
  //   1. ラベル用キー … N = アニメーション名（ラベル。ゲーム側でアニメ名として参照される）
  //   2. 配置用キー   … 選んだシンボルを配置（SI）
  $("addanim").onclick = () => {
    if (!anim) {
      status("先にファイルを読み込んでください。");
      return;
    }
    const layers = anim.AN?.TL?.L || [];
    if (!layers.length) {
      status("メインタイムラインのレイヤーがありません。");
      return;
    }
    const symbolNames = (anim.SD?.S || []).map((x) => x.SN);
    if (!symbolNames.length) {
      status("配置できるシンボルがありません。");
      return;
    }
    const nm = prompt("新しいアニメーション名（例: Hey）", "New Animation");
    if (!nm || !nm.trim()) return;
    const label = nm.trim();
    const labels = layers.flatMap((l) => (l.FR || []).map((f) => f.N).filter(Boolean));
    if (labels.includes(label)) {
      status("同じアニメーション名のラベルが存在します。");
      return;
    }
    let chosen = prompt(
      "使用するシンボル名を入力してください:\n" + symbolNames.join(", "),
      symbol !== "__AN__" ? symbol : symbolNames[0],
    );
    if (!chosen) return;
    if (!symbolNames.includes(chosen)) {
      status("そのシンボル名は見つかりません。");
      return;
    }
    const nameLayer = layers.find((l) => (l.FR || []).some((f) => f.N)) || layers[0];
    const frameLayer =
      layers.find((l) => (l.FR || []).some((f) => (f.E || []).some((e) => e.SI))) ||
      layers[layers.length - 1];
    let end = 0;
    for (const l of layers)
      for (const f of l.FR || []) end = Math.max(end, (Number(f.I) || 0) + (Number(f.DU) || 1));
    const du = Math.max(1, duration(chosen));
    const labelFrame = { I: end, DU: du, N: label, E: [] };
    nameLayer.FR = nameLayer.FR || [];
    nameLayer.FR.push(labelFrame);
    nameLayer.FR.sort((a, b) => (a.I || 0) - (b.I || 0));
    const placement = {
      I: end,
      DU: du,
      E: [
        {
          SI: { SN: chosen, FF: 0, ST: "G", TRP: { x: 0, y: 0 }, LP: "LP", MX: [1, 0, 0, 1, 0, 0] },
        },
      ],
    };
    frameLayer.FR = frameLayer.FR || [];
    frameLayer.FR.push(placement);
    frameLayer.FR.sort((a, b) => (a.I || 0) - (b.I || 0));
    refreshSymbols("__AN__");
    setFrame(end);
    status(
      "メインタイムライン末尾にアニメーション「" +
        label +
        "」を追加しました。ラベルと配置フレームを確認して保存してください。",
    );
  };
  // 選択レイヤーを削除。消えるキーフレーム数・配置数・アニメラベルを警告に出し、確認してから実行する
  $("deleteLayer").onclick = () => {
    if (!anim) {
      status("先にファイルを読み込んでください。");
      return;
    }
    const layers = tl(symbol)?.L || [];
    const index = Number($("keyLayer").value),
      layer = layers[index];
    if (!layer) {
      status("削除するレイヤーを選択してください。");
      return;
    }
    const frames = layer.FR || [],
      labels = frames.filter((f) => f.N).map((f) => f.N),
      elements = frames.reduce((n, f) => n + (f.E || []).length, 0);
    let message =
      "レイヤー「" +
      (layer.LN || "Layer " + index) +
      "」を削除しますか？\nキーフレーム: " +
      frames.length +
      " / パーツ配置: " +
      elements;
    if (labels.length)
      message +=
        "\n\n⚠ アニメーションラベル " + labels.length + " 個が消えます: " + labels.join(", ");
    if (elements) message += "\n⚠ 配置済みパーツもすべて消えます。";
    if (!confirm(message)) return;
    anCheckpoint();
    layers.splice(index, 1);
    sel = selKey = null;
    $("keyLayer").value = String(Math.min(index, layers.length - 1));
    $("timeline").max = Math.max(0, duration(symbol) - 1);
    $("frame").max = $("timeline").max;
    setFrame(Math.min(Number($("frame").value) || 0, duration(symbol) - 1));
    window.frameLabelRefresh?.();
    status("レイヤーを削除しました。Undoで元に戻せます。");
  };
  // 新しいレイヤーを先頭（＝一番手前）に追加する（名前は prompt で入力。同名は拒否）
  $("addlayer").onclick = () => {
    if (!anim) {
      status("先にファイルを読み込んでください。");
      return;
    }
    const t = tl(symbol);
    if (!t) {
      status("タイムラインが見つかりません。");
      return;
    }
    const layers = t.L || (t.L = []);
    const name = prompt("新しいレイヤー名", "Layer " + (layers.length + 1));
    if (!name || !name.trim()) return;
    if (layers.some((l) => l.LN === name.trim())) {
      status("同じ名前のレイヤーがあります。");
      return;
    }
    layers.unshift({ LN: name.trim(), FR: [] });
    parts();
    draw();
    status("レイヤーを追加しました。");
  };

  // ============================================================
  // 17. スプライト（アトラス画像）の一覧と配置
  // ============================================================
  // extractSelection: 「切り出し」対象として選択中のスプライト名の集合
  // spriteCanvas(sp): アトラスから sp の範囲だけを切り出した canvas を返す（サムネイル表示・再配置に使う）
  const extractSelection = new Set();
  function spriteCanvas(sp) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, sp.w);
    c.height = Math.max(1, sp.h);
    c.getContext("2d").drawImage(img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
    return c;
  }
  // スプライトのサムネイル一覧を作る。
  //   selectMode = "add"     : 1つ選ぶ（配置するパーツの選択）
  //   selectMode = "extract" : チェックで複数選ぶ（切り出し対象）
  function spriteGrid(containerId, selectMode) {
    const host = $(containerId);
    host.replaceChildren();
    if (!map || !img.complete) return;
    for (const sp of (map.ATLAS?.SPRITES || []).map((x) => x.SPRITE).filter(Boolean)) {
      const tile = document.createElement("div");
      tile.className = "sprite-tile";
      const selected =
        selectMode === "add"
          ? $("addSprite").value === String(sp.name)
          : extractSelection.has(String(sp.name));
      if (selected) tile.classList.add("selected");
      const preview = spriteCanvas(sp);
      tile.appendChild(preview);
      const caption = document.createElement("span");
      caption.textContent = sp.name + " (" + sp.w + "×" + sp.h + ")";
      tile.appendChild(caption);
      if (selectMode === "extract") {
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = selected;
        check.tabIndex = -1;
        tile.appendChild(check);
      }
      tile.onclick = () => {
        if (selectMode === "add") {
          $("addSprite").value = String(sp.name);
          updateAddSpriteInfo();
          spriteGrid("addSpriteGrid", "add");
        } else {
          if (extractSelection.has(String(sp.name))) extractSelection.delete(String(sp.name));
          else extractSelection.add(String(sp.name));
          spriteGrid("extractGrid", "extract");
        }
      };
      host.appendChild(tile);
    }
  }
  function refreshSpriteGrids() {
    spriteGrid("addSpriteGrid", "add");
    spriteGrid("extractGrid", "extract");
  }
  // 「配置するスプライト」のプルダウンとサムネイル一覧を作り直す（選択中のものは可能なら保持）
  function updateAddSpriteList() {
    const selected = $("addSprite").value;
    const sprites = (map?.ATLAS?.SPRITES || []).map((x) => x.SPRITE).filter(Boolean);
    $("addSprite").innerHTML =
      '<option value="">スプライトを選択...</option>' +
      sprites
        .map((sp) => `<option value="${esc(sp.name)}">${esc(sp.name)} (${sp.w}×${sp.h})</option>`)
        .join("");
    $("addSprite").value = sprites.some((sp) => String(sp.name) === selected) ? selected : "";
    updateAddSpriteInfo();
    refreshSpriteGrids();
  }
  // 選択中のスプライト名とサイズを案内欄に表示
  function updateAddSpriteInfo() {
    const sp = (map?.ATLAS?.SPRITES || [])
      .map((x) => x.SPRITE)
      .find((x) => String(x?.name) === $("addSprite").value);
    $("addSpriteInfo").textContent = sp
      ? "選択中: " + sp.name + " / " + sp.w + "×" + sp.h + "px"
      : "追加するパーツをリストから選択してください。";
  }
  $("addSprite").onchange = () => {
    updateAddSpriteInfo();
    spriteGrid("addSpriteGrid", "add");
  };
  // 選んだスプライトを、現在のフレームに要素として配置する。
  //   追加先レイヤー → そのフレームのキー（無ければ新規作成）→ 座標を prompt で聞いて { ASI: { N, MX } } を追加
  $("addpart").onclick = () => {
    if (!anim || !map) {
      status("先にファイルを読み込んでください。");
      return;
    }
    const chosen = $("addSprite").value;
    if (!chosen) {
      status("追加するパーツをリストから選択してください。");
      return;
    }
    const sprite = (map.ATLAS.SPRITES || [])
      .map((x) => x.SPRITE)
      .find((x) => String(x.name) === chosen);
    if (!sprite) {
      status("選択したスプライトが見つかりません。");
      return;
    }
    const t = tl(symbol);
    if (!t?.L?.length) {
      status("現在のタイムラインにレイヤーがありません。");
      return;
    }
    let layer = t.L[Number($("partTargetLayer")?.value)] || sel?.l || t.L[0];
    let frame = keyframe(layer, Math.max(0, Number($("frame").value) || 0));
    if (!frame) {
      const at = Math.max(0, Number($("frame").value) || 0);
      frame = { I: at, DU: 1, E: [] };
      layer.FR = layer.FR || [];
      layer.FR.push(frame);
      layer.FR.sort((a, b) => (a.I || 0) - (b.I || 0));
    }
    frame.E = frame.E || [];
    const x = Number(prompt("配置X座標", "0"));
    if (!Number.isFinite(x)) {
      return;
    }
    const y = Number(prompt("配置Y座標", "0"));
    if (!Number.isFinite(y)) return;
    anCheckpoint();
    frame.E.push({ ASI: { N: String(sprite.name), MX: [1, 0, 0, 1, x, y] } });
    extendLastVisibleKeys();
    sel = selKey = null;
    draw();
    parts();
    status(
      "スプライト「" +
        sprite.name +
        "」をフレームに配置しました。必要ならMXを調整してAnimation JSONを保存してください。",
    );
  };

  // ============================================================
  // 18. スプライトの参照チェックと、配置の解除
  // ============================================================
  // allTimelines()            : メインと全シンボルのタイムラインを [{ name, tl }] で返す
  // spriteReferences(name)    : そのスプライトを使っているタイムライン名の一覧（空 = 未使用）
  // removeAllSpriteReferences : 全タイムラインから、そのスプライトを使う要素をすべて取り除く（件数を返す）
  function allTimelines() {
    const out = [];
    if (anim?.AN?.TL)
      out.push({ name: "Animation: " + (anim.AN.SN || anim.AN.N || "Main"), tl: anim.AN.TL });
    for (const sym of anim?.SD?.S || [])
      if (sym?.TL) out.push({ name: "Symbol: " + sym.SN, tl: sym.TL });
    return out;
  }
  function spriteReferences(spriteName) {
    const refs = [];
    for (const entry of allTimelines()) {
      let found = false;
      for (const layer of entry.tl.L || [])
        for (const frame of layer.FR || [])
          for (const el of frame.E || []) {
            if (el.ASI && String(el.ASI.N) === String(spriteName)) found = true;
          }
      if (found) refs.push(entry.name);
    }
    return refs;
  }
  // parts-manager.js(パーツ管理パネル)から呼べるように window に公開
  window.__fsGetRefs = spriteReferences;
  function removeAllSpriteReferences(spriteName) {
    let removed = 0;
    for (const entry of allTimelines())
      for (const layer of entry.tl.L || [])
        for (const frame of layer.FR || []) {
          if (!Array.isArray(frame.E)) continue;
          for (let i = frame.E.length - 1; i >= 0; i--) {
            const el = frame.E[i];
            if (el?.ASI && String(el.ASI.N) === String(spriteName)) {
              frame.E.splice(i, 1);
              removed++;
            }
          }
        }
    return removed;
  }
  // 「この画像の配置をすべて解除」ボタン用（ボタンは parts-manager.js が作る）。確認ダイアログのあと全配置を取り除く。Undo 可
  window.__fsUnlinkAllSprite = () => {
    if (!anim || !map) {
      status("先にAnimation JSONとAtlasを読み込んでください。");
      return;
    }
    const spriteName = $("sprite").value;
    if (!spriteName) {
      status("Atlas画像を選択してください。");
      return;
    }
    const refs = spriteReferences(spriteName);
    if (!refs.length) {
      status("「" + spriteName + "」は未使用です。Atlasから削除できます。");
      return;
    }
    if (
      !confirm(
        "「" +
          spriteName +
          "」を参照する全フレームから配置を解除します。\n対象: " +
          refs.join(" / ") +
          "\nアニメーションの見た目が変わります。元に戻すにはUndoを使えます。続行しますか？",
      )
    )
      return;
    anCheckpoint();
    const count = removeAllSpriteReferences(spriteName);
    sel = selKey = null;
    draw();
    parts();
    updateKeyUI();
    $("partsUsage") &&
      ($("partsUsage").textContent =
        "参照を" + count + "件解除しました。Animation JSONを保存してください。");
    status(
      "「" +
        spriteName +
        "」の配置を" +
        count +
        "件解除しました。次に「Atlasから削除」を押してください。Animation JSONも保存してください。",
    );
    // 「fs-asset-mutated」イベントで、未保存インジケーター(parts-manager.js)に変更があったことを知らせる
    document.dispatchEvent(new CustomEvent("fs-asset-mutated"));
  };

  // 選択中の要素1つを、現在のキーから外す（アトラス画像やスプライト定義は残る）
  $("unlink").onclick = () => {
    if (!sel || !sel.f || !Array.isArray(sel.f.E)) {
      status("解除する要素を先に選択してください。");
      return;
    }
    const at = sel.f.E.indexOf(sel.e);
    if (at < 0) {
      status("選択要素が現在のフレーム内に見つかりません。");
      return;
    }
    const label = name(sel.e);
    anCheckpoint();
    sel.f.E.splice(at, 1);
    sel = null;
    selKey = null;
    draw();
    parts();
    status(
      "「" +
        label +
        "」を現在のフレームから解除しました。Atlas画像・スプライト定義は残っています。Animation JSONを保存してください。",
    );
  };

  // ============================================================
  // 19. アトラスの再構築（スプライトの削除）
  // ============================================================
  // スプライトの削除は「残すスプライトだけを新しいアトラスへ詰め直す」ことで行う。手順:
  //   1. 残すスプライトを、元の PNG から1つずつ切り出す
  //   2. 左上から右へ並べ、はみ出したら次の行へ（各スプライトの周囲に1pxの余白。幅は面積から見積もり、最大4096・64の倍数）
  //   3. 新しい PNG と、座標を更新した spritemap JSON を作り、img / map を差し替える
  //   4. 新しい PNG と JSON をダウンロードする（この2つはセットで保存する）
  // 回転済み(rotated)のスプライトが残る場合は、回転情報を保てないので再構築せず中止する。
  //
  // 下は「未使用パーツを一括削除」ボタン（#deleteSprite の隣に JS で追加）。
  // Bulk cleanup checks references independently for each atlas entry.
  const bulkDelete = document.createElement("button");
  bulkDelete.id = "deleteAllUnusedSprites";
  bulkDelete.textContent = "未使用パーツを一括削除";
  bulkDelete.setAttribute("data-ja", "未使用パーツを一括削除");
  bulkDelete.setAttribute("data-en", "Delete all unused sprites");
  $("deleteSprite").after(bulkDelete);
  // 使われていないスプライトをすべて削除して、アトラスを再構築する
  bulkDelete.onclick = async () => {
    if (!map || !img.complete || !img.naturalWidth) {
      status("Atlas PNGとspritemap JSONを読み込んでください。");
      return;
    }
    const all = map.ATLAS?.SPRITES || [];
    const unused = all.filter((x) => x.SPRITE && !spriteReferences(x.SPRITE.name).length);
    const kept = all.filter((x) => !x.SPRITE || spriteReferences(x.SPRITE.name).length);
    if (!unused.length) {
      status("削除できる未使用パーツはありません。使用中のパーツは保持します。");
      return;
    }
    if (kept.some((x) => x.SPRITE?.rotated)) {
      status(
        "未使用パーツは" +
          unused.length +
          "個ありますが、使用中の回転済みパーツが残っています。現在の再配置処理では回転情報を保持できないため、Atlasは変更していません。",
      );
      return;
    }
    if (
      !confirm(
        "未使用パーツ " +
          unused.length +
          " 個をAtlasから削除します。使用中の " +
          kept.length +
          " 個は保持します。続行しますか？",
      )
    )
      return;
    try {
      // 手順1: 残すスプライトを元の画像から切り出す
      const entries = kept
        .filter((x) => x.SPRITE)
        .map((x) => {
          const sp = x.SPRITE,
            c = document.createElement("canvas");
          c.width = sp.w;
          c.height = sp.h;
          c.getContext("2d").drawImage(img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
          return { original: x, canvas: c, w: sp.w, h: sp.h };
        });
      // 手順2: 詰め直しの配置を計算（行ごとに左から並べ、はみ出したら次の行）
      const area = entries.reduce((a, x) => a + (x.w + 2) * (x.h + 2), 0);
      const maxW = entries.length ? Math.max(...entries.map((x) => x.w)) : 1;
      let atlasW = entries.length
        ? Math.max(maxW, Math.min(4096, Math.ceil(Math.sqrt(area) * 1.35)))
        : 1;
      atlasW = Math.ceil(atlasW / 64) * 64;
      let x = 0,
        y = 0,
        rowH = 0;
      for (const en of entries) {
        if (x + en.w + 2 > atlasW) {
          x = 0;
          y += rowH + 2;
          rowH = 0;
        }
        en.x = x + 1;
        en.y = y + 1;
        x += en.w + 2;
        rowH = Math.max(rowH, en.h);
      }
      const atlasH = entries.length ? Math.max(1, y + rowH + 2) : 1;
      const canvas = document.createElement("canvas");
      canvas.width = atlasW;
      canvas.height = atlasH;
      const ctx = canvas.getContext("2d");
      for (const en of entries) ctx.drawImage(en.canvas, en.x, en.y);
      // 手順3: 新しい spritemap を作る（座標を更新し、rotated は false）
      const next = JSON.parse(JSON.stringify(map));
      next.ATLAS.SPRITES = entries.map((en) => {
        const entry = JSON.parse(JSON.stringify(en.original));
        Object.assign(entry.SPRITE, { x: en.x, y: en.y, rotated: false });
        return entry;
      });
      if (next.meta) {
        next.meta.image = "spritemap1-edited.png";
        next.meta.size = { w: atlasW, h: atlasH };
      }
      // 新しい PNG を作って読み込み、img / map を差し替える
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw Error("PNG生成に失敗しました");
      const newImage = new Image(),
        url = URL.createObjectURL(blob);
      newImage.src = url;
      try {
        await newImage.decode();
      } catch (err) {
        URL.revokeObjectURL(url);
        throw err;
      }
      anCheckpoint();
      const old = img;
      img = newImage;
      map = next;
      pngFileName = "spritemap1-edited.png";
      $("sprite").innerHTML = entries
        .map(
          (en) =>
            `<option value="${esc(en.original.SPRITE.name)}">${esc(en.original.SPRITE.name)} — ${en.w}×${en.h}</option>`,
        )
        .join("");
      updateAddSpriteList();
      draw();
      parts();
      // 手順4: 新しい PNG と JSON をダウンロード
      downloadBlob(blob, "spritemap1-edited.png");
      downloadBlob(
        new Blob([JSON.stringify(next)], { type: "application/json" }),
        "spritemap-edited.json",
      );
      if (old.src.startsWith("blob:")) URL.revokeObjectURL(old.src);
      document.dispatchEvent(new CustomEvent("fs-asset-mutated"));
      status(
        "未使用パーツを" +
          unused.length +
          "個削除しました。使用中の" +
          entries.length +
          "個は保持しました。PNGとspritemap JSONを両方保存してください。",
      );
    } catch (err) {
      status("一括削除エラー: " + err.message);
    }
  };
  // 選択中のスプライト1つをアトラスから削除し、残りを詰め直す（手順は上と同じ）。どこかで使われている間は削除できない
  $("deleteSprite").onclick = async () => {
    if (!map || !img.complete || !img.naturalWidth) {
      status("先にAtlas PNGとspritemap JSONを読み込んでください。");
      return;
    }
    const spriteName = $("sprite").value;
    const list = map.ATLAS?.SPRITES || [];
    const index = list.findIndex((x) => String(x.SPRITE?.name) === String(spriteName));
    if (index < 0) {
      status("削除するスプライトを選択してください。");
      return;
    }
    const refs = spriteReferences(spriteName);
    if (refs.length) {
      status(
        "削除できません。「" +
          spriteName +
          "」は次の場所から参照されています:\\n" +
          refs.join("\\n") +
          "\\n先に該当する要素を各タイムラインから解除してください。",
      );
      return;
    }
    const remainingSprites = list.filter((_, i) => i !== index);
    if (remainingSprites.some((x) => x.SPRITE?.rotated)) {
      status(
        "削除後も回転済みスプライトが残るため、安全な再配置に未対応です。残る回転済みパーツを処理できるまでは再構築を中止します。",
      );
      return;
    }
    if (
      !confirm(
        "未使用スプライト「" +
          spriteName +
          "」をAtlasから削除し、残りのスプライトを再配置します。続行しますか？",
      )
    )
      return;
    anCheckpoint();
    try {
      const remain = list
        .filter((_, i) => i !== index)
        .map((x) => x.SPRITE)
        .filter(Boolean);
      const entries = remain.map((sp) => {
        const c = document.createElement("canvas");
        c.width = sp.w;
        c.height = sp.h;
        c.getContext("2d").drawImage(img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
        return { name: String(sp.name), w: sp.w, h: sp.h, canvas: c };
      });
      const area = entries.reduce((a, x) => a + (x.w + 2) * (x.h + 2), 0);
      const maxW = entries.length ? Math.max(...entries.map((x) => x.w)) : 1;
      let atlasW = entries.length
        ? Math.max(maxW, Math.min(4096, Math.ceil(Math.sqrt(area) * 1.35)))
        : 1;
      atlasW = Math.ceil(atlasW / 64) * 64;
      let x = 0,
        y = 0,
        rowH = 0;
      for (const en of entries) {
        if (x + en.w + 2 > atlasW) {
          x = 0;
          y += rowH + 2;
          rowH = 0;
        }
        en.x = x + 1;
        en.y = y + 1;
        x += en.w + 2;
        rowH = Math.max(rowH, en.h);
      }
      const atlasH = entries.length ? Math.max(1, y + rowH + 2) : 1;
      const canvas = document.createElement("canvas");
      canvas.width = atlasW;
      canvas.height = atlasH;
      const c = canvas.getContext("2d");
      for (const en of entries) c.drawImage(en.canvas, en.x, en.y);
      const next = JSON.parse(JSON.stringify(map));
      next.ATLAS.SPRITES = entries.map((en) => ({
        SPRITE: { name: en.name, x: en.x, y: en.y, w: en.w, h: en.h, rotated: false },
      }));
      next.meta = next.meta || {};
      next.meta.image = "spritemap1-edited.png";
      next.meta.size = { w: atlasW, h: atlasH };
      next.meta.format = "RGBA8888";
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw Error("再構築PNGを生成できませんでした。");
      const old = img;
      img = new Image();
      img.src = URL.createObjectURL(blob);
      await img.decode();
      map = next;
      pngFileName = "spritemap1-edited.png";
      $("sprite").innerHTML = entries
        .map((en) => `<option value="${esc(en.name)}">${esc(en.name)} — ${en.w}×${en.h}</option>`)
        .join("");
      updateAddSpriteList();
      if (sel?.e?.ASI && String(sel.e.ASI.N) === String(spriteName)) {
        sel = null;
        selKey = null;
      }
      draw();
      parts();
      downloadBlob(blob, "spritemap1-edited.png");
      downloadBlob(
        new Blob([JSON.stringify(map)], { type: "application/json" }),
        "spritemap-edited.json",
      );
      URL.revokeObjectURL(old.src);
      status(
        "スプライト「" +
          spriteName +
          "」をAtlasから削除しました。\\n残り: " +
          entries.length +
          " 個\\n新しいAtlasサイズ: " +
          atlasW +
          "×" +
          atlasH +
          "\\nPNGとspritemap JSONを保存しました。",
      );
    } catch (err) {
      status("スプライト削除エラー: " + err.message);
    }
  };

  // ============================================================
  // 20. PNG画像の追加と、ZIPでの書き出し・復元
  // ============================================================
  // PNG追加: 既存のスプライトと、追加したPNGをすべて新しいアトラスへ詰め直す。
  //   追加PNGの名前はファイル名から付ける（重複したら番号を付ける）。回転済みスプライトがあれば中止。
  //   新しい PNG と JSON をダウンロードする。
  $("importpng").onclick = async () => {
    if (!map || !img.complete || !img.naturalWidth) {
      status("先に元のPNGとspritemap JSONを読み込んでください。");
      return;
    }
    const files = [...$("addpngfiles").files];
    if (!files.length) {
      status("追加するPNG画像を選択してください。");
      return;
    }
    try {
      const oldSprites = (map.ATLAS?.SPRITES || []).map((x) => x.SPRITE).filter(Boolean);
      const entries = [];
      // Existing sprites are copied into separate canvases; this build supports the normal non-rotated BTA entries.
      for (const sp of oldSprites) {
        if (sp.rotated)
          throw Error(
            "回転済みスプライト「" +
              sp.name +
              "」が含まれています。安全のため再構築を中止しました。",
          );
        const c = document.createElement("canvas");
        c.width = sp.w;
        c.height = sp.h;
        c.getContext("2d").drawImage(img, sp.x, sp.y, sp.w, sp.h, 0, 0, sp.w, sp.h);
        entries.push({ name: String(sp.name), canvas: c, w: sp.w, h: sp.h, existing: true });
      }
      const used = new Set(entries.map((x) => x.name));
      for (const file of files) {
        if (!/^image\/(png|webp)$/.test(file.type)) continue;
        const im = new Image();
        im.src = URL.createObjectURL(file);
        await im.decode();
        let base = file.name.replace(/\.[^.]+$/, "").trim() || "new-sprite",
          name = base,
          i = 2;
        while (used.has(name)) {
          name = base + " " + i++;
        }
        used.add(name);
        const c = document.createElement("canvas");
        c.width = im.naturalWidth;
        c.height = im.naturalHeight;
        c.getContext("2d").drawImage(im, 0, 0);
        entries.push({ name, canvas: c, w: c.width, h: c.height, existing: false });
        URL.revokeObjectURL(im.src);
      }
      if (entries.length === oldSprites.length) {
        status("追加できるPNG画像がありませんでした。");
        return;
      }
      const area = entries.reduce((a, x) => a + (x.w + 2) * (x.h + 2), 0),
        maxW = Math.max(...entries.map((x) => x.w));
      let atlasW = Math.max(maxW, Math.min(4096, Math.ceil(Math.sqrt(area) * 1.35)));
      atlasW = Math.ceil(atlasW / 64) * 64;
      let x = 0,
        y = 0,
        rowH = 0;
      for (const en of entries) {
        if (x + en.w > atlasW) {
          x = 0;
          y += rowH + 2;
          rowH = 0;
        }
        en.x = x + 1;
        en.y = y + 1;
        x += en.w + 2;
        rowH = Math.max(rowH, en.h);
      }
      const atlasH = Math.max(1, y + rowH + 2),
        out = document.createElement("canvas");
      out.width = atlasW;
      out.height = atlasH;
      const oc = out.getContext("2d");
      for (const en of entries) oc.drawImage(en.canvas, en.x, en.y);
      const next = JSON.parse(JSON.stringify(map));
      next.ATLAS.SPRITES = entries.map((en) => ({
        SPRITE: { name: en.name, x: en.x, y: en.y, w: en.w, h: en.h, rotated: false },
      }));
      next.meta = next.meta || {};
      next.meta.image = "spritemap1-edited.png";
      next.meta.size = { w: atlasW, h: atlasH };
      next.meta.format = "RGBA8888";
      const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
      if (!blob) throw Error("PNGの生成に失敗しました。");
      map = next;
      const old = img;
      img = new Image();
      img.src = URL.createObjectURL(blob);
      await img.decode();
      pngFileName = "spritemap1-edited.png";
      $("sprite").innerHTML = entries
        .map((en) => `<option value="${esc(en.name)}">${esc(en.name)} — ${en.w}×${en.h}</option>`)
        .join("");
      updateAddSpriteList();
      downloadBlob(blob, "spritemap1-edited.png");
      downloadBlob(
        new Blob([JSON.stringify(map)], { type: "application/json" }),
        "spritemap-edited.json",
      );
      draw();
      status(
        `アトラスを再構築しました。\n既存パーツ: ${oldSprites.length}\n追加パーツ: ${entries.length - oldSprites.length}\n新しいサイズ: ${atlasW}×${atlasH}\nPNGとspritemap JSONを保存しました。Animation JSON内で追加パーツを使うには、スプライト一覧から配置してAnimation JSONも保存してください。`,
      );
      URL.revokeObjectURL(old.src);
    } catch (err) {
      status("PNG追加エラー: " + err.message);
    }
  };

  // ============================================================
  // ZIP の読み書き（外部ライブラリなし）
  // ============================================================
  // readZip(file) : ZIP を読み、{ ファイル名 → バイト列 } の Map を返す。対応するのは無圧縮(0)と DEFLATE(8)のみ。
  //                 ZIP の構造を、ファイル末尾の終端レコード → 中央ディレクトリ → 各ファイルのローカルヘッダー の順にたどる。
  //                 「..」や「/」始まりのパスは拒否する（安全対策）。
  // ZIP reader: supports ordinary ZIP archives using stored or DEFLATE entries.
  // Uses the browser's native DecompressionStream, so no external library is required.
  async function readZip(file) {
    const b = await file.arrayBuffer(),
      v = new DataView(b),
      u8 = new Uint8Array(b);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw Error("ZIPの終了レコードが見つかりません。");
    const count = v.getUint16(eocd + 10, true),
      cdOff = v.getUint32(eocd + 16, true),
      out = new Map();
    let pos = cdOff;
    for (let i = 0; i < count; i++) {
      if (v.getUint32(pos, true) !== 0x02014b50) throw Error("ZIP中央ディレクトリが不正です。");
      const method = v.getUint16(pos + 10, true),
        csize = v.getUint32(pos + 20, true),
        nlen = v.getUint16(pos + 28, true),
        elen = v.getUint16(pos + 30, true),
        clen = v.getUint16(pos + 32, true),
        lo = v.getUint32(pos + 42, true);
      const name = new TextDecoder().decode(u8.slice(pos + 46, pos + 46 + nlen));
      pos += 46 + nlen + elen + clen;
      if (name.endsWith("/")) continue;
      if (name.startsWith("/") || name.split("/").includes(".."))
        throw Error("ZIP内に不正なパスがあります: " + name);
      if (v.getUint32(lo, true) !== 0x04034b50)
        throw Error("ZIPローカルヘッダーが不正です: " + name);
      const ln = v.getUint16(lo + 26, true),
        le = v.getUint16(lo + 28, true),
        start = lo + 30 + ln + le,
        compressed = u8.slice(start, start + csize);
      let data;
      if (method === 0) data = compressed;
      else if (method === 8) {
        if (typeof DecompressionStream === "undefined")
          throw Error("このブラウザはZIPのDEFLATE展開に対応していません。");
        const ds = new DecompressionStream("deflate-raw");
        const stream = new Blob([compressed]).stream().pipeThrough(ds);
        data = new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw Error("未対応のZIP圧縮方式です: " + method + " (" + name + ")");
      out.set(name, data);
    }
    return out;
  }
  // Blob の SHA-256 を16進文字列で返す（元の画像と変更後の画像が同じかどうかの判定に使う）
  async function digestHex(blob) {
    const h = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  // crc32(bytes): ZIP に記録するファイルの検査値を計算する
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const b of bytes) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  // makeZip([[ファイル名, bytes], ...]): 無圧縮の ZIP を Blob で作る（ローカルヘッダー+データ → 中央ディレクトリ → 終端レコード の順に並べる）
  function makeZip(items) {
    const encoder = new TextEncoder(),
      locals = [],
      central = [];
    let offset = 0;
    const u16 = (d, p, n) => d.setUint16(p, n, true),
      u32 = (d, p, n) => d.setUint32(p, n >>> 0, true);
    for (const [filename, data] of items) {
      const name = encoder.encode(filename),
        bytes = data instanceof Uint8Array ? data : new Uint8Array(data),
        crc = crc32(bytes);
      const lh = new Uint8Array(30 + name.length),
        lv = new DataView(lh.buffer);
      u32(lv, 0, 0x04034b50);
      u16(lv, 4, 20);
      u16(lv, 8, 0);
      u32(lv, 14, crc);
      u32(lv, 18, bytes.length);
      u32(lv, 22, bytes.length);
      u16(lv, 26, name.length);
      lh.set(name, 30);
      locals.push(lh, bytes);
      const ch = new Uint8Array(46 + name.length),
        cv = new DataView(ch.buffer);
      u32(cv, 0, 0x02014b50);
      u16(cv, 4, 20);
      u16(cv, 6, 20);
      u32(cv, 16, crc);
      u32(cv, 20, bytes.length);
      u32(cv, 24, bytes.length);
      u16(cv, 28, name.length);
      u32(cv, 42, offset);
      ch.set(name, 46);
      central.push(ch);
      offset += lh.length + bytes.length;
    }
    const csize = central.reduce((a, x) => a + x.length, 0),
      end = new Uint8Array(22),
      v = new DataView(end.buffer);
    u32(v, 0, 0x06054b50);
    u16(v, 8, items.length);
    u16(v, 10, items.length);
    u32(v, 12, csize);
    u32(v, 16, offset);
    return new Blob([...locals, ...central, end], { type: "application/zip" });
  }
  // canvas を PNG の Blob に変換する（Promise）
  const canvasBlob = (c) =>
    new Promise((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(Error("PNG生成失敗"))), "image/png"),
    );
  // 「全選択」「全解除」ボタン（ZIPに書き出すスプライトの選択）
  $("selectAllSprites").onclick = () => {
    extractSelection.clear();
    for (const x of map?.ATLAS?.SPRITES || []) extractSelection.add(String(x.SPRITE.name));
    refreshSpriteGrids();
  };
  $("selectNoSprites").onclick = () => {
    extractSelection.clear();
    refreshSpriteGrids();
  };
  // 選んだスプライトを1枚ずつの PNG（part_0001.png ...）にして、atlas_manifest.json（名前・元の座標・元画像の SHA-256）と一緒に ZIP でダウンロードする。
  // 使い方: ZIP を展開 → 外部の画像編集ソフトで PNG を編集 → ZIP に戻して「ZIPから復元」で取り込む。
  $("extractZip").onclick = async () => {
    try {
      if (!map || !img.naturalWidth) throw Error("アトラスを読み込んでください。");
      const sprites = (map.ATLAS.SPRITES || [])
        .map((x) => x.SPRITE)
        .filter((x) => extractSelection.has(String(x.name)));
      if (!sprites.length) throw Error("パーツを1つ以上選択してください。");
      const files = [],
        manifest = {
          version: 2,
          canvas: { w: img.naturalWidth, h: img.naturalHeight },
          sprites: [],
        };
      for (let i = 0; i < sprites.length; i++) {
        const sp = sprites[i],
          filename = "part_" + String(i + 1).padStart(4, "0") + ".png",
          blob = await canvasBlob(spriteCanvas(sp));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        files.push(["atlas_parts/" + filename, bytes]);
        manifest.sprites.push({
          name: String(sp.name),
          file: filename,
          x: sp.x,
          y: sp.y,
          w: sp.w,
          h: sp.h,
          original_sha256: await digestHex(blob),
        });
      }
      files.push([
        "atlas_manifest.json",
        new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      ]);
      downloadBlob(makeZip(files), "atlas_parts_selected.zip");
      status(
        sprites.length +
          "個のパーツをZIPに保存しました。復元時は重なりを避けるためアトラスを再配置します。",
      );
    } catch (e) {
      status("ZIP作成エラー: " + e.message);
    }
  };
  // 全スプライトを新しいアトラスへ詰め直す。replacements（名前 → canvas）にあるスプライトは、差し替え後の画像を使う。
  // サイズが変わっても重ならないよう、余白を付けて並べ直す。新しい PNG(spritemap1-restored.png) と JSON をダウンロードし、img / map を差し替える。
  async function repackSprites(replacements) {
    const originals = (map.ATLAS?.SPRITES || []).map((x) => x.SPRITE).filter(Boolean);
    const items = [];
    for (const sp of originals) {
      if (sp.rotated) throw Error("回転済みパーツは安全に再配置できません: " + sp.name);
      const replacement = replacements.get(String(sp.name));
      const canvas = replacement || spriteCanvas(sp);
      items.push({ sp, canvas, w: canvas.width, h: canvas.height });
    }
    if (!items.length) throw Error("パーツがありません。");
    const area = items.reduce((a, x) => a + (x.w + 4) * (x.h + 4), 0),
      maxW = Math.max(...items.map((x) => x.w));
    const width = Math.ceil(Math.max(maxW + 4, Math.min(4096, Math.sqrt(area) * 1.35)) / 64) * 64;
    let x = 2,
      y = 2,
      row = 0;
    for (const it of items) {
      if (x + it.w + 2 > width && x > 2) {
        x = 2;
        y += row + 2;
        row = 0;
      }
      it.x = x;
      it.y = y;
      x += it.w + 2;
      row = Math.max(row, it.h);
    }
    const height = y + row + 2,
      out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    for (const it of items) ctx.drawImage(it.canvas, it.x, it.y);
    const next = JSON.parse(JSON.stringify(map));
    next.ATLAS.SPRITES = items.map((it) => ({
      SPRITE: { ...it.sp, x: it.x, y: it.y, w: it.w, h: it.h },
    }));
    if (next.meta) {
      next.meta.image = "spritemap1-restored.png";
      next.meta.size = { w: width, h: height };
    }
    const blob = await canvasBlob(out);
    const old = img,
      im = new Image();
    im.src = URL.createObjectURL(blob);
    await im.decode();
    img = im;
    map = next;
    pngFileName = "spritemap1-restored.png";
    $("sprite").innerHTML = items
      .map((it) => `<option value="${esc(it.sp.name)}">${esc(it.sp.name)}</option>`)
      .join("");
    updateAddSpriteList();
    draw();
    parts();
    downloadBlob(blob, pngFileName);
    downloadBlob(
      new Blob([JSON.stringify(map)], { type: "application/json" }),
      "spritemap-restored.json",
    );
    if (old.src.startsWith("blob:")) URL.revokeObjectURL(old.src);
    return items.length;
  }
  // ZIP から復元: 編集済みの PNG が入った ZIP を読み込み、manifest の SHA-256 と比べて「変更されたパーツ」だけを差し替え対象にし、
  // repackSprites で再配置する。名前が見つからないパーツは数えて報告する。
  $("restorezip").onclick = async () => {
    try {
      if (!map || !img.naturalWidth)
        throw Error("先に元のPNGとspritemap JSONを読み込んでください。");
      const file = $("zipfile").files[0];
      if (!file) throw Error("ZIPを選択してください。");
      const entries = await readZip(file);
      const mf = [...entries].find(([n]) => n.split("/").pop() === "atlas_manifest.json");
      if (!mf) throw Error("atlas_manifest.json がありません。");
      const manifest = JSON.parse(new TextDecoder().decode(mf[1]));
      if (!Array.isArray(manifest.sprites)) throw Error("Manifestのspritesがありません。");
      const originals = new Map(
        (map.ATLAS?.SPRITES || []).map((x) => [String(x.SPRITE.name), x.SPRITE]),
      );
      const replacements = new Map();
      let missing = 0,
        changed = 0;
      const filesByBase = new Map([...entries].map(([n, v]) => [n.split("/").pop(), v]));
      for (const item of manifest.sprites) {
        const name = String(item.name ?? ""),
          sp = originals.get(name),
          bytes = filesByBase.get(item.file);
        if (!sp || !bytes) {
          missing++;
          continue;
        }
        const blob = new Blob([bytes], { type: "image/png" }),
          hash = await digestHex(blob);
        if (item.original_sha256 && hash === item.original_sha256) continue;
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        bitmap.close?.();
        if (replacements.has(name)) throw Error("同じパーツ名が重複しています: " + name);
        replacements.set(name, canvas);
        changed++;
      }
      if (!changed) {
        status("変更されたパーツはありません。未検出: " + missing);
        return;
      }
      await repackSprites(replacements);
      status(
        "復元完了: " +
          changed +
          "パーツ。重ならないようアトラスを再配置しました。\n重要: PNGとspritemap-restored.jsonの両方をFNFに反映してください。\n見つからないパーツ: " +
          missing,
      );
    } catch (e) {
      status("ZIP復元エラー: " + e.message);
    }
  };
  // 選択中のスプライト1つを PNG として保存する（回転済みは未対応のため中止）
  $("extract").onclick = () => {
    const s = (map?.ATLAS?.SPRITES || [])
      .map((x) => x.SPRITE)
      .find((x) => String(x.name) === $("sprite").value);
    if (!s || !img.complete) return;
    if (s.rotated) {
      status("回転済みパーツの単体抽出は現在未対応です。誤った画像を出力しないため中止しました。");
      return;
    }
    const c = document.createElement("canvas");
    c.width = s.w;
    c.height = s.h;
    c.getContext("2d").drawImage(img, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
    c.toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `sprite-${s.name}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  };
  // 最後に一度 resize() を呼んで、canvas の初期サイズを合わせる
  resize();

  // ============================================================
  // 外部ファイル(autosave.js)向けの公開口
  // このIIFEの内部変数は外から見えないため、必要なものだけここで公開する。
  // ============================================================
  window.FunkinAnimate = {
    get anim() { return anim; },
    set anim(v) { anim = v; },
    get map() { return map; },
    set map(v) { map = v; },
    get img() { return img; },
    set img(v) { img = v; },
    get pngFileName() { return pngFileName; },
    set pngFileName(v) { pngFileName = v; },
    get symbol() { return symbol; },
    set symbol(v) { symbol = v; },
    symbolNavStack, anUndo, anRedo, anButtons,
    animateSymbolOptions, esc, updateAddSpriteList, duration, setFrame,
    parts, updateKeyUI, resize, recenterPreview, legacyEditRefresh, openWorkspace,
  };
})();
