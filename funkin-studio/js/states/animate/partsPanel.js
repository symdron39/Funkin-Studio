/* ============================================================
   states/animate/partsPanel.js — パーツ管理パネル（Animate 画面の下の折りたたみパネル）
   ------------------------------------------------------------
   旧 parts-manager.js の前半。画面側の追加だけで、編集処理そのものは editor.js が行う。
   既存のボタン（配置解除・スプライト選択・切り出し・削除）をパネルの中へ「移す」だけで、ボタンの処理は元のまま。
   （DOM の要素を append すると、元の場所から新しい場所へ移動する。付けてあった onclick もそのまま付いてくる）
   editor.js の api から getSpriteReferences / unlinkAllSprite を受け取って使う。
   ============================================================ */

export function mountPartsPanel(state, api) {
  const root = state.root;
  const $ = (id) => root.querySelector("#" + id);
  const inspector = root.querySelector(".studio-inspector");
  if (!inspector) return;

  const panel = document.createElement("details");
  panel.className = "panel";
  panel.open = false;
  panel.id = "partsManager";
  panel.style.margin = "12px 0";
  panel.innerHTML = `<summary data-ja="🧩 パーツ管理（配置・Atlas）" data-en="🧩 Parts manager (instances & atlas)">🧩 パーツ管理（配置・Atlas）</summary>
  <div style="padding:12px 0;display:grid;gap:12px">
   <div><strong data-ja="① フレーム内の配置" data-en="① Frame instances">① フレーム内の配置</strong><p class="tiny" data-ja="上の要素一覧で配置を選択して削除。元のAtlas画像は残ります。" data-en="Select an instance in the element list above, then remove it. The source atlas sprite stays intact.">上の要素一覧で配置を選択して削除。元のAtlas画像は残ります。</p><div id="partsInstanceSlot"></div></div>
   <div style="border-top:1px solid #6665;padding-top:12px"><strong data-ja="② Atlas画像の管理" data-en="② Atlas sprite management">② Atlas画像の管理</strong><p class="tiny" data-ja="画像を選択し、参照状況を確認してから完全削除します。使用中の画像は削除できません。" data-en="Select a sprite and check references before deleting it from the atlas. In-use sprites cannot be deleted.">画像を選択し、参照状況を確認してから完全削除します。使用中の画像は削除できません。</p><div id="partsAtlasSlot"></div><p id="partsUsage" class="tiny" aria-live="polite"></p></div>
   <p class="tiny" data-ja="Atlasを再構築した場合はPNGとspritemap JSONをセットで保存してください。" data-en="After repacking, keep the PNG and spritemap JSON together.">Atlasを再構築した場合はPNGとspritemap JSONをセットで保存してください。</p>
  </div>`;
  inspector.after(panel);

  // 既存のボタン・欄をパネルの中へ移す
  const instanceSlot = panel.querySelector("#partsInstanceSlot");
  const atlasSlot = panel.querySelector("#partsAtlasSlot");
  const unlink = $("unlink");
  if (unlink) instanceSlot.append(unlink);
  const sprite = $("sprite"),
    del = $("deleteSprite"),
    extract = $("extract");
  if (sprite) atlasSlot.append(sprite);
  if (extract) atlasSlot.append(extract);
  if (del) atlasSlot.append(del);

  // 「この画像の配置をすべて解除」ボタンを新しく作る
  const unlinkAll = document.createElement("button");
  unlinkAll.id = "unlinkAllSprite";
  unlinkAll.textContent = "この画像の配置をすべて解除";
  unlinkAll.setAttribute("data-ja", "この画像の配置をすべて解除");
  unlinkAll.setAttribute("data-en", "Remove all instances of this sprite");
  unlinkAll.onclick = () => api.unlinkAllSprite();
  atlasSlot.insertBefore(unlinkAll, del || null);

  // 選択中のスプライトの使用状況を表示する。使っている場所があれば一覧、無ければ「未使用のパーツ」
  const refresh = () => {
    if (!sprite) return;
    const name = sprite.value;
    const out = panel.querySelector("#partsUsage");
    const refs = name ? api.getSpriteReferences(name) : null;
    if (!refs) {
      out.textContent = "";
      return;
    }
    const en = state.app.i18n.lang === "en";
    out.textContent = refs.length
      ? (en ? "In use: " : "使用中: ") + refs.join(" / ")
      : en
        ? "Unused sprite"
        : "未使用のパーツ";
  };
  sprite?.addEventListener("change", refresh);
  // 言語が変わったら表示を作り直す（destroy 時に解除されるよう登録）
  state.addDisposer(state.app.events.on("language-changed", refresh));
  panel.addEventListener("toggle", () => {
    if (panel.open) refresh();
  });
}
