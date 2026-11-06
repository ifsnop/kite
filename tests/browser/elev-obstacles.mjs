/* Polígonos con altitud como OBSTÁCULOS del perfil de una ruta, de punta a
   punta en el navegador, con el MDT y el MDS del IGN falsos (page.route):
   el MDT ronda 590 ± 50 m y el MDS 600 ± 50 m.

   1) Un KML con polígonos de cada modo de altitud se importa y CONSERVA el
      modo de cada uno (`kiteAlt`); los dos del fondo marino avisan UNA vez
      por archivo; el exportado a KML lo escribe de vuelta.
   2) «Obtener perfil» recoge solo los polígonos VISIBLES con altitud que
      cruzan la ruta (no el apagado, no el sin altitud, no los del fondo
      marino); el AMSL con su techo, el AGL con el terreno de ESE perfil
      sumado y SIN peticiones nuevas; el aviso dice los que no entran.
   3) La gráfica: un bloque por obstáculo y su leyenda; sin la línea
      inicio–fin, una frase que lo dice; con ella y a ras de terreno, en rojo
      lo que tapa y la frase con el nombre; con torres altas, «ningún
      obstáculo»; la lectura bajo el cursor da nombre, techo y despeje.
   4) Se guarda con el perfil, y las TORRES también: recargar y «Mostrar
      perfil» trae obstáculos y torres sin pedir nada; un cambio de torre
      tras recargar también se guarda; «Actualizar obstáculos» vuelve a
      recoger lo visible AHORA, sin red.
   6) Mover (o insertar) un vértice con el ratón conserva las altitudes de
      todos los vértices del polígono; Cancelar y Aceptar también.
   5) El modo de altitud en la lista de puntos del polígono: el importado,
      AMSL por defecto (GeoJSON), cambiarlo y Aceptar lo guarda, Cancelar y
      la × no, abrir y aceptar sin tocar no escribe nada, y no hay fila en
      una línea.                                                           */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";
import { ignFakes, IGN_ROUTE } from "./_fakes.mjs";

