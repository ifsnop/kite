# Pruebas de KITE Local

Los tests **extraen las funciones del propio `kitelocal.html`** y las
ejecutan en Node, de modo que comprueban el código que se entrega, no una
copia que pueda quedarse atrás.

`kitelocal.html` es un archivo **generado** desde `src/` (ver `build.js`).
Por eso `run-all.js` empieza comprobando que corresponde a las fuentes y
falla si no: si no, se probaría una versión vieja y pasarían pruebas que
no dicen nada del código recién escrito. Comprueba, no construye — un
runner que reescribe un archivo del repo ensucia el árbol de trabajo sin
avisar y enmascara justo ese error. Si falla: `npm run build`.

## Ejecutar

```bash
npm install                 # una sola vez (linkedom, @xmldom/xmldom, playwright)
npm run browser             # una sola vez, OPCIONAL: descarga el navegador (~300 MB)
npm run build               # src/ → kitelocal.html + kitelocal.min.html
npm test                    # toda la batería
npm run test:browser        # solo las de navegador
node tests/run-all.js --bench   # además, las mediciones
node tests/navtest.js           # una suite suelta
```

Las pruebas de **navegador** (`tests/browser/`) son opcionales en local
y obligatorias en el CI. `npm install` no descarga ningún navegador: si
no lo hay, esas suites se SALTAN con el comando para habilitarlas y
`npm test` sigue en verde, de modo que la batería funciona en cualquier
entorno. En el CI se instala y `KITE_REQUIRE_BROWSER=1` convierte ese
salto en fallo, para que la cobertura no se pierda en silencio. Si no se
puede descargar Chromium, `KITE_BROWSER=/ruta/al/chrome` usa cualquiera
que ya esté instalado.

Durante el desarrollo, `npm run watch` reconstruye al guardar y basta
con recargar el navegador.

`run-all.js` comprueba primero que `kitelocal.html` está al día
respecto de `src/`, luego hace un `node --check` del script incrustado y
después lanza cada suite. Devuelve un código de salida distinto de cero
si algo falla, así que sirve tal cual en un gancho de git.

## Qué cubre cada suite

Cada suite tiene aquí dos cosas, para que la salida de `npm test` y
este documento se puedan seguir la pista una a la otra:

- **Salida de `npm test`**: literalmente lo que la batería imprime
  para esa suite, en un bloque de código — primero la línea
  `── texto` con la que `run-all.js` la anuncia, y debajo la salida
  propia de la suite (lo que ella misma escribe con `console.log`,
  tal cual sale por la terminal). Quien vea fallar o pasar una suite
  puede buscar aquí ese mismo texto y encontrar la fila que le
  corresponde, sin adivinar. Dos suites (`repairtest.js`,
  `utmtest.js`) imprimen además una cifra medida en el momento (un
  tiempo en milisegundos, un error máximo): el texto de alrededor es
  fijo, la cifra varía de una ejecución a otra.
- **Qué cubre**: una explicación en prosa de qué comprueba la suite
  por dentro —qué funciones ejercita y qué caso concreto, a menudo un
  fallo real ya corregido, protege cada aserción—, con el detalle que
  la sola línea de cabecera no puede dar. Las nueve bajo `browser/`
  necesitan un navegador de verdad (ver «Ejecutar»): son las últimas
  en correr y las que se saltan, sin fallar, cuando no hay ninguno.

**Este documento se actualiza en el MISMO cambio que la suite.** Casi
ningún cambio crea una suite desde cero: lo normal es ampliar una ya
existente con aserciones nuevas, y eso también cambia lo que esa suite
prueba. El apartado «Qué cubre» de abajo se actualiza a la vez —y el
bloque «Salida de `npm test`» también, si la salida por consola
cambia—, no en una pasada aparte ni solo si alguien lo pide
expresamente (ver el punto 6 de los principios en `CLAUDE.md`). Un
apartado que describe una suite más vieja que su código deja de servir
para lo que sirve este documento: que alguien pueda leer aquí qué
prueba una suite sin tener que abrirla.

### `kmltest.js`

**Salida de `npm test`:**
```
── Parseo de KML: espacios de nombres, estilos, geometrías
KML PARSER TESTS OK
NAMESPACE VARIANTS OK
POLYGON STROKE/FILL TESTS OK
```

**Qué cubre:** Parseo de KML con prefijo, con espacio de nombres por defecto y sin ninguno; cadenas de `StyleMap` con ciclos; polígonos con agujeros; color `aabbggrr`.

### `repairtest.js`

**Salida de `npm test`:**
```
── Reparación de prefijos XML sin declarar
(KML sintético de 2.2 MB)
  reparación: 8 ms, prefijos: xsi
REPAIR TESTS OK
```

**Qué cubre:** Reparación de prefijos XML sin declarar (el fallo real de un KML de Google Earth), incluido el coste sobre un archivo grande.

### `htmltagstest.js`

**Salida de `npm test`:**
```
── Detección y limpieza de etiquetas tipo HTML en nombres de un KML
HTML-LIKE TAGS TESTS OK
```

**Qué cubre:** `hasHtmlLikeTags`/`stripHtmlLikeTags` (regla del usuario: un `<...>` cuenta como etiqueta si tiene alguna letra dentro, para no confundir un "<"/">" usado como comparación) contra un caso real (`A27<_bol><fnt scale="80">    </fnt></_bol>`, restos de un exportador); falso positivo aceptado y documentado (`"A < B and C > D"`); `kmlNamesHaveHtmlTags`/`stripHtmlTagsFromKmlNames` sobre un documento KML completo, incluido el nombre de una carpeta, no solo de un placemark.

### `dupetest.js`

**Salida de `npm test`:**
```
── Fusión de marcadores duplicados: mismo nombre y posición, en KML y en GeoJSON
DUPLICATE MARKER TESTS OK
```

**Qué cubre:** Fusión de marcadores duplicados —mismo nombre y misma posición—, en los DOS caminos de importación. KML (`findDuplicatePlacemarks`/`removeDuplicatePlacemarks`) y GeoJSON (`featureDupName`/`findDuplicateFeatures`/`removeDuplicateFeatures`), que antes no se miraba: un archivo entraba con sus duplicados dentro y sin preguntar. En el lado GeoJSON, tres trampas propias: las coordenadas van `[lng, lat]` (dos features con los números cambiados de sitio NO son el mismo punto, que es lo que delataría una lectura al revés), sin nombre en las properties no se agrupa —el «Elemento N» de respaldo lo da el índice y no dice nada— y la propiedad elegida en el selector de nombre es la que se compara. Y que el array se filtre EN EL SITIO: quien llamó ya tiene ese mismo array en la mano.

### `clamptest.js`

