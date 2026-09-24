---
description: Parseo de KML/KMZ/GeoJSON, namespaces, estilos, tolerancias de coordenadas, HTML en etiquetas y duplicados al importar.
paths:
  - "src/js/20-kml-geom.js"
  - "src/js/32-geojson.js"
  - "src/js/33-kml-import.js"
---

## Estructura del árbol al importar

- **Jerarquía del KML intocable**: se vuelca en la raíz tal cual (`<Document>`/`<Folder>`), sin envolverla en una carpeta extra.
- **GeoJSON sí crea envoltorio**: es una lista plana sin jerarquía propia; la carpeta contenedora agrupa lo que llegó junto. Única importación que envuelve.
- Construcción fallida a medias → se retira todo lo que hubiera entrado.

## Formatos y límites de entrada

- **KML namespace-agnóstico**: nunca depender de `tagName` literal. `bareName`, `elsByTag`, `firstByTag`, `childrenByTag` resuelven por nombre local (namespace comodín + filtrado manual de respaldo) → funcionan con `<kml:Placemark>`, namespace por defecto o sin namespace.
- **Apertura tolerante del XML**: un prefijo usado sin declarar (p. ej. `xsi:schemaLocation` sin `xmlns:xsi`) hace que `DOMParser` devuelva documento de error. `parseKmlDocument` lo detecta, `repairUndeclaredPrefixes` declara los prefijos que faltan en el elemento raíz (URI sintética) y reintenta **una sola vez**. Otro fallo cualquiera se comunica con mensaje y posición del analizador, no «XML no válido». La reparación se anota en el informe.
- **Estilos KML**: `buildStyleIndex().resolve(url)` sigue cadenas `StyleMap → StyleMap → Style` con tope `STYLE_HOPS` y corte de ciclos; admite `<Style>` incrustado en `<Pair>`. Refs a archivos externos no resolubles: se cuentan en `externalRefs` y se avisan.
- **Tolerancia de redondeo en coordenadas**: `clampDeg`/`clampLatLng` ajustan al límite lo que se pase por menos de `COORD_EPS` (10⁻⁵°, ~1,1 m) — p. ej. `180.00000044181039` por error de reproyección — y siguen rechazando lo que se sale de verdad (latitudes tipo 32400 por coma decimal mal puesta). Los ajustes se cuentan y avisan; nunca en silencio.
- **Altitud**: `clampLatLng(lat, lon, alt)` la transporta, `parseCoords` le pasa el 3er campo del KML. Solo se añade si es finita (si no, la posición se queda en 2 elementos; no se inventa `0`). Pendiente: `findDuplicatePlacemarks` compara solo lat/lon, así que dos placemarks a distinta altura se siguen fusionando como duplicados.
- **GeoJSON**: la validación normaliza sobre el propio objeto (una sola pasada). Pasa además por `validGeometry` (tipo conocido, anidamiento correcto, anillos ≥4 posiciones, líneas ≥2).
- **HTML en `properties` de GeoJSON**: mismo tratamiento que los `<name>` de KML — `geojsonPropsHaveHtmlTags`/`stripHtmlTagsFromGeojsonProps` reutilizan `hasHtmlLikeTags`/`stripHtmlLikeTags` (`<…>` cuenta como etiqueta si tiene alguna letra dentro) y el mismo diálogo `confirmStripHtmlTags`. Se limpia **al importar**, antes de `firstProps`, mutando el propio objeto (recorriendo objetos y arrays, no solo el nivel superior).
- **Duplicados: misma pregunta en KML y GeoJSON** vía `confirmMergeDuplicates`, una pregunta por archivo, tolerancia `DUP_POS_DECIMALS` (5 decimales ≈ 1,1 m). `findDuplicatePlacemarks` (XML) / `findDuplicateFeatures` (features). Detalles GeoJSON:
  - Coordenadas en **`[lng, lat]`** (al revés que el resto del proyecto).
  - Se agrupa por el nombre de `properties` (`featureDupName`), nunca por el «Elemento N» de respaldo (mismo criterio que `if (!name) continue` en KML).
  - La pregunta va **después** del selector de propiedad-nombre (el nombre es media clave del duplicado).
  - El array se filtra **en el sitio** (`splice` hacia atrás), no reasignando `gj.features`.
