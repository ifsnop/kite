#!/usr/bin/env node
/* Herramienta de traducción de KITE Local: saca de src/ todo el texto de
   la interfaz y lo compara con los diccionarios (src/js/04-i18n-xx.js).

   El texto en español ES la clave (ver src/js/03-i18n.js), así que no hay
   catálogo aparte que mantener: las claves salen de las llamadas
   tr("…"), trn(n, "…", "…") y N_("…") del código y de los fragmentos de
   texto de src/index.html. Esta herramienta es lo que lo demuestra, y la
   usa tests/i18n.js para que un texto sin traducir no pase el CI.

   Uso:  node i18n-tool.js stats             cuántas claves hay y qué idioma las cubre
         node i18n-tool.js missing <lang>    claves sin traducir (clave por línea)
         node i18n-tool.js sync <lang>       reescribe src/js/04-i18n-<lang>.js: conserva
                                             lo traducido, añade las claves nuevas con ""
                                             y quita las que ya no existen
         node i18n-tool.js new <lang> <Nombre>  crea el diccionario de un idioma nuevo
                                             (todo "" por traducir) y dice la línea que
                                             falta en el manifiesto de build.js

   Un valor "" es «sin traducir»: el idioma cae a inglés y luego a español. */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const JS_DIR = path.join(ROOT, "src", "js");
const HTML = path.join(ROOT, "src", "index.html");
/* Archivos de src/js que no llevan texto de la interfaz para traducir */
const SKIP = f => /^(03-|04-i18n-[a-z]{2,3}\.js|05-mdi-icons)/.test(f) || !f.endsWith(".js");

const placeholders = str => new Set([...String(str).matchAll(/\{(\w+)\}/g)].map(m => m[1]));

/* ---- Claves del código ---- */
function acornParse(src) {
  /* acorn llega como dependencia de terser, que ya usa el build */
  return require("acorn").parse(src, { ecmaVersion: "latest", locations: true });
}

/* Valor de una expresión que es un texto constante (literal, plantilla
   sin expresiones, o suma de ellos); undefined si no lo es.            */
function constString(n) {
  if (!n) return undefined;
  if (n.type === "Literal" && typeof n.value === "string") return n.value;
  if (n.type === "TemplateLiteral" && n.expressions.length === 0) return n.quasis[0].value.cooked;
  if (n.type === "BinaryExpression" && n.operator === "+") {
    const a = constString(n.left), b = constString(n.right);
    return a !== undefined && b !== undefined ? a + b : undefined;
  }
  return undefined;
}

/* { keys: Map(clave → { files:Set, plural:{one}|null }), dynamic:[{file,line}] } */
function collectCodeKeys() {
  const keys = new Map(), dynamic = [];
  const add = (key, file, plural) => {
    let e = keys.get(key);
    if (!e) keys.set(key, e = { files: new Set(), plural: null });
    e.files.add(file);
    if (plural) e.plural = plural;
  };
  for (const file of fs.readdirSync(JS_DIR).sort()) {
    if (SKIP(file)) continue;
    const ast = acornParse(fs.readFileSync(path.join(JS_DIR, file), "utf8"));
    (function walk(n) {
      if (!n || typeof n.type !== "string") return;
      if (n.type === "CallExpression" && n.callee.type === "Identifier") {
        const name = n.callee.name;
        if (name === "tr" || name === "N_") {
          const k = constString(n.arguments[0]);
          if (k === undefined) dynamic.push({ file, line: n.loc.start.line });
          else add(k, file, null);
        } else if (name === "trc") {
          const ctx = constString(n.arguments[0]), k = constString(n.arguments[1]);
          if (ctx === undefined || k === undefined) dynamic.push({ file, line: n.loc.start.line });
          else add(ctx + "\u0004" + k, file, null);
        } else if (name === "trn") {
          const one = constString(n.arguments[1]), other = constString(n.arguments[2]);
          if (other === undefined || one === undefined) dynamic.push({ file, line: n.loc.start.line });
          else add(other, file, { one });
        }
      }
      for (const k in n) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") walk(v);
      }
    })(ast);
  }
  return { keys, dynamic };
}

/* ---- Claves del HTML (las mismas que recorre el traductor en ejecución) ---- */
function collectHtmlKeys() {
  const { parseHTML } = require("linkedom");
  const core = new Function(fs.readFileSync(path.join(JS_DIR, "03-i18n.js"), "utf8")
    + "\nreturn { walkI18nDom };")();
  const { document } = parseHTML(fs.readFileSync(HTML, "utf8"));
  const keys = new Map(), htmlIds = new Map();
  core.walkI18nDom(document.documentElement, (key, apply, isHtml) => {
    if (isHtml) { htmlIds.set(key, true); return; }
    if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(key) || /^https?:\/\//.test(key)) return; /* símbolos, cifras o una dirección de ejemplo */
    keys.set(key, { files: new Set(["index.html"]), plural: null });
  });
  return { keys, htmlIds };
}

