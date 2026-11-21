/* What the README animations share (tools/demo-gif.mjs and tools/demo-scenes.mjs): a
   cursor drawn over the page, a recorder of frames (screenshots of the page, with the
   dates that show fixed) and the GIF encoder.

   The browser lets no script move the system mouse nor open a desktop drag session, so
   the cursor and the file that is «dragged» are two elements drawn over the page (the
   only things added). Everything else is the real application: the drag fires the SAME
   `dragover` and `drop` events with a real `File`, and the clicks and the hovering are
   the real mouse of Playwright.

   The frames are encoded with ONE palette of 255 colours and, from one frame to the
   next, only the pixels that change are written (the rest, transparent): the map does
   not move, so the GIF weighs a fraction of what frame-by-frame would.             */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import gifenc from "gifenc"; /* CommonJS: no named exports */
const { GIFEncoder, quantize, applyPalette } = gifenc;

/* The cursor (and the chip of a file being dragged, when `file` is given) over the page.
   file: { name, bytes, type, badge }. Defines window.__demo. */
export async function installCursor(page, file = null) {
  await page.evaluate(f => {
    const st = document.createElement("style");
    st.textContent = `
      #demo-cur { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; transform: translate(-100px, -100px); }
      #demo-cur svg { display: block; filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.5)); }
      #demo-chip { position: absolute; left: 12px; top: 14px; display: none; align-items: center; gap: 7px; padding: 6px 11px;
        border-radius: 7px; background: #fff; border: 1px solid #b8b8b2; box-shadow: 0 4px 12px rgba(0,0,0,.35);
        font: 600 13px/1.2 system-ui, sans-serif; color: #222; white-space: nowrap; }
      #demo-chip b { background: #2f6f4f; color: #fff; border-radius: 4px; padding: 2px 6px; font-size: 11px; }
      #demo-ring { position: absolute; left: -15px; top: -15px; width: 30px; height: 30px; box-sizing: border-box;
        border-radius: 50%; border: 3px solid #2f6f4f; opacity: 0; }
      #demo-ring.on { opacity: .85; }`;
    document.head.appendChild(st);
    const cur = document.createElement("div");
    cur.id = "demo-cur";
    cur.innerHTML = '<div id="demo-ring"></div><svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 1 L2 22 L7.5 17 L11.5 26 L15 24.5 L11 15.5 L18 15.5 Z" '
      + 'fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'
      + (f ? `<div id="demo-chip"><b>${f.badge}</b>${f.name}</div>` : "");
    document.body.appendChild(cur);
    const demo = {
      move(x, y) { cur.style.transform = `translate(${x}px, ${y}px)`; },
      ring(on) { document.getElementById("demo-ring").classList.toggle("on", on); }
    };
    if (f) {
      /* the real file that is «dragged»: its events carry this DataTransfer */
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type }));
      demo.dt = dt;
      demo.chip = on => { document.getElementById("demo-chip").style.display = on ? "flex" : "none"; };
      demo.fire = (type, x, y) => {
        const el = document.elementFromPoint(x, y); /* ignores the cursor: pointer-events none */
        if (el) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      };
    }
    window.__demo = demo;
  }, file && { ...file, bytes: [...file.bytes] });
}

const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/* The recorder: frames of the page and the movements of the cursor. `stamp` = [date, time]
   fixes what the notices show (they carry the real date and time; the page clock is not
   touched: Leaflet times the fade of the tiles with Date and they would stay half done). */
