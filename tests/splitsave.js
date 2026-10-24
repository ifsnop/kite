/* Guardado en dos niveles (32-geojson.js, DB_VERSION v5): el "root" es
   un esqueleto y lo pesado de cada hoja va a segmentos. Se prueba lo
   PURO: repartir, volver a juntar, qué segmentos borrar o fundir al
   arrancar y cómo se reescriben sus referencias. Lo que de verdad
   protege de perder datos es que la ida y vuelta sea EXACTA y que una
   carga se reconozca por la identidad de su objeto, así que casi todo
   aquí compara `serializeTree()` antes y después.                    */
const { between } = require("./_extract");
const api = new Function(between("const HEAVY_FIELDS", "/* Lo ya escrito en \"segments\"")
  + "\nreturn { heavyPart, newPayloadIndex, payloadRef, rememberPayload, splitPayloads, commitPayloads,"
  + " skeletonRefs, segmentPlan, compactSegments, joinPayloads, SEG_SMALL };")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* Comparación sin depender del orden de las claves: joinPayloads devuelve
   los campos pesados al final del registro.                          */
const canon = x => Array.isArray(x) ? x.map(canon)
  : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canon(x[k])])) : x;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
/* Lo que hace IndexedDB al guardar y leer: una copia estructurada */
const disk = v => structuredClone(v);

const geoA = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-3, 40, 650] } }] };
const geoB = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] };
const cells = [{ lat: 40, lng: -3, mdt: 650 }];
const tree = () => [
  { name: "Archivo", checked: true, t: "file", collapsed: false, children: [
    { name: "A", checked: true, t: "layer", style: { color: "#f00" }, geo: geoA, desc: "<b>ficha A</b>" },
    { name: "B", checked: false, t: "layer", style: null, geo: geoB, mstyle: { icon: "x" } },
    { name: "Sub", checked: false, t: "folder", collapsed: true, children: [
      { name: "Elev", checked: true, t: "elevGrid", cells },
      { name: "Img", checked: true, t: "imageOverlay", box: { south: 1, west: 2, north: 3, east: 4 }, dataUrl: "data:image/png;base64,AAAA", opacity: 0.5 },
      { name: "Ruta", checked: true, t: "measure", mtype: "route", style: {}, waypoints: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }] }
    ] }
  ] }
];

/* ---------- Ida y vuelta exacta ---------- */
{
  const known = api.newPayloadIndex();
  const nodes = tree();
  const out = api.splitPayloads(nodes, known, "s1", new Set());
  ok(out.entries.length === 4, "cuatro cargas: dos capas, una cuadrícula y una imagen: " + out.entries.length);
  const leafs = api.skeletonRefs(out.skeleton);
  ok(leafs.length === 4, "cuatro hojas con referencia en el esqueleto");
  const flat = JSON.stringify(out.skeleton);
  ok(!/"geo"|"desc"|"cells"|"dataUrl"/.test(flat), "el esqueleto no lleva ningún campo pesado");
  ok(/"waypoints"/.test(flat) && /"mstyle"/.test(flat) && /"box"/.test(flat) && /"opacity"/.test(flat),
    "lo ligero (waypoints, mstyle, box, opacity) se queda en el esqueleto");
  ok(nodes[0].children[0].geo === geoA, "repartir no toca los registros de entrada");
  const segs = new Map([["s1", disk(out.entries)]]);
  const back = disk(out.skeleton);
  const missing = api.joinPayloads(back, segs);
  ok(missing === 0, "nada perdido");
  ok(same(back, tree()), "ida y vuelta EXACTA, campos y valores");
  ok(back[0].children[1].desc === undefined, "una capa sin ficha no gana un `desc` vacío");
}

/* ---------- Un segundo guardado sin cambios no escribe nada pesado ---------- */
{
  const known = api.newPayloadIndex();
  const nodes = tree();
  const o1 = api.splitPayloads(nodes, known, "s1", new Set());
  api.commitPayloads(known, o1);
  const o2 = api.splitPayloads(nodes, known, "s2", new Set(["s1"]));
  ok(o2.entries.length === 0, "mismas cargas: segmento vacío (" + o2.entries.length + ")");
  ok(same(o1.skeleton, o2.skeleton), "y el mismo esqueleto");
}

/* ---------- Sin commit (la transacción falló), se reescribe ---------- */
{
  const known = api.newPayloadIndex();
  const nodes = tree();
  api.splitPayloads(nodes, known, "s1", new Set());
  const o2 = api.splitPayloads(nodes, known, "s2", new Set(["s1"]));
  ok(o2.entries.length === 4, "lo no confirmado se vuelve a escribir: " + o2.entries.length);
}

