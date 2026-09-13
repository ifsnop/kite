/* ================= Vigilante del hilo principal (SOLO rama `debug`) =====
   DIAGNÓSTICO, no producto. No debe fusionarse en main tal cual.

   Existe porque hay un cuelgue reportado —el navegador deja de responder
   y hay que recargar— que no se ha podido reproducir en headless pese a
   descartar por medición el tamaño del árbol, reorderPaintOrder,
   serializeTree, el guardado, fugas de memoria, el hit-test del lienzo y
   el ratón sobre el mapa. Sin una traza del navegador real, seguir
   probando hipótesis es tirar dardos.

   Qué hace: un latido cada HEARTBEAT_MS. Si entre dos latidos pasa
   bastante más tiempo del que debería, el hilo principal estuvo
   bloqueado, y eso es exactamente lo que se ve como "colgado". Cuando
   vuelve, anota cuánto estuvo parado y QUÉ SE EJECUTÓ durante el hueco.

   Ojo a un detalle que costó una versión: no sirve preguntar "qué está
   en marcha ahora". Para que este temporizador vuelva a correr, el
   hilo ha tenido que liberarse, así que la pila ya está deshecha y
   siempre sale vacía. Lo que sí dice la verdad es la DIFERENCIA de los
   contadores de llamadas entre dos latidos —qué se ejecutó mientras
   estuvo parado— y el orden en que ocurrió, que es lo que distingue un
   bucle desbocado de una ráfaga normal.

   El aviso sale por navMessage, así que queda en el registro de la
   sesión (botón 📋) y se puede copiar entero con el botón de copiar que
   ese diálogo ya tiene: no hace falta pelearse con la consola.       */

const WD_HEARTBEAT_MS = 250;
/* Un bloqueo por debajo de esto es trabajo normal (construir un lote de
   filas, un guardado): solo interesa lo que se percibe como "colgado". */
const WD_BLOCK_MS = 1200;

/* Las funciones bajo sospecha: las de mutar el árbol, las de
   visibilidad, las del portapapeles y las que ya se han medido caras
   alguna vez. Envolverlas solo cuesta un contador por llamada.      */
const WD_WATCHED = [
  "cascadeVisibility", "materializeRecords", "ensureMaterialized",
  "reorderPaintOrder", "serializeTree", "serializeNode", "dbSaveTree",
  "pasteClipboard", "copySelection", "deleteNode", "cursorAfterDelete",
  "topLevelSelection", "recordState", "containerState", "refreshChecksFrom",
  "buildRecordsFromStorage", "materializeSubtree", "selectFolderLayers",
  "pushUndo", "undoLast", "applyMarkerStyle", "applyPolygonStyle",
  "showLayerInfo", "layersAtPoint", "setAllChecked", "createFolderNode"
];

const wdStats = new Map();   /* nombre -> { n } */
/* Últimas llamadas, con su marca de tiempo: durante un bloqueo largo
   pueden ser miles, así que es un anillo de tamaño fijo.            */
const WD_RING = 300;
const wdRing = [];

function wdWrap(name) {
  const orig = window[name];
  if (typeof orig !== "function") return false;
  const st = { n: 0 };
  wdStats.set(name, st);
  window[name] = function (...args) {
    st.n++;
    wdRing.push([name, performance.now()]);
    if (wdRing.length > WD_RING) wdRing.shift();
    return orig.apply(this, args);
  };
  return true;
}

/* Se envuelve al final del arranque: antes, muchas de estas todavía no
   existen (zona muerta temporal de los `const` de archivos posteriores),
   y envolver lo que aún no está declarado no haría nada.             */
let wdBlocks = [];
function startWatchdog() {
  let envueltas = 0;
  for (const name of WD_WATCHED) if (wdWrap(name)) envueltas++;

  /* La foto de los contadores en el latido ANTERIOR. La diferencia
     contra la de ahora es lo que se ejecutó mientras el hilo estuvo
     parado, que es la pregunta de verdad: la pila ya está deshecha
     cuando este temporizador vuelve a correr —el hilo tuvo que
     liberarse para que corriera—, así que mirar "qué está en marcha"
     no diría nada. El reparto de llamadas, sí.                      */
  let previa = new Map();
  const foto = () => new Map([...wdStats].map(([k, s]) => [k, s.n]));
  previa = foto();

  let ultimo = performance.now();
  setInterval(() => {
    const ahora = performance.now();
    const hueco = ahora - ultimo;
    const actual = foto();
    if (hueco >= WD_BLOCK_MS) {
      const durante = {};
      for (const [k, n] of actual) {
        const d = n - (previa.get(k) || 0);
        if (d) durante[k] = d;
      }
      /* Y en qué ORDEN, que distingue un bucle de una ráfaga */
      const orden = wdRing.filter(([, t]) => t >= ultimo && t <= ahora).map(([k]) => k);
      const resumen = [];
      for (const k of orden) {
        if (resumen.length && resumen[resumen.length - 1][0] === k) resumen[resumen.length - 1][1]++;
        else resumen.push([k, 1]);
      }
      const bloque = { ms: Math.round(hueco), durante,
        secuencia: resumen.slice(-12).map(([k, n]) => (n > 1 ? `${k}×${n}` : k)) };
      wdBlocks.push(bloque);
      navMessage(`Hilo bloqueado ${bloque.ms} ms — durante: `
        + (bloque.secuencia.length ? bloque.secuencia.join(" → ")
          : "ninguna función vigilada (el bloqueo está FUERA de ellas)"),
        { sticky: true });
    }
    previa = actual;
    ultimo = ahora;
  }, WD_HEARTBEAT_MS);

  navMessage(`Vigilante activo (${envueltas} funciones). Reproduzca el cuelgue y luego `
    + "abra el registro 📋 y copie su contenido.", { tone: "info" });
}

