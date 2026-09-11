#!/usr/bin/env node
/* Construye kitelocal.html (y su derivada minificada) a partir de src/.

   El producto es UN SOLO archivo que se abre con doble clic: por eso el
   build es una CONCATENACIÓN literal, no un empaquetador. No minifica,
   no envuelve en un IIFE y no transforma nada. Todo el código comparte
   un único ámbito de nivel superior y las pruebas de navegador acceden
   a esos símbolos directamente; envolverlo lo rompería. Los módulos ES
   tampoco valen: Chrome los bloquea por CORS sobre file://.

   Además se escribe kitelocal.min.html, que es lo que sirve GitHub
   Pages. Es una DERIVADA del anterior, nunca una fuente: no se edita, no
   se lee y las suites de extracción no la tocan (borrar los comentarios
   las dejaría sin marcadores). Medido contra el sitio real, Pages ya
   envía gzip —152,9 KB hoy—, y minificar solo HTML y CSS apenas baja a
   144,8; lo que de verdad reduce la transmisión es minificar también el
   JavaScript, que la deja en 66,7 KB.

   Uso:  node build.js            construye los dos
         node build.js --check    no escribe; falla si lo construido no
                                  coincide con lo que hay en el disco
         node build.js --watch    reconstruye al guardar cualquier fuente
                                  (sin minificar: ver más abajo)
*/
const fs = require("fs");
const path = require("path");
const { minify } = require("html-minifier-terser");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "kitelocal.html");
const OUT_MIN = path.join(ROOT, "kitelocal.min.html");

/* ORDEN DE CARGA. No es cosmético: todo comparte un mismo ámbito y hay
   dependencias de orden que ningún `node --check` detecta — una
   variable usada dentro del `onAdd` de un control debe declararse antes
   que ese control o se cae por zona muerta temporal. Antes este
   contrato solo existía como "está más arriba en el scroll"; aquí se
   lee y se revisa en el diff. Al mover un archivo de sitio, pensarlo. */
const JS = [
  "05-mdi-icons.js",      /* GENERADO por fetch-icons.js: cuerpos SVG empotrados.
                             Va el primero por ser datos puros, sin ninguna
                             dependencia, y para que nada pueda usarlo antes  */
  "10-map.js",            /* mapa, capas de teselas, constantes globales */
  "11-base-panel.js",     /* panel de mapas base */
  "12-copernicus.js",     /* Copernicus DEM vía Sentinel Hub */
  "20-kml-geom.js",       /* coordenadas y geometrías KML */
  "30-tree-walk.js",      /* árbol: recorrido nodo a nodo */
  "31-tree-node.js",      /* árbol: fábrica de nodos */
  "32-geojson.js",        /* validación de GeoJSON y TopoJSON */
  "33-kml-import.js",     /* apertura tolerante del XML, importación */
  "40-panel-actions.js",  /* acciones del panel, buscador de lugares */
  "41-selection.js",      /* selección, Ctrl+A, portapapeles */
  "42-hittest.js",        /* acierto bajo el cursor del menú contextual */
  "43-points-editor.js",  /* lista de puntos editable, diálogos de estilo */
  "44-dialogs.js",        /* diálogos restantes y credenciales */
  "50-splitter.js",       /* separador redimensionable */
  "51-geodesy.js",        /* geodesia y UTM */
  "52-measure.js",        /* herramientas de medición */
  "60-elevation.js",      /* elevaciones: WCS, cuadrícula */
  "70-view-controls.js",  /* controles de vista y menú contextual */
  "99-boot.js"            /* arranque: restaurar el árbol guardado */
];

function read(p) { return fs.readFileSync(p, "utf8"); }

/* Un archivo suelto en src/js que nadie declare en JS se perdería en
   silencio: es el fallo evidente de tener el orden en una lista.     */
function checkManifest() {
  const onDisk = fs.readdirSync(path.join(SRC, "js")).filter(f => f.endsWith(".js")).sort();
  const declared = [...JS].sort();
  const missing = onDisk.filter(f => !declared.includes(f));
  const ghost = declared.filter(f => !onDisk.includes(f));
  if (missing.length) throw new Error(`src/js tiene archivos que no están en el manifiesto de build.js: ${missing.join(", ")}`);
  if (ghost.length) throw new Error(`el manifiesto de build.js nombra archivos que no existen: ${ghost.join(", ")}`);
}

