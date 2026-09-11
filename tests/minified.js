/* kitelocal.min.html: que el MINIFICADO no venga roto del proceso.

   Es la derivada que sirve GitHub Pages, y es el único artefacto que
   ninguna otra suite mira: las 22 que extraen código del archivo
   entregado lo hacen por marcadores de comentario, y `removeComments`
   los borra. Así que aquí no se prueba comportamiento —eso ya lo cubre
   el legible, que es el mismo código— sino que la TRANSFORMACIÓN no se
   ha llevado por delante nada de lo que la página necesita para
   arrancar.

   Lo que esto NO demuestra: que la aplicación funcione. Eso exige un
   navegador, y el CI aquí es solo Node; queda como comprobación manual
   documentada en CLAUDE.md. Lo que sí caza es un minificador que
   devuelva basura, que se coma un atributo crítico, o un
   kitelocal.min.html olvidado sin regenerar.                         */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { script: readable, HTML_PATH } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const MIN_PATH = path.join(__dirname, "..", "kitelocal.min.html");
if (!fs.existsSync(MIN_PATH)) {
  console.error("FAIL: no existe kitelocal.min.html. Ejecuta: npm run build");
  process.exit(1);
}
const min = fs.readFileSync(MIN_PATH, "utf8");
const full = fs.readFileSync(HTML_PATH, "utf8");

/* ---------- Se ha minificado de verdad ---------- */
/* Una minificación que no minifica nada pasaría desapercibida: el
   archivo existiría, sería válido y no ahorraría un byte.           */
ok(min.length < full.length * 0.75,
  `el minificado es bastante más pequeño que el legible: ${min.length} vs ${full.length}`);
ok(!/\/\* ={5,}/.test(min), "los comentarios de bloque han desaparecido");

/* ---------- El script embebido sigue siendo JavaScript válido ---------- */
/* La red que caza un fallo del propio terser. Mismo `node --check` que
   run-all.js hace con el legible antes de lanzar ninguna suite.     */
const m = min.match(/<script>([\s\S]*?)<\/script>/);
ok(!!m, "el minificado conserva su <script> embebido");
if (m) {
  const tmp = path.join(os.tmpdir(), "kite-min-check.js");
  fs.writeFileSync(tmp, m[1]);
  let parsed = true, err = "";
  try { execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" }); }
  catch (e) { parsed = false; err = String(e.stderr || e.message).split("\n").slice(0, 3).join(" "); }
  fs.unlinkSync(tmp);
  ok(parsed, "el script minificado parsea (node --check): " + err);
}

/* ---------- Es de la MISMA versión que el legible ---------- */
/* Se compara el VALOR de BUILD, no `const BUILD`: terser puede alinear
   la constante y borrar su declaración. Esto es lo que caza un
   kitelocal.min.html olvidado sin regenerar.                        */
const build = /const BUILD = "(\d{12})"/.exec(readable);
ok(!!build, "el legible declara BUILD");
if (build) {
  ok(min.includes(build[1]),
    `el minificado lleva la misma versión (${build[1]}); si no, está sin regenerar`);
}

/* ---------- Sobrevive lo que no puede perderse ---------- */
/* SRI: sin `integrity` el navegador bloquea Leaflet y la página queda
   en blanco. Son cinco recursos, cada uno con su `crossorigin`.     */
const count = (s, re) => (s.match(re) || []).length;
ok(count(min, /integrity=/g) === count(full, /integrity=/g),
  `los ${count(full, /integrity=/g)} integrity= siguen ahí: ${count(min, /integrity=/g)}`);
ok(count(min, /crossorigin=/g) === count(full, /crossorigin=/g),
  `y sus crossorigin=: ${count(min, /crossorigin=/g)}`);

/* CSP: con default-src 'none', perder un origen deja muda a media
   aplicación sin más síntoma que peticiones bloqueadas.             */
ok(/http-equiv="Content-Security-Policy"/.test(min), "la CSP sigue declarada");
for (const origin of ["unpkg.com", "cdnjs.cloudflare.com", "nominatim.openstreetmap.org",
                      "www.ign.es", "sh.dataspace.copernicus.eu", "default-src 'none'"]) {
  ok(min.includes(origin), `la CSP conserva ${origin}`);
}
/* Y lo que se quitó al empotrar los iconos sigue fuera también aquí */
ok(!min.includes("api.iconify.design"), "sin resucitar api.iconify.design");

/* El guardián de Leaflet, y ANTES de cualquier uso de L: si el CDN
   falla, es lo único que evita una página en blanco sin explicación. */
ok(min.includes("No se pudo cargar Leaflet"), "el guardián de Leaflet sigue ahí");
if (m) {
  const guard = m[1].indexOf("No se pudo cargar Leaflet");
  const firstUse = m[1].indexOf("L.map(");
  ok(guard >= 0 && firstUse >= 0 && guard < firstUse,
    "y precede al primer uso de L (L.map)");
}

/* Nombres de nivel superior: el producto comparte un único ámbito
   global y las pruebas de navegador acceden a esos símbolos por su
   nombre. Sobreviven porque terser deja `mangle.toplevel` en false;
   esto lo fija, para que activarlo no pase inadvertido.             */
for (const name of ["function navMessage(", "function makeNode(", "function applyMarkerStyle(",
                    "function updateMeasurement(", "function showEmptyMessage("]) {
  ok(min.includes(name), `conserva el nombre de nivel superior: ${name}`);
}

/* Los iconos MDI son datos dentro de cadenas: el minificador no debe
   tocarlos. Se comprueba uno concreto, del grupo que el usuario echó
   en falta cuando se pedían por red.                                */
const airplane = /"airplane": '([^']+)'/.exec(readable);
ok(!!airplane, "el legible trae el cuerpo de «airplane»");
if (airplane) ok(min.includes(airplane[1]), "y el minificado lo conserva intacto");

/* ---------- No quedan restos del build ---------- */
for (const mark of ["{{STYLES}}", "{{SCRIPTS}}"]) {
  ok(!min.includes(mark), `sin el marcador ${mark} sin sustituir`);
}

/* ---------- La página redirige al minificado ---------- */
/* index.html es lo que sirve Pages en la raíz; si apuntara al legible,
   todo esto no ahorraría nada.                                      */
const idx = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
ok(/url=kitelocal\.min\.html/.test(idx), "index.html redirige al minificado");
ok(idx.includes("kitelocal.html"), "y sigue ofreciendo el legible");

if (!process.exitCode) console.log("MINIFIED BUILD TESTS OK");
