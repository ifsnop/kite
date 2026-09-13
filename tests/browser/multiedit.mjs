/* Editar VARIOS nodos a la vez, y el nombre siempre a la vista de un
   trazo. Las dos cosas son de interfaz: lo que se prueba aquí es que el
   diálogo enseñe que un valor no es el mismo en todos, que aceptar sin
   tocarlo no lo iguale por detrás, y que la etiqueta permanente aparezca
   —y desaparezca— en la capa. Las funciones puras que deciden qué se
   aplica están en tests/multiedit.js.                                 */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER MULTI-EDIT TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8846);
const { page, errors } = await openApp(browser, srv.url);

await page.evaluate(() => {
  window.__limpiar = () => {
    document.getElementById("tree").innerHTML = "";
    rootUl = null;
    rootGroup.clearLayers();
    return ensureRootUl();
  };
  window.__poly = (ul, nombre, style) => {
    const capa = L.geoJSON({ type: "Feature", properties: {}, geometry: { type: "Polygon",
      coordinates: [[[-3.7, 40.4], [-3.6, 40.4], [-3.6, 40.5], [-3.7, 40.4]]] } }, { style });
    capa.addTo(rootGroup);
    const li = makeNode({ name: nombre, layer: capa, style });
    ul.appendChild(li);
    applyPolygonStyle(li);
    return li;
  };
  window.__abrir = nodos => {
    clearSelection();
    for (const n of nodos) setSelected(n, true);
    setSelCursor(nodos[0]);
    openStyleDialog(nodos[0]);
  };
  window.__mixta = id => document.getElementById(id).closest(".dlg-row").classList.contains("mixed");
  /* Mover un control como lo movería el usuario: el valor y su evento */
  window.__tocar = (id, valor) => {
    const el = document.getElementById(id);
    if (el.type === "checkbox") el.checked = valor;
    else el.value = valor;
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  };
  window.__tocarColor = (id, hex) => {
    /* El camino del selector de color: escribe en el botón y avisa */
    setColorButton(document.getElementById(id), hex);
    touchControl(document.getElementById(id));
    readStyleControls();
  };
  window.__tip = li => {
    const t = nodeLayer(li).getTooltip();
    return t && t.options.permanent ? t.getContent() : null;
  };
});

/* ---------- Lo que no coincide se ve, y no se aplica solo ---------- */
const abierto = await page.evaluate(() => {
  const ul = __limpiar();
  /* Mismo relleno, distinto contorno y distinto grosor */
  const base = { fillColor: "#ff0000", fillOpacity: 0.35 };
  window.__n = [
    __poly(ul, "Zona A", { ...base, color: "#ff0000", weight: 2 }),
    __poly(ul, "Zona B", { ...base, color: "#00ff00", weight: 5 })
  ];
  __abrir(__n);
  return {
    nombreValor: document.getElementById("mk-name").value,
    nombrePlaceholder: document.getElementById("mk-name").placeholder,
    nombreVisible: !document.getElementById("name-row").hidden,
    pesoValor: document.getElementById("pg-weight").value,
    pesoPlaceholder: document.getElementById("pg-weight").placeholder,
    pesoMixto: __mixta("pg-weight"),
    colorMixto: __mixta("pg-color"),
    rellenoMixto: __mixta("pg-fill-color"),
    opacidadMixta: __mixta("pg-fill-opacity")
  };
});
ok(abierto.nombreVisible, "con varios nodos el campo del nombre YA no se esconde");
ok(abierto.nombreValor === "" && abierto.nombrePlaceholder === "Zona A, Zona B",
  "va vacío y enseña los nombres que hay: " + JSON.stringify(abierto));
ok(abierto.pesoValor === "" && abierto.pesoPlaceholder === "varios",
  "un número que no coincide se queda en blanco y lo dice: "
  + JSON.stringify([abierto.pesoValor, abierto.pesoPlaceholder]));
ok(abierto.pesoMixto && abierto.colorMixto,
  "grosor y color van marcados como mezclados");
