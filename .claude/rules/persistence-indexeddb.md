---
description: IndexedDB — DB_VERSION/TREE_SCHEMA, serialización del árbol, claves del almacén (nombres GeoJSON, tope de vértices, unidad, formato de coordenadas).
paths:
  - "src/js/**"
---

## Persistencia (IndexedDB)

- Base `visor-kml` (nombre heredado, no se cambia: rompería el árbol/
  vista ya guardados de cualquier usuario). `DB_VERSION` versiona los
  almacenes (hoy **5**: `tree`, `rasters` y `segments`, lista
  `DB_STORES`); `TREE_SCHEMA` versiona el formato del árbol serializado
  (`{ v, nodes }` bajo la clave `root`). Actual: **9** — nuevos tipos de nodo
  `arcgis`/`arcgisLayer` (un servicio ArcGIS y sus capas, ver
  `arcgis.md`; la 8 trajo `cog`, ver `cog.md`; la 7, `waypoints` en las
  mediciones). Lista completa por versión en el comentario de la propia
  constante; anotar ahí la siguiente subida.
- **Subir `DB_VERSION` YA NO vacía la base** (cambio de regla en la v4):
  `onupgradeneeded` crea los almacenes de `DB_STORES` que falten y borra
  los que no estén en la lista, sin tocar los que siguen. Antes se
  borraba todo, y añadir el almacén `rasters` habría tirado el árbol de
  todo el mundo a cambio de nada. `tests/browser/cog.mjs` abre la app
  sobre una base v3 con un árbol v7 y comprueba que lo conserva.
- **`TREE_SCHEMA` 9 acepta un árbol v8 (y v7) TAL CUAL** (`dbLoadTree`,
  `importTreeExport`): cuarta excepción, misma forma que la siguiente —
  solo se AÑADEN tipos de nodo—, y se subió para que una instancia
  ANTERIOR rechace un árbol con servicios ArcGIS en vez de leer un `arcgis`
  con hijos como una carpeta. Probado en `tests/browser/arcgis.mjs`.
- **`TREE_SCHEMA` 8 acepta un árbol v7 TAL CUAL** (`dbLoadTree`,
  `importTreeExport`): segunda excepción a «sin compatibilidad hacia
  atrás», y sin transformar nada — la 8 solo AÑADE un tipo de nodo, así
  que un v7 ya es un v8 válido. Se subió igualmente para que una
  instancia ANTERIOR rechace un árbol/`.kite.json` con el tipo nuevo.
  El pegado entre pestañas (`40-panel-actions.js`) sigue exigiendo la
  misma versión.
- **Guardado en dos niveles** (`DB_VERSION` 5, `32-geojson.js`, «Guardado
  en dos niveles»): el `root` guardado es un ESQUELETO; la parte pesada de
  cada hoja (`layer` → `geo`+`desc`, `elevGrid` → `cells`+`profile`,
  `imageOverlay` → `dataUrl`; `HEAVY_FIELDS`) va al almacén `segments`, y
  la hoja lleva `p: [segmento, índice]`. Cada guardado escribe como mucho
  UN segmento nuevo con lo nuevo o cambiado (bitácora); al arrancar,
  `segmentPlan` borra los muertos y funde los pequeños o medio muertos,
  **en la misma transacción que la lectura** (`dbLoadTree`): fuera de
  ella, un archivo soltado al arrancar podría perder sus segmentos.
  `TREE_SCHEMA` NO cambia: memoria, deshacer, portapapeles y `.kite.json`
  siguen con todo en línea; el reparto vive solo en `dbSaveTree`/
  `dbLoadTree`.
  - **Qué ha cambiado se sabe por IDENTIDAD** (`payloadsKnown`: `WeakMap`
    objeto pesado → (ficha/perfil → ref), más un `Map` para las cadenas
    `dataUrl`): la geometría cacheada (`li._geo`, `rec.geo`) nunca se
    modifica en el sitio. **REGLA**: todo código que altere una geometría
    tiene que pasar por `invalidateGeo` (o crear un objeto nuevo); si la
    mutara en el sitio, el guardado la daría por escrita y el cambio se
    perdería al recargar. Lo mismo para `cells`/`profile`.
  - **Auto-reparación entre pestañas**: cada guardado lista las claves de
    `segments` (pocas) y reescribe lo conocido cuyo segmento ya no está
    (otra pestaña lo limpió al arrancar). Lo que aun así falte al leer se
    quita del árbol con aviso sticky (`joinPayloads`).
  - **Por qué segmentos y no una clave por capa**, medido con 22k capas:
    una clave por capa tardaba 9,4 s en el primer guardado y 1,16 s en
    leerse (frente a 0,24 s del `root` único). Pocos registros grandes.
  - **TERCERA excepción** a «sin compatibilidad hacia atrás», decidida con
    el usuario: un `root` v8 con todo en línea (anterior a v5) se lee TAL
    CUAL (`joinPayloads` deja pasar las hojas sin `p`) y el primer
    guardado lo reparte. Una instancia anterior no puede abrir una base v5.
  - Pruebas: `tests/splitsave.js` (lo puro) y `tests/browser/split-save.mjs`
    (disco = memoria tras cada operación, 200 al azar, fusión, dos
    pestañas, subida desde v4).
