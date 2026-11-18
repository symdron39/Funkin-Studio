/* ============================================================
   services/uiFont.js — 画面の英数字フォント（VCR OSD Mono）を funkin.assets から読み込む
   ------------------------------------------------------------
   ・フォント本体は同梱しない。FunkinCrew/Funkin.assets の fonts/vcr.ttf（0.9 は ui/fonts/VCR OSD Mono.ttf）を
     FontFace で取得して document.fonts に足す。css の --font-ui の先頭が "FNF VCR"。
   ・取れないとき（オフライン等）は何もしない → css の次の候補（端末の等幅フォント）がそのまま使われる。
   ・日本語など VCR に無い文字は、css 側の次の候補（端末の等幅フォント）で表示される。
   ============================================================ */
import { getBranch } from "./FunkinAssets.js";

const FAMILY = "FNF VCR";
const FILES = {
  main: { regular: "fonts/vcr.ttf", bold: "fonts/vcr-bold.ttf" },
  "preview/public-playtest": { regular: "ui/fonts/VCR OSD Mono.ttf", bold: "ui/fonts/VCR OSD Mono Bold.ttf" },
};
const rawBase = () => (globalThis.__FUNKIN_ASSETS?.raw ?? "https://raw.githubusercontent.com/FunkinCrew/Funkin.assets/");

let loading = null;
/** VCR を読み込む（何度呼んでも 1 回だけ）。成功したら true */
export function loadUiFont() {
  if (loading) return loading;
  if (typeof FontFace === "undefined" || !document?.fonts) return (loading = Promise.resolve(false));
  const branch = getBranch();
  const files = FILES[branch] ?? FILES.main;
  const url = (p) => rawBase() + branch + "/" + p.split("/").map(encodeURIComponent).join("/");
  const one = async (path, weight) => {
    const f = new FontFace(FAMILY, `url("${url(path)}")`, { weight, display: "swap" });
    await f.load();
    document.fonts.add(f);
  };
  loading = Promise.all([one(files.regular, "400"), one(files.bold, "700")])
    .then(() => true)
    .catch(() => false);
  return loading;
}
