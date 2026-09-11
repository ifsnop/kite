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
npm install                 # una sola vez (linkedom, @xmldom/xmldom)
npm run build               # src/ → kitelocal.html
npm test                    # toda la batería
node tests/run-all.js --bench   # además, las mediciones
node tests/navtest.js           # una suite suelta
```

Durante el desarrollo, `npm run watch` reconstruye al guardar y basta
con recargar el navegador.

`run-all.js` comprueba primero que `kitelocal.html` está al día
respecto de `src/`, luego hace un `node --check` del script incrustado y
después lanza cada suite. Devuelve un código de salida distinto de cero
si algo falla, así que sirve tal cual en un gancho de git.

## Qué cubre cada suite

| Fichero | Cubre |
|---|---|
| `kmltest.js` | Parseo de KML con prefijo, con espacio de nombres por defecto y sin ninguno; cadenas de `StyleMap` con ciclos; polígonos con agujeros; color `aabbggrr`. |
| `repairtest.js` | Reparación de prefijos XML sin declarar (el fallo real de un KML de Google Earth), incluido el coste sobre un archivo grande. |
| `htmltagstest.js` | `hasHtmlLikeTags`/`stripHtmlLikeTags` (regla del usuario: un `<...>` cuenta como etiqueta si tiene alguna letra dentro, para no confundir un "<"/">" usado como comparación) contra un caso real (`A27<_bol><fnt scale="80">    </fnt></_bol>`, restos de un exportador); falso positivo aceptado y documentado (`"A < B and C > D"`); `kmlNamesHaveHtmlTags`/`stripHtmlTagsFromKmlNames` sobre un documento KML completo, incluido el nombre de una carpeta, no solo de un placemark. |
| `kmldupetest.js` | `findDuplicatePlacemarks`: mismo nombre y misma posición (dentro de ~1,1 m, ruido de coma flotante incluido) agrupa; distinta posición o distinto nombre no; un polígono/línea sin `<Point>` nunca se agrupa aunque comparta nombre; varios grupos independientes se distinguen entre sí y de un placemark suelto. `removeDuplicatePlacemarks` conserva el PRIMERO de cada grupo (orden del documento) y retira el resto del DOM. |
| `clamptest.js` | Validación de coordenadas y tolerancia de redondeo: se ajusta `180.00000044181039`, se rechaza una latitud de 32400. |
| `utmtest.js` | UTM contra valores publicados, invariante del meridiano central, husos de Noruega y Svalbard, e ida y vuelta sobre una malla mundial. |
| `coordfmt.js` | Formato de coordenadas: grados decimales, GMS con espacios (campos editables) y GMS compacto en negrita (caja de coordenadas del visor), acarreo de segundos/minutos e ida y vuelta con `parseCoord`. |
| `elevtest.js` | Cliente WCS del IGN: elección de cobertura (malla de 5 m), de formato (`ArcGrid`), de CRS (3857), ejes por nombre, excepciones OGC y rejilla ASCII. |
| `copernicustest.js` | Capa base de Copernicus DEM por Sentinel Hub: `validInstanceId` (UUID, con espacios alrededor, rechazando truncados y dígitos no hexadecimales); lectura de las capas de una configuración de usuario con `COP_WMS_OPTS` (lista plana, un solo grupo, sin exclusiones, sin confundir el `<Name>` de `<Style>`); y el `Invalid instance id` real del servicio, que llega con HTTP 400 y por tanto solo se puede leer del cuerpo. |
| `navtest.js` | Recorrido del árbol, colapsos anidados, ámbito de Inicio/Fin, rangos con Mayús y flechas laterales. `createFolderNode` ("Nueva carpeta"): sin cursor va a la raíz; sobre una hoja se coloca como hermano justo después; sobre una carpeta ya desplegada entra dentro, al final; sobre una carpeta colapsada la despliega (llamando a `ensureMaterialized`) y entra dentro, al final. `cursorAfterDelete` (borrar con × o Supr): tras borrar una hoja el cursor pasa a la siguiente fila visible; al borrar la última fila cae hacia atrás; al borrar una carpeta entera salta toda su rama en vez de entrar en ella; con varios nodos contiguos salta todos los que desaparecen; al borrar el árbol entero no queda dónde aterrizar (`null`); un ancla que no es una fila tampoco. |
| `a11ytreetest.js` | Accesibilidad del árbol (hallazgos de una auditoría con axe-core sobre el navegador real): `ensureRootUl` da `role="group"` al `<ul>` raíz (si no, `#tree` con `role=tree` queda con un hijo sin tipo válido, 3 violaciones en cascada); `setNodeName` mantiene el `aria-label` de la casilla —su único nombre accesible, ya que el `<label>` no lleva `for`— sincronizado al renombrar, incluido un renombrado sin cambios; `setSelCursor` mantiene `aria-activedescendant` de `#tree` apuntando a la fila con el cursor de teclado (único tabindex del árbol) y lo retira al perder el cursor. |
| `selcorrect.js` | Cursor único y `topLevelSelection` (lo contenido viaja con su ancestro). |
| `reporttest.js` | Informe de importación: cargados, omitidos, agrupación de causas y cuándo exige lectura. |
| `placemarklayertest.js` | `buildPlacemarkLayer` devuelve `{ group, reported }`: un placemark con una única geometría inválida avisa UNA vez (no dos, contando también el genérico de `buildKmlRecords`); uno sin geometría alguna deja `reported` en `false` para que ese genérico sí dispare; el caso con una geometría válida no avisa. También: `<PolyStyle><outline>0</outline></PolyStyle>` (`style.polyOutline`) solo se pliega en `stroke` cuando el placemark tiene de verdad un `<Polygon>` — una línea sola con ese mismo `<Style>` compartido no debe quedar con `stroke:false` (invisible sin ningún error; bug real de un KML de rutas aéreas). |
| `newfeat.js` | Saneado del HTML de las fichas, Ctrl+A en dos pasos y zonas de arrastre. |
| `topojsontest.js` | `topologyToGeoJson`: une los objetos con nombre de una topología en un único `FeatureCollection` (la conversión de arcos la prueba topojson-client, no nosotros). |
| `groundoverlaytest.js` | GroundOverlay: `parseLatLonBox` (límites, rotación, tolerancia de redondeo) y `resolveKmzEntry` (ruta exacta y por nombre de archivo suelto dentro del zip). |
| `bytesfmt.js` | `fmtBytes`: las cuatro unidades (bytes/KB/MB/GB) y sus límites de tramo. |
| `reordertest.js` | Orden de pintado: `bringLayerToFront` despacha por forma de la capa (`bringToFront`, `eachLayer` recursivo, `getElement`+`L.DomUtil.toFront`); `reorderPaintOrder` recorre el árbol y trae al frente solo las capas activadas, en su orden, reflejando un reordenamiento del DOM sin pasar por Leaflet real. |
| `pngnametest.js` | `pngTimestamp`: `YYYYMMDD-HHMMSS` con zero-padding en cada campo (mes, día, hora, minuto, segundo), medianoche como `000000`, y forma correcta al usar la hora actual por defecto. |
| `selbench.js` | Medición (no aserciones): coste de seleccionar miles de capas y de `topLevelSelection`. |
| `geojsonnametest.js` | `geojsonFeatures`/`needsNamePicker`/`propsFingerprint`/`resolveFeatureName` (elegir y recordar la propiedad-nombre de un GeoJSON ambiguo); `stringifyPropValue`/`propertiesTableHtml` (tabla de `properties` del panel de información, con escapado de entrada hostil); `ctxItemsFor` (menú contextual con una, ninguna o varias capas bajo el cursor: ítems directos frente a submenú). |
| `cascadetest.js` | `cascadeVisibility`/`setAllChecked`: cede el hilo cada `CASCADE_BATCH` casillas en carpetas grandes y no en las pequeñas, un doble toggle rápido sobre la misma carpeta deja el estado de la ÚLTIMA intención y llama a `scheduleSave` una sola vez, una carpeta borrada a mitad de cascada deja de tocar `rootGroup` en vez de resucitar capas, y ambas alcanzan también los registros pendientes (`li._pending`) de una carpeta nunca desplegada, no solo las filas ya materializadas. |
| `lazytree.js` | Construcción perezosa de filas para carpetas colapsadas: test diferencial (el mismo árbol construido con todo abierto y con una subcarpeta colapsada serializa exactamente igual); `ensureMaterialized` cede el hilo por lotes, cascada a una subcarpeta ya abierta y difiere una colapsada sin materializarla de más; una llamada reentrante no duplica filas; `subtreeBounds`/`findMatches`(`searchMatches`)+`resolveMatch` alcanzan capas dentro de una carpeta pendiente sin forzar su materialización salvo cuando hace falta llegar hasta una coincidencia; `serializeNode` sobre una carpeta pendiente no construye ninguna fila; `deleteNode` quita del mapa las capas marcadas que una carpeta pendiente escondía; `resolveRecordLi`/`wirePendingLayerEvents` resuelven un clic/hover sobre una capa pendiente a su `<li>` real y retiran el listener de espera al materializar (sin quedarse disparando por duplicado); `visibleElevGridNodes` encuentra una capa de elevaciones marcada dentro de una carpeta pendiente; `blinkLayer` (el parpadeo de identificación de "Ir al nodo en el panel") oculta/muestra la capa dos veces en orden, un parpadeo repetido cancela el anterior en vez de solaparse, y si el checkbox cambia mientras parpadea termina en su estado real en vez de forzarla visible. |
| `pointsedit.js` | Editor de la lista de puntos de una capa de trazos: `pointsToText` (cabecera, tabuladores, altitud 0 cuando falta, un bloque por anillo separado por línea en blanco) y `textToPoints` (ida y vuelta, cabecera ignorada aunque venga repetida en medio al pegar dos veces, separación por comas/espacios/punto y coma, líneas en blanco de los extremos sin crear anillos vacíos, errores con su número de línea real, y 1000 puntos como tamaño objetivo). |
| `msglog.js` | Avisos del panel: `msgStamp` (relleno con ceros en todos los campos y medianoche exacta, el fallo que ya se dio en `pngTimestamp`); fusión de un aviso repetido en una sola línea con `×N` y una sola entrada de registro; lo que NO se funde (texto distinto, mismo texto con otro tono, o línea ya expirada); que el repetido reinicia el temporizador, cancela el anterior y no cambia de sitio; que un `sticky` no arma temporizador; que el registro sobrevive a que la línea desaparezca; el tope `MSG_LOG_MAX` perdiendo la más antigua; el contador de entradas sin ver (un repetido no cuenta); y `logText` (orden cronológico, marca completa, tono y `×N` con la marca de la última). |
| `naming.js` | `nextNumberedName`: autonumerado de las formas dibujadas y las mediciones deducido de los nombres existentes (no de un contador, que se reiniciaría al recargar porque una forma vuelve por el camino genérico `t:"layer"`). Cubre la secuencia, que manda el máximo y no la cuenta (huecos), que cada familia va por su cuenta, que una línea dibujada no reutiliza el número de una medición, el anclaje exacto del patrón (`Mi Línea 9` no cuenta como 9), los registros pendientes de carpetas nunca desplegadas —incluidos los anidados— y los nodos sin nombre. |
| `measure.js` | Mediciones: `defaultMeasureStyle` (una línea nunca se rellena, un círculo sí y con relleno muy translúcido; cada tipo conserva su color y el contorno va siempre opaco); `capArea` —el área de un círculo es la del CASQUETE esférico, no πr²— coincidiendo con πr² a 1 km, quedando por debajo a 1000 km y dando medio globo para un cuarto de vuelta; `measurementValues` (una línea da distancia y rumbo y ninguna área, un círculo radio y área y ningún rumbo); `fmtUnitDist`/`fmtUnitArea` (las mismas funciones para el diálogo y para las etiquetas del visor; el área con el factor AL CUADRADO); `renderMeasureValues` (etiqueta Radio/Distancia, conversión de unidad, rumbo siempre en grados y filas de área/rumbo que se ocultan solas); `updateMeasurement`, que escribe la etiqueta en la unidad elegida —NM por defecto— y con el mismo formato que el diálogo, y `refreshMeasureLabels`, que al cambiar de unidad repinta tanto las filas del árbol como las mediciones de una carpeta nunca desplegada (`li._pending`), que están en el mapa sin fila; y `startRename` sobre una fila cuyo texto no es el nombre a secas —la regresión reportada: dejar el nombre igual, o cancelar con Escape, borraba la distancia de la fila—, más el caso normal de una capa sin medida. |
| `icons.js` | Iconos MDI empotrados (`MDI_ICON_BODIES`, generado por `npm run icons`): que el catálogo `MDI_ICONS` y la tabla de cuerpos no se hayan desincronizado en NINGUNO de los dos sentidos —olvidar `npm run icons` tras añadir un icono es el fallo humano que queda—, que todos los cuerpos empiecen por una forma SVG y se dibujen con `currentColor`, y `mdiSvg` en sus tres formas (sin color deja `currentColor` para que lo tiña el CSS de `.mdi-pin`; con color lo sustituye, que es lo que necesita un `<img>` suelto; con tamaño lo escribe en el propio SVG, que es de donde sale el `width:auto` de `#icon-preview`). Además, sobre el archivo ENTREGADO: que no quede ninguna mención a `api.iconify.design` ni resto de `svgCache`/`fetchIconSvg`, y que `applyMarkerStyle` ya no sea `async` ni lleve contador de secuencia. Todo sin tocar la red: el CI no puede depender de que Iconify esté en pie, que es justo lo que este cambio elimina. |
| `boot.js` | Aviso del hueco del árbol durante el arranque: `showLoadingMessage`/`showEmptyMessage` escriben cada uno su texto, nunca se apilan dos, dejan `rootUl` a null y usan `textContent` (no `innerHTML`). Y, sobre el archivo ENTREGADO —porque es un contrato de ORDEN DE EJECUCIÓN que ninguna función suelta puede comprobar—: que el árbol arranque en «Inicializando…» y NO haya un `showEmptyMessage()` a nivel de módulo (concluir «no hay capas» antes de leer IndexedDB era lo que hacía salir ese aviso a la vez que la barra «Restaurando capas…»), y que 99-boot.js concluya con `if (!rootUl) showEmptyMessage();` DESPUÉS de `dbLoadTree()` — mirando `rootUl` y no `nodes`, para no borrar el árbol de una importación que el usuario haya soltado mientras se leía. |
| `attribution.js` | Línea inferior del visor: `BUILD` con forma AAAAMMDDHHMM, `REPO_URL` a GitHub, y el prefijo de la atribución mostrando versión + enlace al repositorio (por la constante, sin repetir la URL) + el crédito de Leaflet que su licencia pide, con `target="_blank"` y `rel="noopener"` — abrir en la misma pestaña abandonaría la sesión de trabajo. La escala es `L.control.scale` (la de Leaflet, no una propia) en `bottomright`, con sus valores por defecto, y **añadida después** de la atribución: ese orden ES su posición en pantalla, porque Leaflet inserta cada control nuevo de una esquina inferior delante de los que ya hubiera. Y que la escala NO esté en `HIDE_FOR_PNG`: una imagen de un mapa sin escala no se puede medir. |
| `minified.js` | `kitelocal.min.html`, la derivada que sirve GitHub Pages y el único artefacto que ninguna otra suite mira (las 22 que extraen del archivo entregado lo hacen por marcadores de comentario, que el minificado no tiene). No prueba comportamiento —es el mismo código— sino que la TRANSFORMACIÓN no se ha llevado nada por delante: que se haya minificado de verdad (más pequeño, sin comentarios de bloque), que su `<script>` parsee (`node --check`), que lleve el mismo `BUILD` que el legible (comparando el VALOR, porque terser puede alinear la constante — es lo que caza un minificado sin regenerar), que sobrevivan los 5 `integrity`/`crossorigin`, la CSP con sus orígenes, el guardián de Leaflet antes del primer `L.map(`, los nombres de nivel superior (fija que dependemos de `mangle.toplevel: false`) y un cuerpo de icono MDI empotrado; y que `index.html` redirija al minificado. Verificado que falla de verdad con una versión desfasada, un `integrity` de menos y un script inválido. |
| `statics.js` | Las dos comprobaciones estáticas que antes se hacían a mano (y por eso casi nunca): que todo `$id`/`getElementById` apunte a un `id` que exista en el HTML, y que **toda función llamada esté declarada** — un refactor puede borrar un ayudante que sigue en uso y `node --check` no lo ve, porque el archivo sigue siendo válido. La segunda exige mirar código y no texto: los comentarios en castellano llenos de paréntesis daban 369 falsos positivos, así que la suite lleva su propio `maskCode` (borra comentarios, cadenas, plantillas y regex conservando posiciones, y recorre los `${…}`, que SÍ contienen código). Cuenta como declarado todo lo que liga un nombre: declaraciones, claves de objeto, métodos abreviados, getters y parámetros; los globales del navegador van en una lista explícita. Verificado que falla con un `id` mal escrito y con un ayudante borrado. |
| `tristate.js` | Tercer estado de la casilla de un contenedor (`indeterminate` nativo, dibujado como guion): `containerState` sobre los HIJOS DIRECTOS (todos/ninguno/mezcla, contenedor vacío y hoja devuelven null, una fila de mensaje no cuenta), el invariante que permite no bajar más de un nivel —un hijo mixto hace mixto al abuelo—, `aria-checked="mixed"`, que `applyContainerState` diga si cambió algo (es lo que corta la subida), `refreshAncestorChecks` propagando y deshaciendo la mezcla por toda la rama, los registros `_pending` de una carpeta colapsada (solos y conviviendo con filas, que es el estado real tras soltar un archivo dentro), la caché `rec._state` y el borrado recalculando desde el `<ul>` guardado antes de quitar la fila. Más un contrato de orden sobre el archivo entregado: `materializeRecords` recalcula la casilla de la carpeta que se queda pendiente. |
| `usage.js` | La línea de memoria del pie del panel: `memoryUsageText` da cifra servida por http(s) y devuelve null en los dos casos en que no la hay —`file://`, donde Chromium deja `performance.memory` congelada, y un navegador sin esa API, que no está en ninguna norma—, más un `usedJSHeapSize` no finito. `refreshMemoryUsage` ESCONDE la línea cuando no hay cifra en vez de escribir «no disponible» (sería ruido permanente en dos casos raros) y la devuelve al haberla. Y que el arranque no arme el temporizador si no hay nada que refrescar. |
| `clipboard.js` | Copiar y pegar entre instancias de KITE de dominios distintos, por el portapapeles del sistema: que el envoltorio sea el MISMO que el de exportar (`treeExportDoc`, con sus tres versiones) y que `exportNode` lo comparta en vez de duplicarlo; `parseTreeExport` reconociendo lo nuestro y descartando texto suelto, JSON ajeno y un GeoJSON; que lo pegado de fuera nunca MUEVA (cortar en otra pestaña no puede borrar aquí); el orden que evita pegar dos veces —Ctrl+V deja un respaldo con `setTimeout(0)` y NO llama a `preventDefault`, que cancelaría el evento `paste`, y el evento cancela ese respaldo solo si trae algo nuestro—; las dos comprobaciones de versión; y el tope de tamaño, con el fallo de escritura capturado para que no tumbe el portapapeles interno. |
| `hittest.js` | Acierto bajo el cursor del menú contextual, en píxeles de contenedor: `segDistSq` (perpendicular, más allá de los extremos, segmento degenerado), `nearPolyline` (el falso positivo reportado —un punto dentro de la caja envolvente de una diagonal y a 56 px de ella no acierta—, tolerancia inclusiva a tol y no a tol+1, y el **lado de cierre** del anillo, que `getLatLngs()` no repite y sin el cual el último lado no se probaba), `pointInRing` (ray-casting: escotadura de un polígono en L, alturas de vértice) y `pointInRings` (agujeros: el centro de uno queda fuera, su borde acierta por cercanía; por fuera del contorno acierta dentro de la tolerancia). |
| `openshape.js` | Formas abiertas: `isOpenOnly` (una polilínea sí, un polígono no —incluido el orden de comprobación, que importa porque `L.Polygon` extiende `L.Polyline`—, un grupo con línea Y polígono tampoco, y el polígono se encuentra anidado) y `clearFillOnOpenPaths` (quita el relleno a la línea, respeta el del polígono del mismo grupo —el caso del placemark KML que comparte objeto de estilo—, no toca el resto del estilo, y llega a una capa suelta y a través de grupos anidados). |
| `polyarea.js` | Perímetro y área de polígonos (diálogo de propiedades): `ringArea` (fórmula del exceso esférico) contra la aproximación plana de un cuadrado pequeño, invariante al sentido de recorrido, cero con menos de 3 puntos; `ringClosed` (primer y último punto iguales, con tolerancia `COORD_EPS`) distingue un anillo ABC sin repetir el punto de cierre (el caso de algunos JSON) de uno que sí lo repite; `ringPerimeter` con un anillo abierto suma solo los tramos consecutivos (sin el de cierre), con uno cerrado sí lo incluye; `polygonParts` separa exterior/agujeros tanto en un polígono simple como en un multipolígono anidado; área con agujero, calculada a mano y vía `polygonParts`, menor que sin él y próxima a la resta exterior−agujero. |
| `toolstest.js` | `showLayerInfo`/`setTool`: el panel de información abre por hover salvo con el diálogo de estilos abierto o dibujando un polígono (guardas preexistentes); al salir de polígono —y también de línea o círculo, mismo bug— se suprime exactamente el siguiente hover residual (no más, no queda pegajoso); la guarda expira sola si no llega ningún hover; el cierre diferido por `mouseout` se cancela si el siguiente hover cae en otra capa (pasar de una a otra no debe cerrar ni parpadear); no hace nada si ya está cerrado; un panel abierto explícitamente (con foco de teclado dentro) no se autocierra. |

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
