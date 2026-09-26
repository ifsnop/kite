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
  "geojson-name-picker", "props-dialog", "points-dialog", "log-dialog", "url-dialog"]);

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
    /* Renombrado a "Propiedades": ahora con pestañas, la de nombres de
       GeoJSON es la que puede llenarse de filas y desbordar.           */
    "props-dialog": async () => {
      gnpStore = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`["clave${i}"]`, "clave" + i]));
      await togglePropsDialog();
    },
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

/* El fallo central reportado: el color de fondo del mapa aplicaba Y
   GUARDABA en el mismo gesto, sin ninguna forma de probarlo y echarse
   atrás. Ahora "aplicar" (`onPreview`, en vivo sobre el mapa) y
   "guardar" (`onCommit`, en IndexedDB) son pasos distintos, y solo
   Aceptar hace el segundo — Cancelar deshace el primero.              */
const bgAntes = await page.evaluate(async () => ({
  css: getComputedStyle(document.documentElement).getPropertyValue("--map-bg").trim(),
  guardado: await dbLoadMapBackground()
}));
await page.click(".base-row-bg .color-btn");
await page.waitForTimeout(150);
let box = await (await page.$("#color-sv")).boundingBox();
await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.65, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(80);
const bgDurante = await page.evaluate(async () => ({
  css: getComputedStyle(document.documentElement).getPropertyValue("--map-bg").trim(),
  guardado: await dbLoadMapBackground()
}));
ok(bgDurante.css !== bgAntes.css,
  `arrastrar en el espectro aplica el fondo del mapa EN VIVO, sin cerrar: ${bgAntes.css} → ${bgDurante.css}`);
ok(JSON.stringify(bgDurante.guardado) === JSON.stringify(bgAntes.guardado),
  "pero todavía no se ha guardado nada en IndexedDB: eso solo lo hace Aceptar");
await page.click("#color-cancel");
await page.waitForTimeout(80);
const bgTrasCancelar = await page.evaluate(async () => ({
  css: getComputedStyle(document.documentElement).getPropertyValue("--map-bg").trim(),
  guardado: await dbLoadMapBackground()
}));
ok(bgTrasCancelar.css === bgAntes.css,
  `Cancelar revierte el fondo del mapa al color que tenía al abrir el selector: ${bgDurante.css} → ${bgTrasCancelar.css}`);
ok(JSON.stringify(bgTrasCancelar.guardado) === JSON.stringify(bgAntes.guardado),
  "y sigue sin haberse guardado nada en IndexedDB");

/* Repitiendo el mismo gesto pero con Aceptar: ahora sí debe persistir */
await page.click(".base-row-bg .color-btn");
await page.waitForTimeout(150);
box = await (await page.$("#color-sv")).boundingBox();
await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.8);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.65, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(80);
const bgElegido = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue("--map-bg").trim());
await page.click("#color-accept");
await page.waitForTimeout(80);
const bgTrasAceptar = await page.evaluate(async () => ({
  css: getComputedStyle(document.documentElement).getPropertyValue("--map-bg").trim(),
  guardado: await dbLoadMapBackground()
}));
ok(bgTrasAceptar.css === bgElegido, "Aceptar deja aplicado el color que se estaba previsualizando");
ok(!!bgTrasAceptar.guardado && bgTrasAceptar.guardado.toLowerCase() === bgElegido.toLowerCase(),
  `y esta vez SÍ queda guardado en IndexedDB: ${JSON.stringify(bgTrasAceptar.guardado)}`);

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

/* El espectro es NUESTRO, no <input type="color">: ese control abre el
   panel NATIVO del navegador, que vive fuera del DOM de la página y no
   se puede cerrar, reposicionar ni tratar como parte de un único
   diálogo integrado por ningún script — el motivo de fondo por el que
   "un solo diálogo" no podía cumplirse mientras siguiera ahí. Guarda
   estructural para que no vuelva a colarse.                          */
ok(!(await page.$("#color-picker input[type=color]")),
  "el popover no lleva ningún <input type=\"color\">: el espectro es propio");

/* Arrastrar de verdad en el cuadrado de saturación/valor. El fallo
   reportado: ningún gesto del popover cerraba nada por sí mismo salvo
   uno que además GUARDABA, sin dar opción a echarse atrás. Ahora
   arrastrar solo PREVISUALIZA sobre el botón —ni a mitad de gesto ni al
   soltar cierra el popover— y Cancelar debe devolver el botón a como
   estaba antes de tocar nada.                                        */
