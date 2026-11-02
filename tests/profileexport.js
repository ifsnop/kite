/* Exportar el perfil de ruta (63-route-profile.js): el CSV, puro. La
   imagen PNG y las dos descargas reales las cubre elev-profile.mjs.     */
const { fn, between, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const api = new Function("const EARTH_R = 6371000;\n"
  + between("/* ---------- Línea de vista y curvatura terrestre", "/* Zoom del eje de ALTURAS") + "\n" + fn("nearestProfilePoint")
  + "\n" + fn("profileCsv") + "\n" + between("const CSV_DEFAULT", "const toCsv") + "\n" + constDecl("toCsv")
  + "\n" + fn("csvDialect")
  + "\nreturn { profileCsv, csvCell, toCsv, csvDialect, profileLinkModel, PF_FRESNEL_ZONE };")();
const { profileCsv, csvCell, toCsv, csvDialect, profileLinkModel, PF_FRESNEL_ZONE } = api;

const NM = 1852, FT = 0.3048;
const data = {
  series: [
    { kind: "mdt", label: "MDT25 (IGN)", points: [{ d: 0, v: 1000 }, { d: 25, v: 1010 }, { d: 50, v: null }, { d: 75, v: 1030.5 }] },
    { kind: "mds", label: "MDS (IGN)", points: [{ d: 0, v: 1005 }, { d: 5, v: 1006 }, { d: 50, v: 1020 }, { d: 75, v: 1040 }] }
  ]
};
/* Una ruta recta al este desde (40, -3): cada metro son 1e-5 grados de longitud */
const locate = d => ({ lat: 40, lng: -3 + d * 1e-5 });
const units = { distFactor: 1, altFactor: 1, altDecimals: 1, distLabel: "m", altLabel: "m" };
const lines = text => text.replace(/^﻿/, "").split("\r\n");

const csv = profileCsv(data, units, locate);
ok(csv.startsWith("﻿"), "con BOM para Excel");
const L = lines(csv);
ok(L[0] === "Distancia (m),Latitud,Longitud,MDT (m),MDS (m)", "cabecera con la unidad de cada columna: " + L[0]);
ok(L.at(-1) === "" && csv.endsWith("\r\n"), "CRLF y salto final");
ok(L.slice(1, -1).map(r => r.split(",")[0]).join() === "0,5,25,50,75", "una fila por distancia de CUALQUIER serie, en orden: " + L.slice(1, -1).map(r => r.split(",")[0]));
ok(L[1] === "0,40,-3,1000,1005", "la distancia 0, con las dos series: " + L[1]);
ok(L[2] === "5,40,-2.99995,,1006", "donde solo hay MDS, el MDT vacío (nunca un 0): " + L[2]);
ok(L[3] === "25,40,-2.99975,1010,", "y al revés");
ok(L[4] === "50,40,-2.9995,,1020", "un hueco del servicio (v null) sigue siendo un hueco: " + L[4]);
ok(L[5] === "75,40,-2.99925,1030.5,1040", "decimales de la altura: " + L[5]);

/* Unidades: NM y pies */
const nm = lines(profileCsv({ series: [{ kind: "mdt", label: "x", points: [{ d: 1852, v: 304.8 }, { d: 3704, v: 3048 }] }] },
  { distFactor: NM, altFactor: FT, altDecimals: 1, distLabel: "NM", altLabel: "ft" }, locate));
ok(nm[0] === "Distancia (NM),Latitud,Longitud,MDT (ft)", "la cabecera sigue las unidades: " + nm[0]);
ok(nm[1].startsWith("1,40,") && nm[1].endsWith(",1000") && nm[2].startsWith("2,40,") && nm[2].endsWith(",10000"), "1852 m = 1 NM y 304,8 m = 1000 ft: " + nm[1] + " | " + nm[2]);
const km = lines(profileCsv({ series: [{ kind: "mds", label: "x", points: [{ d: 12.34567, v: 2500 }] }] },
  { distFactor: 1000, altFactor: 1000, altDecimals: 4, distLabel: "km", altLabel: "km" }, locate));
ok(km[1].split(",")[0] === "0.01235" && km[1].endsWith(",2.5"), "km con 5 decimales de distancia y 4 de altura: " + km[1]);

/* Sin posición, sin series, valores raros */
const noPos = lines(profileCsv({ series: [{ kind: "mdt", label: "x", points: [{ d: 10, v: 5 }] }] }, units, () => null));
ok(noPos[1] === "10,,,5", "sin posición, latitud y longitud vacías: " + noPos[1]);
const empty = profileCsv({ series: [] }, units, locate);
ok(lines(empty).length === 2 && lines(empty)[0] === "Distancia (m),Latitud,Longitud", "sin series, solo la cabecera");
const weird = lines(profileCsv({ series: [{ kind: "mdt", label: "x", points: [{ d: 1, v: NaN }, { d: 2, v: Infinity }, { d: 3, v: "7" }, { d: 4, v: 0 }] }] }, units, locate));
ok(weird.slice(1, 5).map(r => r.split(",").pop()).join("|") === "|||0", "NaN, infinito y texto son huecos; el 0 verdadero es un 0: " + weird.slice(1, 5).map(r => r.split(",").pop()));
ok(!/e[+-]\d/.test(csv), "nunca notación científica");
const many = { series: [{ kind: "mdt", label: "x", points: Array.from({ length: 5000 }, (_, i) => ({ d: i * 5, v: i })) },
  { kind: "mds", label: "y", points: Array.from({ length: 5000 }, (_, i) => ({ d: i * 5 + 2.5, v: i })) }] };
ok(lines(profileCsv(many, units, locate)).length === 10002, "10 000 distancias distintas, 10 002 líneas con la cabecera y el salto final");

/* ---------- Dialecto según el idioma de la interfaz ----------
   Inglés: coma entre campos y punto decimal. Español: punto y coma entre
   campos y coma decimal (lo que Excel espera con esa configuración regional).
   Sin dialecto, como siempre (coma y punto).                              */
const EN = csvDialect("en"), ES = csvDialect("es");
ok(JSON.stringify(EN) === '{"sep":",","decimal":"."}', "inglés: coma y punto: " + JSON.stringify(EN));
ok(JSON.stringify(ES) === '{"sep":";","decimal":","}', "español: punto y coma y coma decimal: " + JSON.stringify(ES));
ok(csvDialect("en-GB").sep === ",", "una variante del inglés sigue siendo coma y punto");
ok(csvDialect("fr").sep === ";" && csvDialect("de").sep === ";" && csvDialect("ja").sep === ",", "un idioma con coma decimal usa punto y coma (fr, de); uno con punto, la coma");
ok(csv === profileCsv(data, units, locate, EN), "inglés = el CSV de siempre");

const es = lines(profileCsv(data, units, locate, ES));
ok(es[0] === "Distancia (m);Latitud;Longitud;MDT (m);MDS (m)", "español: la cabecera va con punto y coma: " + es[0]);
ok(es[1] === "0;40;-3;1000;1005", "enteros sin cambio: " + es[1]);
ok(es[2] === "5;40;-2,99995;;1006", "la longitud con coma decimal y los huecos vacíos: " + es[2]);
ok(es[5] === "75;40;-2,99925;1030,5;1040", "decimales de la altura con coma: " + es[5]);
ok(es.slice(0, -1).every(r => r.split(";").length === 5), "cinco campos en cada fila: ninguna coma decimal parte un campo");
const esKm = lines(profileCsv({ series: [{ kind: "mds", label: "x", points: [{ d: 12.34567, v: 2500 }] }] },
  { distFactor: 1000, altFactor: 1000, altDecimals: 4, distLabel: "km", altLabel: "km" }, locate, ES));
ok(esKm[1].split(";")[0] === "0,01235" && esKm[1].endsWith(";2,5"), "km con coma decimal: " + esKm[1]);
ok(!/\d\.\d/.test(es.slice(1).join("\n")), "en español no queda ningún punto decimal en los datos");
ok(es.join("").startsWith("Distancia") && profileCsv(data, units, locate, ES).startsWith("﻿"), "con BOM también");

/* Las celdas: solo un NÚMERO se reescribe; un texto es lo que es; se entrecomilla lo que contiene el separador del dialecto */
ok(csvCell(1.5, ES) === "1,5" && csvCell(1.5, EN) === "1.5" && csvCell(-0.25, ES) === "-0,25", "números con la marca del dialecto");
ok(csvCell("1.5", ES) === "1.5", "un texto con aspecto de número no se toca");
ok(csvCell("a;b", ES) === '"a;b"' && csvCell("a,b", ES) === "a,b", "en español se entrecomilla el punto y coma, no la coma");
ok(csvCell("a,b", EN) === '"a,b"' && csvCell("a;b", EN) === "a;b", "en inglés se entrecomilla la coma, no el punto y coma");
ok(csvCell("=1+1", ES) === "'=1+1", "la defensa contra fórmulas sigue igual");
ok(toCsv(["a", "b"], [[1.5, "x"]], ES) === "a;b\r\n1,5;x\r\n", "toCsv con el dialecto español");

/* ---------- Torres, línea de vista y Fresnel 60 % ----------
   Una ruta de 10 km con las torres en los extremos (10 m y 5 m sobre el
   terreno), el MDS a 100 m en todo el trayecto. `link` se arma como lo hace
   profileCsvLink (63-route-profile.js): altitud de la recta menos la
   elevación de la Tierra, y el radio al 60 %.                             */
const flat = { series: [{ kind: "mds", label: "x", points: [0, 2500, 5000, 7500, 10000].map(d => ({ d, v: 100 })) }] };
const verts = [0, 5000, 10000];
const mkLink = (mode, opts = {}) => {
  const o = { at: { a: 0, b: null }, towerM: { a: 10, b: 5 }, curveMode: mode, showLos: true, showFresnel: true, freqMHz: 1090, ...opts };
  const m = profileLinkModel(flat.series, verts, o);
  return { dA: m.dA, dB: m.dB, showLos: o.showLos, showFresnel: o.showFresnel,
    altitude: d => m.losAt(d) - m.lift(d), radius: d => PF_FRESNEL_ZONE * m.fresnel(d), model: m };
};
const withLink = (mode, opts) => lines(profileCsv(flat, units, locate, undefined, mkLink(mode, opts)));

const T = withLink("none");
ok(T[0] === "Distancia (m),Latitud,Longitud,MDS (m),Torre,Línea de vista (m),Fresnel 60 % inferior (m),Fresnel 60 % superior (m)", "cabecera con las columnas nuevas: " + T[0]);
ok(T.slice(1, -1).map(r => r.split(",")[4]).join("") === "10002", "la columna Torre: 1 en el inicio, 2 en el final, 0 en el resto: " + T.slice(1, -1).map(r => r.split(",")[4]).join(""));
ok(T[1].split(",").slice(0, 6).join(",") === "0,40,-3,100,1,110", "la torre de inicio: su fila, la antena a 100 + 10 m (en ese punto hay un valor del MDS): " + T[1]);
const lastRow = T[T.length - 2].split(",");
ok(lastRow[0] === "10000" && lastRow[4] === "2" && lastRow[5] === "105", "la torre final y su antena a 100 + 5 m: " + T[T.length - 2]);
/* Entre las torres, la recta sube/baja de 110 a 105 */
const mid = T.find(r => r.startsWith("5000,")).split(",");
ok(Number(mid[5]) === 107.5 && mid[4] === "0", "en el centro, la recta a medio camino: " + mid.join(","));
const r60 = PF_FRESNEL_ZONE * Math.sqrt(299792458 / 1090e6 * 5000 * 5000 / 10000);
ok(Math.abs(Number(mid[6]) - (107.5 - r60)) < 0.06 && Math.abs(Number(mid[7]) - (107.5 + r60)) < 0.06, `Fresnel al 60 % a ±${r60.toFixed(2)} m de la recta: ${mid[6]} y ${mid[7]}`);
ok(Number(mid[6]) < Number(mid[5]) && Number(mid[5]) < Number(mid[7]), "el inferior por debajo de la recta y el superior por encima");
const ends = [T[1], T[T.length - 2]].map(r => r.split(","));
ok(ends[0][6] === "110" && ends[0][7] === "110" && ends[1][6] === "105" && ends[1][7] === "105", "en las antenas Fresnel vale lo que la recta (radio 0)");

/* Torres en vértices intermedios: aparecen filas nuevas en su distancia exacta, fuera de ellas Fresnel vacío y la recta, prolongada */
const inner = withLink("none", { at: { a: 1, b: 2 } });
const iRows = inner.slice(1, -1).map(r => r.split(","));
ok(iRows.find(r => r[0] === "5000")[4] === "1" && iRows.find(r => r[0] === "10000")[4] === "2", "torres en el vértice 1 y el 2: la 1 en 5000 m y la 2 en 10000 m");
const first = iRows[0];
ok(first[0] === "0" && first[4] === "0" && first[6] === "" && first[7] === "" && Number(first[5]) > 0, "antes de la torre de inicio: Fresnel vacío y la recta prolongada: " + first.join(","));
ok(iRows.every(r => r.length === 8), "ocho campos en cada fila (los huecos, vacíos)");

/* Solo la recta, solo Fresnel, ninguno */
const onlyLos = withLink("none", { showFresnel: false });
ok(onlyLos[0] === "Distancia (m),Latitud,Longitud,MDS (m),Torre,Línea de vista (m)", "solo la recta: sin columnas de Fresnel: " + onlyLos[0]);
const onlyFr = withLink("none", { showLos: false });
ok(onlyFr[0] === "Distancia (m),Latitud,Longitud,MDS (m),Torre,Fresnel 60 % inferior (m),Fresnel 60 % superior (m)", "solo Fresnel: sin la recta: " + onlyFr[0]);
const plain = profileCsv(flat, units, locate);
ok(plain === profileCsv(flat, units, locate, undefined, null) && !plain.includes("Torre"), "sin recta ni Fresnel, el CSV de siempre (sin torres ni filas nuevas)");
ok(lines(plain).length === 7, "y con las filas de las series y nada más: " + lines(plain).length);

/* La curvatura no cambia lo que se exporta: la recta, en el marco del terreno */
for (const mode of ["classic", "flat", "origin"]) {
  const L = withLink(mode);
  ok(L[1].split(",")[5] === "110" && L[L.length - 2].split(",")[5] === "105", `${mode}: en las antenas, la altitud de la antena (el despeje no depende del modo)`);
  const m = mkLink(mode);
  const none = mkLink("none");
  ok(m.altitude(5000) < none.altitude(5000), `${mode}: con la curvatura de la Tierra la recta, en el marco del terreno, queda por debajo de la plana`);
}
ok(Math.abs(mkLink("classic").altitude(5000) - mkLink("flat").altitude(5000)) < 1e-9 && Math.abs(mkLink("classic").altitude(5000) - mkLink("origin").altitude(5000)) < 1e-9,
  "los tres modos dan la MISMA altitud de la recta (cambia el dibujo, no el despeje)");
const bulge = 5000 * 5000 / (2 * (4 / 3) * 6371000);
ok(Math.abs(mkLink("classic").altitude(5000) - (107.5 - bulge)) < 1e-6, `con k = 4/3, a mitad de camino la recta baja ${bulge.toFixed(3)} m: ${mkLink("classic").altitude(5000)}`);

/* En español: punto y coma, coma decimal y los mismos datos */
const esL = lines(profileCsv(flat, units, locate, ES, mkLink("none")));
ok(esL[0].split(";").length === 8 && esL[1] === "0;40;-3;100;1;110;110;110", "español con las columnas nuevas: " + esL[1]);
ok(esL.find(r => r.startsWith("5000;")).split(";")[5] === "107,5", "la altitud de la recta con coma decimal");

/* Una altitud no finita (sin datos para la recta) es un hueco, no un 0 */
const noGround = { dA: 0, dB: 10000, showLos: true, showFresnel: true, altitude: () => NaN, radius: () => 1 };
const ng = lines(profileCsv(flat, units, locate, undefined, noGround));
ok(ng[1].split(",").slice(5).join(",") === ",,", "sin altitud de la recta, las celdas vacías: " + ng[1]);

if (!process.exitCode) console.log("PROFILE EXPORT TESTS OK");
