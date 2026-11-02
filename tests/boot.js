/* Arranque: el panel no puede concluir «no hay capas» antes de haber
   leído IndexedDB.

   El fallo reportado: al cargar o recargar la página salían a la vez el
   aviso «No hay capas cargadas.» en el árbol y la barra diciendo
   «Restaurando capas…». Se contradecían porque el aviso se pintaba a
   nivel de módulo, mucho antes de saber si había algo guardado — leer
   el árbol es asíncrono. Ahora se arranca en «Inicializando…» y es
   99-boot.js, ya con el árbol leído, quien concluye.                 */
const { parseHTML } = require("linkedom");
const { fn, script } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const { document } = parseHTML("<div id='tree'></div>");
const treeEl = document.getElementById("tree");
const api = new Function("treeEl", "document",
  "let rootUl = null;\n"
  + fn("showTreePlaceholder") + "\n" + fn("showEmptyMessage") + "\n" + fn("showLoadingMessage")
  + "\nreturn { showEmptyMessage, showLoadingMessage, showTreePlaceholder,"
  + " getRootUl: () => rootUl, setRootUl: v => { rootUl = v; } };")(treeEl, document);

const text = () => {
  const el = treeEl.querySelector(".empty");
  return el ? el.textContent : null;
};

/* ---------- Los dos textos del mismo hueco ---------- */
api.showLoadingMessage();
ok(text() === "Inicializando…", "al arrancar, «Inicializando…»: " + JSON.stringify(text()));
api.showEmptyMessage();
ok(text() === "No hay capas cargadas.", "ya con la conclusión, «No hay capas cargadas.»: " + JSON.stringify(text()));

/* Solo UNO a la vez: el segundo sustituye al primero, no se apilan */
api.showLoadingMessage();
ok(treeEl.querySelectorAll(".empty").length === 1,
  "nunca hay dos avisos a la vez: " + treeEl.querySelectorAll(".empty").length);

/* Pintar un aviso descarta el <ul> del árbol: quien lo tuviera cogido
   debe volver a pedirlo con ensureRootUl, no seguir usándolo.       */
api.setRootUl({ soy: "un ul viejo" });
api.showEmptyMessage();
ok(api.getRootUl() === null, "el aviso deja rootUl a null");

/* El texto va por textContent, no por innerHTML: es la diferencia entre
   un aviso y una vía de inyección si algún día lleva un nombre ajeno. */
api.showTreePlaceholder("<b>ojo</b> & <i>cuidado</i>");
ok(text() === "<b>ojo</b> & <i>cuidado</i>",
  "el texto se escribe literal, sin interpretarlo como HTML: " + JSON.stringify(text()));
ok(treeEl.querySelector("b") === null, "y no crea etiquetas");

/* ---------- El contrato del arranque, sobre el archivo ENTREGADO ----------
   Estas tres son las que impiden que vuelva el fallo: viven en el orden
   de ejecución del script, que ninguna función suelta puede comprobar. */
ok(/\n\/\* Se arranca en «Inicializando…»[\s\S]*?\nshowLoadingMessage\(\);/.test(script),
  "el árbol arranca en «Inicializando…», no en «No hay capas cargadas.»");
ok(!/^showEmptyMessage\(\);$/m.test(script),
  "showEmptyMessage NO se llama a nivel de módulo: sería la conclusión antes de la pregunta");

/* Y el arranque concluye, pero mirando rootUl y no `nodes`: si el
   usuario suelta un archivo mientras se lee IndexedDB, ensureRootUl ya
   sustituyó el aviso y borrarlo dejaría esa importación colgando de un
   <ul> desconectado del documento.                                   */
ok(/if \(!rootUl\) showEmptyMessage\(\);/.test(script),
  "99-boot.js concluye con `if (!rootUl) showEmptyMessage();`");
const boot = script.slice(script.indexOf("Arranque: restaurar el árbol guardado"));
ok(boot.indexOf("await dbLoadTree()") < boot.indexOf("if (!rootUl) showEmptyMessage();"),
  "y lo hace DESPUÉS de leer el árbol guardado, no antes");

/* El enlace a una vista (#map=…): su ancla se quita ANTES de leer lo
   guardado (recargar no lo repite), manda sobre la vista guardada (se
   aplica DESPUÉS de leerla y antes de soltar `viewRestoring`) y sus mapas
   base mandan sobre los guardados (después de leerlos, antes de pintar).  */
const bootBody = script.slice(script.indexOf("const viewLink = parseViewHash(location.hash);"));
const at = s => bootBody.indexOf(s);
ok(at("const viewLink") === 0 && at("clearViewHash()") > 0, "99-boot.js lee el enlace y quita su ancla");
ok(at("clearViewHash()") < at("await dbLoadView()"), "el ancla se quita antes de leer la vista guardada");
ok(at("await dbLoadView()") < at("map.setView([viewLink.lat") && at("map.setView([viewLink.lat") < at("viewRestoring = false"),
  "el enlace se aplica después de la vista guardada y antes de soltar viewRestoring");
ok(at("viewRestoring = false") < at("if (viewLink) scheduleViewSave();") && at("if (viewLink) scheduleViewSave();") < at("applySavedBases("),
  "y la vista del enlace se guarda tras soltar viewRestoring (sus moveend llegaron antes y no guardaron nada)");
ok(at("applySavedBases(") < at("setLinkBases(viewLink.bases, false)") && at("setLinkBases(viewLink.bases, false)") < at("renderBasePanel();"),
  "sus mapas base se aplican tras los guardados y antes de pintar el panel");

if (!process.exitCode) console.log("BOOT PLACEHOLDER TESTS OK");