const { ok, done } = reporter("BROWSER ROUTE PROFILE OBSTACLES TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8967);
const { page, errors } = await openApp(browser, srv.url, { viewport: { width: 1400, height: 900 } });

const fake = ignFakes();
const seen = fake.seen;
await page.route(IGN_ROUTE, fake.handler);
const step = n => { if (process.env.STEPS) console.log("· " + n); };
const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = ms => page.evaluate(t => new Promise(r => setTimeout(r, t)), ms);

/* La misma ruta de dos tramos que el perfil de siempre: ~1,2 km al este y ~0,9 km al norte */
const WAYPOINTS = [{ lat: 40.4168, lng: -3.7038 }, { lat: 40.4168, lng: -3.69 }, { lat: 40.425, lng: -3.69 }];
await page.evaluate(async wps => {
  setMeasureUnit("km");
  setAltitudeUnit("m");
  elevSources = { mdt: "ign-mdt05", mds: "ign-mds" };
  const m = buildRouteMeasurement(wps);
  finalizeRouteMeasurement(m);
  map.fitBounds(m.group.getBounds(), { animate: false });
}, WAYPOINTS);
const routeLi = "[...document.querySelectorAll('#tree li')].find(x => x._measure && x._measure.type === 'route')";

step("1.");
/* ---------- 1. El KML, con un polígono de cada modo ---------- */
const square = (name, lng0, lng1, alt, mode, extra = "") => {
  const z = alt === null ? "" : "," + alt;
  return `<Placemark><name>${name}</name>${extra}<Polygon>${mode || ""}<outerBoundaryIs><LinearRing><coordinates>`
    + `${lng0},40.4165${z} ${lng1},40.4165${z} ${lng1},40.4171${z} ${lng0},40.4171${z} ${lng0},40.4165${z}`
    + `</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
};
const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>Obstáculos</name>
${square("Antena AMSL", -3.700, -3.6995, 700, "<altitudeMode>absolute</altitudeMode>")}
${square("Torre AGL", -3.696, -3.6955, 50, "<altitudeMode>relativeToGround</altitudeMode>")}
${square("Fondo A", -3.6945, -3.694, 5, "<gx:altitudeMode>relativeToSeaFloor</gx:altitudeMode>")}
${square("Fondo B", -3.693, -3.6925, 5, "<gx:altitudeMode>clampToSeaFloor</gx:altitudeMode>")}
${square("Sin altitud", -3.692, -3.6915, null, "")}
${square("Apagado", -3.698, -3.6975, 900, "<altitudeMode>absolute</altitudeMode>", "<visibility>0</visibility>")}
</Document></kml>`;
await page.evaluate(async kml => {
  document.getElementById("nav-msg").textContent = "";
  await handleDroppedFiles([new File([kml], "obstaculos.kml")]);
}, KML);
await frames();

const modes = await page.evaluate(() => {
  const out = {};
  const visit = (l, top) => {
    if (l instanceof L.Polygon && !(l instanceof L.Rectangle)) out[profileObstacleName(top)] = { mode: featureAltMode(l.feature), z: l.getLatLngs()[0][0].alt };
    else if (l.eachLayer) l.eachLayer(x => visit(x, top));
  };
  rootGroup.eachLayer(l => visit(l, l));
  return out;
});
ok(modes["Antena AMSL"] && modes["Antena AMSL"].mode === "abs" && modes["Antena AMSL"].z === 700, "absolute → abs, con su altitud: " + JSON.stringify(modes["Antena AMSL"]));
ok(modes["Torre AGL"] && modes["Torre AGL"].mode === "agl", "relativeToGround → agl");
ok(modes["Fondo A"].mode === "sea" && modes["Fondo B"].mode === "sea", "los dos del fondo marino (con gx:) → sea");
ok(modes["Sin altitud"].mode === null && modes["Sin altitud"].z === undefined, "sin modo ni altitud: sin marca, y no se inventa un 0");
ok(!("Apagado" in modes), "el apagado no está en el mapa");
const importMsgs = await page.evaluate(() => msgLog.map(m => m.text || m.txt || String(m)).filter(t => /fondo marino/.test(t)));
ok(importMsgs.length === 1 && /2 polígonos con altitud sobre el fondo marino/.test(importMsgs[0]),
  "UN aviso por archivo, con el recuento: " + JSON.stringify(importMsgs));

/* La ida y vuelta por el KML exportado conserva el modo */
const exported = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._name === "Obstáculos");
  return recordsToKml(serializeNode(li)).text;
});
ok(/<altitudeMode>absolute<\/altitudeMode>/.test(exported) && /<altitudeMode>relativeToGround<\/altitudeMode>/.test(exported)
  && /<gx:altitudeMode>relativeToSeaFloor<\/gx:altitudeMode>/.test(exported) && /xmlns:gx=/.test(exported),
  "el KML exportado escribe el modo de cada polígono y declara gx:");

step("2.");
/* ---------- 2. Obtener el perfil ---------- */
const keyOf = "routeProfileKey(measureWaypoints(" + routeLi + "._measure))";
await page.evaluate(async sel => { obtainRouteProfile(eval(sel)); }, routeLi);
await page.waitForFunction(() => typeof profileData === "object" && profileData && profileData.obstacles && !profileRun, null, { timeout: 30000 });
await frames();
const got = await page.evaluate(() => {
  const mdt = profileData.series.find(s => s.kind === "mdt").points.filter(p => typeof p.v === "number");
  const by = Object.fromEntries(profileData.obstacles.map(o => [o.name, o]));
  const mid = o => { const s = o.spans[0]; return (s[0][0] + s[s.length - 1][0]) / 2; };
  const a = by["Antena AMSL"], t = by["Torre AGL"];
  return {
    names: profileData.obstacles.map(o => `${o.name}:${o.mode}`).sort(),
    antena: a && obstacleRoofAt(a, mid(a)),
    agl: t && obstacleRoofAt(t, mid(t)) - profileValueAt(mdt, mid(t)),
    note: document.getElementById("profile-note").textContent
  };
});
ok(got.names.join() === "Antena AMSL:abs,Torre AGL:agl", "solo los visibles con altitud que cruzan la ruta: " + got.names);
ok(Math.abs(got.antena - 700) < 0.01, "AMSL: su techo, 700 m: " + got.antena);
ok(Math.abs(got.agl - 50) < 0.1, "AGL: 50 m SOBRE el terreno del perfil: " + got.agl);
ok(/2 polígonos con altitud sobre el fondo marino no se han tenido en cuenta/.test(got.note), "el aviso dice los que no entran: " + got.note);
ok(!/sin altitud/.test(got.note), "un polígono sin ninguna altitud no se menciona (no es un obstáculo)");
const gridCalls = seen.filter(s => s.request === "GetCoverage").length;