- **Almacén `rasters`** (`64-cog.js`): clave = id aleatorio de 32 hex
  (`newStoreId`, el mismo generador que el de los segmentos), valor = `{ blob, name, size }` con el `Blob`/`File`
  NATIVO (nada de base64: Chromium lo guarda aparte, y uno ya en el
  almacén de blobs lo referencia sin copiarlo — 362 MB en 31 ms). El
  nodo `cog` guarda `{ rasterId, box, opacity }`, validado al leer
  (`validCogRecord`). **Limpieza**: al arrancar, con el árbol leído de
  verdad (`treeRead`), `cleanOrphanRasters` borra los ids que no nombra
  ni el árbol actual (`serializeTree()`, que cubre lo soltado mientras
  se leía) ni las pilas de deshacer/rehacer ni el portapapeles interno.
  En sesión no se borra nada: deshacer un borrado tiene que poder
  devolver la ortofoto.
- **Primera excepción a «sin compatibilidad hacia atrás»** (principio
  nº4; la segunda es la de v7 de arriba): `dbLoadTree`/`importTreeExport` reconocen un árbol/archivo v6 y
  lo suben en silencio con `upgradeMeasuresV6`, en vez de descartarlo.
  NO se aplica al pegado entre pestañas del portapapeles del sistema,
  que exige misma versión ahora mismo.
- **`style` es un saco ABIERTO** (`opacity`, la opacidad del contorno de un polígono, entró así: un árbol anterior no la trae y se lee como 1): añadirle una clave NO sube
  `TREE_SCHEMA`. `normalizePathStyle` completa valores por defecto para
  lo que falte (`fill`, `stroke`, `fillColor`, `textAlways`…), así que
  un árbol anterior sigue funcionando. Sube la versión solo cambiar la
  FORMA del registro: tipo de nodo nuevo, campo que desaparece, campo
  que cambia de significado.
- `serializeNode(li)` serializa un nodo y sus hijos (`serializeNodes`);
  `serializeTree()` es esa pasada sobre la raíz — consumida por el
  guardado automático y la exportación de carpeta. Cada tipo de nodo
  guarda lo necesario para reconstruirse (geometría como GeoJSON vía
  `layer.toGeoJSON()`, estilo de trazo en `style`, estilo de marcador en
  `mstyle` si se personalizó, mediciones como tipo+waypoints,
  contenedores con `collapsed`+`children`). `restoreTree()` reconstruye
  y reaplica `mstyle`.
- Una sola conexión (`dbPromise`), con `onversionchange`/`onclose` para
  soltarla si otra pestaña actualiza el esquema.
- Los guardados se serializan en una cadena de promesas (`saveChain`):
  lo que queda en disco es siempre el estado más reciente aunque se
  encadenen mutaciones rápidas.
- **Toda mutación del panel debe llamar a `scheduleSave()`** (debounce
  400 ms) — parte del cambio, no un extra. Los cambios de estilo
  también son mutaciones del árbol.
- Cambiar el formato serializado → sube `TREE_SCHEMA`; cambiar los
  almacenes → sube `DB_VERSION`. En ambos casos lo viejo se descarta.
- **Nombres de GeoJSON recordados** (`geojsonNameProps`, `GNP_SCHEMA`):
  mapa de huella de `properties` (`propsFingerprint`) → ARRAY ORDENADO
  de claves elegidas para componer el nombre (`GNP_SCHEMA` 2; la v1
  guardaba una sola clave y se descarta al leer; `dbLoadGnp` ignora
  además entradas cuyo valor no sea un array no vacío de strings). Ver
  `import-parsing.md`.
