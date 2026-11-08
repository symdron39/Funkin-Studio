/* ============================================================
   states/HomeState.js — ホーム画面（最初に出る画面）
   ------------------------------------------------------------
   Haxe でいう MainMenuState。ボタンを押したら別の State へ switchTo するだけの、いちばん小さな見本。
   他の画面も基本はこの形:
     ① static id / template を決める
     ② create() でボタンを配線する
   ============================================================ */
import { State } from "../core/State.js";

export class HomeState extends State {
  static id = "home";
  static template = `
    <div id="studioHome" role="dialog" aria-modal="true">
      <div class="welcome-inner">
        <h1>Funkin' Modding Hub</h1>
        <p class="tiny">今日は、何をしよう。</p>
        <div class="render-choices">
          <button id="homeAnimate" class="render-choice">
            <strong>Animate Editor</strong>
            <small>AnimateAtlas / Sparrow</small>
          </button>
          <button id="homeFunkin" class="render-choice">
            <strong>Funkin' Editor</strong>
            <small>Character Editor / 今後実装予定</small>
          </button>
          <button id="homeOther" class="render-choice">
            <strong>その他</strong>
            <small>注意事項や、クレジットなどが記載されています。</small>
          </button>
        </div>
      </div>
    </div>`;

  create() {
    this.goOnClick("#homeAnimate", "renderMenu");
    this.goOnClick("#homeFunkin", "funkinMenu");
    this.goOnClick("#homeOther", "otherMenu");
  }
}