export function recorder(page, { stamp }) {
  const frames = [];
  let cur = { x: -100, y: -100 };
  const stamps = () => page.evaluate(([date, time]) => {
    const re = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?/g;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      if (re.test(n.nodeValue)) { re.lastIndex = 0; n.nodeValue = n.nodeValue.replace(re, (m, s) => `${date} ${s ? time : time.slice(0, 5)}`); }
      re.lastIndex = 0;
    }
  }, stamp);
  const rec = {
    frames,
    get cur() { return cur; },
    set cur(v) { cur = v; },
    async snap(delay) {
      await page.evaluate(() => getSelection().removeAllRanges());
      await stamps();
      frames.push({ png: await page.screenshot({ type: "png" }), delay });
    },
    moveTo: (x, y) => page.evaluate(([a, b]) => window.__demo.move(a, b), [x, y]),
    /* Slides the cursor. With `drag`, each step is a `dragover` over what is below; with
       `hover`, the real mouse follows (so that hovering does what it does for a user). */
    async glide(to, steps, delay, { drag = false, hover = false, snap = true, wait = 0 } = {}) {
      const from = cur;
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps), x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
        await rec.moveTo(x, y);
        if (hover) await page.mouse.move(x, y);
        if (drag) await page.evaluate(([a, b]) => window.__demo.fire("dragover", a, b), [x, y]);
        if (wait) await page.waitForTimeout(wait); /* e.g. a reading that arrives asynchronously */
        if (snap) await rec.snap(delay);
      }
      cur = to;
    },
    /* A real click, with a ring that shows for one frame; `button: "right"` for the context menu */
    async click({ delayRing = 130, button = "left" } = {}) {
      await page.evaluate(() => window.__demo.ring(true));
      await rec.snap(delayRing);
      await page.mouse.click(cur.x, cur.y, { button });
      await page.evaluate(() => window.__demo.ring(false));
      await page.waitForTimeout(150);
    },
    /* The centre of an element of the page */
    async center(sel) {
      const b = await page.locator(sel).first().boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
  };
  return rec;
}

/* Frames → GIF. The palette is sampled from `picks` (fractions of the script, so that
   every stage of it is in it); index 255 is reserved for «no change». With `dump`, what
   the GIF really shows in some frames (palette and all), to judge the quality. */
export function encodeGif(frames, out, { picks = [0, 0.25, 0.45, 0.6, 1], dump = null } = {}) {
  const decoded = frames.map(f => PNG.sync.read(f.png));
  const { width: W, height: H } = decoded[0];
  const sample = [];
  for (const i of new Set(picks.map(p => Math.min(decoded.length - 1, Math.floor(decoded.length * p))))) {
    const d = decoded[i].data;
    for (let p = 0; p < d.length; p += 4 * 3) sample.push(d[p], d[p + 1], d[p + 2], 255);
  }
  const palette = quantize(new Uint8Array(sample), 255);
  while (palette.length < 255) palette.push([0, 0, 0]);
  const palette256 = [...palette.slice(0, 255), [0, 0, 0]];
  const TRANSPARENT = 255;
  const dumpPreview = (i, indexed) => {
    const png = new PNG({ width: W, height: H });
    for (let k = 0; k < indexed.length; k++) {
      const c = palette256[indexed[k]];
      png.data[k * 4] = c[0]; png.data[k * 4 + 1] = c[1]; png.data[k * 4 + 2] = c[2]; png.data[k * 4 + 3] = 255;
    }
    fs.writeFileSync(path.join(dump, `gif${String(i).padStart(3, "0")}.png`), PNG.sync.write(png));
  };
  const gif = GIFEncoder();
  let shown = null; /* what the GIF shows now: each frame only writes what changes */
  decoded.forEach((png, i) => {
    const idx = applyPalette(png.data, palette.slice(0, 255));
    if (!shown) {
      shown = Uint8Array.from(idx);
      gif.writeFrame(idx, W, H, { palette: palette256, delay: frames[i].delay, dispose: 1 });
      if (dump) dumpPreview(i, shown);
      return;
    }
    const o = new Uint8Array(idx.length);
    for (let k = 0; k < idx.length; k++) {
      if (idx[k] === shown[k]) o[k] = TRANSPARENT; else { o[k] = idx[k]; shown[k] = idx[k]; }
    }
    gif.writeFrame(o, W, H, { transparent: true, transparentIndex: TRANSPARENT, delay: frames[i].delay, dispose: 1 });
    if (dump && (i % 8 === 0 || i === decoded.length - 1)) dumpPreview(i, shown);
  });
  gif.finish();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, gif.bytes());
  const total = frames.reduce((n, f) => n + f.delay, 0);
  console.log(`✓ ${path.relative(path.join(path.dirname(new URL(import.meta.url).pathname), ".."), out)} — ${W}×${H}, ${frames.length} frames, ${(total / 1000).toFixed(1)} s, ${(gif.bytes().length / 1024).toFixed(0)} KB`);
}

/* Each frame also as a PNG, to review the script */
export function dumpFrames(frames, dir) {
  fs.mkdirSync(dir, { recursive: true });
  frames.forEach((f, i) => fs.writeFileSync(path.join(dir, `f${String(i).padStart(3, "0")}.png`), f.png));
}
