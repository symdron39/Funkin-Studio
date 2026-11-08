/* ============================================================
   services/MobileFilePicker.js — スマホ / タブレットでファイルが選べない問題の対策
   ------------------------------------------------------------
   症状（Android など）:
     ・accept に image/* を含む入力（PNG と XML を一緒に選ぶ欄）が「画像選択（フォト）」画面になり、XML が選べない
     ・accept=".json" / ".xml" だけの入力で、ファイル一覧は開くのに全部グレーアウトして選べない
       （ダウンロードやクラウド経由のファイルは MIME が application/octet-stream などになっていて、
         拡張子から決めた MIME と一致しないため）
   対策: タッチ操作の端末では、「画像だけ」の accept 以外は accept を外す（= 普通のファイル選択になる）。
         本来の値は data-accept に残す。種類のチェックは各エディタが拡張子で行っている（読めなければメッセージを出す）。
   デスクトップでは何もしない（accept の絞り込みはそのまま）。

   JS メモ:
     ・matchMedia("(any-pointer: coarse)") … 指でさわる入力手段があるか（CSS のメディアクエリと同じ書き方）
     ・MutationObserver … DOM に後から追加された要素（画面の HTML やボタンで作った <input>）を検知する
   ============================================================ */

/** accept が「画像だけ」か（image/* や image/png など）。画像だけなら、フォト画面で選べるのでそのままにする */
export function isImageOnlyAccept(accept) {
  const tokens = String(accept || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => t.startsWith("image/"));
}

/** image/* を含む混在 or 画像以外の accept か */
export function needsRelax(accept) {
  return !!String(accept || "").trim() && !isImageOnlyAccept(accept);
}

function relax(input) {
  if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
  const accept = input.getAttribute("accept");
  if (!needsRelax(accept)) return;
  input.dataset.accept = accept;
  input.removeAttribute("accept");
}

export function startMobileFilePicker() {
  const touch = window.matchMedia?.("(any-pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  if (!touch) return;
  const scan = (root) => {
    if (root.nodeType !== 1) return;
    relax(root);
    root.querySelectorAll?.('input[type="file"]').forEach(relax);
  };
  scan(document.body);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") relax(r.target);
      else r.addedNodes.forEach(scan);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["accept", "type"] });
}