function build() {
  checkManifest();
  const tpl = read(path.join(SRC, "index.html"));
  const css = read(path.join(SRC, "styles.css"));
  const js = JS.map(f => read(path.join(SRC, "js", f))).join("");
  for (const mark of ["{{STYLES}}", "{{SCRIPTS}}"]) {
    if (!tpl.includes(mark)) throw new Error(`src/index.html no tiene el marcador ${mark}`);
  }
  /* Se sustituye la LÍNEA entera del marcador (incluido su \n) por el
     contenido, que ya trae el suyo: así la salida no gana ni pierde
     saltos respecto del archivo original.
     El reemplazo va como FUNCIÓN, no como cadena: con una cadena, los
     `$&`, `$1`, `$'`… del contenido insertado se interpretarían como
     patrones de sustitución. No es hipotético — el propio código tiene
     un `.replace(/…/g, "\\$&")` para escapar expresiones regulares, y
     con la forma de cadena salía convertido en el marcador entero.
     Lo cazó la comprobación de identidad byte a byte.                 */
  return tpl.replace("{{STYLES}}\n", () => css).replace("{{SCRIPTS}}\n", () => js);
}

/* Opciones del minificado. Dos elecciones deliberadas:

   - `conservativeCollapse` colapsa los espacios a UNO, nunca a cero. Sin
     él, el colapso normal recorta también el espacio entre etiquetas en
     línea y pega dos palabras: hay texto así en los diálogos (ver el
     <strong>latitud, longitud y altitud</strong> de src/index.html).
     Contra gzip, conservar ese espacio no cuesta nada.
   - NO se activan `removeAttributeQuotes` ni `removeRedundantAttributes`
     ni parientes: aquí los atributos son carga útil — los cinco
     `integrity` con su `crossorigin` (sin SRI el navegador bloquea
     Leaflet y la página queda en blanco) y el <meta> de la CSP.

   `minifyJS` pasa por terser con `mangle.toplevel` en false, su valor
   por defecto: los nombres de nivel superior sobreviven, y de eso
   depende el ámbito global compartido del producto.                  */
const MINIFY_OPTS = {
  collapseWhitespace: true,
  conservativeCollapse: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: true
};
const minifyHtml = html => minify(html, MINIFY_OPTS);

/* El paso de build es la fricción que este reparto introduce; --watch la
   quita casi entera: se deja corriendo y basta recargar el navegador.
   El retardo agrupa el guardado de varios archivos seguidos y evita
   reconstruir a medias.
   AQUÍ NO SE MINIFICA, a propósito: minificar en cada pulsación devuelve
   la fricción que este modo existe para quitar, y lo que se recarga
   mientras se trabaja es el archivo legible. Quien use watch tiene que
   pasar por `npm run build` antes de empujar; si se olvida, lo caza
   `npm run check` —en local y en el CI—, que es para lo que está.    */
if (process.argv.includes("--watch")) {
  let timer = null;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const stamp = new Date().toTimeString().slice(0, 8);
        const out = build();
        fs.writeFileSync(OUT, out);
        console.log(`[${stamp}] ✓ kitelocal.html reconstruido `
          + `(${Buffer.byteLength(out, "utf8")} bytes, sin minificar)`);
      } catch (err) {
        console.error(`✗ ${err.message}`);
      }
    }, 80);
  };
  for (const dir of [SRC, path.join(SRC, "js")]) {
    fs.watch(dir, rebuild);
  }
  rebuild();
  console.log("Vigilando src/ — Ctrl+C para parar");
  console.log("  (no se genera kitelocal.min.html: haz `npm run build` antes de empujar)");
  return;
}

/* minify() es asíncrona, así que a partir de aquí todo va dentro de una
   función async. Un fallo de configuración (manifiesto descuadrado,
   marcador perdido) debe leerse de un vistazo, no como una traza.    */
(async () => {
  let out, min;
  try {
    out = build();
    min = await minifyHtml(out);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(2);
  }

  if (process.argv.includes("--check")) {
    /* Se comprueban LOS DOS y se dice cuál está desfasado: con un solo
       mensaje genérico habría que ir a mirar cuál de ellos falla.    */
    const stale = [[OUT, out], [OUT_MIN, min]]
      .filter(([file, built]) => (fs.existsSync(file) ? read(file) : null) !== built)
      .map(([file]) => path.basename(file));
    if (!stale.length) {
      console.log("✓ kitelocal.html y kitelocal.min.html están al día respecto de src/");
      process.exit(0);
    }
    console.error(`✗ ${stale.join(" y ")} NO coincide${stale.length > 1 ? "n" : ""} con src/: `
      + "hay cambios sin construir.\n"
      + "  Ejecuta:  npm run build\n"
      + "  (si has editado un archivo generado a mano, ese cambio se perderá: el fuente es src/)");
    process.exit(1);
  }

  fs.writeFileSync(OUT, out);
  fs.writeFileSync(OUT_MIN, min);
  const b = Buffer.byteLength(out, "utf8"), mb = Buffer.byteLength(min, "utf8");
  console.log(`✓ kitelocal.html generado desde src/ (${JS.length} archivos JS, ${b} bytes)`);
  console.log(`✓ kitelocal.min.html (${mb} bytes, ${(100 - 100 * mb / b).toFixed(0)}% menos) `
    + "— es lo que sirve GitHub Pages");
})();