**Salida de `npm test`:**
```
── Coordenadas: validación y tolerancia de redondeo
CLAMP TESTS OK
```

**Qué cubre:** Validación de coordenadas y tolerancia de redondeo: se ajusta `180.00000044181039`, se rechaza una latitud de 32400.

### `utmtest.js`

**Salida de `npm test`:**
```
── Conversión a UTM y husos
error máximo ida y vuelta: 47.086 mm
UTM TESTS OK
```

**Qué cubre:** UTM contra valores publicados, invariante del meridiano central, husos de Noruega y Svalbard, e ida y vuelta sobre una malla mundial.

### `coordfmt.js`

**Salida de `npm test`:**
```
── Formato de coordenadas: decimal, GMS con espacios y GMS compacto
COORDINATE FORMAT TESTS OK
```

**Qué cubre:** Formato de coordenadas: grados decimales, GMS con espacios (campos editables) y GMS compacto en negrita (caja de coordenadas del visor), acarreo de segundos/minutos e ida y vuelta con `parseCoord`.

### `elevtest.js`

**Salida de `npm test`:**
```
── Elevaciones: WCS del IGN, coberturas, formatos, rejilla
ELEVATION TESTS OK
```

**Qué cubre:** Cliente WCS del IGN: elección de cobertura (malla de 5 m), de formato (`ArcGrid`), de CRS (3857), ejes por nombre, excepciones OGC y rejilla ASCII.

### `pnoahisttest.js`

**Salida de `npm test`:**
```
── PNOA histórico: descubrimiento de capas del WMS del IGN
PNOA HISTÓRICO TESTS OK
```

**Qué cubre:** `parseWmsCapabilities` sobre un recorte real del GetCapabilities del PNOA histórico del IGN: agrupa las capas seleccionables bajo sus grupos de título («PNOA anual», «PNOA10»), manda a un grupo «Vuelos históricos» las capas sueltas sin grupo propio, y excluye `infoVuelos` (capa de solo consulta, sin imagen) sin confundir el `<Name>` de un `<Style>` con el de la propia capa. `pnoaHistDefault` elige por defecto el año más reciente; `groupPnoaHistEntries` ordena «PNOA anual» por año descendente, deja «Vuelos históricos» en segundo lugar y coloca un grupo no anticipado («PNOA10») al final sin tenerlo hardcodeado. Un documento sin ninguna capa con `<Name>` devuelve `null`. Y `parseWmsServiceException` distingue el `ServiceExceptionReport` propio de WMS 1.3.0 del `ExceptionReport` de OWS que usa el WCS de elevaciones (mismo problema, dos esquemas de error distintos según el servicio), sin disparar nada ante una respuesta normal.

### `copernicustest.js`

**Salida de `npm test`:**
```
── Copernicus DEM: instance ID de Sentinel Hub y sus capas
COPERNICUS / SENTINEL HUB TESTS OK
```

**Qué cubre:** Capa base de Copernicus DEM por Sentinel Hub: `validInstanceId` (UUID, con espacios alrededor, rechazando truncados y dígitos no hexadecimales); lectura de las capas de una configuración de usuario con `COP_WMS_OPTS` (lista plana, un solo grupo, sin exclusiones, sin confundir el `<Name>` de `<Style>`); y el `Invalid instance id` real del servicio, que llega con HTTP 400 y por tanto solo se puede leer del cuerpo.

### `navtest.js`

**Salida de `npm test`:**
```
── Navegación del árbol y selección por rangos
NAV TESTS OK
```

**Qué cubre:** Recorrido del árbol, colapsos anidados, ámbito de Inicio/Fin, rangos con Mayús y flechas laterales. `createFolderNode` ("Nueva carpeta"): sin cursor va a la raíz; sobre una hoja se coloca como hermano justo después; sobre una carpeta ya desplegada entra dentro, al final; sobre una carpeta colapsada la despliega (llamando a `ensureMaterialized`) y entra dentro, al final. `cursorAfterDelete` (borrar con × o Supr): tras borrar una hoja el cursor pasa a la siguiente fila visible; al borrar la última fila cae hacia atrás; al borrar una carpeta entera salta toda su rama en vez de entrar en ella; con varios nodos contiguos salta todos los que desaparecen; al borrar el árbol entero no queda dónde aterrizar (`null`); un ancla que no es una fila tampoco.

### `a11ytreetest.js`

**Salida de `npm test`:**
```
── Accesibilidad del árbol: role=group del <ul> raíz, aria-label de las casillas
A11Y TREE TESTS OK
```

**Qué cubre:** Accesibilidad del árbol (hallazgos de una auditoría con axe-core sobre el navegador real): `ensureRootUl` da `role="group"` al `<ul>` raíz (si no, `#tree` con `role=tree` queda con un hijo sin tipo válido, 3 violaciones en cascada); `setNodeName` mantiene el `aria-label` de la casilla —su único nombre accesible, ya que el `<label>` no lleva `for`— sincronizado al renombrar, incluido un renombrado sin cambios; `setSelCursor` mantiene `aria-activedescendant` de `#tree` apuntando a la fila con el cursor de teclado (único tabindex del árbol) y lo retira al perder el cursor.

### `selcorrect.js`

**Salida de `npm test`:**
```
── Selección: cursor y nodos de nivel superior
SELECTION CORRECTNESS OK
```

**Qué cubre:** Cursor único y `topLevelSelection` (lo contenido viaja con su ancestro). También `announceSelectionCount` (el aviso informativo con el número de nodos seleccionados, disparado por `toggleOne` igual que por `selectRange` o el botón ☑ de una carpeta): sin aviso con un solo nodo, aviso con el recuento al pasar a dos o más, un aviso nuevo por cada cambio de recuento mientras queden varios, ningún aviso al volver a uno solo, el tono siempre `"info"` (nunca un error), y que varios toques rápidos (Mayús+flecha mantenido) se funden en un único aviso con el recuento FINAL en vez de uno por toque — `announceSelectionCount` debate con `setTimeout` (`SEL_COUNT_DEBOUNCE_MS`) y el test controla el temporizador a mano, como `tests/msglog.js`.

### `reporttest.js`

**Salida de `npm test`:**
```
── Informe de importación
REPORT TESTS OK
```

**Qué cubre:** Informe de importación: cargados, omitidos, agrupación de causas y cuándo exige lectura.

### `placemarklayertest.js`

**Salida de `npm test`:**
```
── buildPlacemarkLayer: un placemark sin geometría útil cuenta una sola vez; PolyStyle.outline no oculta una línea sin polígono
PLACEMARK LAYER REPORT TESTS OK
```

