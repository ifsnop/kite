/* Avisos del panel: fusión de repetidos con contador y registro de la
   sesión.

   El problema que resuelven: un aviso que se repite (una capa base que
   deja de responder de forma intermitente) llenaba el panel con líneas
   idénticas, y al pasar MSG_TIMEOUT desaparecía sin dejar rastro, de
   modo que uno que no diera tiempo a leer se perdía para siempre.   */
const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const { parseHTML } = require("linkedom");
const fs = require("fs");
const script = fs.readFileSync(HTML_PATH, "utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];
/* Extractor con la lista de parámetros saltada a propósito: `navMessage`
   desestructura en su firma (`function navMessage(txt, { sticky … })`) y
   el extractor corriente de las demás suites, que cuenta llaves desde la
   PRIMERA `{`, la tomaría por el cuerpo y devolvería la función
   truncada. Aquí se cierra antes el paréntesis de los parámetros y solo
   después se cuentan llaves.                                          */
function fn(name) {
  const i = script.indexOf(`function ${name}(`);
  if (i < 0) throw new Error("no encontrada: " + name);
  let k = script.indexOf("(", i), paren = 0;
  for (; k < script.length; k++) {
    if (script[k] === "(") paren++;
    else if (script[k] === ")" && --paren === 0) { k++; break; }
  }
  let depth = 0;
  for (k = script.indexOf("{", k); k < script.length; k++) {
    if (script[k] === "{") depth++;
    else if (script[k] === "}" && --depth === 0) return script.slice(i, k + 1);
  }
}
const consts = script.slice(script.indexOf("const MSG_TIMEOUT"), script.indexOf("function msgStamp"));

const { document } = parseHTML("<div id='nav-msg'></div><button id='log-btn'></button>");
global.document = document;
const msgEl = document.getElementById("nav-msg");

/* Temporizadores controlados a mano: así se puede comprobar que un
   repetido REINICIA el de su línea, y expirar una línea a voluntad. */
const timers = new Map();
let nextTimer = 1;
global.setTimeout = (f) => { const id = nextTimer++; timers.set(id, f); return id; };
global.clearTimeout = (id) => timers.delete(id);
const expire = id => { const f = timers.get(id); timers.delete(id); if (f) f(); };

const src = consts + [fn("msgStamp"), fn("logText"), fn("paintMsgLine"),
                      fn("navMessage"), fn("clearNavMessage")].join("\n")
  + "\nfunction refreshLogButton() {}";
const api = new Function("document",
  src + "\nreturn {msgStamp, logText, navMessage, clearNavMessage, msgLog,"
      + " MSG_LOG_MAX, getUnseen: () => msgLogUnseen, setUnseen: v => { msgLogUnseen = v; }};")(document);
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const lines = () => [...msgEl.querySelectorAll(".nav-msg-line")];
const textOf = l => l.querySelector(".nav-msg-text").textContent;
const countOf = l => l.querySelector(".nav-msg-count").textContent;
const timeOf = l => l.querySelector(".nav-msg-time").textContent;
const reset = () => { msgEl.textContent = ""; api.msgLog.length = 0; api.setUnseen(0); timers.clear(); };

/* ---------- msgStamp: relleno con ceros ---------- */
/* Enero, día 1, 09:05:07 → todos los campos de un dígito a la vez. Es
   exactamente el fallo que ya se dio en pngTimestamp.               */
ok(api.msgStamp(new Date(2026, 0, 1, 9, 5, 7).getTime()) === "2026-01-01 09:05:07",
  "todos los campos de un dígito llevan cero: " + api.msgStamp(new Date(2026, 0, 1, 9, 5, 7).getTime()));
ok(api.msgStamp(new Date(2026, 11, 31, 23, 59, 59).getTime()) === "2026-12-31 23:59:59",
  "y los de dos dígitos no se tocan");
ok(api.msgStamp(new Date(2026, 8, 8, 0, 0, 0).getTime()) === "2026-09-08 00:00:00",
  "medianoche exacta es 00:00:00, no 0:0:0");

/* ---------- Fusión de repetidos ---------- */
reset();
api.navMessage("Sin respuesta");
ok(lines().length === 1 && countOf(lines()[0]) === "",
  "un aviso suelto no muestra contador: " + JSON.stringify(countOf(lines()[0])));
api.navMessage("Sin respuesta");
ok(lines().length === 1, "el repetido NO añade línea: " + lines().length);
ok(countOf(lines()[0]) === "×2", "y muestra ×2: " + countOf(lines()[0]));
api.navMessage("Sin respuesta");
ok(countOf(lines()[0]) === "×3", "tres veces → ×3: " + countOf(lines()[0]));
ok(api.msgLog.length === 1 && api.msgLog[0].count === 3,
  "y en el registro es UNA entrada con count 3: " + JSON.stringify(api.msgLog.map(e => e.count)));

/* La entrada conserva la primera y la última; el panel muestra la última */
const e0 = api.msgLog[0];
ok(e0.first <= e0.last, "la entrada guarda primera y última");
ok(timeOf(lines()[0]) === api.msgStamp(e0.last),
  "el panel muestra la marca de la ÚLTIMA repetición (es una vista en vivo)");

/* ---------- Lo que NO se funde ---------- */
reset();
api.navMessage("Uno"); api.navMessage("Dos");
ok(lines().length === 2 && api.msgLog.length === 2, "textos distintos: dos líneas y dos entradas");
reset();
api.navMessage("Mismo", { tone: "error" });
api.navMessage("Mismo", { tone: "info" });
ok(lines().length === 2 && api.msgLog.length === 2,
  "mismo texto con tono distinto NO se funde: la clave lleva el tono");

/* Si la línea ya expiró, el siguiente aviso empieza entrada nueva */
reset();
api.navMessage("Vuelve");
const first = lines()[0];
expire(first._timer);
ok(lines().length === 0, "la línea se fue al expirar su temporizador");
api.navMessage("Vuelve");
ok(lines().length === 1 && api.msgLog.length === 2,
  "sin línea viva se crea entrada NUEVA, no se funde: " + api.msgLog.length);
ok(api.msgLog[0].count === 1 && api.msgLog[1].count === 1, "cada una con su cuenta a 1");

/* ---------- El repetido reinicia el temporizador y no se mueve ---------- */
reset();
api.navMessage("Primero");
api.navMessage("Repetido");
const rep = lines()[1];
const t1 = rep._timer;
api.navMessage("Repetido");
ok(rep._timer !== t1, "el repetido reinicia el temporizador de su línea");
ok(!timers.has(t1), "y cancela el anterior, para que no se lleve la línea antes de tiempo");
ok(lines()[1] === rep && textOf(lines()[0]) === "Primero",
  "la línea fundida NO cambia de sitio: reordenar haría saltar el texto");

/* ---------- Un aviso pegajoso no expira ---------- */
reset();
api.navMessage("Léeme", { sticky: true });
ok(lines()[0]._timer === undefined, "un aviso sticky no arma temporizador");
ok(api.msgLog[0].sticky === true, "y queda marcado como tal en el registro");

/* ---------- El registro sobrevive a que la línea se vaya ---------- */
reset();
api.navMessage("Efímero");
expire(lines()[0]._timer);
ok(lines().length === 0 && api.msgLog.length === 1,
  "la línea desaparece del panel pero la entrada sigue en el registro");

/* ---------- Tope del registro ---------- */
reset();
for (let i = 0; i < api.MSG_LOG_MAX + 5; i++) api.navMessage("aviso " + i);
ok(api.msgLog.length === api.MSG_LOG_MAX, "el registro se topa: " + api.msgLog.length);
ok(api.msgLog[0].text === "aviso 5", "al desbordar se pierde la MÁS ANTIGUA: " + api.msgLog[0].text);

/* ---------- Entradas sin ver ---------- */
reset();
api.navMessage("a"); api.navMessage("b");
ok(api.getUnseen() === 2, "cuenta las entradas nuevas: " + api.getUnseen());
api.navMessage("b");
ok(api.getUnseen() === 2, "un repetido NO cuenta como entrada nueva: " + api.getUnseen());

/* ---------- logText ---------- */
reset();
ok(api.logText() === "", "un registro vacío no produce texto");
api.navMessage("Primero", { tone: "info" });
api.navMessage("Segundo");
api.navMessage("Segundo");
const out = api.logText().split("\n");
ok(out.length === 2, "una línea por entrada: " + out.length);
ok(out[0].startsWith(api.msgStamp(api.msgLog[0].first)),
  "cada línea abre con la marca completa: " + out[0].slice(0, 19));
ok(out[0].includes("Primero") && out[1].includes("Segundo"),
  "orden CRONOLÓGICO, la más antigua primero");
ok(out[0].includes("INFO") && out[1].includes("AVISO"), "el tono se distingue en el texto copiado");
ok(/x2, última 20/.test(out[1]), "el repetido lleva ×N y la marca de la última: " + out[1]);
ok(!/x\d/.test(out[0]), "el que no se repitió no lleva contador");

if (!process.exitCode) console.log("MESSAGE LOG TESTS OK");
