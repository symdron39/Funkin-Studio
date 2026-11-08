/* ============================================================
   states/EditorState.js — 3つのエディタ共通の親クラス（State → EditorState → 各エディタ）
   ------------------------------------------------------------
   Haxe の「MusicBeatState を継承した EditorBaseState」のような中間クラス。
   エディタ共通の約束事だけをここに置く:
     ・persistent = true … 別の画面へ移っても破棄しない（開いたデータと Undo 履歴を守る）
     ・hud = true        … 上部の HUD を表示する
     ・canLeave()        … 未保存の変更があれば、画面を出る前に確認する

   JS メモ: static も継承される。 AnimateEditorState.persistent は、ここの true を引き継ぐ。
   ============================================================ */
import { State } from "../core/State.js";

export class EditorState extends State {
  static persistent = true;
  static hud = true;

  canLeave(_nextId) {
    return this.app.unsaved.confirmLeave();
  }
}
