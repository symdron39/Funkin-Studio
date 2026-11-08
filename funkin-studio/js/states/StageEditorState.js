/* ============================================================
   states/StageEditorState.js — Stage Editor（V-Slice のステージ JSON の編集）の画面
   ------------------------------------------------------------
   構造は他のエディタと同じ（入れ物 + stage/editor.js のロジック + stage/template.js の HTML）。
   Character Editor と違い、HUD の Undo / Redo ボタンをそのまま使う（undo() / redo() を持つ画面は HUD のボタンが押せる）。
   ============================================================ */
import { EditorState } from "./EditorState.js";
import { template } from "./stage/template.js";
import { mountStageEditor } from "./stage/editor.js";

export class StageEditorState extends EditorState {
  static id = "stage";
  static template = template;
  static hudLabel = "Stage Editor";
  static hudBack = "funkinMenu";

  create() {
    this.editor = mountStageEditor(this);
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
