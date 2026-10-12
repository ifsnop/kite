---
description: Reglas de rendimiento nacidas de medir (caché de geometría, guardado por lotes, progreso).
paths:
  - "src/js/**"
---

## Rendimiento (reglas nacidas de medir)

- **Mapa en lienzo** (`preferCanvas: true`): con miles de geometrías, SVG
  crea decenas de miles de nodos DOM y el zoom/pan se arrastra.
- **Caché de geometría por nodo, mecanismo CENTRAL** (`li._geo`):
  `toGeoJSON()` clona todas las coordenadas de la capa y se guarda tras
  CUALQUIER cambio del panel, así que sin caché renombrar reconstruía el
  archivo entero (medido: 349 ms → 5 ms con 8.000 capas). Se invalida
  SOLO donde cambia la geometría de verdad (mover un marcador), vía
  `invalidateGeo` — cualquier código nuevo que altere geometría debe
  invalidar ahí también. **`buildFromNodes` rellena `li._geo` con el
  `n.geo` ya guardado** (no lo deja en blanco): sin esto, deshacer,
  rehacer, pegar, importar `.kite.json` o el arranque volvían a pagar el
  coste completo. Cualquier código que reconstruya nodos «layer» desde un
  registro serializado debe seguir haciendo lo mismo (benchmark: 3-4× más
  rápido con caché tibia, 8.000 nodos).
- **`serializeNode` solo consulta `<ul class="node-list">` si
  `li._isContainer`** (asignado una vez en `makeNode`), evitando un
  `querySelector` de más en la inmensa mayoría de nodos (capas hoja) —
  pesaba tanto o más que el propio `toGeoJSON()` en geometrías pequeñas.
- **Retardo de guardado autoajustado** al coste medido del último
  (`saveCost`, entre `SAVE_MIN_MS` y `SAVE_MAX_MS`).
- **Lectura de coordenadas: un pintado por fotograma**
  (`requestAnimationFrame`, no por evento de ratón — llegan >100/s).
  Mismo patrón en el arrastre de marcador del diálogo de estilos
  (`onMarkerDragged`): solo `invalidateGeo` corre en cada evento `drag`;
  `renderCoords` se difiere a un único rAF, cancelado si el diálogo se
  cierra antes.
- **Moverse por el árbol cuesta O(profundidad)**, no O(nodos) — ver
  `tree-navigation-selection.md`. Ninguna operación de selección recorre
  la selección entera ni consulta el árbol por nodo. El buscador
  (`search-box`) sigue la disciplina: `SEARCH_DEBOUNCE_MS` (150 ms),
  mínimo `SEARCH_MIN_CHARS` (3) para no barrer ~8-10k nodos en cada
  tecla; Enter/Shift+Enter y ◀▶ no llevan ese mínimo (acción explícita).
- **Borrado de selección completa purga el `Set` UNA VEZ**
  (`clearSelection()` tras el bucle, no dentro de `deleteNode` por cada
  nodo — evita O(k²) al borrar k nodos de golpe). El resto de llamadas a
  `deleteNode(li, {pruneSelection})` sigue purgando por defecto.
- **Reconstruir una carpeta desde snapshot previo usa `Set`, nunca
  `Array.includes`** (`before.has(...)`): con array sería O(m²) sobre el
  tamaño de la carpeta destino. Aplica en `importTreeExport`,
  `addFileNode`, `pasteClipboard`.
- **`reorderPaintOrder` — pendiente de MEDIR, no de arreglar**: se
  dispara desde `scheduleSave()` en cualquier mutación (también las que
  no afectan orden de pintado), recorriendo todos los checkboxes del
  árbol. No es O(n²), pero nadie ha medido el coste con miles de capas.
  **No tocar sin medir antes** con `performance.now()` alrededor de
  `reorderPaintOrder()`.
- Regla general: medir antes de optimizar, y dejar la medida en el
  comentario — es lo que impide "simplificar" sin saber qué costaba.

## Rendimiento y progreso

- Umbral `SIZE_THRESHOLD` (~2.5 MB): por debajo, carga silenciosa; por
  encima, tres fases: descompresión KMZ (determinada), "Procesando
  XML…" (indeterminada, `DOMParser` es síncrono/monolítico), construcción
  por lotes (determinada).
- Constructores del árbol `async`, ceden el hilo cada `PROGRESS_BATCH`
  capas con `yieldFrame()`. Cualquier bucle nuevo que cree muchas capas
  debe seguir el mismo patrón.
- Sin Web Workers: el tamaño objetivo (6–20 MB) no los justifica (sin
  `DOMParser` ni Leaflet en worker).
- Iconos de marcador sin coste de red: empotrados, `applyMarkerStyle`
  síncrona (ver `marker-icons.md`).
