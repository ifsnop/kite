/* Comprobaciones estáticas del archivo entregado.

   CLAUDE.md lleva una lista de cosas que «conviene pasar» sobre
   kitelocal.html. Tres ya las cubren otras suites (SRI, el guardián de
   Leaflet, el valor de BUILD). Las dos que quedaban se hacían a mano —y
   por eso no se hacían casi nunca— son las de aquí:

   1. Que todo `$id("x")` / `getElementById("x")` apunte a un `id` que
      exista de verdad en el HTML. Un id mal escrito no rompe nada al
      cargar: `$id` devuelve null y el fallo aparece más tarde, en el
      diálogo que nadie abrió durante la prueba.
   2. Que toda función llamada esté declarada. Un refactor puede
      llevarse por delante un ayudante que sigue en uso y `node --check`
      no lo detecta, porque el archivo sigue siendo válido: el error solo
      sale al ejecutar esa rama.

   La segunda exige mirar el código de verdad, no con una expresión
   regular sobre el texto en bruto: los comentarios de este proyecto
   están en castellano y llenos de paréntesis («las capas (todas)»), así
   que un barrido ingenuo daba 369 falsos positivos. `maskCode` borra
   comentarios, cadenas, plantillas y expresiones regulares conservando
   las posiciones, y deja solo código. Con eso, y contando como
   declarado todo lo que LIGA un nombre —declaraciones, claves de
   objeto, métodos abreviados, getters y parámetros—, no queda ningún
   falso positivo: lo único que sobra son los globales del navegador,
   que van en una lista explícita para que añadir una dependencia nueva
   sea una decisión y no un descuido.                                 */
const fs = require("fs");
const path = require("path");
const { script, HTML_PATH } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* ---------- 1. Todo id referido existe ---------- */
const html = fs.readFileSync(HTML_PATH, "utf8");
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const used = [...html.matchAll(/(?:\$id|getElementById)\(\s*"([^"]+)"\s*\)/g)].map(m => m[1]);
ok(used.length > 50, `se han encontrado referencias a id que revisar: ${used.length}`);
const missingIds = [...new Set(used)].filter(id => !ids.has(id));
ok(missingIds.length === 0,
  "hay id referidos que no existen en el HTML: " + missingIds.join(", "));

/* ---------- 2. Toda función llamada está declarada ---------- */

/* Deja el código a la vista y borra todo lo demás, conservando las
   posiciones (mismo tamaño) para que nada se desplace. Recorre con una
   pila porque una plantilla puede contener `${...}` con más código
   dentro, con sus propias cadenas: sin esa recursión, `"cortado(s)"`
   dentro de un `${cut ? … : …}` se leía como una llamada a `cortado`. */
function maskCode(src) {
  const out = src.split("");
  const blank = i => { if (out[i] !== "\n") out[i] = " "; };
  /* Un "/" abre expresión regular solo si lo anterior significativo no
     puede TERMINAR una expresión; si pudiera, es una división.       */
  const regexCanStart = i => {
    for (let k = i - 1; k >= 0; k--) {
      const c = src[k];
      if (/\s/.test(c)) continue;
      if (/[)\]}]/.test(c)) return false;
      if (/[\w$]/.test(c)) {
        let j = k;
        while (j >= 0 && /[\w$]/.test(src[j])) j--;
        return ["return", "typeof", "case", "in", "of", "new", "delete",
                "void", "throw", "do", "else", "instanceof", "yield", "await"]
          .includes(src.slice(j + 1, k + 1));
      }
      return true;
    }
    return true;
  };
  const tpl = []; /* profundidad de llaves por plantilla abierta */
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") blank(i++);
    } else if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      while (i < stop) blank(i++);
    } else if (c === '"' || c === "'") {
      i++; /* la comilla se conserva: delimita, no es contenido */
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") blank(i++);
        blank(i++);
      }
      i++;
    } else if (c === "`") {
      tpl.push(0);
      i++;
      /* Dentro de la plantilla: se borra el texto y se entra en ${...}
         volviendo al bucle normal, que es lo que hace la recursión.  */
      while (i < src.length && tpl.length) {
        if (src[i] === "\\") { blank(i++); blank(i++); continue; }
        if (src[i] === "$" && src[i + 1] === "{") { i += 2; break; }
        if (src[i] === "`") { tpl.pop(); i++; break; }
        blank(i++);
      }
    } else if (tpl.length && c === "}") {
      /* Cierra un ${...}: se vuelve al texto de la plantilla */
      i++;
      while (i < src.length && tpl.length) {
        if (src[i] === "\\") { blank(i++); blank(i++); continue; }
        if (src[i] === "$" && src[i + 1] === "{") { i += 2; break; }
        if (src[i] === "`") { tpl.pop(); i++; break; }
        blank(i++);
      }
    } else if (c === "/" && regexCanStart(i)) {
      let j = i + 1, cls = false;
      while (j < src.length && (cls || src[j] !== "/")) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        else if (src[j] === "\n") break;
        j++;
      }
      if (src[j] === "/") { while (i <= j) blank(i++); } else i++;
    } else i++;
  }
  return out.join("");
}