/* ---------- Segunda vuelta: "colgado" SIN el hilo parado ----------
   La primera captura del usuario vino con `bloqueos: []`: el hilo
   principal no estuvo quieto ni 1,2 s en toda la sesión y aun así la
   aplicación se quedó sin responder. Eso descarta el bucle desbocado y
   deja dos sospechosos muy distintos, que es lo que hay que separar:

   - Que lo parado sea el PINTADO y no el script. Se ve porque los
     `requestAnimationFrame` dejan de llegar mientras los `setInterval`
     siguen puntuales: si el hilo estuviera bloqueado fallarían los dos.
   - Que los clics SÍ lleguen pero se los coma algo por encima: un
     diálogo, el recuadro de soltar archivos o la barra de progreso
     que se quedaron visibles. Ahí el ratón funciona y la aplicación
     parece muerta. Por eso se anota, en cada pulsación, qué elemento
     hay REALMENTE bajo el puntero (elementFromPoint) y qué capas de
     encima están abiertas.                                          */
let wdRafGaps = [];
let wdClicks = [];

/* Lo que tapa la pantalla, si es que hay algo. Se anota CUÁNTO tapa
   (porcentaje del área de la ventana): el recuadro de soltar archivos
   vive siempre visible bajo el árbol y saldría en la lista sin tapar
   nada, mientras que lo que convierte la aplicación en un ladrillo es
   una capa a pantalla completa. Sin esa cifra la lista es ruido.   */
function wdOverlays() {
  const area = window.innerWidth * window.innerHeight;
  const visibles = [];
  for (const el of document.querySelectorAll(".dlg-overlay, .dlg-float, #progress, #dropzone")) {
    if (el.hidden || getComputedStyle(el).display === "none") continue;
    const r = el.getBoundingClientRect();
    const pct = Math.round(100 * (r.width * r.height) / area);
    visibles.push(`${el.id || el.className} (${pct}% de la pantalla)`);
  }
  return visibles;
}
/* Ruta corta de un elemento, para reconocerlo sin volcar el DOM */
function wdPath(el) {
  const partes = [];
  for (let n = el; n && n !== document.body && partes.length < 4; n = n.parentElement) {
    partes.unshift(n.id ? "#" + n.id : n.tagName.toLowerCase()
      + (n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\s+/)[0] : ""));
  }
  return partes.join(" ");
}

function startUiWatchdog() {
  /* Fotogramas: el hueco entre dos rAF. Se guardan los diez peores. */
  let ultimoRaf = performance.now();
  const tick = ahora => {
    const hueco = ahora - ultimoRaf;
    ultimoRaf = ahora;
    if (hueco > 500) {
      wdRafGaps.push({ ms: Math.round(hueco), cuando: new Date().toLocaleTimeString() });
      wdRafGaps = wdRafGaps.sort((a, b) => b.ms - a.ms).slice(0, 10);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  /* Cada pulsación: dónde cayó, qué había debajo de verdad y qué
     estaba abierto. En captura, para verlo aunque alguien pare el
     evento después.                                                */
  for (const tipo of ["pointerdown", "click"]) {
    document.addEventListener(tipo, e => {
      const arriba = document.elementFromPoint(e.clientX, e.clientY);
      wdClicks.push({
        tipo,
        destino: wdPath(e.target),
        bajoElPuntero: arriba ? wdPath(arriba) : "(nada)",
        tapado: arriba !== e.target && !(arriba && arriba.contains(e.target)),
        abiertos: wdOverlays(),
        cuando: new Date().toLocaleTimeString()
      });
      if (wdClicks.length > 40) wdClicks.shift();
    }, true);
  }
}

/* Informe completo para la consola, por si hace falta más detalle del
   que cabe en una línea del registro.                                */
window.__kiteDiag = () => ({
  bloqueos: wdBlocks,
  /* Fotogramas perdidos SIN bloqueo del hilo = el pintado, no el script */
  fotogramas: wdRafGaps,
  /* Las últimas pulsaciones: si `tapado` es true, el clic no llegó a
     donde el usuario creía, y `abiertos` dice qué lo tapaba.        */
  pulsaciones: wdClicks.slice(-12),
  abiertosAhora: wdOverlays(),
  herramienta: typeof activeTool !== "undefined" ? activeTool : null,
  arrastrando: typeof dragItems !== "undefined" && !!dragItems,
  llamadas: Object.fromEntries([...wdStats].map(([k, s]) => [k, s.n])),
  filas: document.querySelectorAll("#tree li[role=treeitem]").length,
  capas: rootGroup.getLayers().length,
  nodosDOM: document.getElementsByTagName("*").length,
  /* Ojo: usedJSHeapSize NO está recolectado, así que un número alto no
     significa memoria viva. Medido aquí: el mismo árbol que dio 240 MB
     en el navegador del usuario ocupa 15,3 MB de heap VIVO tras forzar
     la recolección.                                                  */
  memoriaSinRecolectar: performance.memory
    ? Math.round(performance.memory.usedJSHeapSize / 1048576) + " MB" : "no medible"
});
