/* Añadir contenido desde una dirección (URL), de punta a punta.

   Va en navegador porque lo que se prueba es el encadenado: que el paso
   1 diga qué ha llegado sin tocar el árbol, que el paso 2 sea el único
   que lo toca, y que una descarga en curso se pueda cancelar en el acto
   —sin esperar a que venza el tope de 20 s, que fue justo lo que se
   pidió al revisar el plan—.

   DETALLE QUE CONDICIONA TODA LA SUITE: la CSP admite `'self' https:`,
   así que una descarga a `http://127.0.0.1:otro-puerto` la bloquea la
   POLÍTICA, no el servidor. Por eso los casos que deben funcionar se
   sirven desde el MISMO origen que la aplicación, con un servidor
   propio que devuelve el HTML en `/` y los ejemplos en `/fix/*`. El
   caso de "no se puede conectar" usa a propósito un segundo puerto: ahí
   el rechazo viene de la CSP y no de CORS, pero los dos llegan a la
   página como el MISMO `TypeError` sin detalle, que es la rama que se
   quiere probar y la razón de que su mensaje hable de CORS.          */
import fs from "node:fs";
import http from "node:http";
import { launch, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER URL IMPORT TESTS OK");

const HTML = fs.readFileSync(READABLE);
const GEOJSON = JSON.stringify({ type: "FeatureCollection", features: [
  { type: "Feature", properties: { name: "Faro" },
    geometry: { type: "Point", coordinates: [-3.7, 40.4] } }] });
const KML = '<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
  + "<Placemark><name>Torre</name><Point><coordinates>-3.6,40.5,0</coordinates></Point>"
  + "</Placemark></Document></kml>";

/* Rutas del servidor. Cada una existe por un caso de la suite. */
let colgada = null;   /* respuesta que nunca termina, para cancelar */
const srv = http.createServer((q, s) => {
  const ruta = q.url.split("?")[0];
  if (ruta === "/fix/datos.geojson") {
    s.writeHead(200, { "Content-Type": "application/geo+json" }); s.end(GEOJSON); return;
  }
  if (ruta === "/fix/descarga") {              /* sin extensión: prueba la síntesis */
    s.writeHead(200, { "Content-Type": "application/vnd.google-earth.kml+xml" }); s.end(KML); return;
  }
  if (ruta === "/fix/mapa.kmz") {              /* firma de zip, no un zip completo */
    s.writeHead(200); s.end(Buffer.from([0x50, 0x4B, 0x03, 0x04, 1, 2, 3, 4])); return;
  }
  if (ruta === "/fix/pagina.html") {
    s.writeHead(200, { "Content-Type": "text/html" });
    s.end("<!DOCTYPE html><html><body>Repositorio</body></html>"); return;
  }
  if (ruta === "/fix/nada.json") { s.writeHead(200); s.end('{"algo":1}'); return; }
  if (ruta === "/fix/enorme.json") {           /* miente en content-length a propósito */
    s.writeHead(200, { "Content-Length": String(500 * 1024 * 1024) });
    s.end("{}"); return;
  }
  if (ruta === "/fix/lenta") {                 /* no responde nunca: para cancelar */
    s.writeHead(200, { "Content-Type": "application/json" });
    s.write("{");
    colgada = s;
    return;
  }
  if (ruta.startsWith("/fix/")) { s.writeHead(404); s.end("no"); return; }
  s.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  s.end(HTML);
});
await new Promise(r => srv.listen(8849, "127.0.0.1", r));
const base = "http://127.0.0.1:8849";

/* Segundo origen, para el fallo de conexión */
const otro = http.createServer((q, s) => { s.writeHead(200); s.end(GEOJSON); });
await new Promise(r => otro.listen(8850, "127.0.0.1", r));

const browser = await launch();
const { page, errors } = await openApp(browser, base + "/");

/* Los tres pasos del gesto, con clics de verdad */
const abrir = () => page.click("#url-btn");
const escribir = async url => {
  await page.fill("#url-input", url);
  /* `fill` no dispara el `input` que invalida una descarga anterior en
     todos los casos; se fuerza para reproducir el tecleo real.      */
  await page.dispatchEvent("#url-input", "input");
};
const descargar = () => page.click("#url-fetch");
const estado = () => page.evaluate(() => ({
  texto: document.getElementById("url-status").textContent,
  visible: !document.getElementById("url-status").hidden,
  mal: document.getElementById("url-status").classList.contains("sh-bad"),
  puedeAnadir: !document.getElementById("url-add").hidden,
  boton: document.getElementById("url-fetch").textContent,
  botonActivo: !document.getElementById("url-fetch").disabled,
  abierto: !document.getElementById("url-dialog").hidden
}));
const esperarResultado = () => page.waitForFunction(() => {
  const s = document.getElementById("url-status");
  return !s.hidden && !/^Descargando/.test(s.textContent);
}, null, { timeout: 15000 });
const raiz = () => page.evaluate(() =>
  [...document.querySelectorAll("#tree > ul > li")].map(li => li._name));
/* Todo cuelga de UNA sección «Descargas», como «Lugares» o
   «Elevaciones», y dentro va una «Descarga N» por descarga.        */
const dentroDeLaUltima = () => page.evaluate(() => {
  const seccion = [...document.querySelectorAll("#tree > ul > li")]
    .find(li => li._name === "Descargas");
  if (!seccion) return null;
  const sul = seccion.querySelector(":scope > ul.node-list");
  const carpetas = sul ? [...sul.children].filter(li => /^Descarga \d+$/.test(li._name || "")) : [];
  const ultima = carpetas[carpetas.length - 1];
  if (!ultima) return { seccion: seccion._name, carpetas: [], carpeta: null, hijos: [], pendientes: [] };
  const ul = ultima.querySelector(":scope > ul.node-list");
  return { seccion: seccion._name, carpetas: carpetas.map(li => li._name), carpeta: ultima._name,
    hijos: ul ? [...ul.children].map(li => li._name) : [],
    pendientes: ultima._pending ? ultima._pending.map(r => r.name) : [] };
});

/* ---------- 1. Camino feliz: GeoJSON ---------- */
await abrir();
await escribir(base + "/fix/datos.geojson");
await descargar();
await esperarResultado();
let e = await estado();
ok(e.puedeAnadir, "tras descargar aparece «Añadir al árbol»: " + JSON.stringify(e));
ok(/GeoJSON/.test(e.texto) && /datos\.geojson/.test(e.texto),
  "y el diálogo dice QUÉ ha llegado: " + e.texto);
ok(!e.mal, "en tono normal, que no es un fallo");
/* Con el resultado en la mano, «Descargar» deja de tener sentido:
   quedan las dos salidas que sí significan algo.                    */
ok(!e.botonActivo, "y «Descargar» queda deshabilitado: " + JSON.stringify(e));
ok((await raiz()).length === 0, "y el árbol sigue intacto: el paso 1 no toca nada");

/* Pero no es un callejón: tocar la dirección lo reactiva */
await escribir(base + "/fix/datos.geojson?otra=1");
let tras = await estado();
ok(tras.botonActivo && !tras.puedeAnadir,
  "cambiar la dirección invalida el resultado y reactiva «Descargar»: " + JSON.stringify(tras));
await escribir(base + "/fix/datos.geojson");
await descargar();
await esperarResultado();
e = await estado();
ok(e.puedeAnadir && !e.botonActivo, "y descargando otra vez se vuelve al mismo sitio");
await page.click("#url-add");
await page.waitForTimeout(800);
/* Todo lo descargado entra en SU carpeta numerada: sin ella el
   resultado depende del formato —un GeoJSON crea envoltorio y un KML
   vuelca su jerarquía en la raíz— y lo traído se mezcla con lo que ya
   había sin dejar rastro de dónde vino.                             */
let dentro = await dentroDeLaUltima();
ok((await raiz()).includes("Descargas") && !(await raiz()).includes("Descarga 1"),
  "todo cuelga de la sección «Descargas», no de la raíz: " + JSON.stringify(await raiz()));
ok(dentro && dentro.carpeta === "Descarga 1",
  "y dentro va «Descarga 1»: " + JSON.stringify(dentro.carpetas));
ok(dentro && [...dentro.hijos, ...dentro.pendientes].includes("datos.geojson"),
  "y el archivo queda dentro de ella: " + JSON.stringify(dentro));
ok(!(await estado()).abierto, "y el diálogo se cierra, para no tapar los suyos");

/* ---------- 2. Una URL SIN extensión ----------
   Es la prueba de la síntesis: handleDroppedFiles despacha por
   extensión, así que sin ella lo descargado se rechazaría a sí mismo. */
await abrir();
await escribir(base + "/fix/descarga");
await descargar();
await esperarResultado();
e = await estado();
ok(/KML/.test(e.texto) && /descarga\.kml/.test(e.texto),
  "una dirección sin extensión se reconoce por su contenido y se nombra sola: " + e.texto);
await page.click("#url-add");
await page.waitForTimeout(800);
/* OJO: el nodo NO se llama «descarga.kml». Un KML vuelca su propia
   jerarquía en la raíz —envolverlo añadiría un nivel que el archivo no
   tiene—, así que lo que aparece es su placemark. Lo que esto demuestra
   es justo lo que interesa: la extensión sintetizada acertó de rama, y
   por eso la importación lo entendió como KML en vez de rechazarlo por
   formato no admitido.                                               */
dentro = await dentroDeLaUltima();
ok(dentro && dentro.carpeta === "Descarga 2" && dentro.carpetas.length === 2,
  "la segunda numera sola y REUTILIZA la sección, no crea otra: "
  + JSON.stringify({ raiz: await raiz(), dentro: dentro.carpetas }));
/* OJO: dentro NO hay ningún «descarga.kml». Un KML vuelca su propia
   jerarquía —envolverlo añadiría un nivel que el archivo no tiene—, así
   que lo que aparece es su placemark, ahora bajo la carpeta. Que esté
   ahí es lo que demuestra que la extensión sintetizada acertó de rama:
   con otra, la importación lo habría rechazado por formato.        */
ok(dentro && [...dentro.hijos, ...dentro.pendientes].includes("Torre"),
  "y el KML entra con su jerarquía dentro de la carpeta: " + JSON.stringify(dentro));

/* ---------- 3. KMZ: solo el paso 1 ----------
   Basta la firma del zip; construir uno válido aquí no probaría nada
   que no cubra ya groundoverlaytest.js.                             */
await abrir();
await escribir(base + "/fix/mapa.kmz");
await descargar();
await esperarResultado();
e = await estado();
ok(/KMZ/.test(e.texto), "un zip se reconoce como KMZ por sus primeros bytes: " + e.texto);
await page.click("#url-close");

/* ---------- 4. Una página HTML ----------
   El error más útil de todos: es lo que llega al pegar la página de
   GitHub en vez del enlace «Raw».                                   */
await abrir();
await escribir(base + "/fix/pagina.html");
await descargar();
await esperarResultado();
e = await estado();
ok(!e.puedeAnadir && e.mal, "una página HTML no se puede añadir");
ok(/HTML/.test(e.texto) && /Raw/.test(e.texto),
  "y se dice qué hacer en su lugar: " + e.texto);

/* ---------- 5. JSON que no es de ningún formato nuestro ---------- */
await escribir(base + "/fix/nada.json");
await descargar();
await esperarResultado();
e = await estado();
ok(!e.puedeAnadir && /No se reconoce/.test(e.texto), "formato no reconocido: " + e.texto);

/* ---------- 6. HTTP 404 ---------- */
await escribir(base + "/fix/noexiste.geojson");
await descargar();
await esperarResultado();
e = await estado();
ok(!e.puedeAnadir && /404/.test(e.texto), "el 404 se traduce a algo legible: " + e.texto);

/* ---------- 7. Tope de tamaño, por lo que el servidor DICE ----------
   Se corta antes de leer el cuerpo: es la comprobación barata.      */
await escribir(base + "/fix/enorme.json");
await descargar();
await esperarResultado();
e = await estado();
ok(!e.puedeAnadir && /supera el tope/.test(e.texto),
  "un content-length desmedido corta antes de descargar: " + e.texto);

/* ---------- 8. No se puede conectar ----------
   Se anota el estado ANTES: este caso provoca a propósito una violación
   de CSP y un error de consola, y hay que poder distinguirlos de los
   que no se esperan.                                                 */
const cspAntes = (await page.evaluate(() => window.__csp)).length;
const erroresAntes = errors.length;
await escribir("http://127.0.0.1:8850/x.geojson");
await descargar();
await esperarResultado();
e = await estado();
ok(!e.puedeAnadir && /CORS/.test(e.texto),
  "un rechazo sin detalle se explica por su causa más probable: " + e.texto.slice(0, 60));

/* ---------- 9. Cancelar una descarga en vuelo ----------
   Lo pedido al revisar el plan: no hay que esperar al tope de tiempo. */
await escribir(base + "/fix/lenta");
await descargar();
await page.waitForFunction(() =>
  document.getElementById("url-fetch").textContent === "Cancelar descarga", null, { timeout: 5000 });
e = await estado();
ok(e.boton === "Cancelar descarga",
  "mientras descarga, el botón primario pasa a cancelar: " + e.boton);
await page.click("#url-fetch");
await page.waitForTimeout(300);
e = await estado();
ok(/cancelada/i.test(e.texto) && !e.mal,
  "cancelar lo dice, y no en rojo: cancelar no es un fallo — " + e.texto);
ok(e.abierto && !e.puedeAnadir, "el diálogo sigue abierto y no hay nada que añadir");
ok((await page.inputValue("#url-input")) === base + "/fix/lenta",
  "con la dirección intacta, para corregirla y reintentar");
ok(e.boton === "Descargar", "y el botón vuelve a su papel: " + e.boton);

/* Y reintentar después de cancelar funciona */
await escribir(base + "/fix/datos.geojson");
await descargar();
await esperarResultado();
ok((await estado()).puedeAnadir, "tras cancelar, una descarga nueva funciona igual");

/* ---------- 10. Cerrar con una descarga en vuelo ---------- */
await escribir(base + "/fix/lenta");
await descargar();
await page.waitForFunction(() =>
  document.getElementById("url-fetch").textContent === "Cancelar descarga", null, { timeout: 5000 });
const antes = (await raiz()).length;
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
ok(!(await estado()).abierto, "Escape cierra el diálogo aunque esté descargando");
ok((await raiz()).length === antes, "y no añade nada");
/* Reabrir parte de cero: describir una descarga que ya no está sería
   mentir sobre lo que se va a insertar.                             */
await abrir();
e = await estado();
ok(!e.puedeAnadir && !e.visible, "al reabrir, estado inicial: " + JSON.stringify(e));
await page.click("#url-close");

/* ---------- 11. Una dirección larguísima cabe si se agranda ----------
   Es la razón de que esta ventana se redimensione: mil caracteres no
   se ven en una caja fija. Lo que se mide es lo que el usuario nota —
   cuánto del campo queda sin ver— antes y después de agrandarla, y que
   los botones sigan dentro al encogerla.                            */
await abrir();
const LARGA = "https://ejemplo.com/descargas/" + "a".repeat(950) + "/datos.geojson";
await escribir(LARGA);
const caja = tam => page.evaluate(t => {
  const box = document.querySelector("#url-dialog .dlg-box");
  if (t) { box.style.width = t[0] + "px"; box.style.height = t[1] + "px"; }
  const ta = document.getElementById("url-input");
  const rb = box.getBoundingClientRect();
  const acc = document.querySelector("#url-dialog .dlg-actions").getBoundingClientRect();
  return { sinVer: Math.round(ta.scrollHeight - ta.clientHeight),
    botonesDentro: Math.round(rb.bottom - acc.bottom) >= 0 && acc.top >= rb.top,
    resize: getComputedStyle(box).resize };
}, tam);
const normal = await caja(null);
ok(normal.resize === "both", "la ventana se redimensiona: " + normal.resize);
ok(normal.sinVer > 0, "y al tamaño de partida la dirección no cabe entera: "
  + normal.sinVer + " px sin ver");
const grande = await caja([900, 520]);
ok(grande.sinVer === 0,
  "agrandándola se ve entera, que es para lo que sirve el tirador: "
  + grande.sinVer + " px sin ver");
const pequena = await caja([300, 200]);
ok(pequena.botonesDentro, "y encogida a 300×200 los botones siguen dentro de la caja");
/* El asa de arrastre es el título: mover la ventana no puede depender
   de que el contenido no haya scrolleado.                           */
const movida = await page.evaluate(async () => {
  const box = document.querySelector("#url-dialog .dlg-box");
  const antes = Math.round(box.getBoundingClientRect().x);
  const h2 = box.querySelector("h2").getBoundingClientRect();
  const ev = (t, x, y) => box.querySelector("h2").dispatchEvent(
    new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  ev("pointerdown", h2.x + 30, h2.y + 8);
  ev("pointermove", h2.x - 90, h2.y + 48);
  ev("pointerup", h2.x - 90, h2.y + 48);
  return { antes, despues: Math.round(box.getBoundingClientRect().x) };
});
ok(movida.antes !== movida.despues,
  `y la ventana se mueve arrastrando su título: x ${movida.antes} → ${movida.despues}`);
await page.click("#url-close");

/* ---------- 12. La CSP permite todo esto ----------
   Ninguna violación ANTES del caso que la provoca a propósito: es lo
   que demuestra que la política nueva deja pasar las descargas buenas.
   Y una sola después, la del segundo origen.                         */
const csp = await page.evaluate(() => window.__csp);
ok(cspAntes === 0, "las descargas buenas no violan la CSP: " + JSON.stringify(csp.slice(0, cspAntes)));
ok(csp.length === cspAntes + 1 && /8850/.test(csp[csp.length - 1]),
  "y la única violación es la provocada a propósito: " + JSON.stringify(csp.slice(cspAntes)));

/* Los errores de consola de los casos 6 y 8 son el objeto de esos
   casos (un 404 y una conexión rechazada), así que se separan de los
   que no espera nadie.                                               */
const esperados = /404|127\.0\.0\.1:8850|Content Security Policy|Refused to connect/;
const inesperados = errors.filter(t => !esperados.test(t));
ok(inesperados.length === 0, "sin errores de página inesperados: " + JSON.stringify(inesperados));
ok(erroresAntes <= errors.length, "los esperados llegaron donde debían");

if (colgada) colgada.end();
await browser.close();
srv.close();
otro.close();
done();
