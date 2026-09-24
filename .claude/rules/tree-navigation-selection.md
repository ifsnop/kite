---
description: Árbol de navegación — visibilidad, checkbox de tres estados, teclado, selección múltiple, exportar/importar carpetas, arrastrar y soltar, deshacer/rehacer.
paths:
  - "src/js/30-tree-walk.js"
  - "src/js/31-tree-node.js"
  - "src/js/40-panel-actions.js"
  - "src/js/41-selection.js"
  - "src/js/70-view-controls.js"
---

## Reglas de comportamiento acordadas

- **Visibilidad**: una capa se muestra si y solo si SU checkbox está
  marcado. El checkbox de una carpeta/archivo es solo un interruptor
  masivo en cascada; no filtra por sí mismo.
- **La casilla de un contenedor tiene TRES estados**: marcada, sin
  marcar e **indeterminada** (`indeterminate` nativo, dibujado como
  guion; `aria-checked="mixed"` para lector de pantalla) cuando unas
  capas de dentro están activas y otras no.
- **`containerState` mira SOLO a los hijos directos.** Válido porque el
  invariante se mantiene de abajo arriba: un hijo contenedor cuenta
  como «entero» solo si está marcado y NO indeterminado, así que su
  estado ya resume su rama. `refreshAncestorChecks` sube por los
  ancestros a coste profundidad × hermanos (no recorrido del árbol) y
  **corta en cuanto un ancestro no cambia**. Medido en el peor caso
  (carpeta de 5.000 hermanos, 5 niveles): 5,4 ms/clic, dentro de un
  fotograma.
- **El disparador no es solo «se tocó una casilla»: también «cambió el
  conjunto de hijos».** Con la carpeta colapsada no hay fila para
  activar un descendiente, pero SÍ se le pueden añadir hijos sin
  desplegarla (soltar un archivo encima, `ensureNamedSection` en una
  carpeta colapsada) — y sin refrescar, una sección apagada seguía
  diciendo «apagada» tras recibir un pin visible. Por eso
  `refreshAncestorChecks` se llama también al importar dentro de una
  carpeta, pegar, crear pin/lugar/polígono/medición/elevación y crear
  carpeta; y `refreshChecksFrom` al borrar, con el `<ul>` capturado
  ANTES de quitar la fila (después ya no tiene padre).
- **Mover cambia ese conjunto en los DOS extremos.** Arrastrar no crea
  ni borra nodos, solo los reubica, así que nadie refrescaba origen ni
  destino. El `drop` de `wireDrag` recalcula ahora el destino y **los
  contenedores de origen, capturados en un `Set` ANTES de mover nada**
  (después los nodos cuelgan ya del destino). Pegar ya lo cubría:
  `materializeRecords` recalcula el destino al terminar su lote y
  `deleteNode` el origen al retirar lo cortado.
- **Vaciar una carpeta a medias le quita el guion.** Sin hijos,
  `containerState` devuelve `null` y la casilla se deja como esté (una
  carpeta recién creada y vacía la marca quien la crea) — el
  indeterminado no puede afirmar «mezcla» de una carpeta sin nada
  dentro. Se da al sacar el último hijo de una carpeta mixta.
- **Los hijos pueden estar en DOS sitios a la vez.** Una carpeta
  colapsada restaurada de IndexedDB llega con 0 filas y sus hijos como
  registros `_pending`; si además se le suelta un archivo dentro,
  conviven filas y registros. `containerState` mira los dos.
  `materializeRecords` recalcula también la casilla de la carpeta que
  se queda pendiente (sus hijos nunca llegan a ser filas). El estado
  agregado se memoriza en `rec._state` (rama colapsada con miles de
  nodos); `cascadeVisibility` lo invalida al tocar `checked`.