- `<b>` vs `<b>` en un literal JSON **no cambia nada** — `JSON.parse` las normaliza, llegan indistinguibles (test: `tests/htmltagstest.js`). No es una vía para burlar la validación.
- **Nombre de elemento GeoJSON**: `resolveFeatureName` usa `properties.name`, si no `properties.title`, si no «Elemento N». Archivo **ambiguo** (`needsNamePicker`) si el primer Feature tiene `properties` con claves pero ni `name` ni `title` → `pickNameProperty` pregunta sobre ese primer objeto. Elección guardada en IndexedDB por `propsFingerprint` (forma de `properties`, no valores): un archivo futuro con esa forma no vuelve a preguntar, salvo la primera vez que se vaya a aplicar (se confirma, preseleccionada). Cancelar/Escape no guarda nada. El botón 🏷️ abre el panel Propiedades (pestaña de asociaciones guardadas: ver/cambiar/borrar) — diseño completo en `units-coordinates-properties-panel.md`.
- **Aislamiento por entidad**: cada Placemark/feature en su propio `try`; fallos se cuentan en `makeImportReport` y el resto sigue. `warn()` = entidad perdida, `note()` = advertencia sin coste (p. ej. reparación de namespace); `hasIssues` decide si hay algo que mostrar.
- **Avisos**: `navMessage(txt, { sticky, tone })`. Transitorios → `MSG_TIMEOUT`; `sticky` se queda hasta «Aceptar» (resúmenes con omitidos). Se apilan por líneas, tope `MSG_MAX_LINES` (solo afecta a transitorios).
- **Solo DOS tonos, no añadir un tercero**: `info` = notificación (color normal de texto, nunca gris — gris es "deshabilitado"); `error` = alerta (rojo), tono por defecto. «Exige lectura» es `sticky`, ortogonal al tono. Pregunta al escribir un aviso: «¿esto ha fallado?» — confirmar algo que el usuario pidió no lo es.
- **Aviso repetido funde línea y cuenta** (`line._msgKey`): incrementa contador (`×3`), reinicia temporizador, no cambia de posición (evita que el texto salte bajo el cursor). Búsqueda lineal acotada a `MSG_MAX_LINES`.
- **Timestamp completo** por aviso (`msgStamp`). En línea fundida se muestra la marca de la última repetición.
- **`msgLog`** (tope `MSG_LOG_MAX`): registro de sesión de TODOS los avisos, solo en memoria (no IndexedDB), accesible desde el botón 📋 (punto = hay entradas sin ver). Orden cronológico, más reciente abajo; al abrir baja el scroll del todo. `logText()` serializa para portapapeles.
- `msgLog`/`navMessage` viven en `30-tree-walk.js`; `refreshLogButton` (archivo posterior) usa `getElementById` en cada llamada, no una `const` de módulo (zona muerta temporal).
- **Frenos ad hoc que siguen activos**: `ELEV_STATUS_QUIET`, `savePending`, `elevAccumCapped`, `updateNoticeShown`. `demStatus` limita una fuente de alta frecuencia (ratón sobre el MDT) — no quitar.
- **Cotas de KMZ**: `KMZ_MAX_ENTRIES`, `KMZ_MAX_UNCOMPRESSED`, `KMZ_MAX_RATIO` frenan zips desproporcionados/hostiles antes de descomprimir.
- **CSP** (`<head>`): `default-src 'none'` + orígenes reales enumerados (unpkg, cdnjs, teselas del mapa/MDT). Añadir un origen nuevo exige añadirlo ahí también. `'unsafe-inline'` es inevitable con CSS/JS en el propio archivo.
- **`connect-src` e `img-src` son la excepción deliberada**: abiertas a cualquier `https:` (nunca `http:`) porque el usuario elige el origen — el botón 🔗 para `connect-src`, y el mapa base «Custom Maps» (`base-maps.md`) para `img-src`, su propio servidor de teselas — enumerar es imposible por definición en los dos casos. `default-src 'none'` sigue vigente, `script-src`/`style-src` conservan sus listas cerradas (un origen ajeno puede dar datos, nunca código ni estilos). `tests/minified.js` lo comprueba **sobre el `<meta>`**, no con `includes` sobre el archivo entero (esos nombres también aparecen en el JS).
