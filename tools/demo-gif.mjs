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
import { openDemoApp } from "./_demo.mjs";
import { installCursor, recorder, encodeGif, dumpFrames } from "./_gif.mjs"; /* cursor, frames and encoder shared with demo-scenes.mjs */

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
await installCursor(page, { name: KMZ_NAME, bytes: KMZ, type: "application/vnd.google-earth.kmz", badge: "KMZ" });
const R = recorder(page, { stamp: STAMP });
const { snap, glide, click, center, moveTo } = R;

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
R.cur = { x: 960, y: 80 };
await moveTo(R.cur.x, R.cur.y);
await page.evaluate(() => window.__demo.chip(true));
await snap(500);
await glide({ x: 560, y: 200 }, 6, 70);                       /* sobre el mapa */
await page.evaluate(([x, y]) => window.__demo.fire("dragover", x, y), [R.cur.x, R.cur.y]);
await glide({ x: dropBox.x, y: dropBox.y - 30 }, 10, 70, { drag: true }); /* y dentro del panel */
await glide({ x: dropBox.x, y: dropBox.y }, 3, 90, { drag: true });
await snap(800);                                              /* el panel resaltado, listo para soltar */

/* 3. Se suelta: se carga y aparece el árbol */
await page.evaluate(([x, y]) => window.__demo.fire("drop", x, y), [R.cur.x, R.cur.y]);
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
console.log(`${R.frames.length} fotogramas`);
if (DUMP) dumpFrames(R.frames, DUMP);
encodeGif(R.frames, OUT, { dump: DUMP });
