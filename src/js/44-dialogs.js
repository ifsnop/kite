/* ---------- Registro de avisos ----------
   Ventana al `msgLog` de la sesión (ver navMessage). Existe porque un
   aviso transitorio se va a los MSG_TIMEOUT y antes no quedaba rastro
   de él.                                                              */
const logDialog = document.getElementById("log-dialog");
const logBox = logDialog.querySelector(".dlg-box");

/* Se busca el botón por id en cada llamada, no con una constante de
   módulo: navMessage llama aquí y hay un aviso a nivel de módulo en un
   archivo ANTERIOR (el de aceleración por hardware), cuando una `const`
   de este archivo estaría todavía en su zona muerta temporal.        */
function refreshLogButton() {
  const btn = document.getElementById("log-btn");
  if (!btn) return;
  btn.classList.toggle("unseen", msgLogUnseen > 0);
  btn.title = msgLogUnseen
    ? `Registro de avisos (${msgLogUnseen} sin ver)`
    : "Registro de avisos";
}

function renderLog() {
  const list = document.getElementById("log-list");
  list.textContent = "";
  if (!msgLog.length) {
    const p = document.createElement("p");
    p.className = "log-empty";
    p.textContent = "No hay avisos en esta sesión.";
    list.appendChild(p);
    return;
  }
  /* Orden cronológico, lo más reciente al final: se lee como un fichero
     de log, y como el propio panel, donde los avisos nuevos se añaden
     debajo de los anteriores.                                         */
  for (const e of msgLog) {
    const row = document.createElement("div");
    row.className = `log-row ${e.tone}`;
    const time = document.createElement("time");
    time.className = "log-time";
    time.textContent = msgStamp(e.first);
    const mark = document.createElement("span");
    mark.className = "log-mark";
    if (e.sticky) { mark.textContent = "!"; mark.title = "Exigía confirmación"; }
    const text = document.createElement("span");
    text.className = "log-text";
    text.textContent = e.text;
    if (e.count > 1) {
      const rep = document.createElement("span");
      rep.className = "log-rep";
      rep.textContent = ` ×${e.count}, última ${msgStamp(e.last)}`;
      text.appendChild(rep);
    }
    row.append(time, mark, text);
    list.appendChild(row);
  }
}

function toggleLog() {
  if (!logDialog.hidden) { logDialog.hidden = true; releaseFocus(); return; }
  renderLog();
  msgLogUnseen = 0;
  refreshLogButton();
  logDialog.hidden = false;
  clampToViewport(logBox);
  focusDialog(logBox);
  /* Con lo más reciente abajo, hay que bajar el scroll o habría que
     desplazarse a mano justo a lo que se viene a consultar.          */
  const list = document.getElementById("log-list");
  list.scrollTop = list.scrollHeight;
}
document.getElementById("log-btn").addEventListener("click", toggleLog);
document.getElementById("log-close").addEventListener("click", toggleLog);
document.getElementById("log-clear").addEventListener("click", () => {
  msgLog.length = 0;
  msgLogUnseen = 0;
  refreshLogButton();
  renderLog();
});
document.getElementById("log-copy").addEventListener("click", () => {
  const txt = logText();
  if (!txt) { navMessage("El registro está vacío.", { tone: "info" }); return; }
  navigator.clipboard.writeText(txt)
    .then(() => navMessage("Registro copiado al portapapeles.", { tone: "info" }))
    .catch(() => navMessage("No se pudo copiar al portapapeles."));
});

/* ---------- Añadir contenido desde una dirección (URL) ----------
   Dos pasos, y son dos a propósito: lo que llega de una dirección
   arbitraria puede ser cualquier cosa —una página de error, un HTML, un
   formato que no entendemos—, así que primero se descarga y se dice QUÉ
   ha llegado, y solo entonces el usuario decide meterlo en el árbol. Es
   la misma edición diferida del resto de diálogos: hasta «Añadir al
   árbol» no se toca nada.

   Lo descargado se envuelve en un `File` y se entrega a
   handleDroppedFiles, así que no se duplica ni una línea del camino de
   importación: mismos formatos, mismos diálogos (etiquetas HTML,
   propiedad-nombre, duplicados), mismo informe y mismo guardado.

   VA AQUÍ, por encima del registro de diálogos del final del archivo:
   `urlBox` se usa en ese bucle, que corre al EVALUAR el archivo, y
   declararlo por debajo reventaría al cargar por zona muerta temporal
   —el mismo tropiezo que ya costó una tarde con `descBody`—.        */
const URL_TIMEOUT = 20000;                 /* tope de respuesta        */
const URL_MAX_BYTES = 100 * 1024 * 1024;   /* tope de descarga         */

const urlDialog = document.getElementById("url-dialog");
const urlBox = urlDialog.querySelector(".dlg-box");
const urlInput = document.getElementById("url-input");
const urlStatus = document.getElementById("url-status");
const urlFetchBtn = document.getElementById("url-fetch");
const urlAddBtn = document.getElementById("url-add");

let urlAbort = null;   /* descarga en vuelo, para poder cancelarla     */
let urlSeq = 0;        /* descarta respuestas superadas, como placeSeq */
let urlReady = null;   /* el borrador: { file, kind, size } o null     */

/* Un único punto que mueve TODOS los controles: nadie toca `disabled`
   ni `hidden` por su cuenta, que es como se acaba con un botón activo
   en un estado que no lo admite.                                     */
function setUrlState(state, text = "", bad = false) {
  const descargando = state === "descargando";
  urlInput.disabled = descargando;
  /* Durante la descarga el botón primario CAMBIA DE PAPEL en vez de
     deshabilitarse: esperar a que venza el tope de 20 s no es una
     salida aceptable para quien acaba de pegar una dirección enorme. */
  urlFetchBtn.textContent = descargando ? "Cancelar descarga" : "Descargar";
  /* Con el resultado ya en la mano, volver a descargar la MISMA
     dirección no hace nada que no esté hecho: quedan las dos salidas
     que sí significan algo, añadirlo o cerrar. Y no es un callejón:
     tocar la dirección invalida ese resultado y devuelve el diálogo al
     estado inicial, con «Descargar» otra vez activo.                 */
  urlFetchBtn.disabled = state === "listo";
  urlAddBtn.hidden = state !== "listo";
  urlStatus.hidden = !text;
  urlStatus.textContent = text;
  urlStatus.classList.toggle("sh-bad", bad);
}

/* Aborta lo que haya en vuelo. `motivo` viaja al `catch` para poder
   distinguir el tope de tiempo de una cancelación del usuario.       */
function abortUrlFetch(motivo) {
  urlSeq++;
  if (urlAbort) { urlAbort.abort(motivo); urlAbort = null; }
}

function closeUrlDialog() {
  /* Cerrar aborta: una descarga cuyo resultado ya no tiene dónde
     mostrarse solo ocupa conexión.                                   */
  abortUrlFetch("cerrado");
  urlReady = null;
  urlDialog.hidden = true;
  releaseFocus();
}

