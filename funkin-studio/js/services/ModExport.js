/* ============================================================
   services/ModExport.js — 各エディタの書き出しを「mod の zip ごと」にまとめる
   ------------------------------------------------------------
   これまでは json / xml / png を 1 つずつダウンロードしていた。
   今後は exportMod() に「mod の中での場所（例: data/stages/foo.json）」付きで渡すと、
     ・これまでに編集して書き出したもの（app.workspace.outputs）
     ・ホームで読み込んだ元の mod のファイル（「元の mod 全体を含める」が ON のとき）
   をまとめた zip をダウンロードさせる。zip の中身の場所は元の mod と同じなので、そのまま上書きして使える。
   ・queueExport … 同じ瞬間に何度も呼ばれる（png + json など）ものを 1 つの zip にまとめる
   ============================================================ */
import { crc32 } from "../states/chart/zip.js";
import { relPathOf, infoOf } from "./ModPack.js";

const KEY = "studio.exportWholeMod";
export const getIncludeOriginal = () => {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
};
export const setIncludeOriginal = (on) => {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {}
};

const toBytes = async (d) => (typeof d === "string" ? new TextEncoder().encode(d) : d instanceof Uint8Array ? d : new Uint8Array(await (d instanceof Blob ? d : new Blob([d])).arrayBuffer()));
const join = (a, b) => [a, b].filter(Boolean).join("/").replace(/\/+/g, "/");

/** 1 つずつ読んで、すぐ Blob にする（全部をメモリに溜めない）。entries: [{ name, get }] */
async function buildZip(entries) {
  const enc = new TextEncoder();
  const parts = [],
    central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const { name, get } of entries) {
    const data = await toBytes(await get());
    const nb = enc.encode(name),
      crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true);
    h.setUint16(10, dosTime, true);
    h.setUint16(12, dosDate, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nb.length, true);
    parts.push(new Blob([h, nb, data]));
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(12, dosTime, true);
    c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nb.length, true);
    c.setUint32(42, offset, true);
    central.push(c, nb);
    offset += 30 + nb.length + data.length;
  }
  const cd = new Blob(central);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cd.size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, cd, end], { type: "application/zip" });
}

function download(blob, name) {
  const u = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

/**
 * @param files [{ path: "data/stages/x.json", data: string | Blob | Uint8Array }]  mod の中での場所
 * @param opts  { origin: 編集した mod のフォルダ名（読み込み元と同じ階層に置く）, say(msg) }
 * @returns { name, count }
 */
export async function exportMod(app, files, opts = {}) {
  const ws = app.workspace;
  const origin = ws.rawOrigin(opts.origin ?? ws.defaultOrigin());
  for (const f of files) ws.outputs.set(join(origin, f.path), f.data);
  ws.outputOrigins.add(origin.toLowerCase()); // 元の mod のファイルは、編集した mod の分だけ含める（一緒に読み込んだ別の mod は含めない）
  const entries = [];
  const written = new Set();
  for (const [name, data] of ws.outputs) {
    entries.push({ name, get: () => data });
    written.add(name.toLowerCase());
  }
  let originalCount = 0;
  if (getIncludeOriginal()) {
    for (const f of ws.files) {
      const name = relPathOf(f);
      if (!ws.outputOrigins.has(infoOf(f).origin)) continue;
      if (written.has(name.toLowerCase())) continue; // 編集したもので置き換える
      entries.push({ name, get: () => (f.lazy ? f.blob() : f) });
      originalCount++;
    }
  }
  const base = (ws.names[0] || origin.split("/").pop() || "mod").replace(/\.zip$/i, "");
  const zipName = `${base}-edited.zip`;
  const blob = await buildZip(entries);
  download(blob, zipName);
  opts.say?.(`${zipName} を書き出しました（編集したファイル ${ws.outputs.size} 個` + (originalCount ? ` + 元の mod のファイル ${originalCount} 個）。` : "。元の mod は含めていません）。"));
  return { name: zipName, count: entries.length };
}

/** 同じ瞬間（約 80ms 以内）に積まれた書き出しを 1 つの zip にまとめる（png と json を続けて出すエディタ向け） */
let pending = null;
export function queueExport(app, file, opts = {}) {
  if (!pending) {
    pending = { files: [], opts };
    setTimeout(() => {
      const p = pending;
      pending = null;
      exportMod(app, p.files, p.opts).catch((e) => p.opts.say?.("書き出しエラー: " + e.message));
    }, 80);
  }
  pending.files.push(file);
  Object.assign(pending.opts, opts);
}
