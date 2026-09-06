/* ================= Arranque: restaurar el árbol guardado ================= */
(async () => {
  /* La vista primero: así el mapa aparece donde se dejó mientras el
     árbol, que puede tardar, se reconstruye por detrás.              */
  try {
    const view = await dbLoadView();
    if (view) map.setView([view.lat, view.lng], view.zoom, { animate: false });
  } catch { /* sin vista guardada se queda la de por defecto */ }
  viewRestoring = false;

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

  refreshStorageUsage();

  /* Pedir almacenamiento persistente: reduce el riesgo de que el
     navegador borre los datos si necesita liberar espacio          */
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
})();