ok(!abierto.rellenoMixto && !abierto.opacidadMixta,
  "y lo que sí coincide en todos, no: " + JSON.stringify([abierto.rellenoMixto, abierto.opacidadMixta]));

/* ---------- Tocar uno lo desmarca al momento ---------- */
const desmarcado = await page.evaluate(() => {
  __tocarColor("pg-color", "#0000ff");
  return { color: __mixta("pg-color"), peso: __mixta("pg-weight") };
});
ok(!desmarcado.color && desmarcado.peso,
  "tocar el color lo saca de la mezcla y deja el resto como estaba");

/* ---------- Aceptar: solo lo tocado viaja a todos ---------- */
const aplicado = await page.evaluate(() => {
  __tocar("pg-text-always", true);
  document.getElementById("style-accept").click();
  return __n.map(li => ({ nombre: li._name, color: li._style.color, weight: li._style.weight,
    siempre: !!li._style.textAlways, tip: __tip(li) }));
});
ok(aplicado.every(n => n.color === "#0000ff"),
  "el color tocado se aplica a todos: " + JSON.stringify(aplicado.map(n => n.color)));
ok(aplicado[0].weight === 2 && aplicado[1].weight === 5,
  "y el grosor, que no se tocó, sigue siendo el de cada uno: "
  + JSON.stringify(aplicado.map(n => n.weight)));
ok(aplicado.every(n => n.siempre), "la casilla nueva se aplica a los dos");
ok(aplicado[0].tip === "Zona A" && aplicado[1].tip === "Zona B",
  "y cada trazo enseña SU nombre, no el del primero: "
  + JSON.stringify(aplicado.map(n => n.tip)));
/* El nombre iba vacío y nadie escribió: no puede haber renombrado nada */
ok(aplicado[0].nombre === "Zona A" && aplicado[1].nombre === "Zona B",
  "aceptar sin escribir el nombre no renombra: " + JSON.stringify(aplicado.map(n => n.nombre)));

/* ---------- Pero escribirlo sí renombra todos ---------- */
const renombrado = await page.evaluate(() => {
  __abrir(__n);
  __tocar("mk-name", "Zona única");
  document.getElementById("style-accept").click();
  return __n.map(li => ({ nombre: li._name, tip: __tip(li),
    fila: li.querySelector(":scope > .node-row > label").textContent }));
});
ok(renombrado.every(n => n.nombre === "Zona única" && n.fila === "Zona única"),
  "escribir un nombre con varios seleccionados los renombra todos: "
  + JSON.stringify(renombrado));
ok(renombrado.every(n => n.tip === "Zona única"),
  "y la etiqueta permanente se repinta con él: " + JSON.stringify(renombrado.map(n => n.tip)));

/* ---------- Con UN nodo, todo sigue igual que siempre ---------- */
const uno = await page.evaluate(() => {
  const ul = __limpiar();
  const li = __poly(ul, "Sola", { color: "#ff0000", weight: 2, fillColor: "#ff0000", fillOpacity: 0.35 });
  __abrir([li]);
  const visto = { nombre: document.getElementById("mk-name").value,
    peso: document.getElementById("pg-weight").value,
    marcados: document.querySelectorAll("#style-dialog .dlg-row.mixed").length };
  __tocar("pg-weight", "6");
  document.getElementById("style-accept").click();
  return { visto, weight: li._style.weight, nombre: li._name };
});
ok(uno.visto.nombre === "Sola" && uno.visto.peso === "2",
  "con un solo nodo los controles traen su valor: " + JSON.stringify(uno.visto));
ok(uno.visto.marcados === 0, "y no hay nada marcado como mezclado: " + uno.visto.marcados);
ok(uno.weight === 6 && uno.nombre === "Sola", "aceptar aplica lo editado: " + JSON.stringify(uno));