**Qué cubre:** `buildPlacemarkLayer` devuelve `{ group, reported }`: un placemark con una única geometría inválida avisa UNA vez (no dos, contando también el genérico de `buildKmlRecords`); uno sin geometría alguna deja `reported` en `false` para que ese genérico sí dispare; el caso con una geometría válida no avisa. También: `<PolyStyle><outline>0</outline></PolyStyle>` (`style.polyOutline`) solo se pliega en `stroke` cuando el placemark tiene de verdad un `<Polygon>` — una línea sola con ese mismo `<Style>` compartido no debe quedar con `stroke:false` (invisible sin ningún error; bug real de un KML de rutas aéreas).

### `newfeat.js`

**Salida de `npm test`:**
```
── Saneado de fichas, Ctrl+A y zonas de arrastre
NEW FEATURES OK
```

**Qué cubre:** Saneado del HTML de las fichas, Ctrl+A en dos pasos y zonas de arrastre.

### `topojsontest.js`

**Salida de `npm test`:**
```
── Conversión de TopoJSON a GeoJSON
TOPOJSON TESTS OK
```

**Qué cubre:** `topologyToGeoJson`: une los objetos con nombre de una topología en un único `FeatureCollection` (la conversión de arcos la prueba topojson-client, no nosotros).

### `groundoverlaytest.js`

**Salida de `npm test`:**
```
── GroundOverlay: LatLonBox y resolución de assets del KMZ
GROUND OVERLAY TESTS OK
```

**Qué cubre:** GroundOverlay: `parseLatLonBox` (límites, rotación, tolerancia de redondeo) y `resolveKmzEntry` (ruta exacta y por nombre de archivo suelto dentro del zip).

### `bytesfmt.js`

**Salida de `npm test`:**
```
── Formato de tamaños: bytes/KB/MB/GB
BYTE FORMAT TESTS OK
```

**Qué cubre:** `fmtBytes`: las cuatro unidades (bytes/KB/MB/GB) y sus límites de tramo.

### `reordertest.js`

**Salida de `npm test`:**
```
── Orden de pintado: bringLayerToFront por tipo, reorderPaintOrder por árbol
REORDER TESTS OK
```

**Qué cubre:** Orden de pintado: `bringLayerToFront` despacha por forma de la capa (`bringToFront`, `eachLayer` recursivo, `getElement`+`L.DomUtil.toFront`); `reorderPaintOrder` recorre el árbol y trae al frente solo las capas activadas, en su orden, reflejando un reordenamiento del DOM sin pasar por Leaflet real.

### `pngnametest.js`

**Salida de `npm test`:**
```
── Nombre de archivo del PNG exportado: marca de tiempo con zero-padding
PNG FILENAME TESTS OK
```

**Qué cubre:** `pngTimestamp`: `YYYYMMDD-HHMMSS` con zero-padding en cada campo (mes, día, hora, minuto, segundo), medianoche como `000000`, y forma correcta al usar la hora actual por defecto.

### `geojsonnametest.js`

**Salida de `npm test`:**
```
── Propiedad-nombre de GeoJSON, tabla de properties y menú contextual con varias capas
GEOJSON NAME PICKER / CTX MENU TESTS OK
```

**Qué cubre:** `geojsonFeatures`/`needsNamePicker`/`propsFingerprint`/`resolveFeatureName` (elegir y recordar la propiedad-nombre de un GeoJSON ambiguo); `stringifyPropValue`/`propertiesTableHtml` (tabla de `properties` del panel de información, con escapado de entrada hostil); `ctxItemsFor` (menú contextual con una, ninguna o varias capas bajo el cursor: ítems directos frente a submenú) y las dos envolturas que usa (`goToNodeAndBlink`, `showLayerInfoAndBlink`), extraídas de verdad y no stubeadas: que cada acción reciba la capa correcta y que las DOS la hagan parpadear, que con varias superpuestas es lo único que dice cuál se eligió.

### `cascadetest.js`

**Salida de `npm test`:**
```
── Cascada de visibilidad por lotes: cesión del hilo, doble toggle rápido, borrado a mitad
CASCADE TESTS OK
```

**Qué cubre:** `cascadeVisibility`/`setAllChecked`: cede el hilo cada `CASCADE_BATCH` casillas en carpetas grandes y no en las pequeñas, un doble toggle rápido sobre la misma carpeta deja el estado de la ÚLTIMA intención y llama a `scheduleSave` una sola vez, una carpeta borrada a mitad de cascada deja de tocar `rootGroup` en vez de resucitar capas, y ambas alcanzan también los registros pendientes (`li._pending`) de una carpeta nunca desplegada, no solo las filas ya materializadas.
También `beginCascadeFeedback`/`endCascadeFeedback` (el feedback inmediato que evita que el usuario, al no ver ningún cambio todavía, vuelva a pulsar la misma casilla): la casilla queda `disabled`+`hidden`, el spinner visible y la fila marcada `.cascading` de forma SÍNCRONA, en el mismo tick que la llamada a `cascadeVisibility` y antes de la primera cesión del hilo; se avisa al visor (`showCascadeStatus`) una sola vez aunque el nodo tenga varias cascadas superpuestas (el doble toggle rápido) y se deja de avisar (`hideCascadeStatus`) solo cuando la ÚLTIMA de ellas termina — verificado con el contador `_cascadeActive`, no con un booleano, que se rompería con la segunda cascada reentrante.

### `lazytree.js`

**Salida de `npm test`:**
```
── Construcción perezosa de filas para carpetas colapsadas (materializeRecords/ensureMaterialized)
LAZY TREE TESTS OK
```

**Qué cubre:** Construcción perezosa de filas para carpetas colapsadas: test diferencial (el mismo árbol construido con todo abierto y con una subcarpeta colapsada serializa exactamente igual); `ensureMaterialized` cede el hilo por lotes, cascada a una subcarpeta ya abierta y difiere una colapsada sin materializarla de más; una llamada reentrante no duplica filas; `subtreeBounds`/`findMatches` (`searchMatches`) + `resolveMatch` alcanzan capas dentro de una carpeta pendiente sin forzar su materialización salvo cuando hace falta llegar hasta una coincidencia; `serializeNode` sobre una carpeta pendiente no construye ninguna fila; `deleteNode` quita del mapa las capas marcadas que una carpeta pendiente escondía; `resolveRecordLi`/`wirePendingLayerEvents` resuelven un clic/hover sobre una capa pendiente a su `<li>` real y retiran el listener de espera al materializar (sin quedarse disparando por duplicado); `visibleElevGridNodes` encuentra una capa de elevaciones marcada dentro de una carpeta pendiente; `blinkLayer` (el parpadeo de identificación de "Ir al nodo en el panel") oculta/muestra la capa dos veces en orden, un parpadeo repetido cancela el anterior en vez de solaparse, y si el checkbox cambia mientras parpadea termina en su estado real en vez de forzarla visible.
También `selectFolderLayers` (el botón ☑ de una carpeta): selecciona de una vez las capas de la rama, incluida la de una subcarpeta colapsada que `materializeSubtree` tiene que materializar primero, y avisa con el recuento (`announceSelectionCount`, tono `"info"`) igual que Mayús+clic o Ctrl+Mayús+clic — con una espera real (no un temporizador simulado, para no pisar los `setTimeout` de verdad que ya usa `blinkLayer` en esta misma suite) de `SEL_COUNT_DEBOUNCE_MS` antes de comprobar el aviso.

