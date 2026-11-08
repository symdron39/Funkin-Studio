/* ============================================================
   states/FunkinMenuState.js — Funkin' Editor のツール選択
   ============================================================ */
import { State } from "../core/State.js";

export class FunkinMenuState extends State {
  static id = "funkinMenu";
  static template = `
    <div id="funkinWelcome" role="dialog" aria-modal="true" aria-label="Funkin Editor">
      <div class="welcome-inner">
        <h1>🎮 Funkin' Editor</h1>
        <p class="tiny">編集するツールを選択してください。</p>
        <button id="funkinBackHome" type="button">←メインメニューへ</button>
        <div class="render-choices">
          <button id="chooseCharacter" class="render-choice">
            <strong>Character Editor</strong>
            <small>V-Slice キャラクター / Offset</small>
          </button>
          <button class="render-choice" disabled>
            <strong>Coming Soon</strong>
            <small>今後実装予定</small>
          </button>
        </div>
      </div>
    </div>`;

  create() {
    this.goOnClick("#funkinBackHome", "home");
    this.goOnClick("#chooseCharacter", "character");
  }
}
