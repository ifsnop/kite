/* Shared extraction of the delivered code, for every test suite.

   The suites exercise the code that SHIPS: they read kitelocal.html,
   pull functions and constants out of its embedded <script> as text and
   evaluate them in isolation, so nothing they prove is about a copy
   that may have fallen behind.

   Doing that per suite bred twenty near-identical extractors, and the
   cost was not the duplication: each copy learned the traps separately,
   and always one function too late. Three functions reached a suite
   silently TRUNCATED — collectWmsLayers (which is why its `opts` was
   kept out of the signature, a constraint the PRODUCTION code was made
   to carry for the tests' sake), deleteNode/showLayerInfo, and finally
   navMessage, which forced msglog.js to learn the very same lesson
   lazytree.js had already learned. This module is the one place that
   knows them.

   The traps, in the order they were found:

   1. `async` sits BEFORE `function`, so indexOf("function NAME(")
      starts past it and the extraction loses the keyword, leaving a
      stray `await` outside any async function.
   2. A destructured parameter puts {}-pairs in the SIGNATURE —
      deleteNode(li, { pruneSelection = true } = {}), navMessage(txt,
      { sticky … }), showLayerInfo(li, { focus = true } = {}) — so
      brace-matching from the first "{" after the name closes on the
      destructure and returns a function cut off before its body. The
      parameter list is skipped by paren depth first; braces are only
      counted after it.
   3. A marker that no longer exists: indexOf returns -1 and
      String.slice reads that as "one from the end", so renaming a
      comment in the source leaves a suite holding a plausible-looking
      fragment instead of an error. `between` and `constDecl` throw.

   And the guard for the trap not yet found: every extraction is checked
   to PARSE before it is returned. That is what turns the fourth trap
   into a named error here instead of a baffling failure downstream —
   all seven functions the naive extractor truncates in the current file
   (navMessage, makeNode, deleteNode, showLayerInfo, setupDialog,
   openStyleDialog, makeElevationSource) fail that check loudly.

   Why plain brace counting, with no awareness of strings or comments:
   measured on the current file (2026-09-08), all 341 declared functions
   extract to exactly the same span whether braces are counted over the
   raw text or over text with strings, template literals, comments and
   regex literals masked out, and all 341 parse. A tokenizer would buy
   nothing today; the parse check is what will say so when it stops
   being true.                                                        */
const fs = require("fs");
const path = require("path");

const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const script = fs.readFileSync(HTML_PATH, "utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];

/* Syntax-only check: `new Function` compiles without resolving any of
   the outer identifiers the extracted code closes over, which is
   exactly the reach we want here.                                    */
function checked(src, what) {
  try {
    new Function(src);
  } catch (e) {
    throw new Error(`extracción de ${what} inválida (¿trampa nueva del extractor?): ${e.message}\n`
      + `--- extraído ---\n${src.length > 400 ? src.slice(0, 400) + "…" : src}`);
  }
  return src;
}

/* A whole function declaration, by name.

   ONE parameter on purpose: navtest.js does [...names].map(fn), and
   Array.map passes an index and the array too. A second parameter here
   would silently receive that index.                                 */
function fn(name) {
  let i = script.indexOf(`function ${name}(`);
  if (i < 0) throw new Error("función no encontrada en el script: " + name);
  if (script.slice(Math.max(0, i - 6), i) === "async ") i -= 6; /* trap 1 */
  let paren = 0, p = script.indexOf("(", i);                    /* trap 2 */
  for (; p < script.length; p++) {
    if (script[p] === "(") paren++;
    else if (script[p] === ")" && --paren === 0) break;
  }
  let depth = 0;
  for (let k = script.indexOf("{", p); k < script.length; k++) {
    if (script[k] === "{") depth++;
    else if (script[k] === "}" && --depth === 0) return checked(script.slice(i, k + 1), `function ${name}`);
  }
  throw new Error("no se cierra el cuerpo de: " + name);
}

/* A single `const NAME … ;` declaration.

   Deliberately simple — it cuts at the FIRST ";" — so an arrow with a
   body, or one with a ";" inside a string (escapeHtml, fmtBytes), does
   not fit and fails the parse check instead of being guessed at. For
   those, and for anything spanning several statements, use between(). */
function constDecl(name) {
  const i = script.indexOf(`const ${name}`);
  if (i < 0) throw new Error("const no encontrada en el script: " + name);
  const end = script.indexOf(";", i);
  if (end < 0) throw new Error("const sin ';' de cierre: " + name);
  return checked(script.slice(i, end + 1), `const ${name}`);
}

/* A range of the script between two literal markers, `from` included
   and `to` excluded. Both must exist: see trap 3.

   No parse check — a range is not required to be a complete list of
   statements, and several suites deliberately cut stretches of
   constants that only compile alongside another stretch.             */
function between(from, to) {
  const i = script.indexOf(from);
  if (i < 0) throw new Error("marcador inicial no encontrado en el script: " + JSON.stringify(from));
  const j = script.indexOf(to, i);
  if (j < 0) throw new Error("marcador final no encontrado en el script: " + JSON.stringify(to));
  return script.slice(i, j);
}

module.exports = { HTML_PATH, script, fn, constDecl, between };
