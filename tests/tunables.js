/* The settings tunable in Propiedades (04-tunables.js), the pure part.

   - The DEFAULTS are pinned here, one by one, with the value each constant
     had before it became a setting: «Restaurar» must bring back exactly
     those, and a default cannot drift without this table saying so.
   - The table is well formed: unique ids, a known tab, the default inside
     its bounds, integers where the code needs them, a label, and every tab
     with its container in index.html.
   - Every setting really reaches the code: no `const <ID>` is left behind
     in src/js, and the delivered script reads `CFG.<ID>` somewhere.
   - The saved record is foreign input (validTunables) and only what differs
     from the default is saved (tunableOverrides).
   - What the dialog shows converts back to the same stored value.
   The dialog, the saving and «Restaurar» are tested in
   tests/browser/tunables.mjs.                                           */
const fs = require("fs");
const path = require("path");
const { script, tunablesCore } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const { TUNABLES, TUNABLES_TABS, TUNABLES_SCHEMA, CFG, validTunables, tunableOverrides, tunableValid, tunableShown, tunableStored } = tunablesCore;
const MB = 1024 * 1024;

/* ---------- 1. The defaults: the values of the old constants ---------- */
const DEFAULTS = {
  LAYER_INFO_HOVER_INTENT_MS: 250, LAYER_INFO_HIDE_DELAY: 200, INFO_STACK_DWELL_MS: 400, INFO_STACK_TTL_MS: 30000,
  INFO_STACK_WARN_MS: 5000, INFO_STACK_MAX: 6, INFO_STACK_MAX_PINNED: 6,
  MSG_TIMEOUT: 6000, MSG_MAX_LINES: 8, MSG_LOG_MAX: 200, SEARCH_DEBOUNCE_MS: 150, SEARCH_MIN_CHARS: 3, UNDO_MAX: 20,
  PAGE_STEP: 10, DRAG_THRESHOLD_PX: 6,
  FOCUS_ZOOM: 14, COORD_SEARCH_ZOOM: 17, PLACE_ZOOM: 14, FRAME_MARGIN_RATIO: 0.2, KEY_PAN_STEP: 80, KEY_PAN_SPEED: 400,
  KEY_PAN_MAX_SPEED: 1600, KEY_PAN_SHIFT: 3, KEY_ZOOM_RATE: 3, WHEEL_PX_PER_LEVEL: 100, ROTATE_DEG_PER_PX: 0.5,
  MARKER_HIT_PX: 20, PATH_HIT_PX: 10,
  KMZ_MAX_ENTRIES: 2000, KMZ_MAX_RATIO: 200, SHP_MAX_BYTES: 300 * MB, SHP_MAX_FEATURES: 100000, GPX_MAX_POINTS: 2000000,
  HUGE_IMPORT_CHARS: 100 * MB, URL_MAX_BYTES: 100 * MB, CLIPBOARD_MAX: 5 * MB, EXT_MAX_FIELDS: 200, DUP_POS_DECIMALS: 5,
  EXPORT_CIRCLE_SEGMENTS: 120,
  PLACE_TIMEOUT: 10000, URL_TIMEOUT: 20000, CUSTOM_WMS_TIMEOUT: 15000, ELEV_TIMEOUT: 12000, ELEV_RETRIES: 3, ELEV_MAX_RPS: 4,
  CADASTRE_TIMEOUT: 15000, CADASTRE_RETRIES: 2, ARCGIS_QUERY_TIMEOUT: 30000, ARCGIS_RETRIES: 2, WIKIPEDIA_TIMEOUT: 15000,
  WIKIPEDIA_RETRIES: 3, WIKIPEDIA_LIMIT: 100, ORS_TIMEOUT: 20000, ORS_RETRIES: 2,
  PF_FRESNEL_ZONE: 0.6, ELEV_ALERT_DIFF: 1, ELEV_CACHE_MAX: 200, PROFILE_LOG_MAX: 3000, PF_EXPORT_SCALE: 2
};
ok(TUNABLES.length === Object.keys(DEFAULTS).length,
  `una entrada por constante: ${TUNABLES.length} en la tabla, ${Object.keys(DEFAULTS).length} fijadas aquí`);
for (const t of TUNABLES) {
  ok(DEFAULTS[t.id] === t.def, `${t.id}: el valor de partida es el de antes (${DEFAULTS[t.id]}): ${t.def}`);
  ok(CFG[t.id] === t.def, `${t.id}: CFG arranca con el valor de partida`);
}

