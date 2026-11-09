/* Comprobaciones estáticas del archivo entregado.

   CLAUDE.md lleva una lista de cosas que «conviene pasar» sobre
   kitelocal.html. Tres ya las cubren otras suites (SRI, el guardián de
   Leaflet, el valor de BUILD). Las tres que quedaban se hacían a mano —y
   por eso no se hacían casi nunca— son las de aquí:

   1. Que todo `$id("x")` / `getElementById("x")` apunte a un `id` que
      exista de verdad en el HTML. Un id mal escrito no rompe nada al
      cargar: `$id` devuelve null y el fallo aparece más tarde, en el
      diálogo que nadie abrió durante la prueba.
   2. Que toda función llamada esté declarada. Un refactor puede
      llevarse por delante un ayudante que sigue en uso y `node --check`
      no lo detecta, porque el archivo sigue siendo válido: el error solo
      sale al ejecutar esa rama.
   3. Que no se haya colado ningún byte NUL. Encontrado uno de verdad,
      dentro de un template literal de `navMessage`
      (`` `${tone}\0${txt}` `` en vez de `` `${tone} ${txt}` ``, un
      separador que no se ve al leer el código): no rompía nada en el
      navegador —un `\0` es un carácter Unicode válido dentro de una
      cadena— pero hacía que `grep` sin `-a` tratara el archivo como
      binario y dejara de encontrar nada en él, incluido lo que buscan
      el punto 10 del checklist y el resto de suites de esta lista.
   4. Regla de la × de los diálogos (ver .claude/rules/dialog-close-button.md):
      TODO diálogo (`dlg-overlay`/`dlg-float`) lleva UNA × arriba a la
      derecha, dentro de su `<h2 class="dlg-head">`; pulsarla hace lo que
      su Cancelar o, si no lo tiene, su Cerrar: su `data-cancel` (o, en
      los tres que ya la tenían, su propio `id`) apunta a un botón de la
      MISMA caja. Y un diálogo con un único botón en el pie no lo lleva
      en el pie: es la × y no tiene pie (`no-actions`).
   6. Movimiento reducido (ver .claude/rules/motion.md): toda
      `animation:` del CSS tiene su anulación dentro de
      `@media (prefers-reduced-motion: reduce)`. Una animación nueva que
      se olvide de ahí la verían girar quienes pidieron que nada se mueva.

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

/* ---------- 3. Ningún byte NUL colado en el archivo ---------- */
const html = fs.readFileSync(HTML_PATH, "utf8");
ok(!html.includes("\0"), "el archivo entregado contiene un byte NUL: "
  + "revisar plantillas de texto (ver el caso real de navMessage arriba)");

/* ---------- 1. Todo id referido existe ---------- */
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
   navegadores objetivo. Las librerías bajo demanda (html2canvas,
   GeoTIFF, proj4) no se listan: llegan por `ensureLib` y de que nadie
   use su global sin pedirla se ocupa tests/lazylibs.js.               */
