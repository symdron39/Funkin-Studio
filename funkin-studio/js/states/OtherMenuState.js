/* ============================================================
   states/OtherMenuState.js — その他（コミュニティ / クレジット）
   ============================================================ */
import { State } from "../core/State.js";

const NETWORK_URL = "https://discord.gg/5euuYvQFjG";

export class OtherMenuState extends State {
  static id = "otherMenu";
  static template = `
    <div id="otherWelcome" role="dialog" aria-modal="true" aria-label="Other Menus">
      <div class="welcome-inner">
        <h1>Other Menus</h1>
        <p class="tiny">クレジットなどのその他の掲載情報。</p>
        <button id="otherBackHome" type="button">←メインメニューへ</button>
        <div class="render-choices">
          <button id="chooseNetwork" class="render-choice" type="button">
            <strong>V-SLICE NETWORK</strong>
            <small>Reoによって作られたV-Sliceのmodコミュニティ。</small>
          </button>
          <button id="chooseContributors" class="render-choice" type="button">
            <strong>Contributors</strong>
            <small>制作者や貢献者の情報。</small>
          </button>
        </div>
      </div>
    </div>`;

  create() {
    this.goOnClick("#otherBackHome", "home");
    this.goOnClick("#chooseContributors", "contributors");
    // 外部サイトは State ではなく別タブで開く（Haxe の FlxG.openURL）
    this.click("#chooseNetwork", () => window.open(NETWORK_URL, "_blank", "noopener,noreferrer"));
  }
}