const colorOriginalMk = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._mstyle);
  openStyleDialog(li);
  return document.getElementById("mk-color").dataset.color;
});
await page.click("#mk-color");
await page.waitForTimeout(150);
box = await (await page.$("#color-sv")).boundingBox();
await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
await page.waitForTimeout(80);
ok(!(await page.evaluate(() => document.getElementById("color-picker").hidden)),
  "arrastrar en el cuadrado NO cierra a mitad de gesto");
await page.mouse.up();
await page.waitForTimeout(150);
const trasSoltarMk = await page.evaluate(() => ({
  hidden: document.getElementById("color-picker").hidden,
  boton: document.getElementById("mk-color").dataset.color
}));
ok(!trasSoltarMk.hidden, "y tampoco cierra al soltar: hace falta Aceptar para confirmar el cambio");
ok(trasSoltarMk.boton !== colorOriginalMk,
  `pero SÍ previsualiza en vivo sobre el botón mientras se arrastra: seguía en ${colorOriginalMk}`);
await page.click("#color-cancel");
const trasCancelarMk = await page.evaluate(() => ({
  hidden: document.getElementById("color-picker").hidden,
  boton: document.getElementById("mk-color").dataset.color
}));
ok(trasCancelarMk.hidden, "Cancelar cierra el popover");
ok(trasCancelarMk.boton === colorOriginalMk,
  `y Cancelar restaura el color ORIGINAL del botón: ${trasSoltarMk.boton} → ${trasCancelarMk.boton} (era ${colorOriginalMk})`);

/* Repitiendo el arrastre pero Aceptando: el color se ve EN VIVO en el
   mapa mientras se previsualiza (cambio de filosofía: antes esperaba al
   Aceptar exterior), llega al borrador al Aceptar del popover, y el
   Cancelar del diálogo exterior lo revierte en la capa.               */
await page.waitForTimeout(100); /* deja pasar el fotograma de la vista previa anterior */
const colorAntesCapa = await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._mstyle);
  return li._mstyle.color;
});
await page.click("#mk-color");
await page.waitForTimeout(150);
box = await (await page.$("#color-sv")).boundingBox();
await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
await page.mouse.up();
await page.waitForTimeout(150);
const previsualizadoMk = await page.evaluate(() => document.getElementById("mk-color").dataset.color);
ok((await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._mstyle);
  return li._mstyle.color;
})) === previsualizadoMk,
  "mientras el popover sigue abierto, el color ya está aplicado a la CAPA (vista previa en vivo)");
await page.click("#color-accept");
const trasAceptarMk = await page.evaluate(() => ({
  hidden: document.getElementById("color-picker").hidden,
  boton: document.getElementById("mk-color").dataset.color,
  borrador: styleDraft.color
}));
ok(trasAceptarMk.hidden, "Aceptar cierra el popover");
ok(trasAceptarMk.boton === previsualizadoMk, "y deja el color que se estaba previsualizando");
ok(trasAceptarMk.borrador === previsualizadoMk,
  "que ahora sí ha llegado al borrador del diálogo de estilos");
await page.click("#style-cancel");
ok((await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._mstyle);
  return li._mstyle.color;
})) === colorAntesCapa,
  "y Cancelar en el diálogo de estilos devuelve a la capa el color con el que se abrió");
await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._mstyle);
  openStyleDialog(li);
});

/* El antiguo fallo más esquivo: escribir un hexadecimal y pulsar Intro.
   Ya no puede reabrir nada porque ya no CIERRA nada — Intro solo
   previsualiza, igual que el resto de gestos del popover.             */
await page.click("#style-cancel");
await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._mstyle);
  openStyleDialog(li);
});
await page.click("#mk-color");
await page.waitForTimeout(150);
await page.click("#color-f0");
await page.keyboard.press("Control+A");
await page.keyboard.type("#ff00aa");
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
ok(!(await page.evaluate(() => document.getElementById("color-picker").hidden)),
  "escribir un hex y pulsar Intro solo previsualiza: el popover sigue abierto");
ok((await page.evaluate(() => document.getElementById("mk-color").dataset.color)) === "#ff00aa",
  "y el color escrito ya se ve en el botón, antes de Aceptar");
await page.click("#color-accept");
ok(await page.evaluate(() => document.getElementById("color-picker").hidden),
  "y Aceptar (no Intro) es lo que cierra el popover");
