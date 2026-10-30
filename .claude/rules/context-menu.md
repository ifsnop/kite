---
description: Menú contextual del visor, hit-testing propio por geometría, submenú con capas superpuestas.
paths:
  - "src/js/42-hittest.js"
  - "src/js/70-view-controls.js"
---

## Menú contextual del visor

- `CTX_MENU_ITEMS`: lista genérica, en click derecho sin capa. **Cuatro
  filas, sin separadores, agrupadas por tema** (pedido, 30-10-2026):
  «Copiar coordenadas»; **«Consultas ▸»** con «Elevación» y «Parcela
  catastral» (dos entradas distintas que se activan por separado, no una
  combinada); **«Medir ▸»** con Ruta, Círculo y Arco; **«Crear ▸»** con
  «Polígono o línea», «Pin», «Anillos de alcance…» y «Sector…». **Fuera, a propósito**: los tres «Centrar…»,
  «Paralelos y meridianos» y «Exportar PNG», que ya tienen su botón en la
  barra del visor (⤢, IB, GC, #, 📷) — un menú que repite los botones solo
  estorba. Un grupo nuevo de entradas del mismo tema es otro submenú, no
  filas sueltas. Ya no hay entradas con `checked()` (interruptor): se quitó
  su soporte de `renderCtxItems`; si hace falta otra vez, se reañade con su
  prueba. Sobre una capa se anteponen «Ir al nodo en el
  panel» (`highlightNode`), «Mostrar atributos» si hay algo que
  enseñar (`showLayerInfo`, solo lectura) y «Editar propiedades» si el
  tipo admite diálogo de estilos (`STYLE_EDITABLE_KINDS`, mismo criterio
  que `openStyleDialog`; incluye `cog`, aunque una ortofoto COG —como una
  de KMZ— no se acierta con el clic derecho: `subHitTest` no sabe de
  rásteres, se edita desde su fila). Nombrado distinto de «Mostrar atributos» a
  propósito (dos ítems iguales confundirían), aunque el resto de la app
  llame «propiedades» a ambos indistintamente.
- **`disabled()` opcional en un ítem**: devuelve el MOTIVO (texto, va al `title`) o algo falso. El ítem se pinta deshabilitado, no se esconde. Hoy lo usan «Consultas › Elevación» (`elevQueryDisabled`: mapa rotado, o las dos fuentes de elevación en «Ninguna») y «Obtener perfil» (`routeProfileDisabled`).
- **«Consultas › Elevación»** (`queryElevationAt(latlng)`) sustituye al antiguo interruptor «Modo elevación» y al botón ⛰: una consulta puntual de la tesela bajo el puntero, una capa por consulta. Ver `elevation-dem.md`.
- **«Consultas › Parcela catastral»** (`queryCadastralParcelAt(latlng)`, `65-cadastre.js`), junto a «Elevación» en el submenú «Consultas» de `CTX_MENU_ITEMS`: trae el polígono de la parcela bajo el puntero como capa del árbol. Sin `disabled()`: no depende del giro del mapa. Ver `cadastre.md`.
- **«Obtener perfil» / «Mostrar perfil»** sobre una ruta (`isRouteLi`, arcos incluidos): un solo ítem, `routeProfileCtxItem(li)` (`63-route-profile.js`), «Mostrar» si ya tiene perfil; «Obtener» con `disabled: () => routeProfileDisabled(li)` (sin fuentes, o ruta más larga que el límite). El `disabled()` genérico de `renderCtxItems` vale también para los ítems de capa y los de un submenú. **Va también en el menú de VARIAS capas** (`ctxItemsFor`): una ruta, el ítem tal cual; varias, submenú «Perfil de ruta» por nombre. **Trampa (fallo real)**: una ruta casi nunca está sola bajo el cursor — las celdas de su propio perfil (o de cualquier cuadrícula de elevación) quedan debajo y el hit-testing las acierta aunque sus rectángulos sean `interactive: false` (prueba la geometría, no los eventos de Leaflet); con el ítem solo en `layerCtxItems`, la opción desaparecía tras el primer perfil. Ver `elevation-dem.md`, «Perfil de una ruta».
- **«Medir ▸» es un submenú fijo de `CTX_MENU_ITEMS`** con Ruta, Círculo y Arco (cada uno alterna su herramienta con `setTool`); «Crear ▸» agrupa «Polígono o línea» (también alterna `setTool`), «Pin» (`createPin`, en el centro de la vista) y «Anillos de alcance…»/«Sector…» (`openRangeDialog(modo, latlng)`, `53-range-rings.js`): las únicas hojas que USAN el punto pulsado (es el centro por defecto), así que su `action` recibe `latlng`.
- **Elegir una acción devuelve el foco al VISOR antes de ejecutarla**
  (clic del ítem en `renderCtxItems`): ocultar el menú lo dejaba en el
  `<body>`, donde las teclas son del ÁRBOL, y `focusDialog` lo habría
  guardado como destino de retorno — el diálogo abierto desde el menú
  devolvía el foco al panel. Con el visor ya enfocado, `releaseFocus` lo
  devuelve ahí al cerrar. Vale para cualquier diálogo nuevo abierto
  desde una entrada del menú.
- **Cerrar una ficha o etiqueta también deja el foco en el visor.**
  Todo cierre de `#desc-dialog` pasa por `hideLayerInfo`
  (`32-geojson.js`), y `showLayerInfo` empuja SIEMPRE una entrada a
  `focusReturn` (la del visor si se abrió con el ratón, `focus: false`):
  antes el cierre sin apertura emparejada sacaba una entrada ajena y el
  foco iba al árbol. Sin foco en la ficha (cierre por temporizador) solo
  se descarta la entrada, no se roba el foco. Las etiquetas de Leaflet
  (popup) se tratan en `popupclose` (`70-view-controls.js`): si el foco
  se perdió (`<body>` o el ×), vuelve al contenedor. Además
  `closeStyleDialog` ya no descarta su entrada antes de devolver el foco.
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
  queda solo como criba previa barata (7,2 ms/click con 2002 capas),
  con las CUATRO esquinas de la caja proyectadas (con el mapa rotado,
  noroeste/sureste ya no son los extremos en pantalla; ver
  `map-rotation.md`).
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
