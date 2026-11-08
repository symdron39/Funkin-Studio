/* ============================================================
   states/SparrowEditorState.js — Sparrow Editor の画面
   ------------------------------------------------------------
   構造は AnimateEditorState と同じ（入れ物 + editor.js のロジック + template.js の HTML）。
   ============================================================ */
import { EditorState } from "./EditorState.js";
import { template } from "./sparrow/template.js";
import { mountSparrowEditor } from "./sparrow/editor.js";

export class SparrowEditorState extends EditorState {
  static id = "sparrow";
  static template = template;
  static hudLabel = "Sparrow";
  static hudBack = "renderMenu";

  create() {
    this.editor = mountSparrowEditor(this);
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