step("3.");
/* ---------- 3. La gráfica ---------- */
const chart = () => page.evaluate(() => ({
  blocks: document.querySelectorAll("#profile-chart .pf-obstacle:not(.pf-obstacle-hit)").length,
  hits: document.querySelectorAll("#profile-chart .pf-obstacle-hit").length,
  legend: [...document.querySelectorAll("#profile-chart .pf-legend-label")].map(t => t.textContent).join("|"),
  note: document.getElementById("profile-obstructions").textContent,
  noteHidden: document.getElementById("profile-obstructions").hidden,
  noteAlert: document.getElementById("profile-obstructions").classList.contains("alert")
}));
let c = await chart();
ok(c.blocks === 2 && /Obstáculos \(2\)/.test(c.legend), "un bloque por obstáculo y su leyenda: " + JSON.stringify(c));
ok(!c.noteHidden && /Activa «Línea inicio–fin»/.test(c.note) && !c.noteAlert, "sin la línea, una frase que dice cómo comprobarlo: " + c.note);

await page.evaluate(() => { document.getElementById("pf-los").click(); });
await frames();
c = await chart();
ok(c.hits >= 1 && c.noteAlert && /Obstáculos que tapan la línea: «Antena AMSL» \(-[\d.]+ m\)/.test(c.note),
  "con la línea a ras de terreno, la Antena (700 m) la tapa: en rojo y con su nombre: " + JSON.stringify(c));

await page.evaluate(() => {
  for (const k of ["a", "b"]) {
    const inp = document.getElementById("pf-tower-" + k);
    inp.value = "300";
    inp.dispatchEvent(new Event("change"));
  }
});
await frames();
c = await chart();
ok(c.hits === 0 && !c.noteAlert && /Ningún obstáculo tapa la línea/.test(c.note), "con torres de 300 m la línea pasa por encima de todo: " + JSON.stringify(c));

/* La lectura bajo el cursor, con el ratón real, sobre la Antena */
const where = await page.evaluate(() => {
  const o = profileData.obstacles.find(x => x.name === "Antena AMSL");
  const s = o.spans[0], d = (s[0][0] + s[s.length - 1][0]) / 2;
  const r = profileChart.getBoundingClientRect(), lay = profileLayout;
  return { x: r.left + lay.xOf(d) * r.width / lay.W, y: r.top + r.height / 2 };
});
await page.mouse.move(where.x, where.y, { steps: 3 });
await frames();
const read = await page.evaluate(() => ({
  obs: document.querySelector('#profile-info [data-k="obs"] .pf-info-val').textContent,
  clear: document.querySelector('#profile-info [data-k="oclear"] .pf-info-val').textContent,
  alert: document.querySelector('#profile-info [data-k="oclear"] .pf-info-val').classList.contains("alert")
}));
ok(/^Antena AMSL · 700/.test(read.obs), "la lectura da el nombre y el techo del obstáculo: " + JSON.stringify(read));
ok(/^\+\d/.test(read.clear) && !read.alert, "y el despeje de la línea sobre él, positivo con las torres altas: " + read.clear);

