/* ============================================================
   services/UnsavedGuard.js — 「● 未保存」表示と、画面を離れるときの警告
   ------------------------------------------------------------
   旧 parts-manager.js の後半（未保存の警告）を独立させたもの。
   仕組み:
     ・編集系ボタンを押す / キャンバスをドラッグする → mark()（未保存）
     ・書き出し系ボタンを押す                         → clean()
     ・タブを閉じる/再読み込み → ブラウザ標準の警告（beforeunload）
     ・編集画面から別の画面へ移る → State.canLeave() 経由で confirm（下の makeCanLeave）
   これは「目安」。ドラッグなどは念のため「変更あり」とみなす
   （警告し忘れより、警告しすぎるほうが安全なため）。
   ============================================================ */

// 押すと「未保存」になるボタンの id（Animate / Sparrow / Character の編集系）
const EDITS = new Set([
  "apply", "rotateApply", "unlink", "unlinkAllSprite", "deleteSprite", "deleteAllUnusedSprites",
  "importpng", "restorezip", "keyCopy", "keyBlank", "keyDelete", "keyExtend", "addpart", "addlayer",
  "deleteLayer", "addanim", "addsymbol", "newSymbol", "deleteSymbol", "front", "back", "elemfront",
  "elemback", "legacyApply", "legacySetZ", "legacyDuplicate", "legacyBlank", "legacyDeleteFrame",
  "legacySetDuration", "legacyAddLayer", "legacyRemoveLayer", "legacyElementFront",
  "legacyElementBack", "legacyNewSymbol", "legacyCloneSymbol", "legacyDeleteSymbol", "anLabelSave",
  "anLabelDelete", "spMove", "spDeleteSelected", "spDuplicate", "spDuplicatePrefix", "spRename",
  "spRenumber", "spDelete", "spMerge",
]);
// 「保存した」とみなす書き出しボタン（他の書き出しは別ファイルが未保存のままかもしれないので消さない）
const SAVES = new Set(["export", "legacySave", "spExport"]);
// ファイルを読み込み直すボタン
const LOADS = new Set(["load", "spLoad"]);

export class UnsavedGuard {
  isDirty = false;

  constructor(app) {
    this.app = app;
    // capture=true（第3引数）: 他の処理より先にクリックを見る
    document.addEventListener(
      "click",
      (e) => {
        const b = e.target.closest?.("button");
        if (!b) return;
        // ファイルを読み込み直すとき: 未保存があれば確認し、キャンセルならクリックを止める
        if (LOADS.has(b.id) && !this.confirmReplace()) {
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }
        if (EDITS.has(b.id)) this.mark();
        if (SAVES.has(b.id)) this.clean();
      },
      true,
    );
    // キャンバス上のドラッグ開始も「変更あり」。非表示の画面のキャンバスは除く
    for (const id of ["stage", "spCanvas", "offCanvas"]) {
      document.addEventListener(
        "pointerdown",
        (e) => {
          // 左クリック以外（中/右ドラッグのパン）や、パン操作中（Space / ✋）は「編集」ではない
          if (e.button !== 0 || e.target?.dataset?.pan === "1") return;
          if (e.target?.id === id && !e.target.closest("[hidden]")) this.mark();
        },
        true,
      );
    }
    // オフセットなどの数値欄・チェックの変更も「変更あり」
    document.addEventListener(
      "change",
      (e) => {
        if (["offX", "offY", "charFlipX"].includes(e.target?.id)) this.mark();
      },
      true,
    );
    // アセットが変わった合図（Animate エディタが発火）
    app.events.on("asset-mutated", () => this.mark());
    // タブを閉じる/再読み込みしようとしたとき、未保存があればブラウザ標準の警告
    window.addEventListener("beforeunload", (e) => {
      if (!this.isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    });
  }

  mark() {
    this.isDirty = true;
    this.app.hud?.setUnsaved(true);
  }

  clean() {
    this.isDirty = false;
    this.app.hud?.setUnsaved(false);
  }

  /** 「新しいファイルを読み込む」前の確認。OK なら true（そのまま未保存印を消す） */
  confirmReplace() {
    if (
      this.isDirty &&
      !confirm("未保存の変更があります。新しいファイルを読み込みますか？\nUnsaved changes. Load another file?")
    )
      return false;
    this.clean();
    return true;
  }

  /** 画面を出てよいか。State の canLeave() から呼ぶ */
  confirmLeave() {
    return (
      !this.isDirty ||
      confirm("未保存の変更があります。画面を移動しますか？\nYou have unsaved changes. Continue navigating?")
    );
  }
}