### `pointsedit.js`

**Salida de `npm test`:**
```
── Editor de la lista de puntos: formato TSV, anillos, errores
POINTS EDITOR TESTS OK
```

**Qué cubre:** Editor de la lista de puntos de una capa de trazos: `pointsToText` (cabecera, tabuladores, altitud 0 cuando falta, un bloque por anillo separado por línea en blanco) y `textToPoints` (ida y vuelta, cabecera ignorada aunque venga repetida en medio al pegar dos veces, separación por comas/espacios/punto y coma, líneas en blanco de los extremos sin crear anillos vacíos, errores con su número de línea real, y 1000 puntos como tamaño objetivo).

### `msglog.js`

**Salida de `npm test`:**
```
── Avisos: fusión de repetidos con contador y registro de sesión
MESSAGE LOG TESTS OK
```

**Qué cubre:** Avisos del panel: `msgStamp` (relleno con ceros en todos los campos y medianoche exacta, el fallo que ya se dio en `pngTimestamp`); fusión de un aviso repetido en una sola línea con `×N` y una sola entrada de registro; lo que NO se funde (texto distinto, mismo texto con otro tono, o línea ya expirada); que el repetido reinicia el temporizador, cancela el anterior y no cambia de sitio; que un `sticky` no arma temporizador; que el registro sobrevive a que la línea desaparezca; el tope `MSG_LOG_MAX` perdiendo la más antigua; el contador de entradas sin ver (un repetido no cuenta); y `logText` (orden cronológico, marca completa, tono y `×N` con la marca de la última).

### `naming.js`

**Salida de `npm test`:**
```
── Autonumerado de formas dibujadas y mediciones
NAMING TESTS OK
```

**Qué cubre:** `nextNumberedName`: autonumerado de las formas dibujadas y las mediciones deducido de los nombres existentes (no de un contador, que se reiniciaría al recargar porque una forma vuelve por el camino genérico `t:"layer"`). Cubre la secuencia, que manda el máximo y no la cuenta (huecos), que cada familia va por su cuenta, que una línea dibujada no reutiliza el número de una medición, el anclaje exacto del patrón (`Mi Línea 9` no cuenta como 9), los registros pendientes de carpetas nunca desplegadas —incluidos los anidados— y los nodos sin nombre.

### `measure.js`

**Salida de `npm test`:**
```
── Mediciones: estilo propio, medidas del diálogo y renombrado sin perder la medida
MEASURE TESTS OK
```

**Qué cubre:** Mediciones: `defaultMeasureStyle` (una línea nunca se rellena, un círculo sí y con relleno muy translúcido; cada tipo conserva su color y el contorno va siempre opaco); `capArea` —el área de un círculo es la del CASQUETE esférico, no πr²— coincidiendo con πr² a 1 km, quedando por debajo a 1000 km y dando medio globo para un cuarto de vuelta; `measurementValues` (una línea da distancia y rumbo y ninguna área, un círculo radio y área y ningún rumbo); `fmtUnitDist`/`fmtUnitArea` (las mismas funciones para el diálogo y para las etiquetas del visor; el área con el factor AL CUADRADO); `renderMeasureValues` (etiqueta Radio/Distancia, conversión de unidad, rumbo siempre en grados y filas de área/rumbo que se ocultan solas); `updateMeasurement`, que escribe la etiqueta en la unidad elegida —NM por defecto— y con el mismo formato que el diálogo, y `refreshMeasureLabels`, que al cambiar de unidad repinta tanto las filas del árbol como las mediciones de una carpeta nunca desplegada (`li._pending`), que están en el mapa sin fila; y `startRename` sobre una fila cuyo texto no es el nombre a secas —la regresión reportada: dejar el nombre igual, o cancelar con Escape, borraba la distancia de la fila—, más el caso normal de una capa sin medida.

### `icons.js`

**Salida de `npm test`:**
```
── Iconos MDI empotrados: catálogo y tabla sincronizados, sin red en ejecución
EMBEDDED ICONS TESTS OK
```

**Qué cubre:** Iconos MDI empotrados (`MDI_ICON_BODIES`, generado por `npm run icons`): que el catálogo `MDI_ICONS` y la tabla de cuerpos no se hayan desincronizado en NINGUNO de los dos sentidos —olvidar `npm run icons` tras añadir un icono es el fallo humano que queda—, que todos los cuerpos empiecen por una forma SVG y se dibujen con `currentColor`, y `mdiSvg` en sus tres formas (sin color deja `currentColor` para que lo tiña el CSS de `.mdi-pin`; con color lo sustituye, que es lo que necesita un `<img>` suelto; con tamaño lo escribe en el propio SVG, que es de donde sale el `width:auto` de `#icon-preview`). Además, sobre el archivo ENTREGADO: que no quede ninguna mención a `api.iconify.design` ni resto de `svgCache`/`fetchIconSvg`, y que `applyMarkerStyle` ya no sea `async` ni lleve contador de secuencia. Todo sin tocar la red: el CI no puede depender de que Iconify esté en pie, que es justo lo que este cambio elimina.

### `boot.js`

**Salida de `npm test`:**
```
── Arranque: el panel no concluye «no hay capas» antes de leer IndexedDB
BOOT PLACEHOLDER TESTS OK
```

**Qué cubre:** Aviso del hueco del árbol durante el arranque: `showLoadingMessage`/`showEmptyMessage` escriben cada uno su texto, nunca se apilan dos, dejan `rootUl` a null y usan `textContent` (no `innerHTML`). Y, sobre el archivo ENTREGADO —porque es un contrato de ORDEN DE EJECUCIÓN que ninguna función suelta puede comprobar—: que el árbol arranque en «Inicializando…» y NO haya un `showEmptyMessage()` a nivel de módulo (concluir «no hay capas» antes de leer IndexedDB era lo que hacía salir ese aviso a la vez que la barra «Restaurando capas…»), y que 99-boot.js concluya con `if (!rootUl) showEmptyMessage();` DESPUÉS de `dbLoadTree()` — mirando `rootUl` y no `nodes`, para no borrar el árbol de una importación que el usuario haya soltado mientras se leía.

