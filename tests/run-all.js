#!/usr/bin/env node
/* Lanzador de la batería de pruebas de KITE Local.
   Uso:  node tests/run-all.js  [--bench]
   Los tests extraen las funciones del propio kitelocal.html y las
   ejecutan en Node, así que comprueban EL CÓDIGO QUE SE ENTREGA, no una
   copia. Los que necesitan un DOM usan linkedom (HTML) o @xmldom/xmldom
   (XML, porque linkedom no implementa espacios de nombres).          */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SUITES = [
  ["kmltest.js",    "Parseo de KML: espacios de nombres, estilos, geometrías"],
  ["repairtest.js", "Reparación de prefijos XML sin declarar"],
  ["htmltagstest.js", "Detección y limpieza de etiquetas tipo HTML en nombres de un KML"],
  ["kmldupetest.js", "Detección y fusión de placemarks duplicados (mismo nombre y posición)"],
  ["clamptest.js",  "Coordenadas: validación y tolerancia de redondeo"],
  ["utmtest.js",    "Conversión a UTM y husos"],
  ["coordfmt.js",   "Formato de coordenadas: decimal, GMS con espacios y GMS compacto"],
  ["elevtest.js",   "Elevaciones: WCS del IGN, coberturas, formatos, rejilla"],
  ["pnoahisttest.js", "PNOA histórico: descubrimiento de capas del WMS del IGN"],
  ["copernicustest.js", "Copernicus DEM: instance ID de Sentinel Hub y sus capas"],
  ["navtest.js",    "Navegación del árbol y selección por rangos"],
  ["a11ytreetest.js", "Accesibilidad del árbol: role=group del <ul> raíz, aria-label de las casillas"],
  ["selcorrect.js", "Selección: cursor y nodos de nivel superior"],
  ["reporttest.js", "Informe de importación"],
  ["placemarklayertest.js", "buildPlacemarkLayer: un placemark sin geometría útil cuenta una sola vez; PolyStyle.outline no oculta una línea sin polígono"],
  ["newfeat.js",    "Saneado de fichas, Ctrl+A y zonas de arrastre"],
  ["topojsontest.js",     "Conversión de TopoJSON a GeoJSON"],
  ["groundoverlaytest.js","GroundOverlay: LatLonBox y resolución de assets del KMZ"],
  ["bytesfmt.js",         "Formato de tamaños: bytes/KB/MB/GB"],
  ["reordertest.js",      "Orden de pintado: bringLayerToFront por tipo, reorderPaintOrder por árbol"],
  ["pngnametest.js",      "Nombre de archivo del PNG exportado: marca de tiempo con zero-padding"],
  ["geojsonnametest.js",  "Propiedad-nombre de GeoJSON, tabla de properties y menú contextual con varias capas"],
  ["cascadetest.js",      "Cascada de visibilidad por lotes: cesión del hilo, doble toggle rápido, borrado a mitad"],
  ["lazytree.js",         "Construcción perezosa de filas para carpetas colapsadas (materializeRecords/ensureMaterialized)"],
  ["pointsedit.js", "Editor de la lista de puntos: formato TSV, anillos, errores"],
  ["msglog.js", "Avisos: fusión de repetidos con contador y registro de sesión"],
  ["naming.js", "Autonumerado de formas dibujadas y mediciones"],
  ["measure.js", "Mediciones: estilo propio, medidas del diálogo y renombrado sin perder la medida"],
  ["icons.js", "Iconos MDI empotrados: catálogo y tabla sincronizados, sin red en ejecución"],
  ["boot.js", "Arranque: el panel no concluye «no hay capas» antes de leer IndexedDB"],
  ["attribution.js", "Línea inferior del visor: versión, enlace al repositorio y escala"],
  ["minified.js", "kitelocal.min.html: el minificado que sirve Pages no viene roto del proceso"],
  ["statics.js", "Comprobaciones estáticas: todo id referido existe y toda función llamada está declarada"],
  ["tristate.js", "Tercer estado de la casilla: indeterminada cuando la carpeta está a medias"],
  ["usage.js", "Pie del panel: la línea de memoria se esconde si no hay cifra que dar"],
  ["clipboard.js", "Portapapeles del sistema: copiar y pegar entre instancias de distinto dominio"],
  ["hittest.js", "Acierto bajo el cursor: geometría real, no caja envolvente"],
  ["openshape.js", "Formas abiertas: una línea no tiene área ni relleno"],
  ["polyarea.js",         "Perímetro y área de polígonos: anillos cerrados/sin cerrar, agujeros, multipolígono"],
  ["toolstest.js",        "showLayerInfo/setTool: el panel de información no se cuela ni queda pegado al salir de una herramienta de dibujo"]
];
const BENCH = [["selbench.js", "Coste de seleccionar y de topLevelSelection"]];

/* Suites que necesitan un NAVEGADOR de verdad. Prueban lo que Node no
   puede decir: que la aplicación arranque, que los iconos empotrados se
   pinten, que el minificado se comporte igual que el legible y que el
   portapapeles del sistema lleve un árbol de una instancia a otra.
   Todo eso se comprobaba a mano, fuera del repositorio, y por tanto
   casi nunca.                                                        */
