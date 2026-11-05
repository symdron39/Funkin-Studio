/* ============================================================
   color-lab.js — 配色ラボ（画面の色をその場で変えて試すパネル）
   ------------------------------------------------------------
   仕組み: 12色を CSS 変数（--bg, --panel ...）に対応させ、<html> の style に直接書き込む。
     カラーピッカー / HEX 入力 / プリセットで変更 → すぐ画面に反映 → localStorage に保存（次回も復元）。
   「CSSをコピー」で、決めた色を :root { ... } の形でコピーでき、テーマ用の CSS に貼り付けて使える。
   関連: css/color-lab.css（パネルの見た目）/ css/theme-*.css（テーマの色）
   ============================================================ */
(() => {
  "use strict";
  // KEY: localStorage に色を保存するときの名前
  const KEY = "funkin-studio-color-lab-v1";
  // labels: [CSS変数名, パネルに出す名前] の一覧。この並び順が、下の presets と colors の並び順（12色）に対応する。
  const labels = [
    ["--bg", "全体背景"],
    ["--panel", "パネル"],
    ["--line", "境界線"],
    ["--txt", "文字"],
    ["--muted", "補助文字"],
    ["--accent", "アクセント"],
    ["--studio-button", "通常ボタン"],
    ["--studio-button-hover", "通常ホバー"],
    ["--studio-important", "重要ボタン"],
    ["--studio-important-hover", "重要ホバー"],
    ["--studio-important-shadow", "ボタン影"],
    ["--studio-canvas", "キャンバス"],
  ];
  // presets: 用意されたプリセット（navy / soft / peach）。それぞれ labels と同じ順番に12色を並べている。
  const presets = {
    navy: [
      "#002b66",
      "#103b70",
      "#42638a",
      "#e6edf7",
      "#c3d4eb",
      "#94c5dd",
      "#183f70",
      "#285382",
      "#994e3d",
      "#ad5e4a",
      "#66352d",
      "#d8dce2",
    ],
    soft: [
      "#252c38",
      "#343d4b",
      "#586578",
      "#f0f2f5",
      "#c2cbd6",
      "#95b9d2",
      "#41526a",
      "#506581",
      "#994e3d",
      "#ad5e4a",
      "#66352d",
      "#d8dce2",
    ],
    peach: [
      "#f2c9bd",
      "#fff5f0",
      "#b58c87",
      "#302c35",
      "#67575b",
      "#286f69",
      "#286f69",
      "#348980",
      "#994e3d",
      "#ad5e4a",
      "#66352d",
      "#e5e5e5",
    ],
  };
  // $: getElementById の短縮形 / root: <html>（CSS 変数を書き込む先）
  const $ = (id) => document.getElementById(id),
    root = document.documentElement;
  // #rrggbb 形式（6桁）の色かどうか
  const hex = (v) => /^#[0-9a-f]{6}$/i.test(v);
  // fields: 各色の入力欄 { picker, text }（色の番号 → 欄）/ colors: 現在の12色（最初は navy）
  const fields = new Map();
  let colors = presets.navy.slice();
  // 現在の colors を画面へ反映する: body に cl-active を付ける → 各 CSS 変数へ色を設定 → 入力欄の表示を合わせる → localStorage に保存（保存できない環境では無視）
  function apply() {
    document.body.classList.add("cl-active");
    labels.forEach(([key], i) => root.style.setProperty(key, colors[i]));
    fields.forEach((f, i) => {
      f.picker.value = colors[i];
      f.text.value = colors[i];
    });
    try {
      localStorage.setItem(KEY, JSON.stringify(colors));
    } catch (e) {}
  }
  // 12色をまとめて差し替える（プリセット選択・リセット用）
  function setColors(values, preset) {
    colors = values.slice();
    $("clPreset").value = preset;
    apply();
  }
  // i 番目の色を変更する（不正な値は無視。プリセット欄は「custom」にする）
  function update(i, value) {
    if (!hex(value)) return;
    colors[i] = value.toLowerCase();
    $("clPreset").value = "custom";
    apply();
  }
  // パネルを組み立て、ボタンを配線する（ページの読み込み後に1回だけ実行）: 色ごとの行を作る → 保存済みの色があれば復元 → プリセット・開閉・リセット・コピーを配線
  function init() {
    const host = $("clColors");
    labels.forEach(([key, label], i) => {
      const row = document.createElement("label");
      row.className = "cl-row";
      const name = document.createElement("span");
      name.textContent = label;
      const picker = document.createElement("input");
      picker.type = "color";
      picker.setAttribute("aria-label", label + " カラーピッカー");
      const text = document.createElement("input");
      text.type = "text";
      text.maxLength = 7;
      text.setAttribute("aria-label", label + " HEX");
      row.append(name, picker, text);
      host.append(row);
      fields.set(i, { picker, text });
      picker.addEventListener("input", () => update(i, picker.value));
      text.addEventListener("change", () => {
        if (hex(text.value)) update(i, text.value);
        else text.value = colors[i];
      });
    });
    try {
      // 前回保存した色が、12個すべて正しい形式なら復元する
      const stored = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(stored) && stored.length === labels.length && stored.every(hex)) {
        colors = stored;
        document.body.classList.add("cl-active");
        apply();
      }
    } catch (e) {}
    fields.forEach((f, i) => {
      f.picker.value = colors[i];
      f.text.value = colors[i];
    });
    $("clPreset").addEventListener("change", (e) => {
      if (presets[e.target.value]) setColors(presets[e.target.value], e.target.value);
    });
    // パネルの開閉（aria-expanded も更新）
    const toggle = () => {
      const panel = $("colorLabPanel");
      panel.hidden = !panel.hidden;
      $("colorLabToggle").setAttribute("aria-expanded", String(!panel.hidden));
    };
    $("colorLabToggle").addEventListener("click", toggle);
    $("clClose").addEventListener("click", () => {
      if (!$("colorLabPanel").hidden) toggle();
    });
    $("clReset").addEventListener("click", () => setColors(presets.navy, "navy"));
    // 「CSSをコピー」: 今の色を :root { --bg: ...; } の形でクリップボードへ。使えない環境では textarea 経由の古い方法で代替する
    $("clCopy").addEventListener("click", async () => {
      const css =
        ":root {\n" +
        labels.map(([key], i) => "  " + key + ": " + colors[i] + ";").join("\n") +
        "\n}";
      try {
        await navigator.clipboard.writeText(css);
        $("clStatus").textContent = "CSSをコピーしました。";
      } catch (e) {
        const area = document.createElement("textarea");
        area.value = css;
        document.body.append(area);
        area.select();
        try {
          document.execCommand("copy");
          $("clStatus").textContent = "CSSをコピーしました。";
        } catch (err) {
          $("clStatus").textContent = "コピーできませんでした。";
        }
        area.remove();
      }
    });
  }
  // DOM の準備ができていればすぐ実行、まだなら読み込み完了を待つ
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
