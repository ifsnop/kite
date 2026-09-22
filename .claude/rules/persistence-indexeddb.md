---
description: IndexedDB — DB_VERSION/TREE_SCHEMA, serialización del árbol, claves del almacén (nombres GeoJSON, tope de vértices, unidad, formato de coordenadas).
paths:
  - "src/js/**"
---

## Persistencia (IndexedDB)

- Base `visor-kml` (nombre heredado, no se cambia: rompería el árbol/
  vista ya guardados de cualquier usuario). `DB_VERSION` versiona los
  almacenes (hoy: solo `tree`); `TREE_SCHEMA` versiona el formato del
  árbol serializado (`{ v, nodes }` bajo la clave `root`). Actual: **7**
  — nodos `measure` guardan `waypoints` (array `{lat,lng}`, longitud 2
  para línea/círculo, N para `mtype: "route"`) en vez de los antiguos
  campos sueltos `a`/`b`. Lista completa por versión en el comentario de
  la propia constante; anotar ahí la siguiente subida.
  **Única excepción a «sin compatibilidad hacia atrás»** (principio
  nº4): `dbLoadTree`/`importTreeExport` reconocen un árbol/archivo v6 y
  lo suben en silencio con `upgradeMeasuresV6`, en vez de descartarlo.
  NO se aplica al pegado entre pestañas del portapapeles del sistema,
  que exige misma versión ahora mismo.
- **`style` es un saco ABIERTO**: añadirle una clave NO sube
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
  mapa de huella de `properties` (`propsFingerprint`) → propiedad
  elegida como nombre. Ver `import-parsing.md`.
- **Tope de vértices editables** (`vertexEditMax`, `VERTMAX_SCHEMA`):
  número simple, validado al leer (`Number.isInteger` y `> 0`, para que
  no se cuele un tope de 0). Ver `measurements-drawing-vertex-editing.md`.
- **Unidad de medida y formato de coordenadas** (`measureUnit`,
  `coordFormat`): claves `MEASURE_UNIT_KEY`/`MEASURE_UNIT_SCHEMA` y
  `COORD_FORMAT_KEY`/`COORD_FORMAT_SCHEMA`, validadas contra la lista de
  valores posibles (cinco unidades; `"dec"`/`"dms"`). Editables en el
  panel Propiedades, restauradas en `99-boot.js`. Ver
  `units-coordinates-properties-panel.md`.
