/* The «Novedades» window (68-whats-new.js): its texts and the pure logic
   that decides whether to show it and what to list. The texts are data a
   release depends on, so they are checked here: versions well formed,
   unique and newest first, "next" only at the top, an entry for the
   version in package.json (a release without its notes fails), none above
   it, and short sentences. Then which entries are listed (released ones
   after the version last run and up to the current one, never "next"),
   the decision taken from what was saved (first time, same version, newer
   version, ticked box, downgrade), the reading of a saved record (foreign
   input) and the version comparison. The window itself is tested in
   tests/browser/whats-new.mjs.                                          */
const { fn, constDecl, between } = require("./_extract");
const pkg = require("../package.json");
/* `constDecl("WHATS_NEW")` would hit WHATS_NEW_KEY (32-geojson.js) first */
const src = between("const WHATS_NEW = [", "/* The first time ever") + ["WHATS_NEW_FIRST", "VERSION_RE"].map(constDecl).join("\n") + "\n"
  + ["compareVersions", "whatsNewEntries", "validWhatsNewRecord", "whatsNewPlan"].map(fn).join("\n");
const api = new Function(src + "\nreturn { WHATS_NEW, WHATS_NEW_FIRST, compareVersions, whatsNewEntries, validWhatsNewRecord, whatsNewPlan };")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const { WHATS_NEW, compareVersions: cmp, whatsNewEntries: entries, whatsNewPlan: plan, validWhatsNewRecord: valid } = api;
const SEMVER = /^\d+\.\d+\.\d+$/;

/* ---------- The texts ---------- */
const versions = WHATS_NEW.map(e => e.version);
ok(versions.every(v => v === "next" || SEMVER.test(v)), "cada entrada es una versión x.y.z o «next»: " + versions);
ok(new Set(versions).size === versions.length, "sin versiones repetidas");
ok(!versions.includes("next") || versions.indexOf("next") === 0, "«next» solo arriba del todo");
const released = versions.filter(v => v !== "next");
ok(released.every((v, i) => i === 0 || cmp(released[i - 1], v) > 0), "de la más nueva a la más vieja: " + released);
ok(released.includes(pkg.version),
  `la versión de package.json (${pkg.version}) tiene sus novedades: al preparar un release, «next» pasa a llamarse así`);
ok(released.every(v => cmp(v, pkg.version) <= 0), "ninguna entrada por encima de package.json (lo que aún no ha salido va en «next»)");
for (const e of WHATS_NEW) {
  ok(Array.isArray(e.items) && e.items.length > 0, `${e.version}: al menos una novedad`);
  for (const item of e.items) {
    ok(typeof item === "string" && item.trim() === item && item.length > 0, `${e.version}: texto sin espacios de más: ${JSON.stringify(item)}`);
    ok(item.length <= 220, `${e.version}: un resumen breve (≤ 220 caracteres): ${item.slice(0, 60)}…`);
    ok(/[.!]$/.test(item), `${e.version}: una frase terminada en punto: ${item.slice(-30)}`);
  }
}

/* ---------- Which entries are listed ---------- */
const list = [{ version: "next", items: ["n."] }, { version: "2.5.0", items: ["e."] }, { version: "2.4.0", items: ["d."] },
  { version: "2.10.0", items: ["x."] }, { version: "2.0.1", items: ["a."] }, { version: "2.0.0", items: ["z."] }];
ok(entries(list, "2.0.0", "2.5.0").map(e => e.version).join() === "2.5.0,2.4.0,2.0.1",
  "las publicadas después de la última vista y hasta la actual, de la más nueva a la más vieja");
ok(entries(list, "2.4.0", "2.5.0").map(e => e.version).join() === "2.5.0", "tras saltar de la 2.4 a la 2.5, solo la 2.5");
ok(entries(list, "2.5.0", "2.5.0").length === 0, "la misma versión no lista nada");
ok(!entries(list, "0.0.0", "99.0.0").some(e => e.version === "next"), "«next» no sale nunca");
ok(entries(list, "2.5.0", "2.10.0").map(e => e.version).join() === "2.10.0", "2.10 va después de la 2.9, no antes (números, no texto)");

/* ---------- The decision taken from what was saved ---------- */
let p = plan(null, "2.5.0");
ok(p && p.since === api.WHATS_NEW_FIRST && p.fresh && p.record.shownFor === "2.5.0" && p.record.dismissed === false,
  "la primera vez: desde la 2.0 y con un registro nuevo que guardar: " + JSON.stringify(p));
p = plan({ shownFor: "2.5.0", since: "2.0.0", dismissed: false }, "2.5.0");
ok(p && p.since === "2.0.0" && !p.fresh, "misma versión sin marcar: vuelve a salir, con la misma lista");
ok(plan({ shownFor: "2.5.0", since: "2.0.0", dismissed: true }, "2.5.0") === null, "misma versión con la casilla marcada: no sale");
p = plan({ shownFor: "2.4.0", since: "2.0.0", dismissed: true }, "2.5.0");
ok(p && p.since === "2.4.0" && p.fresh && p.record.dismissed === false,
  "una versión nueva vuelve a mostrarla, desde la última que se abrió, aunque se hubiera marcado la casilla: " + JSON.stringify(p));
ok(plan({ shownFor: "2.6.0", since: "2.5.0", dismissed: true }, "2.5.0").since === api.WHATS_NEW_FIRST,
  "volver a una versión anterior lista desde la 2.0");
ok(plan(null, "{{VERSION}}") === null && plan(null, "") === null, "sin una versión de verdad no se enseña nada");

/* ---------- A saved record is foreign input ---------- */
ok(JSON.stringify(valid({ shownFor: "2.5.0", since: "2.0.0", dismissed: true, extra: "x" }))
  === '{"shownFor":"2.5.0","since":"2.0.0","dismissed":true}', "un registro bueno, sin lo que sobra");
for (const [what, r] of Object.entries({ "null": null, "texto": "2.5.0", "versión rota": { shownFor: "2.5", since: "2.0.0", dismissed: true },
  "since raro": { shownFor: "2.5.0", since: "<b>", dismissed: false }, "dismissed como texto": { shownFor: "2.5.0", since: "2.0.0", dismissed: "true" } })) {
  ok(valid(r) === null, `se descarta: ${what}`);
}

/* ---------- Comparing versions ---------- */
ok(cmp("2.10.0", "2.9.9") > 0 && cmp("2.0.1", "2.0.0") > 0 && cmp("3.0.0", "2.99.99") > 0 && cmp("2.5.0", "2.5.0") === 0,
  "por números, parte a parte");

if (!process.exitCode) console.log("WHATS NEW TESTS OK");