/* «Despeje» y «Margen Fresnel» dicen CONTRA QUÉ se miden, y la referencia se elige */
await page.evaluate(() => { document.getElementById("pf-fresnel").click(); });
await frames();
const num = t => parseFloat(String(t).replace(/[^\d.+-]/g, ""));
const readRef = async ref => {
  if (ref) await page.selectOption("#pf-ref", ref);
  await frames();
  await page.mouse.move(where.x + 2, where.y);
  await page.mouse.move(where.x, where.y);
  await frames();
  return page.evaluate(() => {
    const row = k => document.querySelector(`#profile-info [data-k="${k}"]`);
    const txt = (k, sel) => row(k).querySelector(sel).textContent;
    return { sel: document.getElementById("pf-ref").value, clearLabel: txt("clear", ".pf-info-label"), clear: txt("clear", ".pf-info-val"),
             marginLabel: txt("margin", ".pf-info-label"), margin: txt("margin", ".pf-info-val"), fres: txt("fres", ".pf-info-val"),
             oclear: txt("oclear", ".pf-info-val"), oclearOff: row("oclear").classList.contains("off"),
             enabled: [...document.getElementById("pf-ref").options].map(o => o.value + ":" + (o.disabled ? "x" : "ok")).join() };
  });
};
const refDefault = await readRef(null);
ok(refDefault.sel === "mds" && refDefault.clearLabel === "Despeje (MDS)" && refDefault.marginLabel === "Margen Fresnel (MDS)",
  "por defecto, contra la superficie, y las etiquetas lo dicen: " + JSON.stringify(refDefault));
ok(refDefault.enabled === "mdt:ok,mds:ok,obs:ok", "las tres referencias disponibles en este perfil: " + refDefault.enabled);
const refMdt = await readRef("mdt");
ok(refMdt.clearLabel === "Despeje (MDT)" && refMdt.marginLabel === "Margen Fresnel (MDT)", "con el MDT, las etiquetas lo dicen: " + refMdt.clearLabel);
ok(Math.abs((num(refMdt.clear) - num(refDefault.clear)) - 10) < 0.25, "el MDS del simulador va 10 m sobre el MDT, así que el despeje contra el MDT es 10 m mayor: " + refDefault.clear + " → " + refMdt.clear);
ok(Math.abs(num(refMdt.margin) - (num(refMdt.clear) - num(refMdt.fres))) < 0.25, "margen = despeje − radio de Fresnel al 60 %: " + JSON.stringify(refMdt));
ok(num(refMdt.fres) === num(refDefault.fres), "el radio de Fresnel no depende de la referencia");
const refObs = await readRef("obs");
ok(refObs.clearLabel === "Despeje (Obstáculo)" && refObs.marginLabel === "Margen Fresnel (Obstáculo)", "con los obstáculos, las etiquetas lo dicen: " + refObs.clearLabel);
ok(Math.abs(num(refObs.clear) - num(refDefault.oclear)) < 0.25, "contra el obstáculo, el despeje es el de «Despeje obstáculo» (techo 700 m): " + refObs.clear + " vs " + refDefault.oclear);
ok(Math.abs(num(refObs.margin) - (num(refObs.clear) - num(refObs.fres))) < 0.25, "y el margen de Fresnel es sobre el techo: " + JSON.stringify(refObs));
ok(refObs.oclearOff && refObs.oclear === "\u2014", "la fila «Despeje obstáculo» se atenúa para no repetirse: " + refObs.oclear);
/* Fuera de un obstáculo, con esa referencia no hay despeje que leer */
const away = await page.evaluate(() => {
  const r = profileChart.getBoundingClientRect(), lay = profileLayout;
  return { x: r.left + lay.xOf(lay.total * 0.02) * r.width / lay.W, y: r.top + r.height / 2 };
});
await page.mouse.move(away.x, away.y, { steps: 3 });
await frames();
const noObs = await page.evaluate(() => document.querySelector('#profile-info [data-k="clear"] .pf-info-val').textContent);
ok(noObs === "\u2014", "sin obstáculo bajo el cursor, «Despeje (Obstáculo)» queda en guiones: " + noObs);
await page.selectOption("#pf-ref", "mds");
await page.mouse.move(5, 5);

step("4.");
/* ---------- 4. Se guarda con el perfil, torres incluidas ---------- */
const mem = await page.evaluate(sel => {
  const p = findRouteProfile(routeProfileKey(measureWaypoints(eval(sel)._measure)));
  return p && { obstacles: p.obstacles.length, towers: JSON.stringify(p.towers) };
}, routeLi);
ok(mem && mem.obstacles === 2 && mem.towers === '{"a":{"at":0,"m":300},"b":{"at":2,"m":300}}',
  "el perfil guardado en la capa lleva los obstáculos y las torres: " + JSON.stringify(mem));
const rowsOnly = await page.evaluate(() => JSON.stringify(serializeTree()).includes('"towers":{"a":{"at":0,"m":300}'));
ok(rowsOnly, "y viaja en lo que se serializa");