### `attribution.js`

**Salida de `npm test`:**
```
── Línea inferior del visor: versión, enlace al repositorio y escala
ATTRIBUTION / SCALE TESTS OK
```

**Qué cubre:** Línea inferior del visor: `BUILD` con forma AAAAMMDDHHMM, `REPO_URL` a GitHub, y el prefijo de la atribución mostrando versión + enlace al repositorio (por la constante, sin repetir la URL) + el crédito de Leaflet que su licencia pide, con `target="_blank"` y `rel="noopener"` — abrir en la misma pestaña abandonaría la sesión de trabajo. La escala es `L.control.scale` (la de Leaflet, no una propia) en `bottomright`, con sus valores por defecto, y AÑADIDA DESPUÉS de la atribución: ese orden ES su posición en pantalla, porque Leaflet inserta cada control nuevo de una esquina inferior delante de los que ya hubiera. Y que la escala NO esté en `HIDE_FOR_PNG`: una imagen de un mapa sin escala no se puede medir.

### `minified.js`

**Salida de `npm test`:**
```
── kitelocal.min.html: el minificado que sirve Pages no viene roto del proceso
MINIFIED BUILD TESTS OK
```

**Qué cubre:** `kitelocal.min.html`, la derivada que sirve GitHub Pages y el único artefacto que ninguna otra suite mira (las que extraen del archivo entregado lo hacen por marcadores de comentario, que el minificado no tiene). No prueba comportamiento —es el mismo código— sino que la TRANSFORMACIÓN no se ha llevado nada por delante: que se haya minificado de verdad (más pequeño, sin comentarios de bloque), que su `<script>` parsee (`node --check`), que lleve el mismo `BUILD` que el legible (comparando el VALOR, porque terser puede alinear la constante — es lo que caza un minificado sin regenerar), que sobrevivan los `integrity`/`crossorigin`, la CSP con sus orígenes, el guardián de Leaflet antes del primer `L.map(`, los nombres de nivel superior (fija que dependemos de `mangle.toplevel: false`) y un cuerpo de icono MDI empotrado; y que `index.html` redirija al minificado. Verificado que falla de verdad con una versión desfasada, un `integrity` de menos y un script inválido.

### `statics.js`

**Salida de `npm test`:**
```
── Comprobaciones estáticas: todo id referido existe y toda función llamada está declarada
STATIC CHECKS OK
```

**Qué cubre:** Las dos comprobaciones estáticas que antes se hacían a mano (y por eso casi nunca): que todo `$id`/`getElementById` apunte a un `id` que exista en el HTML, y que TODA FUNCIÓN LLAMADA ESTÉ DECLARADA — un refactor puede borrar un ayudante que sigue en uso y `node --check` no lo ve, porque el archivo sigue siendo válido. La segunda exige mirar código y no texto: los comentarios en castellano llenos de paréntesis daban 369 falsos positivos, así que la suite lleva su propio `maskCode` (borra comentarios, cadenas, plantillas y regex conservando posiciones, y recorre los `${…}`, que SÍ contienen código). Cuenta como declarado todo lo que liga un nombre: declaraciones, claves de objeto, métodos abreviados, getters y parámetros; los globales del navegador van en una lista explícita. Verificado que falla con un `id` mal escrito y con un ayudante borrado.

### `tristate.js`

**Salida de `npm test`:**
```
── Tercer estado de la casilla: indeterminada cuando la carpeta está a medias
TRI-STATE CHECKBOX TESTS OK
```

**Qué cubre:** Tercer estado de la casilla de un contenedor (`indeterminate` nativo, dibujado como guion): `containerState` sobre los HIJOS DIRECTOS (todos/ninguno/mezcla, contenedor vacío y hoja devuelven null, una fila de mensaje no cuenta), el invariante que permite no bajar más de un nivel —un hijo mixto hace mixto al abuelo—, `aria-checked="mixed"`, que `applyContainerState` diga si cambió algo (es lo que corta la subida), `refreshAncestorChecks` propagando y deshaciendo la mezcla por toda la rama, los registros `_pending` de una carpeta colapsada (solos y conviviendo con filas, que es el estado real tras soltar un archivo dentro), la caché `rec._state` y el borrado recalculando desde el `<ul>` guardado antes de quitar la fila. Más un contrato de orden sobre el archivo entregado: `materializeRecords` recalcula la casilla de la carpeta que se queda pendiente.

### `urlimport.js`

**Salida de `npm test`:**
```
── Reconocer lo descargado de una URL: nombre, tipo por contenido y extensión sintetizada
URL IMPORT TESTS OK
```

**Qué cubre:** Las funciones puras que reconocen lo descargado de una dirección: `fileNameFromUrl` (consulta y fragmento fuera, `%20` decodificado, la raíz cae en el host, saneado de lo que no puede ir en un nombre), `isZipSignature`, `sniffTextKind` (KML con y sin prefijo de namespace y con BOM, HTML —el diagnóstico de quien pega la página en vez del «Raw»—, GPX y JSON truncado que no cuelan, y los tres tipos JSON por su FORMA) y `downloadFileName`, con el invariante de que la extensión resultante siempre cae en una rama viva de `handleDroppedFiles`: sin él, lo descargado se rechazaría a sí mismo. Y que `URL_KIND_EXT` y `URL_KIND_LABEL` cubran los mismos tipos.

### `multiedit.js`

**Salida de `npm test`:**
```
── Edición en bloque: qué se aplica a todos cuando los nodos no coinciden
MULTI-EDIT TESTS OK
```

**Qué cubre:** Edición en bloque: las tres funciones puras que deciden qué se aplica a todos. `mixedProps` (en qué NO coinciden los nodos: por valor, y `false` frente a `undefined` cuentan como distintos), `draftProps` (una propiedad mezclada y no tocada no se aplica; una tocada sí, aunque valga `false` — el filtro es la presencia de la clave, no si el valor parece vacío) y `joinNames` (los nombres que quepan y el resto contado, con un nombre larguísimo recortado: los de un KML llegan a cientos de caracteres).

### `usage.js`

**Salida de `npm test`:**
```
── Pie del panel: la línea de memoria se esconde si no hay cifra que dar
USAGE INDICATORS TESTS OK
```

**Qué cubre:** La línea de memoria del pie del panel: `memoryUsageText` da cifra servida por http(s) y devuelve null en los dos casos en que no la hay —`file://`, donde Chromium deja `performance.memory` congelada, y un navegador sin esa API, que no está en ninguna norma—, más un `usedJSHeapSize` no finito. `refreshMemoryUsage` ESCONDE la línea cuando no hay cifra en vez de escribir «no disponible» (sería ruido permanente en dos casos raros) y la devuelve al haberla. Y que el arranque no arme el temporizador si no hay nada que refrescar.

