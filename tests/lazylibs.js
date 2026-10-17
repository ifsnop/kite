/* Librerías bajo demanda (07-lazy-libs.js): html2canvas, geotiff.js y
   proj4js dejaron de ser <script> de bloqueo del arranque. Lo que esta
   suite fija, sin navegador:

   1. Que moverlas NO debilitó la seguridad: mismo origen que ya admitía
      la CSP, versión fijada y hash SRI sha384/sha512 de la longitud que
      toca. El HTML ya no las carga (y las que se quedan siguen con su
      `integrity`).
   2. Que nadie usa el global de una de ellas sin pasar antes por
      `ensureLib` — el global solo existe tras la primera carga, y un uso
      suelto fallaría con «x is not defined» solo en la rama que nadie
      probó. Se mira cada archivo de src/js por separado.
   3. El comportamiento de `ensureLib` con un DOM de mentira: una sola
      carga aunque la pidan dos a la vez, el SRI y `crossorigin` puestos
      en el <script>, un fallo que NO se queda pegado (el siguiente
      intento vuelve a probar) y una librería ya presente que no se
      vuelve a pedir.                                                    */
const fs = require("fs");
const path = require("path");
const { script, fn, constDecl, between, HTML_PATH } = require("./_extract");

let failed = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); failed++; } };

const SRC = path.join(__dirname, "..", "src");
const html = fs.readFileSync(HTML_PATH, "utf8");

const libsSrc = between("const LAZY_LIBS", "const lazyLibPromises");
const makeEnsure = (window, document) => new Function("window", "document",
  libsSrc + "\n" + constDecl("lazyLibPromises") + "\n" + fn("ensureLib") +
  "\nreturn { LAZY_LIBS, ensureLib, lazyLibPromises };")(window, document);

