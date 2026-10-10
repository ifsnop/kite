---
description: Vista guardada, uso de almacenamiento/memoria, límites del mundo (una sola Tierra), teclado y rueda del visor (flechas, Re/Av Pág y rueda continuos; el foco se queda en el visor), zoom sobre teselas, cuadro de coordenadas y atribución.
paths:
  - "src/js/10-map.js"
  - "src/js/70-view-controls.js"
  - "src/js/99-boot.js"
---

## Vista guardada

- Centro y zoom se guardan en el MISMO almacén que el árbol, clave `view`
  (no otro almacén → no sube `DB_VERSION`), con su propia `VIEW_SCHEMA`.
- Se guarda con retardo tras `moveend`/`zoomend`, nunca durante el gesto;
  nada se guarda hasta haber restaurado (`viewRestoring`), o la vista por
  defecto pisaría a la guardada en el arranque.
- Al arrancar se restaura ANTES que el árbol: el mapa aparece donde se
  dejó mientras la reconstrucción (que puede tardar) ocurre por detrás.
- Lo leído se valida (`validView`, `Number.isFinite` — no convierte, así
  que un `"12"` guardado por error no se cuela) antes de mover el mapa.
- Descartar un árbol de otra versión borra **solo** la clave `root`, no
  el almacén entero: la vista es independiente y sigue siendo válida.

## Lo que consume el visor

Dos cotas bajo el árbol (`#usage`):

- **Almacenamiento** (`refreshStorageUsage`, `navigator.storage.estimate()`):
  se refresca tras cada guardado (ya trae su propio retardo), sin
  temporizador propio.
- **Memoria de la pestaña** (`refreshMemoryUsage`, temporizador propio
  `MEMORY_REFRESH_MS`): `performance.memory` es un captador barato
  (0,005 ms medidos), no una consulta a disco como `estimate()`.
- **Sin cifra, la línea se ESCONDE**, nunca un «no disponible» fijo (sería
  ruido permanente): archivo abierto por doble clic, o navegador no
  Chromium. El arranque tampoco arma el temporizador si no hay nada que
  refrescar.
- **Sobre `file://` no se muestra el número**: medido con Chromium 129,
  `usedJSHeapSize` se queda plano (~9,5 MB) aunque se reserve memoria
  real, mientras que la misma página por http sí refleja el uso — un
  número congelado con aspecto de medida en vivo engaña más que no poner
  nada. No arreglable desde la página: la API normalizada
  (`measureUserAgentSpecificMemory`) exige COOP/COEP, que ni `file://` ni
  GitHub Pages pueden dar. `performance.memory` no es estándar, solo
  Chromium; en el resto no hay línea.

## Una sola Tierra

Sin desplazamiento infinito: el mundo se ve una vez, TRES piezas
necesarias, cada una tapa un agujero distinto (con el mapa ROTADO cada
una necesita además su adaptación — `bounds` en las teselas, suelo de
zoom con la caja girada y límite del arrastre en el marco del mapa —,
ver `map-rotation.md`):

- **`noWrap`** en cada capa de teselas, puesto en `applyBaseLayer` (único
  sitio que instancia una capa base, no repetido en `BASE_LAYERS`) para
  que lo herede cualquier capa nueva sin acordarse. Se escribe sobre las
  opciones ya construidas porque `GridLayer` las consulta en `_resetGrid`,
  no en el constructor.
- **`maxBounds` con viscosidad 1** (borde no cede; el valor por defecto
  deja un efecto elástico no deseado). El rectángulo `WORLD_BOUNDS` se
  recorta a ±85,051…° (límite de Web Mercator), no a ±90.
- **Suelo de zoom dependiente del tamaño de ventana** (`fitWorldMinZoom`,
  recalculado en `resize`): por debajo del zoom en que el mundo llena la
  vista, `maxBounds` no se puede satisfacer y Leaflet da tirones. Un
  número fijo dejaría pantallas grandes con hueco y pequeñas sin poder
  alejar (medido: 2075 px → zoom 4 hace falta; 275 px → basta el 2).

**Trampa**: `getBoundsZoom` usa `Math.max(this.getMinZoom(), …)`, o sea
el suelo ACTUAL como suelo de su propia respuesta — el suelo solo puede
SUBIR con preguntas sucesivas (agrandar y volver a encoger lo dejaba
clavado en el máximo alcanzado). `fitWorldMinZoom` aparta el suelo antes
de preguntar y lo repone después. Se sigue preguntando a Leaflet (no
calculando el logaritmo a mano) por el redondeo a `zoomSnap`.

Consecuencia: una geometría con longitud fuera de ±180 queda fuera del
área alcanzable (la importación ya ajusta a ±180 con `clampLatLng`, pero
conviene saberlo).

## Teclado y rueda del visor: flechas, Re/Av Pág y rueda continuos

Mantener una tecla cuenta por el tiempo PULSADA (keydown→keyup), no por
los keydown de autorrepetición del sistema (paso, pausa de ~250–600 ms,
saltos: se notaba dibujando una ruta). Todo en `70-view-controls.js`.