const GLOBALS = new Set([
  "AbortController", "Blob", "DOMParser", "Date", "Error", "Map", "Number",
  "Promise", "RegExp", "Set", "String", "URLSearchParams", "WeakMap",
  "cancelAnimationFrame", "clearInterval", "clearTimeout", "encodeURIComponent", "fetch",
  "isFinite", "parseFloat", "parseInt", "requestAnimationFrame",
  "setInterval", "setTimeout",
  /* `Float32Array`: buffer de vértices del quad a pantalla completa del
     efecto de iluminación día/noche (61-daynight.js, WebGL).          */
  "Float32Array",
  /* `URL` y `decodeURIComponent`: reconocer una dirección pegada por el
     usuario (ver fileNameFromUrl). Van en la lista explícita por lo
     mismo que el resto: depender de una API del navegador tiene que ser
     una decisión, no un descuido.                                      */
  "URL", "decodeURIComponent", "TextDecoder", "File", "Uint8Array",
  /* `DataView`: leer el directorio central de un zip descargado sin
     descomprimirlo (zipEntryNames). `proj4`: la librería de
     reproyección, que se llama como función (shpProjection).        */
  "DataView", "proj4",
  /* `Float64Array`: la malla de puntos proyectados de una tesela COG
     (renderCogTile, 64-cog.js).                                     */
  "Float64Array",
  /* `ResizeObserver`: la gráfica del perfil de una ruta se redibuja al
     tamaño de su ventana redimensionable (63-route-profile.js). En
     todos los navegadores objetivo desde 2020.                       */
  "ResizeObserver",
  /* `MutationObserver`: el filtro del árbol (45-tree-filter.js) re-filtra lo
     que nazca con el filtro puesto. Disponible en todos los navegadores objetivo. */
  "MutationObserver",
  /* `Event`: la casilla de una fila de una selección múltiple dispara el
     `change` de las demás seleccionadas (propagateCheck, 31-tree-node.js). */
  "Event",
  /* `Image`, `XMLSerializer` y `getComputedStyle`: exportar la gráfica del
     perfil como PNG (63-route-profile.js): se serializa su SVG con los
     estilos ya calculados y se dibuja en un lienzo. Disponibles en todos
     los navegadores objetivo; sin librería, a diferencia de html2canvas. */
  "Image", "XMLSerializer", "getComputedStyle",
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

/* ---------- 4. La × de TODO diálogo, arriba a la derecha ---------- */
const lone = [...html.matchAll(/<div class="dlg-actions">([\s\S]*?)<\/div>/g)]
  .filter(m => (m[1].match(/<button\b/g) || []).length === 1)
  .map(m => (m[1].match(/id="([^"]+)"/) || [, "?"])[1]);
ok(lone.length === 0, "diálogo con un pie de un solo botón (la regla lo pone como × en la cabecera): " + lone.join(", "));
const dialogStarts = [...html.matchAll(/<div id="([a-z0-9-]+)" class="(?:dlg-overlay|dlg-float)"/g)];
ok(dialogStarts.length >= 20, `se han encontrado diálogos: ${dialogStarts.length}`);
const crossProblems = [];
dialogStarts.forEach((m, i) => {
  const id = m[1];
  const box = html.slice(m.index, i + 1 < dialogStarts.length ? dialogStarts[i + 1].index : html.length);
  const head = box.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/);
  if (!head || !/<h2 class="dlg-head">/.test(head[0])) { crossProblems.push(`${id}: su cabecera no es <h2 class="dlg-head">`); return; }
  const crosses = head[1].match(/<button\b[^>]*class="dlg-close"[^>]*>/g) || [];
  if (crosses.length !== 1) { crossProblems.push(`${id}: lleva ${crosses.length} × en la cabecera (debe ser exactamente una)`); return; }
  const dc = crosses[0].match(/data-cancel="([^"]+)"/), own = crosses[0].match(/id="([^"]+)"/);
  if (!dc && !own) crossProblems.push(`${id}: su × no dice qué botón pulsa (data-cancel) ni tiene manejador propio (id)`);
  if (dc && !new RegExp(`<button\\b[^>]*id="${dc[1]}"`).test(box)) crossProblems.push(`${id}: data-cancel="${dc[1]}" no es un botón de esa misma caja`);
  if (/class="dlg-box no-actions"/.test(box) && /class="dlg-actions"/.test(box)) crossProblems.push(`${id}: caja sin pie (no-actions) que lleva pie`);
  if (!/title="[^"]+"/.test(crosses[0]) || !/aria-label="[^"]+"/.test(crosses[0])) crossProblems.push(`${id}: su × no lleva title y aria-label`);
});
ok(crossProblems.length === 0, "la × de los diálogos: " + crossProblems.join(" | "));

/* ---------- 5. Ningún nombre de nivel superior declarado dos veces ----------
   Todo `src/js` comparte UN ámbito global. Una `const` repetida
   rompe el arranque (se ve enseguida), pero una `function` repetida
   pisa EN SILENCIO a la anterior: así una función nueva del COG
   (`gridPoint`) dejó sin la suya a la consulta de elevación. Nivel
   superior = en la columna 0, que es como va todo el código.     */
const topNames = new Map();
for (const m of code.matchAll(/^(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
  topNames.set(m[1], (topNames.get(m[1]) || 0) + 1);
}
ok(topNames.size > 300, `se han encontrado nombres de nivel superior: ${topNames.size}`);
const twice = [...topNames].filter(([, n]) => n > 1).map(([k]) => k);
ok(twice.length === 0, "nombre de nivel superior declarado dos veces (el segundo pisa al primero): " + twice.join(", "));

/* ---------- 6. Toda animación tiene su anulación en movimiento reducido ----------
   Se lee el CSS del propio archivo entregado. El bloque se localiza
   contando llaves; cada `animation:` de fuera se identifica por su
   selector y ha de aparecer dentro del bloque con `animation: none`. */
const cssText = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join("\n");
const reduceAt = cssText.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/);
ok(reduceAt >= 0, "el CSS tiene un bloque @media (prefers-reduced-motion: reduce)");
if (reduceAt >= 0) {
  let i = cssText.indexOf("{", reduceAt), depth = 0, end = i;
  for (; end < cssText.length; end++) {
    if (cssText[end] === "{") depth++;
    else if (cssText[end] === "}" && --depth === 0) break;
  }
  const reduceBlock = cssText.slice(i + 1, end);
  const outside = cssText.slice(0, reduceAt) + cssText.slice(end + 1);
  const animSelectors = new Set();
  for (const m of outside.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*\banimation\s*:[^{}]*)\}/g)) {
    animSelectors.add(m[1].trim().replace(/\s+/g, " "));
  }
  ok(animSelectors.size >= 3, `se han encontrado las animaciones del CSS: ${[...animSelectors].join(" | ")}`);
  const flat = reduceBlock.replace(/\s+/g, " ");
  const missing = [...animSelectors].filter(sel => !new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{[^}]*animation: none").test(flat));
  ok(missing.length === 0, "animación sin anular en prefers-reduced-motion: " + missing.join(" | "));
}

if (!process.exitCode) console.log("STATIC CHECKS OK");
