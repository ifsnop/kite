/* El GIF de la portada del README (media/kite-demo.gif): arrastrar un KMZ a
   KITE Local y verlo abierto. Se genera con un script, igual que las capturas
   del manual, para que cuando la interfaz cambie se regenere con un comando
   (`npm run demo-gif`) y el GIF nunca enseñe una aplicación que ya no existe.

   Uso:
     npm run demo-gif                 el GIF final (hace falta red: teselas de OpenStreetMap)
     npm run demo-gif -- --sin-fondo  sin red, teselas lisas (para iterar el guion)
     npm run demo-gif -- --fotogramas carpeta   además, cada fotograma como PNG

   Qué se ve (en inglés, que es el idioma del README): la aplicación vacía, un
   archivo «operacion-sierra.kmz» que se arrastra desde fuera hasta la zona de
   soltar del panel (el panel se resalta), se suelta, se carga, y se recorre lo
   que sale: se apaga y se enciende una carpeta de zonas y se elige una capa.

   Cómo: el navegador no deja a un script mover el ratón del sistema ni abrir una
   sesión de arrastre del escritorio, así que el cursor y el archivo que se
   arrastra son dos elementos dibujados encima de la página (los únicos
   añadidos). Todo lo demás es la aplicación de verdad: el arrastre dispara los
   MISMOS eventos `dragover` y `drop` con un `File` real (docs/ejemplos/
   operacion-sierra.kmz), y los clics son clics reales del ratón de Playwright.

   Los fotogramas son capturas de la página. Se codifican con una sola paleta
   de 255 colores y, de un fotograma al siguiente, solo se escriben los píxeles
   que cambian (el resto, transparente): el mapa no se mueve, así que el GIF
   pesa una fracción de lo que pesaría fotograma a fotograma.              */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import gifenc from "gifenc"; /* CommonJS: sin exportaciones con nombre */
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { openDemoApp } from "./_demo.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const OUT = path.join(ROOT, "media", "kite-demo.gif");
const KMZ_NAME = "operacion-sierra.kmz";
const KMZ = fs.readFileSync(path.join(ROOT, "docs", "ejemplos", KMZ_NAME));

const NO_BG = process.argv.includes("--sin-fondo");
/* --fotogramas <carpeta>: además del GIF, cada fotograma como PNG (para revisar el guion) */
const DUMP = process.argv.includes("--fotogramas") ? process.argv[process.argv.indexOf("--fotogramas") + 1] : null;
const VIEW = { width: 1100, height: 700 };
const CENTER = [40.405, -3.69]; /* Madrid, el centro de la escena de ejemplo */
const ZOOM = 13;
/* Lo que fija la hora que se ve (los avisos llevan fecha y hora) */
const STAMP = ["2026-11-02", "10:30:00"];

/* ---------------- La aplicación (tools/_demo.mjs) ---------------- */
const { page, settle, close } = await openDemoApp({ viewport: VIEW, tool: "demo-gif", noBg: NO_BG });

/* La vista de partida: Madrid, donde caen las zonas del ejemplo */
await page.evaluate(([c, z]) => map.setView(c, z, { animate: false }), [CENTER, ZOOM]);
await settle();

/* ---------------- El cursor y el archivo que se arrastra ---------------- */
await page.evaluate(([name, bytes]) => {
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
    + `<div id="demo-chip"><b>KMZ</b>${name}</div>`;
  document.body.appendChild(cur);
  /* El archivo real que se «arrastra»: sus eventos llevan este DataTransfer */
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(bytes)], name, { type: "application/vnd.google-earth.kmz" }));
  window.__demo = {
    dt,
    move(x, y) { cur.style.transform = `translate(${x}px, ${y}px)`; },
    chip(on) { document.getElementById("demo-chip").style.display = on ? "flex" : "none"; },
    ring(on) { document.getElementById("demo-ring").classList.toggle("on", on); },
    fire(type, x, y) {
      const el = document.elementFromPoint(x, y); /* ignora el cursor: pointer-events none */
      if (el) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    }
  };
}, [KMZ_NAME, [...KMZ]]);

/* ---------------- Fotogramas ---------------- */
const frames = [];
/* Los avisos llevan la fecha y la hora de verdad: se fijan para que dos
   ejecuciones den lo mismo (no se toca el reloj de la página: el fundido de
   las teselas de Leaflet lo mide con Date y se quedaría a medias).         */
const stamps = () => page.evaluate(([date, time]) => {
  const re = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?/g;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    if (re.test(n.nodeValue)) { re.lastIndex = 0; n.nodeValue = n.nodeValue.replace(re, (m, s) => `${date} ${s ? time : time.slice(0, 5)}`); }
    re.lastIndex = 0;
  }
}, STAMP);
const snap = async delay => {
  await page.evaluate(() => getSelection().removeAllRanges());
  await stamps();
  frames.push({ png: await page.screenshot({ type: "png" }), delay });
};
const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
let cur = { x: -100, y: -100 };
const moveTo = (x, y) => page.evaluate(([a, b]) => window.__demo.move(a, b), [x, y]);
/* Desliza el cursor; con `drag`, cada paso es un `dragover` sobre lo que haya debajo */
async function glide(to, steps, delay, { drag = false } = {}) {
  const from = cur;
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps), x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
    await moveTo(x, y);
    if (drag) await page.evaluate(([a, b]) => window.__demo.fire("dragover", a, b), [x, y]);
    await snap(delay);
  }
  cur = to;
}
/* Un clic real, con un anillo que se ve un fotograma */
async function click(delayRing = 130) {
  await page.evaluate(() => window.__demo.ring(true));
  await snap(delayRing);
  await page.mouse.click(cur.x, cur.y);
  await page.evaluate(() => window.__demo.ring(false));
  await page.waitForTimeout(150);
}
/* El centro de un elemento de la página */
const center = async sel => {
  const b = await page.locator(sel).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const rowOf = (name, part) => page.evaluate(([n, p]) => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  const el = li.querySelector(p === "check" ? ":scope > .node-row input[type=checkbox]" : ":scope > .node-row label");
  const b = el.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}, [name, part]);