function openUrlDialog() {
  urlReady = null;
  setUrlState("inicial");
  urlDialog.hidden = false;
  clampToViewport(urlBox);
  focusDialog(urlBox);
  urlInput.focus();
  /* Seleccionado, no borrado: lo normal al reabrir es corregir una
     errata de la dirección anterior.                                 */
  urlInput.select();
}

/* La descarga. Devuelve los bytes o lanza con un mensaje ya redactado.

   La petición es deliberadamente SIMPLE: sin cabeceras propias y sin
   credenciales. Cualquier cabecera no simple obliga al navegador a un
   preflight OPTIONS que la mayoría de los alojamientos estáticos no
   contesta, y convertiría en fallo lo que ahora funciona; y las cookies
   del usuario no tienen nada que hacer en una descarga hacia un tercero.
   Es justo el cambio «inocente» que alguien haría más adelante.      */
async function fetchRemoteFile(url, signal, onBytes) {
  const resp = await fetch(url, { signal, credentials: "omit", redirect: "follow" });
  if (!resp.ok) throw new Error(`No se pudo descargar: ${describeHttp(resp.status)}.`);

  /* Lo que el servidor DICE que ocupa, antes de traerse nada: es la
     comprobación barata y evita empezar una descarga condenada.      */
  const declarado = Number(resp.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > URL_MAX_BYTES) {
    throw new Error(`El archivo ocupa ${fmtBytes(declarado)} y supera el tope de `
      + `${fmtBytes(URL_MAX_BYTES)}.`);
  }

  /* Y lo que ocupa DE VERDAD, mientras llega: content-length puede
     faltar (respuesta troceada) o mentir. Leer por trozos es además lo
     que hace que cancelar surta efecto en el acto y lo que permite ir
     diciendo cuánto lleva descargado.                                */
  if (!resp.body || !resp.body.getReader) {
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > URL_MAX_BYTES) {
      throw new Error(`La descarga ocupa ${fmtBytes(buf.byteLength)} y supera el tope de `
        + `${fmtBytes(URL_MAX_BYTES)}.`);
    }
    return new Uint8Array(buf);
  }
  const reader = resp.body.getReader();
  const trozos = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > URL_MAX_BYTES) {
      reader.cancel();
      throw new Error(`La descarga ya supera el tope de ${fmtBytes(URL_MAX_BYTES)} `
        + "y se ha interrumpido.");
    }
    trozos.push(value);
    if (onBytes) onBytes(total);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const t of trozos) { out.set(t, pos); pos += t.length; }
  return out;
}

/* Paso 1: descargar y reconocer. No toca el árbol. */
async function runUrlFetch() {
  /* Se quitan TODOS los blancos, no solo los de los extremos: una
     dirección no puede llevarlos, y copiarla de un correo o de un PDF
     arrastra saltos de línea con una facilidad pasmosa. Antes eso daba
     un «no parece una dirección válida» que el usuario no entendía,
     porque lo que él veía pegado estaba bien.                        */
  const url = urlInput.value.replace(/\s+/g, "");
  if (!url) { setUrlState("error", "Escriba la dirección del archivo que quiere descargar.", true); return; }
  let parsed;
  try { parsed = new URL(url); } catch { parsed = null; }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    setUrlState("error", `«${url}» no parece una dirección válida. Debe empezar por `
      + "http:// o https://.", true);
    return;
  }
  /* La CSP admite https: y nada más. Sin este aviso, el rechazo llega
     como el mismo TypeError sin detalle que un fallo de CORS y el
     usuario se pondría a buscar por donde no es.                     */
  if (parsed.protocol === "http:" && location.protocol === "https:") {
    setUrlState("error", "La dirección usa http://. Desde una página servida por https "
      + "solo se pueden descargar direcciones https://.", true);
    return;
  }

  abortUrlFetch("reemplazada");
  urlReady = null;
  const seq = ++urlSeq;
  const ctrl = urlAbort = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), URL_TIMEOUT);
  setUrlState("descargando", "Descargando…");
  try {
    const bytes = await fetchRemoteFile(url, ctrl.signal,
      n => { if (seq === urlSeq) setUrlState("descargando", `Descargando… ${fmtBytes(n)}`); });
    if (seq !== urlSeq) return; /* superada o cancelada: no pinta nada */
    if (!bytes.length) { setUrlState("error", "La descarga ha llegado vacía (0 bytes).", true); return; }

    /* Los bytes primero (un zip no se decodifica), el texto después */
    let texto = "";
    try { texto = new TextDecoder("utf-8").decode(bytes); } catch { texto = ""; }
    const kind = sniffContentKind(bytes, texto);
    if (kind === "html") {
      setUrlState("error", "Lo descargado es una página web (HTML), no un archivo de datos. "
        + "Compruebe que la dirección apunta al archivo en crudo (en GitHub, el enlace «Raw»).", true);
      return;
    }
    if (!kind) {
      setUrlState("error", `No se reconoce el contenido descargado (${fmtBytes(bytes.length)}). `
        + "Formatos admitidos: KML, KMZ, JSON (GeoJSON), TopoJSON y carpetas "
        + `exportadas (${EXPORT_EXT}).`, true);
      return;
    }
    const name = downloadFileName(url, kind);
    urlReady = { file: new File([bytes], name), kind, size: bytes.length };
    setUrlState("listo", `«${name}» — ${URL_KIND_LABEL[kind]}, ${fmtBytes(bytes.length)}. `
      + "Pulse «Añadir al árbol» para insertarlo en una carpeta nueva.");
    urlAddBtn.focus();
  } catch (err) {
    if (seq !== urlSeq) return;
    /* Cancelar NO es un fallo: no se pinta en rojo ni se registra. El
       tope de tiempo sí, y llega por el mismo camino, así que se
       distinguen por el motivo del abort.                            */
    if (err.name === "AbortError") {
      if (ctrl.signal.reason === "timeout") {
        setUrlState("error", `El servidor ha tardado más de ${URL_TIMEOUT / 1000} s en responder.`, true);
      } else {
        setUrlState("inicial", "Descarga cancelada.");
      }
      return;
    }
    /* Un fallo de red llega como TypeError SIN ningún detalle: el
       navegador no le cuenta a la página por qué. Con diferencia, la
       causa más frecuente es que el servidor no mande cabeceras CORS,
       así que el mensaje lo dice y ofrece la salida que siempre
       funciona en vez de dejar al usuario mirando «Failed to fetch». */
    const msg = err instanceof TypeError
      ? "No se ha podido conectar. Lo más probable es que el servidor no autorice la "
        + "descarga desde otra página (CORS); el navegador no da más detalle. También "
        + "puede ser que la dirección no exista o que no haya conexión. Si puede abrir "
        + "el archivo en el navegador, descárguelo y arrástrelo al recuadro."
      : err.message;
    setUrlState("error", msg, true);
    navMessage(`No se pudo descargar «${url}»: ${msg}`);
  } finally {
    clearTimeout(timer);
    if (urlAbort === ctrl) urlAbort = null;
  }
}

