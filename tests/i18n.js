/* Textos de la interfaz: nada sin traducir, ni traducciones sueltas.

   El texto en español es la clave (src/js/03-i18n.js). Esta suite lo que
   comprueba es que ese contrato se cumple en TODO el código, no solo en lo
   que alguien se acordó de envolver en tr():

   1. Cada clave —de tr(), trn(), N_() y del HTML— tiene su traducción en
      inglés, con los mismos {marcadores} que el original.
   2. El diccionario no guarda claves que ya no existen.
   3. Ningún literal del código que parezca español y vaya a pantalla se
      queda fuera de tr(): se busca por la forma (tildes, ¿ ¡, palabras
      españolas corrientes) y por el sitio donde acaba (textContent, title,
      navMessage…). Lo que de verdad no se traduce se declara aquí, con motivo.
   4. Los bloques de HTML (data-i18n-html) tienen entrada con el HTML entero.
   5. Todo diccionario está en el manifiesto de build.js, antes del arranque
      de idioma, y los idiomas extra no rompen nada: marcadores iguales y
      plurales completos.
   6. tr(), trn() y el traductor se portan como dice 03-i18n.js: respaldo
      inglés → español, marcadores, plurales con Intl.PluralRules y el HTML.

   Para ver qué falta:  node i18n-tool.js missing en                      */
const fs = require("fs");
const path = require("path");
const acorn = require("acorn");
const tool = require("../i18n-tool.js");

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error("  ✗ " + msg); } };

const JS_DIR = path.join(__dirname, "..", "src", "js");
const all = tool.collectAll();
const en = tool.loadDict("en");

/* ---------------- 1 y 2: el inglés cubre todo y no sobra nada ---------------- */
ok(en && en.code === "en" && en.name === "English", "src/js/04-i18n-en.js registra el inglés");
const wanted = new Set([...all.keys.keys(), ...all.htmlIds]);
const missing = [...wanted].filter(k => !tool.translated(en.dict[k]));
ok(!missing.length, `${missing.length} texto(s) sin traducir al inglés (node i18n-tool.js missing en):\n    `
  + missing.slice(0, 15).map(k => JSON.stringify(k.length > 90 ? k.slice(0, 90) + "…" : k)).join("\n    ")
  + (missing.length > 15 ? `\n    … y ${missing.length - 15} más` : ""));
const orphans = Object.keys(en.dict).filter(k => !wanted.has(k));
ok(!orphans.length, `${orphans.length} clave(s) del diccionario inglés que ya no existen (node i18n-tool.js sync en):\n    `
  + orphans.slice(0, 10).map(k => JSON.stringify(k.slice(0, 90))).join("\n    "));

/* Marcadores y plurales de cada idioma extra: cuando existan, que no rompan */
for (const f of tool.dictFiles()) {
  const d = tool.loadDict(f.slice(8, -3));
  for (const [k, e] of all.keys) {
    const v = d.dict[k];
    if (!tool.translated(v)) continue;
    const forms = typeof v === "string" ? [v] : Object.values(v);
    const want = [...tool.placeholders(k)].sort().join(",");
    for (const form of forms) {
      const got = [...tool.placeholders(form)].sort().join(",");
      /* una forma de plural puede escribir el número con letras ({n} opcional) */
      const fine = got === want || (e.plural && want.replace(/(^|,)n(,|$)/, "$2") === got.replace(/(^|,)n(,|$)/, "$2"));
      ok(fine, `[${d.code}] marcadores distintos en ${JSON.stringify(k.slice(0, 60))}: «${want}» frente a «${got}»`);
    }
    if (typeof v === "object") ok(typeof v.other === "string" && v.other, `[${d.code}] el plural de ${JSON.stringify(k.slice(0, 60))} necesita «other»`);
  }
  for (const id of all.htmlIds) {
    const v = d.dict[id];
    if (tool.translated(v)) ok(typeof v === "string", `[${d.code}] ${id}: el bloque de HTML es una cadena`);
  }
}

