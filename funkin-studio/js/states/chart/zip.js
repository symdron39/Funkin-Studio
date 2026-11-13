/* ============================================================
   chart/zip.js — .fnfc（= ZIP）の読み書き（外部ライブラリなし）
   ------------------------------------------------------------
   読み: 中央ディレクトリを読み、deflate は DecompressionStream("deflate-raw")、無圧縮はそのまま。
   書き: 無圧縮（store）で作る。音声（ogg/mp3）は元々圧縮済みなので、サイズはほぼ変わらない。
   ============================================================ */
let crcTable = null;
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflateRaw(data) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @returns Map<名前, Uint8Array> */
export async function readZip(buffer) {
  const u8 = new Uint8Array(buffer),
    dv = new DataView(buffer);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP として読めません（終端が見つかりません）");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true),
      csize = dv.getUint32(p + 20, true),
      nlen = dv.getUint16(p + 28, true),
      xlen = dv.getUint16(p + 30, true),
      clen = dv.getUint16(p + 32, true),
      lho = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    const lnlen = dv.getUint16(lho + 26, true),
      lxlen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnlen + lxlen;
    const raw = u8.subarray(start, start + csize);
    if (method === 0) out.set(name, raw.slice());
    else if (method === 8) out.set(name, await inflateRaw(raw));
    else throw new Error(`未対応の圧縮方式です (${name}: method ${method})`);
  }
  return out;
}

/** @param entries [{ name, data: Uint8Array }] @returns Blob */
export function writeZip(entries) {
  const enc = new TextEncoder();
  const parts = [],
    central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name),
      crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // UTF-8 名
    head.setUint16(10, dosTime, true);
    head.setUint16(12, dosDate, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, nameBytes.length, true);
    parts.push(head, nameBytes, data);
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
    c.setUint16(28, nameBytes.length, true);
    c.setUint32(42, offset, true);
    central.push(c, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cdSize = central.reduce((s, x) => s + (x.byteLength ?? x.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

/**
 * ZIP を「中身を読まずに」開く。中央ディレクトリ（名前と位置の一覧）だけ読み、
 * 各ファイルは read() を呼んだときにだけ取り出す。数百MBの mod パックでもメモリを食わない。
 * @param file File | Blob
 * @returns [{ name, size, read(): Promise<Uint8Array> }]
 */
export async function openZipLazy(file) {
  const total = file.size;
  const tailLen = Math.min(total, 65557);
  const tail = new DataView(await file.slice(total - tailLen, total).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP として読めません（終端が見つかりません）");
  let count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true),
    cdOff = tail.getUint32(eocd + 16, true);
  if (cdOff === 0xffffffff || cdSize === 0xffffffff || count === 0xffff) throw new Error("4GB を超える ZIP（ZIP64）は未対応です。mod を分けてください");
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const u8 = new Uint8Array(cd.buffer);
  const dec = new TextDecoder();
  const out = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const flags = cd.getUint16(p + 8, true),
      method = cd.getUint16(p + 10, true),
      csize = cd.getUint32(p + 20, true),
      usize = cd.getUint32(p + 24, true),
      nlen = cd.getUint16(p + 28, true),
      xlen = cd.getUint16(p + 30, true),
      clen = cd.getUint16(p + 32, true),
      lho = cd.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, "/");
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/") || (flags & 1)) continue; // フォルダ / 暗号化は対象外
    out.push({
      name,
      size: usize,
      async read() {
        const head = new DataView(await file.slice(lho, lho + 30).arrayBuffer());
        const start = lho + 30 + head.getUint16(26, true) + head.getUint16(28, true);
        const raw = new Uint8Array(await file.slice(start, start + csize).arrayBuffer());
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new Error(`未対応の圧縮方式です (${name}: method ${method})`);
      },
    });
  }
  return out;
}