/* ---------- Auto-reparación: su segmento ya no está ---------- */
{
  const known = api.newPayloadIndex();
  const nodes = tree();
  api.commitPayloads(known, api.splitPayloads(nodes, known, "s1", new Set()));
  const o2 = api.splitPayloads(nodes, known, "s2", new Set()); /* s1 lo borró otra pestaña */
  ok(o2.entries.length === 4 && api.skeletonRefs(o2.skeleton).every(n => n.p[0] === "s2"),
    "si el segmento conocido ya no existe, la carga va al segmento nuevo");
}

/* ---------- Cambios: solo lo cambiado entra en el segmento nuevo ---------- */
{
  const known = api.newPayloadIndex();
  const nodes = tree();
  api.commitPayloads(known, api.splitPayloads(nodes, known, "s1", new Set()));
  /* invalidateGeo + toGeoJSON: OBJETO nuevo con otra geometría */
  nodes[0].children[0].geo = structuredClone(geoA);
  nodes[0].children[0].geo.features[0].geometry.coordinates = [-4, 41];
  const o2 = api.splitPayloads(nodes, known, "s2", new Set(["s1"]));
  ok(o2.entries.length === 1 && o2.entries[0].geo.features[0].geometry.coordinates[0] === -4,
    "mover un marcador escribe solo su geometría (con su ficha)");
  ok(o2.entries[0].desc === "<b>ficha A</b>", "la ficha viaja con la geometría nueva");
  /* misma geometría, otra ficha */
  nodes[0].children[1].desc = "nueva";
  const o3 = api.splitPayloads(nodes, known, "s3", new Set(["s1", "s2"]));
  ok(o3.entries.some(e => e.desc === "nueva"), "cambiar solo la ficha también es una carga nueva");
}

/* ---------- Copiar dos veces: cargas compartidas, y editar una copia ---------- */
{
  const known = api.newPayloadIndex();
  const nodes = tree();
  const copy = structuredClone(nodes[0].children[0]);
  copy.geo = geoA; /* pegar reutiliza el MISMO objeto del portapapeles */
  nodes[0].children.push(copy, { ...copy });
  const o1 = api.splitPayloads(nodes, known, "s1", new Set());
  const refs = api.skeletonRefs(o1.skeleton).filter(n => n.name === "A");
  ok(refs.length === 3 && refs.every(n => n.p === refs[0].p), "tres nodos con la misma carga comparten UNA entrada");
  ok(o1.entries.length === 4, "y no se duplica: " + o1.entries.length);
  api.commitPayloads(known, o1);
  /* se edita la geometría de UNA copia */
  nodes[0].children[3].geo = structuredClone(geoB);
  const o2 = api.splitPayloads(nodes, known, "s2", new Set(["s1"]));
  const refs2 = api.skeletonRefs(o2.skeleton).filter(n => n.name === "A");
  ok(refs2[0].p[0] === "s1" && refs2[2].p[0] === "s1" && refs2[1].p[0] === "s2",
    "la copia editada va al segmento nuevo y las otras dos siguen en el suyo");
  const segs = new Map([["s1", disk(o1.entries)], ["s2", disk(o2.entries)]]);
  const back = disk(o2.skeleton);
  api.joinPayloads(back, segs);
  ok(same(back, nodes), "y la ida y vuelta conserva las tres, cada una con su geometría");
  /* misma geometría, fichas distintas: dos entradas */
  const twins = [{ name: "x", checked: true, t: "layer", style: null, geo: geoA, desc: "uno" },
                 { name: "y", checked: true, t: "layer", style: null, geo: geoA, desc: "dos" }];
  const o3 = api.splitPayloads(twins, api.newPayloadIndex(), "s9", new Set());
  ok(o3.entries.length === 2, "misma geometría y distinta ficha: dos cargas");
}

/* ---------- Borrar y mover no tocan las cargas ---------- */
{
  const known = api.newPayloadIndex();
  const nodes = tree();
  api.commitPayloads(known, api.splitPayloads(nodes, known, "s1", new Set()));
  const sub = nodes[0].children.pop();      /* mover la carpeta Sub… */
  nodes.unshift(sub);                        /* …a la raíz, delante */
  nodes[1].children.splice(0, 1);            /* y borrar la capa A */
  const o2 = api.splitPayloads(nodes, known, "s2", new Set(["s1"]));
  ok(o2.entries.length === 0, "mover y borrar solo cambian el esqueleto");
  const back = disk(o2.skeleton);
  api.joinPayloads(back, new Map([["s1", disk(api.splitPayloads(tree(), api.newPayloadIndex(), "s1", new Set()).entries)]]));
  ok(same(back, nodes), "y lo leído es el árbol movido, con sus geometrías");
}

/* ---------- Un "root" v8 con todo en línea pasa tal cual ---------- */
{
  const v8 = disk(tree());
  const seen = [];
  const missing = api.joinPayloads(v8, new Map(), (k, d, r) => seen.push(r));
  ok(missing === 0 && same(v8, tree()), "un árbol de antes de los segmentos se lee sin cambios");
  ok(seen.length === 0, "y no se siembra nada: el primer guardado lo reparte entero");
}

