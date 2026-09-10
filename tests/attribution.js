/* Línea inferior del visor: versión, enlace al repositorio y escala.

   Son decisiones sobre el ARCHIVO ENTREGADO y sobre cómo se apilan los
   controles de Leaflet, no sobre una función suelta que se pueda
   invocar aquí: el control de escala lo construye Leaflet, que no se
   carga en Node. Lo que sí se puede fijar —y es lo que se rompería sin
   avisar— es el contrato: qué se declara, con qué atributos y en qué
   esquina.                                                            */
const { constDecl, between, script } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* ---------- Versión y enlace al repositorio ---------- */
const build = constDecl("BUILD");
const m = /const BUILD = "(\d{12})";/.exec(build);
ok(!!m, "BUILD es AAAAMMDDHHMM, doce dígitos: " + build.trim());
const repo = constDecl("REPO_URL");
ok(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(repo),
  "REPO_URL apunta a un repositorio de GitHub: " + repo.trim());

/* El prefijo de la atribución lleva las dos cosas juntas: la versión es
   lo que dice QUÉ se está ejecutando, y el enlace es lo que hace ese
   dato accionable (desde ahí se llega al código de esa versión).     */
const prefix = between("map.attributionControl.setPrefix(", "\n\n");
ok(prefix.includes("v${BUILD}"), "el prefijo muestra la versión: " + prefix.slice(0, 60));
ok(prefix.includes("${REPO_URL}"), "y enlaza al repositorio, sin repetir la URL a mano");
ok(/>GitHub<\/a>/.test(prefix), "con un texto que dice a dónde va");
ok(prefix.includes("Leaflet"), "sin perder el crédito de Leaflet, que su licencia pide");

/* Abrir en otra pestaña no es cosmético: la sesión de trabajo vive en
   esta página, y navegar fuera en la misma pestaña la abandona. Y
   `noopener` es lo que impide que el destino toque window.opener.   */
ok(/target="_blank"/.test(prefix), "el enlace al repositorio abre en otra pestaña");
ok(/rel="noopener"/.test(prefix), "y con rel=noopener");

/* ---------- Escala ---------- */
/* Se usa la de Leaflet, no una propia: antes de escribir código hay que
   comprobar si la librería ya lo resuelve.                           */
const scale = /L\.control\.scale\(([^)]*)\)\.addTo\(map\);/.exec(script);
ok(!!scale, "la escala es L.control.scale, la de Leaflet");
ok(/position:\s*"bottomright"/.test(scale ? scale[1] : ""),
  "en bottomright, la misma esquina que la atribución: " + (scale ? scale[1] : "(no está)"));
/* Ahí queda ENCIMA de la atribución sin colocarla a mano, porque
   Leaflet inserta cada control nuevo de una esquina INFERIOR delante de
   los que ya hubiera. La atribución se crea con el mapa, así que el
   orden de estas dos líneas en el fuente ES la posición en pantalla. */
ok(script.indexOf("map.attributionControl.setPrefix(") < script.indexOf("L.control.scale("),
  "y se añade DESPUÉS de la atribución, que es lo que la deja por encima");

/* Métrico e imperial son los valores por defecto de Leaflet, y encajan
   con la costumbre del visor de dar siempre dos unidades: no se pasan
   `metric`/`imperial`, así que nadie los ha desactivado sin querer.  */
ok(!/metric|imperial/.test(scale ? scale[1] : ""),
  "se dejan los valores por defecto de Leaflet: " + (scale ? scale[1] : ""));

/* ---------- La escala SIGUE en el PNG exportado ---------- */
/* exportMapPng oculta los controles superpuestos porque no aportan
   información. La escala sí la aporta —una imagen de un mapa sin
   escala no se puede medir—, igual que el cuadro de coordenadas y la
   atribución, que tampoco se ocultan.                               */
const hide = constDecl("HIDE_FOR_PNG");
ok(!/scale/.test(hide), "la escala no está entre lo que se oculta al exportar: " + hide.trim());
for (const c of ["leaflet-control-zoom", "measure-bar", "base-box"]) {
  ok(hide.includes(c), `y lo que sí se oculta sigue ahí: ${c}`);
}

if (!process.exitCode) console.log("ATTRIBUTION / SCALE TESTS OK");
