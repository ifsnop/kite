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
/* Mismo criterio con VERSION (la que hornea build.js desde
   package.json): si el minificado quedara con un semver distinto,
   sería la señal de un kitelocal.min.html regenerado a partir de un
   package.json que ya no es el actual.                              */
const version = /const VERSION = "(\d+\.\d+\.\d+)"/.exec(readable);
ok(!!version, "el legible declara VERSION");
if (version) {
  ok(min.includes(version[1]),
    `el minificado lleva la misma versión semántica (${version[1]}); si no, está sin regenerar`);
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
   aplicación sin más síntoma que peticiones bloqueadas.

   Se comprueba sobre el CONTENIDO del <meta>, no sobre el archivo
   entero. Antes se buscaba cada origen con `min.includes(...)`, y eso
   pasaba por casualidad: `nominatim.openstreetmap.org` y compañía
   aparecen también en el JavaScript, así que la comprobación decía «la
   CSP conserva X» sin haber mirado nunca la CSP. Se vio al abrir
   `connect-src`: el origen desapareció de la política y la prueba
   siguió en verde.                                                   */
ok(/http-equiv="Content-Security-Policy"/.test(min), "la CSP sigue declarada");
const cspMatch = min.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/);
ok(!!cspMatch, "y se puede leer su contenido");
const csp = cspMatch ? cspMatch[1].replace(/\s+/g, " ").trim() : "";
const directiva = nombre => {
  const m = csp.match(new RegExp(`(?:^|;)\\s*${nombre}\\s([^;]*)`));
  return m ? m[1].trim() : null;
};
ok(/default-src 'none'/.test(csp), "sigue cerrada por defecto: " + csp.slice(0, 40));
/* Las listas de CÓDIGO siguen cerradas. Es lo que no se relajó al
   permitir descargar datos de cualquier sitio: un origen ajeno puede
   dar datos, nunca scripts ni estilos.                               */
for (const [nombre, origen] of [["script-src", "https://unpkg.com"],
                                ["script-src", "https://cdnjs.cloudflare.com"],
                                ["style-src", "https://unpkg.com"],
                                ["img-src", "https://www.ign.es"]]) {
  const d = directiva(nombre);
  ok(!!d && d.includes(origen), `${nombre} conserva ${origen}: ${d}`);
  ok(!!d && !/(^|\s)https:(\s|$)/.test(d), `y ${nombre} NO admite cualquier https: ${d}`);
}
/* connect-src sí es abierta, y a propósito: la dirección de la que se
   descarga la elige el usuario (botón 🔗), así que enumerar orígenes es
   imposible por definición. Que esté aquí escrito es lo que convierte
   abrirla en una decisión visible y no en algo que se cuela en un diff. */
ok(directiva("connect-src") === "'self' https:",
  "connect-src admite cualquier https, y nada más: " + directiva("connect-src"));
ok(!/http:/.test(csp), "sin http: en ninguna directiva: una página https no se degrada");
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