document.getElementById("url-btn").addEventListener("click", openUrlDialog);
document.getElementById("url-close").addEventListener("click", closeUrlDialog);
urlFetchBtn.addEventListener("click", () => {
  /* El mismo botón hace las dos cosas según el estado: descargar, o
     cancelar lo que esté descargando.                                */
  if (urlFetchBtn.textContent === "Cancelar descarga") {
    abortUrlFetch("cancelada");
    setUrlState("inicial", "Descarga cancelada.");
    urlInput.focus();
    return;
  }
  runUrlFetch();
});
urlAddBtn.addEventListener("click", async () => {
  if (!urlReady) return;
  const { file } = urlReady;
  /* Se cierra ANTES de importar: la importación abre sus propios
     modales (etiquetas HTML, propiedad-nombre, duplicados) y no deben
     apilarse sobre este. Del resumen, el progreso y el guardado se
     encarga ya handleDroppedFiles, como con cualquier archivo.       */
  closeUrlDialog();
  /* Todo lo descargado cuelga de UNA sección «Descargas», como
     «Lugares», «Marcadores», «Polígonos» o «Elevaciones»: se localiza
     por nombre con ensureNamedSection, así que se reutiliza entre
     descargas y sobrevive a la restauración sin enganche especial.

     Y dentro, cada descarga en su propia «Descarga N», numerada con el
     mismo nextNumberedName que las formas dibujadas, las mediciones y
     los pines: deduce el número de los nombres que ya hay en el árbol
     —pendientes incluidos—, así que sobrevive a una recarga y manda el
     máximo, no la cuenta. Es exactamente la forma de «Elevaciones» con
     sus «Elevación N» dentro.

     La carpeta hace falta: sin ella el resultado depende del formato
     —un GeoJSON crea su envoltorio y un KML vuelca su jerarquía tal
     cual—, de modo que dos descargas se mezclarían dentro de la
     sección sin saberse cuál trajo qué.                             */
  pushUndo("añadir desde una dirección");
  const seccion = ensureNamedSection("Descargas");
  const carpeta = await createFolderNode(seccion.parentElement,
    nextNumberedName("Descarga"));
  await handleDroppedFiles([file], null, nodeUl(carpeta));
  /* El conjunto de hijos de la carpeta nueva ha cambiado: su casilla
     tiene que recalcularse, como en cualquier importación dentro de
     una carpeta.                                                     */
  refreshAncestorChecks(carpeta);
  scheduleSave();
});
/* Editar la dirección invalida una descarga ya lista: si no, se podría
   descargar A, escribir B y pulsar «Añadir» insertando A.           */
urlInput.addEventListener("input", () => {
  if (urlReady) { urlReady = null; setUrlState("inicial"); }
});
urlInput.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  /* Enter dispara la acción primaria VISIBLE */
  if (!urlAddBtn.hidden) urlAddBtn.click(); else urlFetchBtn.click();
});

/* ---------- Diálogo de la credencial de Copernicus ----------
   Edición diferida como el resto: se escribe en la caja y solo
   «Aceptar» la guarda y rearma la capa.                              */
const shDialog = document.getElementById("sh-creds");
const shBox = shDialog.querySelector(".dlg-box");
const shInput = document.getElementById("sh-instance");
const shErrorEl = document.getElementById("sh-error");

function closeShCredsDialog() {
  shDialog.hidden = true;
  releaseFocus();
}
function openShCredsDialog() {
  shInput.value = shInstanceId || "";
  shErrorEl.hidden = true;
  shDialog.hidden = false;
  clampToViewport(shBox);
  focusDialog(shBox);
  shInput.focus();
  shInput.select();
}
document.getElementById("sh-cancel").addEventListener("click", closeShCredsDialog);
document.getElementById("sh-clear").addEventListener("click", () => {
  /* Borrar actúa sobre el campo, no sobre el diálogo: cerrarlo obligaría
     a reabrirlo para escribir otra credencial, que es justo lo que se
     suele querer hacer después.                                        */
  setInstanceId(null);
  shInput.value = "";
  shErrorEl.hidden = true;
  shInput.focus();
  navMessage("Credencial de Copernicus borrada.", { tone: "info" });
});
document.getElementById("sh-accept").addEventListener("click", () => {
  const txt = shInput.value.trim();
  if (!validInstanceId(txt)) {
    /* No cerrar con un valor inválido: mismo criterio que las
       coordenadas del diálogo de estilos.                            */
    shErrorEl.textContent = "El instance ID debe ser un UUID como "
      + "12345678-90ab-cdef-1234-567890abcdef.";
    shErrorEl.hidden = false;
    shInput.focus();
    return;
  }
  setInstanceId(txt);
  closeShCredsDialog();
});

const descDialog = document.getElementById("desc-dialog");
const descBox = descDialog.querySelector(".dlg-box");
const descTitle = document.getElementById("desc-title");
const descBody = document.getElementById("desc-body");
document.getElementById("desc-close").addEventListener("click", () => {
  descDialog.hidden = true;
  layerInfoDismissed = true;
  releaseFocus();
});
/* ---------- Separador de las dos columnas de la ficha ----------
   Las properties son siempre clave/valor, así que la tabla tiene DOS
   columnas y el reparto entre ellas se puede mover: hay nombres cortos
   con valores larguísimos y al revés.

   VIVE AQUÍ, no junto a showLayerInfo, por una razón de ORDEN: el
   listener se registra al evaluar el archivo y `descBody` se declara
   en ESTE, que carga después de 32-geojson.js. Registrarlo allí
   reventaba por zona muerta temporal al cargar la página —y sin
   ruido: lo que se veía era que `escapeHtml`, de un archivo
   posterior, «no estaba inicializado»—. `node --check` no lo
   detecta. Ver el punto 10 del checklist.

   Se guarda como FRACCIÓN, no en píxeles: la ficha se redimensiona, y
   un ancho en píxeles quedaría desproporcionado en cuanto la ventana
   cambiara de tamaño. Se recuerda entre aperturas —como posFormat o
   measureUnit— y no persiste entre sesiones.                         */
let propsKeyFrac = 0.38;
const PROPS_MIN_FRAC = 0.12; /* que ninguna de las dos columnas desaparezca */

function applyPropsSplit() {
  descBody.style.setProperty("--props-key", (propsKeyFrac * 100).toFixed(2) + "%");
}

/* El reparto SÍ persiste entre sesiones, a diferencia de la unidad de
   medida o del formato de coordenadas: aquellos se cambian sobre la
   marcha para mirar un dato y se vuelven a cambiar, mientras que este
   depende de cómo son los archivos con los que uno trabaja —nombres
   cortos y valores largos, o al revés— y sería el mismo ajuste en cada
   arranque. Va en otra clave del MISMO almacén.                      */
function setPropsSplit(frac, { save = false } = {}) {
  propsKeyFrac = Math.min(1 - PROPS_MIN_FRAC, Math.max(PROPS_MIN_FRAC, frac));
  applyPropsSplit();
  /* Solo al soltar: guardar en cada pixel del arrastre castigaría a
     IndexedDB para nada.                                             */
  if (save) dbSaveProps(propsKeyFrac).catch(() => {});
}

/* Delegado en el cuerpo de la ficha, no atado a cada tabla: el HTML se
   reemplaza entero cada vez que se abre otra capa, y un listener por
   tabla habría que volver a poner en cada apertura.
   Eventos de PUNTERO, como el arrastre de los diálogos: valen igual
   para ratón, lápiz y dedo.                                          */
