# Pruebas de KITE Local

Los tests **extraen las funciones del propio `kitelocal.html`** y las
ejecutan en Node, de modo que comprueban el código que se entrega, no una
copia que pueda quedarse atrás.

## Ejecutar

```bash
npm install linkedom @xmldom/xmldom     # una sola vez
node pruebas/run-all.js                   # toda la batería
node pruebas/run-all.js --bench           # además, las mediciones
node pruebas/navtest.js                   # una suite suelta
```

`run-all.js` empieza por un `node --check` del script incrustado y
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
| `polyarea.js` | Perímetro y área de polígonos (diálogo de propiedades): `ringArea` (fórmula del exceso esférico) contra la aproximación plana de un cuadrado pequeño, invariante al sentido de recorrido, cero con menos de 3 puntos; `ringClosed` (primer y último punto iguales, con tolerancia `COORD_EPS`) distingue un anillo ABC sin repetir el punto de cierre (el caso de algunos JSON) de uno que sí lo repite; `ringPerimeter` con un anillo abierto suma solo los tramos consecutivos (sin el de cierre), con uno cerrado sí lo incluye; `polygonParts` separa exterior/agujeros tanto en un polígono simple como en un multipolígono anidado; área con agujero, calculada a mano y vía `polygonParts`, menor que sin él y próxima a la resta exterior−agujero. |
| `toolstest.js` | `showLayerInfo`/`setTool`: el panel de información abre por hover salvo con el diálogo de estilos abierto o dibujando un polígono (guardas preexistentes); al salir de polígono —y también de línea o círculo, mismo bug— se suprime exactamente el siguiente hover residual (no más, no queda pegajoso); la guarda expira sola si no llega ningún hover; el cierre diferido por `mouseout` se cancela si el siguiente hover cae en otra capa (pasar de una a otra no debe cerrar ni parpadear); no hace nada si ya está cerrado; un panel abierto explícitamente (con foco de teclado dentro) no se autocierra. |

## Dependencias

- **linkedom** para DOM de HTML.
- **@xmldom/xmldom** para XML: linkedom no implementa espacios de nombres
  ni `getElementsByTagName("*")`, y las pruebas del parser darían falsos
  negativos.

## Convenciones

- Los mensajes de las aserciones describen **qué comportamiento** se
  espera, no en qué línea está; al fallar, el mensaje debe bastar para
  entender qué se ha roto.
- Cuando una prueba nace de un fallo real, el comentario lo dice: sirve
  para que nadie la "simplifique" sin saber qué protegía.
- Los tests extraen funciones sueltas por nombre, no rangos amplios de
  texto: extraer rangos arrastraba código con efectos secundarios.
