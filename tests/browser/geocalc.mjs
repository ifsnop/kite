/* Calculadora geodésica (botón 📐, ventana flotante, una pestaña por
   cálculo): «Ángulo de elevación» (con cono de silencio y corrección de
   la altura de destino por presión) y «Vector GPS».

   Comprobado con la interfaz de verdad (clics, teclado, selectores),
   porque lo que Node no puede decir es lo que ve quien la usa: que el
   botón esté tras 🏷️, que las unidades sean las de Propiedades en su
   mismo orden, que cada campo guarde la suya y convierta su valor, que
   el resultado salga SOLO, en cuanto hay datos y sin botón, que no haga
   crecer la ventana y que esta no sea modal.

   Los valores esperados se calculan aquí aparte, con fórmulas escritas
   de otra forma (vector al objetivo contra la horizontal del observador,
   ley de los cosenos para la oblicua, fórmulas cerradas por capa de la
   atmósfera), no llamando a las funciones de la aplicación.           */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER GEOCALC TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8903);
const { page, errors } = await openApp(browser, srv.url);

const R = 6371000, M_FT = 0.3048, M_NM = 1852, MI = 1609.344;
const txt = id => page.textContent("#" + id);
const val = id => page.inputValue("#" + id);
const resultText = () => txt("geocalc-elev-result");
const errShown = id => page.evaluate(i => !document.getElementById(i).hidden, id);

/* Elevación con el vector al objetivo (distancia de SUPERFICIE) */
function surfaceDeg(h1, h2, d, Re) {
  const th = d / Re, ox = 0, oy = Re + h1, tx = (Re + h2) * Math.sin(th), ty = (Re + h2) * Math.cos(th);
  return Math.atan2(ty - oy, tx - ox) * 180 / Math.PI;
}
/* Elevación con distancia OBLICUA: ley de los cosenos para el ángulo central */
function slantDeg(h1, h2, s, Re) {
  const r1 = Re + h1, r2 = Re + h2, th = Math.acos((r1 * r1 + r2 * r2 - s * s) / (2 * r1 * r2));
  return Math.atan2(r2 * Math.cos(th) - r1, r2 * Math.sin(th)) * 180 / Math.PI;
}
/* Atmósfera estándar: constantes definitorias y fórmulas cerradas por capa */
const ISA = { p0: 1013.25, T0: 288.15, L: 0.0065, g: 9.80665, M: 0.0289644, Rg: 8.31432 };
const HS = ISA.Rg * (ISA.T0 - ISA.L * 11000) / (ISA.g * ISA.M);       /* altura de escala isoterma, m */
const H0 = ISA.T0 / ISA.L;                                              /* 44330.77 m */
const trueAltStrato = (alt, q) => alt + HS * Math.log(q / ISA.p0);      /* alt > 11 km, resultado > 11 km */
const trueAltTropo = (alt, q) => H0 * (1 - (ISA.p0 / q) ** 0.190263 * (1 - alt / H0)); /* todo bajo 11 km */
const lines = (...l) => l.join("\n");
const elevText = deg => lines(`Ángulo de elevación: ${deg.toFixed(3)}°`, `Cono de silencio: ${(90 - deg).toFixed(3)}°`);

/* ---------- Botón tras Propiedades, ventana cerrada al arrancar ---------- */
const layout = await page.evaluate(() => ({
  btns: [...document.querySelectorAll("#nav-panel h1 button")].map(b => b.id),
  hidden: document.getElementById("geocalc-dialog").hidden
}));
ok(layout.btns.indexOf("geocalc-btn") === layout.btns.indexOf("gnp-editor-btn") + 1,
  "el botón 📐 va justo detrás de Propiedades: " + layout.btns.join(","));
ok(layout.hidden, "la ventana arranca cerrada");

