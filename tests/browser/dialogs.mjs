/* Las ventanas: botones siempre a la vista, y redimensionables.

   Es un fallo de disposición, así que solo un navegador puede decir si
   un botón se ve. Se reportó con el selector de iconos —los iconos
   tapaban Aceptar y Cancelar— pero la causa era de TODAS: `.dlg-box`
   lleva `max-height: 85vh; overflow: auto`, así que cuando el contenido
   no cabe scrollea la caja entera, botones incluidos. Medido antes del
   arreglo, a 1280x620: los botones del selector de iconos caían 358 px
   por debajo del borde, y los de la chuleta de atajos 233 px.

   El viewport es CORTO a propósito (620 px, 85vh = 527): es donde el
   fallo se reproduce. En una pantalla alta casi todo cabe y la prueba
   no probaría nada.                                                   */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER DIALOG LAYOUT TESTS OK");

/* Las ocho con contenido que revelar llevan tirador; las cuatro
   confirmaciones cortas, no (ver el comentario de styles.css).      */
/* Las que tienen contenido QUE REVELAR. `url-dialog` entró aquí por una
   razón concreta: una dirección de descarga pasa de mil caracteres con
   facilidad, y en una caja fija no se ve más que un trozo.          */
const CON_RESIZE = new Set(["style-dialog", "icon-picker", "shortcuts", "desc-dialog",
  "geojson-name-picker", "gnp-editor", "points-dialog", "log-dialog", "url-dialog"]);

const browser = await launch();
const srv = await serve(READABLE, 8871);
const { ctx, page, errors } = await openApp(browser, srv.url, { viewport: { width: 1280, height: 620 } });

const medidas = await page.evaluate(() => {
  /* Dos capas para poder abrir los diálogos que necesitan uuna */
  const ul = ensureRootUl();
  const mk = L.marker([40, -3]).addTo(rootGroup);
  const liM = makeNode({ name: "M", layer: mk, style: { color: "#1b5e97" } });
  ul.appendChild(liM); ensureMarkerDefaults(liM);
  const pol = L.polygon([[40, -3], [40.1, -3], [40.1, -2.9]]).addTo(rootGroup);
  const liP = makeNode({ name: "P", layer: pol, style: normalizePathStyle({}) });
  ul.appendChild(liP);

  /* Cada ventana con contenido de sobra, para forzar el desbordamiento
     allí donde puede darse.                                          */
  const abrir = {
    "style-dialog": () => openStyleDialog(liM),
    "icon-picker": () => { openStyleDialog(liM); document.getElementById("icon-preview-btn").click(); },
    "shortcuts": () => { document.getElementById("shortcuts").hidden = false; },
    "desc-dialog": () => {
      document.getElementById("desc-body").innerHTML =
        "<table>" + "<tr><td>clave</td><td>un valor bastante largo</td></tr>".repeat(80) + "</table>";
      document.getElementById("desc-dialog").hidden = false;
    },
    /* El selector de color YA NO pasa por aquí: dejó de ser una ventana
       con caja/cabecera/botones propios (era justo el problema — ver el
       chequeo de solape más abajo), así que el marco de "botones
       siempre a la vista al hacer scroll" no le aplica.               */
    "kml-tags-picker": () => confirmStripHtmlTags("archivo.kml"),
    "kml-dup-picker": () => { document.getElementById("kml-dup-picker").hidden = false; },
    /* Con una dirección larguísima dentro, que es su caso real */
    "url-dialog": () => {
      document.getElementById("url-btn").click();
      document.getElementById("url-input").value =
        "https://ejemplo.com/descargas/" + "a".repeat(950) + "/datos.geojson";
    },
    "geojson-name-picker": () => pickNameProperty(
      Object.fromEntries(Array.from({ length: 60 }, (_, i) => ["clave" + i, "valor " + i])), "a.geojson", null),
    "gnp-editor": () => { document.getElementById("gnp-editor").hidden = false; },
    "points-dialog": () => openPointsDialog(liP),
    "log-dialog": () => { for (let i = 0; i < 80; i++) navMessage("aviso " + i, { tone: "info" }); toggleLog(); },
    "sh-creds": () => { document.getElementById("sh-creds").hidden = false; }
  };

  const out = [];
  for (const [id, fn] of Object.entries(abrir)) {
    try { fn(); } catch (e) { out.push({ id, error: e.message }); continue; }
    const box = document.getElementById(id).querySelector(".dlg-box");
    const acc = box.querySelector(".dlg-actions");
    const h2 = box.querySelector("h2");
    /* Cuánto se sale cada barra de la caja, arriba del scroll y abajo.
       Negativo = está dentro, que es lo que se quiere.               */
    const recorte = () => {
      const rb = box.getBoundingClientRect();
      return {
        botones: Math.round(acc.getBoundingClientRect().bottom - rb.bottom),
        titulo: Math.round(rb.top - h2.getBoundingClientRect().top)
      };
    };
    box.scrollTop = 0;
    const arriba = recorte();
    box.scrollTop = box.scrollHeight;
    const abajo = recorte();
    /* El desbordamiento puede vivir en la caja O en un contenedor
       interior: desde que el cuerpo LLENA la caja (flex: 1), es él
       quien scrollea. Lo que importa es que haya contenido que no
       cabe, no dónde está la barra de scroll.                       */
    const desborda = box.scrollHeight - box.clientHeight > 1
      || [...box.querySelectorAll("*")].some(e => e.scrollHeight - e.clientHeight > 1);
    /* Y el hueco sin cubrir por las barras, arriba y abajo: solo puede
       quedar el borde de la caja (1 px). Más significa que el contenido
       se ve pasar por la franja del relleno.                        */
    box.scrollTop = Math.max(1, Math.floor((box.scrollHeight - box.clientHeight) / 2));
    const rb2 = box.getBoundingClientRect();
    const huecos = {
      abajo: Math.round(rb2.bottom - acc.getBoundingClientRect().bottom),
      arriba: Math.round(h2.getBoundingClientRect().top - rb2.top)
    };
    out.push({ id, arriba, abajo, huecos, desborda, resize: getComputedStyle(box).resize });
    document.getElementById(id).hidden = true;
    document.getElementById("style-dialog").hidden = true;
    document.getElementById("icon-picker").hidden = true;
  }
  return out;
});