descBody.addEventListener("pointerdown", e => {
  const grip = e.target.closest && e.target.closest(".props-grip");
  if (!grip) return;
  const wrap = grip.parentElement;
  e.preventDefault();
  grip.classList.add("dragging");
  /* La captura mantiene los eventos aquí aunque el puntero se salga de
     la ficha, que es lo que evita que el arrastre se quede pegado.  */
  grip.setPointerCapture(e.pointerId);
  const onMove = ev => {
    const r = wrap.getBoundingClientRect();
    if (!r.width) return;
    setPropsSplit((ev.clientX - r.left) / r.width);
  };
  const onUp = () => {
    setPropsSplit(propsKeyFrac, { save: true });
    grip.removeEventListener("pointermove", onMove);
    grip.removeEventListener("pointerup", onUp);
    grip.removeEventListener("pointercancel", onUp);
    grip.classList.remove("dragging");
  };
  grip.addEventListener("pointermove", onMove);
  grip.addEventListener("pointerup", onUp);
  grip.addEventListener("pointercancel", onUp);
});


/* colorPicker is NOT in this list: it is a popover anchored to whichever
   button opened it (see openColorPicker/positionColorPicker), not a
   draggable window with its own dialog role — that separate-window
   treatment is exactly what the popover replaced.                    */
for (const box of [styleBox, iconBox, descBox, shortcutsBox, ktpBox, kdpBox, gnpBox, gnpEditorBox, shBox, pointsBox, logBox, urlBox]) makeDialogMovable(box);
setupDialog(styleBox, { modal: false }); /* flotante: el mapa sigue vivo */
setupDialog(iconBox, { modal: true });
setupDialog(descBox, { modal: false });
setupDialog(shortcutsBox, { modal: true });
setupDialog(ktpBox, { modal: true });
setupDialog(kdpBox, { modal: true });
setupDialog(gnpBox, { modal: true });
setupDialog(gnpEditorBox, { modal: true });
setupDialog(shBox, { modal: true });
setupDialog(pointsBox, { modal: true });
setupDialog(logBox, { modal: true });
setupDialog(urlBox, { modal: true });
window.addEventListener("resize", () => {
  /* a moved dialog must not fall off-screen */
  for (const box of [styleBox, iconBox, descBox, shortcutsBox, ktpBox, kdpBox, gnpBox, gnpEditorBox, shBox, pointsBox, logBox, urlBox]) clampToViewport(box);
  /* the popover's anchor button may have moved too; closing is simpler
     and less confusing than reclamping a stale position              */
  if (!colorPicker.hidden) closeColorPicker();
});
let styleTargets = [];    /* nodes being edited */
let styleKindOpen = null; /* "marker" | "polygon" */
let styleDraft = null;    /* working copy shown by the controls */
let pendingIcon = null;   /* icon highlighted in the picker, not yet accepted */
let posFormat = "dms";    /* coordinate notation, toggled with the ⇅ button */
let posMarker = null;     /* sole marker whose position is being edited */
let posOriginal = null;   /* its position when the dialog opened */
let styleIsNew = false;   /* pin just created: cancelling removes it again */
/* Con varios nodos seleccionados casi nada tiene por qué coincidir. Dos
   conjuntos llevan la cuenta: `styleMixed` son las propiedades que NO
   valen lo mismo en todos (el diálogo lo enseña y NO las aplica si el
   usuario no las toca, o pulsar Aceptar igualaría en silencio lo que
   solo se estaba mirando), y `styleTouched` las que el usuario ha movido
   de verdad, que son las únicas que se aplican en bloque. Con un solo
   nodo `styleMixed` queda vacío y todo se aplica como siempre.        */
let styleMixed = new Set();
let styleTouched = new Set();

/* Qué propiedad del borrador toca cada control. Sirve para lo mismo en
   los dos sentidos: marcar el control cuando los nodos no coinciden y
   anotar lo que el usuario toca. `pg-mode` vale por DOS propiedades
   (stroke y fill), así que viaja con nombre propio.                   */
const CONTROL_PROP = {
  "mk-color": "color", "mk-size": "size", "mk-text-size": "textSize",
  "mk-text-color": "textColor", "mk-text-always": "textAlways",
  "pg-mode": "mode", "pg-weight": "weight", "pg-color": "color",
  "pg-fill-color": "fillColor", "pg-fill-opacity": "fillOpacity",
  "pg-text-always": "textAlways",
  "ms-weight": "weight", "ms-color": "color", "ms-fill-color": "fillColor",
  "ms-fill-opacity": "fillOpacity",
  "io-opacity": "opacity"
};

const dlgRowOf = el => el.closest(".dlg-row");
function markMixedRow(el, mixed) {
  const row = dlgRowOf(el);
  if (row) row.classList.toggle("mixed", mixed);
}
/* Un número puede quedarse vacío, y es lo más honesto: sin valor común
   no hay número que enseñar. Lo dice su marcador de posición.        */
function setNumberControl(el, value, mixed) {
  el.value = mixed ? "" : value;
  el.placeholder = mixed ? "varios" : "";
  markMixedRow(el, mixed);
}
/* Un rango y un selector no pueden quedarse en blanco, así que enseñan
   el valor del primero y la marca de la fila avisa de que no es el de
   todos.                                                             */
function setValueControl(el, value, mixed) {
  el.value = value;
  markMixedRow(el, mixed);
}
/* Una casilla sí tiene tercer estado, y es exactamente este: el mismo
   guion nativo con el que una carpeta del árbol dice "unos sí y otros
   no".                                                               */
function setCheckControl(el, on, mixed) {
  el.checked = !!on;
  el.indeterminate = mixed;
  markMixedRow(el, mixed);
}
function setColorControl(btn, hex, mixed) {
  setColorButton(btn, hex);
  markMixedRow(btn, mixed);
}

/* Tocar un control lo saca de la mezcla: deja de estar marcado y, desde
   ese momento, su valor se aplicará a TODOS los nodos. Se registra por
   delegación para que un control nuevo no dependa de acordarse de
   añadirlo aquí; los colores no pasan por `input` y avisan a mano
   desde el selector de color, y el icono desde su selector.          */
function touchControl(el) {
  if (!el || !styleDraft) return;
  const prop = CONTROL_PROP[el.id];
  if (!prop) return;
  styleTouched.add(prop);
  if (el.type === "checkbox") el.indeterminate = false;
  if (el.placeholder) el.placeholder = "";
  markMixedRow(el, false);
}
/* Lo que de verdad se escribe en cada nodo: una propiedad que no era
   igual en todos y que nadie ha tocado se queda como estaba en CADA
   uno. Con un solo nodo (o con varios que ya coincidían) esto devuelve
   el borrador entero, que es el comportamiento de siempre.           */
function draftProps(props) {
  const out = {};
  for (const k of props) {
    if (!styleMixed.has(k) || styleTouched.has(k)) out[k] = styleDraft[k];
  }
  return out;
}
/* Las propiedades en las que los nodos NO coinciden. `read` saca el
   valor comparable de cada nodo; se compara con === porque todas son
   números, cadenas o booleanos.                                      */