- **Un registro pendiente necesita su icono de marcador ya aplicado a
  la capa cruda, no prestado de una fila que puede no llegar a
  existir.** `cascadeVisibility` enciende un marcador colapsado vía
  `setLayerVisible(rec._layer, checked)` — la misma capa `L.geoJSON`
  que `buildRecordsFromStorage` construyó sin `pointToLayer` (icono
  Leaflet nativo). El icono personalizado (`mstyle`) se aplicaba antes
  solo al construir la FILA, así que un marcador con icono MDI,
  desactivado dentro de una carpeta nunca desplegada, volvía a la gota
  de Leaflet al activarlo tras recargar. Arreglo:
  `buildRecordsFromStorage` aplica el icono a la capa cruda en el
  momento de construirla (`styleMarkerIcon`, extraído de
  `applyMarkerStyle` en `42-hittest.js` para poder llamarlo sin `<li>`)
  — antes de mirar si está marcada, y sin coste si la fila SÍ llega a
  construirse después (`setIcon` con el mismo icono no hace nada). Este
  camino es compartido por restaurar de IndexedDB, deshacer/rehacer,
  pegar e importar `.kite.json`: el arreglo cubre los cuatro.
- **Desplegar y marcar a la vez no puede repartirse entre pasadas.**
  `materializeRecords` (construye filas que faltan) y
  `cascadeVisibility` (enciende/apaga) son dos pasadas sobre el mismo
  subárbol; si cada una mira su propia foto, la cascada llega antes de
  que `_pending` se vacíe del todo y las filas que faltan nacen con su
  estado guardado en vez del pedido (medido con 466 capas: 150
  encendidas, 316 apagadas, carpeta en indeterminado al pedir «marcar
  todo»). Arreglo por los dos extremos: `walkLi` espera la
  materialización EN VUELO de ese nodo antes de mirar a sus hijos, y la
  cascada **repite la pasada** mientras `materializingNow`/
  `materializeSeq` indiquen que el conjunto sigue moviéndose (gratis:
  la pasada es idempotente; `yieldFrame` evita girar en vacío).
- **La cascada limpia el indeterminado a su paso**: deja la rama
  uniforme; lo que puede cambiar además es el estado de los ancestros
  de la carpeta tocada.
- **Estado inicial desde KML**: `<visibility>` hereda hacia abajo;
  `syncSubtree` marca después cada carpeta según tenga o no capas
  visibles. `<open>` decide el colapso inicial (ausente = 0 =
  colapsada). Los GeoJSON arrancan colapsados.
- **La vista del usuario es sagrada**: cargar archivos NUNCA cambia
  zoom/encuadre; el primer doble click en una fila solo hace `panTo`
  al centro de sus capas, sin tocar el zoom (para encuadrar está el
  botón de autoescalar).
- **Botón 🔍 de enfoque** (`focusOnNode`, `FOCUS_ZOOM`): centra y fija
  el zoom siempre igual, sin depender de la vista previa — más fiable
  que el doble click, que encadena escalones. **Excepción**: un
  polígono o medición (`styleKind` "polygon"/"measure") se encuadran
  enteros con margen (`fitBoundsFramed`, 20%) en vez de zoom fijo, para
  no cortar una ruta ancha. El doble click sobre esas filas sigue la
  escalera normal; solo cambió el botón 🔍.
- **El nombre de la fila NO activa la casilla** (sin `htmlFor` en el
  `<label>`): pinchar el nombre selecciona la fila; doble click sobre
  él alternaba visibilidad a medias. La casilla se pulsa aparte;
  espacio hace lo mismo desde teclado.
- **Escalera de zoom del doble click**: si la vista YA está centrada en
  ese nodo (`isCenteredOn`, comparación en PÍXELES, no grados), sube
  por peldaños fijos 5 → 9 → zoom máximo → 3 → 5… (`nextZoomStep`),
  cíclico a propósito para no dejar al usuario atrapado arriba. Se arma
  en cada llamada (el máximo depende del mapa base activo) y descarta
  peldaños duplicados. Excepción: un resultado del buscador de lugares
  encuadra su `boundingbox` (o centra sus coordenadas) directamente.
- **Buscador de lugares**: consulta Nominatim, hasta 5 resultados; la
  lista vive en la cabecera y empuja el árbol hacia abajo (se cierra
  con «×»). Elegir un resultado crea un marcador por defecto en
  «Lugares» (`ensureNamedSection`, localiza secciones existentes por
  nombre). `placeSeq` descarta respuestas de búsquedas ya superadas.
