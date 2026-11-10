/* ================= Separador redimensionable y toggle ================= */

const splitter = document.getElementById("splitter");
const navToggle = document.getElementById("nav-toggle");

function setNavWidth(px) {
  px = Math.min(600, Math.max(200, px));
  document.documentElement.style.setProperty("--nav-width", px + "px");
}
/* Pointer Events con captura (apple-design §2): el mismo gesto sirve para
   ratón, lápiz y dedo, y el seguimiento no se pierde aunque el puntero salga
   del separador (5 px de ancho) o pase sobre el mapa. Se recuerda dónde se
   agarró (desfase entre el puntero y el borde del panel) para que el borde
   no salte al puntero. `invalidateSize` es caro con miles de capas y los
   eventos llegan a más de 100/s, así que va UNA vez por fotograma
   (performance.md); la anchura sí se aplica en cada evento, para que el
   separador siga al puntero 1:1.                                          */
let splitFrame = 0;
function scheduleMapResize() {
  if (splitFrame) return;
  splitFrame = requestAnimationFrame(() => { splitFrame = 0; map.invalidateSize(); });
}
let splitGrab = null; /* { id, dx } mientras se arrastra */
splitter.addEventListener("pointerdown", e => {
  /* En un móvil el panel ocupa la pantalla (phone-layout): `setNavWidth`
     escribe --nav-width en línea y taparía la regla de ese diseño. */
  if (e.button !== 0 || document.documentElement.classList.contains("phone-layout")) return;
  splitGrab = { id: e.pointerId, dx: splitter.getBoundingClientRect().left - e.clientX };
  splitter.setPointerCapture(e.pointerId);
  document.body.classList.add("resizing");
  e.preventDefault();
});
splitter.addEventListener("pointermove", e => {
  if (!splitGrab || e.pointerId !== splitGrab.id) return;
  setNavWidth(e.clientX + splitGrab.dx);
  scheduleMapResize();
});
function endSplitDrag(e) {
  if (!splitGrab || e.pointerId !== splitGrab.id) return;
  splitGrab = null;
  document.body.classList.remove("resizing");
  cancelAnimationFrame(splitFrame);
  splitFrame = 0;
  map.invalidateSize();
}
splitter.addEventListener("pointerup", endSplitDrag);
splitter.addEventListener("pointercancel", endSplitDrag);

function setNavHidden(hidden) {
  document.body.classList.toggle("nav-hidden", hidden);
  navToggle.innerHTML = hidden ? "&#9654;" : "&#9664;";
  map.invalidateSize();
}
navToggle.addEventListener("click", () => setNavHidden(!document.body.classList.contains("nav-hidden")));

/* ---------- Aviso al abrir la aplicación desde un móvil ----------
   El panel de navegación (400 px) y el mapa no caben a la vez en una
   pantalla de móvil, así que se recomienda un ordenador. Quien insiste
   se queda solo con el mapa: el MISMO `nav-hidden` del botón de arriba,
   no un estado nuevo, y la flecha sigue ahí para volver al panel.

   «Móvil» = puntero táctil como principal Y lado corto de la ventana
   por debajo de MOBILE_MAX_PX: así entra un teléfono en vertical o en
   horizontal (lado corto ≈ 360-430) y no una tableta (≥ 768) ni una
   ventana de escritorio estrecha, que tiene ratón y puede ensancharse.

   En un móvil, con aviso o sin él, el panel ocupa la pantalla entera
   (`phone-layout`, styles.css): con 400 px el botón para volver al mapa
   quedaría fuera de ella. La elección se guarda (`mobileView`) y las
   cargas siguientes la aplican sin preguntar.                          */
const MOBILE_MAX_PX = 600;
function isPhoneScreen() {
  return window.matchMedia("(pointer: coarse)").matches
    && Math.min(window.innerWidth, window.innerHeight) < MOBILE_MAX_PX;
}

const mobileDialog = document.getElementById("mobile-notice");
const mobileBox = mobileDialog.querySelector(".dlg-box");
setupDialog(mobileBox, { modal: true });
makeDialogMovable(mobileBox);

function closeMobileNotice(choice) {
  if (mobileDialog.hidden) return;
  mobileDialog.hidden = true;
  releaseFocus();
  if (choice === "map") setNavHidden(true);
  dbSaveMobileView(choice).catch(() => { /* sin guardar, se vuelve a preguntar */ });
}
document.getElementById("mobile-close").addEventListener("click", () => closeMobileNotice("nav"));
document.getElementById("mobile-continue").addEventListener("click", () => closeMobileNotice("map"));

/* Arranque (99-boot.js): `saved` es lo que eligió la vez anterior, o null */
function initPhoneLayout(saved) {
  if (!isPhoneScreen()) return;
  document.documentElement.classList.add("phone-layout");
  map.invalidateSize();
  if (saved === "map") { setNavHidden(true); return; }
  if (saved === "nav") return;
  mobileDialog.hidden = false;
  clampToViewport(mobileBox);
  focusDialog(mobileBox);
}