/* ---------- Estructura: dos pestañas, sin la del cono y sin botón «Calcular» ---------- */
await page.click("#geocalc-btn");
const opened = await page.evaluate(() => {
  const opts = id => [...document.getElementById(id).options].map(o => o.value + "|" + o.textContent);
  const box = document.querySelector("#geocalc-dialog .dlg-box");
  const dlg = document.getElementById("geocalc-dialog");
  return {
    visible: !dlg.hidden,
    tabs: [...dlg.querySelectorAll(".dlg-tab")].map(b => b.textContent),
    actions: [...dlg.querySelectorAll(".dlg-actions button")].map(b => b.textContent),
    coneIds: [...dlg.querySelectorAll("[id^='cone-'], #geocalc-tab-cone, #geocalc-calc")].length,
    hasBlanco: /blanco/i.test(dlg.textContent),
    props: opts("props-unit"), h1: opts("geocalc-h1-unit"), h2: opts("geocalc-h2-unit"), d: opts("geocalc-d-unit"),
    units: ["geocalc-h1-unit", "geocalc-h2-unit", "geocalc-d-unit"].map(id => document.getElementById(id).value),
    model: document.getElementById("geocalc-model").value, kind: document.getElementById("geocalc-dkind").value,
    p: document.getElementById("geocalc-p").value,
    modal: box.getAttribute("aria-modal"), role: box.getAttribute("role"),
    labelled: !!document.getElementById(box.getAttribute("aria-labelledby")),
    tabSelected: document.getElementById("geocalc-tab-btn-elev").getAttribute("aria-selected")
  };
});
ok(opened.visible, "📐 abre la ventana");
ok(opened.tabs.join("|") === "Ángulo de elevación|Vector GPS", "solo dos pestañas, sin «Cono de silencio»: " + opened.tabs.join("|"));
ok(opened.coneIds === 0 && !opened.hasBlanco, "no queda rastro de la pestaña del cono (ni ids ni el texto «blanco»)");
ok(opened.actions.join("|") === "Cerrar", "el pie solo tiene «Cerrar»; ya no hay «Calcular»: " + opened.actions.join("|"));
ok(JSON.stringify(opened.h1) === JSON.stringify(opened.props) && JSON.stringify(opened.h2) === JSON.stringify(opened.props)
  && JSON.stringify(opened.d) === JSON.stringify(opened.props), "las unidades de los tres campos son las de Propiedades, en su orden");
ok(opened.units.join() === "ft,ft,nm", "primera apertura con NM global: alturas en pies, distancia en NM — " + opened.units.join());
ok(opened.model === "refr" && opened.kind === "slant", `modelo por defecto esfera + 4/3 y distancia oblicua: ${opened.model} / ${opened.kind}`);
ok(opened.p === "1013.25", "la presión parte en la estándar, 1013.25 hPa (no 1013.1): " + opened.p);
ok(opened.modal === "false" && opened.role === "dialog" && opened.labelled, "ARIA: diálogo no modal con título");
ok(opened.tabSelected === "true", "la pestaña de ángulo de elevación está activa");
ok(await resultText() === "" && !(await errShown("geocalc-error")), "sin datos: ni resultado ni aviso");

/* ---------- Cálculo inmediato: aparece en cuanto hay datos, sin botón ---------- */
await page.selectOption("#geocalc-h1-unit", "m");
await page.selectOption("#geocalc-h2-unit", "ft");
await page.selectOption("#geocalc-d-unit", "nm");
await page.fill("#geocalc-h1", "24.21");
ok(await resultText() === "" && !(await errShown("geocalc-error")), "con solo un dato: sin resultado y SIN aviso (faltan datos, no hay error)");
ok(await page.evaluate(() => !document.querySelector("#geocalc-tab-elev .bad")), "ni campos marcados en rojo mientras faltan datos");
await page.fill("#geocalc-h2", "45000");
await page.fill("#geocalc-d", "12.2");