/* ---------- 2. A well-formed table ---------- */
ok(new Set(TUNABLES.map(t => t.id)).size === TUNABLES.length, "ningún id repetido");
const html = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");
for (const tab of TUNABLES_TABS) {
  ok(TUNABLES.some(t => t.tab === tab), `la pestaña ${tab} tiene algún ajuste`);
  ok(html.includes(`class="tunables-list" data-tunables="${tab}"`), `index.html tiene el contenedor de la pestaña ${tab}`);
}
for (const t of TUNABLES) {
  ok(TUNABLES_TABS.includes(t.tab), `${t.id}: pestaña conocida (${t.tab})`);
  ok(typeof t.label === "string" && t.label.length > 3, `${t.id}: lleva rótulo`);
  ok(t.min <= t.def && t.def <= t.max, `${t.id}: el valor de partida cabe en [min, max]`);
  ok(tunableValid(t, t.def), `${t.id}: el valor de partida es válido`);
  if (t.int !== false) ok([t.min, t.def, t.max].every(Number.isInteger), `${t.id}: entero en sus tres cifras`);
  ok(tunableStored(t, tunableShown(t, t.def)) === t.def, `${t.id}: lo que enseña el diálogo vuelve al mismo valor: ${tunableShown(t, t.def)}`);
}

/* ---------- 3. Every setting reaches the code ---------- */
const srcDir = path.join(__dirname, "..", "src", "js");
const sources = fs.readdirSync(srcDir).filter(f => f.endsWith(".js") && f !== "04-tunables.js")
  .map(f => fs.readFileSync(path.join(srcDir, f), "utf8")).join("\n");
for (const t of TUNABLES) {
  ok(!new RegExp(`\\bconst ${t.id}\\b`).test(sources), `${t.id}: no queda una constante con su nombre en src/js`);
  ok(script.includes(`CFG.${t.id}`), `${t.id}: el código lo lee como CFG.${t.id}`);
}

/* ---------- 4. The saved record: foreign input ---------- */
ok(Object.keys(validTunables(null)).length === 0, "sin registro, nada");
ok(Object.keys(validTunables({ v: TUNABLES_SCHEMA + 1, values: { UNDO_MAX: 50 } })).length === 0, "otra versión del registro, nada");
ok(Object.keys(validTunables({ v: TUNABLES_SCHEMA, values: "UNDO_MAX=50" })).length === 0, "values que no es un objeto, nada");
const read = validTunables({ v: TUNABLES_SCHEMA, values: {
  UNDO_MAX: 50,                 /* valid */
  KEY_PAN_SHIFT: 2.5,           /* a valid fraction */
  MSG_MAX_LINES: 3.5,           /* not an integer */
  ELEV_MAX_RPS: 1000,           /* above its maximum: the request discipline holds */
  SHP_MAX_FEATURES: -1,         /* below its minimum */
  PAGE_STEP: "20",              /* text, not converted */
  WIKIPEDIA_LIMIT: NaN,
  MAX_ZOOM: 30,                 /* not a tunable setting */
  __proto__: 1
} });
ok(JSON.stringify(read) === JSON.stringify({ UNDO_MAX: 50, KEY_PAN_SHIFT: 2.5 }), "solo lo válido pasa, cada valor por su cuenta: " + JSON.stringify(read));

/* ---------- 5. Only what differs is saved ---------- */
ok(Object.keys(tunableOverrides()).length === 0, "con los valores de partida no se guarda nada");
const changed = { ...CFG, UNDO_MAX: 50, FOCUS_ZOOM: 14 };
ok(JSON.stringify(tunableOverrides(changed)) === JSON.stringify({ UNDO_MAX: 50 }), "solo lo que difiere: " + JSON.stringify(tunableOverrides(changed)));

/* ---------- 6. Shown ↔ stored ---------- */
const byId = id => TUNABLES.find(t => t.id === id);
ok(tunableShown(byId("INFO_STACK_TTL_MS"), 30000) === 30, "30 000 ms se enseñan como 30 s");
ok(tunableStored(byId("INFO_STACK_TTL_MS"), 2.5) === 2500, "2,5 s se guardan como 2500 ms");
ok(tunableShown(byId("PF_FRESNEL_ZONE"), 0.6) === 60, "0,6 se enseña como 60 % (sin 59,999…)");
ok(tunableStored(byId("PF_FRESNEL_ZONE"), 80) === 0.8, "80 % se guarda como 0,8");
ok(tunableShown(byId("SHP_MAX_BYTES"), 300 * MB) === 300, "300 MB en bytes se enseñan como 300");
ok(tunableStored(byId("URL_MAX_BYTES"), 1.5) === Math.round(1.5 * MB), "un tamaño en MB con decimales se guarda en bytes enteros");

if (!process.exitCode) console.log("TUNABLES TESTS OK");
