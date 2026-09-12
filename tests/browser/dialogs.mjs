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
const CON_RESIZE = new Set(["style-dialog", "icon-picker", "shortcuts", "desc-dialog",
  "geojson-name-picker", "gnp-editor", "points-dialog", "log-dialog"]);

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
    "color-picker": () => { openStyleDialog(liM); openColorPicker(document.getElementById("mk-color")); },
    "kml-tags-picker": () => confirmStripHtmlTags("archivo.kml"),
    "kml-dup-picker": () => { document.getElementById("kml-dup-picker").hidden = false; },
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
    out.push({
      id, arriba, abajo,
      scrollea: box.scrollHeight - box.clientHeight > 1,
      resize: getComputedStyle(box).resize
    });
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
  ok(m && m.scrollea, `${id}: su contenido sigue desbordando, y aun así los botones se ven`);
}

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

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await ctx.close();
await browser.close();
srv.close();
done();
