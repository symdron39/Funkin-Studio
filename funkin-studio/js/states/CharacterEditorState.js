/* ============================================================
   states/CharacterEditorState.js — Character Editor（V-Slice の character.json / Offset 編集）の画面
   ------------------------------------------------------------
   この画面の Undo/Redo は画面内のボタン（offUndo など）で行い、HUD の Undo/Redo は使わない。
   （State に undo()/redo() を書かなければ、HUD のボタンは押せないままになる）
   ============================================================ */
import { EditorState } from "./EditorState.js";
import { template } from "./character/template.js";
import { mountCharacterEditor } from "./character/editor.js";

export class CharacterEditorState extends EditorState {
  static id = "character";
  static template = template;
  static hudLabel = "Offset Editor";
  static hudBack = "funkinMenu";

  create() {
    this.editor = mountCharacterEditor(this);
  }
  onShow() {
    this.editor.onShow();
  }
  onHide() {
    this.editor.onHide();
  }
}
