/* Tercer estado de la casilla de un contenedor: indeterminada cuando
   unas capas de dentro están activas y otras no.

   Se usa el `indeterminate` nativo, que el navegador dibuja como un
   guion: no hay estilo propio que probar.

   La regla mira SOLO a los hijos directos, y puede permitírselo porque
   el invariante se mantiene de abajo arriba — un hijo contenedor cuenta
   como "entero" solo si está marcado y no indeterminado, así que su
   estado ya resume su rama. Eso es lo primero que se comprueba aquí,
   porque es de lo que depende que subir por los ancestros cueste
   profundidad × hermanos y no un recorrido del árbol.

   Y el disparador NO es solo "han tocado una casilla". Comprobado en
   navegador sobre el visor real: con la carpeta colapsada no hay forma
   de conmutar un descendiente (ni por su fila, que no existe, ni por el
   botón ☑, que selecciona sin activar, ni por Espacio, que cascadea
   uniforme), pero el CONJUNTO de hijos sí cambia —soltar un archivo
   sobre una carpeta colapsada importa dentro, y ensureNamedSection mete
   capas en una sección colapsada—, y ahí estaba el fallo real: una
   sección apagada se quedaba diciendo "apagada" después de recibir una
   capa visible.                                                       */
const { parseHTML } = require("linkedom");
const { fn, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const { document } = parseHTML("<div id='tree'></div>");
global.document = document;
const treeEl = document.getElementById("tree");

const src = "const nodeUl = li => li.querySelector(':scope > ul.node-list');\n"
  + constDecl("nodeCheckbox") + "\n" + fn("recordState") + "\n"
  + fn("containerState") + "\n" + fn("applyContainerState") + "\n"
  + fn("refreshChecksFrom") + "\n" + constDecl("refreshAncestorChecks");
const api = new Function(src
  + "\nreturn {nodeCheckbox, recordState, containerState, applyContainerState,"
  + " refreshChecksFrom, refreshAncestorChecks};")();

/* --- Árbol de mentira, con lo justo que miran estas funciones --- */
let seq = 0;
function node(name, { container = false, checked = true, pending = null } = {}) {
  const li = document.createElement("li");
  li._name = name;
  li.id = "n" + (++seq);
  const row = document.createElement("div");
  row.className = "node-row";
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.checked = checked;
  row.appendChild(chk);
  li.appendChild(row);
  if (container) {
    const ul = document.createElement("ul");
    ul.className = "node-list";
    li.appendChild(ul);
  }
  if (pending) li._pending = pending;
  return li;
}
const add = (parent, child) => { parent.querySelector(":scope > ul.node-list").appendChild(child); return child; };
const chk = li => api.nodeCheckbox(li);
const state = li => chk(li).indeterminate ? "mixed" : (chk(li).checked ? "on" : "off");

/* ---------- containerState sobre hijos directos ---------- */
const f = node("Carpeta", { container: true });
const a = add(f, node("A", { checked: true }));
const b = add(f, node("B", { checked: true }));
ok(api.containerState(f) === "on", "todos marcados → on: " + api.containerState(f));
chk(b).checked = false;
ok(api.containerState(f) === "mixed", "uno sí y otro no → mixed: " + api.containerState(f));
chk(a).checked = false;
ok(api.containerState(f) === "off", "ninguno → off: " + api.containerState(f));

/* Un contenedor vacío no agrega nada: null, y la casilla se deja como
   esté (una carpeta recién creada la marca quien la crea).          */
ok(api.containerState(node("Vacía", { container: true })) === null, "sin hijos, null");
/* Y una hoja tampoco es un contenedor */
ok(api.containerState(node("Hoja")) === null, "una hoja no agrega nada");

/* Las filas de mensaje ("Sin geometrías") no son nodos y no cuentan */
const conMensaje = node("F2", { container: true });
add(conMensaje, node("X", { checked: true }));
const msg = document.createElement("li");
msg.className = "empty";            /* sin _name: no es un nodo */
conMensaje.querySelector(":scope > ul.node-list").appendChild(msg);
ok(api.containerState(conMensaje) === "on",
  "una fila de mensaje no cuenta como hijo: " + api.containerState(conMensaje));

/* ---------- El invariante: un hijo MIXTO hace mixto al padre ---------- */
/* Es lo que permite no bajar más de un nivel. Si el hijo indeterminado
   se leyera como "marcado", el abuelo diría "entero" siendo falso.  */
const abuelo = node("Abuelo", { container: true });
const padre = add(abuelo, node("Padre", { container: true }));
const tio = add(abuelo, node("Tío", { checked: true }));
const h1 = add(padre, node("H1", { checked: true }));
const h2 = add(padre, node("H2", { checked: false }));
api.applyContainerState(padre);
ok(state(padre) === "mixed", "el padre queda indeterminado: " + state(padre));
ok(api.containerState(abuelo) === "mixed",
  "y el abuelo también, porque un hijo mixto NO cuenta como entero: " + api.containerState(abuelo));

/* ---------- applyContainerState: aria y "¿cambió algo?" ---------- */
ok(padre.getAttribute("aria-checked") === "mixed",
  "aria-checked=mixed, que es lo que espera un lector de pantalla: " + padre.getAttribute("aria-checked"));
ok(api.applyContainerState(padre) === false,
  "aplicarlo otra vez no cambia nada y lo dice (es lo que corta la subida)");
chk(h2).checked = true;
ok(api.applyContainerState(padre) === true, "al igualarse los hijos, sí cambia");
ok(state(padre) === "on" && padre.getAttribute("aria-checked") === "true",
  "y queda entero: " + state(padre) + " / " + padre.getAttribute("aria-checked"));

/* ---------- Subir por los ancestros, cortando en cuanto no cambie ---------- */
treeEl.innerHTML = "";
const raiz = document.createElement("ul");
raiz.className = "node-list";
treeEl.appendChild(raiz);
const n1 = node("N1", { container: true });
raiz.appendChild(n1);
const n2 = add(n1, node("N2", { container: true }));
const n3 = add(n2, node("N3", { container: true }));
const hoja1 = add(n3, node("hoja1", { checked: true }));
const hoja2 = add(n3, node("hoja2", { checked: true }));

chk(hoja2).checked = false;
api.refreshAncestorChecks(hoja2);
ok(state(n3) === "mixed" && state(n2) === "mixed" && state(n1) === "mixed",
  `la mezcla sube hasta arriba: ${state(n3)} / ${state(n2)} / ${state(n1)}`);

chk(hoja2).checked = true;
api.refreshAncestorChecks(hoja2);
ok(state(n3) === "on" && state(n2) === "on" && state(n1) === "on",
  `y se deshace igual: ${state(n3)} / ${state(n2)} / ${state(n1)}`);

/* ---------- Registros pendientes: una carpeta colapsada ----------
   Comprobado en el visor real: una carpeta colapsada restaurada de
   IndexedDB llega con 0 filas y sus hijos SOLO como registros, y tras
   soltar un archivo dentro conviven fila y registros. Mirar solo el DOM
   la leería como vacía.                                              */
const pend = node("Pendiente", { container: true, pending: [
  { name: "p1", checked: true }, { name: "p2", checked: false }
] });
ok(api.containerState(pend) === "mixed",
  "los registros pendientes cuentan: " + api.containerState(pend));

const pendTodos = node("P2", { container: true, pending: [
  { name: "p1", checked: true }, { name: "p2", checked: true }
] });
ok(api.containerState(pendTodos) === "on", "todos los registros marcados → on");

/* Fila y registros a la vez, que es el estado real tras soltar dentro */
const mixto = node("Mixto", { container: true, pending: [
  { name: "p1", checked: false }, { name: "p2", checked: false }
] });
add(mixto, node("recienSoltado", { checked: true }));
ok(api.containerState(mixto) === "mixed",
  "fila marcada + registros apagados → mixed: " + api.containerState(mixto));

/* Un registro de CARPETA agrega su propia rama */
ok(api.recordState({ name: "c", checked: true, children: [
  { name: "x", checked: true }, { name: "y", checked: false }] }) === "mixed",
  "un registro de carpeta con hijos dispares es mixto");
ok(api.recordState({ name: "c", checked: false, children: [
  { name: "x", checked: false }, { name: "y", checked: false }] }) === "off",
  "y uniforme si todos coinciden");

/* La caché evita recorrer una rama enorme en cada recálculo del padre */
const grande = { name: "g", checked: true, children: [{ name: "x", checked: true }] };
api.recordState(grande);
ok(grande._state === "on", "el estado se memoriza en el registro: " + grande._state);
grande.children[0].checked = false;   /* cambio sin invalidar */
ok(api.recordState(grande) === "on",
  "y se reutiliza: quien toque `checked` debe invalidarlo (lo hace cascadeVisibility)");

/* ---------- Borrar: se recalcula desde el <ul> guardado ---------- */
const delF = node("Borrar", { container: true });
raiz.appendChild(delF);
const d1 = add(delF, node("d1", { checked: true }));
const d2 = add(delF, node("d2", { checked: false }));
api.applyContainerState(delF);
ok(state(delF) === "mixed", "mezclada antes de borrar: " + state(delF));
const ulGuardado = d2.parentElement;   /* ANTES de quitarlo */
d2.remove();
api.refreshChecksFrom(ulGuardado);
ok(state(delF) === "on",
  "al irse el que estaba apagado, la carpeta queda entera: " + state(delF));

/* ---------- Restaurar una carpeta colapsada ----------
   Sus hijos no llegan a ser filas, así que la pasada recursiva de
   materializeRecords no recalcula esa casilla por ellos. Es un contrato
   de ORDEN dentro de esa función, no algo que se pueda invocar suelto
   aquí, así que se comprueba sobre el archivo entregado: sin esa
   llamada, una carpeta a medias volvía de IndexedDB diciendo "entera"
   (comprobado en navegador antes de añadirla).                       */
const materialize = fn("materializeRecords");
const rama = materialize.slice(materialize.indexOf("if (rec.collapsed)"));
ok(/li\._pending = rec\.children;[\s\S]{0,400}applyContainerState\(li\)/.test(rama),
  "materializeRecords recalcula la casilla de una carpeta que se queda pendiente");

if (!process.exitCode) console.log("TRI-STATE CHECKBOX TESTS OK");
