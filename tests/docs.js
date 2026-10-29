/* Coherencia de la documentación (docs/ y tests/README.md).

   Lo que un número o una imagen mal puestos hacen a un manual o a un
   estudio de auditoría no lo caza ninguna otra suite: el estudio decía
   «60», «61», «61 de 61» y «60 conjuntos» a la vez, y ninguno era cierto;
   las capturas llevaban semanas desfasadas de la interfaz. Aquí se
   comprueba lo que se puede comprobar sin juicio humano (ver
   .claude/rules/docs-maintenance.md para lo que no).

   Cada comprobación es una función pura sobre texto que devuelve la lista
   de problemas. La suite la ejecuta sobre la documentación REAL (debe salir
   vacía) y sobre copias estropeadas a propósito (debe señalar el fallo): sin
   lo segundo, una comprobación que no encuentra nada podría ser una que no
   funciona.                                                              */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const acorn = require("acorn");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const MANUAL = read("docs", "manual-usuario-kite-local.md");
const STUDY = read("docs", "estudio-seguridad-kite-local.md");
const RUN_ALL = read("tests", "run-all.js");
const TESTS_README = read("tests", "README.md");
const PKG = JSON.parse(read("package.json"));
const INDEX_HTML = read("src", "index.html");
const IMG_DIR = path.join(ROOT, "docs", "img");
const MANIFEST = "capturas.json";

let failed = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.error("FAIL: " + m); } };
/* La documentación real no tiene problemas; la estropeada, sí */
const clean = (problems, what) => ok(!problems.length, `${what}:\n    ${problems.join("\n    ")}`);
const flags = (problems, re, what) => ok(problems.some(p => re.test(p)), `${what} (problemas: ${JSON.stringify(problems)})`);