- **Segmentos de un arco** (`arcSegments`, `ARC_SEGMENTS_SCHEMA`): entero en [`ARC_SEGMENTS_MIN`, `ARC_SEGMENTS_MAX`] (2–720), validado al leer; clave propia del mismo almacén. Un arco ya dibujado es una ruta y no guarda nada de esto.
- **Fuentes de elevación** (`elevSources`, `ELEV_SOURCES_SCHEMA`): `{ v, mdt, mds }` con un id del catálogo `ELEV_SOURCES` o `null` («Ninguna»); `dbLoadElevSources` lo pasa por `validElevSources` (id retirado o de otro tipo → el de por defecto; así cae también el antiguo `ign-mdt`, hoy `ign-mdt05`). Restaurado en `99-boot.js`. Las celdas de una capa `elevGrid` omiten la clave `mdt`/`mds` del modelo no consultado: JSON lo conserva tal cual, NO sube `TREE_SCHEMA` (ver `elevation-dem.md`). La capa de un **perfil de ruta** lleva además un campo opcional `profile` (`{ key, total, vertices, mdt, mds }`, curvas compactas `[d, v]`): campo añadido y opcional, tampoco sube `TREE_SCHEMA`; se valida al leer con `validRouteProfile` en `buildElevGridRecord` (entrada ajena: un perfil inválido se descarta y la capa queda como cuadrícula normal). Viaja por `serializeNode`, `serializePendingRecords` y `materializeRecords`.
- **Unidad de altitud** (`altitudeUnit`, `ALTITUDE_UNIT_SCHEMA`, `validAltitudeUnit`: una de `MEASURE_UNITS`) y **longitud máxima de un perfil** (`profileMax`, `PROFILE_MAX_SCHEMA`, `{ v, m }` en metros, `validProfileMax`: finito y en [`PROFILE_MAX_MIN`, `PROFILE_MAX_MAX`]): claves propias del almacén `tree`, restauradas en `99-boot.js`. Ver `units-coordinates-properties-panel.md`.
- **Frecuencia de Fresnel** (`fresnelFreqMHz`, `FRESNEL_FREQ_KEY` = `"fresnelFreq"`, `FRESNEL_FREQ_SCHEMA`, `{ v, f }` en MHz, `validFresnelFreq`: finito y en [`FRESNEL_FREQ_MIN`, `FRESNEL_FREQ_MAX`]): clave propia del almacén `tree`, como `profileMax`; restaurada en `99-boot.js`. No sube `DB_VERSION` ni `TREE_SCHEMA`. Ver `units-coordinates-properties-panel.md`.
- **Tope de vértices editables** (`vertexEditMax`, `VERTMAX_SCHEMA`):
  número simple, validado al leer (`Number.isInteger` y `> 0`, para que
  no se cuele un tope de 0). Ver `measurements-drawing-vertex-editing.md`.
- **Vista de móvil** (`mobileView`, `MOBILE_VIEW_KEY` = `"mobileView"`, `MOBILE_VIEW_SCHEMA`, `{ v, choice }`, `choice` uno de `MOBILE_VIEWS` = `map|nav`): qué se eligió ante el aviso «Mejor desde un ordenador»; clave propia del almacén `tree`, validada al leer, restaurada lo primero en `99-boot.js` (`initPhoneLayout`). No sube `DB_VERSION` ni `TREE_SCHEMA`. Ver `mobile-view.md`.
- **Idioma de la interfaz NO está aquí**: vive en `localStorage` (`kite.uiLang`, `"auto"` o el código de un idioma registrado) porque hace falta de forma síncrona antes de ejecutar nada; es la única excepción a «los ajustes van en IndexedDB». Sin `UI_LANG_SCHEMA` (un valor desconocido se ignora) ni subida de `DB_VERSION`/`TREE_SCHEMA`. Ver `i18n.md`.
- **Tema de la interfaz** (`uiTheme`, `UI_THEME_KEY` = `"uiTheme"`, `UI_THEME_SCHEMA`, `{ v, theme }`, `theme` uno de `UI_THEMES` = `auto|light|dark`): clave propia del almacén `tree`, como `coordFormat`; `dbLoadUiTheme` valida contra la lista y devuelve `null` si no cuadra. Restaurada lo primero en `99-boot.js`. No sube `DB_VERSION` ni `TREE_SCHEMA`. Ver `theme.md`.
- **Unidad de medida y formato de coordenadas** (`measureUnit`,
  `coordFormat`): claves `MEASURE_UNIT_KEY`/`MEASURE_UNIT_SCHEMA` y
  `COORD_FORMAT_KEY`/`COORD_FORMAT_SCHEMA`, validadas contra la lista de
  valores posibles (cinco unidades; `"dec"`/`"dms"`). Editables en el
  panel Propiedades, restauradas en `99-boot.js`. Ver
  `units-coordinates-properties-panel.md`.
