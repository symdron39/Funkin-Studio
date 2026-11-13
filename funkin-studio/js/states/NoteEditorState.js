/* ============================================================
   states/NoteEditorState.js — Note Editor（noteStyle の編集）の画面。V-Slice 本体には無い、Funkin' Studio 独自のエディタ。
   ============================================================ */
import { EditorState } from "./EditorState.js";
import { template } from "./note/template.js";
import { mountNoteEditor } from "./note/editor.js";

export class NoteEditorState extends EditorState {
  static id = "note";
  static template = template;
  static hudLabel = "Note Editor";
  static hudBack = "funkinMenu";

  create() {
    this.editor = mountNoteEditor(this);
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
