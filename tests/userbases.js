/* User base layers (11-base-panel.js): the pure pieces behind the «+»
   button and the gear of a user row. Which addresses can be used and why
   not (only https, no credentials, the placeholders a tile template may
   carry), the template L.tileLayer receives (a base address gets the XYZ
   scheme appended, a full template is kept as written), the name of a
   layer left without one, and the reading of what was saved, which is
   foreign input: bad entries, repeated ids and anything past the cap are
   dropped. The dialog, the panel and the layers on the map are tested in
   tests/browser/user-bases.mjs.                                         */
const { fn, constDecl } = require("./_extract");
const src = ["USER_BASES_MAX", "USER_BASE_NAME_MAX", "USER_BASE_TYPES", "USER_BASE_ID", "USER_TILE_VARS",
  "TEMPLATE_VAR", "templateVars", "CUSTOM_WMS_RESERVED"].map(constDecl).join("\n") + "\n"
  + ["normalizeCustomTilesBase", "userTilesTemplate", "userBaseUrlProblem", "normalizeCustomWmsBase",
    "normalizeUserBaseUrl", "userBaseDefaultName", "userBaseRecord", "validUserBases"].map(fn).join("\n");
const api = new Function(src + "\nreturn { userTilesTemplate, userBaseUrlProblem, userBaseDefaultName,"
  + " userBaseRecord, validUserBases, USER_BASES_MAX };")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const why = api.userBaseUrlProblem;

/* ---------- Addresses: only https, no credentials ---------- */
for (const type of ["tiles", "wms"]) {
  ok(why(type, "https://mi-servidor.example.org/tiles/") === null, `${type}: https vale`);
  ok(why(type, "  https://mi-servidor.example.org/wms?map=/x.map  ") === null, `${type}: con espacios y consulta propia vale`);
  ok(/https/.test(why(type, "http://mi-servidor.example.org/x") || ""), `${type}: http no vale`);
  ok(/https/.test(why(type, "ftp://mi-servidor.example.org/x") || ""), `${type}: otro esquema no vale`);
  ok(/https/.test(why(type, "no es una url") || ""), `${type}: texto suelto no vale`);
  ok(/https/.test(why(type, "") || ""), `${type}: vacío no vale`);
  ok(/usuario/.test(why(type, "https://ana:clave@mi-servidor.example.org/x") || ""), `${type}: con usuario y contraseña no vale`);
}

/* ---------- Tile templates: the placeholders Leaflet fills in ---------- */
ok(why("tiles", "https://t.example.org/{z}/{x}/{y}.png") === null, "una plantilla XYZ vale");
ok(why("tiles", "https://t.example.org/tile/{z}/{y}/{x}") === null, "en el orden de Esri también");
ok(why("tiles", "https://{s}.t.example.org/{z}/{x}/{-y}.jpg") === null, "con {s} y {-y}");
ok(why("tiles", "https://t.example.org/wmts?Layer=a&TileMatrix={z}&TileCol={x}&TileRow={y}") === null,
  "un WMTS en forma KVP, con las variables en la consulta");
ok(/\{q\}/.test(why("tiles", "https://t.example.org/{z}/{x}/{y}.png?key={q}") || ""),
  "una variable que Leaflet no conoce se nombra en el motivo");
ok(/\{z\}, \{x\} e \{y\}/.test(why("tiles", "https://t.example.org/{z}/{x}.png") || ""),
  "una plantilla sin {y} (ni {-y}) no vale");
ok(/https/.test(why("tiles", "http://t.example.org/{z}/{x}/{y}.png") || ""), "una plantilla http tampoco");
ok(why("wms", "https://w.example.org/wms?x={q}") === null, "en un WMS las llaves no son plantilla: no se revisan");

/* ---------- The template L.tileLayer receives ---------- */
ok(api.userTilesTemplate("https://x.example.com/tiles/") === "https://x.example.com/tiles/{z}/{x}/{y}.png",
  "a una dirección base se le añade el esquema XYZ, con una sola barra");
ok(api.userTilesTemplate("  https://x.example.com/tiles///  ") === "https://x.example.com/tiles/{z}/{x}/{y}.png",
  "sin espacios ni barras finales repetidas");
ok(api.userTilesTemplate(" https://x.example.com/{z}/{y}/{x}.jpg ") === "https://x.example.com/{z}/{y}/{x}.jpg",
  "una plantilla completa se respeta tal cual (solo sin espacios)");

/* ---------- Name of a layer left without one ---------- */
ok(api.userBaseDefaultName("https://mi-cache.example.org/tiles/") === "mi-cache.example.org", "el host del servidor");
ok(api.userBaseDefaultName("https://{s}.tile.example.org/{z}/{x}/{y}.png") === "0.tile.example.org",
  "con una plantilla, el host con las variables cubiertas (no lanza)");

/* ---------- Records: what the dialog and IndexedDB go through ---------- */
const ID = "u0123456789ab";
let r = api.userBaseRecord(ID, { type: "tiles", name: "  Mi caché  ", url: " https://c.example.org/t/ ", tms: true });
ok(r && r.name === "Mi caché" && r.url === "https://c.example.org/t/" && r.tms === true && r.type === "tiles",
  "un registro de teselas: nombre y dirección sin espacios, TMS: " + JSON.stringify(r));
r = api.userBaseRecord(ID, { type: "wms", name: "", url: "https://w.example.org/wms?SERVICE=WMS&REQUEST=GetCapabilities", tms: true });
ok(r && r.url === "https://w.example.org/wms" && r.name === "w.example.org" && !("tms" in r),
  "un WMS pierde los parámetros de OGC, toma el nombre del host y no lleva TMS: " + JSON.stringify(r));
ok(api.userBaseRecord(ID, { type: "tiles", name: "x".repeat(200), url: "https://c.example.org/" }).name.length === 80,
  "el nombre se acota a 80 caracteres");
ok(api.userBaseRecord(ID, { type: "tiles", name: "x", url: "https://c.example.org/", tms: "sí" }).tms === undefined,
  "TMS solo con true exacto");
ok(api.userBaseRecord(ID, { type: "arcgis", name: "x", url: "https://c.example.org/" }) === null, "un tipo desconocido no");
ok(api.userBaseRecord("custom", { type: "tiles", name: "x", url: "https://c.example.org/" }) === null,
  "un id que no es de una capa de usuario no (los de las capas fijas tampoco)");
ok(api.userBaseRecord(ID, { type: "tiles", name: "x", url: "http://c.example.org/" }) === null, "una dirección inválida no");

/* ---------- Reading what was saved ---------- */
const good = (i, extra) => ({ id: "u" + String(i).padStart(12, "0"), type: "tiles", name: "C" + i, url: "https://c.example.org/" + i, ...extra });
const saved = api.validUserBases([good(1), null, "texto", { ...good(2), url: "http://malo" }, good(1), { ...good(3), __proto__: { x: 1 } },
  { ...good(4), type: "wms", url: "https://w.example.org/wms" }]);
ok(saved.map(s => s.id.slice(-1)).join() === "1,3,4",
  "se quedan las válidas, sin repetidas y en su orden: " + JSON.stringify(saved));
ok(api.validUserBases({ list: [] }).length === 0 && api.validUserBases(undefined).length === 0, "lo que no es una lista, nada");
ok(api.validUserBases(Array.from({ length: 30 }, (_, i) => good(i + 1))).length === api.USER_BASES_MAX,
  "como mucho USER_BASES_MAX");

if (!process.exitCode) console.log("USER BASE LAYERS TESTS OK");