ok(medidas.length === 12, "se han abierto las doce ventanas: " + medidas.length);

for (const m of medidas) {
  if (m.error) { ok(false, `${m.id}: no se pudo abrir — ${m.error}`); continue; }
  /* Lo esencial, y en los DOS extremos del scroll: si los botones solo
     se vieran con el scroll arriba, el fallo seguiría ahí a medias.  */
  ok(m.arriba.botones <= 0, `${m.id}: botones dentro con el scroll arriba (sobresalen ${m.arriba.botones} px)`);
  ok(m.abajo.botones <= 0, `${m.id}: botones dentro con el scroll abajo (sobresalen ${m.abajo.botones} px)`);
  /* El <h2> es el asa de arrastre: si se va con el scroll, la ventana
     deja de poder moverse.                                           */
  ok(m.arriba.titulo <= 0, `${m.id}: título visible con el scroll arriba (se sale ${m.arriba.titulo} px)`);
  ok(m.abajo.titulo <= 0, `${m.id}: título visible con el scroll abajo (se sale ${m.abajo.titulo} px)`);
  /* Las barras cubren hasta el borde: si dejan franja, por ahí se ve
     pasar el contenido al scrollear. Medido antes del arreglo: 15 px
     arriba y abajo, que es el relleno de la caja más su borde.     */
  ok(m.huecos.abajo <= 1, `${m.id}: la barra de botones cubre hasta abajo (quedan ${m.huecos.abajo} px)`);
  ok(m.huecos.arriba <= 1, `${m.id}: el título cubre hasta arriba (quedan ${m.huecos.arriba} px)`);
  /* Y el tirador, donde toca y solo donde toca */
  const esperado = CON_RESIZE.has(m.id);
  ok((m.resize === "both") === esperado,
    `${m.id}: ${esperado ? "debe" : "NO debe"} ser redimensionable (resize: ${m.resize})`);
}

/* Las dos que fallaban tienen que SEGUIR desbordando: el arreglo
   consiste en fijar los bordes, no en hacerlas caber a la fuerza, que
   sería esconder el problema en vez de resolverlo.                   */
for (const id of ["icon-picker", "shortcuts"]) {
  const m = medidas.find(x => x.id === id);
  ok(m && m.desborda, `${id}: su contenido sigue sin caber, y aun así los botones se ven`);
}

