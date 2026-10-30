/* Tabla de atributos (botón ▦ de una carpeta), de punta a punta: con un
   KML que trae <ExtendedData> (hasta ahora el importador solo leía el
   nombre y la descripción), sin construir ni una fila del árbol, con
   orden, filtro, ir a una capa, CSV real y una carpeta de 5 000 capas
   de la que solo se pintan las filas que se ven.                       */
import fs from "node:fs";
import { launch, serve, openApp, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER ATTR TABLE TESTS OK");

const pm = (name, data, lat, lng) => `<Placemark><name>${name}</name>${data ? `<ExtendedData>${data}</ExtendedData>` : ""}`
  + `<Point><coordinates>${lng},${lat}</coordinates></Point></Placemark>`;
const dat = (k, v) => `<Data name="${k}"><value>${v}</value></Data>`;
const KML = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Datos</name>`
  + pm("Madrid", dat("ref", "M-1") + dat("pob", "3200000") + dat("uso", "=SUMA(A1)"), 40.4, -3.7)
  + pm("Lyon", dat("ref", "L-2") + dat("pob", "513000"), 45.7, 4.8)
  + pm("Faro", dat("ref", "F-3") + dat("pob", "64000") + dat("uso", "a, \"b\""), 37.0, -7.9)
  + `<Placemark><name>Con ficha</name><description>solo descripción</description><Point><coordinates>0,0</coordinates></Point></Placemark>`
  + `</Document></kml>`;
const SIN = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Sin datos</name>`
  + pm("Uno", null, 1, 1) + pm("Dos", null, 2, 2) + `</Document></kml>`;
const BIG = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Grande</name>`
  + Array.from({ length: 5000 }, (_, i) => pm("P" + i, dat("i", i), 40 + (i % 50) / 100, -3 + Math.floor(i / 50) / 100)).join("") + `</Document></kml>`;

const browser = await launch();
const srv = await serve(READABLE, 8951);
const { ctx, page, errors } = await openApp(browser, srv.url);
const load = async (text, name) => { await page.evaluate(([t, n]) => { window.__imp = handleDroppedFiles([new File([t], n)]); }, [text, name]); await page.evaluate(() => window.__imp); };
await load(KML, "datos.kml");
await load(SIN, "sindatos.kml");

const clickButton = (name) => page.evaluate(n => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n);
  li.querySelector(':scope > .node-row button[aria-label^="Tabla de atributos"]').click();
}, name);
const pending = name => page.evaluate(n => { const li = [...document.querySelectorAll("#tree li")].find(x => x._name === n); return { pending: !!li._pending, rows: li.querySelectorAll(":scope > ul > li").length }; }, name);
const table = () => page.evaluate(() => ({
  open: !document.getElementById("attr-dialog").hidden,
  title: document.getElementById("attr-title").textContent,
  heads: [...document.querySelectorAll("#attr-head th")].map(t => t.textContent.replace(/ [▲▼]$/, "")),
  rows: [...document.querySelectorAll("#attr-body tr[data-i]")].map(r => [...r.children].map(td => td.textContent)),
  count: document.getElementById("attr-count").textContent,
  note: document.getElementById("attr-note").hidden ? "" : document.getElementById("attr-note").textContent
}));

/* ---- la carpeta no se despliega: sus capas son registros pendientes ---- */
const p0 = await pending("Datos");
ok(p0.pending && p0.rows === 0, "«Datos» llega cerrada, sin filas construidas: " + JSON.stringify(p0));
await clickButton("Datos");
await page.waitForFunction(() => !document.getElementById("attr-dialog").hidden);
let t = await table();
ok(t.title === "Atributos de «Datos»", "título con el nombre de la carpeta: " + t.title);
ok(t.heads.join("|") === "Nombre|ref|pob|uso", "columnas: el nombre y la unión de los <ExtendedData> en orden: " + t.heads);
ok(t.rows.length === 4 && t.count === "4 capas", "una fila por capa (la de solo descripción también): " + t.count);
ok(JSON.stringify(t.rows[0]) === JSON.stringify(["Madrid", "M-1", "3200000", "=SUMA(A1)"]), "los valores del KML: " + JSON.stringify(t.rows[0]));
ok(JSON.stringify(t.rows[3]) === JSON.stringify(["Con ficha", "", "", ""]), "una capa sin atributos, con celdas vacías");
const p1 = await pending("Datos");
ok(p1.pending && p1.rows === 0, "abrir la tabla NO desplegó la carpeta: " + JSON.stringify(p1));

/* ---- filtro ---- */
await page.fill("#attr-filter", "lyo");
t = await table();
ok(t.rows.length === 1 && t.rows[0][0] === "Lyon" && t.count === "1 de 4 capas", "filtrar por texto: " + JSON.stringify(t.rows) + " " + t.count);
await page.fill("#attr-filter", "M-1");
t = await table();
ok(t.rows.length === 1 && t.rows[0][0] === "Madrid", "también por el valor de un atributo");
await page.fill("#attr-filter", "");

/* ---- orden: numérico, ascendente y luego descendente ---- */
await page.click('#attr-head th:nth-child(3)');
t = await table();
ok(t.rows.map(r => r[0]).join() === "Faro,Lyon,Madrid,Con ficha", "por población, de menor a mayor como NÚMEROS (64000 antes que 513000), y la capa sin dato al final: " + t.rows.map(r => r[0]));
ok(t.heads.length === 4 && await page.evaluate(() => document.querySelector("#attr-head th:nth-child(3)").getAttribute("aria-sort")) === "ascending", "la cabecera lo indica (aria-sort)");
await page.click('#attr-head th:nth-child(3)');
t = await table();
ok(t.rows.map(r => r[0]).join() === "Madrid,Lyon,Faro,Con ficha", "pulsar otra vez invierte, y el vacío sigue al final: " + t.rows.map(r => r[0]));

/* ---- CSV: lo que se ve, con el filtro y el orden ---- */
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#attr-csv")]);
const csv = fs.readFileSync(await dl.path(), "utf8");
ok(dl.suggestedFilename() === "Datos.csv", "nombre del CSV: " + dl.suggestedFilename());
ok(csv.startsWith("﻿Nombre,ref,pob,uso\r\n"), "con BOM (Excel) y la cabecera: " + JSON.stringify(csv.slice(0, 40)));
ok(csv.split("\r\n")[1] === "Madrid,M-1,3200000,'=SUMA(A1)", "el orden de la pantalla y la fórmula con apóstrofo: " + JSON.stringify(csv.split("\r\n")[1]));
ok(csv.includes('Faro,F-3,64000,"a, ""b"""'), "comillas y comas escapadas: " + JSON.stringify(csv));
ok(csv.endsWith("Con ficha,,,\r\n"), "una fila sin atributos con sus celdas vacías");

/* ---- ir a una capa: materializa lo necesario, la selecciona ---- */
await page.click('#attr-body tr[data-i="1"]');
await page.waitForFunction(() => { const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Lyon"); return li && selection.has(li); });
ok(true, "pulsar una fila lleva a la capa en el árbol (la materializa y la selecciona)");
ok(await page.evaluate(() => !document.getElementById("attr-dialog").hidden), "y la tabla sigue abierta (no es modal)");

/* ---- Escape la cierra ---- */
await page.evaluate(() => document.getElementById("map").focus());
await page.keyboard.press("Escape");
ok((await table()).open === false, "Escape cierra la tabla");

/* ---- una carpeta sin atributos lo dice ---- */
await clickButton("Sin datos");
t = await table();
ok(t.heads.join() === "Nombre" && t.rows.length === 2 && /Ninguna de estas capas trae atributos/.test(t.note), "sin atributos: solo el nombre y un aviso: " + JSON.stringify(t));
await page.click("#attr-close");

/* ---- los atributos de un KML sobreviven a guardar y recargar ---- */
await page.waitForTimeout(1500);
await page.reload();
await waitAppReady(page);
await clickButton("Datos");
t = await table();
ok(t.heads.join("|") === "Nombre|ref|pob|uso" && t.rows.some(r => r[0] === "Faro" && r[1] === "F-3"), "tras recargar siguen los atributos del KML: " + JSON.stringify(t.heads));
await page.click("#attr-close");

/* ---- una carpeta grande: solo se pintan las filas que se ven ---- */
await load(BIG, "grande.kml");
await clickButton("Grande");
await page.waitForFunction(() => document.getElementById("attr-count").textContent === "5000 capas");
t = await table();
ok(t.rows.length > 5 && t.rows.length < 80, `de 5 000 capas solo hay ${t.rows.length} filas en el DOM`);
ok(t.rows[0][0] === "P0" && t.rows[0][1] === "0", "la primera fila es la primera capa");
await page.evaluate(() => { const s = document.getElementById("attr-scroll"); s.scrollTop = s.scrollHeight; });
await page.waitForFunction(() => document.querySelector('#attr-body tr[data-i="4999"]'));
t = await table();
ok(t.rows.at(-1)[0] === "P4999" && t.rows.length < 80, "al desplazar hasta el final se pintan las últimas, y siguen siendo pocas: " + t.rows.at(-1)[0]);
const heights = await page.evaluate(() => ({ scroll: document.getElementById("attr-scroll").scrollHeight, rows: 5000 * 24 }));
ok(heights.scroll >= heights.rows, "la barra de desplazamiento mide la lista entera: " + JSON.stringify(heights));
const pg = await pending("Grande");
ok(pg.pending && pg.rows === 0, "ni 5 000 capas ni su tabla despliegan la carpeta");
await page.fill("#attr-filter", "P42");
await page.waitForFunction(() => document.getElementById("attr-count").textContent.startsWith("111 de 5000"));
ok(true, "el filtro sobre 5 000 filas responde (P42, P420…P429, P4200… = 11 con el prefijo en el nombre)");

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de la CSP");
await ctx.close(); await browser.close();
srv.close();
done();
