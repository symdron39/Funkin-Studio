/* ============================================================
   ui/modLists.js — 各エディタの「mod から選ぶ」一覧の作り方（種類ごと）
   ============================================================ */
import { infoOf } from "../services/ModPack.js";

const label = (i) => (i.origin ? i.origin + " / " : "") + i.noExt;

/** Sparrow: 同じパスに XML がある PNG */
export function sparrowList(ws) {
  const xml = new Map();
  for (const f of ws.files) if (/\.xml$/i.test(f.name)) xml.set(infoOf(f).origin + "|" + infoOf(f).noExt, f);
  const out = [];
  for (const f of ws.files) {
    if (!/\.png$/i.test(f.name)) continue;
    const i = infoOf(f);
    const x = xml.get(i.origin + "|" + i.noExt);
    if (x) out.push({ label: label(i), files: { spPng: f, spXml: x } });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
/** AnimateAtlas: Animation.json があるフォルダごと（spritemap1.json / spritemap1.png と一緒に） */
export function animateList(ws) {
  const out = [];
  for (const a of ws.files) {
    if (!/^animation\.json$/i.test(a.name)) continue;
    const ai = infoOf(a);
    const dir = ai.segs.slice(0, -1).join("/");
    const same = ws.files.filter((f) => infoOf(f).segs.slice(0, -1).join("/") === dir);
    const map = same.find((f) => /^spritemap1\.json$/i.test(f.name)) || same.find((f) => /^spritemap\d*\.json$/i.test(f.name));
    const png = map && same.find((f) => f.name.replace(/\.png$/i, "") === map.name.replace(/\.json$/i, "") && /\.png$/i.test(f.name));
    if (map && png) out.push({ label: dir || "(root)", files: { png, mapfile: map, animfile: a } });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
/** Character: data/characters/*.json */
export function characterList(ws) {
  return ws.summary().characters.map((c) => ({ label: c.id + (c.origin ? `（${c.origin}）` : ""), files: { offCharacter: c.file } }));
}
/** Chart: 0.8 = data/songs/<id>/ の JSON + songs/<id>/ の音声 / 0.9 = gameplay/songs/<id>/ に JSON も音声も一緒 */
export function songList(ws) {
  const out = [];
  for (const m of ws.files) {
    const mi = infoOf(m);
    const mm = mi.noExt.match(/^(data|gameplay)\/songs\/([^/]+)\/([^/]+)-metadata(-.+)?$/);
    if (!mm || !/\.json$/i.test(m.name)) continue;
    const id = mm[2];
    const base = `${mm[1]}/songs/${id}/`;
    const audioBase = mm[1] === "gameplay" ? base : `songs/${id}/`;
    const group = ws.files.filter((f) => /\.json$/i.test(f.name) && infoOf(f).origin === mi.origin && infoOf(f).noExt.startsWith(base) && /^[^/]+-(metadata|chart)/.test(infoOf(f).noExt.slice(base.length)));
    const audio = ws.files.filter((f) => /\.(ogg|mp3|wav)$/i.test(f.name) && infoOf(f).origin === mi.origin && infoOf(f).noExt.startsWith(audioBase) && infoOf(f).noExt.slice(audioBase.length).indexOf("/") < 0);
    const inst = audio.filter((f) => /^inst/i.test(f.name)).slice(0, 1);
    const voices = audio.filter((f) => /^voices/i.test(f.name));
    out.push({ label: id + (mi.origin ? `（${mi.origin}）` : "") + (mm[1] === "gameplay" ? " [0.9]" : ""), files: { chtOpen: group, ...(inst.length ? { chtInst: inst } : {}), ...(voices.length ? { chtVoices: voices } : {}) } });
  }
  const seen = new Set();
  return out.filter((o) => !seen.has(o.label) && seen.add(o.label)).sort((a, b) => a.label.localeCompare(b.label));
}
