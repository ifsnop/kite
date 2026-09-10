#!/usr/bin/env node
/* Regenera src/js/05-mdi-icons.js con los cuerpos SVG del catálogo.

   Los iconos van EMPOTRADOS en el producto, no se piden a la API de
   Iconify en ejecución. El motivo es medido, no estético: abrir el
   selector costaba 79 peticiones simultáneas y aplicar cada icono a un
   marcador otra más (con una URL distinta, así que ni siquiera
   compartían caché de HTTP), y pasado el límite del servicio la
   respuesta era un `429 text/plain` que se disfrazaba de dos maneras
   distintas —cuadro en blanco sin aviso en el `<img>`, «Failed to
   fetch» en el `fetch`— durante los minutos que dijera su `retry-after`
   (236 s en la medición). Empotrados son ~18 KB de `<path>`, cero
   peticiones y cero espera.

   Esto NO corre en el build: construir tiene que ser reproducible y
   sin red. Se ejecuta a mano (`npm run icons`) cuando se toca el
   catálogo MDI_ICONS de src/js/41-selection.js, y su salida se
   versiona como cualquier otra fuente. tests/icons.js comprueba que el
   catálogo y la tabla no se han desincronizado.

   Uso:  npm run icons             regenera el archivo
         npm run icons -- --check  no escribe; falla si no coincide

   `--check` NO va en `npm run check` ni en el CI a propósito: pide por
   red, y hacer que la construcción dependa de que Iconify esté en pie
   sería justo el problema que este archivo elimina. La comprobación que
   sí importa —que el catálogo y la tabla no se hayan desincronizado—
   la hace tests/icons.js sin tocar la red.                           */
const fs = require("fs");
const path = require("path");

const SRC_CATALOG = path.join(__dirname, "src", "js", "41-selection.js");
const OUT = path.join(__dirname, "src", "js", "05-mdi-icons.js");
const API = "https://api.iconify.design/mdi.json?icons=";

/* El catálogo vive donde se usa (41-selection.js), no aquí: esta lista
   es la interfaz que ve el usuario y no debe duplicarse. Se saca del
   propio fuente con el mismo criterio que usan las suites de prueba. */
function readCatalog() {
  const src = fs.readFileSync(SRC_CATALOG, "utf8");
  const i = src.indexOf("const MDI_ICONS");
  const j = src.indexOf("\n];", i);
  if (i < 0 || j < 0) throw new Error("no se encuentra MDI_ICONS en " + SRC_CATALOG);
  const pin = /const LEAFLET_PIN = "([^"]+)"/.exec(src);
  if (!pin) throw new Error("no se encuentra LEAFLET_PIN en " + SRC_CATALOG);
  const decl = src.slice(i, j + 3);
  return {
    pin: pin[1],
    groups: new Function(`const LEAFLET_PIN = ${JSON.stringify(pin[1])};\n${decl}\nreturn MDI_ICONS;`)()
  };
}

/* Una sola petición para todo el catálogo: la API en bloque devuelve
   los cuerpos y, de paso, dice cuáles no existen — que es justo la
   comprobación que antes solo se descubría en ejecución.            */
async function fetchBodies(names) {
  const resp = await fetch(API + names.join(","));
  if (!resp.ok) throw new Error(`la API de Iconify respondió HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.not_found && data.not_found.length) {
    throw new Error("iconos que no existen en el set mdi: " + data.not_found.join(", "));
  }
  const missing = names.filter(n => !data.icons[n]);
  if (missing.length) throw new Error("sin cuerpo en la respuesta: " + missing.join(", "));
  return data;
}

function render(groups, data) {
  const w = data.width || 24, h = data.height || 24;
  const lines = [];
  for (const [group, names] of groups) {
    const real = names.filter(n => data.icons[n]);
    if (!real.length) continue;
    lines.push(`  /* ${group} */`);
    for (const n of real) {
      const body = data.icons[n].body;
      /* Comillas simples para que el `fill="currentColor"` del cuerpo se
         lea tal cual; si algún icono trajera una comilla simple habría
         que escaparla, así que se comprueba en vez de suponerlo.     */
      if (body.includes("'")) throw new Error(`el cuerpo de «${n}» lleva comilla simple; ajusta el escapado`);
      lines.push(`  ${JSON.stringify(n)}: '${body}',`);
    }
  }
  return `/* ================= Iconos MDI empotrados =================
   GENERADO por fetch-icons.js (npm run icons). No editar a mano: el
   cambio se perdería en la siguiente regeneración, igual que pasa con
   kitelocal.html respecto de src/.

   Material Design Icons (Pictogrammers), licencia Apache 2.0. Los
   cuerpos vienen dibujados con \`currentColor\`, así que el color lo
   pone quien los usa: por CSS en el marcador del mapa (.mdi-pin) y
   sustituyéndolo en la vista previa del selector.

   Van empotrados a propósito: pedirlos a la API de Iconify en
   ejecución costaba 79 peticiones simultáneas al abrir el selector y
   una más por icono aplicado, y al pasar el límite del servicio los
   iconos desaparecían sin explicación durante minutos. Ver el
   comentario de fetch-icons.js.                                      */
const MDI_VIEWBOX = "0 0 ${w} ${h}";
const MDI_ICON_BODIES = {
${lines.join("\n")}
};
/* fin de MDI_ICON_BODIES */
`;
}

(async () => {
  try {
    const { pin, groups } = readCatalog();
    const names = groups.flatMap(([, ns]) => ns).filter(n => n !== pin);
    const data = await fetchBodies(names);
    const out = render(groups, data);
    if (process.argv.includes("--check")) {
      const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
      if (current === out) { console.log(`✓ ${path.basename(OUT)} está al día (${names.length} iconos)`); return; }
      console.error(`✗ ${path.basename(OUT)} NO coincide con el catálogo. Ejecuta: npm run icons`);
      process.exit(1);
    }
    fs.writeFileSync(OUT, out);
    console.log(`✓ ${path.basename(OUT)} generado: ${names.length} iconos, `
      + `${Buffer.byteLength(out, "utf8")} bytes`);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(2);
  }
})();
