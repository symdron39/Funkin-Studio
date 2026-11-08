/* ============================================================
   ui/Hud.js — 画面上部のバー（Undo / Redo / Home / 形式切替 / 言語）
   ------------------------------------------------------------
   State ではなく「どの State の上にも重なる共有パーツ」。
   State 側は static hud = true にするだけで表示され、Undo/Redo は State のメソッドを呼ぶ:
       class MyEditor extends State {
         undo() { ... }   redo() { ... }          // HUD のボタンから呼ばれる
         // 履歴が変わったら   this.app.hud.setHistory(canUndo, canRedo)
       }
   これで「いま表示中の画面の Undo だけが効く」が自然に実現でき、
   旧コードの「if (!$("sparrowWorkspace").hidden)」のような分岐が不要になった。
   ============================================================ */
import { htmlToElement } from "../core/dom.js";

const template = `
<header id="studioHud" hidden>
  <div class="hudLogo">
    <div>
      <strong>🎤🩵Funkin' Studio
        <span style="color: var(--accent)">For 0.8.6 - 0.8.8</span>
      </strong>
      <small>Atlas Editor</small>
    </div>
  </div>
  <div class="hudActions">
    <span id="unsavedIndicator" style="font-size:12px;color:#ffc76c;padding:4px"></span>
    <button id="hudUndo" disabled title="元に戻す / Undo" aria-label="元に戻す">↶</button>
    <button id="hudRedo" disabled title="やり直す / Redo" aria-label="やり直す">↷</button>
    <button id="goHome" type="button">⌂ Home</button>
    <button id="changeRenderer" type="button">AnimateAtlas ▾</button>
    <button id="languageButton" aria-label="Language">🌐</button>
  </div>
  <div id="langMenu" hidden>
    <button data-lang="ja">日本語</button><button data-lang="en">English</button>
  </div>
</header>`;

export class Hud {
  constructor(app) {
    this.app = app;
    this.el = htmlToElement(template);
    document.body.prepend(this.el);
    const $ = (id) => this.el.querySelector("#" + id);
    this.undoBtn = $("hudUndo");
    this.redoBtn = $("hudRedo");
    this.backBtn = $("changeRenderer");
    this.langBtn = $("languageButton");
    this.langMenu = $("langMenu");
    this.unsavedLabel = $("unsavedIndicator");

    // ボタンの配線。「いまの画面」に仕事を渡すだけ
    this.undoBtn.onclick = () => app.states.current?.undo?.(); // undo が無い画面なら何もしない
    this.redoBtn.onclick = () => app.states.current?.redo?.();
    $("goHome").onclick = () => app.switchTo("home");
    this.backBtn.onclick = () => {
      const to = app.states.current?.constructor.hudBack;
      if (to) app.switchTo(to);
    };
    this.langBtn.onclick = () => (this.langMenu.hidden = !this.langMenu.hidden);
    this.langMenu.querySelectorAll("button").forEach((b) => {
      b.onclick = () => app.i18n.setLanguage(b.dataset.lang);
    });
    // 言語が変わったらボタンの表示と、メニューを更新
    app.events.on("language-changed", (lang) => {
      this.langBtn.textContent = "🌐 " + (lang === "en" ? "EN" : "JA");
      this.langMenu.hidden = true;
    });
  }

  /** 画面が切り替わったとき StateManager が呼ぶ */
  sync(StateClass) {
    this.el.hidden = !StateClass.hud;
    this.langMenu.hidden = true;
    if (StateClass.hud) {
      this.backBtn.textContent = StateClass.hudLabel + " ▾";
      this.setHistory(false, false); // 新しい画面が必要なら onShow で再設定する
    }
  }

  setHistory(canUndo, canRedo) {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  setUnsaved(isDirty) {
    this.unsavedLabel.textContent = isDirty ? "● 未保存 / Unsaved" : "";
  }
}
