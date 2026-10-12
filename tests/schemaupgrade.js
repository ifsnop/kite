/* upgradeMeasuresV6: la ÚNICA excepción a «lo que no corresponda a la
   versión actual se borra, no se migra» (TREE_SCHEMA v7 — measure.a/b
   se convierte en measure.waypoints). Función PURA de recorrido del
   árbol serializado: no toca IndexedDB ni el DOM, así que se prueba
   aislada sobre árboles de ejemplo.                                   */
const { fn } = require("./_extract");
const api = new Function(fn("upgradeMeasuresV6") + "\nreturn {upgradeMeasuresV6};")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const A = { lat: 40, lng: -3 }, B = { lat: 41, lng: -2 };

/* ---------- Caso simple: una medición suelta en la raíz ---------- */
{
  const nodes = [
    { t: "measure", name: "Línea 1", checked: true, mtype: "line", style: {}, a: A, b: B }
  ];
  const up = api.upgradeMeasuresV6(nodes);
  ok(up === nodes, "muta y devuelve el MISMO array, como cualquier función de recorrido del proyecto");
  const m = up[0];
  ok(Array.isArray(m.waypoints) && m.waypoints.length === 2, "a/b se convierte en un array de 2: " + JSON.stringify(m.waypoints));
  ok(m.waypoints[0] === A && m.waypoints[1] === B, "en el mismo orden: origen, destino");
  ok(m.a === undefined && m.b === undefined, "a/b desaparecen: no quedan los dos formatos a la vez");
  ok(m.name === "Línea 1" && m.checked === true && m.mtype === "line",
    "el resto del registro no se toca: " + JSON.stringify({ name: m.name, checked: m.checked, mtype: m.mtype }));
}

/* ---------- Un círculo (mismo tratamiento, sin mirar mtype) ---------- */
{
  const nodes = [{ t: "measure", name: "Círculo 1", checked: false, mtype: "circle", style: {}, a: A, b: B }];
  api.upgradeMeasuresV6(nodes);
  ok(nodes[0].waypoints.length === 2, "un círculo también sube: 2 puntos (centro y borde)");
}

/* ---------- Anidada en carpetas, a varios niveles ---------- */
{
  const nodes = [
    { t: "folder", name: "Mediciones", checked: true, collapsed: false, children: [
      { t: "measure", name: "Línea 1", checked: true, mtype: "line", style: {}, a: A, b: B },
      { t: "folder", name: "Sub", checked: true, collapsed: true, children: [
        { t: "measure", name: "Línea 2", checked: true, mtype: "line", style: {}, a: B, b: A }
      ] }
    ] },
    { t: "layer", name: "Otra capa", checked: true, style: null, geo: { type: "Point" } }
  ];
  api.upgradeMeasuresV6(nodes);
  const outer = nodes[0].children[0];
  const inner = nodes[0].children[1].children[0];
  ok(Array.isArray(outer.waypoints) && outer.waypoints.length === 2, "medición de primer nivel dentro de una carpeta");
  ok(Array.isArray(inner.waypoints) && inner.waypoints.length === 2,
    "y una anidada dos niveles más adentro, dentro de una carpeta colapsada");
  ok(nodes[1].t === "layer" && nodes[1].waypoints === undefined,
    "un nodo t:\"layer\" no se toca: no tiene a/b que subir");
}

/* ---------- Idempotente: un árbol ya en v7 no se altera ---------- */
{
  const already = { t: "measure", name: "Ruta 1", checked: true, mtype: "route", style: {},
    waypoints: [A, B, { lat: 42, lng: -1 }] };
  const nodes = [already];
  api.upgradeMeasuresV6(nodes);
  ok(nodes[0] === already && nodes[0].waypoints.length === 3,
    "un registro que YA tiene waypoints se deja tal cual, aunque no tenga a/b: " + JSON.stringify(nodes[0].waypoints));
  ok(nodes[0].a === undefined && nodes[0].b === undefined, "no se inventan a/b donde no los había");
}

/* ---------- Árbol vacío / sin mediciones: no explota ---------- */
{
  ok(JSON.stringify(api.upgradeMeasuresV6([])) === "[]", "árbol vacío, sin problema");
  const onlyLayers = [{ t: "layer", name: "X", checked: true, style: null, geo: {} }];
  api.upgradeMeasuresV6(onlyLayers);
  ok(onlyLayers.length === 1 && onlyLayers[0].waypoints === undefined, "sin mediciones, no toca nada");
}

if (!process.exitCode) console.log("SCHEMA UPGRADE TESTS OK");