function mixedProps(values, props) {
  const out = new Set();
  for (const k of props) {
    if (values.some(v => v[k] !== values[0][k])) out.add(k);
  }
  return out;
}

/* Nombres de varios nodos en una sola línea. Un árbol puede traer
   nombres larguísimos —los de un KML llegan a tener cientos de
   caracteres— y el campo es estrecho, así que se van juntando mientras
   quepan y el resto se resume contándolo.                            */
const NAMES_PREVIEW_MAX = 40;
function joinNames(names, max = NAMES_PREVIEW_MAX) {
  const clip = s => (s.length > max ? s.slice(0, max - 1) + "…" : s);
  const out = [];
  let len = 0;
  for (const n of names) {
    const add = (out.length ? 2 : 0) + Math.min(n.length, max);
    if (out.length && len + add > max) break;
    out.push(clip(n));
    len += add;
  }
  const rest = names.length - out.length;
  return rest ? `${out.join(", ")} y ${rest} más` : out.join(", ");
}

function openStyleDialog(li, { isNew = false } = {}) {
  /* The dialog is not modal, so another row's button may be pressed while
     it is open: that cancels the edit in progress before retargeting    */
  if (!styleDialog.hidden) closeStyleDialog(false);
  /* El panel de información (hover) es igual de flotante y puede quedar
     justo en el mismo sitio, tapando este diálogo sin ningún aviso de
     que hay algo debajo: se cierra antes de mostrar el de edición.    */
  if (!descDialog.hidden) descDialog.hidden = true;
  const kind = styleKind(li);
  if (kind !== "marker" && kind !== "polygon" && kind !== "measure" && kind !== "imageOverlay") {
    navMessage("Esta capa no tiene estilos editables.");
    return;
  }
  /* Como borrar o arrastrar: actuar sobre un nodo seleccionado actúa
     sobre toda la selección. Ya se puede seleccionar de todo, así que
     aquí es donde se comprueba que la mezcla sea editable en bloque. */
  const inSelection = selection.has(li) && selection.size > 1;
  styleTargets = inSelection ? topLevelSelection().filter(n => !nodeUl(n)) : [li];
  const kinds = new Set(styleTargets.map(styleKind));
  if (kinds.size > 1) {
    const names = [...kinds].map(k => KIND_LABEL[k] || k).join(" y ");
    navMessage(`La selecci\u00F3n mezcla ${names}: los nodos de distinto tipo no se`
      + " pueden editar de forma conjunta. Deje seleccionados solo los del mismo tipo.",
      { sticky: true });
    styleTargets = [];
    return;
  }
  styleKindOpen = kind;
  styleIsNew = isNew;
  $id("style-title").textContent = styleTargets.length > 1
    ? `Estilo de ${styleTargets.length} capas` : `Estilo: ${li._name}`;
  $id("style-marker").hidden = kind !== "marker";
  $id("style-polygon").hidden = kind !== "polygon";
  $id("style-measure").hidden = kind !== "measure";
  $id("style-imageoverlay").hidden = kind !== "imageOverlay";
  const single = styleTargets.length === 1;
  styleMixed = new Set();
  styleTouched = new Set();
  /* El nombre es propio de cada nodo, pero con varios el campo NO se
     deja en blanco: enseña los que hay, en gris y cursiva porque no es
     un valor sino una lista de lo que hay dentro. Va de marcador de
     posición y no de valor a propósito — así "no lo he tocado" es
     exactamente "el campo está vacío", sin ninguna bandera que
     mantener, y aceptar sin escribir no puede renombrarlo todo con el
     resumen.                                                          */
  $id("name-row").hidden = false;
  $id("mk-name").value = single ? styleTargets[0]._name : "";
  $id("mk-name").placeholder = single ? "" : joinNames(styleTargets.map(t => t._name));
  markMixedRow($id("mk-name"), !single);

  /* The draft starts from the first target: with a multi-selection its
     style is the one offered as the common starting point             */
  if (kind === "marker") {
    const mstyles = styleTargets.map(t => ({ ...DEFAULT_MARKER_STYLE, ...(t._mstyle || {}) }));
    styleDraft = { ...mstyles[0] };
    styleMixed = mixedProps(mstyles,
      ["icon", "color", "size", "textSize", "textColor", "textAlways"]);
    setColorControl($id("mk-color"), styleDraft.color, styleMixed.has("color"));
    setNumberControl($id("mk-size"), styleDraft.size, styleMixed.has("size"));
    setNumberControl($id("mk-text-size"), styleDraft.textSize, styleMixed.has("textSize"));
    setColorControl($id("mk-text-color"), styleDraft.textColor, styleMixed.has("textColor"));
    setCheckControl($id("mk-text-always"), styleDraft.textAlways, styleMixed.has("textAlways"));
    markMixedRow($id("icon-preview-btn"), styleMixed.has("icon"));
    $id("icon-preview").src = iconUrl(styleDraft.icon, styleDraft.color, 20);

    /* Text and position only apply to a single marker, so those rows stay
       hidden for multi-selections and for layers with several markers    */
    /* Con varios nodos no hay nombre ni posición que editar: son propios
       de cada uno. Lo demás (color, tamaños, texto) sí va en bloque.  */
    posMarker = styleTargets.length === 1 ? soleMarker(styleTargets[0]) : null;
    $id("mk-single").hidden = !posMarker;
    if (posMarker) {
      posOriginal = posMarker.getLatLng();
      styleDraft.lat = posOriginal.lat;
      styleDraft.lng = posOriginal.lng;
      renderCoords();
      /* Dragging is live by nature: it moves the marker right away and
         feeds the inputs. "Cancelar" puts it back where it was.        */
      setMarkerDraggable(posMarker, true);
      posMarker.on("drag", onMarkerDragged);
      /* A hidden layer has no icon on the map, so there is nothing to drag */
      $id("mk-drag-hint").hidden = !posMarker._map;
    }
  } else if (kind === "polygon") {
    const styles = styleTargets.map(t => normalizePathStyle(t._style));
    styleDraft = { ...styles[0] };
    styleMixed = mixedProps(styles,
      ["weight", "color", "fillColor", "fillOpacity", "textAlways"]);
    /* El modo son DOS booleanos en un solo selector: la mezcla se
       calcula sobre lo que el selector muestra, no sobre cada uno.   */
    if (styles.some(s => polygonModeOf(s) !== polygonModeOf(styles[0]))) styleMixed.add("mode");
    /* Una forma abierta solo puede tener contorno. Las opciones con
       relleno y los controles del relleno se DESHABILITAN, no se
       esconden: en gris se ve que existen y que aquí no aplican, que es
       más explicativo que hacerlas desaparecer. El modo queda además
       fijado en "stroke" para que readPolygonControls no pueda devolver
       fill:true aunque algo se saltara la interfaz.                   */
    const openOnly = styleTargets.every(isOpenOnly);
    for (const opt of $id("pg-mode").options) {
      if (opt.value !== "stroke") opt.disabled = openOnly;
    }
    $id("pg-fill-color").disabled = openOnly;
    $id("pg-fill-opacity").disabled = openOnly;
    $id("pg-fill-color-row").classList.toggle("dim", openOnly);
    $id("pg-fill-opacity-row").classList.toggle("dim", openOnly);
    setValueControl($id("pg-mode"), openOnly ? "stroke" : polygonModeOf(styleDraft),
      !openOnly && styleMixed.has("mode"));
    setNumberControl($id("pg-weight"), styleDraft.weight, styleMixed.has("weight"));
    setColorControl($id("pg-color"), styleDraft.color, styleMixed.has("color"));
    setColorControl($id("pg-fill-color"), styleDraft.fillColor, styleMixed.has("fillColor"));
    setValueControl($id("pg-fill-opacity"), styleDraft.fillOpacity, styleMixed.has("fillOpacity"));
    setCheckControl($id("pg-text-always"), styleDraft.textAlways, styleMixed.has("textAlways"));

    /* Solo con un único nodo (geometría propia de cada uno, igual que la
       posición de un marcador) y solo si hay de verdad un polígono cerrado */
    polyMeasures = single ? polygonMeasures(styleTargets[0]) : null;
    $id("pg-measures").hidden = !polyMeasures;
    if (polyMeasures) { $id("pg-unit").value = measureUnit; renderPolyMeasures(); }
    /* La lista de puntos es la geometría de UN nodo, como la posición de
       un marcador: no tiene sentido en bloque, y con varios
       seleccionados NO se puede abrir. Pero la fila ya no desaparece:
       el resto del diálogo resuelve este mismo caso al revés
       —deshabilitar en gris, que se vea que la opción está y que aquí
       no aplica—, y esconderla dejaba al usuario sin saber siquiera si
       existe. El botón dice además POR QUÉ, que es la mitad que un gris
       a secas no cuenta: son dos motivos distintos y el usuario no
       tiene por qué adivinar cuál le toca.                            */
    const pointsWhy = !single
      ? "Los puntos son la geometría de cada capa: deje seleccionada una sola para editarlos."
      : (solePath(styleTargets[0])
        ? ""
        : "Esta capa tiene varios trazos: el editor trabaja sobre uno solo.");
    $id("pg-points-row").hidden = false;
    $id("pg-points-row").classList.toggle("dim", !!pointsWhy);
    $id("pg-points").disabled = !!pointsWhy;
    $id("pg-points").title = pointsWhy;
  } else if (kind === "measure") {
    const styles = styleTargets.map(t => normalizePathStyle(t._style));
    styleDraft = { ...styles[0] };
    styleMixed = mixedProps(styles, ["weight", "color", "fillColor", "fillOpacity"]);
    /* Solo un círculo encierra superficie: para una línea el relleno no
       existe. Se DESHABILITA, no se esconde, igual que en las formas
       abiertas del diálogo de polígonos. Con una selección mixta manda
       el caso restrictivo: basta una línea para que no haya relleno que
       editar en bloque.                                               */
    const noFill = !styleTargets.every(t => t._measure && t._measure.type === "circle");
    $id("ms-fill-color").disabled = noFill;
    $id("ms-fill-opacity").disabled = noFill;
    $id("ms-fill-color-row").classList.toggle("dim", noFill);
    $id("ms-fill-opacity-row").classList.toggle("dim", noFill);
    setNumberControl($id("ms-weight"), styleDraft.weight, styleMixed.has("weight"));
    setColorControl($id("ms-color"), styleDraft.color, styleMixed.has("color"));
    setColorControl($id("ms-fill-color"), styleDraft.fillColor, styleMixed.has("fillColor"));
    setValueControl($id("ms-fill-opacity"), styleDraft.fillOpacity, styleMixed.has("fillOpacity"));
    /* Las medidas son de UNA medición, como la posición de un marcador */
    msMeasures = single ? measurementValues(styleTargets[0]._measure) : null;
    $id("ms-values").hidden = !msMeasures;
    if (msMeasures) { $id("ms-unit").value = measureUnit; renderMeasureValues(); }
  } else {
    const ops = styleTargets.map(t => ({ opacity: t._imageOverlay.opacity }));
    styleDraft = { ...ops[0] };
    styleMixed = mixedProps(ops, ["opacity"]);
    setValueControl($id("io-opacity"), styleDraft.opacity, styleMixed.has("opacity"));
  }
  styleDialog.hidden = false;
  clampToViewport(styleBox);
  focusDialog(styleBox);
}