- **Toque = lo de siempre**: 80 px (`KEY_PAN_STEP`, el
  `keyboardPanDelta` de Leaflet) o ±1 nivel. Soltada antes, la flecha
  COMPLETA el paso sin pasarse; soltada después, se para en seco.
- **Flechas**: arrancan en el keydown a 400 px/s, aceleran a partir de
  500 ms hasta 1600 px/s en 1 s (`keyPanSpeed`), dos a la vez en
  diagonal y Mayús ×3 (`keyPanVector`). En PANTALLA: girado, ↑ sigue
  siendo arriba.
- **No se usa el `Keyboard` de Leaflet para las flechas**: un paso por
  keydown es justo el problema. Se cogen en CAPTURA en el contenedor y
  no se propagan (Leaflet escucha en `document` y desplazaría dos
  veces); `+`/`-`/Escape siguen siendo suyos. Solo con el foco en el
  visor: en el buscador o el árbol no tocan el mapa.
- **Límite del mundo en cada fotograma** (al final rebotaría), en
  píxeles del mapa sin girar con el giro inverso, y `_limitCenter`
  (consciente del giro). **Trampa**: ida y vuelta por
  `containerPointToLatLng`/`latLngToContainerPoint` con leaflet-rotate
  se desvía ~1 px → pasos de 8 px en vez de 7 y un toque de 98 px.
  `_limitCenter` devuelve el MISMO objeto si no limita: entonces vale el
  desplazamiento pedido tal cual.
- **Trampa del primer fotograma**: la marca de tiempo de rAF es la del
  INICIO del fotograma, anterior al keydown → `dt` negativo → un paso
  hacia atrás (medido: −5 px). Se acota a ≥ 0 (y a 0,1 s tras pausas).
- **Zoom continuo por el camino del pellizco táctil** (`_moveStart` +
  `_move(…, {pinch: true})`, 3 niveles/s): solo transforma por CSS
  teselas y lienzo, sin redibujar por fotograma. Centro desde el estado
  INICIAL (desfase del ancla en píxeles del mapa sin girar, `d`), no del
  fotograma anterior. Final como `TouchZoom._onTouchEnd`
  (`_animateZoom`, o `_resetView` sin animación de zoom), no
  `setZoomAround`, que abriría otro `zoomstart`. **`zoomSnap` sigue en
  1** (decidido): al soltar se anima al nivel ENTERO siguiente en la
  dirección del zoom y al menos ±1 del de partida (`keyZoomTarget`) —
  teselas nítidas en reposo; rueda, doble clic y encuadres sin cambios.
  Zoom y desplazamiento no se mezclan (empezar un zoom corta el
  desplazamiento; flechas ignoradas durante un zoom).
- **`mousemove` sintético** por fotograma en la última posición del
  puntero sobre el visor (`synthetic: true`, olvidada en `mouseout`):
  sin él, coordenadas, vista previa del arco o un vértice arrastrado se
  quedaban en el punto geográfico viejo al mover el mapa sin mover el
  ratón. `coordsPending` (ancla del zoom) se actualiza por ahí.
- Se para todo con `blur` del visor o la pestaña oculta (sin keyup).
- **Rueda: el mismo zoom continuo** (`scrollWheelZoom: false` en el
  mapa; listener `wheel` propio en el contenedor, en burbuja: los
  controles cortan la rueda con `disableScrollPropagation`). Cada evento
  mueve un OBJETIVO fraccionario (`wheelLevels`: 100 px = un nivel, como
  mucho uno por evento) que la vista alcanza con frenada en
  `WHEEL_EASE_MS` por el camino del pellizco; cada evento vuelve a
  anclar en el cursor. Sin rueda `WHEEL_IDLE_MS`, se asienta en el entero
  siguiente en la dirección del último giro (`wheelZoomTarget`, SIN el
  «al menos ±1» de las teclas: subir y bajar lo mismo deja donde
  estaba) y termina como el de teclas. `preventDefault` siempre, también
  con Ctrl (pellizco de panel táctil: si no, el navegador amplía la
  página). Ignorada durante un zoom de teclas o un arrastre. **Trampa**:
  un zoom nuevo durante la animación final del anterior (`_animatingZoom`)
  la da por terminada (`_onZoomTransitionEnd`) antes de empezar; si no,
  su final llegaba después y pisaba el zoom en curso (valía también para
  dos toques rápidos de Re Pág). Medido igual que el de teclas: mediana
  16,7 ms, un fotograma de 33 ms (el redibujo final).
