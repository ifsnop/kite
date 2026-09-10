#!/usr/bin/env node
/* Construye kitelocal.html a partir de src/.

   El producto es UN SOLO archivo que se abre con doble clic: por eso el
   build es una CONCATENACIÓN literal, no un empaquetador. No minifica,
   no envuelve en un IIFE y no transforma nada. Todo el código comparte
   un único ámbito de nivel superior y las pruebas de navegador acceden
   a esos símbolos directamente; envolverlo lo rompería. Los módulos ES
   tampoco valen: Chrome los bloquea por CORS sobre file://.

   Uso:  node build.js            construye
         node build.js --check    no escribe; falla si lo construido no
                                  coincide con el kitelocal.html del disco
         node build.js --watch    reconstruye al guardar cualquier fuente
*/
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const OUT = path.join(ROOT, "kitelocal.html");

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

/* Escribe y avisa. Devuelve el tamaño para el mensaje. */
function write() {
  const out = build();
  fs.writeFileSync(OUT, out);
  return Buffer.byteLength(out, "utf8");
}

/* El paso de build es la fricción que este reparto introduce; --watch la
   quita casi entera: se deja corriendo y basta recargar el navegador.
   El retardo agrupa el guardado de varios archivos seguidos y evita
   reconstruir a medias.                                              */
if (process.argv.includes("--watch")) {
  let timer = null;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const stamp = new Date().toTimeString().slice(0, 8);
        console.log(`[${stamp}] ✓ kitelocal.html reconstruido (${write()} bytes)`);
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
  return;
}

/* Un fallo de configuración (manifiesto descuadrado, marcador perdido)
   debe leerse de un vistazo, no como una traza de pila.              */
let out;
try {
  out = build();
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(2);
}

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? read(OUT) : null;
  if (current === out) {
    console.log("✓ kitelocal.html está al día respecto de src/");
    process.exit(0);
  }
  console.error("✗ kitelocal.html NO coincide con src/: hay cambios sin construir.\n"
    + "  Ejecuta:  npm run build\n"
    + "  (si has editado kitelocal.html a mano, ese cambio se perderá: el fuente es src/)");
  process.exit(1);
}

fs.writeFileSync(OUT, out);
console.log(`✓ kitelocal.html generado desde src/ (${JS.length} archivos JS, `
  + `${Buffer.byteLength(out, "utf8")} bytes)`);