/* ---------- Caso reportado: 24,21 m, 45000 ft, 12,2 NM → ~37° como oblicua, ~31° como superficie ---------- */
const H2 = 45000 * M_FT, S = 12.2 * M_NM, RE = R * 4 / 3;
const reported = slantDeg(24.21, H2, S, RE);
ok(await resultText() === elevText(reported), `al completar el último dato aparece solo, con ángulo y cono: «${await resultText()}» esperado ${reported.toFixed(3)}°`);
ok(Math.round(reported) === 37 && Math.round(90 - reported) === 53, "…~37° de elevación y ~53° de cono, como las otras aplicaciones");
await page.selectOption("#geocalc-dkind", "surface");
const asSurface = surfaceDeg(24.21, H2, S, RE);
ok(await resultText() === elevText(asSurface) && Math.round(asSurface) === 31, "como distancia de superficie, los ~31° de antes: " + await resultText());
await page.selectOption("#geocalc-dkind", "slant");
await page.selectOption("#geocalc-model", "flat");
const flat = Math.asin((H2 - 24.21) / S) * 180 / Math.PI;
ok(await resultText() === elevText(flat), "plano y oblicua: asin(Δh/d) — " + await resultText());
ok(Math.abs(flat - reported) < 0.15, "el modelo de Tierra apenas mueve el resultado a esta distancia (<0,15°)");
await page.selectOption("#geocalc-model", "sphere");
ok(await resultText() === elevText(slantDeg(24.21, H2, S, R)), "esfera sin refracción: " + await resultText());
await page.selectOption("#geocalc-model", "refr");
ok(await resultText() === elevText(reported), "y de vuelta a esfera + 4/3 el resultado vuelve al anterior, al instante");

/* ---------- Cada cambio se refleja al momento ---------- */
await page.fill("#geocalc-d", "20");
ok(await resultText() === elevText(slantDeg(24.21, H2, 20 * M_NM, RE)), "cambiar la distancia recalcula al instante");
await page.fill("#geocalc-d", "12.2");
await page.fill("#geocalc-h1", "100");
ok(await resultText() === elevText(slantDeg(100, H2, S, RE)), "y la altura de origen");
await page.fill("#geocalc-h1", "24.21");

/* ---------- Cambiar la unidad convierte el valor y no mueve el resultado ---------- */
const before = await resultText();
await page.selectOption("#geocalc-h2-unit", "m");
ok(await val("geocalc-h2") === "13716", "45000 ft en metros: 13716 — " + await val("geocalc-h2"));
ok(await val("geocalc-h1") === "24.21" && await val("geocalc-d") === "12.2", "y los otros campos no se tocan");
ok(await resultText() === before, "el resultado es el mismo con la altitud en metros (sin pasar por un valor intermedio erróneo)");
await page.selectOption("#geocalc-d-unit", "km");
ok(await val("geocalc-d") === "22.5944", "12.2 NM en km: 22.5944 — " + await val("geocalc-d"));
ok(await resultText() === before, "y con la distancia en km");
await page.selectOption("#geocalc-d-unit", "nm");
await page.selectOption("#geocalc-h2-unit", "ft");
ok(await val("geocalc-h2") === "45000" && await val("geocalc-d") === "12.2" && await resultText() === before,
  "ida y vuelta sin restos de coma flotante");