/* El fallo reportado: el selector de color se abría como una segunda
   ventana CENTRADA en el viewport, sin mirar dónde estaba el diálogo de
   estilos ni el botón que lo había abierto — con el diálogo desplazado
   hacia el centro (o en un viewport pequeño), acababa tapando sus
   propios Cancelar/Aceptar. Ahora es un popover anclado al botón, así
   que comprobar que NO se solapa con los botones del diálogo de
   estilos es la prueba directa del arreglo.                          */
const solapeColor = await page.evaluate(() => {
  const liM = [...document.querySelectorAll("#tree li")].find(x => x._mstyle);
  openStyleDialog(liM);
  openColorPicker(document.getElementById("mk-color"));
  const pop = document.getElementById("color-picker").getBoundingClientRect();
  const acc = document.querySelector("#style-dialog .dlg-box .dlg-actions").getBoundingClientRect();
  const solapaX = pop.left < acc.right && pop.right > acc.left;
  const solapaY = pop.top < acc.bottom && pop.bottom > acc.top;
  document.getElementById("color-picker").hidden = true;
  document.getElementById("style-dialog").hidden = true;
  return { solapa: solapaX && solapaY, pop, acc };
});
ok(!solapeColor.solapa, "el popover de color no tapa los botones del diálogo de estilos: "
  + JSON.stringify(solapeColor.pop) + " vs " + JSON.stringify(solapeColor.acc));

/* Otro fallo reportado, en el mismo popover: abrirlo desde la fila
   «Color de fondo» del panel de mapas base y luego pulsar en cualquier
   otro sitio DEL MISMO PANEL no lo cerraba — solo Escape, o un clic
   fuera del panel entero, funcionaban. La causa: el cierre escuchaba
   "mousedown" en document, pero L.DomEvent.disableClickPropagation
   (aplicado a `.base-box`, como a cualquier control de Leaflet) en
   Leaflet 1.9.4 solo detiene mousedown/dblclick/contextmenu — NO
   "click" (mismo hallazgo que ya deja escrito el comentario de
   clickOnControl en 52-measure.js) —, así que ese mousedown nunca
   llegaba a document. Hace falta un CLIC real del ratón (no un
   `.click()` sintético vía evaluate, que no dispara mousedown) para
   ejercitar de verdad ese camino.                                     */
await page.click(".base-toggle");
await page.waitForTimeout(150);
await page.click(".base-row-bg .color-btn");
const abiertoTrasBoton = !(await page.evaluate(() => document.getElementById("color-picker").hidden));
/* Su propia etiqueta de texto («Color de fondo»): vecina del botón en la
   misma fila y el mismo panel, pero fuera del popover y fuera del botón
   — y sin `for`, así que pulsarla no activa ni cambia nada por su
   cuenta, y el clic prueba solo lo que hace falta probar.             */
await page.click(".base-row-bg label");
await page.waitForTimeout(150);
const cerradoTrasClicEnPanel = await page.evaluate(() => document.getElementById("color-picker").hidden);
ok(abiertoTrasBoton, "el popover de color se abre desde la fila «Color de fondo»");
ok(cerradoTrasClicEnPanel,
  "y se cierra al pulsar en otro punto del MISMO panel de mapas base, no solo fuera de él");
await page.click(".base-toggle"); /* deja el panel como estaba para el resto de la suite */

/* El fallo seguía sin arreglar del todo: cerrar «con un clic fuera»
   depende de en qué contenedor se esté (el chequeo anterior), y no es
   el gesto que alguien prueba primero de todos modos — lo natural es
   volver a pulsar el mismo botón grande que lo abrió. Antes eso lo
   REABRÍA (a propósito, para poder "refrescarlo"); ahora debe CERRARLO,
   haya cambiado el color o no. Se comprueba en el propio diálogo de
   estilos, sin depender de ningún control de Leaflet.                 */
const toggleBoton = await page.evaluate(() => {
  const liM = [...document.querySelectorAll("#tree li")].find(x => x._mstyle);
  openStyleDialog(liM);
  const btn = document.getElementById("mk-color");
  btn.click();
  const abierto1 = !document.getElementById("color-picker").hidden;
  btn.click(); /* mismo botón, sin tocar el color: debe cerrar */
  const cerrado = document.getElementById("color-picker").hidden;
  document.getElementById("style-dialog").hidden = true;
  return { abierto1, cerrado };
});
ok(toggleBoton.abierto1, "el popover se abre al pulsar el botón de color");
ok(toggleBoton.cerrado,
  "y se cierra al volver a pulsar EL MISMO botón, sin haber cambiado el color");

