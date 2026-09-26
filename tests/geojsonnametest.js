const { fn, between, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* ---------- Elegir la propiedad-nombre (Fase 1) ---------- */
const nameSrc = between("const GEOJSON_TYPES = new Set(", "async function buildGeoJsonRecords");
const { geojsonFeatures, needsNamePicker, propsFingerprint, resolveFeatureName } =
  new Function(nameSrc + "\nreturn {geojsonFeatures, needsNamePicker, propsFingerprint, resolveFeatureName};")();

// geojsonFeatures
ok(geojsonFeatures({ type: "FeatureCollection", features: [{ type: "Feature" }] }).length === 1,
  "FeatureCollection: devuelve su array de features");
ok(geojsonFeatures({ type: "FeatureCollection" }).length === 0,
  "FeatureCollection sin features: array vacío, no lanza");
ok(geojsonFeatures({ type: "Feature", properties: {} })[0].type === "Feature",
  "Feature suelto: se envuelve en un array de un elemento");
ok(geojsonFeatures({ type: "Point", coordinates: [0, 0] })[0].geometry.type === "Point",
  "geometría suelta: se envuelve como Feature con properties vacío");
let threw = false;
try { geojsonFeatures({ type: "Bogus" }); } catch { threw = true; }
ok(threw, "tipo desconocido: lanza");
threw = false;
try { geojsonFeatures(null); } catch { threw = true; }
ok(threw, "no es un objeto: lanza");

// needsNamePicker
ok(needsNamePicker({}) === false, "properties vacío: no hace falta preguntar");
ok(needsNamePicker({ name: "x" }) === false, "con name: no hace falta preguntar");
ok(needsNamePicker({ title: "x" }) === false, "con title: no hace falta preguntar");
ok(needsNamePicker({ ref: "A-04" }) === true, "solo otras claves: hace falta preguntar");
ok(needsNamePicker(null) === false, "no-objeto: no hace falta preguntar");

// propsFingerprint
ok(propsFingerprint({ a: 1, b: 2 }) === propsFingerprint({ b: 99, a: "x" }),
  "mismas claves en distinto orden: misma huella");
ok(propsFingerprint({ a: 1 }) !== propsFingerprint({ b: 1 }),
  "claves distintas: huella distinta");
ok(propsFingerprint({}) === "[]", "sin claves: huella estable");

// resolveFeatureName
ok(resolveFeatureName({ ref: "A-04" }, 0, "ref") === "A-04",
  "usa la propiedad elegida cuando está presente");
ok(resolveFeatureName({ tipo: "urbano" }, 2, "ref") === "Elemento 3",
  "si el feature no tiene la clave elegida, cae en el nombrado automático");
ok(resolveFeatureName({ name: "Casa" }, 0, "ref") === "Casa",
  "nameProp elegido pero ausente en este feature: cae en name");
ok(resolveFeatureName({ name: "Casa" }, 0, null) === "Casa",
  "sin nameProp, usa name como siempre");
ok(resolveFeatureName({ title: "Casa" }, 0, null) === "Casa",
  "sin nameProp ni name, usa title como siempre");
ok(resolveFeatureName({}, 4, null) === "Elemento 5",
  "sin nada, cae en Elemento N (1-based)");

/* ---------- Tabla de properties (Fase 3) ---------- */
const propSrc = between("const escapeHtml = s =>", "function infoHtmlFor");
const { stringifyPropValue, propertiesTableHtml } =
  new Function(propSrc + "\nreturn {stringifyPropValue, propertiesTableHtml};")();

ok(stringifyPropValue(null) === "" && stringifyPropValue(undefined) === "",
  "null/undefined se muestran vacíos");
ok(stringifyPropValue({ a: 1 }) === '{"a":1}', "objeto anidado: JSON.stringify");
ok(stringifyPropValue([1, 2]) === "[1,2]", "array anidado: JSON.stringify");
ok(stringifyPropValue(42) === "42" && stringifyPropValue(true) === "true",
  "número/booleano: String(v)");

let tableHtml = propertiesTableHtml({ ref: "A-04", tipo: "urbano" });
ok((tableHtml.match(/<tr>/g) || []).length === 2, "una fila por propiedad");
ok(tableHtml.includes("<td>ref</td>") && tableHtml.includes("<td>A-04</td>"),
  "clave y valor en la fila: " + tableHtml);
tableHtml = propertiesTableHtml({ mal: "<script>alert(1)</script>" });
ok(!tableHtml.includes("<script>"), "escapa entrada hostil en el valor: " + tableHtml);
tableHtml = propertiesTableHtml({ "<b>": "x" });
ok(!tableHtml.includes("<b>"), "escapa entrada hostil en la clave: " + tableHtml);

/* ---------- Menú contextual con varias capas (Fase 4) ---------- */
/* CTX_MENU_ITEMS y layerCtxItems/ctxItemsFor NO son contiguos en el
   archivo (entre medias hay creación de DOM: ctxMenuEl, closeCtxMenu…),
   así que se extraen por separado.                                    */
const ctxSrc = between("const CTX_MENU_ITEMS = [", "const ctxMenuEl")
  + fn("goToNodeAndBlink") + fn("showLayerInfoAndBlink") + fn("editPropertiesAndBlink")
  + constDecl("STYLE_EDITABLE_KINDS")
  + fn("layerCtxItems") + fn("ctxItemsFor");
global.infoHtmlFor = li => li._info || null; /* stub: evita depender de DOM/Leaflet */
/* Se stubea lo que NO se está probando —highlightNode, showLayerInfo,
   openStyleDialog, styleKind y el parpadeo en sí, que necesitan
   nodeLayer/setLayerVisible sobre <li> reales y aquí los "li" son
   objetos sueltos {_name,_info,_kind}— pero las tres envolturas del
   menú se extraen DE VERDAD: lo que se comprueba es el enrutado (qué
   capa le llega a cada acción) y que las tres hagan parpadear la capa,
   que es lo único que dice CUÁL de las que hay bajo el cursor se ha
   elegido.                                                            */
global.highlightCalls = [];
global.showInfoCalls = [];
global.editCalls = [];
global.blinkCalls = [];
const api = new Function(
  "infoHtmlFor", "showLayerInfo", "highlightNode", "openStyleDialog", "styleKind", "blinkLayer",
  ctxSrc + "\nreturn {CTX_MENU_ITEMS, ctxItemsFor};"
)(global.infoHtmlFor,
  li => { global.showInfoCalls.push(li); },
  li => { global.highlightCalls.push(li); },
  li => { global.editCalls.push(li); },
  li => li._kind || null,
  li => { global.blinkCalls.push(li); });
const { CTX_MENU_ITEMS, ctxItemsFor } = api;

// 0 hits: el menú genérico del mapa, sin cambios
ok(ctxItemsFor([]) === CTX_MENU_ITEMS, "sin capas bajo el cursor: se usa CTX_MENU_ITEMS tal cual");

// 1 hit: ítems directos de esa capa, sin submenú
const liSolo = { _name: "Parcela A", _info: null };
let items = ctxItemsFor([liSolo]);
ok(items[0].label === "Ir al nodo en el panel" && !items[0].items,
  "1 capa: 'Ir al nodo' actúa directo, sin submenú");
ok(items[1].separator === true, "1 capa sin info: separador tras 'Ir al nodo'");
ok(items[items.length - 1] === CTX_MENU_ITEMS[CTX_MENU_ITEMS.length - 1],
  "1 capa: CTX_MENU_ITEMS va al final");
const liConInfo = { _name: "Parcela B", _info: "<table></table>" };
items = ctxItemsFor([liConInfo]);
ok(items.some(it => it.label === "Mostrar atributos" && !it.items),
  "1 capa con info: aparece 'Mostrar atributos' directo");
ok(!items.some(it => it.label === "Editar propiedades"),
  "sin _kind editable: 'Editar propiedades' no aparece");
const liEditable = { _name: "Parcela E", _info: null, _kind: "polygon" };
items = ctxItemsFor([liEditable]);
ok(items.some(it => it.label === "Editar propiedades" && !it.items),
  "1 capa de tipo editable: aparece 'Editar propiedades' directo, distinto de 'Mostrar atributos'");

// 2+ hits: submenú con una entrada por capa
const liA = { _name: "Parcela A", _info: null };
const liB = { _name: "Parcela B", _info: "<table></table>", _kind: "polygon" };
const liC = { _name: "Parcela C", _info: "<table></table>" };
items = ctxItemsFor([liA, liB, liC]);
const goTo = items.find(it => it.label === "Ir al nodo en el panel");
ok(goTo && goTo.items && goTo.items.length === 3,
  "varias capas: 'Ir al nodo' es un submenú con una entrada por capa");
const showInfo = items.find(it => it.label === "Mostrar atributos");
ok(showInfo && showInfo.items.length === 2,
  "varias capas: 'Mostrar atributos' solo lista las que tienen info");
const editProps = items.find(it => it.label === "Editar propiedades");
ok(editProps && editProps.items.length === 1 && editProps.items[0].label === "Parcela B",
  "varias capas: 'Editar propiedades' solo lista las de tipo editable");
ok(items[items.length - 1] === CTX_MENU_ITEMS[CTX_MENU_ITEMS.length - 1],
  "varias capas: CTX_MENU_ITEMS también va al final");

global.editCalls.length = 0;
global.blinkCalls.length = 0;
editProps.items[0].action();
ok(global.editCalls[0] === liB, "el submenú de 'Editar propiedades' pasa la capa correcta");
ok(global.blinkCalls[0] === liB, "y hace parpadear ESA capa");

// invocar una entrada del submenú llama a la función correcta con la capa correcta
global.highlightCalls.length = 0;
global.blinkCalls.length = 0;
goTo.items[1].action();
ok(global.highlightCalls[0] === liB, "el submenú de 'Ir al nodo' pasa la capa correcta");
ok(global.blinkCalls[0] === liB, "y hace parpadear ESA capa, no otra");
global.showInfoCalls.length = 0;
global.blinkCalls.length = 0;
showInfo.items[0].action();
ok(global.showInfoCalls[0] === liB, "el submenú de 'Mostrar atributos' pasa la capa correcta");
/* Lo pedido: con varias capas superpuestas, la ficha sale con un nombre
   y unos datos que no dicen cuál de ellas es. El parpadeo sí.        */
ok(global.blinkCalls[0] === liB,
  "y la hace parpadear igual que 'Ir al nodo': es lo único que identifica cuál se eligió");

/* Con UNA sola capa el ítem es directo, y parpadea lo mismo: la regla
   es la misma para los dos caminos, no una para cada uno.            */
global.showInfoCalls.length = 0;
global.blinkCalls.length = 0;
ctxItemsFor([liConInfo]).find(it => it.label === "Mostrar atributos").action();
ok(global.showInfoCalls[0] === liConInfo && global.blinkCalls[0] === liConInfo,
  "con una sola capa, 'Mostrar atributos' también parpadea");

// ninguna capa con info: no aparece "Mostrar atributos"
items = ctxItemsFor([liA, { _name: "Parcela D", _info: null }]);
ok(!items.some(it => it.label === "Mostrar atributos"),
  "varias capas, ninguna con info: 'Mostrar atributos' no aparece");

if (!process.exitCode) console.log("GEOJSON NAME PICKER / CTX MENU TESTS OK");