/* `commit` false = cancel: the dragged position goes back and a pin that
   was created just to open this dialog is removed again.               */
function closeStyleDialog(commit = false) {
  if (dragFrame) { cancelAnimationFrame(dragFrame); dragFrame = null; }
  if (posMarker) {
    posMarker.off("drag", onMarkerDragged);
    setMarkerDraggable(posMarker, false);
    if (!commit && posOriginal) { posMarker.setLatLng(posOriginal); invalidateGeo(styleTargets[0]); }
  }
  if (!commit && styleIsNew && styleTargets.length) deleteNode(styleTargets[0]);
  const wasOpen = !styleDialog.hidden;
  styleDialog.hidden = true;
  iconPicker.hidden = true;
  /* Guarded: closeColorPicker() itself pops a focusReturn entry, and it
     would be the wrong one if the popover was already closed.        */
  if (!colorPicker.hidden) closeColorPicker();
  if (wasOpen) { focusReturn = focusReturn.slice(0, -1); releaseFocus(); }
  styleTargets = [];
  styleKindOpen = null;
  styleDraft = null;
  pendingIcon = null;
  posMarker = null;
  posOriginal = null;
  styleIsNew = false;
  polyMeasures = null;
  msMeasures = null;
  styleMixed = new Set();
  styleTouched = new Set();
}

/* ---------- Position controls ---------- */
const POS_FORMAT_LABEL = { dms: "g\u00B0 m' s\"", dec: "grados decimales" };
function renderCoords() {
  $id("pos-format-label").textContent = POS_FORMAT_LABEL[posFormat];
  $id("mk-lat").value = formatCoord(styleDraft.lat, true, posFormat);
  $id("mk-lon").value = formatCoord(styleDraft.lng, false, posFormat);
  markCoordValidity();
}
/* Flags out-of-range or unreadable text without blocking typing */
function markCoordValidity() {
  const lat = parseCoord($id("mk-lat").value, true);
  const lon = parseCoord($id("mk-lon").value, false);
  $id("mk-lat").classList.toggle("bad", !isFinite(lat));
  $id("mk-lon").classList.toggle("bad", !isFinite(lon));
  return { lat, lon };
}
/* El evento "drag" de Leaflet se dispara a la misma cadencia que
   mousemove; formatear y escribir en el DOM en cada evento repite el
   problema que ya se evitó en el cuadro de coordenadas del mapa. Mismo
   patrón aquí: una sola pintura por fotograma. invalidateGeo es una
   simple asignación y se queda fuera del rAF, sin esperar al frame.  */
