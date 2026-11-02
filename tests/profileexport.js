/* Exportar el perfil de ruta (63-route-profile.js): el CSV, puro. La
   imagen PNG y las dos descargas reales las cubre elev-profile.mjs.     */
const { fn, between, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const api = new Function(fn("profileCsv") + "\n" + between("const csvCell", "const toCsv") + "\n" + constDecl("toCsv")
  + "\nreturn { profileCsv };")();
const { profileCsv } = api;

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

if (!process.exitCode) console.log("PROFILE EXPORT TESTS OK");
