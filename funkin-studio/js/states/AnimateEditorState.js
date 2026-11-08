/* ============================================================
   states/AnimateEditorState.js — Animate Editor（AnimateAtlas）の画面
   ------------------------------------------------------------
   この State は「入れ物」。中身のロジックは animate/editor.js、HTML は animate/template.js。
   persistent（隠れても破棄しない）・hud（HUD を出す）・未保存の確認は、親の EditorState から引き継いでいる。
   隠れるときは onHide、戻ってくると onShow が呼ばれる。
   ============================================================ */
import { EditorState } from "./EditorState.js";
import { template } from "./animate/template.js";
import { mountAnimateEditor } from "./animate/editor.js";
import { mountPartsPanel } from "./animate/partsPanel.js";

export class AnimateEditorState extends EditorState {
  static id = "animate";
  static template = template;
  static hudLabel = "AnimateAtlas";
  static hudBack = "renderMenu"; // HUD の「AnimateAtlas ▾」を押したときの行き先

  create() {
    // HTML が root に入った「あと」で、ロジックを起動する
    this.editor = mountAnimateEditor(this);
    this.api = this.editor.api; // autosave など外から使うためにも公開
    mountPartsPanel(this, this.api);
  }

  onShow() {
    this.editor.onShow();
  }
  onHide() {
    this.editor.onHide();
  }
  undo() {
    this.editor.undo();
  }
  redo() {
    this.editor.redo();
  }
}