await settle(900); /* guardado con retardo */
await page.reload();
await page.waitForFunction(() => typeof map === "object" && document.querySelector("#tree ul.node-list"));
const n1 = seen.length;
const reloaded = await page.evaluate(async sel => {
  const li = eval(sel);
  routeProfileCtxItem(li).action();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { obstacles: profileData.obstacles.map(o => o.name).sort().join(), a: profileTowerM.a, b: profileTowerM.b, at: JSON.stringify(profileTowerAt),
           blocks: document.querySelectorAll("#profile-chart .pf-obstacle").length,
           inputs: [document.getElementById("pf-tower-a").value, document.getElementById("pf-tower-b").value] };
}, routeLi);
ok(reloaded.obstacles === "Antena AMSL,Torre AGL" && reloaded.blocks >= 2, "tras recargar, «Mostrar perfil» trae los obstáculos: " + JSON.stringify(reloaded));
ok(reloaded.a === 300 && reloaded.b === 300 && reloaded.inputs.join() === "984.252,984.252",
  "y las torres del perfil (300 m, que con la unidad recién arrancada —pies— son 984,252): " + JSON.stringify(reloaded));
ok(seen.length === n1, "sin pedir nada");

/* Un cambio de torre DESPUÉS de recargar (la capa es un registro o una fila recién hecha) también se guarda */
await page.evaluate(() => {
  setAltitudeUnit("m"); /* tras recargar, la unidad vuelve a pies: se escribe en metros */
  const inp = document.getElementById("pf-tower-b");
  inp.value = "250";
  inp.dispatchEvent(new Event("change"));
});
await settle(900);
await page.reload();
await page.waitForFunction(() => typeof map === "object" && document.querySelector("#tree ul.node-list"));
const after2 = await page.evaluate(async sel => {
  routeProfileCtxItem(eval(sel)).action();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { a: profileTowerM.a, b: profileTowerM.b };
}, routeLi);
ok(after2.a === 300 && after2.b === 250, "una torre cambiada tras recargar también sobrevive a otra recarga: " + JSON.stringify(after2));

/* «Actualizar obstáculos»: lo visible AHORA, sin red. Se apaga la Antena. */
const refreshed = await page.evaluate(async sel => {
  const li = eval(sel); /* antes de cualquier await: la CSP no deja evaluar texto después */
  const before = profileData.obstacles.length;
  rootGroup.eachLayer(l => { if (profileObstacleName(l) === "Antena AMSL") { rootGroup.removeLayer(l); window.__antena = l; } });
  document.getElementById("pf-obstacles-refresh").click();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const prof = findRouteProfile(routeProfileKey(measureWaypoints(li._measure)));
  return { before, after: profileData.obstacles.map(o => o.name).join(), saved: prof.obstacles.length };
}, routeLi);
ok(refreshed.before === 2 && refreshed.after === "Torre AGL" && refreshed.saved === 1, "«Actualizar obstáculos» recoge lo visible ahora y lo guarda: " + JSON.stringify(refreshed));
ok(seen.length === n1, "sin red tampoco");
await page.evaluate(() => { rootGroup.addLayer(window.__antena); closeProfileDialog(); });

step("5.");
/* ---------- 5. El modo de altitud en la lista de puntos ---------- */
const pointsDialogFor = name => page.evaluate(async n => {
  let target = null;
  rootGroup.eachLayer(l => { if (profileObstacleName(l) === n) target = l; });
  const li = await resolveLayerLi(target);
  openStyleDialog(li);
  document.getElementById("pg-points").click();
  const sel = document.getElementById("points-altmode");
  return { row: !document.getElementById("points-altmode-row").hidden, value: sel.value,
           note: document.getElementById("points-altmode-note").hidden ? "" : document.getElementById("points-altmode-note").textContent };
}, name);
const modeOfLayer = name => page.evaluate(n => {
  let target = null;
  rootGroup.eachLayer(l => { if (profileObstacleName(l) === n) target = l; });
  let mode;
  const visit = l => { if (l instanceof L.Polygon) mode = featureAltMode(l.feature); else if (l.eachLayer) l.eachLayer(visit); };
  visit(target);
  return mode === undefined ? "?" : mode;
}, name);

