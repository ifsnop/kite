/* ================= Uso sin conexión =================
   Dos cosas independientes, ninguna toca los datos del usuario:

   1. El service worker (sw.js, GENERADO desde src/sw.js) guarda el HTML y
      las librerías de CDN para poder RECARGAR la página sin red (el
      navegador descarta pestañas en segundo plano y las recarga al
      volver). Solo existe servido por http(s); abierto por doble clic
      (file://) no se registra nada y todo sigue como antes. Ver offline.md.
   2. Un indicador «Sin conexión» y mensajes que dicen «sin conexión» en
      vez de un error genérico: sin red, mapas base, búsqueda de lugares,
      elevaciones o descargas no pueden funcionar, y conviene que se lea
      como lo que es y no como un fallo del servicio.

   Qué lista de librerías se guarda lo decide ESTE archivo, no el worker:
   sale de las etiquetas <script>/<link> del propio documento y de
   LAZY_LIBS, así que una versión nueva de una librería se cambia en un
   solo sitio (su etiqueta o su entrada) y el worker la sigue.

   Va antes que 07-lazy-libs.js en el manifiesto pero solo DECLARA
   funciones: LAZY_LIBS y LEAFLET_PIN_URL se leen cuando se llama.       */

const OFFLINE_WORKER = "sw.js";

/* `navigator.onLine === false` es fiable en una sola dirección: false
   significa SEGURO que no hay interfaz de red; true no prueba que haya
   conectividad. Por eso solo se usa para explicar un fallo ya ocurrido
   (nunca para impedir un intento).                                    */
function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/* El texto de un fallo de red: «sin conexión» si es seguro que la hay,
   y el genérico de cada sitio (CORS, servicio caído…) si no.          */
function netFailText(generic) {
  return isOffline() ? tr("sin conexión a la red") : generic;
}

/* Todo lo que el worker debe tener guardado: las etiquetas con integridad
   del documento, las librerías bajo demanda y las dos imágenes del
   marcador de Leaflet (un <img> no admite SRI, igual que hoy).         */
function precacheItems() {
  const seen = new Map();
  const add = (url, integrity) => {
    if (url && !seen.has(url)) seen.set(url, integrity ? { url, integrity } : { url });
  };
  for (const el of document.querySelectorAll("script[src][integrity], link[rel='stylesheet'][integrity]")) {
    add(el.src || el.href, el.getAttribute("integrity"));
  }
  for (const lib of Object.values(LAZY_LIBS)) add(lib.url, lib.integrity);
  add(LEAFLET_PIN_URL);
  add(LEAFLET_PIN_SHADOW);
  return [...seen.values()];
}

/* Registra el worker y le manda la lista. Todo en silencio: es una mejora
   que nadie ha pedido en este momento, y que no exista (file://, un
   alojamiento sin sw.js, un navegador que no lo admite) no es un fallo
   que el usuario pueda arreglar.                                       */
async function registerOfflineWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    await navigator.serviceWorker.register(OFFLINE_WORKER);
    if (isOffline()) return; /* nada que descargar; ya sirve lo guardado */
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) return;
    reg.active.postMessage({
      type: "precache",
      items: precacheItems(),
      /* Sin hash ni búsqueda: es la página que acaba de cargar y que el
         worker no vio pasar (aún no controlaba nada).                */
      pages: [location.origin + location.pathname]
    });
  } catch { /* ver arriba */ }
}

/* El indicador sigue a `navigator.onLine`; el mensaje solo sale en una
   TRANSICIÓN (también al arrancar sin red, porque es lo que explica por
   qué el mapa está en blanco), con tono de notificación: no es un fallo
   de KITE.                                                              */
function updateOfflineBadge(announce) {
  const badge = document.getElementById("offline-badge");
  if (!badge) return;
  const off = isOffline();
  badge.hidden = !off;
  if (!announce) return;
  navMessage(off
    ? tr("Sin conexión: KITE sigue funcionando con lo guardado en este navegador. "
      + "Los mapas base, la búsqueda de lugares y las elevaciones necesitan red.")
    : tr("Conexión recuperada."), { tone: "info" });
}

function initOfflineIndicator() {
  updateOfflineBadge(isOffline());
  window.addEventListener("offline", () => updateOfflineBadge(true));
  window.addEventListener("online", () => updateOfflineBadge(true));
}
