/* ============================================================
   parts-manager.js — パーツ管理パネル と 未保存の警告（v2.7.6）
   ------------------------------------------------------------
   独立した2つの機能が入っている。どちらも「画面側の追加」だけで、編集処理そのものは他のファイルが行う。
     1. パーツ管理パネル : Animate 画面の下に折りたたみパネルを作り、既存のボタン（配置解除・スプライト選択・切り出し・削除）をそこへ集める
     2. 未保存の警告     : 編集ボタンが押されたら「● 未保存」を表示し、画面移動・再読み込み・ファイルの読み直しの前に確認する
   他ファイルとの関係: animate-editor.js が公開する window.__fsGetRefs / __fsUnlinkAllSprite と、
                       'fs-asset-mutated' イベントを使う。
   ============================================================ */
(() => {
  const $ = (id) => document.getElementById(id);

  // ============================================================
  // 1. パーツ管理パネル（画面の追加のみ）
  // ============================================================
  // Animate 画面の .studio-inspector の直後に、折りたたみ式の <details> パネルを作る。
  const root = $("animateWorkspace");
  const inspector = root?.querySelector(".studio-inspector");
  if (root && inspector) {
    const panel = document.createElement("details");
    panel.className = "panel";
    panel.open = false;
    panel.id = "partsManager";
    panel.style.margin = "12px 0";
    panel.innerHTML = `<summary data-ja="🧩 パーツ管理（配置・Atlas）" data-en="🧩 Parts manager (instances & atlas)">🧩 パーツ管理（配置・Atlas）</summary>
  <div style="padding:12px 0;display:grid;gap:12px">
   <div><strong data-ja="① フレーム内の配置" data-en="① Frame instances">① フレーム内の配置</strong><p class="tiny" data-ja="上の要素一覧で配置を選択して削除。元のAtlas画像は残ります。" data-en="Select an instance in the element list above, then remove it. The source atlas sprite stays intact.">上の要素一覧で配置を選択して削除。元のAtlas画像は残ります。</p><div id="partsInstanceSlot"></div></div>
   <div style="border-top:1px solid #6665;padding-top:12px"><strong data-ja="② Atlas画像の管理" data-en="② Atlas sprite management">② Atlas画像の管理</strong><p class="tiny" data-ja="画像を選択し、参照状況を確認してから完全削除します。使用中の画像は削除できません。" data-en="Select a sprite and check references before deleting it from the atlas. In-use sprites cannot be deleted.">画像を選択し、参照状況を確認してから完全削除します。使用中の画像は削除できません。</p><div id="partsAtlasSlot"></div><p id="partsUsage" class="tiny" aria-live="polite"></p></div>
   <p class="tiny" data-ja="Atlasを再構築した場合はPNGとspritemap JSONをセットで保存してください。" data-en="After repacking, keep the PNG and spritemap JSON together.">Atlasを再構築した場合はPNGとspritemap JSONをセットで保存してください。</p>
  </div>`;
    inspector.after(panel);
    // 既存のボタン・欄（unlink / sprite / extract / deleteSprite）をパネルの中へ移す。DOM上の場所を移すだけで、ボタンの処理は元のまま。
    const instanceSlot = $("partsInstanceSlot"),
      atlasSlot = $("partsAtlasSlot");
    const unlink = $("unlink");
    if (unlink) instanceSlot.append(unlink);
    const sprite = $("sprite"),
      del = $("deleteSprite"),
      extract = $("extract");
    if (sprite) atlasSlot.append(sprite);
    if (extract) atlasSlot.append(extract);
    if (del) atlasSlot.append(del);
    // 「この画像の配置をすべて解除」ボタンを新しく作る。押すと animate-editor.js の window.__fsUnlinkAllSprite を呼ぶ。
    const unlinkAll = document.createElement("button");
    unlinkAll.id = "unlinkAllSprite";
    unlinkAll.textContent = "この画像の配置をすべて解除";
    unlinkAll.setAttribute("data-ja", "この画像の配置をすべて解除");
    unlinkAll.setAttribute("data-en", "Remove all instances of this sprite");
    unlinkAll.onclick = () => window.__fsUnlinkAllSprite?.();
    atlasSlot.insertBefore(unlinkAll, del || null);
    // 選択中のスプライトの使用状況を表示する。window.__fsGetRefs(name) で使っている場所を取得し、あれば一覧、無ければ「未使用のパーツ」と出す。
    // 表示言語は window.__fsLang（i18n.js が設定）を見る。言語を切り替えたときは「fs-language-changed」で表示を作り直す。
    const refresh = () => {
      if (!sprite) return;
      const name = sprite.value;
      const a = window.__fsGetRefs?.(name);
      const out = $("partsUsage");
      if (!out) return;
      if (!name) {
        out.textContent = "";
        return;
      }
      if (!a) {
        out.textContent = "";
        return;
      }
      out.textContent = a.length
        ? (window.__fsLang === "en" ? "In use: " : "使用中: ") + a.join(" / ")
        : window.__fsLang === "en"
          ? "Unused sprite"
          : "未使用のパーツ";
    };
    sprite?.addEventListener("change", refresh);
    document.addEventListener("fs-language-changed", refresh);
    panel.addEventListener("toggle", () => {
      if (panel.open) refresh();
    });
    // Existing references function is in the editor closure. The existing delete handler
    // still performs the authoritative reference check; no replacement of that logic.
  }

  // ============================================================
  // 2. 未保存の警告
  // ============================================================
  // dirty: 未保存の変更があるか。「編集」と判定したボタン操作やイベントで true、「保存（書き出し）」で false。
  // これは目安で、厳密な判定ではない。ドラッグなどは念のため「変更あり」とみなす（警告し忘れより、警告しすぎる方が安全なため）。
  let dirty = false;
  // ヘッダーの「● 未保存」表示。dirty に合わせて paint() が書き換える。
  const indicator = document.createElement("span");
  indicator.id = "unsavedIndicator";
  indicator.style.cssText = "font-size:12px;color:#ffc76c;padding:4px";
  const hud = document.querySelector("#studioHud .hudActions");
  hud?.prepend(indicator);
  const paint = () => {
    indicator.textContent = dirty ? "● 未保存 / Unsaved" : "";
  };
  const mark = () => {
    dirty = true;
    paint();
  };
  // animate-editor.js が発行する「アセットが変わった」イベントでも未保存にする
  document.addEventListener("fs-asset-mutated", mark);
  const clean = () => {
    dirty = false;
    paint();
  };
  // edits: 押すと「未保存」になるボタンの id 一覧（Animate / Sparrow / Character の編集系ボタン）
  const edits = new Set([
    "apply",
    "rotateApply",
    "unlink",
    "unlinkAllSprite",
    "deleteSprite",
    "deleteAllUnusedSprites",
    "importpng",
    "restorezip",
    "keyCopy",
    "keyBlank",
    "keyDelete",
    "keyExtend",
    "addpart",
    "addlayer",
    "deleteLayer",
    "addanim",
    "addsymbol",
    "newSymbol",
    "deleteSymbol",
    "front",
    "back",
    "elemfront",
    "elemback",
    "legacyApply",
    "legacySetZ",
    "legacyDuplicate",
    "legacyBlank",
    "legacyDeleteFrame",
    "legacySetDuration",
    "legacyAddLayer",
    "legacyRemoveLayer",
    "legacyElementFront",
    "legacyElementBack",
    "legacyNewSymbol",
    "legacyCloneSymbol",
    "legacyDeleteSymbol",
    "anLabelSave",
    "anLabelDelete",
    "spMove",
    "spDeleteSelected",
    "spDuplicate",
    "spDuplicatePrefix",
    "spRename",
    "spRenumber",
    "spDelete",
    "spMerge",
  ]);
  // saves: 書き出し系ボタンの id 一覧。このうち export / legacySave / spExport だけを「保存した」とみなして未保存を消す（他の書き出しは、別のファイルが未保存のままかもしれないので消さない）。
  const saves = new Set(["export", "legacySave", "spExport", "spExportPng", "offExport"]);
  // ボタンのクリックを監視（capture=true で他の処理より先に）: edits なら mark()、saves の一部なら clean()
  document.addEventListener(
    "click",
    (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (edits.has(b.id)) mark();
      if (saves.has(b.id)) {
        // A single file export does not necessarily save all edited assets.
        if (["export", "legacySave", "spExport"].includes(b.id)) clean();
      }
    },
    true,
  );
  // キャンバス上のドラッグ開始も「変更あり」とみなす（非表示の画面のキャンバスは除く）
  for (const id of ["stage", "spCanvas", "offCanvas"])
    $(id)?.addEventListener(
      "pointerdown",
      () => {
        // Conservative: a drag may modify artwork; false positives are preferable to losing work.
        if (!$(id)?.closest("[hidden]")) mark();
      },
      true,
    );
  document.addEventListener(
    "change",
    (e) => {
      // オフセットなどの数値欄・チェックの変更も「変更あり」にする
      if (["offX", "offY", "charFlipX"].includes(e.target?.id)) mark();
    },
    true,
  );
  // タブを閉じる/再読み込みしようとしたとき、未保存があればブラウザ標準の警告を出す
  window.addEventListener("beforeunload", (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
  // 画面内の移動ボタン（ホームへ戻る等）では、確認ダイアログを出し、キャンセルされたら移動を止める。
  // Internal navigation is not a browser unload: guard separately.
  for (const id of [
    "goHome",
    "changeRenderer",
    "homeAnimate",
    "homeFunkin",
    "backHome",
    "funkinBackHome",
  ]) {
    const b = $(id);
    if (!b) continue;
    b.addEventListener(
      "click",
      (e) => {
        if (!dirty) return;
        const msg =
          "未保存の変更があります。画面を移動しますか？\nYou have unsaved changes. Continue navigating?";
        if (!confirm(msg)) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      },
      true,
    );
  }
  // ファイルを読み込み直すとき: 未保存があれば確認し、OK ならそのまま読み込んで未保存印を消す。
  // Loading a new file can replace the current editor document.
  for (const id of ["load", "spLoad"])
    $(id)?.addEventListener(
      "click",
      (e) => {
        if (
          dirty &&
          !confirm(
            "未保存の変更があります。新しいファイルを読み込みますか？\nUnsaved changes. Load another file?",
          )
        ) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }
        clean();
      },
      true,
    );
})();
