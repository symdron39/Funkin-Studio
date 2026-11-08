/* ============================================================
   states/ContributorsState.js — クレジット一覧
   ------------------------------------------------------------
   データは data/contributors.js（CONTRIBUTORS 配列）。追加方法は CONTRIBUTORS_GUIDE.md。
   この State は「データ → カード」を組み立てて表示するだけ。
   言語が切り替わったら作り直す（app.events の "language-changed"）。
   ============================================================ */
import { State } from "../core/State.js";
import { CONTRIBUTORS } from "../data/contributors.js";

// http/https のリンクだけ許可する（javascript: などを防ぐ）
function safeUrl(url) {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url, document.baseURI);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : null;
  } catch (_) {
    return null;
  }
}
// 画像は https/http に加え、単一HTML版で埋め込まれる data:image/ も許可する（リンクには許可しない）
function safeImageUrl(url) {
  if (typeof url !== "string") return null;
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml|x-icon);/i.test(url)) return url;
  return safeUrl(url);
}

export class ContributorsState extends State {
  static id = "contributors";
  static template = `
    <div id="contributorsWelcome" role="dialog" aria-modal="true" aria-label="Contributors">
      <div class="welcome-inner contributors-inner">
        <h1>Contributors</h1>
        <p class="tiny">Funkin' Studioの制作・協力に関わった方々。AIがの説明やアイコンが書いてある箇所は、Reoが勝手に作ったものではなく、AI自身が自分の意思として書いたもの。</p>
        <button id="contributorsBack" type="button">←その他へ戻る</button>
        <div id="contributorsList" class="contributors-list" aria-live="polite"></div>
      </div>
    </div>`;

  create() {
    this.goOnClick("#contributorsBack", "otherMenu");
    this.renderList();
    // 戻り値は「解除する関数」。destroy 時に自動で呼ばれるよう登録する
    this.addDisposer(this.app.events.on("language-changed", () => this.renderList()));
  }

  renderList() {
    const list = this.q("#contributorsList");
    const lang = this.app.i18n.lang;
    // {ja:"…", en:"…"} の形でも、ただの文字列でも受け取れるようにする
    const localized = (v) =>
      v && typeof v === "object" && !Array.isArray(v) ? (v[lang] ?? v.ja ?? v.en ?? "") : (v ?? "");
    list.replaceChildren();
    if (!CONTRIBUTORS.length) {
      const message = document.createElement("p");
      message.className = "tiny";
      message.textContent =
        lang === "en"
          ? "Credits are coming soon. Add entries in data/contributors.js."
          : "クレジットは準備中です。data/contributors.js から追加できます。";
      list.append(message);
      return;
    }
    for (const entry of CONTRIBUTORS) list.append(this.buildCard(entry, localized));
  }

  buildCard(entry, localized) {
    const card = document.createElement("article");
    card.className = "contributor-card";
    const imageUrl = entry.image ? safeImageUrl(entry.image) : null;
    if (imageUrl) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = "";
      img.loading = "lazy";
      card.append(img);
    }
    const content = document.createElement("div");
    content.className = "contributor-content";
    const name = document.createElement("h2");
    name.textContent = localized(entry.name) || "Contributor";
    content.append(name);
    if (entry.role) {
      const role = document.createElement("p");
      role.className = "contributor-role";
      role.textContent = localized(entry.role);
      content.append(role);
    }
    if (entry.description) {
      const desc = document.createElement("p");
      desc.textContent = localized(entry.description);
      content.append(desc);
    }
    if (Array.isArray(entry.links) && entry.links.length) {
      const links = document.createElement("div");
      links.className = "contributor-links";
      for (const item of entry.links) {
        const url = safeUrl(item.url);
        if (!url) continue;
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = localized(item.label) || "Link";
        links.append(link);
      }
      content.append(links);
    }
    card.append(content);
    return card;
  }
}
