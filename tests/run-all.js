#!/usr/bin/env node
/* Lanzador de la batería de pruebas de KITE Local.
   Uso:  node tests/run-all.js  [--bench]
   Los tests extraen las funciones del propio visor-kml.html y las
   ejecutan en Node, así que comprueban EL CÓDIGO QUE SE ENTREGA, no una
   copia. Los que necesitan un DOM usan linkedom (HTML) o @xmldom/xmldom
   (XML, porque linkedom no implementa espacios de nombres).          */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SUITES = [
  ["kmltest.js",    "Parseo de KML: espacios de nombres, estilos, geometrías"],
  ["repairtest.js", "Reparación de prefijos XML sin declarar"],
  ["clamptest.js",  "Coordenadas: validación y tolerancia de redondeo"],
  ["utmtest.js",    "Conversión a UTM y husos"],
  ["coordfmt.js",   "Formato de coordenadas: decimal, GMS con espacios y GMS compacto"],
  ["elevtest.js",   "Elevaciones: WCS del IGN, coberturas, formatos, rejilla"],
  ["navtest.js",    "Navegación del árbol y selección por rangos"],
  ["selcorrect.js", "Selección: cursor y nodos de nivel superior"],
  ["reporttest.js", "Informe de importación"],
  ["newfeat.js",    "Saneado de fichas, Ctrl+A y zonas de arrastre"]
];
const BENCH = [["selbench.js", "Coste de seleccionar y de topLevelSelection"]];

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

const failed = run(SUITES);
if (process.argv.includes("--bench")) run(BENCH);

console.log(failed
  ? `\n${failed} suite(s) con fallos.`
  : `\nTodas las suites (${SUITES.length}) han pasado.`);
process.exit(failed ? 1 : 0);
