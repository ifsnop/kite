/* Copiar en una instancia de KITE y pegar en OTRA, de otro dominio,
   por el portapapeles de verdad del sistema.

   Esta es la suite que justifica traer un navegador al repositorio.
   `tests/clipboard.js` comprueba el contrato sobre el archivo entregado
   —qué se declara, con qué guardias, en qué orden— pero no puede
   comprobar lo único que importa al usuario: que el texto salga de una
   pestaña y entre en otra. Eso se estuvo verificando a mano.

   Dos PUERTOS son dos ORÍGENES para el navegador, que es exactamente lo
   que separa a dos instancias servidas desde dominios distintos. Y se
   usa Ctrl+C y Ctrl+V de verdad, no eventos sintéticos: son las dos
   piezas que el código real necesita y que nada más puede dar —Ctrl+C
   aporta la activación transitoria sin la que `writeText` se niega, y
   Ctrl+V dispara el evento `paste`, que es por donde se lee.          */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER CLIPBOARD TESTS OK");
const browser = await launch();
const a = await serve(READABLE, 8831);
const b = await serve(READABLE, 8832);

/* El portapapeles es del USUARIO, no del origen, pero el permiso de
   escritura sí se concede por origen.                                */
const ctxOpts = { permissions: ["clipboard-read", "clipboard-write"] };
const A = await openApp(browser, a.url, ctxOpts);
const B = await openApp(browser, b.url, ctxOpts);

ok(new URL(a.url).origin !== new URL(b.url).origin,
  "las dos instancias están en orígenes distintos");

/* ---------- Origen A: construir y copiar con Ctrl+C ---------- */
await A.page.evaluate(() => {
  const ul = ensureRootUl();
  const f = makeNode({ name: "Ruta", isFolder: true });
  ul.appendChild(f);
  for (let i = 0; i < 3; i++) {
    const m = L.marker([40 + i * 0.01, -3.7]).addTo(rootGroup);
    const li = makeNode({ name: "Punto " + i, layer: m, style: { color: "#1b5e97" } });
    nodeUl(f).appendChild(li);
    ensureMarkerDefaults(li);
  }
  clearSelection();
  selectNode(f, true);
  document.getElementById("tree").focus();
});
await A.page.keyboard.press("Control+C");
await A.page.waitForTimeout(300);

/* Se lee el portapapeles del sistema desde la página, que es la prueba
   de que Ctrl+C llegó a escribirlo de verdad.                        */
const enElPortapapeles = await A.page.evaluate(() => navigator.clipboard.readText());
let doc = null;
try { doc = JSON.parse(enElPortapapeles); } catch { /* se reporta abajo */ }
ok(doc && doc.app === "kite-local/tree",
  "Ctrl+C deja el envoltorio de KITE en el portapapeles del sistema: "
  + String(enElPortapapeles).slice(0, 60));
ok(doc && doc.nodes && doc.nodes.length === 1 && doc.nodes[0].children.length === 3,
  "con la carpeta y sus tres puntos dentro");

/* ---------- Origen B: pegar con Ctrl+V sobre el ÁRBOL ---------- */
const antes = await B.page.evaluate(() => document.querySelectorAll("#tree li[role=treeitem]").length);
await B.page.evaluate(() => document.getElementById("tree").focus());
await B.page.keyboard.press("Control+V");
await B.page.waitForTimeout(800);

const trasPegar = await B.page.evaluate(() => ({
  filas: [...document.querySelectorAll("#tree li[role=treeitem]")].map(li => li._name),
  capas: rootGroup.getLayers().length
}));
ok(antes === 0, "el segundo origen empezaba vacío: " + antes);
ok(trasPegar.filas.includes("Ruta") && trasPegar.filas.filter(n => /^Punto /.test(n)).length === 3,
  "y tras Ctrl+V tiene la carpeta y sus tres puntos: " + JSON.stringify(trasPegar.filas));
ok(trasPegar.capas === 3, "con sus tres capas en el mapa: " + trasPegar.capas);

/* ---------- Pegar FUERA del árbol no importa nada ---------- */
/* Es la regla acordada: solo se interpreta sobre el árbol. En el editor
   de puntos el usuario se queda el JSON y es cosa suya.              */