let pd = await pointsDialogFor("Torre AGL");
ok(pd.row && pd.value === "agl" && pd.note === "", "el selector enseña el modo del KML (AGL): " + JSON.stringify(pd));
await page.selectOption("#points-altmode", "abs");
await page.click("#points-cancel");
ok(await modeOfLayer("Torre AGL") === "agl", "Cancelar no cambia nada");
await page.evaluate(() => document.getElementById("style-cancel").click());

pd = await pointsDialogFor("Torre AGL");
await page.selectOption("#points-altmode", "sea");
await page.click("#points-accept");
ok(await modeOfLayer("Torre AGL") === "sea", "Aceptar guarda el modo nuevo");
await page.evaluate(() => document.getElementById("style-cancel").click());
pd = await pointsDialogFor("Torre AGL");
ok(pd.value === "sea", "y al volver a abrir lo enseña: " + pd.value);
await page.click("#points-cancel .dlg-close, #points-dialog .dlg-close");
ok(await modeOfLayer("Torre AGL") === "sea", "la × cierra sin tocar (es Cancelar)");
await page.evaluate(() => document.getElementById("style-cancel").click());

/* Un polígono sin modo (el de «Sin altitud» no la tiene) enseña AMSL y, con
   los puntos sin altitud, la nota; abrir y aceptar no escribe un modo. */
pd = await pointsDialogFor("Sin altitud");
ok(pd.row && pd.value === "abs" && /Ningún punto tiene una altitud distinta de 0/.test(pd.note), "sin modo se enseña AMSL, y con puntos sin altitud la nota: " + JSON.stringify(pd));
await page.click("#points-accept");
ok(await modeOfLayer("Sin altitud") === null, "abrir y aceptar sin tocar no escribe un modo que el archivo no tenía");
await page.evaluate(() => document.getElementById("style-cancel").click());

/* Un GeoJSON con altitud: AMSL por defecto */
await page.evaluate(async () => {
  const gj = { type: "FeatureCollection", features: [{ type: "Feature", properties: null,
    geometry: { type: "Polygon", coordinates: [[[-3.70, 40.50, 120], [-3.69, 40.50, 120], [-3.69, 40.51, 120], [-3.70, 40.51, 120], [-3.70, 40.50, 120]]] } }] };
  await handleDroppedFiles([new File([JSON.stringify(gj)], "alto.geojson")]);
});
const gjDlg = await page.evaluate(async () => {
  let target = null;
  rootGroup.eachLayer(l => { if (l.getBounds && l.getBounds().getCenter().lat > 40.49) target = l; });
  const li = await resolveLayerLi(target);
  openStyleDialog(li);
  document.getElementById("pg-points").click();
  return { value: document.getElementById("points-altmode").value, row: !document.getElementById("points-altmode-row").hidden,
           note: !document.getElementById("points-altmode-note").hidden };
});
ok(gjDlg.row && gjDlg.value === "abs" && !gjDlg.note, "un GeoJSON con altitud se lee como AMSL por defecto: " + JSON.stringify(gjDlg));
await page.click("#points-cancel");
await page.evaluate(() => document.getElementById("style-cancel").click());

/* En una ruta (una línea) no hay selector */
const lineRow = await page.evaluate(sel => {
  const li = eval(sel);
  openStyleDialog(li);
  document.getElementById("ms-points").click();
  const r = document.getElementById("points-altmode-row").hidden;
  document.getElementById("points-cancel").click();
  document.getElementById("style-cancel").click();
  return r;
}, routeLi);
ok(lineRow, "en una ruta no hay selector de modo de altitud");

/* ---------- 6. Mover un vértice conserva las altitudes de TODOS ---------- */
step("6.");
/* Fallo reportado: al mover un vértice de un polígono con las alturas cambiadas, todos los
   vértices volvían a altura 0 (cloneLatLngRings tiraba la altitud y el primer arrastre volcaba
   esos anillos a la capa). Alturas distintas en cada vértice, para que no valga un valor único. */
