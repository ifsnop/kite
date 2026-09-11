/* Las dos cotas del pie del panel: lo que ocupa en disco y lo que ocupa
   en memoria.

   La de memoria tiene una regla que no es obvia y conviene fijar: sin
   cifra que dar, la línea NO se pinta, se esconde. Son dos los motivos
   por los que puede faltar, y los dos son raros frente al uso normal
   (la página servida): abrir el archivo con doble clic, donde Chromium
   deja `performance.memory` congelado —medido: 600.000 objetos y el
   valor sin moverse de 9,54 MB a los 35 s, mientras la MISMA página por
   http saltaba de 4,38 a 54,33 al instante—, y un navegador que no sea
   Chromium, donde la API directamente no existe por no estar en ninguna
   norma. Una línea fija diciendo "no disponible" sería ruido
   permanente.                                                        */
const { parseHTML } = require("linkedom");
const { fn, between, script } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const { document } = parseHTML('<div id="usage"><div id="storage-usage"></div><div id="memory-usage"></div></div>');
const el = document.getElementById("memory-usage");

/* fmtBytes lleva un ";" dentro, así que constDecl no vale (lo dice
   el propio _extract): se corta por marcadores, igual que bytesfmt.js */
const src = between("const fmtBytes =", "/* Procesa archivos soltados") + "\n"
  + fn("memoryUsageText") + "\n" + fn("refreshMemoryUsage");
const api = new Function("document", "location", "performance",
  src + "\nreturn {memoryUsageText, refreshMemoryUsage};");

/* Cada escenario con su propio `location` y `performance` */
const run = (protocol, memory) =>
  api(document, { protocol }, { memory });

/* ---------- Servida: se muestra ---------- */
let a = run("https:", { usedJSHeapSize: 4.5 * 1048576, jsHeapSizeLimit: 4 * 1073741824 });
let txt = a.memoryUsageText();
ok(txt !== null, "servida por https hay cifra");
ok(/^Memoria de la pestaña: 4\.5 MB de 4\.0 GB$/.test(txt), "con usado y límite: " + txt);
a.refreshMemoryUsage();
ok(el.hidden === false, "y la línea se ve");
ok(el.textContent === txt, "con ese texto: " + el.textContent);

/* http:// (un servidor local) también vale: lo que descarta es file: */
ok(run("http:", { usedJSHeapSize: 1048576, jsHeapSizeLimit: 1073741824 })
   .memoryUsageText() !== null, "http también da cifra");

/* ---------- file://: no se muestra NADA ---------- */
const b = run("file:", { usedJSHeapSize: 9.54 * 1048576, jsHeapSizeLimit: 4 * 1073741824 });
ok(b.memoryUsageText() === null,
  "sobre file:// no hay cifra aunque performance.memory conteste (está congelada)");
b.refreshMemoryUsage();
ok(el.hidden === true, "y la línea se esconde, no dice 'no se mide'");

/* ---------- Navegador sin performance.memory ---------- */
el.hidden = false;
const c = run("https:", undefined);
ok(c.memoryUsageText() === null, "sin performance.memory tampoco hay cifra");
c.refreshMemoryUsage();
ok(el.hidden === true, "y también se esconde");

/* Un valor absurdo se trata como ausente, no se escribe "NaN" */
el.hidden = false;
const d = run("https:", { usedJSHeapSize: NaN, jsHeapSizeLimit: 100 });
ok(d.memoryUsageText() === null, "un usedJSHeapSize no finito cuenta como ausente");
d.refreshMemoryUsage();
ok(el.hidden === true, "y se esconde igual");

/* Al volver a haber cifra, la línea reaparece */
a = run("https:", { usedJSHeapSize: 2 * 1048576, jsHeapSizeLimit: 1073741824 });
a.refreshMemoryUsage();
ok(el.hidden === false && /2\.0 MB de 1\.0 GB/.test(el.textContent),
  "y vuelve a mostrarse cuando hay dato: " + el.textContent);

/* ---------- El temporizador no se arma si no hay nada que refrescar ---------- */
const boot = script;
ok(/if \(memoryUsageText\(\) !== null\) setInterval\(refreshMemoryUsage, MEMORY_REFRESH_MS\);/.test(boot),
  "el arranque solo arma el temporizador si hay cifra que actualizar");

if (!process.exitCode) console.log("USAGE INDICATORS TESTS OK");