/* ---------- Presión: corrige SOLO la altura de destino ---------- */
ok(!(await resultText()).includes("corregida"), "con la presión estándar no hay línea de altura corregida");
await page.fill("#geocalc-p", "1030");
{
  const h2c = trueAltStrato(H2, 1030), delta = h2c - H2;
  const want = lines(elevText(slantDeg(24.21, h2c, S, RE)),
    `Altura de destino corregida: ${(h2c / M_FT).toFixed(2)} ft (+${(delta / M_FT).toFixed(2)} ft)`);
  ok(await resultText() === want, `QNH 1030 a 45000 ft (estratosfera): «${await resultText()}» esperado «${want}»`);
  ok(delta / M_FT > 300 && delta / M_FT < 380, "…unos +341 ft, no los ~500 ft de «30 ft/hPa × 16,75 hPa»: " + (delta / M_FT).toFixed(1));
}
await page.fill("#geocalc-p", "1000");
{
  const h2c = trueAltStrato(H2, 1000), delta = h2c - H2;
  ok(await resultText() === lines(elevText(slantDeg(24.21, h2c, S, RE)),
    `Altura de destino corregida: ${(h2c / M_FT).toFixed(2)} ft (${(delta / M_FT).toFixed(2)} ft)`),
  "QNH 1000: la aeronave está más baja de lo que marca, con signo negativo: " + await resultText());
}
/* La altura de destino se muestra en SU unidad */
await page.selectOption("#geocalc-h2-unit", "m");
ok((await resultText()).split("\n")[2].includes(" m ("), "la altura corregida sale en la unidad de la altura de destino: " + (await resultText()).split("\n")[2]);
await page.selectOption("#geocalc-h2-unit", "ft");
/* Troposfera: otra capa, otra fórmula cerrada */
await page.fill("#geocalc-h2", "3000");
await page.fill("#geocalc-p", "1030");
{
  const a = 3000 * M_FT, h2c = trueAltTropo(a, 1030);
  ok(await resultText() === lines(elevText(slantDeg(24.21, h2c, S, RE)),
    `Altura de destino corregida: ${(h2c / M_FT).toFixed(2)} ft (+${((h2c - a) / M_FT).toFixed(2)} ft)`),
  "troposfera, 3000 ft con QNH 1030: " + await resultText());
  ok((h2c - a) / M_FT > 400 && (h2c - a) / M_FT < 450, "…unos +440 ft (26 ft/hPa a esa altitud): " + ((h2c - a) / M_FT).toFixed(1));
}
/* El origen NO se corrige: mismas alturas, 10 km, plano, superficie → solo cuenta lo que se sube el destino */
await page.selectOption("#geocalc-h1-unit", "m"); await page.selectOption("#geocalc-h2-unit", "m"); await page.selectOption("#geocalc-d-unit", "km");
await page.selectOption("#geocalc-model", "flat"); await page.selectOption("#geocalc-dkind", "surface");
await page.fill("#geocalc-h1", "1000"); await page.fill("#geocalc-h2", "1000"); await page.fill("#geocalc-d", "10");
await page.fill("#geocalc-p", "1013.25");
ok((await resultText()).startsWith("Ángulo de elevación: 0.000°"), "alturas iguales con presión estándar: 0°: " + await resultText());
await page.fill("#geocalc-p", "1030");
{
  const delta = trueAltTropo(1000, 1030) - 1000, want = Math.atan2(delta, 10000) * 180 / Math.PI;
  ok((await resultText()).startsWith(`Ángulo de elevación: ${want.toFixed(3)}°`) && want > 0,
    `con QNH 1030 solo sube el destino (la antena no se corrige): «${(await resultText()).split("\n")[0]}» esperado ${want.toFixed(3)}°`);
}
await page.selectOption("#geocalc-model", "refr"); await page.selectOption("#geocalc-dkind", "slant");
await page.fill("#geocalc-p", "1013.25");

/* ---------- Errores: presión fuera de rango, fuera de la atmósfera estándar, distancias imposibles ---------- */
await page.fill("#geocalc-p", "10");
ok(await errShown("geocalc-error") && /800 y 1100/.test(await txt("geocalc-error")) && await resultText() === ""
  && await page.evaluate(() => document.getElementById("geocalc-p").classList.contains("bad")),
"presión de 10 hPa: aviso con el rango, campo de presión marcado y sin resultado");
await page.fill("#geocalc-p", "");
ok(!(await errShown("geocalc-error")) && await resultText() === "", "presión vacía: sin aviso (faltan datos) y sin resultado");
await page.fill("#geocalc-p", "1013.25");
await page.fill("#geocalc-d", "100");     /* 100 km: la oblicua tiene que ser ≥ Δh (30 km) */
await page.fill("#geocalc-h2", "30000");  /* 30 km: fuera de la atmósfera estándar, pero con la presión estándar no se corrige */
ok(!(await errShown("geocalc-error")) && (await resultText()).startsWith("Ángulo de elevación"), "30 km con la presión estándar: sin corrección, se calcula");
await page.fill("#geocalc-p", "1000");
ok(await errShown("geocalc-error") && /atmósfera estándar/.test(await txt("geocalc-error"))
  && await page.evaluate(() => document.getElementById("geocalc-h2").classList.contains("bad") && !document.getElementById("geocalc-p").classList.contains("bad")),
"30 km con otra presión: no se puede corregir; el aviso señala la altura de destino, no la presión");
await page.fill("#geocalc-h2", "3000");
ok(!(await errShown("geocalc-error")) && await page.evaluate(() => !document.querySelector("#geocalc-tab-elev .bad")), "al corregir el dato, desaparecen aviso y marcas");
await page.fill("#geocalc-p", "1013.25");
await page.selectOption("#geocalc-h1-unit", "m"); await page.selectOption("#geocalc-h2-unit", "m"); await page.selectOption("#geocalc-d-unit", "m");
await page.selectOption("#geocalc-model", "flat");
await page.fill("#geocalc-h1", "0"); await page.fill("#geocalc-h2", "100"); await page.fill("#geocalc-d", "50");
ok(await errShown("geocalc-error") && /oblicua/.test(await txt("geocalc-error")) && await resultText() === "", "oblicua 50 con Δh 100: imposible, aviso");
await page.fill("#geocalc-d", "100");
ok(await resultText() === elevText(90), "oblicua = Δh: la aeronave en la vertical, 90° de elevación y 0° de cono: " + await resultText());
await page.fill("#geocalc-d", "-5");
ok(await errShown("geocalc-error") && await page.evaluate(() => document.getElementById("geocalc-d").classList.contains("bad")), "distancia negativa: aviso y campo marcado");
await page.selectOption("#geocalc-model", "refr");
await page.fill("#geocalc-d", "100");