/* ---- Diccionarios ---- */
function dictFiles() {
  return fs.readdirSync(JS_DIR).filter(f => /^04-i18n-(?!init)[a-z]+\.js$/.test(f)).sort();
}
function loadDict(lang) {
  const file = path.join(JS_DIR, `04-i18n-${lang}.js`);
  if (!fs.existsSync(file)) return null;
  let found = null;
  new Function("registerLang", fs.readFileSync(file, "utf8"))((code, name, dict) => { found = { code, name, dict }; });
  return found;
}

/* Todo lo que hay que traducir: claves del código + del HTML, más los
   identificadores de los bloques de HTML (que solo viven en el HTML).  */
function collectAll() {
  const code = collectCodeKeys(), html = collectHtmlKeys();
  const keys = new Map(code.keys);
  for (const [k, v] of html.keys) {
    const e = keys.get(k);
    if (e) v.files.forEach(f => e.files.add(f));
    else keys.set(k, v);
  }
  return { keys, htmlIds: [...html.htmlIds.keys()], dynamic: code.dynamic };
}

function translated(v) {
  if (typeof v === "string") return v !== "";
  return !!v && typeof v === "object" && typeof v.other === "string" && v.other !== "";
}

/* ---- Reescritura de un diccionario ---- */
const q = s => JSON.stringify(s);
function renderDict(code, name, all, old) {
  const lines = [];
  const groups = new Map();
  for (const [key, e] of all.keys) {
    const g = [...e.files].sort()[0];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(key);
  }
  const order = [...groups.keys()].sort((a, b) => (a === "index.html") - (b === "index.html") || a.localeCompare(b));
  const entry = (k, v) => {
    if (v && typeof v === "object") {
      return `  ${q(k)}: { ${Object.entries(v).map(([c, t]) => `${c}: ${q(t)}`).join(", ")} },`;
    }
    return `  ${q(k)}: ${q(v)},`;
  };
  const ids = all.htmlIds;
  for (const g of order) {
    lines.push(`  /* ${g} */`);
    for (const k of groups.get(g)) lines.push(entry(k, old[k] !== undefined ? old[k] : ""));
  }
  if (ids.length) {
    lines.push("  /* Bloques de HTML de index.html (data-i18n-html): el valor es el HTML entero */");
    for (const id of ids) lines.push(entry(id, old[id] !== undefined ? old[id] : ""));
  }
  const head = code === "en"
    ? "/* Diccionario inglés. La clave es el texto en español; \"\" = sin traducir (se\n   ve el español). Lo mantiene `node i18n-tool.js sync en`; ver i18n.md. */"
    : `/* Diccionario «${name}». La clave es el texto en español; "" = sin traducir (cae\n   a inglés y luego a español). Lo mantiene \`node i18n-tool.js sync ${code}\`. */`;
  return `${head}\nregisterLang(${q(code)}, ${q(name)}, {\n${lines.join("\n").replace(/,$/, "")}\n});\n`;
}

function sync(lang, nameIfNew) {
  const all = collectAll();
  const cur = loadDict(lang);
  if (!cur && !nameIfNew) throw new Error(`no existe src/js/04-i18n-${lang}.js (usa «new»)`);
  const text = renderDict(lang, cur ? cur.name : nameIfNew, all, cur ? cur.dict : {});
  fs.writeFileSync(path.join(JS_DIR, `04-i18n-${lang}.js`), text);
  return { total: all.keys.size + all.htmlIds.length };
}

module.exports = { renderDict, collectAll, collectCodeKeys, collectHtmlKeys, loadDict, dictFiles, placeholders, translated, constString };

if (require.main === module) {
  const [cmd, lang, name] = process.argv.slice(2);
  const all = collectAll();
  if (cmd === "stats") {
    console.log(`${all.keys.size} textos + ${all.htmlIds.length} bloques de HTML, ${all.dynamic.length} llamadas con clave dinámica`);
    for (const f of dictFiles()) {
      const d = loadDict(f.slice(8, -3));
      const have = [...all.keys.keys(), ...all.htmlIds].filter(k => translated(d.dict[k])).length;
      console.log(`  ${d.code} (${d.name}): ${have}/${all.keys.size + all.htmlIds.length}`);
    }
  } else if (cmd === "missing") {
    const d = loadDict(lang);
    if (!d) { console.error(`no existe el diccionario «${lang}»`); process.exit(1); }
    for (const k of [...all.keys.keys(), ...all.htmlIds]) if (!translated(d.dict[k])) console.log(k);
  } else if (cmd === "sync") {
    const r = sync(lang);
    console.log(`src/js/04-i18n-${lang}.js reescrito (${r.total} entradas)`);
  } else if (cmd === "new") {
    if (!lang || !name) { console.error("uso: node i18n-tool.js new <código> <Nombre del idioma en su idioma>"); process.exit(1); }
    if (loadDict(lang)) { console.error(`ya existe el diccionario «${lang}»`); process.exit(1); }
    const r = sync(lang, name);
    console.log(`creado src/js/04-i18n-${lang}.js (${r.total} entradas por traducir).\n`
      + `Falta una línea en el manifiesto JS de build.js, ANTES de "04-i18n-init.js":\n  "04-i18n-${lang}.js",`);
  } else {
    console.error("uso: node i18n-tool.js stats | missing <lang> | sync <lang> | new <lang> <Nombre>");
    process.exit(1);
  }
}