- **El foco se queda en el visor al usarlo con el ratón**, o estas
  teclas (y R, y `+`/`-` de Leaflet) dejan de llegar. Dos fugas, ambas
  comprobadas en Chromium:
  - **Clic en un marcador**: su icono tiene tabindex (`keyboard` de
    Leaflet) y se quedaba el foco; el siguiente guardado del árbol lo
    tiraba al `<body>`, porque `reorderPaintOrder` reengancha los iconos
    (`L.DomUtil.toFront` = `appendChild`) y un elemento enfocado que se
    mueve en el DOM suelta el foco. En el `<body>`, Re/Av Pág y flechas
    son del ÁRBOL (listener en `document`). Arreglo: `preventDefault`
    del `mousedown` sobre `.leaflet-marker-icon` (la acción por defecto
    es lo que enfoca) y foco al contenedor; con Tab siguen siendo
    alcanzables, y `reorderPaintOrder` devuelve el foco si el reenganche
    se lo quitó.
  - **Crear una ruta**: al segundo punto se abre su diálogo de
    propiedades, que se llevaba el foco (`focusDialog`). Lo abre un clic
    en el visor, así que va con `openStyleDialog(li, { focus: false })`.
  Saltar al nodo en el árbol (`highlightNode`) NO mueve el foco: solo
  selecciona y desplaza la lista.
- **Medido** (Chromium headless sin GPU, 2000 polígonos): desplazamiento
  a 60 fps sostenidos (máx. 16,8 ms); zoom con mediana de 16,7 ms y p95
  de 33 ms (el redibujo al soltar).

## Zoom por encima de las teselas

`maxZoom` es 25 en el mapa; cada capa declara su `maxNativeZoom` (19
normalmente, 9 en la física de Esri). Por encima, Leaflet escala la
última tesela en vez de pedir niveles inexistentes: la cartografía se ve
borrosa, pero la cuadrícula de elevaciones (celdas de 5 m) se puede leer.
La escalera de doble clic se corta en `ZOOM_LADDER_TOP` (19).

## Overlays propios sobre el visor, en pantalla y no geográficos

Un efecto que se recalcula él solo en cada `move`/`zoom` (como el lienzo
WebGL y el `<div>` de sol/luna de `61-daynight.js`) **no debe vivir
dentro de un pane de Leaflet**, ni siquiera uno propio creado con
`map.createPane`. Motivo, comprobado a mano arrastrando el mapa:
`.leaflet-map-pane` (contiene teselas, capas vectoriales y marcadores)
recibe una transformación CSS al arrastrar que Leaflet **NO deshace al
soltar** — la deja puesta y compensa por su cuenta con el origen de
píxel interno. Cualquier `<canvas>`/`<div>` metido ahí dentro hereda esa
transformación para siempre después del primer arrastre, aunque su
propio contenido se recalcule bien en cada evento. Un pane propio SÍ
sirve para intercalar el z-index entre teselas (200) y capas vectoriales
(400) — imposible desde fuera, `.leaflet-map-pane` se compara como un
bloque único por SU PROPIO z-index (400) — pero solo vale para contenido
GEOGRÁFICO (que Leaflet ya sabe mover con ese mismo pane).
La solución para un overlay en pantalla: hijo directo de
`map.getContainer()`, hermano de `.leaflet-map-pane` (mismo sitio que
`.leaflet-control-container`, por lo mismo — los controles tampoco
deben arrastrarse), con su propio z-index por encima de 400 si debe
tapar el mapa entero. Para posicionar un punto/línea geográfico sin pane
propio, `map.latLngToContainerPoint` da las coordenadas de pantalla
correctas en cualquier momento, arrastre en curso incluido — es la
misma función que usan los controles.

## Cuadro de coordenadas y atribución

La línea inferior es SOLO para la atribución de Leaflet (crece con cada
mapa base/modo altura activado). El cuadro de coordenadas va siempre por
encima (`margin-bottom`) y **no lleva ancho máximo** (cortaría la línea
de diferencia superficie/terreno, que es larga). La atribución va en una
sola línea con elipsis si no cabe.

- **Atribución**: `v<VERSION> (<BUILD>) | GitHub | Leaflet` vía
  `setPrefix`. `VERSION` = a qué release corresponde; `BUILD` = instante
  exacto de esta generación (ver `build-and-release.md`). URL de
  `REPO_URL`, `target="_blank"` + `rel="noopener"`. Crédito de Leaflet
  obligatorio por licencia.
- **Escala**: la nativa de Leaflet (`L.control.scale`), no propia —
  métrico+imperial, 100 px por defecto (Leaflet no ofrece millas
  náuticas).
- **Escala sobre la atribución sin colocarla a mano**: ambas van en
  `bottomright`; Leaflet inserta cada control nuevo de esquina inferior
  con `insertBefore`, así que **el orden de las dos líneas en
  `10-map.js` ES la posición en pantalla** — invertirlo pone la escala
  debajo.
- **Exportar PNG** (`exportMapPng`) oculta `.leaflet-control-zoom`,
  `.measure-bar` (cubre medición/pin/📷 y vista) y `.base-box` antes de
  `html2canvas`, restaurados en `finally` aunque falle la captura. El
  cuadro de coordenadas, la atribución (licencia CC BY del PNOA/IGN) y
  **la escala** NO se ocultan a propósito.