### `clipboard.js`

**Salida de `npm test`:**
```
── Portapapeles del sistema: copiar y pegar entre instancias de distinto dominio
SYSTEM CLIPBOARD TESTS OK
```

**Qué cubre:** Copiar y pegar entre instancias de KITE de dominios distintos, por el portapapeles del sistema: que el envoltorio sea el MISMO que el de exportar (`treeExportDoc`, con sus tres versiones) y que `exportNode` lo comparta en vez de duplicarlo; `parseTreeExport` reconociendo lo nuestro y descartando texto suelto, JSON ajeno y un GeoJSON; que lo pegado de fuera nunca MUEVA (cortar en otra pestaña no puede borrar aquí); el orden que evita pegar dos veces —Ctrl+V deja un respaldo con `setTimeout(0)` y NO llama a `preventDefault`, que cancelaría el evento `paste`, y el evento cancela ese respaldo solo si trae algo nuestro—; las dos comprobaciones de versión; y el tope de tamaño, con el fallo de escritura capturado para que no tumbe el portapapeles interno.

### `hittest.js`

**Salida de `npm test`:**
```
── Acierto bajo el cursor: geometría real, no caja envolvente
HIT TEST OK
```

**Qué cubre:** Acierto bajo el cursor del menú contextual, en píxeles de contenedor: `segDistSq` (perpendicular, más allá de los extremos, segmento degenerado), `nearPolyline` (el falso positivo reportado —un punto dentro de la caja envolvente de una diagonal y a 56 px de ella no acierta—, tolerancia inclusiva a tol y no a tol+1, y el LADO DE CIERRE del anillo, que `getLatLngs()` no repite y sin el cual el último lado no se probaba), `pointInRing` (ray-casting: escotadura de un polígono en L, alturas de vértice) y `pointInRings` (agujeros: el centro de uno queda fuera, su borde acierta por cercanía; por fuera del contorno acierta dentro de la tolerancia).

### `openshape.js`

**Salida de `npm test`:**
```
── Formas abiertas: una línea no tiene área ni relleno
OPEN SHAPE TESTS OK
```

**Qué cubre:** Formas abiertas: `isOpenOnly` (una polilínea sí, un polígono no —incluido el orden de comprobación, que importa porque `L.Polygon` extiende `L.Polyline`—, un grupo con línea Y polígono tampoco, y el polígono se encuentra anidado) y `clearFillOnOpenPaths` (quita el relleno a la línea, respeta el del polígono del mismo grupo —el caso del placemark KML que comparte objeto de estilo—, no toca el resto del estilo, y llega a una capa suelta y a través de grupos anidados).

### `polyarea.js`

**Salida de `npm test`:**
```
── Perímetro y área de polígonos: anillos cerrados/sin cerrar, agujeros, multipolígono
POLYGON AREA/PERIMETER TESTS OK
```

**Qué cubre:** Perímetro y área de polígonos (diálogo de propiedades): `ringArea` (fórmula del exceso esférico) contra la aproximación plana de un cuadrado pequeño, invariante al sentido de recorrido, cero con menos de 3 puntos; `ringClosed` (primer y último punto iguales, con tolerancia `COORD_EPS`) distingue un anillo ABC sin repetir el punto de cierre (el caso de algunos JSON) de uno que sí lo repite; `ringPerimeter` con un anillo abierto suma solo los tramos consecutivos (sin el de cierre), con uno cerrado sí lo incluye; `polygonParts` separa exterior/agujeros tanto en un polígono simple como en un multipolígono anidado; área con agujero, calculada a mano y vía `polygonParts`, menor que sin él y próxima a la resta exterior−agujero.

### `toolstest.js`

**Salida de `npm test`:**
```
── showLayerInfo/setTool: el panel de información no se cuela ni queda pegado al salir de una herramienta de dibujo
TOOLS TESTS OK
```

**Qué cubre:** `showLayerInfo`/`setTool`: el panel de información abre por hover salvo con el diálogo de estilos abierto o dibujando un polígono (guardas preexistentes); al salir de polígono —y también de línea o círculo, mismo bug— se suprime exactamente el siguiente hover residual (no más, no queda pegajoso); la guarda expira sola si no llega ningún hover; el cierre diferido por `mouseout` se cancela si el siguiente hover cae en otra capa (pasar de una a otra no debe cerrar ni parpadear); no hace nada si ya está cerrado; un panel abierto explícitamente (con foco de teclado dentro) no se autocierra.

### `browser/app.mjs`

**Salida de `npm test`:**
```
── Navegador: la aplicación arranca y funciona, en los DOS artefactos
BROWSER APP TESTS OK
```

**Qué cubre:** Que la aplicación ARRANQUE y funcione, pasando las mismas comprobaciones sobre `kitelocal.html` Y `kitelocal.min.html` — o sea, ES la comprobación de paridad legible/minificado que antes era manual y obligatoria: si terser rompiera algo, el legible pasaría y el minificado no. Cubre el aviso con que concluye el arranque, las dos barras de la escala y que quede por encima de la atribución, la versión y el enlace al repositorio, aplicar un icono MDI empotrado a un marcador, que los 80 iconos del selector se PINTEN (no solo que estén en una tabla), la etiqueta y el diálogo de una medición en la misma unidad —incluida la fila de área, sin sentido en una línea, REALMENTE oculta (`display` computado, no solo la propiedad `hidden`)—, el tercer estado de una carpeta con su `aria-checked="mixed"`, y cero violaciones de CSP y cero errores de página.

### `browser/clipboard.mjs`

**Salida de `npm test`:**
```
── Navegador: copiar y pegar entre instancias de distinto origen, con el portapapeles real
BROWSER CLIPBOARD TESTS OK
```

**Qué cubre:** El viaje que ninguna suite de Node puede dar: copiar con Ctrl+C DE VERDAD en un origen y pegar con Ctrl+V DE VERDAD en otro (dos puertos son dos orígenes), por el portapapeles real del sistema. Comprueba que Ctrl+C deja el envoltorio de KITE en el portapapeles, que el segundo origen recibe la carpeta con sus tres puntos y sus tres capas en el mapa, y que pegar FUERA del árbol —en el editor de puntos— no importa nada y deja el JSON en el cuadro de texto, como se acordó. Y la regresión grave del corte: con teclado REAL, que Ctrl+X + Ctrl+V MUEVA —raíz con solo el destino, sin filas marcadas, 4 capas y no 8— porque al escribir en el portapapeles del sistema Ctrl+V leía de vuelta nuestro propio envoltorio y lo trataba como ajeno, que nunca mueve; más la otra mitad, que copiar siga copiando.