const BROWSER = [
  ["browser/app.mjs", "Navegador: la aplicación arranca y funciona, en los DOS artefactos"],
  ["browser/clipboard.mjs", "Navegador: copiar y pegar entre instancias de distinto origen, con el portapapeles real"],
  ["browser/geojson-html.mjs", "Navegador: etiquetas tipo HTML en properties de GeoJSON, de punta a punta"]
];

const html = path.join(__dirname, "..", "kitelocal.html");
if (!fs.existsSync(html)) {
  console.error(`No se encuentra ${html}. Los tests deben ir junto al visor.`);
  process.exit(2);
}

/* Las dependencias se comprueban antes de lanzar nada: si faltan, todas
   las suites fallarían con un error de módulo que no dice qué hacer. */
const DEPS = ["linkedom", "@xmldom/xmldom"];
const missing = DEPS.filter(d => {
  try { require.resolve(d); return false; } catch { return true; }
});
if (missing.length) {
  console.error(`Faltan dependencias de prueba: ${missing.join(", ")}\n`
    + `Instálelas con:\n\n    npm install ${DEPS.join(" ")}\n\n`
    + "Solo hacen falta para los tests; el visor no depende de ellas.");
  process.exit(2);
}

/* kitelocal.html es GENERADO desde src/. Las suites lo leen a él, que es
   lo que se entrega, así que hay que asegurarse de que corresponde a las
   fuentes actuales: si no, se probaría una versión vieja y pasarían
   pruebas que no dicen nada del código que se acaba de escribir.
   Se COMPRUEBA, no se construye: un runner de pruebas que reescribe un
   archivo del repo ensucia el árbol de trabajo sin avisar y, peor,
   enmascara justo este error. La comparación es por CONTENIDO, nunca
   por fecha: los mtime no sobreviven a un `git checkout`.
   Cubre también kitelocal.min.html, la derivada que sirve Pages: es el
   artefacto que nadie mira, así que es justo el que se queda atrás.  */
try {
  execFileSync(process.execPath, [path.join(__dirname, "..", "build.js"), "--check"], { stdio: "pipe" });
  console.log("✓ kitelocal.html y kitelocal.min.html están al día respecto de src/");
} catch (e) {
  console.error((e.stdout || "") + (e.stderr || ""));
  process.exit(1);
}

/* Antes que nada, lo más barato: que el script sea válido */
const script = fs.readFileSync(html, "utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];
const tmp = path.join(require("os").tmpdir(), "kite-script-check.js");
fs.writeFileSync(tmp, script);
try {
  execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  console.log("✓ node --check del script incrustado");
} catch (e) {
  console.error("✗ el script incrustado no es válido\n" + e.stderr);
  process.exit(1);
}

const run = list => list.reduce((failed, [file, desc]) => {
  process.stdout.write(`\n── ${desc}\n`);
  try {
    console.log(execFileSync(process.execPath, [path.join(__dirname, file)],
      { encoding: "utf8", stdio: "pipe" }).trim());
    return failed;
  } catch (e) {
    console.error((e.stdout || "") + (e.stderr || ""));
    return failed + 1;
  }
}, 0);

/* El navegador es OPCIONAL en local y OBLIGATORIO en el CI.
   Opcional para que `npm test` funcione en cualquier entorno: quien no
   pueda o no quiera descargar 300 MB sigue teniendo las suites de Node.
   Obligatorio en el CI (KITE_REQUIRE_BROWSER=1) para que esa cobertura
   no se pierda en silencio, que es lo que pasaría si saltarse las
   pruebas fuera gratis en todas partes.                              */
function runBrowserSuites() {
  let detail = "";
  try {
    execFileSync(process.execPath, [path.join(__dirname, "browser", "_detect.mjs")], { stdio: "pipe" });
  } catch (e) {
    detail = String(e.stderr || "").trim();
    const msg = "No hay navegador disponible para las pruebas de navegador.\n"
      + (detail ? `  Motivo: ${detail}\n` : "")
      + "  Instálelo con:  npx playwright install chromium\n"
      + "  O apunte a uno ya instalado:  KITE_BROWSER=/ruta/al/chrome npm test";
    if (process.env.KITE_REQUIRE_BROWSER) {
      console.error(`\n✗ ${msg}\n  (KITE_REQUIRE_BROWSER está puesto: esto es un fallo, no un salto)`);
      return { failed: 1, ran: 0 };
    }
    console.log(`\n⚠ ${msg}\n  Se SALTAN ${BROWSER.length} suite(s) de navegador.`);
    return { failed: 0, ran: 0 };
  }
  return { failed: run(BROWSER), ran: BROWSER.length };
}

const failed = run(SUITES);
const browser = runBrowserSuites();
if (process.argv.includes("--bench")) run(BENCH);

const total = SUITES.length + browser.ran;
console.log(failed + browser.failed
  ? `\n${failed + browser.failed} suite(s) con fallos.`
  : `\nTodas las suites (${total}) han pasado.`
    + (browser.ran ? "" : " (sin las de navegador)"));
process.exit(failed + browser.failed ? 1 : 0);
