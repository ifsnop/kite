/* ---------- «Novedades»: what changed since the version the user last ran ----------
   A window shown at startup with a short, non-technical summary of what
   each release brought (one line per change, grouped by version). It
   lists the releases after the version the user last opened and up to
   the one running now; the first time ever, everything since 2.0. The
   user closes it with «Cerrar» or the ×; ticking «No volver a mostrar…»
   keeps it closed until the next version, which shows it again with its
   own changes.

   WHATS_NEW is the source of those texts, newest first. Rules (see
   .claude/rules/whats-new.md):
   - Every PR that changes something a user sees adds its line to the
     entry "next" (creating it at the top after a release): a sentence for the user, not for a developer (what they
     can now do, or what works better), in Spanish inside N_() and with
     its English in the dictionary.
   - "next" is never shown. When a release is prepared, it is renamed to
     the new version (tests/whatsnew.js fails if package.json's version
     has no entry).                                                     */
const WHATS_NEW = [
  { version: "2.7.0", items: [
    N_("La lista de mapas base sigue abierta al añadir, modificar o borrar una capa propia, también al cancelar."),
    N_("La ficha de información se reduce a sus pestañas aunque se le haya cambiado el tamaño, y lo recupera al volver a enseñar una ficha."),
    N_("La configuración de los mapas base (orden, activación, opacidad, capas propias y color de fondo) se guarda en un archivo con 💾 y se carga arrastrándolo al panel de navegación."),
    N_("La versión y el enlace a GitHub se ven siempre a la derecha de la línea inferior del mapa, aunque los créditos de los mapas no quepan."),
    N_("Itinerarios entre dos puntos en coche, en bicicleta o a pie, con su distancia y su tiempo, desde el menú del botón derecho y con su clave de openrouteservice (HeiGIT)."),
    N_("Las ventanas, y la ficha que recuerda su sitio, se abren siempre enteras dentro del navegador aunque la ventana sea ahora más pequeña."),
    N_("Con la casilla «Preferencias avanzadas» de Propiedades aparecen, en rojo, pestañas para ajustar tiempos, topes y tolerancias que antes eran fijos.")
  ] },
  { version: "2.6.0", items: [
    N_("La ficha de información es más tranquila: al pasar el ratón por muchos elementos ya no cambia con cada uno, y las fichas en las que te detienes quedan como pestañas que puedes volver a mirar y fijar."),
    N_("Todos los marcadores, formas y mediciones tienen su ficha, con su posición o sus medidas, aunque no traigan atributos."),
    N_("La ficha recuerda dónde la dejaste y de qué tamaño."),
    N_("Capas base propias: añade, renombra o elimina tus propios servidores de teselas o WMS desde el panel de mapas base."),
    N_("Esta ventana de novedades, que aparece al abrir una versión nueva.")
  ] },
  { version: "2.5.0", items: [
    N_("Artículos de Wikipedia cercanos: desde el menú del botón derecho, los artículos de la zona aparecen como marcadores con su resumen y un enlace al artículo.")
  ] },
  { version: "2.4.0", items: [
    N_("El buscador del panel filtra el árbol mientras escribes y deja solo lo que coincide, sin distinguir mayúsculas ni tildes."),
    N_("Con varias capas seleccionadas, la casilla y la lupa de una de ellas actúan sobre todas a la vez."),
    N_("La interfaz responde al instante al pulsar y respeta la preferencia del sistema de reducir el movimiento.")
  ] },
  { version: "2.3.0", items: [
    N_("Los polígonos con altura aparecen como obstáculos en el perfil de una ruta, que indica si tapan la línea entre las dos torres."),
    N_("Los archivos KML muy grandes ya no bloquean la página al cargarlos ni al volver a abrir la aplicación."),
    N_("Buscar unas coordenadas deja un marcador en «Lugares» y acerca el mapa a ese punto."),
    N_("El pin, los anillos de alcance y el sector se colocan con un clic en el mapa, y los anillos y el sector tienen su propio botón en la barra."),
    N_("Se puede desplazar el mapa mientras se dibuja un polígono o una ruta."),
    N_("La ventana de propiedades de una capa incluye la lupa para encuadrarla y el botón para borrarla."),
    N_("Botones A− y A+ para cambiar el tamaño de las cifras de elevación."),
    N_("La lista de mapas base se cierra al pulsar fuera de ella."),
    N_("El tamaño máximo de un KMZ se puede ajustar en Preferencias."),
    N_("Las tablas de atributos dejan más sitio a los valores."),
    N_("Los KML exportados ocupan bastante menos cuando las capas llevan fichas con formato.")
  ] },
  { version: "2.2.0", items: [
    N_("El buscador de lugares entiende coordenadas, en grados decimales o en grados, minutos y segundos."),
    N_("Deshacer y rehacer (Ctrl+Z y Ctrl+Y) también funcionan con el mapa seleccionado.")
  ] },
  { version: "2.1.0", items: [
    N_("El CSV del perfil de una ruta incluye las torres, la línea de vista y la zona de Fresnel."),
    N_("Tras recargar, el menú del botón derecho vuelve a ofrecer «Mostrar perfil» sobre una ruta.")
  ] },
  { version: "2.0.1", items: [
    N_("Los CSV del perfil y de la tabla de atributos siguen el idioma de la interfaz, para que la hoja de cálculo los abra bien.")
  ] }
];
/* The first time ever, the window lists everything after this version */
const WHATS_NEW_FIRST = "2.0.0";
const VERSION_RE = /^\d+\.\d+\.\d+$/;