ok((await page.evaluate(() => document.getElementById("mk-color").dataset.color)) === "#ff00aa",
  "con el color escrito ya aplicado de verdad");
await page.click("#style-cancel");

/* Las flechas ‹ › ciclan la notación (Hex/RGB/CMYK/HSV) sin cambiar el
   color: mismo papel que el botón ⇅ de las coordenadas, con más de dos
   estados. Cada notación es UN CAMPO POR CANAL, no un texto con
   separadores: Hex usa `#color-f0` en solitario, RGB/HSV los tres
   primeros, CMYK los cuatro. Se comprueba escribiendo el MISMO rojo
   puro en RGB, campo a campo, y leyéndolo de vuelta en CMYK.          */
await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._mstyle);
  openStyleDialog(li);
});
await page.click("#mk-color");
await page.waitForTimeout(150);
const etiquetaInicial = await page.evaluate(() => document.getElementById("color-mode-label").textContent);
ok(etiquetaInicial === "HEX", `la notación por defecto es HEX: era «${etiquetaInicial}»`);
const camposHex = await page.evaluate(() =>
  [0, 1, 2, 3].map(i => !document.getElementById(`color-field-${i}`).hidden));
ok(JSON.stringify(camposHex) === JSON.stringify([true, false, false, false]),
  `en HEX solo se ve un campo: ${JSON.stringify(camposHex)}`);
await page.click("#color-mode-next");
const etiquetaRgb = await page.evaluate(() => document.getElementById("color-mode-label").textContent);
ok(etiquetaRgb === "RGB", `la flecha › avanza a RGB: era «${etiquetaRgb}»`);
const camposRgb = await page.evaluate(() =>
  [0, 1, 2, 3].map(i => !document.getElementById(`color-field-${i}`).hidden));
ok(JSON.stringify(camposRgb) === JSON.stringify([true, true, true, false]),
  `en RGB se ven tres campos: ${JSON.stringify(camposRgb)}`);
await page.fill("#color-f0", "255");
await page.fill("#color-f1", "0");
await page.fill("#color-f2", "0");
await page.waitForTimeout(100);
ok((await page.evaluate(() => document.getElementById("mk-color").dataset.color)) === "#ff0000",
  "escribir 255/0/0 en los tres campos RGB aplica el rojo puro");
await page.click("#color-mode-next");
const camposCmyk = await page.evaluate(() =>
  [0, 1, 2, 3].map(i => !document.getElementById(`color-field-${i}`).hidden));
ok(JSON.stringify(camposCmyk) === JSON.stringify([true, true, true, true]),
  `en CMYK se ven los cuatro campos: ${JSON.stringify(camposCmyk)}`);
const enCmyk = await page.evaluate(() =>
  [0, 1, 2, 3].map(i => document.getElementById(`color-f${i}`).value).join(", "));
ok(/^0,\s*100,\s*100,\s*0$/.test(enCmyk),
  `y CMYK lee el mismo rojo como cian 0 / magenta 100 / amarillo 100 / negro 0: «${enCmyk}»`);
await page.click("#color-mode-prev");
await page.click("#color-mode-prev"); /* CMYK → RGB → HEX: vuelve a la de partida */
const etiquetaTrasCiclo = await page.evaluate(() => document.getElementById("color-mode-label").textContent);
ok(etiquetaTrasCiclo === "HEX", `‹ retrocede igual, ciclando: llegó a «${etiquetaTrasCiclo}»`);
await page.click("#color-cancel");
await page.click("#style-cancel");

/* La rampa de matiz es un deslizador de una dimensión, no un plano de
   selección: debe mostrar una mano (`grab`), no una cruz (`crosshair`,
   que sí corresponde al cuadrado de saturación/valor, un plano real). */
await page.evaluate(() => {
  const li = [...document.querySelectorAll("#tree li")].find(x => x._mstyle);
  openStyleDialog(li);
});
await page.click("#mk-color");
await page.waitForTimeout(150);
const cursores = await page.evaluate(() => ({
  sv: getComputedStyle(document.getElementById("color-sv")).cursor,
  hue: getComputedStyle(document.getElementById("color-hue")).cursor
}));
ok(cursores.sv === "crosshair", `el cuadrado de saturación/valor sigue en cruz: era «${cursores.sv}»`);
ok(cursores.hue === "grab", `la rampa de matiz es una mano, no una cruz: era «${cursores.hue}»`);
await page.click("#color-cancel");
await page.click("#style-cancel");

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
