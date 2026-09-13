/* Edición en bloque: qué se aplica a todos y qué no.

   Con varios nodos seleccionados casi nada tiene por qué coincidir, y
   la regla acordada es que una propiedad que no era igual en todos y
   que el usuario NO toca se queda como estaba en cada uno. Sin eso,
   abrir el diálogo para cambiar un color y aceptar igualaría de paso
   los grosores, los rellenos y el resto, en silencio.

   Aquí van las tres funciones puras de esa maquinaria. Lo que no se
   puede comprobar sin navegador —que el control quede marcado, que
   tocarlo lo desmarque y que el nombre en blanco no renombre nada— está
   en tests/browser/multiedit.mjs.                                     */
const { fn, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const src = "let styleMixed = new Set(); let styleTouched = new Set(); let styleDraft = null;\n"
  + constDecl("NAMES_PREVIEW_MAX") + "\n" + fn("joinNames") + "\n"
  + fn("mixedProps") + "\n" + fn("draftProps");
const api = new Function(src
  + "\nreturn { joinNames, mixedProps, draftProps,"
  + " set: (m, t, d) => { styleMixed = new Set(m); styleTouched = new Set(t); styleDraft = d; } };")();

/* ---------- mixedProps: en qué NO coinciden ---------- */
const a = { color: "#f00", weight: 2, fillOpacity: 0.35, textAlways: false };
const b = { color: "#0f0", weight: 2, fillOpacity: 0.35, textAlways: false };
const props = ["color", "weight", "fillOpacity", "textAlways"];

const m2 = api.mixedProps([a, b], props);
ok(m2.has("color") && m2.size === 1,
  "solo el color difiere: " + JSON.stringify([...m2]));
ok(api.mixedProps([a], props).size === 0,
  "con un solo nodo no hay nada mezclado (y todo se aplica, como siempre)");
ok(api.mixedProps([a, { ...a }], props).size === 0, "dos iguales tampoco mezclan");

/* La comparación es por valor y alcanza a los booleanos: `false` y
   `undefined` no son lo mismo aunque los dos se lean como "no".      */
ok(api.mixedProps([{ textAlways: false }, { textAlways: undefined }], ["textAlways"]).has("textAlways"),
  "false y undefined cuentan como distintos: el diálogo lo marca y no lo aplica solo");

/* Un tercer nodo que coincide con el primero no borra la mezcla del
   segundo: se compara CADA uno contra el primero, no por parejas.    */
ok(api.mixedProps([a, b, { ...a }], props).has("color"),
  "basta uno distinto entre muchos para que la propiedad esté mezclada");

/* ---------- draftProps: qué se escribe de verdad ---------- */
const draft = { color: "#00f", weight: 7, fillOpacity: 0.5, textAlways: true };

api.set([], [], draft);
ok(JSON.stringify(api.draftProps(props)) === JSON.stringify(draft),
  "sin mezcla se aplica el borrador entero: " + JSON.stringify(api.draftProps(props)));

api.set(["color", "weight"], [], draft);
const sinTocar = api.draftProps(props);
ok(!("color" in sinTocar) && !("weight" in sinTocar),
  "lo mezclado y no tocado NO se aplica: " + JSON.stringify(sinTocar));
ok(sinTocar.fillOpacity === 0.5 && sinTocar.textAlways === true,
  "y lo que sí coincidía se aplica igual: " + JSON.stringify(sinTocar));

api.set(["color", "weight"], ["color"], draft);
const tocado = api.draftProps(props);
ok(tocado.color === "#00f", "tocar una mezclada sí la aplica a todos: " + tocado.color);
ok(!("weight" in tocado), "y la otra sigue sin aplicarse: " + JSON.stringify(tocado));

/* Una propiedad tocada que valía `false` tiene que llegar igual: el
   filtro es la presencia de la clave, no si el valor es "vacío".     */
api.set(["textAlways"], ["textAlways"], { textAlways: false });
ok(api.draftProps(["textAlways"]).textAlways === false,
  "un false tocado se aplica; filtrar por valor lo habría perdido");

/* ---------- joinNames: los nombres, sin desbordar el campo ---------- */
ok(api.joinNames(["Alfa", "Beta"]) === "Alfa, Beta",
  "dos nombres cortos van enteros: " + api.joinNames(["Alfa", "Beta"]));
ok(api.joinNames([]) === "", "sin nombres, cadena vacía");
ok(api.joinNames(["Solo"]) === "Solo", "uno solo va tal cual");

const muchos = ["Punto de control 1", "Punto de control 2", "Punto de control 3", "Punto de control 4"];
const resumen = api.joinNames(muchos);
ok(/y \d+ más$/.test(resumen), "lo que no cabe se cuenta: " + resumen);
ok(resumen.startsWith("Punto de control 1"), "y empieza por el primero: " + resumen);
/* El tope es del texto que se JUNTA; el "y N más" va aparte, porque es
   lo que explica que falten nombres y no puede caer fuera.           */
ok(resumen.length < 60, "sin ocupar más de la cuenta: " + resumen.length + " caracteres");

/* Un solo nombre larguísimo (los de un KML llegan a tener cientos de
   caracteres) no puede meterse entero solo por ser el primero.       */
const largo = api.joinNames(["x".repeat(300)]);
ok(largo.length <= 41 && largo.endsWith("…"),
  "un nombre larguísimo se recorta: " + largo.length + " caracteres, «" + largo.slice(-3) + "»");

/* El tope se puede pedir distinto, y se respeta */
ok(api.joinNames(["Alfa", "Beta", "Gamma"], 10) === "Alfa, Beta y 1 más",
  "con otro tope: " + api.joinNames(["Alfa", "Beta", "Gamma"], 10));

if (!process.exitCode) console.log("MULTI-EDIT TESTS OK");