const n1 = await B.page.evaluate(() => document.querySelectorAll("#tree li[role=treeitem]").length);
await B.page.evaluate(() => {
  document.getElementById("points-dialog").hidden = false;
  document.getElementById("points-text").value = "";
  document.getElementById("points-text").focus();
});
await B.page.keyboard.press("Control+V");
await B.page.waitForTimeout(500);
const trasPegarFuera = await B.page.evaluate(() => ({
  filas: document.querySelectorAll("#tree li[role=treeitem]").length,
  enElTextarea: document.getElementById("points-text").value.slice(0, 20)
}));
ok(trasPegarFuera.filas === n1,
  "pegar en el editor de puntos NO importa: " + trasPegarFuera.filas + " vs " + n1);
ok(trasPegarFuera.enElTextarea.startsWith("{"),
  "el JSON se queda en el cuadro de texto, como se acordó: "
  + JSON.stringify(trasPegarFuera.enElTextarea));

/* ---------- CORTAR y pegar en la MISMA pestaña sigue MOVIENDO ----------
   Regresión real y grave: al escribir también en el portapapeles del
   sistema, Ctrl+V leía de vuelta nuestro propio envoltorio y lo trataba
   como ajeno, que nunca mueve. Resultado: cada Ctrl+X se convertía en
   una copia, las carpetas de origen se quedaban marcadas como cortadas
   para siempre (en gris) y su contenido aparecía duplicado en el mapa.
   Se prueba con teclado REAL porque solo así interviene el portapapeles
   del sistema, que es donde estaba el fallo.                          */
const montar = () => A.page.evaluate(() => {
  document.getElementById("tree").innerHTML = ""; rootUl = null; rootGroup.clearLayers();
  const ul = ensureRootUl();
  for (const n of ["Carpeta A", "Carpeta B"]) {
    const f = makeNode({ name: n, isFolder: true });
    ul.appendChild(f);
    for (let i = 0; i < 2; i++) {
      const m = L.marker([40 + i * 0.01, -3]).addTo(rootGroup);
      nodeUl(f).appendChild(makeNode({ name: n + " capa " + i, layer: m, style: { color: "#1b5e97" } }));
    }
    refreshAncestorChecks(nodeUl(f).children[0]);
  }
  ul.appendChild(makeNode({ name: "Destino", isFolder: true }));
  const fs = [...document.querySelectorAll("#tree > ul > li")];
  clearSelection(); setSelected(fs[0], true); setSelected(fs[1], true); setSelCursor(fs[1]);
  document.getElementById("tree").focus();
});
const estado = () => A.page.evaluate(() => {
  const d = [...document.querySelectorAll("#tree > ul > li")].find(x => x._name === "Destino");
  return {
    raiz: [...document.querySelectorAll("#tree > ul > li")].map(li => li._name),
    dentro: d && nodeUl(d) ? [...nodeUl(d).children].map(c => c._name) : [],
    cortadas: document.querySelectorAll(".node-row.cut").length,
    capas: rootGroup.getLayers().length
  };
});
const alDestino = async () => {
  await A.page.evaluate(() => {
    moveCursorTo([...document.querySelectorAll("#tree > ul > li")].find(x => x._name === "Destino"), false);
    document.getElementById("tree").focus();
  });
  await A.page.keyboard.press("Control+V");
  await A.page.waitForTimeout(700);
};

await montar();
await A.page.keyboard.press("Control+X");
await A.page.waitForTimeout(250);
await alDestino();
const cortado = await estado();
ok(cortado.raiz.length === 1 && cortado.raiz[0] === "Destino",
  "cortar y pegar MUEVE: en la raíz solo queda el destino — " + JSON.stringify(cortado.raiz));
ok(cortado.dentro.length === 2, "con las dos carpetas dentro: " + JSON.stringify(cortado.dentro));
ok(cortado.cortadas === 0, "y sin filas marcadas como cortadas: " + cortado.cortadas);
ok(cortado.capas === 4, "sin duplicar capas en el mapa: " + cortado.capas + " (serían 8 si copiara)");

/* Y copiar tiene que seguir copiando, que es la otra mitad */
await montar();
await A.page.keyboard.press("Control+C");
await A.page.waitForTimeout(250);
await alDestino();
const copiado = await estado();
ok(copiado.raiz.length === 3, "copiar deja los originales donde estaban: " + JSON.stringify(copiado.raiz));
ok(copiado.capas === 8, "y sí duplica las capas: " + copiado.capas);

ok(A.errors.length === 0, "origen A sin errores: " + JSON.stringify(A.errors));
ok(B.errors.length === 0, "origen B sin errores: " + JSON.stringify(B.errors));

await browser.close();
a.close(); b.close();
done();
