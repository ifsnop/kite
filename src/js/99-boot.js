/* ================= Arranque: restaurar el árbol guardado ================= */
(async () => {
  /* La vista primero: así el mapa aparece donde se dejó mientras el
     árbol, que puede tardar, se reconstruye por detrás.              */
  try {
    const view = await dbLoadView();
    if (view) map.setView([view.lat, view.lng], view.zoom, { animate: false });
  } catch { /* sin vista guardada se queda la de por defecto */ }
  viewRestoring = false;

  /* El reparto de columnas de la ficha: si no se restaura, habría que
     reajustarlo en cada arranque. Antes del árbol porque no depende de
     él y es una lectura mínima.                                      */
  try {
    const frac = await dbLoadProps();
    if (frac !== null) setPropsSplit(frac);
  } catch { /* sin reparto guardado se usa el de por defecto */ }

  /* La credencial de Copernicus antes que los mapas base: sin ella la
     capa no puede ni construir su URL (ver shWmsUrl).                */
  try {
    const sh = await dbLoadSh();
    if (sh && validInstanceId(sh.instanceId)) shInstanceId = sh.instanceId.trim();
  } catch { /* sin credencial guardada la capa pedirá configurarla */ }

  /* Mapas base: primero lo guardado, luego se pintan y se encienden */
  try { applySavedBases(await dbLoadBases()); } catch { /* valores por defecto */ }
  /* Una capa que exige credencial no puede quedarse encendida sin
     ella: se apaga en vez de fallar tesela a tesela.                 */
  for (const [id, st] of baseState) {
    const src = dynSource(st.def);
    if (st.on && src && src.blocked && src.blocked()) st.on = false;
  }
  renderBasePanel();
  for (const id of baseState.keys()) applyBaseLayer(id);
  /* Capas dinámicas guardadas como encendidas: se valida la capa
     restaurada contra el catálogo real en cuanto llegue (puede haber
     dejado de publicarse), sin esperar a que se abra el panel.       */
  for (const st of baseState.values()) {
    const src = dynSource(st.def);
    if (st.on && src) src.ensure();
  }

  let nodes = null;
  try { nodes = await dbLoadTree(); } catch { nodes = null; }
  if (nodes && nodes.length) await restoreTree(nodes);
  /* Hasta aquí el panel decía «Inicializando…». Ahora sí se sabe si no
     hay nada que enseñar. Se mira `rootUl`, no `nodes`: si el usuario
     ha soltado un archivo mientras se leía IndexedDB, ensureRootUl ya
     sustituyó el aviso y borrarlo dejaría su importación colgando de un
     <ul> desconectado.                                                */
  if (!rootUl) showEmptyMessage();

  refreshStorageUsage();
  /* La memoria cambia sin que el árbol se toque, así que lleva su
     propio temporizador; el almacenamiento viaja con cada guardado. */
  refreshMemoryUsage();
  /* Sin cifra que refrescar —file://, o un navegador sin
     performance.memory— no se arma el temporizador: no hay nada que
     actualizar cada cinco segundos.                                 */
  if (memoryUsageText() !== null) setInterval(refreshMemoryUsage, MEMORY_REFRESH_MS);

  /* Pedir almacenamiento persistente: reduce el riesgo de que el
     navegador borre los datos si necesita liberar espacio          */
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  /* DIAGNÓSTICO de la rama `debug` (ver 98-watchdog.js). Va al FINAL
     del arranque a propósito: envuelve funciones por su nombre y antes
     de aquí muchas siguen en su zona muerta temporal.               */
  startWatchdog();
})();