function compareVersions(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

/* The released entries after `since` and up to `current`, newest first.
   "next" (and anything that is not a version) never passes.           */
function whatsNewEntries(list, since, current) {
  return list.filter(e => VERSION_RE.test(e.version)
      && compareVersions(e.version, since) > 0 && compareVersions(e.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/* What was saved is foreign input (another version, a tampered database) */
function validWhatsNewRecord(r) {
  if (!r || typeof r !== "object") return null;
  if (typeof r.shownFor !== "string" || !VERSION_RE.test(r.shownFor)) return null;
  if (typeof r.since !== "string" || !VERSION_RE.test(r.since)) return null;
  if (typeof r.dismissed !== "boolean") return null;
  return { shownFor: r.shownFor, since: r.since, dismissed: r.dismissed };
}

/* Decides, from what was saved, whether to show the window and from which
   version to list. Same version as last time: the same list, unless the
   user ticked «No volver a mostrar…». A newer version: from the one the
   user last ran, so the changes in between are not lost if they skipped a
   release; nothing saved (or a downgrade): since WHATS_NEW_FIRST. The
   record to keep is returned with it (`fresh`: it has to be saved).    */
function whatsNewPlan(saved, current) {
  if (!VERSION_RE.test(current)) return null;
  if (saved && saved.shownFor === current) return saved.dismissed ? null : { since: saved.since, record: saved, fresh: false };
  const since = saved && compareVersions(saved.shownFor, current) < 0 ? saved.shownFor : WHATS_NEW_FIRST;
  return { since, record: { shownFor: current, since, dismissed: false }, fresh: true };
}

/* DOM, bound the first time it opens (no DOM work when the file loads) */
let whatsNewUiCache = null;
let whatsNewRecord = null; /* the record of what is on screen, to save «No volver a mostrar» */
function whatsNewUi() {
  if (whatsNewUiCache) return whatsNewUiCache;
  const dialog = $id("whats-new");
  const box = dialog.querySelector(".dlg-box");
  setupDialog(box, { modal: true });
  makeDialogMovable(box);
  $id("whats-new-close").addEventListener("click", closeWhatsNew);
  whatsNewUiCache = { dialog, box, body: $id("whats-new-body"), dismiss: $id("whats-new-dismiss") };
  return whatsNewUiCache;
}
const isWhatsNewOpen = () => !!whatsNewUiCache && !whatsNewUiCache.dialog.hidden;

/* Plain text throughout: the texts are ours, but textContent costs nothing */
function renderWhatsNew(ui, entries, since) {
  ui.body.textContent = "";
  const intro = document.createElement("p");
  intro.className = "dlg-hint";
  intro.textContent = tr("Lo nuevo desde la versión {version}:", { version: since });
  ui.body.appendChild(intro);
  for (const entry of entries) {
    const head = document.createElement("h3");
    head.textContent = tr("Versión {version}", { version: entry.version });
    const list = document.createElement("ul");
    for (const item of entry.items) {
      const li = document.createElement("li");
      li.textContent = tr(item);
      list.appendChild(li);
    }
    ui.body.append(head, list);
  }
}

function openWhatsNew(entries, plan) {
  const ui = whatsNewUi();
  whatsNewRecord = plan.record;
  renderWhatsNew(ui, entries, plan.since);
  ui.dismiss.checked = false;
  ui.dialog.hidden = false;
  ui.body.scrollTop = 0;
  fitInViewport(ui.box);
  focusDialog(ui.box);
}

/* «Cerrar», the × and Escape all come here: the box decides whether the
   window comes back at the next start.                                 */
function closeWhatsNew() {
  if (!isWhatsNewOpen()) return;
  const ui = whatsNewUiCache;
  ui.dialog.hidden = true;
  releaseFocus();
  if (ui.dismiss.checked && whatsNewRecord) {
    dbSaveWhatsNew({ ...whatsNewRecord, dismissed: true }).catch(() => { /* not saved: it shows again */ });
  }
  whatsNewRecord = null;
}

/* Called at the end of the boot (99-boot.js). On a phone the «Mejor desde
   un ordenador» notice may be on screen: the window waits for it to close
   instead of stacking on it. The browser tests set `__kiteSkipWhatsNew`
   (tests/browser/_browser.mjs, stubTiles): a window at every start would
   cover what they click; browser/whats-new.mjs asks for it.            */
async function showWhatsNewAtBoot() {
  if (window.__kiteSkipWhatsNew) return;
  let saved = null;
  try { saved = await dbLoadWhatsNew(); } catch { /* nothing saved: as the first time */ }
  const plan = whatsNewPlan(saved, VERSION);
  if (!plan) return;
  const entries = whatsNewEntries(WHATS_NEW, plan.since, VERSION);
  if (!entries.length) return;
  if (plan.fresh) dbSaveWhatsNew(plan.record).catch(() => { /* lists from the same version next time anyway */ });
  const open = () => openWhatsNew(entries, plan);
  if (!mobileDialog.hidden) mobileNoticeThen = open;
  else open();
}