const ALTS = [100, 200, 300, 400];
const kmlAlts = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Alturas</name>
<Placemark><name>Alturas distintas</name><Polygon><altitudeMode>absolute</altitudeMode><outerBoundaryIs><LinearRing><coordinates>
-3.70,40.500,100 -3.69,40.500,200 -3.69,40.510,300 -3.70,40.510,400 -3.70,40.500,100</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
</Document></kml>`;
await page.evaluate(async kml => { await handleDroppedFiles([new File([kml], "alturas.kml")]); }, kmlAlts);
const polyAlts = () => page.evaluate(() => {
  let top = null;
  rootGroup.eachLayer(l => { if (profileObstacleName(l) === "Alturas distintas") top = l; });
  let poly = null;
  const visit = l => { if (l instanceof L.Polygon) poly = l; else if (l.eachLayer) l.eachLayer(visit); };
  visit(top);
  return { alts: pathRings(poly).rings[0].map(p => p.alt), first: pathRings(poly).rings[0][0].lat,
           saved: (poly.toGeoJSON().geometry.coordinates[0] || []).map(c => c[2]) };
});
const openAlts = () => page.evaluate(async () => {
  let top = null;
  rootGroup.eachLayer(l => { if (profileObstacleName(l) === "Alturas distintas") top = l; });
  const li = await resolveLayerLi(top);
  map.setView(top.getBounds().getCenter(), 13, { animate: false });
  openStyleDialog(li);
  return vertexEdit ? vertexEdit.handleRings[0].length : 0;
});
const vertexPixel = i => page.evaluate(k => {
  const p = map.latLngToContainerPoint(vertexEdit.handleRings[0][k].getLatLng()), r = map.getContainer().getBoundingClientRect();
  return { x: r.left + p.x, y: r.top + p.y };
}, i);
const dragVertex = async (i, dx, dy) => {
  const a = await vertexPixel(i);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + dx / 2, a.y + dy / 2, { steps: 3 });
  await page.mouse.move(a.x + dx, a.y + dy, { steps: 3 });
  await page.mouse.up();
  await frames();
};

let before = await polyAlts();
ok(before.alts.join() === ALTS.join() + "," + ALTS[0] || before.alts.join() === ALTS.join(), "el polígono llega con sus cuatro altitudes: " + before.alts);
ok(await openAlts() >= 4, "la edición sobre el mapa está activa (un manejador por vértice)");
await dragVertex(1, 40, -30);
let after = await polyAlts();
ok(after.alts.slice(0, 4).join() === ALTS.join(), "tras mover un vértice con el ratón, los cuatro conservan su altitud: " + after.alts);
ok(after.saved.slice(0, 4).join() === ALTS.join(), "y lo que se guarda (toGeoJSON) también: " + after.saved);
await dragVertex(1, 40, -30);
await dragVertex(3, -30, 20);
after = await polyAlts();
ok(after.alts.slice(0, 4).join() === ALTS.join(), "varios arrastres seguidos tampoco la pierden: " + after.alts);

/* Un vértice nuevo entre dos con altitud toma la media de las suyas */
const inserted = await page.evaluate(() => {
  const h = vertexEdit.handleRings[0][0];
  insertVertexEditPoint(h, L.latLng(40.5, -3.695));
  return pathRings(vertexEdit.layer).rings[0].map(p => p.alt);
});
ok(inserted.join() === "100,150,200,300,400", "un vértice insertado entre 100 y 200 queda a 150: " + inserted);

/* Cancelar devuelve las cuatro altitudes originales (la foto también las llevaba) */
await page.click("#style-cancel");
await frames();
after = await polyAlts();
ok(after.alts.slice(0, 4).join() === ALTS.join() && after.alts.filter(x => x !== undefined).length >= 4,
  "Cancelar revierte los cambios Y conserva las altitudes: " + after.alts);

/* Aceptar deja lo movido, con sus altitudes */
await openAlts();
await dragVertex(2, 25, 25);
await page.click("#style-accept");
await frames();
after = await polyAlts();
ok(after.alts.slice(0, 4).join() === ALTS.join(), "Aceptar deja el vértice movido y las altitudes: " + after.alts);
const movedBack = await page.evaluate(() => JSON.stringify(serializeTree()).includes('"Alturas distintas"'));
ok(movedBack, "y la capa está en lo que se serializa");

ok(errors.length === 0, "sin errores de página: " + errors.join(" | "));
await browser.close();
srv.close();
done();