/* ---------- Mismo tamaño de letra que los campos; la ventana no crece al calcular ---------- */
const boxH = () => page.evaluate(() => document.querySelector("#geocalc-dialog .dlg-box").getBoundingClientRect().height);
const fontOf = id => page.evaluate(i => getComputedStyle(document.getElementById(i)).fontSize, id);
ok(await fontOf("geocalc-elev-result") === await fontOf("geocalc-h1") && await fontOf("geocalc-elev-result") === await fontOf("geocalc-p"),
  "el resultado tiene la letra de los campos numéricos: " + await fontOf("geocalc-elev-result") + " / " + await fontOf("geocalc-h1"));
{
  /* vacío, con resultado de 2 líneas, con resultado de 3 (presión) y con aviso: misma altura */
  await page.fill("#geocalc-d", "");
  const empty = await boxH();
  await page.fill("#geocalc-d", "1000");  /* oblicua ≥ Δh incluso con la altura corregida (+139 m) */
  const two = await boxH();
  await page.fill("#geocalc-p", "1030"); await page.fill("#geocalc-h2", "100");
  const three = await boxH();
  ok((await resultText()).split("\n").length === 3, "(el resultado con presión tiene tres líneas)");
  await page.fill("#geocalc-d", "-1");
  const withError = await boxH();
  ok([two, three, withError].every(h => Math.abs(h - empty) < 0.5),
    `ángulo de elevación: la ventana mide lo mismo vacía, con 2 líneas, con 3 y con aviso — ${empty} / ${two} / ${three} / ${withError}`);
  await page.fill("#geocalc-p", "1013.25");
  await page.fill("#geocalc-d", "100");
}

/* ======================= Pestaña «Vector GPS» ======================= */
await page.click("#geocalc-tab-btn-gps");
const gpsTab = await page.evaluate(() => ({
  visible: !document.getElementById("geocalc-tab-gps").hidden,
  elevHidden: document.getElementById("geocalc-tab-elev").hidden,
  selected: ["elev", "gps"].map(k => document.getElementById("geocalc-tab-btn-" + k).getAttribute("aria-selected")).join(),
  units: ["gps-alt1-unit", "gps-alt2-unit", "gps-d-unit"].map(id => document.getElementById(id).value).join(),
  same: ["gps-alt1-unit", "gps-alt2-unit", "gps-d-unit"].every(id =>
    [...document.getElementById(id).options].map(o => o.value + "|" + o.textContent).join() ===
    [...document.getElementById("props-unit").options].map(o => o.value + "|" + o.textContent).join())
}));
ok(gpsTab.visible && gpsTab.elevHidden && gpsTab.selected === "false,true", "la pestaña del vector GPS se muestra y la otra se oculta (aria-selected)");
ok(gpsTab.units === "m,m,nm", "unidades de partida: altitudes en m y distancia del resultado en millas náuticas — " + gpsTab.units);
ok(gpsTab.same, "las unidades del vector GPS también son las de Propiedades, en su orden");
{
  const r = await page.evaluate(() => { const b = document.getElementById("geocalc-close").getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: innerHeight }; });
  ok(r.top >= 0 && r.bottom <= r.h, "«Cerrar» a la vista en la pestaña alta: " + JSON.stringify(r));
}

