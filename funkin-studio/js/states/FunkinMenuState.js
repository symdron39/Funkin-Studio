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
          <button id="chooseStage" class="render-choice">
            <strong>Stage Editor</strong>
            <small>V-Slice ステージ / prop・キャラ位置</small>
          </button>
          <button id="chooseChart" class="render-choice">
            <strong>Chart Editor</strong>
            <small>V-Slice 譜面 / chart・metadata・イベント</small>
          </button>
        </div>
      </div>
    </div>`;

  create() {
    this.goOnClick("#funkinBackHome", "home");
    this.goOnClick("#chooseCharacter", "character");
    this.goOnClick("#chooseStage", "stage");
    this.goOnClick("#chooseChart", "chart");
  }
}