/* ---------- Suites registradas ---------- */
/* Las del runner SIN la lista --bench, que son mediciones y no cuentan */
function suiteEntries(runAll) {
  const out = [];
  const re = /^  \["([^"]+)",\s*"((?:[^"\\]|\\.)*)"\]/gm;
  for (let m; (m = re.exec(runAll));) out.push({ file: m[1], desc: m[2].replace(/\\"/g, "\"") });
  return out;
}

/* Frases del estudio que dicen cuántos conjuntos de pruebas hay. Si no
   encuentra ninguna es un problema: una frase reescrita no puede dejar la
   comprobación sin nada que mirar.                                      */
function checkSuiteCounts(text, n) {
  const problems = [];
  let found = 0;
  for (const m of text.matchAll(/(\d+) conjuntos de (?:pruebas|comprobaciones)/g)) {
    found++;
    if (Number(m[1]) !== n) problems.push(`«${m[0]}» y hay ${n} suites en run-all.js`);
  }
  for (const m of text.matchAll(/(\d+) de (\d+) conjuntos/g)) {
    found++;
    if (Number(m[1]) !== n || Number(m[2]) !== n) problems.push(`«${m[0]}» y hay ${n} suites en run-all.js`);
  }
  if (!found) problems.push("no hay ninguna frase «N conjuntos de pruebas»: ¿se reescribió? la comprobación no tiene nada que mirar");
  return problems;
}

/* ---------- Versiones ---------- */
const VERSION_RE = {
  manual: /versi[oó]n v?(\d+\.\d+\.\d+) \(/,
  study: /\*\*Versi[oó]n de la aplicaci[oó]n auditada\*\* \| v?(\d+\.\d+\.\d+) \(/
};
function checkVersion(text, kind, version) {
  const m = VERSION_RE[kind].exec(text);
  if (!m) return [`no se encuentra la versión en la cabecera (${kind})`];
  return m[1] === version ? [] : [`la cabecera dice v${m[1]} y package.json v${version}`];
}

/* ---------- Figuras ---------- */
/* Cada imagen, con su texto alternativo y el pie «*Figura N.» de la línea
   siguiente (con una letra si comparten número: 21a, 21b).              */
function parseFigures(text) {
  const lines = text.split("\n"), figs = [];
  lines.forEach((l, i) => {
    const m = /^!\[([^\]]*)\]\(img\/([^)]+)\)\s*$/.exec(l);
    if (!m) return;
    const next = lines.slice(i + 1).find(x => x.trim()) || "";
    const cap = /^\*Figura (\d+)([a-z]?)\./.exec(next);
    figs.push({ line: i + 1, alt: m[1], file: m[2], n: cap ? Number(cap[1]) : null, letter: cap ? cap[2] : null });
  });
  return figs;
}
function checkFigures(figs, onDisk) {
  const problems = [];
  let last = 0, lastLetter = "";
  const seen = new Set();
  for (const f of figs) {
    const at = `línea ${f.line} (${f.file})`;
    if (!onDisk.has(f.file)) problems.push(`${at}: la imagen no existe en docs/img`);
    if (seen.has(f.file)) problems.push(`${at}: la imagen aparece dos veces`);
    seen.add(f.file);
    if (!f.alt.trim()) problems.push(`${at}: sin texto alternativo`);
    if (f.n === null) { problems.push(`${at}: sin pie «*Figura N.» debajo`); continue; }
    if (f.n === last) {
      if (!f.letter || !lastLetter || f.letter <= lastLetter) problems.push(`${at}: Figura ${f.n}${f.letter} repite número sin letras en orden`);
    } else if (f.n !== last + 1) {
      problems.push(`${at}: Figura ${f.n} después de la ${last}: la numeración debe ser seguida`);
    }
    last = f.n; lastLetter = f.letter || "";
  }
  for (const f of onDisk) if (!seen.has(f) && f !== MANIFEST) problems.push(`docs/img/${f}: ninguna figura la cita`);
  return problems;
}

/* ---------- Anclas y apartados ---------- */
/* Como GitHub: minúsculas, sin signos, espacios a guiones */
const slug = h => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
function checkLinks(text, doc) {
  const problems = [];
  const heads = [...text.matchAll(/^#{1,4} (.+)$/gm)].map(m => m[1]);
  const slugs = new Set(heads.map(slug));
  const numbers = new Set(heads.map(h => (/^(\d+(?:\.\d+)?)[ .]/.exec(h) || [])[1]).filter(Boolean));
  for (const m of text.matchAll(/\]\(#([^)]+)\)/g)) {
    if (!slugs.has(m[1])) problems.push(`${doc}: el enlace #${m[1]} no lleva a ningún título`);
  }
  for (const m of text.matchAll(/\bapartados? (\d+(?:\.\d+)?)/g)) {
    if (!numbers.has(m[1])) problems.push(`${doc}: «apartado ${m[1]}» no existe`);
  }
  return problems;
}

/* ---------- Manifiesto de capturas ---------- */
const sha256 = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function checkManifest(manifest, version, figs, dir) {
  const problems = [];
  if (!manifest) return [`falta docs/img/${MANIFEST}: se genera con npm run capturas`];
  const images = manifest.images || {};
  for (const f of figs) if (!images[f.file]) problems.push(`${f.file} no está en el manifiesto`);
  for (const [name, info] of Object.entries(images)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) { problems.push(`${name}: está en el manifiesto y no en disco`); continue; }
    if (sha256(file) !== info.sha256) problems.push(`${name}: no coincide con el manifiesto (¿tocada a mano? npm run capturas)`);
    /* Una imagen externa no se regenera: no tiene versión que exigir */
    if (!info.externa && info.version !== version) {
      problems.push(`${name}: es de la v${info.version} y package.json dice v${version}: npm run capturas`);
    }
  }
  return problems;
}

/* ---------- tests/README.md ---------- */
function checkTestsReadme(entries, readme) {
  const problems = [];
  for (const e of entries) {
    if (!readme.includes("### `" + e.file + "`")) problems.push(`${e.file}: sin sección en tests/README.md`);
    if (!readme.includes("── " + e.desc)) problems.push(`${e.file}: su línea «── …» de tests/README.md no es la de run-all.js`);
  }
  return problems;
}


/* ---------- Servidores (Anexo A del estudio) ---------- */
/* Los literales de cadena y las plantillas de un JS: lo que de verdad puede
   acabar en una petición. Un comentario con una dirección no cuenta.      */
function stringLiterals(src) {
  const out = [];
  const ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "script" });
  (function walk(n) {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "Literal" && typeof n.value === "string") out.push(n.value);
    if (n.type === "TemplateElement") out.push(n.value.cooked || "");
    for (const k in n) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === "string") walk(v);
    }
  })(ast);
  return out;
}
const HOST_RE = /https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi;
function hostsIn(text, into, file) {
  for (const m of text.matchAll(HOST_RE)) {
    const h = m[1].toLowerCase().replace(/\.$/, "");
    if (!into.has(h)) into.set(h, new Set());
    into.get(h).add(file);
  }
}
/* `files`: [{ name, kind: "js" | "html", text }] → Map host → archivos */
function codeHosts(files) {
  const hosts = new Map();
  for (const f of files) {
    if (f.kind === "js") for (const str of stringLiterals(f.text)) hostsIn(str, hosts, f.name);
    else hostsIn(f.text.replace(/<!--[\s\S]*?-->/g, ""), hosts, f.name);
  }
  return hosts;
}
/* Lo que se entrega: los JS de src/js salvo los iconos y los diccionarios
   (datos, no código), el service worker y la plantilla.                   */
