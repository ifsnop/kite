/* Saving and loading the configuration of the base layers (11-base-panel.js),
   the pure part.

   - The file: what `basesExportDoc` writes (order, state, opacity, chosen WMS
     layer, the user's own servers, background) and what it never writes (the
     Copernicus credential lives elsewhere and is not an argument).
   - `parseBasesExport` recognises only its envelope.
   - `planBasesImport` (foreign input): a server already in this browser is
     reused (same type and address), a new one is added with its id or a fresh
     one if the id is taken, the cap counts, a server new to this browser
     arrives switched off, ids are translated, unknown ids and hostile values
     are dropped, the background must be #rrggbb.
   The panel, the 💾 and the drop are tested in tests/browser/bases-export.mjs. */
const { fn, constDecl, between } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const src = between("const USER_BASES_MAX", "/* A user server may nest") + "\n"
  + between("const CUSTOM_WMS_RESERVED", "/* Same rule as userBaseUrlProblem") + "\n"
  + between("const BASES_EXPORT_KIND", "/* 💾: the whole configuration") + "\n"
  + fn("normalizeCustomWmsBase"); /* the rest of the address checks are inside the first range */
let api;
try {
  api = new Function(src + "\nreturn { basesExportDoc, parseBasesExport, planBasesImport, BASES_EXPORT_KIND, USER_BASES_MAX };")();
} catch (e) { console.error("FAIL: no se pudo extraer el código: " + e.message); process.exit(1); }
const { basesExportDoc, parseBasesExport, planBasesImport, USER_BASES_MAX } = api;

/* ---------- 1. The file ---------- */
const users = [
  { id: "u0123456789ab", type: "tiles", name: "Mi caché", url: "https://cache.ejemplo.org/{z}/{x}/{y}.png" },
  { id: "u0123456789ac", type: "wms", name: "WMS propio", url: "https://wms.ejemplo.org/servicio" }
];
const entries = [["osm", { on: true, opacity: 1 }], ["pnoa", { on: false, opacity: 0.5 }],
  ["u0123456789ac", { on: true, opacity: 0.8, wmsLayer: "capa1" }], ["u0123456789ab", { on: false, opacity: 1 }]];
const doc = basesExportDoc(entries, users, "#112233", "KITE Local 202611170000", "2026-11-17T00:00:00Z");
ok(doc.app === "kite-local/bases" && doc.format === 1, "envoltorio propio y versión del formato");
ok(doc.order.join() === "osm,pnoa,u0123456789ac,u0123456789ab", "el orden de apilado, de abajo arriba");
ok(doc.bases.pnoa.on === false && doc.bases.pnoa.opacity === 0.5 && doc.bases.u0123456789ac.wmsLayer === "capa1",
  "activación, opacidad y capa WMS elegida: " + JSON.stringify(doc.bases));
ok(doc.userBases.length === 2 && doc.userBases[0].url === users[0].url && doc.background === "#112233", "capas propias y color de fondo");
ok(!/instance|shCreds|credencial/i.test(JSON.stringify(doc)), "sin rastro de la credencial de Copernicus");
ok(parseBasesExport(JSON.stringify(doc)).order.length === 4, "parseBasesExport reconoce su archivo");
ok(parseBasesExport('{"app":"kite-local/tree","nodes":[]}') === null && parseBasesExport("no es json") === null,
  "y nada más (ni un .kite.json de carpeta ni texto)");

/* ---------- 2. Loading it ---------- */
let n = 0;
const newId = () => "ufresh" + String(++n).padStart(7, "0");
const ctx = (over = {}) => ({ fixedIds: ["osm", "pnoa"], users: [], max: USER_BASES_MAX, newId, ...over });

/* nothing of it in this browser: both servers are added, switched off */
let plan = planBasesImport(doc, ctx());
ok(plan.add.length === 2 && plan.add[0].id === "u0123456789ab", "dos capas propias nuevas, con su id");
ok(plan.order.join() === doc.order.join(), "el orden del archivo");
ok(plan.bases.u0123456789ac.on === false && plan.switchedOff.join() === "WMS propio",
  "un servidor que no se había usado en este navegador llega APAGADO y se nombra: " + JSON.stringify(plan.switchedOff));
ok(plan.bases.osm.on === true, "una capa fija conserva la activación del archivo");
ok(plan.background === "#112233", "el color de fondo");

/* already here (same type and address, another id): reused, not duplicated, keeps its state */
const here = [{ id: "uaaaaaaaaaaaa", type: "wms", name: "El mismo, con otro nombre", url: "https://wms.ejemplo.org/servicio" }];
plan = planBasesImport(doc, ctx({ users: here }));
ok(plan.add.length === 1 && plan.reused.length === 1 && plan.idMap.get("u0123456789ac") === "uaaaaaaaaaaaa",
  "el que ya existía se reutiliza, traduciendo su id: " + JSON.stringify([...plan.idMap]));
ok(plan.order.includes("uaaaaaaaaaaaa") && plan.bases.uaaaaaaaaaaaa.on === true && !plan.switchedOff.length,
  "y como ya se usaba aquí, conserva la activación del archivo");

/* an id taken by another server: a fresh id */
const clash = [{ id: "u0123456789ab", type: "tiles", name: "Otro", url: "https://otro.ejemplo.org/{z}/{x}/{y}.png" }];
plan = planBasesImport(doc, ctx({ users: clash }));
ok(plan.add.some(a => a.url === users[0].url && a.id.startsWith("ufresh")) && plan.idMap.get("u0123456789ab").startsWith("ufresh"),
  "un id ocupado por otro servidor recibe uno nuevo");

/* the cap */
plan = planBasesImport(doc, ctx({ max: 1 }));
ok(plan.add.length === 1 && plan.skipped === 1, "por encima del máximo se omiten y se cuentan");

/* hostile values */
const hostile = JSON.parse(JSON.stringify(doc));
hostile.bases.osm = { on: "sí", opacity: 5 };
hostile.bases.pnoa = { opacity: -2, wmsLayer: "x".repeat(500) };
hostile.bases.nadie = { on: true };
hostile.bases["__proto__"] = { on: true };
hostile.order = ["osm", "osm", 7, "nadie", "pnoa"];
hostile.background = "red; content: url(x)";
hostile.userBases.push({ id: "u0123456789ad", type: "tiles", url: "http://inseguro.ejemplo.org/{z}/{x}/{y}.png" }, { id: "../x", type: "wms", url: "https://a.b/c" }, null);
plan = planBasesImport(hostile, ctx());
ok(!("on" in plan.bases.osm) && plan.bases.osm.opacity === 1, "on que no es booleano fuera; opacidad acotada a [0, 1]");
ok(plan.bases.pnoa.opacity === 0 && !("wmsLayer" in plan.bases.pnoa), "opacidad negativa a 0; una capa WMS desmesurada fuera");
ok(!("nadie" in plan.bases) && !Object.prototype.hasOwnProperty.call(plan.bases, "__proto__"), "ids desconocidos fuera, también __proto__");
ok(plan.order.join() === "osm,pnoa", "el orden sin repetidos, sin desconocidos ni números");
ok(plan.background === null, "un color que no es #rrggbb no se aplica");
ok(plan.skipped === 3 && plan.add.length === 2, "una dirección sin https, un id inválido y un null se cuentan como omitidos: " + plan.skipped);
let threw = null;
try { planBasesImport({ ...doc, format: 2 }, ctx()); } catch (e) { threw = e.message; }
ok(/otra versión/.test(threw || ""), "otra versión del formato se rechaza");

if (!process.exitCode) console.log("BASES EXPORT TESTS OK");