### `browser/geojson-html.mjs`

**Salida de `npm test`:**
```
── Navegador: etiquetas tipo HTML en properties de GeoJSON, de punta a punta
BROWSER GEOJSON HTML TESTS OK
```

**Qué cubre:** El fallo reportado, de punta a punta: se suelta un GeoJSON con `<b>` en una property —escrito con los `<` ESCAPADOS como en los archivos reales, que es indistinguible tras `JSON.parse`—, se responde al diálogo y se mira lo que se ve. Comprueba que el diálogo habla de «propiedades» y no de «nombres», que la vista previa del selector de propiedad-nombre YA refleja la respuesta (porque la limpieza ocurre antes de leer `firstProps`), y las dos mitades: con «Eliminarlas» el nombre del árbol y la tabla salen limpios y el resumen dice cuántas propiedades se tocaron; con «Dejarlas» todo queda tal cual. En ambos casos nada se renderiza en negrita, un `<` de comparación no se toca y un número no se estropea.

### `browser/dialogs.mjs`

**Salida de `npm test`:**
```
── Navegador: las ventanas fijan cabecera y pie, y se redimensionan
BROWSER DIALOG LAYOUT TESTS OK
```

**Qué cubre:** Disposición de las ventanas en un viewport corto (1280×620, donde el fallo se reproduce): que `.dlg-actions` quede entera dentro de la caja CON EL SCROLL ARRIBA Y CON EL SCROLL ABAJO —si solo se viera arriba, el fallo seguiría a medias—, que el `<h2>` siga visible (es el asa de arrastre), y que las ventanas con contenido que revelar tengan `resize: both` y las de confirmación no. Además, que el selector de iconos y la chuleta SIGAN desbordando: el arreglo consiste en fijar los bordes, no en hacerlas caber a la fuerza. Y que encoger a mano la ventana de propiedades a 200 px no descuelgue sus botones. Además, el separador móvil de las dos columnas de la ficha de properties, con un arrastre REAL del ratón: `table-layout: fixed` (con el automático el ancho pedido se ignora), que arrastrar ensanche la clave y estreche el valor, que al extremo ninguna columna desaparezca, que el reparto se recuerde al cambiar de capa, y que una tabla venida de una `<description>` de KML NO lleve tirador. Y que el reparto se guarde en IndexedDB y se restaure al recargar EN EL MISMO contexto. Verificado que falla con el pie despegado.
El popover de color, de punta a punta: que no se solape con los botones del diálogo de estilos (ni siquiera con las filas de la notación y de Cancelar/Aceptar añadidas, que lo hicieron más alto), que se abra y se cierre desde el panel de mapas base con un clic real, y que repetir el mismo botón grande cierre cancelando. Sobre todo, la edición DIFERIDA del propio popover: arrastrar por el espectro o teclear un hexadecimal y pulsar Intro solo PREVISUALIZA en vivo sobre el botón (y, para un marcador, su icono) sin tocar el borrador del diálogo de estilos ni cerrar nada — eso solo lo hace su propio «Aceptar», y «Cancelar» restaura el color que había al abrir. El mismo contrato se comprueba en el color de fondo del mapa, que además persiste en IndexedDB SOLO al aceptar (nunca durante la previsualización, y nunca si se cancela). Y las flechas ‹ › que ciclan la notación (Hex/RGB/CMYK/HSV) sin cambiar el color: cuántos campos se ven en cada una (1/3/3/4), escribir el mismo rojo puro campo a campo en RGB y leerlo de vuelta en los cuatro campos de CMYK. Y el cursor de cada zona del espectro: cruz sobre el cuadrado de saturación/valor, mano sobre la rampa de matiz.

### `browser/tree-move.mjs`

**Salida de `npm test`:**
```
── Navegador: mover un nodo de rama recalcula la casilla de los dos extremos
BROWSER TREE MOVE TESTS OK
```

**Qué cubre:** Mover un nodo a otra rama recalcula la casilla de TRES ESTADOS de los dos extremos: la carpeta que lo pierde queda apagada y la que lo recibe, indeterminada. El arrastre se hace con eventos de arrastre REALES (`dragstart`/`dragover`/`drop` con su DataTransfer), no moviendo el `<li>` a mano: una primera versión hacía eso y seguía en rojo con el arreglo puesto, porque probaba una reconstrucción del manejador en vez del manejador real. Cubre las dos zonas de soltado (dentro de la carpeta y entre hermanos), varias carpetas de golpe —los contenedores de origen se capturan antes de mover—, y que vaciar una carpeta a medias le quite el guion, que dice «unas activas y otras no» de una carpeta sin hijos. Incluye los dos caminos de PEGAR, que ya recalculaban (`materializeRecords` el destino, `deleteNode` el origen). Y el arrastre entero con el RATÓN de verdad: se comprueba que un clic con tres píxeles de temblor NO arrastre nada, que no quede ningún `draggable` en el árbol y que Escape cancele a mitad.

### `browser/multiedit.mjs`

**Salida de `npm test`:**
```
── Navegador: editar varios nodos a la vez y el nombre siempre a la vista de un trazo
BROWSER MULTI-EDIT TESTS OK
```

**Qué cubre:** El diálogo de estilos con VARIOS nodos seleccionados: que lo que no coincide salga marcado —la fila con «(varios)», el número en blanco, la casilla con el guion del árbol—, que tocar un control lo desmarque, y sobre todo que aceptar aplique SOLO lo tocado: el grosor que nadie movió sigue siendo el de cada uno, y cada marcador conserva su icono y su tamaño. El nombre: vacío con el resumen de nombres de marcador de posición, aceptar sin escribir no renombra, escribir renombra todos. Y el nombre siempre a la vista de un trazo, de punta a punta: etiqueta permanente al encenderlo, globo de click al apagarlo, cada trazo con SU nombre, repintada al renombrar y recuperada al restaurar el árbol. Y que el editor de puntos no trabaje en bloque: con varios seleccionados no abre ni pulsándolo a propósito, y la fila se ve deshabilitada —opacidad medida— diciendo por qué.

### `browser/lazy-cascade.mjs`

**Salida de `npm test`:**
```
── Navegador: desplegar y marcar una carpeta grande a la vez no la deja a medio encender
BROWSER LAZY CASCADE TESTS OK
```