const code = maskCode(script);
ok(code.length === script.length, "el enmascarado conserva las posiciones");
/* Si el enmascarado se rompiera, esto lo diría en vez de dejar pasar
   una comprobación que ya no mira nada.                              */
ok(/\bfunction navMessage\(/.test(code), "el código real sigue visible tras enmascarar");
ok(!code.includes("Registro de la sesión"), "y la prosa de los comentarios ha desaparecido");

/* Todo lo que LIGA un nombre cuenta como declarado. No se mira el
   ámbito a propósito: aquí la pregunta es «¿existe este nombre en
   alguna parte?», que es justo lo que falla cuando un refactor borra un
   ayudante y deja las llamadas.                                      */
const bound = new Set();
const collect = re => { for (const m of code.matchAll(re)) if (m[1]) bound.add(m[1]); };
collect(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g);
collect(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);
collect(/([A-Za-z_$][\w$]*)\s*:/g);                                    /* clave de objeto   */
collect(/(?:^|[,{]\s*)([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm);        /* método abreviado  */
collect(/\b(?:get|set)\s+([A-Za-z_$][\w$]*)\s*\(/g);                   /* getter / setter   */
for (const re of [/function\s*[\w$]*\s*\(([^)]*)\)/g, /\(([^()]*)\)\s*=>/g, /catch\s*\(([^)]*)\)/g]) {
  for (const m of code.matchAll(re)) {
    for (const id of m[1].match(/[A-Za-z_$][\w$]*/g) || []) bound.add(id);
  }
}
for (const m of code.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) bound.add(m[2]); /* x => … */

/* Palabras que van seguidas de "(" sin ser llamadas */
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "typeof",
  "function", "new", "await", "do", "else", "case", "delete", "void", "in", "of",
  "yield", "instanceof", "throw", "async"]);

/* Globales que el visor usa y nadie declara. Lista EXPLÍCITA: así,
   depender de una API nueva del navegador obliga a añadirla aquí, que
   es justo el momento de preguntarse si está disponible en todos los
   navegadores objetivo. `html2canvas` es la única de librería, y su
   ausencia ya la comprueba exportMapPng antes de usarla.             */
const GLOBALS = new Set([
  "AbortController", "Blob", "DOMParser", "Date", "Error", "Map", "Number",
  "Promise", "RegExp", "Set", "String", "URLSearchParams",
  "cancelAnimationFrame", "clearTimeout", "encodeURIComponent", "fetch",
  "isFinite", "parseFloat", "parseInt", "requestAnimationFrame",
  "setInterval", "setTimeout",
  "html2canvas"
]);

const called = new Set();
for (const m of code.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[2]);
ok(called.size > 200, `se han encontrado llamadas que revisar: ${called.size}`);

const undeclared = [...called]
  .filter(n => !bound.has(n) && !KEYWORDS.has(n) && !GLOBALS.has(n))
  .sort();
ok(undeclared.length === 0,
  "se llama a algo que no está declarado en ninguna parte (¿un ayudante retirado "
  + "en un refactor, o un global nuevo que falta en GLOBALS?): " + undeclared.join(", "));

/* Y la comprobación inversa, barata y con la misma causa: un `function`
   declarado y nunca llamado suele ser un resto de un refactor. No falla
   —puede haber puntos de entrada legítimos— pero se enumera.         */
const declaredFns = [...code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
const unused = declaredFns.filter(n => !called.has(n));
if (unused.length) console.log("  (aviso, no fallo) funciones declaradas y nunca llamadas: " + unused.join(", "));

if (!process.exitCode) console.log("STATIC CHECKS OK");
