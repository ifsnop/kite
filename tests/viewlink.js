/* Enlace a la vista (70-view-controls.js): construir y leer `#map=…`.
   Lo que llega en la dirección es entrada AJENA: aquí, que solo pasa lo
   que debe. Aplicarlo al abrir y pegarlo con la aplicación abierta lo
   cubre tests/browser/view-link.mjs; el orden del arranque, tests/boot.js. */
const { fn, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* La lista real de mapas base trae funciones y llamadas a Leaflet: basta su forma */
const BASE_LAYERS = [
  { id: "osm" }, { id: "terrain" }, { id: "pnoa" }, { id: "mdt" }, { id: "madrid-orto" },
  { id: "copernicus-dem", dynamic: true, source: "copernicus" }, { id: "pnoa-hist", dynamic: true, source: "pnoa-hist" },
  { id: "custom", source: "custom-tiles" }, { id: "custom-wms", dynamic: true, source: "custom-wms" }
];
const api = new Function("BASE_LAYERS", [constDecl("linkBaseIds"), constDecl("LINK_BASE_IDS"), constDecl("LINK_MAX_HASH"), constDecl("LINK_NUM"),
  fn("buildViewHash"), fn("parseViewHash")].join("\n") + "\nreturn { linkBaseIds, LINK_BASE_IDS, buildViewHash, parseViewHash, LINK_MAX_HASH };")(BASE_LAYERS);
const { linkBaseIds, LINK_BASE_IDS, buildViewHash, parseViewHash, LINK_MAX_HASH } = api;

/* ---------- Qué mapas base viajan ---------- */
ok(linkBaseIds(BASE_LAYERS).join() === "osm,terrain,pnoa,mdt,madrid-orto", "solo los públicos: " + linkBaseIds(BASE_LAYERS));
for (const privado of ["custom", "custom-wms", "copernicus-dem", "pnoa-hist"]) ok(!LINK_BASE_IDS.has(privado), `«${privado}» (dirección o credencial propias) no viaja`);

/* ---------- Construir ---------- */
ok(buildViewHash({ lat: 40.405, lng: -3.69, zoom: 14 }, 0, ["osm", "pnoa"]) === "#map=14/40.405/-3.69&base=osm,pnoa", "sin giro no hay cuarto número: " + buildViewHash({ lat: 40.405, lng: -3.69, zoom: 14 }, 0, ["osm", "pnoa"]));
ok(buildViewHash({ lat: 40.4, lng: -3.7, zoom: 9.5 }, 30, []) === "#map=9.5/40.4/-3.7/30&base=", "con giro, y base vacía = ninguna encendida");
ok(buildViewHash({ lat: 1.23456789, lng: 2.3456789, zoom: 7.123 }, 0, ["osm"]) === "#map=7.12/1.234568/2.345679&base=osm", "6 decimales en las coordenadas y 2 en el zoom");
ok(buildViewHash({ lat: 0, lng: 0, zoom: 3 }, -90, ["osm"]).includes("/270&"), "un giro negativo se lleva a [0, 360)");
ok(buildViewHash({ lat: 0, lng: 0, zoom: 3 }, 0.01, ["osm"]) === "#map=3/0/0&base=osm", "un giro despreciable no se escribe");
ok(!/e[+-]\d/.test(buildViewHash({ lat: 1e-9, lng: 5e-7, zoom: 3 }, 0, [])), "nunca notación científica");

/* ---------- Ida y vuelta ---------- */
const back = parseViewHash(buildViewHash({ lat: -33.865143, lng: 151.2099, zoom: 11.25 }, 45.5, ["terrain", "mdt"]));
ok(back && back.lat === -33.865143 && back.lng === 151.2099 && back.zoom === 11.25 && back.bearing === 45.5 && back.bases.join() === "terrain,mdt", "ida y vuelta: " + JSON.stringify(back));
const sinBase = parseViewHash("#map=5/10/20");
ok(sinBase && sinBase.bases === null && sinBase.bearing === 0, "sin `base`, el enlace no habla de mapas (null), y sin giro es 0: " + JSON.stringify(sinBase));
ok(parseViewHash("#map=5/10/20&base=").bases.length === 0, "`base=` vacío es «ninguno», distinto de no decir nada");
ok(parseViewHash("#map=5/10/20/-30").bearing === 330 && parseViewHash("#map=5/10/20/390").bearing === 30, "el giro se normaliza");
ok(parseViewHash("#map=25/85/180").zoom === 25 && parseViewHash("#map=0/-85/-180").lng === -180, "los extremos válidos entran");

/* ---------- Entrada hostil ---------- */
const malos = {
  "sin ancla": "", "otra ancla": "#hola", "sin map": "#base=osm", "mapa vacío": "#map=",
  "faltan números": "#map=5/10", "sobran números": "#map=5/10/20/30/40", "texto": "#map=a/b/c",
  "exponente": "#map=1e1/10/20", "signo +": "#map=5/+10/20", "coma decimal": "#map=5/10,5/20", "espacios": "#map=5/ 10/20",
  "NaN": "#map=NaN/10/20", "Infinity": "#map=5/Infinity/20", "zoom 26": "#map=26/10/20", "zoom negativo": "#map=-1/10/20",
  "latitud 86": "#map=5/86/20", "longitud 181": "#map=5/10/181", "un número vacío": "#map=5//20",
  "script": "#map=5/10/20<script>alert(1)</script>", "doble signo": "#map=5/--10/20",
  "demasiado largo": "#map=5/10/20&base=" + "osm,".repeat(LINK_MAX_HASH)
};
for (const [que, h] of Object.entries(malos)) ok(parseViewHash(h) === null, `rechaza «${que}»: ${JSON.stringify(parseViewHash(h))}`);
ok(parseViewHash(null) === null && parseViewHash(undefined) === null && parseViewHash(42) === null, "ni null, ni undefined, ni un número");

/* ---------- Lo que se ignora dentro de un enlace válido ---------- */
const mix = parseViewHash("#map=5/10/20&base=osm,inventada,custom,custom-wms,copernicus-dem,pnoa-hist,osm,<img>,terrain");
ok(mix.bases.join() === "osm,terrain", "ids desconocidos, propios o repetidos se descartan: " + mix.bases);
ok(parseViewHash("#map=5/10/20&otra=cosa&base=osm&x").bases.join() === "osm", "parámetros ajenos, ignorados");
ok(parseViewHash("#map=5/10/20&base=osm%2Cpnoa").bases.length === 0, "no se decodifica nada: un id escapado no es un id");

if (!process.exitCode) console.log("VIEW LINK TESTS OK");