/* Madrid → Barcelona (650 m y 12 m), los valores de partida */
const A = { lat: 40.4168, lng: -3.7038, alt: 650 };
const B = { lat: 41.3874, lng: 2.1686, alt: 12 };
function ecef(p) {
  const f = p.lat * Math.PI / 180, l = p.lng * Math.PI / 180, r = R + p.alt;
  return [r * Math.cos(f) * Math.cos(l), r * Math.cos(f) * Math.sin(l), r * Math.sin(f)];
}
const a3 = ecef(A), b3 = ecef(B), d3 = b3.map((v, i) => v - a3[i]);
const fa = A.lat * Math.PI / 180, la = A.lng * Math.PI / 180;
const east = [-Math.sin(la), Math.cos(la), 0], north = [-Math.sin(fa) * Math.cos(la), -Math.sin(fa) * Math.sin(la), Math.cos(fa)];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const wantSlantM = Math.hypot(...d3);
const wantBrg = (Math.atan2(dot(d3, east), dot(d3, north)) * 180 / Math.PI + 360) % 360;
const A0 = ecef({ ...A, alt: 0 }), B0 = ecef({ ...B, alt: 0 });
const cr = [A0[1] * B0[2] - A0[2] * B0[1], A0[2] * B0[0] - A0[0] * B0[2], A0[0] * B0[1] - A0[1] * B0[0]];
const wantHorM = R * Math.atan2(Math.hypot(...cr), dot(A0, B0));
const gpsIn = (unitM, label) => lines(`Distancia: ${(wantSlantM / unitM).toFixed(3)} ${label}`,
  `Distancia horizontal: ${(wantHorM / unitM).toFixed(3)} ${label}`, `Orientación: ${wantBrg.toFixed(3)}°`);

/* Valores de partida: Madrid en A y Barcelona en B, en GMS — y el resultado YA está, sin tocar nada */
const start = await page.evaluate(() => Object.fromEntries(
  ["gps-lat1", "gps-lng1", "gps-alt1", "gps-lat2", "gps-lng2", "gps-alt2", "gps-coord-format"].map(id => [id, document.getElementById(id).value])));
ok(start["gps-coord-format"] === "dms", "el formato de partida es GMS: " + start["gps-coord-format"]);
ok(start["gps-lat1"] === `40° 25' 00.48" N` && start["gps-lng1"] === `3° 42' 13.68" W`,
  "A parte en Madrid, en GMS: " + start["gps-lat1"] + " / " + start["gps-lng1"]);
ok(start["gps-lat2"] === `41° 23' 14.64" N` && start["gps-lng2"] === `2° 10' 06.96" E`,
  "B parte en Barcelona, en GMS: " + start["gps-lat2"] + " / " + start["gps-lng2"]);
ok(start["gps-alt1"] === "650" && start["gps-alt2"] === "12", "con sus altitudes de partida: " + start["gps-alt1"] + " / " + start["gps-alt2"]);
ok(await txt("gps-result") === gpsIn(M_NM, "NM"), `el vector GPS inicial sale solo al abrir la pestaña, en NM: «${await txt("gps-result")}» esperado «${gpsIn(M_NM, "NM")}»`);

/* Latitud y longitud EN LA MISMA LÍNEA (y la longitud a la derecha de la latitud) */
const sameLine = await page.evaluate(() => {
  const r = id => document.getElementById(id).getBoundingClientRect();
  return ["1", "2"].map(n => { const la = r("gps-lat" + n), lo = r("gps-lng" + n);
    return { dy: Math.abs((la.top + la.bottom) / 2 - (lo.top + lo.bottom) / 2), right: lo.left >= la.right - 1 }; });
});
ok(sameLine.every(l => l.dy < 2 && l.right), "latitud y longitud comparten línea, con la longitud a la derecha: " + JSON.stringify(sameLine));

