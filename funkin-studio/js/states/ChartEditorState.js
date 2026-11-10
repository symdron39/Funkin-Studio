/* ============================================================
   states/ChartEditorState.js — Chart Editor（V-Slice の chart.json / metadata.json の編集）の画面
   ------------------------------------------------------------
   構造は Stage Editor と同じ（入れ物 + chart/editor.js のロジック + chart/template.js の HTML）。
   ============================================================ */
import { EditorState } from "./EditorState.js";
import { template } from "./chart/template.js";
import { mountChartEditor } from "./chart/editor.js";

export class ChartEditorState extends EditorState {
  static id = "chart";
  static template = template;
  static hudLabel = "Chart Editor";
  static hudBack = "funkinMenu";

  create() {
    this.editor = mountChartEditor(this);
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