- **Gestos del visor**: Shift+arrastre = box-zoom de Leaflet (reservado);
  Ctrl+arrastre = editar centro/borde de un círculo de medición (un
  vértice de ruta/polígono ya NO lo exige, ver «Selección de vértice»);
  herramienta de medición activa = el arrastre dibuja (pan desactivado;
  mover un vértice ya puesto durante el dibujo es arrastre SIN Ctrl,
  mismo motivo que quitó el Ctrl a la edición post-creación). **Mover,
  insertar o borrar un vértice, o el centro/borde de un círculo, exige
  además tener abierto el diálogo de propiedades de ESE nodo**
  (`styleDialogShows`): sin él, ninguno de estos gestos hace nada.
  **Mayús+clic tiene DOS significados**: selección múltiple de nodos en
  el panel, o (visor, diálogo de ruta/polígono abierto) insertar un
  vértice — nunca ambos a la vez. La tecla **Insertar** hace lo mismo
  sin ratón.
- **Gestos de la navegación**: Shift+click = selección múltiple
  (`topLevelSelection()` excluye nodos ya contenidos en otro
  seleccionado); Supr borra la selección; Escape cierra diálogos
  abiertos o, si no hay ninguno, limpia herramienta y selección; doble
  click en una fila lleva la vista a sus capas. «Activar/Desactivar» =
  checkboxes; «seleccionar» = selección múltiple.
- **Teclado del panel, como un árbol de Windows**: ↑↓ mueven cursor y
  selección (olvidando la anterior); → despliega y, si ya estaba
  abierta, entra en el primer hijo; ← colapsa y, si ya cerrada, sube a
  la carpeta madre; Av/Re Pág saltan `PAGE_STEP` filas; **Inicio/Fin
  van a los extremos de la carpeta actual** (`siblingRows`), no de la
  lista entera; espacio activa/desactiva lo seleccionado; Escape limpia
  selección y cancela un corte pendiente; Supr borra; Ctrl+C/X/V
  copian/cortan/pegan; Alt+Intro abre propiedades.
- **Moverse cuesta O(profundidad), no O(nodos)**: `nextRow`, `prevRow`,
  `stepRows`, `selectRange` navegan por hermanos/hijos/madre, nunca
  listan todas las filas visibles (con eso: ~7 ms → 0,08 ms con 10.000
  nodos). No reintroducir barridos globales en el camino del teclado.
- **El click lleva el cursor donde se pulsa** y deja ese nodo como
  única selección, salvo si cae en un botón de fila (actúan sobre la
  selección existente sin cambiarla).
- **Los botones de fila aparecen solo con el ratón encima** — ni la
  fila del cursor ni `:focus-within` (el foco pasa a la casilla al
  pulsar, y `:focus-within` los dejaría fijos sin ratón). No son
  alcanzables con Tab; el camino de teclado son los atajos.
- **Teclas estilo Windows**: F2 renombra; Ctrl+A selecciona la carpeta
  actual y, repetido, todo el árbol; Ctrl+F al buscador; Ctrl+Z/Ctrl+Y
  deshacen/rehacen; `?` abre la chuleta. Sin escritura anticipada (el
  buscador del panel ya cubre esa necesidad).
- **Renombrar es F2 o el diálogo de propiedades** (fila «Nombre», solo
  con un nodo seleccionado, cualquier tipo de capa). No hay botón lápiz
  por fila.
- **El texto de una fila NO siempre es su nombre**: una medición
  muestra «Nombre — 85,18 km / 46,0 NM · 89,7°», repintado por
  `updateMeasurement` desde `_onRename`. Por eso `startRename` devuelve
  la etiqueta TAL CUAL (no `li._name`, que borraría la medida). Toda
  fila cuyo texto no sea el nombre a secas depende de esto.
- **Ancla y rangos**: Shift (teclado o click) selecciona todo entre
  ancla y destino, reemplazando la selección; Ctrl+Shift+click
  marca/desmarca un solo nodo sin arrastrar los intermedios.
  `selAnchor` solo lo mueven las acciones sin Shift.
- **Ya no se exige que la selección sea del mismo tipo**: el diálogo de
  propiedades comprueba la mezcla y avisa si no se puede editar en
  bloque. Con varios nodos no se edita posición (es de cada uno); el
  resto va en bloque (ver «Editar varios a la vez»).
- **El estado de colapso es de cada nodo**: colapsar una carpeta no
  toca el de sus hijas. No introducir colapso "heredado".