/* ---------- 1. Origen, versión y SRI ---------- */
const { LAZY_LIBS } = makeEnsure({}, {});
const names = Object.keys(LAZY_LIBS);
ok(names.join() === "html2canvas,geotiff,proj4", "las tres librerías previstas: " + names);
const tags = [...html.matchAll(/<script\b[^>]*\bsrc="[^"]+"[^>]*>/g)].map(m => m[0]);
const CSP_HOSTS = ["https://unpkg.com/", "https://cdnjs.cloudflare.com/"];
const cspMeta = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || "";
for (const [name, lib] of Object.entries(LAZY_LIBS)) {
  ok(CSP_HOSTS.some(h => lib.url.startsWith(h)), `${name}: origen admitido por la CSP: ${lib.url}`);
  ok(CSP_HOSTS.every(h => !lib.url.startsWith(h) || cspMeta.includes(h.slice(0, -1))),
    `${name}: ese origen está en script-src`);
  ok(/[@/]\d+\.\d+\.\d+[/.]/.test(lib.url), `${name}: versión fijada en la URL: ${lib.url}`);
  const m = lib.integrity.match(/^sha(384|512)-([A-Za-z0-9+/]+={0,2})$/);
  ok(!!m, `${name}: SRI sha384/sha512: ${lib.integrity}`);
  if (m) ok(Buffer.from(m[2], "base64").length === Number(m[1]) / 8, `${name}: el hash tiene la longitud de sha${m[1]}`);
  ok(lib.global && lib.what, `${name}: lleva su global y su descripción`);
  ok(!tags.some(t => t.includes(lib.url)), `${name}: el HTML ya NO la carga con <script> de bloqueo`);
}
ok(new Set(names.map(n => LAZY_LIBS[n].global)).size === names.length, "los globales no se repiten");

ok(tags.length >= 4, "quedan en el HTML Leaflet, JSZip, topojson-client y shapefile: " + tags.length);
for (const t of tags) {
  ok(/integrity="sha(256|384|512)-/.test(t) && /crossorigin="anonymous"/.test(t), "con SRI y crossorigin: " + t.slice(0, 90));
}

/* ---------- 2. Ningún uso del global sin ensureLib ---------- */
/* Comentarios y cadenas fuera: se mira CÓDIGO, no lo que los textos explican */
const code = text => text
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, "")
  .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`/g, '""');
const USES = { html2canvas: /\bhtml2canvas\s*\(/, geotiff: /\bGeoTIFF\s*\./, proj4: /\bproj4\s*[.(]/ };
let guarded = 0;
for (const f of fs.readdirSync(path.join(SRC, "js")).filter(n => n.endsWith(".js") && !n.startsWith("05-"))) {
  const text = fs.readFileSync(path.join(SRC, "js", f), "utf8");
  const stripped = code(text);
  for (const [lib, re] of Object.entries(USES)) {
    if (!re.test(stripped)) continue;
    const asked = [...text.matchAll(/ensureLib\("([a-z0-9]+)"\)/g)].map(m => m[1]);
    ok(asked.includes(lib), `${f} usa ${lib} y no lo pide con ensureLib("${lib}")`);
    guarded++;
  }
}
ok(guarded >= 4, `se comprobaron los usos conocidos (62 elevación, 64 COG ×2, 34 shapefile, 52 PNG): ${guarded}`);
for (const f of fs.readdirSync(path.join(SRC, "js"))) {
  const text = fs.readFileSync(path.join(SRC, "js", f), "utf8");
  for (const m of text.matchAll(/ensureLib\("([^"]+)"\)/g)) {
    ok(LAZY_LIBS[m[1]], `${f}: ensureLib("${m[1]}") pide una librería que no existe`);
  }
}

/* ---------- 3. ensureLib con un DOM de mentira ---------- */
function fakeEnv() {
  const scripts = [];
  const window = {};
  const document = {
    head: { appendChild: s => { scripts.push(s); } },
    createElement: tag => {
      if (tag !== "script") throw new Error("solo se crean <script>");
      return { remove() { this.removed = true; } };
    }
  };
  return { scripts, window, document };
}
const tick = () => new Promise(r => setImmediate(r));

(async () => {
{
  const env = fakeEnv();
  const { ensureLib } = makeEnsure(env.window, env.document);

  const a = ensureLib("proj4"), b = ensureLib("proj4");
  ok(env.scripts.length === 1, "dos peticiones a la vez crean UN solo <script>: " + env.scripts.length);
  const s = env.scripts[0];
  ok(s.src === LAZY_LIBS.proj4.url, "con la URL fijada");
  ok(s.integrity === LAZY_LIBS.proj4.integrity, "con su SRI");
  ok(s.crossOrigin === "anonymous", "con crossorigin=anonymous");
  ok(s.referrerPolicy === "no-referrer", "y sin referrer");
  env.window.proj4 = function proj4() {};
  s.onload();
  const [ra, rb] = await Promise.all([a, b]);
  ok(ra === env.window.proj4 && rb === ra, "las dos reciben el global");

  const again = await ensureLib("proj4");
  ok(env.scripts.length === 1 && again === env.window.proj4, "ya presente: no se vuelve a pedir");
}
{
  const env = fakeEnv();
  const { ensureLib, lazyLibPromises } = makeEnsure(env.window, env.document);
  const first = ensureLib("geotiff");
  env.scripts[0].onerror();
  let msg = "";
  await first.catch(e => { msg = e.message; });
  ok(msg === "no se pudo cargar el soporte de GeoTIFF", "un fallo de red/SRI rechaza con el mensaje de siempre: " + msg);
  ok(env.scripts[0].removed === true, "y retira el <script> fallido");
  await tick();
  ok(!lazyLibPromises.has("geotiff"), "el fallo NO se queda recordado");
  const second = ensureLib("geotiff");
  ok(env.scripts.length === 2, "el siguiente intento vuelve a probar: " + env.scripts.length);
  env.window.GeoTIFF = { fromBlob() {} };
  env.scripts[1].onload();
  ok(await second === env.window.GeoTIFF, "y esta vez llega");
}
{
  /* un <script> que carga pero no deja el global (SRI bien, archivo equivocado) */
  const env = fakeEnv();
  const { ensureLib } = makeEnsure(env.window, env.document);
  const p = ensureLib("html2canvas");
  env.scripts[0].onload();
  let msg = "";
  await p.catch(e => { msg = e.message; });
  ok(msg === "no se pudo cargar el soporte de exportar PNG", "cargado sin su global también es un fallo: " + msg);

  let unknown = "";
  await ensureLib("nada").catch(e => { unknown = e.message; });
  ok(/desconocida/.test(unknown), "una librería que no existe se rechaza: " + unknown);
}

})().then(() => {
  if (failed) { console.error(`${failed} comprobación(es) fallidas`); process.exit(1); }
  console.log("LAZY LIBS TESTS OK");
}, e => { console.error(e); process.exit(1); });