/* ---------------- El guion ---------------- */
/* 1. La aplicación vacía, con su zona para soltar archivos */
await snap(1600);

/* 2. Se arrastra el KMZ desde fuera hasta la zona de soltar del panel */
const dropBox = await center("#dropzone");
cur = { x: 960, y: 80 };
await moveTo(cur.x, cur.y);
await page.evaluate(() => window.__demo.chip(true));
await snap(500);
await glide({ x: 560, y: 200 }, 6, 70);                       /* sobre el mapa */
await page.evaluate(([x, y]) => window.__demo.fire("dragover", x, y), [cur.x, cur.y]);
await glide({ x: dropBox.x, y: dropBox.y - 30 }, 10, 70, { drag: true }); /* y dentro del panel */
await glide({ x: dropBox.x, y: dropBox.y }, 3, 90, { drag: true });
await snap(800);                                              /* el panel resaltado, listo para soltar */

/* 3. Se suelta: se carga y aparece el árbol */
await page.evaluate(([x, y]) => window.__demo.fire("drop", x, y), [cur.x, cur.y]);
await page.evaluate(() => window.__demo.chip(false));
await page.waitForFunction(() => [...document.querySelectorAll("#tree li")].some(l => l._name && /Sierra/.test(l._name)), null, { timeout: 20000 });
await page.waitForTimeout(250);
await snap(600);
await settle();
await snap(1800);

/* 4. Verlo: apagar y encender la carpeta de zonas, y elegir una capa */
const zonasCheck = await rowOf("Zonas", "check");
await glide({ x: zonasCheck.x, y: zonasCheck.y }, 9, 70);
await click();
await snap(1300);                                             /* las zonas desaparecen del mapa */
await click();
await snap(1100);                                             /* y vuelven */
const zonaA = await rowOf("Zona A", "label");
await glide({ x: zonaA.x, y: zonaA.y }, 7, 70);
await click();
for (let i = 0; i < 4; i++) { await page.waitForTimeout(110); await snap(110); } /* la capa parpadea en el mapa */
await snap(2200);

await close();
console.log(`${frames.length} fotogramas`);
if (DUMP) {
  fs.mkdirSync(DUMP, { recursive: true });
  frames.forEach((f, i) => fs.writeFileSync(path.join(DUMP, `f${String(i).padStart(3, "0")}.png`), f.png));
}

/* ---------------- GIF ---------------- */
const decoded = frames.map(f => PNG.sync.read(f.png));
const { width: W, height: H } = decoded[0];
/* Una paleta para todo el GIF, con muestras de todo el guion (vacío, arrastre,
   árbol y mapa con y sin zonas); el índice 255 queda reservado a «sin cambios». */
const sample = [];
const pick = [0, Math.floor(decoded.length * 0.25), Math.floor(decoded.length * 0.45), Math.floor(decoded.length * 0.6), decoded.length - 1];
for (const i of new Set(pick)) {
  const d = decoded[i].data;
  for (let p = 0; p < d.length; p += 4 * 3) sample.push(d[p], d[p + 1], d[p + 2], 255);
}
const palette = quantize(new Uint8Array(sample), 255);
while (palette.length < 255) palette.push([0, 0, 0]);
const palette256 = [...palette.slice(0, 255), [0, 0, 0]];
const TRANSPARENT = 255;

/* Con --fotogramas, lo que el GIF muestra de verdad en algunos fotogramas (con su paleta de
   255 colores y sin los bordes de la captura original), para juzgar la calidad. */
function dumpPreview(i, indexed) {
  const png = new PNG({ width: W, height: H });
  for (let k = 0; k < indexed.length; k++) {
    const c = palette256[indexed[k]];
    png.data[k * 4] = c[0]; png.data[k * 4 + 1] = c[1]; png.data[k * 4 + 2] = c[2]; png.data[k * 4 + 3] = 255;
  }
  fs.writeFileSync(path.join(DUMP, `gif${String(i).padStart(3, "0")}.png`), PNG.sync.write(png));
}

const gif = GIFEncoder();
let shown = null; /* lo que el GIF muestra ahora: cada fotograma solo escribe lo que cambia */
let changedTotal = 0;
decoded.forEach((png, i) => {
  const idx = applyPalette(png.data, palette.slice(0, 255));
  if (!shown) {
    shown = Uint8Array.from(idx);
    gif.writeFrame(idx, W, H, { palette: palette256, delay: frames[i].delay, dispose: 1 });
    if (DUMP) dumpPreview(i, shown);
    return;
  }
  const out = new Uint8Array(idx.length);
  let changed = 0;
  for (let k = 0; k < idx.length; k++) {
    if (idx[k] === shown[k]) out[k] = TRANSPARENT; else { out[k] = idx[k]; shown[k] = idx[k]; changed++; }
  }
  changedTotal += changed;
  gif.writeFrame(out, W, H, { transparent: true, transparentIndex: TRANSPARENT, delay: frames[i].delay, dispose: 1 });
  if (DUMP && (i % 8 === 0 || i === decoded.length - 1)) dumpPreview(i, shown);
});
gif.finish();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, gif.bytes());
const total = frames.reduce((n, f) => n + f.delay, 0);
console.log(`✓ ${path.relative(ROOT, OUT)} — ${W}×${H}, ${frames.length} fotogramas, ${(total / 1000).toFixed(1)} s, ${(gif.bytes().length / 1024).toFixed(0)} KB`);