/* ---------- La casilla usa el TERCER estado cuando no coinciden ---------- */
const tercero = await page.evaluate(() => {
  const ul = __limpiar();
  const base = { color: "#ff0000", weight: 2, fillColor: "#ff0000", fillOpacity: 0.35 };
  const a = __poly(ul, "Con", { ...base, textAlways: true });
  const b = __poly(ul, "Sin", { ...base, textAlways: false });
  __abrir([a, b]);
  const chk = document.getElementById("pg-text-always");
  const antes = { indeterminado: chk.indeterminate, marcada: __mixta("pg-text-always") };
  /* No se toca: cada uno tiene que conservar la suya */
  document.getElementById("style-accept").click();
  return { antes, a: !!a._style.textAlways, b: !!b._style.textAlways,
    tipA: __tip(a), tipB: __tip(b) };
});
ok(tercero.antes.indeterminado && tercero.antes.marcada,
  "la casilla sale con el guion, como una carpeta a medias del árbol");
ok(tercero.a === true && tercero.b === false,
  "y sin tocarla cada uno conserva la suya: " + JSON.stringify([tercero.a, tercero.b]));
ok(tercero.tipA === "Con" && tercero.tipB === null,
  "solo uno enseña su nombre: " + JSON.stringify([tercero.tipA, tercero.tipB]));

/* ---------- Apagarla repone el globo de click ---------- */
const apagada = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree > ul > li")].find(x => x._name === "Con");
  __abrir([li]);
  __tocar("pg-text-always", false);
  document.getElementById("style-accept").click();
  const layer = nodeLayer(li);
  return { tip: __tip(li), popup: layer.getPopup() ? layer.getPopup().getContent() : null };
});
ok(apagada.tip === null && apagada.popup === "Con",
  "al apagarla vuelve el globo de siempre: " + JSON.stringify(apagada));

/* ---------- Y sobrevive a guardar y restaurar ---------- */
const vuelta = await page.evaluate(async () => {
  const ul = __limpiar();
  const li = __poly(ul, "Etiquetada", { color: "#ff0000", weight: 2,
    fillColor: "#ff0000", fillOpacity: 0.35, textAlways: true });
  const guardado = serializeTree();
  __limpiar();
  const recs = await buildRecordsFromStorage(guardado, null);
  await materializeRecords(recs, ensureRootUl());
  const nuevo = document.querySelector("#tree > ul > li");
  return { enDisco: guardado[0].style.textAlways, tip: __tip(nuevo), nombre: li._name };
});
ok(vuelta.enDisco === true, "la opción se serializa con el estilo del trazo");
ok(vuelta.tip === "Etiquetada",
  "y al restaurar el trazo recupera su etiqueta: " + JSON.stringify(vuelta.tip));

/* ---------- Marcadores: la misma regla ---------- */
const marcadores = await page.evaluate(() => {
  const ul = __limpiar();
  window.__m = [["A", "star", 24], ["B", "airplane", 41]].map(([n, icon, size]) => {
    const li = makeNode({ name: "Punto " + n, layer: L.marker([40, -3]).addTo(rootGroup),
      style: { color: "#1b5e97" } });
    ul.appendChild(li);
    li._mstyle = { ...DEFAULT_MARKER_STYLE, icon, size };
    applyMarkerStyle(li);
    return li;
  });
  __abrir(__m);
  const antes = { icono: __mixta("icon-preview-btn"), tam: __mixta("mk-size"),
    color: __mixta("mk-color"), texto: __mixta("mk-text-always") };
  __tocar("mk-text-size", "20");
  document.getElementById("style-accept").click();
  return { antes, tras: __m.map(li => ({ icon: li._mstyle.icon, size: li._mstyle.size, textSize: li._mstyle.textSize })) };
});
ok(marcadores.antes.icono && marcadores.antes.tam,
  "icono y tamaño dispares salen marcados: " + JSON.stringify(marcadores.antes));
ok(!marcadores.antes.color && !marcadores.antes.texto,
  "lo que coincide, no: " + JSON.stringify(marcadores.antes));
ok(marcadores.tras.every(m => m.textSize === 20),
  "el tamaño del texto tocado va a los dos: " + JSON.stringify(marcadores.tras));
ok(marcadores.tras[0].icon === "star" && marcadores.tras[1].icon === "airplane"
  && marcadores.tras[0].size === 24 && marcadores.tras[1].size === 41,
  "y cada uno conserva su icono y su tamaño: " + JSON.stringify(marcadores.tras));

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
