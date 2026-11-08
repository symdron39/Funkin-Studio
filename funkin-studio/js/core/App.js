/* ============================================================
   core/App.js — アプリ全体の「入口」（Haxe の FlxG に近い）
   ------------------------------------------------------------
   どの画面からも this.app でアクセスできる、共有物の置き場。
     app.events        … EventBus（画面どうしの伝言板）
     app.states        … StateManager（画面の切り替え係）
     app.hud           … 上部のバー（main.js が作って入れる）
     app.unsaved       … 未保存フラグ（main.js が作って入れる）
     app.switchTo(id)  … 画面を切り替える（FlxG.switchState 相当）
   ============================================================ */
import { EventBus } from "./EventBus.js";
import { StateManager } from "./StateManager.js";

export class App {
  constructor(host) {
    this.events = new EventBus();
    this.states = new StateManager(this, host);
    this.hud = null;
    this.unsaved = null;
  }

  switchTo(id, params) {
    return this.states.switchTo(id, params);
  }
}