/* La unidad del resultado y las de las altitudes actúan al instante */
await page.selectOption("#gps-d-unit", "mi");
ok(await txt("gps-result") === gpsIn(MI, "mi"), "cambiar la unidad de la distancia repinta el resultado: " + await txt("gps-result"));
await page.selectOption("#gps-d-unit", "km");
ok((await txt("gps-result")).startsWith(`Distancia: ${(wantSlantM / 1000).toFixed(3)} km`), "y en kilómetros");
await page.selectOption("#gps-d-unit", "nm");
await page.selectOption("#gps-alt1-unit", "ft");
ok(Math.abs(Number(await val("gps-alt1")) - 650 / M_FT) < 1e-6, "650 m en pies: " + await val("gps-alt1"));
ok(await val("gps-alt2") === "12" && await txt("gps-result") === gpsIn(M_NM, "NM"), "la altitud B no se toca y el resultado no cambia al convertir la unidad");
await page.selectOption("#gps-alt1-unit", "m");
ok(await val("gps-alt1") === "650", "ida y vuelta a metros: 650");
await page.fill("#gps-alt2", "2000");
ok(await txt("gps-result") !== gpsIn(M_NM, "NM"), "cambiar una altitud recalcula al instante");
await page.fill("#gps-alt2", "12");
ok(await txt("gps-result") === gpsIn(M_NM, "NM"), "y volver al valor, también");

/* ---------- Selector GMS / decimal: convierte lo escrito ---------- */
await page.selectOption("#gps-coord-format", "dec");
const dec = await page.evaluate(() => Object.fromEntries(["gps-lat1", "gps-lng1", "gps-lat2", "gps-lng2", "gps-alt1", "gps-alt2"].map(id => [id, document.getElementById(id).value])));
ok(dec["gps-lat1"] === "40.416800" && dec["gps-lng1"] === "-3.703800" && dec["gps-lat2"] === "41.387400" && dec["gps-lng2"] === "2.168600",
  "a decimal, las cuatro coordenadas se convierten (el mismo punto): " + JSON.stringify(dec));
ok(dec["gps-alt1"] === "650" && dec["gps-alt2"] === "12", "y las altitudes no se tocan");
ok(await txt("gps-result") === gpsIn(M_NM, "NM"), "el resultado es el mismo con las coordenadas en decimal");
await page.selectOption("#gps-coord-format", "dms");
const back = await page.evaluate(() => Object.fromEntries(["gps-lat1", "gps-lng1", "gps-lat2", "gps-lng2"].map(id => [id, document.getElementById(id).value])));
ok(back["gps-lat1"] === start["gps-lat1"] && back["gps-lng1"] === start["gps-lng1"] && back["gps-lat2"] === start["gps-lat2"] && back["gps-lng2"] === start["gps-lng2"],
  "y de vuelta a GMS recupera exactamente lo de partida: " + JSON.stringify(back));
/* Lo ilegible se respeta; lo legible escrito en el otro formato se normaliza */
await page.fill("#gps-lat1", "abc");
ok(await errShown("gps-error") && await txt("gps-result") === "" && await page.evaluate(() => document.getElementById("gps-lat1").classList.contains("bad")),
  "una latitud ilegible: aviso, campo marcado y sin resultado");
await page.fill("#gps-lng1", "-3.7038");  /* decimal, con el formato en GMS */
await page.selectOption("#gps-coord-format", "dec");
ok(await val("gps-lat1") === "abc", "un campo ilegible se deja como está al cambiar de formato");
ok(await val("gps-lng1") === "-3.703800", "uno legible escrito en el otro formato se normaliza: " + await val("gps-lng1"));
await page.selectOption("#gps-coord-format", "dms");
ok(await val("gps-lng1") === start["gps-lng1"], "y vuelve a GMS: " + await val("gps-lng1"));
await page.fill("#gps-lat1", start["gps-lat1"]);
ok(await txt("gps-result") === gpsIn(M_NM, "NM") && !(await errShown("gps-error")), "al corregir el campo, el resultado vuelve solo y el aviso se va");

/* GMS escrito a mano, sin espacios y con el hemisferio pegado */
await page.fill("#gps-lat2", `41°23'14.64"N`);
await page.fill("#gps-lng2", `2°10'6.96"E`);
ok(await txt("gps-result") === gpsIn(M_NM, "NM"), "GMS sin espacios: mismo resultado: " + await txt("gps-result"));

/* Datos incompletos: sin resultado ni aviso; mismo punto: orientación «no definida» */
await page.fill("#gps-lat2", "");
ok(await txt("gps-result") === "" && !(await errShown("gps-error")) && await page.evaluate(() => !document.querySelector("#geocalc-tab-gps .bad")),
  "con un campo vacío: sin resultado, sin aviso y sin marcas");
