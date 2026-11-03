/* La imagen social (media/kite-social.png): la que sale al compartir el enlace
   de la demo (`og:image` de src/index.html) y, subida a mano en la configuración
   del repositorio (Settings › Social preview; GitHub no tiene API para ello), la
   que enseña GitHub al compartir el repositorio.

   Uso:
     npm run social-image                 la imagen final (hace falta red: teselas de OpenStreetMap)
     npm run social-image -- --sin-fondo  sin red, teselas lisas (para iterar el diseño)

   Cómo: abre la aplicación (tools/_demo.mjs) en inglés, le «suelta» el KMZ de
   ejemplo y la fotografía; después dibuja la tarjeta —texto a la izquierda, esa
   fotografía en un marco a la derecha— en una página aparte y la fotografía a
   1200×630, el tamaño que declara el `og:image:width/height` del HTML (cambiarlo
   exige cambiar también esas dos líneas). GitHub pide menos de 1 MB (el script
   avisa si se pasa) y recomienda 2:1; 1200×630 (1,91:1) se ve bien en los dos sitios.

   Texto en inglés, como el README; la fotografía es de la aplicación de verdad,
   así que cuando cambie la interfaz basta con regenerarla.                    */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDemoApp } from "./_demo.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "media", "kite-social.png");
const NO_BG = process.argv.includes("--sin-fondo");
const KMZ_NAME = "operacion-sierra.kmz";
const KMZ = fs.readFileSync(path.join(ROOT, "docs", "ejemplos", KMZ_NAME));
const ICON = fs.readFileSync(path.join(ROOT, "media", "kite-icon.svg"), "utf8").replace(/<\?xml[^>]*\?>/, "");
const CENTER = [40.405, -3.69]; /* Madrid, el centro de la escena de ejemplo */

/* ---------------- 1. La aplicación, con el KMZ de ejemplo abierto ---------------- */
const SHOT = { width: 880, height: 640 };
const { page, ctx, settle, close } = await openDemoApp({ viewport: SHOT, tool: "social-image", noBg: NO_BG });
await page.evaluate(([c]) => map.setView(c, 13, { animate: false }), [CENTER]);
await page.evaluate(async ([name, bytes]) => {
  await handleDroppedFiles([new File([new Uint8Array(bytes)], name, { type: "application/vnd.google-earth.kmz" })]);
}, [KMZ_NAME, [...KMZ]]);
await page.waitForFunction(() => [...document.querySelectorAll("#tree li")].some(l => l._name && /Sierra/.test(l._name)));
await settle();
await page.evaluate(() => getSelection().removeAllRanges());
/* La fecha de los avisos, fija: dos ejecuciones dan la misma imagen */
await page.evaluate(() => {
  const re = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) n.nodeValue = n.nodeValue.replace(re, "2026-11-02 10:30:00");
});
const shot = (await page.screenshot({ type: "png" })).toString("base64");

/* ---------------- 2. La tarjeta ---------------- */
const formats = ["KML", "KMZ", "GeoJSON", "GPX", "Shapefile", "COG"];
const card = `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; overflow: hidden; background: #f7f7f5; color: #2b2b28;
    font-family: system-ui, "Segoe UI", Roboto, "DejaVu Sans", sans-serif; position: relative; }
  .bar { position: absolute; inset: 0 0 auto 0; height: 10px; background: linear-gradient(90deg, #3388ff 55%, #4caf50 100%); }
  .left { position: absolute; left: 64px; top: 64px; width: 470px; height: 506px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand svg { width: 72px; height: 72px; flex: none; }
  h1 { font-size: 60px; line-height: 1; font-weight: 800; letter-spacing: -1px; white-space: nowrap; }
  h2 { margin-top: 18px; font-size: 27px; font-weight: 700; color: #2f6f4f; }
  p { margin-top: 20px; font-size: 25px; line-height: 1.38; color: #55554f; }
  .tags { margin-top: 26px; display: flex; flex-wrap: wrap; gap: 9px; }
  .tags span { font-size: 18px; font-weight: 700; color: #2f6f4f; border: 2px solid #2f6f4f; border-radius: 20px; padding: 3px 14px; background: #fff; }
  .foot { margin-top: auto; font-size: 19px; color: #7d7d76; line-height: 1.5; }
  .foot b { color: #2f6f4f; font-size: 22px; }
  .win { position: absolute; left: 560px; top: 118px; width: 586px; height: 427px; border-radius: 12px; overflow: hidden;
    border: 1px solid #c9c9c2; box-shadow: 0 18px 44px rgba(0,0,0,.28), 0 2px 6px rgba(0,0,0,.18); background: #fff; }
  .win img { display: block; width: 586px; height: 427px; }
</style>
<div class="bar"></div>
<div class="left">
  <div class="brand">${ICON}<h1>KITE Local</h1></div>
  <h2>KML Interactive Tree Explorer</h2>
  <p>Open KML, KMZ and more in your browser, and keep your folder tree. Your data never leaves it.</p>
  <div class="tags">${formats.map(f => `<span>${f}</span>`).join("")}</div>
  <div class="foot">One HTML file · no upload · open source<br><b>ifsnop.github.io/kite</b></div>
</div>
<div class="win"><img src="data:image/png;base64,${shot}" alt=""></div>`;

const cardPage = await ctx.newPage();
await cardPage.setViewportSize({ width: 1200, height: 630 });
await cardPage.setContent(card);
await cardPage.waitForFunction(() => [...document.images].every(i => i.complete));
const png = await cardPage.screenshot({ type: "png" });
await close();

fs.writeFileSync(OUT, png);
const kb = png.length / 1024;
console.log(`✓ ${path.relative(ROOT, OUT)} — 1200×630, ${kb.toFixed(0)} KB${kb > 1000 ? "  ⚠ GitHub pide menos de 1 MB para la vista previa social" : ""}`);
