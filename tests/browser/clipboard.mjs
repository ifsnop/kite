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

ok(A.errors.length === 0, "origen A sin errores: " + JSON.stringify(A.errors));
ok(B.errors.length === 0, "origen B sin errores: " + JSON.stringify(B.errors));

await browser.close();
a.close(); b.close();
done();