let dragFrame = null;
function onMarkerDragged() {
  invalidateGeo(styleTargets[0]); /* la posición forma parte de la geometría */
  if (dragFrame) return;
  dragFrame = requestAnimationFrame(() => {
    dragFrame = null;
    if (!posMarker || !styleDraft) return; /* el diálogo pudo cerrarse antes de que llegara el frame */
    const p = posMarker.getLatLng();
    styleDraft.lat = p.lat;
    styleDraft.lng = p.lng;
    renderCoords();
  });
}
/* Same idea as the notation switch of the native colour picker: one small
   ⇅ button cycles through the notations, keeping whatever is typed in and
   just re-expressing it                                                 */
$id("pos-format").addEventListener("click", () => {
  if (!styleDraft || !posMarker) return;
  const { lat, lon } = markCoordValidity();
  if (isFinite(lat)) styleDraft.lat = lat;
  if (isFinite(lon)) styleDraft.lng = lon;
  posFormat = posFormat === "dms" ? "dec" : "dms";
  renderCoords();
});
for (const id of ["mk-lat", "mk-lon"]) {
  $id(id).addEventListener("input", () => { if (styleDraft && posMarker) markCoordValidity(); });
}

/* Un campo VACÍO no es un valor: con varios nodos es la marca de "no
   coinciden", y leerlo como un cero o como el valor por defecto metería
   en el borrador algo que nadie ha escrito. Se conserva lo que hubiera. */
const numOr = (el, fallback) => (el.value === "" ? fallback : Number(el.value) || fallback);

/* Controls only touch the draft; the preview reflects it immediately */
function readMarkerControls() {
  Object.assign(styleDraft, {
    color: colorOf($id("mk-color")),
    size: numOr($id("mk-size"), styleDraft.size || DEFAULT_MARKER_STYLE.size),
    textSize: numOr($id("mk-text-size"), styleDraft.textSize || DEFAULT_MARKER_STYLE.textSize),
    textColor: colorOf($id("mk-text-color")),
    textAlways: $id("mk-text-always").checked
  });
  $id("icon-preview").src = iconUrl(styleDraft.icon, styleDraft.color, 20);
}
function readPolygonControls() {
  const mode = $id("pg-mode").value;
  Object.assign(styleDraft, {
    weight: numOr($id("pg-weight"), styleDraft.weight || 1),
    color: colorOf($id("pg-color")),
    opacity: 1, /* outlines are always fully opaque */
    stroke: mode !== "fill",
    fill: mode !== "stroke",
    fillColor: colorOf($id("pg-fill-color")),
    fillOpacity: Number($id("pg-fill-opacity").value),
    /* El nombre siempre a la vista, como el texto de un marcador: aquí
       es un tooltip permanente en vez del globo que sale al hacer
       click. Viaja dentro del estilo del trazo y se guarda con él.   */
    textAlways: $id("pg-text-always").checked
  });
}
function readMeasureControls() {
  /* `fill` no se lee de ningún control: no hay selector de modo. Sale
     del estilo de la medición (un círculo se rellena, una línea no) y
     se vuelve a decidir POR CAPA al aceptar, porque la selección puede
     mezclar líneas y círculos.                                        */
  Object.assign(styleDraft, {
    weight: numOr($id("ms-weight"), styleDraft.weight || 1),
    color: colorOf($id("ms-color")),
    opacity: 1, /* el contorno siempre opaco, como en los polígonos */
    fillColor: colorOf($id("ms-fill-color")),
    fillOpacity: Number($id("ms-fill-opacity").value)
  });
}
/* Un único punto de reparto de "vuelca los controles en el borrador":
   el selector de color y el botón Aceptar tenían cada uno el suyo, y
   añadir un tipo de nodo obligaba a acordarse de tocar los dos.      */
function readStyleControls() {
  if (styleKindOpen === "marker") readMarkerControls();
  else if (styleKindOpen === "polygon") readPolygonControls();
  else if (styleKindOpen === "measure") readMeasureControls();
  else readImageOverlayControls();
}
for (const id of ["mk-size", "mk-text-size", "mk-text-always"]) { /* colours: openColorPicker */
  $id(id).addEventListener("input", () => { if (styleDraft) readMarkerControls(); });
}
for (const id of ["pg-weight", "pg-fill-opacity"]) { /* colours: openColorPicker */
  $id(id).addEventListener("input", () => { if (styleDraft) readPolygonControls(); });
}
for (const id of ["ms-weight", "ms-fill-opacity"]) { /* colours: openColorPicker */
  $id(id).addEventListener("input", () => { if (styleDraft) readMeasureControls(); });
}
$id("pg-mode").addEventListener("change", () => { if (styleDraft) readPolygonControls(); });
$id("pg-text-always").addEventListener("input", () => { if (styleDraft) readPolygonControls(); });

/* Qué ha tocado el usuario, por delegación sobre la caja entera: así un
   control nuevo queda cubierto con solo aparecer en CONTROL_PROP, sin
   depender de acordarse de añadirle su escucha. Los colores y el icono
   no disparan `input` y avisan desde sus propios selectores.         */
for (const ev of ["input", "change"]) {
  styleBox.addEventListener(ev, e => touchControl(e.target));
}

/* ---------- Perímetro y área (solo lectura) ---------- */
/* Unidad de TODA medida de distancia y área: el perímetro y el área de
   un polígono, las medidas de una medición y —desde que el usuario lo
   pidió— las etiquetas que la medición pinta en el visor y en su fila
   del árbol. Arranca en millas náuticas, que es la unidad de trabajo en
   navegación aérea y marítima; se recuerda entre aperturas del diálogo,
   como posFormat, y no persiste entre sesiones, como elevUnit.
   Es UNA sola preferencia a propósito: hay dos <select> (uno por bloque
   del diálogo) pero una única pregunta, "¿en qué unidad quiero leer
   esto?", y dos respuestas distintas a la vez solo sorprenderían.    */
let measureUnit = "nm";
let polyMeasures = null;   /* {area, perim} en m/m² del polígono abierto, o null */
function renderPolyMeasures() {
  if (!polyMeasures) return;
  /* Una línea tiene LONGITUD; solo un contorno cerrado tiene perímetro */
  $id("pg-perim-label").textContent = polyMeasures.open ? "Longitud" : "Perímetro";
  $id("pg-perimeter").textContent = fmtUnitDist(polyMeasures.perim, measureUnit);
  /* area === null: anillo sin cerrar (algunos JSON), no hay área que mostrar */
  $id("pg-area-row").hidden = polyMeasures.area === null;
  if (polyMeasures.area !== null) {
    $id("pg-area").textContent = fmtUnitArea(polyMeasures.area, measureUnit);
  }
}
/* Cambiar la unidad en CUALQUIERA de los dos bloques repinta también las
   etiquetas de las mediciones del visor: la preferencia es única, así
   que dejar el mapa con la unidad anterior lo pondría en desacuerdo con
   la ventana que se acaba de tocar.                                   */
function setMeasureUnit(unit) {
  measureUnit = unit;
  $id("pg-unit").value = unit;
  $id("ms-unit").value = unit;
  renderPolyMeasures();
  renderMeasureValues();
  refreshMeasureLabels();
}
$id("pg-unit").addEventListener("change", () => setMeasureUnit($id("pg-unit").value));