- **Botones de selección de carpeta**: en cada fila contenedora, ☑
  selecciona de golpe todas las capas de la rama
  (`selectFolderLayers`), ☐ quita la selección (= Escape). Solo caben
  capas del mismo tipo: manda el tipo de la primera encontrada y se
  avisa por `navMessage` de cuántas quedan fuera.

## Exportar e importar carpetas

- El botón 💾 de una carpeta o archivo descarga su subárbol como
  `<nombre>.kite.json`: mismo formato de registros que el guardado
  (`serializeNode`), envuelto en `{ app, db, schema, exported, nodes }`.
- El envoltorio declara tres versiones: `format` (`EXPORT_FORMAT`),
  `schema` (`TREE_SCHEMA`) y `db` (`DB_VERSION`). Al importar se
  comprueban las dos primeras; cualquier discrepancia se rechaza con
  mensaje claro — no se migra.
- Al soltar un `.json` se mira su CONTENIDO, no la extensión:
  `parseTreeExport` reconoce el envoltorio; si no lo es, sigue como
  GeoJSON.
- Lo importado siempre se AÑADE: nunca sustituye ni fusiona.

## Arrastrar y soltar

- **No se usa el arrastre nativo de HTML5.** Una sesión de arrastre
  nativa es un bucle de eventos ANIDADO del navegador: mientras dura,
  la página no recibe temporizadores, fotogramas ni entrada — un
  arrastre empezado sin querer congela la app sin ejecutar código
  propio (medido en producción: cuelgues de 27–33 s, memoria plana, sin
  eventos). Acotar el asa (prohibir empezar sobre caret/casilla/
  botones, exigir 350 ms de pulsación) no basta: el temblor normal de
  un click ya dispara el drag nativo. Única solución robusta: ningún
  `draggable` en el árbol.
- **A cambio**: el gesto se cancela con Escape, no puede quedar
  colgado (puntero capturado), cuesta una escucha por fila en vez de
  cinco más dos globales, y se puede probar con ratón real de punta a
  punta (ningún cliente de automatización abre la sesión de drag del
  navegador).
- **El destino se resuelve por GEOMETRÍA** (`elementFromPoint`), no por
  `e.target`: con el puntero capturado todos los eventos apuntan al
  árbol.
- Al probarlo con ratón real: una fila fuera de vista no está bajo
  ningún píxel (`elementFromPoint` da el panel) — desplazarla a la
  vista y medir el destino con el arrastre YA empezado.
- Las franjas de destino van en PÍXELES, no porcentaje (filas de
  24 px): 6 px arriba/abajo reordena entre hermanos, el resto de una
  carpeta mete dentro.
- La marca de destino la lleva UNA SOLA fila (`dropMarked`); barrer el
  árbol con `querySelectorAll` en cada movimiento iba a tirones.
- **Soltar un archivo EXTERNO sobre una carpeta SÍ es arrastre nativo**
  (los archivos llegan del SO, no hay otra vía): camino distinto
  (`navPanel`, `folderDropTarget`), no abre sesión de arrastre de la
  página.

## Deshacer y rehacer

- `pushUndo(etiqueta)` guarda una instantánea del árbol antes de cada
  operación destructiva (borrar, pegar, mover, ordenar) o de CREACIÓN
  (marcador, lugar del buscador, polígono/línea dibujados, ruta o
  círculo de medición — `tests/browser/undo-create.mjs`). Barato porque
  la geometría se cachea y las instantáneas la COMPARTEN en vez de
  clonarla.
- Toda operación nueva que destruya, reordene o CREE un nodo debe
  llamar a `pushUndo` ANTES de tocar nada — reportado como bug: crear
  un marcador o una medición no era deshacible porque ningún camino de
  creación llamaba a `pushUndo`. Se llama en el momento en que la
  mutación queda comprometida (mismo instante que `scheduleSave()`),
  no dentro de «Aceptar»/«Cancelar» de un diálogo de estilos abierto
  después: crear ya es una acción completa por sí misma, independiente
  de lo que se decida luego sobre el estilo del nodo recién creado.
- Ctrl+Y rehace: `undoLast` guarda el presente en `redoStack` antes de
  retroceder. Una acción nueva vacía esa pila (la historia se bifurca).