/* ---------------- 3: lo que parece español y no está en tr() ---------------- */
/* Excepciones DELIBERADAS: texto que no se traduce y por qué. La clave es el
   texto exacto; el valor, el motivo (se lee en el diff, no se ejecuta).      */
const KEEP = new Map([
  /* Créditos de los proveedores de datos: el texto lo fija quien los cede y se
     muestra tal cual en todos los idiomas (atribución en la línea inferior). */
  ["Cedido por &copy; Instituto Geográfico Nacional de España", "Crédito del IGN"],
  ["MTN ráster. {}", "Crédito del IGN"],
  ["PNOA Máxima Actualidad. {}", "Crédito del IGN"],
  ["PNOA histórico. {}", "Crédito del IGN"],
  ["Copernicus DEM © DLR e.V. 2010-2014 y © Airbus Defence and Space GmbH 2014-2018 (Copernicus, UE/ESA), vía <a href=\"https://www.digitalearthafrica.org\">Digital Earth Africa</a>", "Crédito de Copernicus"],
  ["\u00A9 Direcci\u00F3n General del Catastro", "Crédito del Catastro"],
  ["Leaflet no disponible: se detiene el arranque", "Error de arranque: el idioma aún no se ha leído"],
  ["Iluminación día/noche: WebGL no disponible", "console.error para quien depura"],
  ["fallo al compilar el shader", "Error interno de WebGL"],
  ["fallo al enlazar el programa", "Error interno de WebGL"],
  ["Lat\tLon\tAlt", "Cabecera del formato de texto de la lista de puntos (se interpreta al leer)"]
]);
/* Trozos del aviso de «Leaflet no se pudo cargar» (10-map.js): sale antes de
   que nada pueda arrancar, tal cual está escrito para quien lo lee.        */
const LEAFLET_GUARD = /No se pudo cargar Leaflet|librería de mapas Leaflet|Compruebe la conexi|hash de integridad|a propósito\. La consola|vía <a href|precision highp float/;
const ES_WORD = /\b(de|del|la|las|el|los|un|una|que|se|no|con|para|por|en|es|al|y|o|su|sin|más|hay|está|este|esta|esto|solo|puede|debe|ya|desde|entre|sobre|todo|cada|nodo|capa|capas|archivo|dirección|servicio|servidor|punto|puntos|ruta|mapa|vista|valor|fuente|tesela|elemento|elementos|cargado|cargada|descarga|error|aviso|nombre|carpeta|zona|celda|celdas|altura|altitud|longitud|latitud|tramo|tramos|medición|mediciones|propiedades|aceptar|cancelar|cerrar|borrar|añadir|guardar|copiar|pegar)\b/i;
const looksSpanish = s => /[áéíóúñÁÉÍÓÚÑ¿¡]/.test(s) || (/\s/.test(s) && (s.match(new RegExp(ES_WORD.source, "gi")) || []).length >= 2);
/* Sitios donde un texto acaba en pantalla: cualquier literal con letras que
   llegue ahí tiene que pasar por tr() aunque no lleve tildes.            */