await page.fill("#gps-lat2", "40.4168"); await page.fill("#gps-lng2", "-3.7038");
const same = await txt("gps-result");
ok(same.includes("Orientación: no definida") && !same.includes("0.000°"), "mismos lat/lon: «no definida» y no 0°: " + same);
await page.fill("#gps-lat2", "95");
ok(await errShown("gps-error") && await page.evaluate(() => document.getElementById("gps-lat2").classList.contains("bad")) && await txt("gps-result") === "",
  "latitud 95°: aviso, campo marcado y sin resultado");
await page.fill("#gps-lat2", `41°23'14.64"N`); await page.fill("#gps-lng2", `2°10'6.96"E`);
ok(await txt("gps-result") === gpsIn(M_NM, "NM"), "y al corregirla, el resultado vuelve");

/* La ventana del vector GPS tampoco crece al calcular */
{
  const full = await boxH();
  await page.fill("#gps-lat1", "");
  const empty = await boxH();
  await page.fill("#gps-lat1", "95");
  const err = await boxH();
  await page.fill("#gps-lat1", start["gps-lat1"]);
  ok(Math.abs(full - empty) < 0.5 && Math.abs(full - err) < 0.5, `vector GPS: misma altura con resultado, vacío y con aviso — ${full} / ${empty} / ${err}`);
  ok(await fontOf("gps-result") === await fontOf("gps-lat1") && await fontOf("gps-result") === await fontOf("gps-alt1"),
    "y su resultado tiene la letra de los campos de texto y numéricos");
}

/* ---------- Cada pestaña conserva lo suyo al ir y volver ---------- */
await page.click("#geocalc-tab-btn-elev");
ok((await resultText()).startsWith("Ángulo de elevación"), "volver a la primera pestaña: su resultado sigue ahí");
await page.click("#geocalc-tab-btn-gps");
ok((await txt("gps-result")).startsWith("Distancia:"), "y el del vector GPS");

/* ---------- No es modal; se arrastra; Escape cierra; se conserva lo escrito ---------- */
const nonModal = await page.evaluate(() => {
  const r = document.getElementById("map").getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + 80);
  return { inDialog: !!(el && el.closest("#geocalc-dialog")), overlay: !!document.querySelector("#geocalc-dialog.dlg-overlay") };
});
ok(!nonModal.inDialog && !nonModal.overlay, "el centro del mapa no está tapado por la ventana: " + JSON.stringify(nonModal));
const head = await page.locator("#geocalc-dialog h2").boundingBox();
const boxBefore = await page.locator("#geocalc-dialog .dlg-box").boundingBox();
await page.mouse.move(head.x + 20, head.y + 8);
await page.mouse.down();
await page.mouse.move(head.x - 120, head.y - 100, { steps: 6 });
await page.mouse.up();
const boxAfter = await page.locator("#geocalc-dialog .dlg-box").boundingBox();
ok(Math.abs(boxAfter.x - boxBefore.x) > 50 || Math.abs(boxAfter.y - boxBefore.y) > 50, "arrastrar el título la mueve");
/* Ya arrastrada (fijada por arriba), la pestaña alta no saca el pie de la pantalla */
await page.click("#geocalc-tab-btn-elev");
await page.click("#geocalc-tab-btn-gps");
{
  const r = await page.evaluate(() => { const b = document.getElementById("geocalc-close").getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: innerHeight }; });
  ok(r.top >= 0 && r.bottom <= r.h, "tras arrastrarla, la pestaña alta deja «Cerrar» a la vista: " + JSON.stringify(r));
}
await page.keyboard.press("Escape");
ok(await page.evaluate(() => document.getElementById("geocalc-dialog").hidden), "Escape cierra la ventana");
await page.click("#geocalc-btn");
ok(await page.evaluate(() => !document.getElementById("geocalc-dialog").hidden), "📐 la vuelve a abrir");
ok((await txt("gps-result")).startsWith("Distancia:") && await val("gps-lat1") === start["gps-lat1"],
  "al reabrir, conserva lo escrito y el resultado ya está calculado");
await page.click("#geocalc-tab-btn-elev");
ok(await val("geocalc-p") === "1013.25" && await val("geocalc-d") === "100", "y la pestaña de elevación, lo suyo");
await page.click("#geocalc-close");
ok(await page.evaluate(() => document.getElementById("geocalc-dialog").hidden), "«Cerrar» cierra la ventana");

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