/* ---------- Medidas de una medición (solo lectura) ---------- */
let msMeasures = null; /* {circle, dist, area, brg} de la medición abierta, o null */
function renderMeasureValues() {
  if (!msMeasures) return;
  /* Un círculo se describe por su RADIO; una línea, por su distancia */
  $id("ms-dist-label").textContent = msMeasures.circle ? "Radio" : "Distancia";
  $id("ms-dist").textContent = fmtUnitDist(msMeasures.dist, measureUnit);
  $id("ms-area-row").hidden = msMeasures.area === null;
  if (msMeasures.area !== null) {
    $id("ms-area").textContent = fmtUnitArea(msMeasures.area, measureUnit);
  }
  /* El rumbo va SIEMPRE en grados: no es una distancia y la unidad
     elegida no le afecta.                                            */
  $id("ms-bearing-row").hidden = msMeasures.brg === null;
  if (msMeasures.brg !== null) $id("ms-bearing").textContent = `${msMeasures.brg.toFixed(1)}°`;
}
$id("ms-unit").addEventListener("change", () => setMeasureUnit($id("ms-unit").value));

function readImageOverlayControls() {
  styleDraft.opacity = Number($id("io-opacity").value);
}
$id("io-opacity").addEventListener("input", () => { if (styleDraft) readImageOverlayControls(); });

$id("style-cancel").addEventListener("click", () => closeStyleDialog(false));
$id("style-accept").addEventListener("click", () => {
  if (!styleDraft) return;
  /* El nombre se aplica sea cual sea el tipo del nodo. Con varios, el
     campo va vacío y solo renombra si el usuario escribe algo: lo que
     se ve entonces es su marcador de posición, el resumen de los
     nombres que hay, y aceptar sin tocarlo no puede convertirlo en el
     nombre de todos.                                                 */
  const nombre = $id("mk-name").value.trim();
  if (styleTargets.length === 1) {
    setNodeName(styleTargets[0], nombre || styleTargets[0]._name);
  } else if (nombre) {
    for (const t of styleTargets) setNodeName(t, nombre);
  }
  if (styleKindOpen === "marker") {
    readMarkerControls();
    if (posMarker) {
      const { lat, lon } = markCoordValidity();
      if (!isFinite(lat) || !isFinite(lon)) {
        navMessage("Coordenadas no v\u00E1lidas: revise la latitud y la longitud.");
        return; /* keep the dialog open so the value can be fixed */
      }
      styleDraft.lat = lat;
      styleDraft.lng = lon;
      posMarker.setLatLng([lat, lon]);
      invalidateGeo(styleTargets[0]);
    }
    /* lat/lng live in the draft for the dialog only; they are a property
       of the geometry, not of the style, so they never reach _mstyle.
       Lo que no coincidía entre los nodos y nadie ha tocado se queda
       como estaba en cada uno (draftProps).                           */
    const pick = draftProps(["icon", "color", "size", "textSize", "textColor", "textAlways"]);
    for (const t of styleTargets) {
      t._mstyle = { ...DEFAULT_MARKER_STYLE, ...(t._mstyle || {}), ...pick };
      applyMarkerStyle(t);
    }
  } else if (styleKindOpen === "polygon") {
    readPolygonControls();
    const pick = draftProps(["weight", "color", "fillColor", "fillOpacity", "textAlways"]);
    /* El modo son dos booleanos que viajan juntos: o se aplican los dos
       o no se toca ninguno, o un nodo podría quedarse sin contorno NI
       relleno, que es la combinación que el selector no ofrece.       */
    if (!styleMixed.has("mode") || styleTouched.has("mode")) {
      pick.stroke = styleDraft.stroke;
      pick.fill = styleDraft.fill;
    }
    for (const t of styleTargets) {
      t._style = { ...normalizePathStyle(t._style), ...pick };
      applyPolygonStyle(t);
    }
  } else if (styleKindOpen === "measure") {
    readMeasureControls();
    const pick = draftProps(["weight", "color", "fillColor", "fillOpacity"]);
    for (const t of styleTargets) {
      /* El relleno se decide por capa, no en el diálogo: una selección
         puede mezclar líneas y círculos, y un trazo abierto relleno
         obliga a Leaflet a cerrarlo por su cuenta (misma regla que
         clearFillOnOpenPaths aplica en la propia capa).              */
      t._style = { ...normalizePathStyle(t._style), ...pick,
        fill: t._measure.type === "circle" && styleDraft.fill !== false };
      applyPolygonStyle(t); /* una medición es un trazo más: mismo camino */
      t._measure.style = t._style; /* el registro pendiente lo serializa desde aquí */
    }
  } else {
    readImageOverlayControls();
    const pick = draftProps(["opacity"]);
    if ("opacity" in pick) {
      for (const t of styleTargets) {
        t._imageOverlay.opacity = pick.opacity;
        const layer = nodeLayer(t);
        if (layer) layer.setOpacity(pick.opacity);
      }
    }
  }
  scheduleSave();
  closeStyleDialog(true);
});

/* ---------- Icon picker (Google Earth-like palette) ----------
   Rebuilt on each open so the previews use the colour currently in the
   dialog; MDI previews are coloured SVGs from the Iconify REST API and
   the Leaflet pin is its own PNG. Clicking only highlights an icon: it
   reaches the draft on "Aceptar" and the map on accepting the style.  */
function buildIconGrid(color) {
  const grid = $id("icon-grid");
  grid.innerHTML = "";
  for (const [group, names] of MDI_ICONS) {
    const h = document.createElement("h3");
    h.textContent = group;
    grid.appendChild(h);
    const box = document.createElement("div");
    box.className = "icons";
    for (const name of names) {
      const b = document.createElement("button");
      b.className = "icon-opt" + (name === pendingIcon ? " chosen" : "");
      b.title = name;
      const img = document.createElement("img");
      img.src = iconUrl(name, color, 24);
      img.height = 24;
      if (name !== LEAFLET_PIN) img.width = 24; /* the pin keeps its 25:41 */
      img.alt = name;
      b.appendChild(img);
      b.addEventListener("click", () => {
        pendingIcon = name;
        for (const other of grid.querySelectorAll(".icon-opt")) {
          other.classList.toggle("chosen", other === b);
        }
      });
      box.appendChild(b);
    }
    grid.appendChild(box);
  }
}
$id("icon-preview-btn").addEventListener("click", () => {
  if (!styleDraft) return;
  pendingIcon = styleDraft.icon;
  buildIconGrid(colorOf($id("mk-color")));
  iconPicker.hidden = false;
  clampToViewport(iconBox);
  focusDialog(iconBox);
});
$id("icon-cancel").addEventListener("click", () => {
  iconPicker.hidden = true;
  pendingIcon = null;
  releaseFocus();
});
$id("icon-accept").addEventListener("click", () => {
  if (styleDraft && pendingIcon) {
    styleDraft.icon = pendingIcon;
    /* El icono tampoco pasa por un control con `input`: se anota aquí,
       que es donde el usuario lo elige de verdad.                    */
    styleTouched.add("icon");
    markMixedRow($id("icon-preview-btn"), false);
    $id("icon-preview").src = iconUrl(pendingIcon, colorOf($id("mk-color")), 20);
  }
  iconPicker.hidden = true;
  pendingIcon = null;
});