const SINK_ASSIGN = new Set(["textContent", "innerText", "title", "placeholder", "ariaLabel", "alt", "label", "innerHTML"]);
const SINK_CALL = new Set(["navMessage", "showTreePlaceholder", "setUrlState", "setProfileCloseLabel", "setProfileNote", "openProfileDialog", "pushUndo"]);
/* Sin las etiquetas de HTML y los huecos de una plantilla: <li class="empty">{}</li> no es texto */
const hasLetters = s => {
  const t = s.replace(/<[^>]*>/g, " ").replace(/\{\}/g, " ");
  return /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(t) && !/^[A-Za-z0-9_\-.:/#\[\]=*>~ ,()%'"|+]+$/.test(t.replace(/[a-z]+[A-Z]/g, "x"));
};
const WRAPPERS = new Set(["tr", "trn", "trc", "N_"]);

const leaks = [];
for (const file of fs.readdirSync(JS_DIR).sort()) {
  if (!file.endsWith(".js") || /^(03-|04-i18n-[a-z]{2,3}\.js|05-mdi-icons)/.test(file)) continue;
  const src = fs.readFileSync(path.join(JS_DIR, file), "utf8");
  const ast = acorn.parse(src, { ecmaVersion: "latest", locations: true });
  (function walk(n, stack) {
    if (!n || typeof n.type !== "string") return;
    const isStr = n.type === "Literal" && typeof n.value === "string";
    const isTpl = n.type === "TemplateLiteral";
    if (isStr || isTpl) {
      const text = isStr ? n.value : n.quasis.map(q => q.value.cooked).join("{}");
      /* ¿dentro de tr()/trn()/N_(), directamente o por una suma de textos? */
      let k = stack.length - 1;
      while (k >= 0 && stack[k].type === "BinaryExpression" && stack[k].operator === "+") k--;
      const up = k >= 0 ? stack[k] : null;
      const wrapped = up && up.type === "CallExpression" && up.callee.type === "Identifier" && WRAPPERS.has(up.callee.name);
      if (!wrapped && hasLetters(text) && !KEEP.has(text) && !LEAFLET_GUARD.test(text)) {
        const parent = stack[stack.length - 1];
        const sink = (parent.type === "AssignmentExpression" && parent.right === n && parent.left.property
            && SINK_ASSIGN.has(parent.left.property.name))
          || (parent.type === "CallExpression" && parent.arguments.includes(n) && parent.callee.type === "Identifier" && SINK_CALL.has(parent.callee.name))
          || (parent.type === "CallExpression" && parent.callee.property && parent.callee.property.name === "setAttribute"
              && parent.arguments[0] && /^(title|aria-label|placeholder|alt)$/.test(parent.arguments[0].value) && parent.arguments[1] === n);
        if (looksSpanish(text) || (sink && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(text))) {
          leaks.push(`${file}:${n.loc.start.line}  ${JSON.stringify(text.replace(/\s+/g, " ").slice(0, 100))}`);
        }
      }
    }
    stack.push(n);
    for (const key in n) {
      const v = n[key];
      if (Array.isArray(v)) v.forEach(x => walk(x, stack));
      else if (v && typeof v === "object") walk(v, stack);
    }
    stack.pop();
  })(ast, []);
}
ok(!leaks.length, `${leaks.length} literal(es) que parecen texto de la interfaz fuera de tr():\n    ${leaks.slice(0, 40).join("\n    ")}`
  + (leaks.length > 40 ? `\n    … y ${leaks.length - 40} más` : ""));

/* ---------------- 4: bloques de HTML ---------------- */
for (const id of all.htmlIds) {
  const v = en.dict[id];
  ok(typeof v === "string" && /</.test(v), `${id}: el diccionario inglés debe traer el HTML del bloque`);
}

/* ---------------- 5: el manifiesto ---------------- */
const build = fs.readFileSync(path.join(__dirname, "..", "build.js"), "utf8");
const manifest = [...build.matchAll(/^\s*"(\d\d[^"]*\.js)"/gm)].map(m => m[1]);
const initAt = manifest.indexOf("04-i18n-init.js");
ok(initAt > 0, "04-i18n-init.js está en el manifiesto de build.js");
ok(manifest[0] === "03-i18n.js", "03-i18n.js va el primero del manifiesto");
for (const f of tool.dictFiles()) {
  const at = manifest.indexOf(f);
  ok(at > 0 && at < initAt, `${f} está en el manifiesto de build.js, antes de 04-i18n-init.js`);
}

/* ---------------- 6: el motor ---------------- */
{
  const core = new Function(fs.readFileSync(path.join(JS_DIR, "03-i18n.js"), "utf8")
    + "\nreturn { SOURCE_LANG, UI_LANGS, I18N_DICT, registerLang, resolveUiLang, setUiLang, tr, trn, trc, N_, fillVars, getLang: () => uiLang };")();
  core.registerLang("en", "English", {
    "Hola": "Hello", "Adiós": "", "{n} cosas": { one: "{n} thing", other: "{n} things" }, "{n} perros": "{n} dog(s)",
    "Bienvenido, {name}": "Welcome, {name}"
  });
  core.registerLang("fr", "Français", { "Hola": "Bonjour", "{n} cosas": "{n} chose(s)" });
  core.registerLang("ru", "Русский", { "{n} cosas": { one: "{n} вещь", few: "{n} вещи", many: "{n} вещей", other: "{n} вещи" } });

  core.setUiLang("es");
  ok(core.tr("Hola") === "Hola" && core.tr("Bienvenido, {name}", { name: "Ana" }) === "Bienvenido, Ana", "español: la clave es el texto");
  ok(core.trn(1, "{n} cosa", "{n} cosas") === "1 cosa" && core.trn(3, "{n} cosa", "{n} cosas") === "3 cosas", "español: plural con Intl.PluralRules");
  ok(core.tr("sin variables {x}") === "sin variables {x}", "una llave sin variable no se toca");

  core.setUiLang("en");
  ok(core.tr("Hola") === "Hello" && core.tr("Bienvenido, {name}", { name: "Ana" }) === "Welcome, Ana", "inglés: traduce e interpola");
  ok(core.tr("Adiós") === "Adiós", "un valor vacío cae al español");
  ok(core.tr("Desconocido") === "Desconocido", "sin entrada, se ve el español");
  ok(core.trn(1, "{n} cosa", "{n} cosas") === "1 thing" && core.trn(2, "{n} cosa", "{n} cosas") === "2 things", "inglés: plural en objeto");
  ok(core.trn(2, "{n} perro", "{n} perros") === "2 dog(s)", "inglés: una cadena vale para todos los números");

  core.registerLang("en", "English", { ...core.I18N_DICT.en, "de una línea\u0004Longitud": "Length", "Longitud": "Longitude" });
  ok(core.trc("de una línea", "Longitud") === "Length" && core.tr("Longitud") === "Longitude", "inglés: el contexto separa dos textos iguales en español");
  core.setUiLang("es");
  ok(core.trc("de una línea", "Longitud") === "Longitud", "español: el contexto no cambia nada");
  core.setUiLang("en");

  core.setUiLang("fr");
  ok(core.tr("Hola") === "Bonjour", "francés: su traducción");
  ok(core.trc("de una línea", "Longitud") === "Length", "francés: un texto con contexto sin traducir cae a inglés, no a la palabra sin contexto");
  ok(core.tr("Bienvenido, {name}", { name: "Ana" }) === "Welcome, Ana", "francés: lo que no tiene cae a inglés antes que al español");
  ok(core.tr("Adiós") === "Adiós", "francés: sin nada en ningún idioma, el español");
  ok(core.getLang() === "fr", "setUiLang fija el idioma");

  core.setUiLang("ru");
  ok([1, 3, 5, 2.5].map(n => core.trn(n, "{n} cosa", "{n} cosas")).join("|") === "1 вещь|3 вещи|5 вещей|2.5 вещи", "ruso: cuatro formas de plural");

  core.setUiLang("xx");
  ok(core.getLang() === "en", "un código desconocido cae a inglés");

  ok(core.resolveUiLang("auto", ["fr-CA", "en"]) === "fr", "«Automático» toma el primer idioma del navegador que tenemos, por su código base");
  ok(core.resolveUiLang("auto", ["de-DE", "es-MX"]) === "es", "«Automático» salta los idiomas que no tenemos");
  ok(core.resolveUiLang("auto", ["de"]) === "en", "«Automático» sin ninguno: inglés");
  ok(core.resolveUiLang("auto", []) === "en" && core.resolveUiLang("auto", undefined) === "en", "«Automático» sin idiomas del navegador: inglés");
  ok(core.resolveUiLang("es", ["en"]) === "es" && core.resolveUiLang("zz", ["es"]) === "es", "una preferencia válida manda; una inválida se ignora");
  ok(core.N_("texto") === "texto", "N_ no cambia nada");
}

if (failures) { console.error(`\n${failures} comprobación(es) fallida(s)`); process.exit(1); }
console.log(`I18N TESTS OK (${wanted.size} textos, ${tool.dictFiles().length} diccionario(s))`);