/* ---------- Lo que falta se quita y se cuenta ---------- */
{
  const out = api.splitPayloads(tree(), api.newPayloadIndex(), "s1", new Set());
  const entries = disk(out.entries);
  entries[1] = undefined;                       /* una entrada perdida */
  const back = disk(out.skeleton);
  const missing = api.joinPayloads(back, new Map([["s1", entries]]));
  ok(missing === 1, "una entrada que falta cuenta como perdida: " + missing);
  ok(back[0].children.length === 2 && back[0].children.every(n => n.name !== "B"), "y esa hoja sale del árbol");
  const back2 = disk(out.skeleton);
  ok(api.joinPayloads(back2, new Map()) === 4, "sin el segmento entero: las cuatro hojas perdidas");
  ok(back2[0].children.length === 1 && back2[0].children[0].children.length === 1,
    "y quedan carpetas y la medición, que no dependen de ningún segmento");
  /* Una entrada de otro tipo no vale: no se pinta una capa sin geometría */
  const back3 = disk(out.skeleton);
  const bad = disk(out.entries); bad[0] = { cells: [] };
  ok(api.joinPayloads(back3, new Map([["s1", bad]])) === 1, "una entrada que no es de su tipo se descarta");
}

/* ---------- Siembra del índice al leer ---------- */
{
  const known0 = api.newPayloadIndex();
  const out = api.splitPayloads(tree(), known0, "s1", new Set());
  const back = disk(out.skeleton);
  const known = api.newPayloadIndex();
  api.joinPayloads(back, new Map([["s1", disk(out.entries)]]),
    (k, d, r) => api.rememberPayload(known, k, d, r));
  const o2 = api.splitPayloads(back, known, "s2", new Set(["s1"]));
  ok(o2.entries.length === 0, "tras leer, el primer guardado no reescribe nada pesado: " + o2.entries.length);
}

/* ---------- Plan de segmentos al arrancar ---------- */
{
  const BIG = api.SEG_SMALL + 6;
  const sk = [{ t: "folder", children: [
    ...Array.from({ length: BIG }, (_, i) => ({ t: "layer", p: ["big", i] })),
    { t: "layer", p: ["half", 0] },
    { t: "layer", p: ["tiny1", 0] }, { t: "layer", p: ["tiny2", 0] }
  ] }];
  const sizes = new Map([["big", BIG], ["half", 3], ["tiny1", 1], ["tiny2", 2], ["dead", 5]]);
  const plan = api.segmentPlan(sk, sizes);
  ok(plan.drop.length === 1 && plan.drop[0] === "dead", "un segmento que nadie nombra se borra");
  ok(!plan.compact.includes("big"), "uno grande y sano no se toca");
  ok(plan.compact.includes("half"), "uno con más muertas que vivas se funde");
  ok(plan.compact.includes("tiny1") && plan.compact.includes("tiny2"), "varios pequeños se funden");
  const lone = api.segmentPlan([{ t: "layer", p: ["only", 0] }], new Map([["only", 1]]));
  ok(lone.compact.length === 0 && lone.drop.length === 0, "un único segmento pequeño se deja: no hay con quién fundirlo");
  ok(api.segmentPlan([], new Map([["a", 1], ["b", 1]])).drop.length === 2, "sin árbol, todo sobra");
}

/* ---------- Fundir conserva lo vivo y las referencias compartidas ---------- */
{
  const sk = [
    { t: "layer", name: "a", p: ["s1", 1] }, { t: "layer", name: "b", p: ["s1", 1] },
    { t: "layer", name: "c", p: ["s2", 0] }, { t: "layer", name: "d", p: ["keep", 0] }
  ];
  const segs = new Map([
    ["s1", [{ geo: { n: 0 } }, { geo: { n: 1 } }, { geo: { n: 2 } }]],
    ["s2", [{ geo: { n: 3 } }]],
    ["keep", [{ geo: { n: 4 } }]]
  ]);
  const entries = api.compactSegments(sk, segs, ["s1", "s2"], "new");
  ok(entries.length === 2, "solo lo vivo pasa al segmento nuevo: " + entries.length);
  ok(sk[0].p === sk[1].p && sk[0].p[0] === "new", "dos hojas con la misma ref siguen compartiéndola");
  ok(sk[3].p[0] === "keep", "lo que no se funde no cambia de sitio");
  segs.delete("s1"); segs.delete("s2"); segs.set("new", entries);
  api.joinPayloads(sk, segs);
  ok(sk.map(n => n.geo.n).join() === "1,1,3,4", "y cada hoja recupera su carga: " + sk.map(n => n.geo && n.geo.n).join());
}

if (!process.exitCode) console.log("SPLIT SAVE TESTS OK");
