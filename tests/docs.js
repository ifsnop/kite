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

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const MANUAL = read("docs", "manual-usuario-kite-local.md");
const STUDY = read("docs", "estudio-seguridad-kite-local.md");
const RUN_ALL = read("tests", "run-all.js");
const TESTS_README = read("tests", "README.md");
const PKG = JSON.parse(read("package.json"));
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

  const one = [{ file: "x.js", desc: "Una suite" }];
  clean(checkTestsReadme(one, "### `x.js`\n── Una suite\n"), "README de juguete");
  flags(checkTestsReadme(one, "── Una suite\n"), /sin sección/, "suite sin sección en tests/README.md");
  flags(checkTestsReadme(one, "### `x.js`\n── Otra\n"), /línea «── …»/, "línea del README distinta de la de run-all.js");
}

if (failed) { console.error(`\n${failed} comprobación(es) fallidas, ${passed} correctas`); process.exit(1); }
console.log("DOCS TESTS OK");