/* Redimensionar a mano no puede descolgar los botones */
const trasEstirar = await page.evaluate(() => {
  openStyleDialog([...document.querySelectorAll("#tree li")].find(x => x._mstyle));
  const box = document.querySelector("#style-dialog .dlg-box");
  box.style.width = "300px";
  box.style.height = "200px";          /* mucho más pequeña que su contenido */
  const acc = box.querySelector(".dlg-actions");
  box.scrollTop = box.scrollHeight;
  const rb = box.getBoundingClientRect();
  return {
    alto: Math.round(rb.height),
    scrollea: box.scrollHeight - box.clientHeight > 1,
    botones: Math.round(acc.getBoundingClientRect().bottom - rb.bottom)
  };
});
ok(trasEstirar.scrollea, "encogida a 200 px, la ventana de propiedades desborda: " + trasEstirar.alto);
ok(trasEstirar.botones <= 0,
  "y sus botones siguen dentro (sobresalen " + trasEstirar.botones + " px)");

/* ---------- Agrandar la ventana agranda el CONTENIDO ----------
   Es para lo que se redimensiona. Antes el tirador estaba en el
   elemento interior y crecía él; con el tirador en la caja, el interior
   tiene que llenarla o agrandar la ventana solo añade hueco vacío.
   Medido antes del arreglo: la ficha se quedaba clavada en 366 px de
   ancho con la ventana a 900.                                        */
const crecimiento = await page.evaluate(() => {
  document.getElementById("desc-body").innerHTML =
    "<table>" + Array.from({ length: 25 }, (_, i) =>
      `<tr><td>nombre_de_propiedad_largo_${i}</td>`
      + `<td>un valor de propiedad razonablemente largo que se parte si no hay sitio ${i}</td></tr>`).join("")
    + "</table>";
  document.getElementById("desc-dialog").hidden = false;
  const box = document.querySelector("#desc-dialog .dlg-box");
  const body = document.getElementById("desc-body");
  const filas = () => [...body.querySelectorAll("tr")].map(tr => tr.getBoundingClientRect().height);
  const mide = () => ({
    ancho: Math.round(body.getBoundingClientRect().width),
    alto: Math.round(body.getBoundingClientRect().height),
    partidas: filas().filter(h => h > 30).length
  });
  const antes = mide();
  box.style.width = "1100px";
  const ancha = mide();
  /* Se parte de una altura MENOR que el tope (85vh = 527 px en este
     viewport) y se crece desde ahí: pedir más del tope no crece nada y
     la comprobación no diría nada.                                  */
  box.style.height = "300px";
  const baja = mide();
  box.style.height = "500px";
  return { antes, ancha, baja, alta: mide() };
});
ok(crecimiento.ancha.ancho > crecimiento.antes.ancho + 200,
  `ensanchar la ventana ensancha la ficha: ${crecimiento.antes.ancho} → ${crecimiento.ancha.ancho} px`);
ok(crecimiento.antes.partidas > 0 && crecimiento.ancha.partidas === 0,
  `y las filas dejan de partirse en varias líneas: ${crecimiento.antes.partidas} → ${crecimiento.ancha.partidas}`);
ok(crecimiento.alta.alto > crecimiento.baja.alto + 150,
  `y darle altura se la da al contenido: ${crecimiento.baja.alto} → ${crecimiento.alta.alto} px`);

/* ---------- Separador móvil de las dos columnas de la ficha ----------
   Las properties son clave/valor, o sea dos columnas fijas, y el
   reparto entre ellas se arrastra. Se prueba con un arrastre REAL del
   ratón: es lo único que ejercita la captura de puntero y el cálculo
   contra el ancho del envoltorio.                                     */
await page.evaluate(() => {
  document.getElementById("desc-dialog").hidden = true;
  const grupo = L.geoJSON({ type: "Feature",
    properties: Object.fromEntries(Array.from({ length: 12 },
      (_, i) => ["nombre_de_propiedad_" + i, "valor de la propiedad numero " + i])),
    geometry: { type: "Point", coordinates: [-3, 40] } }).addTo(rootGroup);
  const li = makeNode({ name: "Con properties", layer: grupo, style: { color: "#1b5e97" } });
  ensureRootUl().appendChild(li);
  /* La ficha se ensancha para que quepa el arrastre */
  showLayerInfo(li);
  document.querySelector("#desc-dialog .dlg-box").style.width = "620px";
});

