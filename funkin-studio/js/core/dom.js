/* ============================================================
   core/dom.js — DOM まわりの小さな道具
   ------------------------------------------------------------
   Haxe 側にこういう道具は無いので「JS ならでは」の部分。
   DOM (Document Object Model) = ブラウザが HTML を「木構造のオブジェクト」として持っているもの。
   FlxSprite を FlxGroup に add するように、要素 (Element) を親要素に append して画面に出す。
   ============================================================ */

/** HTML 文字列 → 要素（最初の1個）。<template> を使うので、<tr> などでも安全にパースできる */
export function htmlToElement(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** HTML に埋め込む文字列のエスケープ（& < > " ' を実体参照へ） */
export function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/** document.getElementById の短縮形。エディタ内部で多用される */
export const $ = (id) => document.getElementById(id);
