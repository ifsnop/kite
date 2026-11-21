/* A minimal tiled GeoTIFF writer, shared by tests/browser/cog.mjs (which fabricates its
   own images byte by byte) and by tools/demo-scenes.mjs (which turns a real elevation
   grid into a proper COG for the README animation).
   Uncompressed, tiles of T x T pixels, one IFD per image (a full-size one first, then
   reduced ones with `subfile: 1`), GeoKeys for a projected or a geographic CRS.     */
/* images: [{ w, h, rgb(x, y) → [r, g, b], subfile, bits, geo? }]
   or an elevation model: { w, h, dem(x, y) → metres | null, nodata, geo }
   (one 32-bit floating-point band; null is written as `nodata`)
   geo: { model: 1 projected | 2 geographic, epsg, ox, oy, px }     */
export function writeTiff(images, T = 256) {
  const chunks = [];
  let off = 0;
  const put = buf => { const at = off; chunks.push(buf); off += buf.length; return at; };
  const header = Buffer.alloc(8);
  header.write("II", 0, "ascii"); header.writeUInt16LE(42, 2);
  put(header);
  const tiles = images.map(im => {
    const dem = typeof im.dem === "function";
    const bps = dem ? 4 : im.bits / 8, offsets = [], counts = [];
    for (let r = 0; r < Math.ceil(im.h / T); r++) {
      for (let c = 0; c < Math.ceil(im.w / T); c++) {
        const b = Buffer.alloc(T * T * (dem ? 1 : 3) * bps);
        for (let y = 0; y < T; y++) {
          for (let x = 0; x < T; x++) {
            const X = c * T + x, Y = r * T + y;
            if (X >= im.w || Y >= im.h) continue;
            if (dem) {
              const m = im.dem(X, Y);
              b.writeFloatLE(m === null ? im.nodata : m, (y * T + x) * 4);
              continue;
            }
            const px = im.rgb(X, Y);
            for (let k = 0; k < 3; k++) {
              const o = ((y * T + x) * 3 + k) * bps;
              if (bps === 1) b[o] = px[k]; else b.writeUInt16LE(px[k] * 257, o);
            }
          }
        }
        offsets.push(put(b)); counts.push(b.length);
      }
    }
    return { offsets, counts };
  });
  let nextPtr = { buf: header, pos: 4 };
  images.forEach((im, i) => {
    const e = [];
    const S = (tag, vals) => e.push({ tag, type: 3, vals });
    const LG = (tag, vals) => e.push({ tag, type: 4, vals });
    const D = (tag, vals) => e.push({ tag, type: 12, vals });
    LG(254, [im.subfile || 0]); LG(256, [im.w]); LG(257, [im.h]);
    if (typeof im.dem === "function") {
      S(258, [32]); S(259, [1]); S(262, [1]); S(277, [1]); S(284, [1]);
      S(322, [T]); S(323, [T]); LG(324, tiles[i].offsets); LG(325, tiles[i].counts); S(339, [3]);
      if (im.nodata !== undefined) e.push({ tag: 42113, type: 2, vals: [...Buffer.from(String(im.nodata) + "\0")] });
    } else {
      S(258, [im.bits, im.bits, im.bits]); S(259, [1]); S(262, [2]); S(277, [3]); S(284, [1]);
      S(322, [T]); S(323, [T]); LG(324, tiles[i].offsets); LG(325, tiles[i].counts); S(339, [1, 1, 1]);
    }
    if (im.geo) {
      const g = im.geo;
      D(33550, [g.px, g.px, 0]);
      D(33922, [0, 0, 0, g.ox, g.oy, 0]);
      const keys = g.model === 1
        ? [[1024, 0, 1, 1], [1025, 0, 1, 1], [3072, 0, 1, g.epsg]]
        : [[1024, 0, 1, 2], [1025, 0, 1, 1], [2048, 0, 1, g.epsg]];
      S(34735, [1, 1, 0, keys.length, ...keys.flat()]);
    }
    const size = { 2: 1, 3: 2, 4: 4, 12: 8 };
    const ifdLen = 2 + 12 * e.length + 4;
    const ifdAt = off;
    const ifd = Buffer.alloc(ifdLen);
    ifd.writeUInt16LE(e.length, 0);
    const extra = [];
    let extraAt = ifdAt + ifdLen;
    e.forEach((en, k) => {
      const p = 2 + 12 * k;
      ifd.writeUInt16LE(en.tag, p); ifd.writeUInt16LE(en.type, p + 2); ifd.writeUInt32LE(en.vals.length, p + 4);
      const bytes = Buffer.alloc(size[en.type] * en.vals.length);
      en.vals.forEach((v, j) => {
        if (en.type === 2) bytes[j] = v;
        else if (en.type === 3) bytes.writeUInt16LE(v, j * 2);
        else if (en.type === 4) bytes.writeUInt32LE(v, j * 4);
        else bytes.writeDoubleLE(v, j * 8);
      });
      if (bytes.length <= 4) bytes.copy(ifd, p + 8);
      else { ifd.writeUInt32LE(extraAt, p + 8); extra.push(bytes); extraAt += bytes.length; }
    });
    nextPtr.buf.writeUInt32LE(ifdAt, nextPtr.pos);
    put(ifd);
    for (const b of extra) put(b);
    nextPtr = { buf: ifd, pos: ifdLen - 4 };
  });
  return Buffer.concat(chunks);
}
