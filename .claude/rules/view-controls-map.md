---
description: Vista guardada, uso de almacenamiento/memoria, límites del mundo (una sola Tierra), zoom sobre teselas, cuadro de coordenadas y atribución.
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
necesarias, cada una tapa un agujero distinto:

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

## Zoom por encima de las teselas

`maxZoom` es 25 en el mapa; cada capa declara su `maxNativeZoom` (19
normalmente, 9 en la física de Esri). Por encima, Leaflet escala la
última tesela en vez de pedir niveles inexistentes: la cartografía se ve
borrosa, pero la cuadrícula de elevaciones (celdas de 5 m) se puede leer.
La escalera de doble clic se corta en `ZOOM_LADDER_TOP` (19).

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