**Qué cubre:** Desplegar y marcar una carpeta grande casi a la vez, en los dos órdenes y también apagando. Las dos pasadas van por lotes (`materializeRecords` construye filas, `cascadeVisibility` enciende) y cada una miraba su propia foto del árbol, así que se repartían los nodos sin saberlo: medido con un archivo real, 150 encendidas de 466 y la carpeta en indeterminado. La suite usa 400 capas —más que el lote de 150, o no hay carrera que provocar— y comprueba además que ninguna fila diga una cosa y el mapa otra, y que la repetición de la cascada no gire en vacío.
Y el icono de un marcador dentro de una carpeta NUNCA desplegada: `buildRecordsFromStorage` debe dejarlo puesto en la capa cruda desde el momento en que la construye (comprobado con `mstyle.icon: "star"` antes de crear ninguna fila), y ese icono debe sobrevivir a activarlo por la cascada del checkbox de la carpeta sin que la carpeta llegue a desplegarse — el bug que esto prueba: un marcador con icono MDI, desactivado y en una carpeta colapsada, volvía a la gota de Leaflet por defecto al activarlo tras recargar.
Y el feedback inmediato de esa misma cascada, de punta a punta en el navegador real: al pulsar la casilla, EN EL ACTO (sin ningún `await` de por medio) la casilla queda oculta y deshabilitada, su spinner visible, la fila con la clase `.cascading` (el nombre parpadea), `aria-busy="true"` y el aviso «Actualizando capas…» visible sobre el visor; al terminar la cascada, los cinco se restauran. Es la comprobación en navegador de `beginCascadeFeedback`/`endCascadeFeedback`, que `tests/cascadetest.js` ya prueba por dentro con stubs.

### `browser/url-import.mjs`

**Salida de `npm test`:**
```
── Navegador: añadir desde una dirección, en dos pasos y con cancelación
BROWSER URL IMPORT TESTS OK
```

**Qué cubre:** Añadir contenido desde una dirección, de punta a punta: que el paso 1 diga qué ha llegado SIN tocar el árbol y que solo «Añadir al árbol» lo toque, colgando todo de una sección «Descargas» que se REUTILIZA —como «Lugares» o «Elevaciones»— con una «Descarga N» numerada por descarga dentro; que con el resultado en la mano «Descargar» quede deshabilitado y que tocar la dirección lo reactive invalidando el resultado; una URL sin extensión reconocida por su contenido; KMZ por la firma del zip; página HTML con la pista del enlace «Raw»; 404; tope de tamaño por `content-length`; y CANCELAR UNA DESCARGA EN VUELO con el botón, que durante la descarga pasa a «Cancelar descarga» —sin esperar al tope de 20 s—, dejando el diálogo abierto y la dirección puesta para reintentar. La suite sirve los ejemplos desde el MISMO origen que la aplicación, porque con `connect-src 'self' https:` otro puerto lo bloquearía la política y no el servidor.

### `browser/oneworld.mjs`

**Salida de `npm test`:**
```
── Navegador: una sola Tierra — sin copias en horizontal, con tope de arrastre y suelo de zoom
BROWSER ONE WORLD TESTS OK
```

**Qué cubre:** Una sola Tierra: que la capa base se cree con `noWrap` y no pida teselas fuera del mundo, que `maxBounds` acote a la franja Mercator (±85,051…, no ±90) con viscosidad 1 y que pedir un centro tres mundos más allá quede dentro, y que el suelo de zoom siga al tamaño de la ventana en LOS DOS SENTIDOS —el mundo llena la vista en ese zoom y no en el anterior—. Lo último es el fallo que tuvo `fitWorldMinZoom`: `getBoundsZoom` acaba en `Math.max(getMinZoom(), …)`, así que el suelo solo subía y tras encoger la ventana ya no se podía alejar; por eso se mide encogiendo DESPUÉS de agrandar.

`selbench.js` no se cuenta entre esas 51: es una medición, no una
batería de aserciones, y solo se ejecuta con `node tests/run-all.js
--bench` (ver «Ejecutar»). Mismo criterio con su texto: «Coste de seleccionar y de topLevelSelection».

## Dependencias

- **linkedom** para DOM de HTML.
- **@xmldom/xmldom** para XML: linkedom no implementa espacios de nombres
  ni `getElementsByTagName("*")`, y las pruebas del parser darían falsos
  negativos.

## El extractor común (`_extract.js`)

Toda suite saca lo que prueba del `<script>` de `kitelocal.html` por el
**mismo** módulo. **Una suite nueva no escribe su propio extractor**:

```js
const { script, fn, constDecl, between } = require("./_extract");
```

- `fn("nombre")` — la declaración completa de una función.
- `constDecl("NOMBRE")` — una `const NOMBRE … ;` de una sola sentencia.
- `between("desde", "hasta")` — un tramo del script entre dos marcadores
  literales, `desde` incluido y `hasta` excluido.
- `script` — el texto entero, para lo que no encaje en lo anterior.

Antes cada suite se traía su copia de la extracción, y el coste no era la
duplicación: **cada copia aprendía las trampas por su cuenta, y tarde**.
Tres funciones llegaron truncadas en silencio a la suite que las probaba
—`collectWmsLayers`, `deleteNode`/`showLayerInfo` y `navMessage`—, cada
una por algo que otra suite ya sabía. Las trampas, con su porqué, están
documentadas en la cabecera de `_extract.js`; en resumen:

1. `async` va **antes** de `function`, así que buscar `function NOMBRE(`
   se lo salta y deja un `await` huérfano.
2. Una **desestructuración en la firma** (`deleteNode(li, {
   pruneSelection = true } = {})`) mete pares `{}` en la lista de
   parámetros: contar llaves desde la primera `{` cierra ahí y devuelve
   la función cortada antes de su cuerpo. Se salta la lista de
   parámetros por profundidad de paréntesis y solo después se cuentan
   llaves.
3. Un marcador que ya no existe: `indexOf` devuelve `-1` y `slice` lo lee
   como «uno desde el final», así que renombrar un comentario del código
   dejaba a la suite con un fragmento verosímil en lugar de un error.
   `between` y `constDecl` **lanzan**.

Y la red para la trampa que aún no ha aparecido: **todo lo extraído se
comprueba que parsea** antes de devolverlo. Es lo que convierte la
próxima en un error nombrado ahí y no en un fallo raro en la suite.

`run-all.js` no usa el módulo a propósito: también lee el script, pero
**después** de sus propias guardas (que exista el archivo, y que
corresponda a `src/`), y requerirlo en la cabecera cambiaría esos avisos
por un `ENOENT` en crudo.

## Convenciones

- Los mensajes de las aserciones describen **qué comportamiento** se
  espera, no en qué línea está; al fallar, el mensaje debe bastar para
  entender qué se ha roto.
- Cuando una prueba nace de un fallo real, el comentario lo dice: sirve
  para que nadie la "simplifique" sin saber qué protegía.
- Los tests extraen funciones sueltas por nombre (`fn`), no rangos
  amplios de texto: extraer rangos arrastraba código con efectos
  secundarios. Ver «El extractor común».
