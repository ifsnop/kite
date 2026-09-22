---
description: Menú contextual del visor, hit-testing propio por geometría, submenú con capas superpuestas.
paths:
  - "src/js/42-hittest.js"
  - "src/js/70-view-controls.js"
---

## Menú contextual del visor

- `CTX_MENU_ITEMS`: lista genérica (centrar, medir, exportar PNG…) en
  click derecho sin capa. Sobre una capa se anteponen «Ir al nodo en el
  panel» (`highlightNode`), «Mostrar propiedades» si hay algo que
  enseñar (`showLayerInfo`, solo lectura) y «Editar propiedades» si el
  tipo admite diálogo de estilos (`STYLE_EDITABLE_KINDS`, mismo criterio
  que `openStyleDialog`). Nombrado distinto de «Mostrar propiedades» a
  propósito (dos ítems iguales confundirían), aunque el resto de la app
  llame «propiedades» a ambos indistintamente.
- **Varias capas superpuestas → submenú** con una entrada por capa
  (`ctxItemsFor`/`openCtxSubmenu`).
- **Elegir una capa la hace PARPADEAR** (`blinkLayer`, 4 pasos de
  `BLINK_INTERVAL_MS`): las tres acciones lo hacen, no solo «Ir al
  nodo», porque ninguna dice por sí sola cuál de las capas superpuestas
  es. Vive en los wrappers (`goToNodeAndBlink` etc.), no dentro de
  `showLayerInfo`/`openStyleDialog` (se abren también desde otros
  caminos, p. ej. hover, donde parpadear molestaría). Parpadea también
  con una sola capa debajo.
- **Hit-testing propio con geometría real** (`layersAtPoint`/
  `layerHitTest`): Leaflet solo resuelve una capa por click en canvas
  (sin bubbling real). Probar por caja envolvente es incorrecto (una
  diagonal larga "acierta" a 226 px, un polígono cóncavo acierta en su
  hueco vacío): se prueba la geometría — ray-casting (`pointInRing`/
  `pointInRings`) + distancia a segmentos (`segDistSq`/`nearPolyline`)
  en píxeles de contenedor, con `PATH_HIT_PX` (10, el `clickTolerance`
  de Leaflet) ensanchado por el grosor del trazo. La caja envolvente
  queda solo como criba previa barata (7,2 ms/click con 2002 capas).
- Acierta un polígono el click dentro del área o cerca del contorno
  (igual que el renderizador de Leaflet); un punto en un agujero queda
  fuera salvo pegado al borde.
- **El lado de cierre de un anillo hay que añadirlo a mano**:
  `getLatLngs()` de un `L.Polygon` no repite el punto inicial — sin el
  parámetro `closed` de `nearPolyline`, el último lado no se prueba.
- **Despacho POR CLASE, no duck-typing**: un `L.Circle` heredaría
  `getLatLng` de `L.CircleMarker` y se probaría como punto de 20 px en
  su centro, ignorando el radio. `L.Polygon` extiende `L.Polyline`: el
  orden de comprobación importa.
- **Se descartó "pelar" capas** (ocultar la de arriba y repreguntar a
  Leaflet): `Canvas._initPath` reinserta una capa reañadida al FINAL del
  orden de pintado, así que alteraría el z-order en cuanto hubiera
  alguna capa intermedia no tocada.
- **Clic derecho en un manejador de medición: solo en modo presentación
  abre el menú.** Leaflet no deja llegar el "contextmenu" nativo de un
  marcador interactivo hasta el mapa en cuanto ese marcador tiene
  CUALQUIER listener propio de "contextmenu". Por eso cada manejador
  reinvoca a mano `openCtxMenuFromMouseEvent` (`70-view-controls.js`)
  cuando el gesto no va a borrar nada: en modo presentación (diálogo
  cerrado) abre el menú; en modo edición (diálogo abierto) sigue
  borrando el vértice al instante, sin menú, como antes. Sirve también
  de acceso directo a «Editar propiedades» desde el manejador.
- **Doble click NO hace zoom en NINGÚN modo de edición**, no solo
  mientras se dibuja (insertar dos vértices con Mayús+clic es
  indistinguible de un intento de doble click). `anyEditModeActive()`/
  `refreshDoubleClickZoom()` (`52-measure.js`) miran a la vez:
  herramienta de dibujo (`activeTool`), polígono/ruta en edición
  (`vertexOwner`) y diálogo de un CÍRCULO abierto (no pasa por
  `vertexOwner`, se comprueba contra `styleTargets`/`styleKindOpen`) —
  los tres pueden estar activos simultáneamente. Llamado desde
  `setTool`, `teardownVertexOwner`/`syncVertexOwnerForDialog` y
  `openStyleDialog`/`closeStyleDialog`.
