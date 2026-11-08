/* ============================================================
   states/RenderMenuState.js — アトラス形式の選択（AnimateAtlas / Sparrow）
   ============================================================ */
import { State } from "../core/State.js";

export class RenderMenuState extends State {
  static id = "renderMenu";
  static template = `
    <div id="renderWelcome" role="dialog" aria-modal="true" aria-label="Animate">
      <div class="welcome-inner">
        <h1 style="font-size: 22px; margin: 0">アニメーションを編集</h1>
        <p class="tiny">
          使用するアトラス形式を選んでください。未対応の形式は今後のアップデートで追加予定です。
        </p>
        <button id="backHome" type="button">←メインメニューへ</button>
        <div class="render-choices">
          <button class="render-choice" id="chooseAnimate">
            <strong>AnimateAtlas</strong>
            <small>現在のエディタ / Animation.json + spritemap JSON + PNG</small>
            <span style="color: var(--accent)">使用可能</span>
          </button>
          <button class="render-choice" id="chooseSparrow">
            <strong>Sparrow</strong><small>XML + PNG</small>
            <span style="color: var(--accent)">使用可能</span>
          </button>
        </div>
      </div>
    </div>`;

  create() {
    this.goOnClick("#backHome", "home");
    this.goOnClick("#chooseAnimate", "animate");
    this.goOnClick("#chooseSparrow", "sparrow");
  }
}