function realSources() {
  const dir = path.join(ROOT, "src", "js");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js") && !/^(05-|04-i18n)/.test(f))
    .map(f => ({ name: f, kind: "js", text: fs.readFileSync(path.join(dir, f), "utf8") }));
  files.push({ name: "sw.js", kind: "js", text: read("src", "sw.js") });
  files.push({ name: "index.html", kind: "html", text: INDEX_HTML });
  return files;
}
function annexOf(study) {
  const i = study.search(/^## Anexo A\b/m);
  if (i < 0) return "";
  const rest = study.slice(i + 3);
  const j = rest.search(/^## /m);
  return j < 0 ? study.slice(i) : study.slice(i, i + 3 + j);
}
/* Los servidores que cita el anexo: la primera columna de sus tablas */
function annexHosts(study) {
  return new Set([...annexOf(study).matchAll(/^\| `([^`]+)` \|/gm)].map(m => m[1].toLowerCase()));
}
function checkServers(code, annex) {
  const problems = [];
  if (!annex.size) return ["el Anexo A del estudio no tiene ninguna fila de servidor"];
  for (const [h, files] of [...code].sort()) {
    if (!annex.has(h)) problems.push(`${h} (en ${[...files].join(", ")}): el código lo usa y no está en el Anexo A`);
  }
  for (const h of [...annex].sort()) {
    if (!code.has(h)) problems.push(`${h}: está en el Anexo A y el código ya no lo usa`);
  }
  return problems;
}
/* La política de contenido: directivas → fuentes */
function cspOf(html) {
  const m = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html);
  if (!m) return null;
  const out = {};
  for (const d of m[1].split(";")) {
    const t = d.trim().split(/\s+/).filter(Boolean);
    if (t.length) out[t[0]] = t.slice(1);
  }
  return out;
}
/* Cualquier origen cifrado, solo donde el estudio lo dice (6.2 y Anexo A) */
const OPEN_HTTPS = ["connect-src", "img-src"];
function checkCsp(csp, annex, annexText) {
  if (!csp) return ["no se encuentra la política de contenido en index.html"];
  const problems = [];
  const open = Object.keys(csp).filter(d => csp[d].includes("https:")).sort();
  if (open.join() !== OPEN_HTTPS.join()) {
    problems.push(`directivas con https: abierto: ${open.join(", ") || "ninguna"}; el estudio documenta ${OPEN_HTTPS.join(" y ")}`);
  }
  for (const [d, tokens] of Object.entries(csp)) {
    for (const t of tokens) {
      if (t === "*" || t === "http:") problems.push(`${d}: «${t}» no está permitido`);
      const m = /^https?:\/\/([^/\s]+)/i.exec(t);
      if (m && !annex.has(m[1].toLowerCase())) problems.push(`${d}: ${m[1]} no está en el Anexo A`);
    }
  }
  for (const d of OPEN_HTTPS) if (!annexText.includes("`" + d + "`")) problems.push(`el Anexo A no nombra la directiva \`${d}\``);
  return problems;
}

/* ---------- Atajos: la chuleta de la aplicación y el apartado 8 del manual ---------- */
const decodeEntities = t => t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const tidy = t => t.replace(/\s+/g, " ").trim();
/* [{ h }, { k, d }, …] en el orden de las pestañas */
function parseChuleta(html) {
  const i = html.indexOf('<div id="shortcuts"');
  const j = html.indexOf("<!--", i);
  const seq = [];
  for (const m of html.slice(i, j < 0 ? undefined : j).matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const th = /<th[^>]*>([\s\S]*?)<\/th>/.exec(m[1]);
    if (th) { seq.push({ h: tidy(decodeEntities(th[1])) }); continue; }
    const td = [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(x => tidy(decodeEntities(x[1])));
    if (td.length === 2) seq.push({ k: td[0], d: td[1] });
  }
  return seq;
}
function parseManualKeys(md) {
  const i = md.indexOf("## 8. Atajos de teclado");
  const rest = md.slice(i);
  const j = rest.slice(3).search(/^## /m);
  const sec = j < 0 ? rest : rest.slice(0, j + 3);
  const seq = [];
  for (const l of sec.split("\n")) {
    const h = /^\*\*(.+?)\*\*( \([^)]*\))?\s*$/.exec(l);
    if (h) { seq.push({ h: tidy(h[1].replace(/`/g, "")) }); continue; }
    const r = /^\| (.+?) \| (.+) \|$/.exec(l);
    if (r && !/^(Tecla|Gesto|-+)$/.test(r[1])) seq.push({ k: tidy(r[1].replace(/`/g, "")), d: tidy(r[2].replace(/`/g, "")) });
  }
  return seq;
}
const rowText = r => (r.h !== undefined ? `[${r.h}]` : `${r.k} → ${r.d}`);
function checkShortcuts(chuleta, manual) {
  const problems = [];
  if (!chuleta.length) return ["no se ha leído ninguna fila de la chuleta (#shortcuts)"];
  if (!manual.length) return ["no se ha leído ninguna fila del apartado 8 del manual"];
  const a = new Set(chuleta.map(rowText)), b = new Set(manual.map(rowText));
  for (const r of chuleta) if (!b.has(rowText(r))) problems.push(`la chuleta dice «${rowText(r)}» y el manual no`);
  for (const r of manual) if (!a.has(rowText(r))) problems.push(`el manual dice «${rowText(r)}» y la chuleta no`);
  if (!problems.length && chuleta.map(rowText).join("\n") !== manual.map(rowText).join("\n")) {
    problems.push("las mismas filas, pero en distinto orden que en la chuleta");
  }
  return problems;
}

/* ---------- Menú contextual (apartado 5) ---------- */
/* Las etiquetas `label: tr("…")` del menú: CTX_MENU_ITEMS, las entradas de una
   capa, las de varias capas y la del perfil, con sus submenús.            */
const MENU_SOURCES = { "70-view-controls.js": ["CTX_MENU_ITEMS", "layerCtxItems", "ctxItemsFor"], "63-route-profile.js": ["routeProfileCtxItem"] };
function ctxLabelsOf(src, names) {
  const labels = new Set();
  const ast = acorn.parse(src, { ecmaVersion: "latest", sourceType: "script" });
  const trIn = n => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "CallExpression" && n.callee.name === "tr" && n.arguments[0] && n.arguments[0].type === "Literal") labels.add(n.arguments[0].value);
    for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(trIn); else if (v && typeof v.type === "string") trIn(v); }
  };
  (function walk(n, inside) {
    if (!n || typeof n.type !== "string") return;
    const here = (n.type === "FunctionDeclaration" && n.id && names.includes(n.id.name))
      || (n.type === "VariableDeclarator" && n.id && names.includes(n.id.name));
    const on = inside || here;
    if (on && n.type === "Property" && n.key && (n.key.name === "label" || n.key.value === "label")) trIn(n.value);
    for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(x => walk(x, on)); else if (v && typeof v.type === "string") walk(v, on); }
  })(ast, false);
  return labels;
}
function ctxLabels() {
  const all = new Set();
  for (const [f, names] of Object.entries(MENU_SOURCES)) {
    for (const l of ctxLabelsOf(read("src", "js", f), names)) all.add(l);
  }
  return all;
}
const manualSection = (md, from, to) => {
  const i = md.indexOf(from);
  const j = md.indexOf(to, i + 1);
  return i < 0 ? "" : md.slice(i, j < 0 ? undefined : j);
};
function checkMenu(labels, section) {
  const problems = [];
  if (!labels.size) return ["no se ha leído ninguna etiqueta del menú contextual"];
  if (!section) return ["no se encuentra el apartado 5 del manual"];
  for (const l of [...labels].sort()) if (!section.includes(`«${l}»`)) problems.push(`«${l}» está en el menú contextual y el apartado 5 del manual no la cita`);
  return problems;
}

/* ---------- Diálogos de la aplicación ---------- */
/* Cada ventana (`dlg-overlay`/`dlg-float`) de index.html: la frase con que el
   manual la describe, o por qué no hace falta. Una ventana nueva sin entrada
   obliga a decidirlo.                                                     */
const DIALOG_DOC = {
  "style-dialog": "Editar propiedades", "props-dialog": "Índices de GeoJSON", "shortcuts": "Atajos de teclado",
  "desc-dialog": "Mostrar atributos", "icon-picker": "Cambiar…", "mobile-notice": "Mejor desde un ordenador",
  "kml-tags-picker": "Etiquetas en los nombres", "kml-dup-picker": "Marcadores duplicados",
  "geojson-name-picker": "Elegir nombre", "geocalc-dialog": "Cálculos geodésicos", "profile-dialog": "Obtener perfil",
  "points-dialog": "Ver y editar…", "log-dialog": "Registro de avisos", "url-dialog": "Añadir desde una dirección",
  "sh-creds": "credencial", "custom-tiles-creds": "Custom Tile Map Service", "custom-wms-creds": "Custom Web Map Service"
};
const dialogIds = html => [...html.matchAll(/<div id="([a-z0-9-]+)" class="(?:dlg-overlay|dlg-float)"/g)].map(m => m[1]);
function checkDialogs(ids, map, manual) {
  const problems = [];
  if (!ids.length) return ["no se ha leído ninguna ventana de index.html"];
  const low = manual.toLowerCase();
  for (const id of ids) {
    const e = map[id];
    if (e === undefined) { problems.push(`${id}: ventana nueva sin decidir (frase del manual o exención) en DIALOG_DOC`); continue; }
    if (typeof e === "object") { if (!e.exento || !e.exento.trim()) problems.push(`${id}: una exención necesita su motivo`); continue; }
    if (!low.includes(e.toLowerCase())) problems.push(`${id}: el manual ya no dice «${e}»`);
  }
  for (const id of Object.keys(map)) if (!ids.includes(id)) problems.push(`${id}: está en DIALOG_DOC y ya no hay esa ventana`);
  return problems;
}

/* ========================= La documentación real ========================= */
const entries = suiteEntries(RUN_ALL);
const onDisk = new Set(fs.readdirSync(IMG_DIR));
const figs = parseFigures(MANUAL);
const manifest = fs.existsSync(path.join(IMG_DIR, MANIFEST)) ? JSON.parse(fs.readFileSync(path.join(IMG_DIR, MANIFEST), "utf8")) : null;

ok(entries.length > 50 && entries.some(e => e.file === "docs.js"), `run-all.js: ${entries.length} entradas y esta suite entre ellas`);
clean(checkSuiteCounts(STUDY, entries.length), "recuentos de suites del estudio");
clean(checkVersion(MANUAL, "manual", PKG.version), "versión del manual");
clean(checkVersion(STUDY, "study", PKG.version), "versión del estudio");
clean(checkFigures(figs, onDisk), "figuras del manual");
clean(checkLinks(MANUAL, "manual").concat(checkLinks(STUDY, "estudio")), "anclas y apartados");
clean(checkManifest(manifest, PKG.version, figs, IMG_DIR), "manifiesto de capturas");
clean(checkTestsReadme(entries, TESTS_README), "tests/README.md frente a run-all.js");
ok(figs.length > 20, `el manual tiene ${figs.length} figuras`);

/* Fase 2: servidores */
const sources = realSources();
const code = codeHosts(sources);
const annex = annexHosts(STUDY);
ok(code.size > 15, `el código nombra ${code.size} servidores`);
clean(checkServers(code, annex), "servidores del código frente al Anexo A del estudio");
clean(checkCsp(cspOf(INDEX_HTML), annex, annexOf(STUDY)), "política de contenido frente al Anexo A");

/* Fase 3: atajos, menú y ventanas */
const chuleta = parseChuleta(INDEX_HTML);
clean(checkShortcuts(chuleta, parseManualKeys(MANUAL)), "atajos: la chuleta de la aplicación frente al apartado 8 del manual");
ok(chuleta.length > 40, `la chuleta tiene ${chuleta.length} filas`);
const labels = ctxLabels();
ok(labels.size >= 17, `el menú contextual tiene ${labels.size} etiquetas`);
clean(checkMenu(labels, manualSection(MANUAL, "## 5. ", "## 6. ")), "menú contextual frente al apartado 5 del manual");
const dialogs = dialogIds(INDEX_HTML);
ok(dialogs.length >= 17, `index.html tiene ${dialogs.length} ventanas`);
clean(checkDialogs(dialogs, DIALOG_DOC, MANUAL), "ventanas de la aplicación frente al manual");

/* ================= La misma comprobación, sobre lo estropeado ================= */
{
  const n = entries.length;
  flags(checkSuiteCounts(STUDY.replace(`${n} de ${n} conjuntos`, "61 de 61 conjuntos"), n), /61 de 61/, "un «61 de 61» viejo se señala");
  flags(checkSuiteCounts(STUDY.replace(new RegExp(`${n} conjuntos de pruebas`, "g"), "60 conjuntos de pruebas"), n), /60 conjuntos/, "un «60 conjuntos» viejo se señala");
  flags(checkSuiteCounts("sin ninguna frase de recuento", n), /ninguna frase/, "sin frases de recuento también falla");
  flags(checkVersion(MANUAL.replace(`versión v${PKG.version} (`, "versión v0.0.1 ("), "manual", PKG.version), /v0\.0\.1/, "versión vieja en el manual");
  flags(checkVersion(STUDY.replace(`| v${PKG.version} (`, "| v0.0.1 ("), "study", PKG.version), /v0\.0\.1/, "versión vieja en el estudio");
  flags(checkVersion("sin cabecera", "manual", PKG.version), /no se encuentra/, "sin versión en la cabecera");

  const base = [{ line: 1, alt: "a", file: "a.png", n: 1, letter: "" }, { line: 5, alt: "b", file: "b.png", n: 2, letter: "" }];
  clean(checkFigures(base, new Set(["a.png", "b.png"])), "figuras de juguete");
  flags(checkFigures(base, new Set(["a.png"])), /no existe/, "imagen citada que no existe");
  flags(checkFigures(base, new Set(["a.png", "b.png", "c.png"])), /ninguna figura la cita/, "imagen huérfana");
  flags(checkFigures([{ ...base[0], alt: " " }], new Set(["a.png"])), /sin texto alternativo/, "sin texto alternativo");
  flags(checkFigures([{ ...base[0], n: null }], new Set(["a.png"])), /sin pie/, "sin pie de figura");
  flags(checkFigures([base[0], { ...base[1], n: 4 }], new Set(["a.png", "b.png"])), /numeración/, "figura que salta de número");
  flags(checkFigures([base[1], base[0]], new Set(["a.png", "b.png"])), /numeración/, "figuras fuera de orden");
  flags(checkFigures([base[0], { ...base[1], n: 1 }], new Set(["a.png", "b.png"])), /repite número/, "número repetido sin letra");
  flags(checkFigures([base[0], base[0]], new Set(["a.png"])), /dos veces/, "la misma imagen dos veces");
  clean(checkFigures([{ ...base[0], letter: "a" }, { ...base[1], n: 1, letter: "b" }], new Set(["a.png", "b.png"])), "21a y 21b son válidas");
  const parsed = parseFigures("![texto](img/x.png)\n*Figura 3b. pie*\n\n![](img/y.png)\nsin pie");
  ok(parsed.length === 2 && parsed[0].n === 3 && parsed[0].letter === "b" && parsed[1].n === null && parsed[1].alt === "", "parseFigures lee número, letra y alt");

  flags(checkLinks("# T\n## 1. Uno\nver [x](#2-dos) y el apartado 1\n", "d"), /#2-dos/, "ancla que no existe");
  flags(checkLinks("## 1. Uno\nver el apartado 9.9\n", "d"), /apartado 9\.9/, "apartado que no existe");
  clean(checkLinks("## 1. Uno\n### 1.2 Sub\n[i](#1-uno) apartados 1 y 1.2\n", "d"), "enlaces válidos de juguete");
  ok(slug("2. El panel de navegación") === "2-el-panel-de-navegación", "slug como GitHub, con tildes");

  flags(checkManifest(null, PKG.version, figs, IMG_DIR), /falta docs\/img/, "sin manifiesto");
  if (manifest) {
    const first = Object.keys(manifest.images).find(n => !manifest.images[n].externa);
    const old = { ...manifest, images: { ...manifest.images, [first]: { ...manifest.images[first], version: "0.0.1" } } };
    flags(checkManifest(old, PKG.version, figs, IMG_DIR), /es de la v0\.0\.1/, "una captura de otra versión");
    const lied = { ...manifest, images: { ...manifest.images, [first]: { ...manifest.images[first], sha256: "0".repeat(64) } } };
    flags(checkManifest(lied, PKG.version, figs, IMG_DIR), /no coincide/, "captura tocada a mano");
    const noEntry = { ...manifest, images: Object.fromEntries(Object.entries(manifest.images).slice(1)) };
    flags(checkManifest(noEntry, PKG.version, figs, IMG_DIR), /no está en el manifiesto/, "figura sin entrada en el manifiesto");
    const ghost = { ...manifest, images: { ...manifest.images, "fantasma.png": { sha256: "0".repeat(64) } } };
    flags(checkManifest(ghost, PKG.version, figs, IMG_DIR), /no en disco/, "entrada de manifiesto sin imagen");
  }

  /* ---- Servidores ---- */
  const files = [
    { name: "a.js", kind: "js", text: '// https://comentario.example.com/no-cuenta\nconst u = "https://real.example.org/x"; const t = `https://plantilla.example.net/${1}`;' },
    { name: "i.html", kind: "html", text: '<!-- https://html-comentado.example.com -->\n<a href="https://enlace.example.io/">x</a>' }
  ];
  const found = codeHosts(files);
  ok([...found.keys()].sort().join() === "enlace.example.io,plantilla.example.net,real.example.org",
    "codeHosts: literales, plantillas y HTML, sin los comentarios: " + [...found.keys()]);
  const annexOk = new Set(["enlace.example.io", "plantilla.example.net", "real.example.org"]);
  clean(checkServers(found, annexOk), "servidores de juguete");
  flags(checkServers(found, new Set(["enlace.example.io", "real.example.org"])), /plantilla\.example\.net.*no está en el Anexo A/, "un servidor del código que falta en el anexo");
  flags(checkServers(found, new Set([...annexOk, "viejo.example.com"])), /viejo\.example\.com.*ya no lo usa/, "un servidor del anexo que el código ya no usa");
  flags(checkServers(found, new Set()), /ninguna fila/, "anexo vacío");
  const breakRow = STUDY.replace("| `wcs-mds.idee.es` |", "| `wcs-mds.idee.example` |");
  const brokenProblems = checkServers(code, annexHosts(breakRow));
  ok(brokenProblems.length === 2, "en el estudio real, cambiar un servidor da dos problemas (falta y sobra): " + JSON.stringify(brokenProblems));
  const added = new Map(code); added.set("nuevo.example.org", new Set(["x.js"]));
  flags(checkServers(added, annex), /nuevo\.example\.org.*x\.js/, "un servidor nuevo en un literal se señala con su archivo");
  ok(annexHosts("sin anexo").size === 0, "sin Anexo A no hay servidores");

  const cspHtml = d => `<meta http-equiv="Content-Security-Policy" content="${d}">`;
  const csp0 = cspOf(cspHtml("default-src 'none'; img-src 'self' https:; connect-src 'self' https:; script-src 'self' https://real.example.org"));
  clean(checkCsp(csp0, new Set(["real.example.org"]), "`img-src` y `connect-src`"), "CSP de juguete");
  flags(checkCsp(cspOf(cspHtml("script-src 'self' https:; img-src https:; connect-src https:")), new Set(), "`img-src` `connect-src`"), /directivas con https: abierto/, "https: abierto en script-src");
  flags(checkCsp(cspOf(cspHtml("img-src https:")), new Set(), "`img-src` `connect-src`"), /directivas con https: abierto/, "falta una de las dos directivas abiertas");
  flags(checkCsp(cspOf(cspHtml("img-src https:; connect-src https:; script-src https://otro.example.com")), new Set(), "`img-src` `connect-src`"), /otro\.example\.com no está en el Anexo A/, "host de la CSP que no está en el anexo");
  flags(checkCsp(cspOf(cspHtml("img-src https: http:; connect-src https: *")), new Set(), "`img-src` `connect-src`"), /no está permitido/, "http: y * en la CSP");
  flags(checkCsp(csp0, new Set(["real.example.org"]), "sin nombrar directivas"), /no nombra la directiva/, "el anexo debe nombrar las dos directivas");
  flags(checkCsp(null, new Set(), ""), /no se encuentra la política/, "sin política de contenido");

  /* ---- Atajos ---- */
  const ch = [{ h: "A" }, { k: "F2", d: "Renombrar" }, { k: "Supr", d: "Borrar" }];
  clean(checkShortcuts(ch, ch), "atajos de juguete");
  flags(checkShortcuts(ch, [ch[0], { k: "F2", d: "Renombrar (otra redacción)" }, ch[2]]), /la chuleta dice «F2 → Renombrar»/, "una descripción distinta");
  flags(checkShortcuts(ch, [ch[0], ch[2]]), /la chuleta dice «F2/, "una fila que falta en el manual");
  flags(checkShortcuts(ch, [...ch, { k: "Esc", d: "Salir" }]), /el manual dice «Esc/, "una fila que sobra en el manual");
  flags(checkShortcuts(ch, [{ h: "B" }, ch[1], ch[2]]), /\[A\]/, "una cabecera distinta");
  flags(checkShortcuts(ch, [ch[0], ch[2], ch[1]]), /distinto orden/, "las mismas filas en otro orden");
  flags(checkShortcuts([], ch), /ninguna fila de la chuleta/, "chuleta vacía");
  const htmlRows = '<div id="shortcuts"><table><tr><th colspan="2">Moverse &#225;rbol</th></tr><tr><td>&#8593; &#8595;</td><td>Nodo &amp; otro</td></tr></table></div><!-- fin -->';
  ok(JSON.stringify(parseChuleta(htmlRows)) === JSON.stringify([{ h: "Moverse árbol" }, { k: "↑ ↓", d: "Nodo & otro" }]), "parseChuleta decodifica entidades");
  const mdRows = "## 8. Atajos de teclado\n\n**Moverse árbol** (apartado 7.9)\n\n| Tecla | Acción |\n|---|---|\n| ↑ ↓ | Nodo `& otro` |\n\n## 9. Siguiente\n| X | Y |";
  ok(JSON.stringify(parseManualKeys(mdRows)) === JSON.stringify([{ h: "Moverse árbol" }, { k: "↑ ↓", d: "Nodo & otro" }]), "parseManualKeys quita el sufijo de la cabecera y las comillas, y acaba en el apartado 9");
  /* En el manual real: cambiar la redacción de una fila */
  const tampered = MANUAL.replace("| F2 | Renombrar (también en las propiedades) |", "| F2 | Renombrar |");
  flags(checkShortcuts(chuleta, parseManualKeys(tampered)), /F2/, "en el manual real, una fila retocada");

  /* ---- Menú ---- */
  const ctxSrc = 'const CTX_MENU_ITEMS = [{ label: tr("Uno"), x: 1 }, { label: tr("Medir"), items: [{ label: tr("Ruta") }] }];\n'
    + 'function layerCtxItems(li) { return [{ label: li.has ? tr("Mostrar") : tr("Obtener") }, { label: li._name }]; }\n'
    + 'function otra() { return { label: tr("No cuenta") }; }';
  ok([...ctxLabelsOf(ctxSrc, ["CTX_MENU_ITEMS", "layerCtxItems"])].sort().join() === "Medir,Mostrar,Obtener,Ruta,Uno",
    "ctxLabelsOf: submenús y condicionales, sin lo ajeno al menú: " + [...ctxLabelsOf(ctxSrc, ["CTX_MENU_ITEMS", "layerCtxItems"])]);
  clean(checkMenu(new Set(["Uno", "Medir"]), "«Uno» y «Medir»"), "menú de juguete");
  flags(checkMenu(new Set(["Uno", "Medir"]), "«Uno» y Medir sin comillas"), /«Medir»/, "una etiqueta sin sus comillas angulares no cuenta");
  flags(checkMenu(new Set(["Uno"]), ""), /no se encuentra el apartado 5/, "sin apartado 5");
  flags(checkMenu(new Set(), "x"), /ninguna etiqueta/, "sin etiquetas");
  flags(checkMenu(labels, manualSection(MANUAL, "## 6. ", "## 7. ")), /está en el menú contextual/, "las etiquetas buscadas fuera del apartado 5 no valen");
  ok(manualSection("a ## 5. x ## 6. y", "## 5. ", "## 6. ") === "## 5. x ", "manualSection corta en el siguiente apartado");

  /* ---- Ventanas ---- */
  const html2 = '<div id="a-dialog" class="dlg-overlay" hidden></div><div id="b" class="dlg-float"></div><div id="c" class="otra"></div>';
  ok(dialogIds(html2).join() === "a-dialog,b", "dialogIds lee las ventanas y no otros div");
  clean(checkDialogs(["a-dialog", "b"], { "a-dialog": "Texto A", b: { exento: "motivo" } }, "dice texto a aquí"), "ventanas de juguete");
  flags(checkDialogs(["a-dialog", "b"], { "a-dialog": "Texto A" }, "texto a"), /b: ventana nueva sin decidir/, "una ventana nueva sin decidir");
  flags(checkDialogs(["a-dialog"], { "a-dialog": "Texto A" }, "nada"), /ya no dice «Texto A»/, "una frase que ya no está en el manual");
  flags(checkDialogs(["a-dialog"], { "a-dialog": "x", viejo: "y" }, "x"), /viejo: está en DIALOG_DOC/, "una entrada de una ventana que ya no existe");
  flags(checkDialogs(["a-dialog"], { "a-dialog": { exento: " " } }, ""), /necesita su motivo/, "una exención sin motivo");
  flags(checkDialogs([], DIALOG_DOC, MANUAL), /ninguna ventana/, "sin ventanas");

  const one = [{ file: "x.js", desc: "Una suite" }];
  clean(checkTestsReadme(one, "### `x.js`\n── Una suite\n"), "README de juguete");
  flags(checkTestsReadme(one, "── Una suite\n"), /sin sección/, "suite sin sección en tests/README.md");
  flags(checkTestsReadme(one, "### `x.js`\n── Otra\n"), /línea «── …»/, "línea del README distinta de la de run-all.js");
}

if (failed) { console.error(`\n${failed} comprobación(es) fallidas, ${passed} correctas`); process.exit(1); }
console.log("DOCS TESTS OK");