const anchos = () => page.evaluate(() => ({
  clave: Math.round(document.querySelector(".props td").getBoundingClientRect().width),
  valor: Math.round(document.querySelectorAll(".props td")[1].getBoundingClientRect().width),
  frac: document.getElementById("desc-body").style.getPropertyValue("--props-key"),
  layout: getComputedStyle(document.querySelector(".props")).tableLayout
}));

const inicial = await anchos();
ok(inicial.layout === "fixed",
  "la tabla es de reparto FIJO: con el automático el ancho pedido se ignora y el separador no movería nada");
ok(await page.locator(".props-grip").count() === 1, "hay un tirador entre las dos columnas");
/* Y NO en una tabla que venga de la <description> de un KML, que es
   HTML del archivo y puede tener las columnas que quiera.           */
const enKml = await page.evaluate(() => {
  document.getElementById("desc-body").innerHTML = "<table><tr><td>a</td><td>b</td><td>c</td></tr></table>";
  return document.querySelectorAll(".props-grip").length;
});
ok(enKml === 0, "una tabla de una ficha KML no lleva separador: sus columnas son del autor");

/* Vuelta a la tabla de properties para arrastrar de verdad */
await page.evaluate(() => showLayerInfo(
  [...document.querySelectorAll("#tree li")].find(x => x._name === "Con properties")));
const grip = await page.locator(".props-grip").boundingBox();
await page.mouse.move(grip.x + grip.width / 2, grip.y + 30);
await page.mouse.down();
await page.mouse.move(grip.x + grip.width / 2 + 150, grip.y + 30, { steps: 10 });
await page.mouse.up();
const trasArrastrar = await anchos();
ok(trasArrastrar.clave > inicial.clave + 100,
  `arrastrar a la derecha ensancha la clave: ${inicial.clave} → ${trasArrastrar.clave} px`);
ok(trasArrastrar.valor < inicial.valor - 100,
  `y estrecha el valor: ${inicial.valor} → ${trasArrastrar.valor} px`);

/* Al extremo: ninguna columna puede desaparecer */
const g2 = await page.locator(".props-grip").boundingBox();
await page.mouse.move(g2.x + g2.width / 2, g2.y + 30);
await page.mouse.down();
await page.mouse.move(g2.x - 3000, g2.y + 30, { steps: 8 });
await page.mouse.up();
const alTope = await anchos();
ok(alTope.clave > 20 && alTope.valor > 20,
  `arrastrado al extremo, ninguna columna desaparece: ${alTope.clave} / ${alTope.valor} px`);

/* El reparto se recuerda al abrir otra capa: si no, habría que
   recolocarlo en cada consulta.                                     */
const trasReabrir = await page.evaluate(() => {
  document.getElementById("desc-dialog").hidden = true;
  showLayerInfo([...document.querySelectorAll("#tree li")].find(x => x._name === "Con properties"));
  return document.getElementById("desc-body").style.getPropertyValue("--props-key");
});
ok(trasReabrir === alTope.frac,
  `el reparto elegido sobrevive al cambio de capa: ${alTope.frac} → ${trasReabrir}`);

/* El reparto PERSISTE entre sesiones. No es como la unidad de medida o
   el formato de coordenadas, que se cambian para mirar un dato: este
   depende de cómo son los archivos con los que uno trabaja, y sin
   guardarlo habría que reajustarlo en cada arranque.
   Se recarga en el MISMO contexto: cada contexto de navegador tiene su
   propio IndexedDB, así que en uno nuevo no habría nada que restaurar y
   la comprobación no diría nada.                                      */
const guardado = await page.evaluate(() => dbLoadProps());
ok(guardado !== null && Math.abs(guardado - parseFloat(alTope.frac) / 100) < 0.001,
  `el reparto queda guardado en IndexedDB: ${guardado} vs ${alTope.frac}`);

const recargada = await ctx.newPage();
await recargada.goto(srv.url);
await recargada.waitForFunction(() => typeof map === "object" && !!document.getElementById("tree"));
await recargada.waitForFunction(() => window.__arranqueListo === undefined || true);
await recargada.waitForTimeout(1500); /* el arranque restaura antes del árbol */
const trasRecargar = await recargada.evaluate(() => propsKeyFrac);
ok(Math.abs(trasRecargar - guardado) < 0.001,
  `y se restaura al recargar: ${guardado} → ${trasRecargar}`);
await recargada.close();

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await ctx.close();
await browser.close();
srv.close();
done();
