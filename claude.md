# claude.md — Guía de desarrollo de KITE Local

**KITE Local** = *KML Interactive Tree Explorer*.

Instrucciones para seguir añadiendo funcionalidades a `visor-kml.html`
(nombre de archivo histórico; el producto es KITE Local)
manteniendo los principios acordados durante el desarrollo del proyecto.

## Principios de base (no negociables)

1. **Un único archivo HTML, sin compilación.** Todo el proyecto vive en
   `visor-kml.html`: HTML + CSS + JavaScript plano. Nada de Vue, React,
   TypeScript, bundlers ni pasos de build. El archivo debe poder abrirse
   directamente en el navegador.
2. **Reusar librerías conocidas y estables; no reinventar.** Se cargan por
   CDN (unpkg / cdnjs) con versión fijada. Las actuales:
   - **Leaflet 1.9.4** — mapa, zoom, pan, controles, capas, tooltips.
   - **JSZip 3.10.1** — descompresión de KMZ.
   - **Iconify (API REST) + Material Design Icons** — SVG de los iconos de
     marcador. No es una librería JS: los SVG se piden a
     `https://api.iconify.design/mdi/<icono>.svg` (coloreados por URL con
     `?color=%23rrggbb` para las vistas previas, o en crudo —dibujados con
     `currentColor`— para incrustarlos en `L.divIcon` y colorearlos por CSS).
     Los SVG en crudo se cachean por nombre de icono (`svgCache`).
     Excepción: el icono `leaflet-pin` (gota de Leaflet) es el PNG de la
     propia distribución de Leaflet, no pasa por Iconify y no es coloreable.
   - **Nominatim (API REST de OSM)** — geocodificación del buscador de
     lugares. Su política de uso limita el tráfico automatizado a ~1
     petición por segundo: se consulta solo al pulsar Enter o el botón
     (nunca por pulsación de tecla) y con `limit=5`.
   Antes de escribir código propio, comprobar si Leaflet (u otra librería
   consolidada) ya lo resuelve. Solo se escribe a mano lo que ninguna
   librería estándar cubre bien (p. ej. el árbol de navegación con
   jerarquía de carpetas, que las librerías de KML aplanan).
3. **Código limpio, mantenible y comentado en inglés.** Los comentarios del
   código se escriben en inglés y explican el *porqué* (decisiones, trampas
   conocidas), no el *qué* obvio. Los comentarios antiguos en español se van
   traduciendo al inglés cuando se toca su sección; no hace falta una
   migración masiva en frío, pero ningún cambio nuevo introduce comentarios
   en español. Los **textos de la interfaz** (botones, títulos, mensajes al
   usuario, este documento) siguen siendo en español. Funciones pequeñas con
   una responsabilidad. Al terminar un cambio, buscar y eliminar referencias
   muertas (`grep` de los nombres retirados).
4. **Sin código de compatibilidad hacia atrás.** El almacenamiento está
   versionado (ver más abajo); lo que no corresponda a la versión actual
   se borra, no se migra. No subir versiones sin un cambio que lo
   justifique.
5. **Robustez ante entradas ajenas.** Todo lo que venga de fuera —KML,
   GeoJSON, KMZ, archivos `.kite.json`, respuestas de red— se trata como
   hostil: se valida antes de construir capas, los errores se aíslan por
   entidad (una geometría mala no tumba la importación), y hay cotas
   preventivas de tamaño y complejidad. El usuario recibe siempre un
   resumen de lo cargado y lo omitido, con la causa.
6. **Verificar con tests lo verificable.** Las funciones puras (geodesia,
   parseo, ordenación, serialización) se prueban fuera del navegador con
   Node (extrayendo el script). Para DOM de HTML sirve `linkedom`; para
   XML hace falta `@xmldom/xmldom`, porque linkedom no implementa
   namespaces ni `getElementsByTagName("*")` y los tests del parser KML
   darían falsos negativos. Como mínimo, `node --check` antes de entregar.

## Formatos y límites de entrada

- **KML namespace-agnóstico**: nada puede depender del `tagName` literal.
  `bareName`, `elsByTag`, `firstByTag` y `childrenByTag` resuelven por
  nombre local, con la consulta por namespace comodín como vía rápida y un
  filtrado manual como respaldo, así que funcionan con `<kml:Placemark>`,
  con namespace por defecto y sin namespace.
- **Apertura tolerante del XML**: KML real puede usar un prefijo que
  nunca declara (el caso visto: `xsi:schemaLocation` sin su `xmlns:xsi`).
  Google Earth lo acepta, pero para XML es un error de buena formación y
  el `DOMParser` devuelve un documento de error, con lo que se perdía el
  archivo entero. `parseKmlDocument` detecta ese caso,
  `repairUndeclaredPrefixes` declara los prefijos que faltan en el
  elemento raíz (con una URI sintética: solo hace falta que exista) y se
  reintenta **una sola vez**. Cualquier otro fallo se comunica con el
  mensaje y la posición del propio analizador, no con un «XML no válido»
  a secas. La reparación se anota en el informe de importación.
- **Estilos KML**: `buildStyleIndex` devuelve un `resolve(url)` perezoso
  que sigue cadenas `StyleMap → StyleMap → Style` con tope de saltos
  (`STYLE_HOPS`) y corte de ciclos; admite `<Style>` incrustado en el
  `<Pair>`. Las referencias a archivos externos no se pueden resolver sin
  descargarlos: se cuentan (`externalRefs`) y se avisa en el resumen.
- **Coordenadas**: `validLatLng` exige valores finitos y en rango; las
  tuplas incompletas o con texto se descartan una a una. GeoJSON pasa
  además por `validGeometry` (tipo conocido, anidamiento correcto, anillos
  de al menos cuatro posiciones, líneas de al menos dos).
- **Aislamiento por entidad**: cada Placemark y cada feature se construye
  en su propio `try`; lo que falle se cuenta en el informe
  (`makeImportReport`) y el resto sigue cargando. Al terminar se muestra
  el resumen: cargados, tipos detectados, omitidos y las causas más
  frecuentes. El informe distingue `warn()` (una entidad perdida) de
  `note()` (una advertencia que no cuesta ningún elemento, como una
  reparación de namespace), y `hasIssues` decide si hay algo que leer.
- **Avisos que exigen lectura**: `navMessage(txt, { sticky, tone })`.
  Los transitorios se van a los `MSG_TIMEOUT`; los `sticky` se quedan
  hasta que el usuario pulsa «Aceptar», porque un resumen con elementos
  omitidos no da tiempo a leerse. Los avisos se apilan por líneas para
  que soltar varios archivos a la vez no haga que uno pise a otro, con
  tope `MSG_MAX_LINES` que solo retira los transitorios. Un resumen
  limpio se muestra en tono `info` y se cierra solo, como antes.
- **Cotas de KMZ**: `KMZ_MAX_ENTRIES`, `KMZ_MAX_UNCOMPRESSED` y
  `KMZ_MAX_RATIO` frenan zips desproporcionados u hostiles antes de
  descomprimirlos.
- **CSP**: hay una `Content-Security-Policy` en el `<head>` que declara
  `default-src 'none'` y enumera los orígenes reales (unpkg, cdnjs, las
  teselas, Iconify y Nominatim). Al añadir un origen nuevo hay que
  añadirlo también ahí o dejará de funcionar. `'unsafe-inline'` es
  inevitable mientras el CSS y el JS vivan en el propio archivo.

## Vocabulario del proyecto

- **Ventana de navegación**: panel izquierdo con el árbol de capas.
- **Ventana del visor**: mapa Leaflet a la derecha.
- **Nodo**: cualquier fila del árbol — archivo, carpeta, capa o medición.
- **Tipo de nodo (`styleKind`)**: clasificación usada por los estilos y la
  selección múltiple: `marker` (contiene marcadores), `polygon` (contiene
  trazos: polígonos/líneas; los mixtos cuentan como `marker`), `measure`
  (medición), `group` (carpeta/archivo).

## Arquitectura (orden de secciones dentro del script)

1. **Mapa base**: capas de teselas (OSM, Esri Terrain, PNOA, sin fondo) y
   `rootGroup`, el `featureGroup` del que cuelga TODO lo cargado.
2. **Parseo KML**: estilos (`aabbggrr` → color+opacidad, `StyleMap` par
   *normal*), `<visibility>`, `<open>`, geometrías (MultiGeometry,
   polígonos con agujeros). GeoJSON con estilos simplestyle.
3. **Árbol de navegación**: `makeNode(...)` es la fábrica única de filas
   (caret, checkbox, color, etiqueta, acciones). Toda fila nueva debe
   crearse con ella. Utilidades: `nodeUl`, `deleteNode`, `startRename`,
   `sortChildren`, `highlightNode`, drag interno (`wireDrag`).
4. **Persistencia**: serialización del árbol completo a IndexedDB.
5. **Acciones del panel**: búsqueda en el árbol, buscador de lugares
   (Nominatim), crear carpeta, seleccionar todo, selección masiva con el
   teclado.
6. **Estilos de capa**: arrastre de diálogos (`makeDialogMovable`),
   selector de color, coordenadas (`formatCoord` / `parseCoord`),
   diálogo de estilos con borrador y Cancelar/Aceptar
   (botón 🎨 de cada fila de capa), catálogo de iconos (`MDI_ICONS`, con la
   gota de Leaflet al frente), construcción del icono (`buildMarkerIcon`),
   aplicación a marcadores (`applyMarkerStyle` / `applyMarkerText` /
   `ensureMarkerDefaults`) y a polígonos (`applyPolygonStyle`), selector de
   iconos.
7. **Separador redimensionable y toggle** del panel.
8. **Geodesia**: `bearingDeg`, `destPoint`, `fmtDist` — sobre la esfera
   (R = 6371 km, el mismo que usa Leaflet).
9. **Mediciones**: líneas y círculos, creación por arrastre, edición con
   Ctrl+arrastre. En su misma barra vive el botón de crear pin.
10. **Controles de vista**: autoescala, ES/IC, retícula, coordenadas.
11. **Arranque**: restauración del árbol guardado. Va al final para que
    todo esté definido.

## Reglas de comportamiento acordadas

- **Visibilidad**: una capa se muestra si y solo si SU checkbox está
  marcado. El checkbox de una carpeta/archivo es solo un interruptor
  masivo en cascada; no filtra por sí mismo.
- **Estado inicial desde KML**: `<visibility>` hereda hacia abajo para el
  estado inicial; después `syncSubtree` marca cada carpeta según tenga o
  no capas visibles. `<open>` decide el colapso inicial (ausente = 0 =
  colapsada). Los GeoJSON arrancan colapsados.
- **La vista del usuario es sagrada**: cargar archivos NUNCA cambia el
  zoom/encuadre, y el primer doble click en una fila solo desplaza la
  vista al centro de sus capas (`panTo`), sin tocar el zoom; para
  encuadrar está el botón de autoescalar.
- **Escalera de zoom del doble click**: si la vista YA está centrada en
  ese nodo (`isCenteredOn`, comparación en píxeles, no en grados, porque
  un margen en grados vale distancias muy distintas según el zoom), el
  doble click sube por peldaños fijos: 5 → 9 → zoom máximo → 3 → 5…
  (`nextZoomStep`). Es un ciclo a propósito: al llegar al máximo se
  vuelve abajo, para que el gesto nunca deje al usuario atrapado. La
  escalera se arma en cada llamada porque el zoom máximo depende del mapa
  base activo, y se descartan los peldaños duplicados. Única excepción:
  elegir un resultado del buscador de lugares, que ES pedir ir allí (se
  encuadra su `boundingbox`, o se centra en sus coordenadas si no lo trae).
- **Buscador de lugares**: la caja de búsqueda de la cabecera consulta
  Nominatim y muestra hasta 5 resultados. La lista vive dentro de la
  cabecera del panel, de modo que al desplegarse empuja el árbol de capas
  hacia abajo en vez de flotar sobre él, y se puede cerrar con su «×» para
  recuperar el espacio. Al elegir un resultado se crea un marcador con el
  estilo por defecto en la sección «Lugares» (`ensureNamedSection`, que
  reutiliza las secciones de nodos creados por el usuario —«Lugares»,
  «Marcadores»— buscándolas por nombre para sobrevivir a las
  restauraciones).
  Un contador de secuencia (`placeSeq`) descarta las respuestas de
  búsquedas ya superadas.
- **Gestos del visor**: Shift+arrastre = box-zoom de Leaflet (no usarlo
  para otra cosa); Ctrl+arrastre = editar mediciones; herramienta de
  medición activa = el arrastre dibuja (pan desactivado temporalmente).
- **Gestos de la navegación**: Shift+click = selección múltiple de nodos
  (se arrastran, borran y restilizan en lote; `topLevelSelection()`
  excluye nodos contenidos en otro seleccionado, que viajan con su
  ancestro); Supr borra la selección; Escape cierra los diálogos abiertos
  y, si no hay ninguno, limpia herramienta y selección; doble click en una
  fila lleva la vista a sus capas. "Activar/Desactivar" se refiere a
  los checkboxes (visibilidad); "seleccionar" se reserva para la selección
  múltiple.
- **Selección masiva con el teclado**: Shift + flecha arriba/abajo,
  Av/Re Pág (10 filas) o Inicio/Fin (hasta el extremo de la lista)
  recorre las filas visibles seleccionando a su paso. Al **seleccionar**,
  el recorrido salta las filas que no son del tipo del recorrido
  (cabeceras de carpeta, capas de otra clase): si se las pasara a
  `selectNode`, su regla del mismo tipo vaciaría lo marcado hasta ese
  momento y Shift+Fin parecería no hacer nada. Al **deseleccionar** no se
  filtra: quitar vale para cualquier fila. El cursor avanza aunque las
  últimas filas se hayan saltado. El atajo solo se cede a los campos
  donde Shift+Inicio/Fin selecciona texto; un checkbox del árbol con el
  foco (lo normal tras pinchar una fila) no debe bloquearlo. Inicio y Fin no
  necesitan caso aparte: son un paso de ±`Infinity`, que camina hasta
  que se acaba la lista.
  Se repite el sentido de la última acción (`selDeselecting`): si esta
  quitó un nodo de la selección, las flechas van deseleccionando. El
  cursor (`selCursor`, dibujado con la clase `cursor`) marca desde dónde
  continúa el teclado, y sin cursor la primera pulsación cae en la primera
  o la última fila y siempre selecciona. Con el foco en el mapa se cede la
  combinación a Leaflet (es su desplazamiento largo). Toda selección debe
  pasar por `selectNode`, que centraliza la regla del mismo tipo, el
  cursor y el sentido.
- **Botones de selección de la carpeta**: en la fila de cada contenedor,
  a la izquierda del AZ, ☑ selecciona de golpe todas las capas de la rama
  (`selectFolderLayers`) y ☐ quita la selección (lo mismo que Escape).
  Como solo caben capas del mismo tipo, manda el tipo de la primera capa
  encontrada y se avisa por `navMessage` de cuántas quedan fuera, en vez
  de marcarlas y desmarcarlas en silencio.
- **Selección del mismo tipo**: solo pueden coexistir en la selección
  nodos del mismo `styleKind`. Al Shift+seleccionar un nodo de tipo
  distinto (p. ej. una capa de marcadores con capas de polígonos ya
  seleccionadas), la selección anterior se descarta. Así el diálogo de
  estilos siempre actúa sobre capas homogéneas.
- **Estilos de capa**: el botón 🎨 abre el diálogo de estilos. Si la fila
  pertenece a una selección múltiple, los cambios se aplican a todas las
  capas seleccionadas (igual que borrar o arrastrar). Capas de marcadores:
  icono, color y tamaño del marcador, tamaño y color del texto, y texto
  siempre visible (tooltip permanente) o solo al hacer click (popup). Capas
  de polígonos: ancho y color del contorno, relleno sí/no, y color y
  opacidad del relleno. Las mediciones no tienen diálogo de estilos
  (`styleable: false`).
- **Texto y posición: solo para un marcador**. Cuando el objetivo es una
  única capa con exactamente un marcador (`soleMarker`), el diálogo añade
  el texto del marcador y su posición; con selección múltiple o con varios
  marcadores en la capa, esas filas se ocultan. La posición se presenta y
  se edita en dos notaciones intercambiables con un botón ⇅ —el mismo gesto
  que el selector de color nativo para cambiar de notación—: grados,
  minutos y segundos con decimales (el formato por defecto) y grados con
  decimales. El formato elegido se recuerda entre aperturas del diálogo. `parseCoord`
  acepta cualquiera de las dos con independencia de la elegida (signo por
  «−» o por hemisferio N/S/E/W/O), así que pegar una coordenada de
  cualquier procedencia funciona; lo ilegible o fuera de rango se marca en
  rojo y «Aceptar» no cierra hasta corregirlo.
- **La posición no es estilo**: `lat`/`lng` viven en el borrador solo
  mientras el diálogo está abierto y nunca llegan a `_mstyle` (son
  geometría; se guardan con el GeoJSON de la capa).
- **Los colores no usan el `<input type="color">` en línea**: el nativo
  aplica al instante y eso choca con la edición diferida. Cada color es un
  botón que muestra su valor (`setColorButton` / `colorOf`, con el hex en
  `dataset.color`) y abre el selector de color, que tiene su espectro, la
  paleta `COLOR_PRESETS` y sus botones Cancelar/Aceptar; solo al aceptar
  llega al borrador.
- **Diálogos movibles**: los diálogos de propiedades se arrastran por su
  título (`makeDialogMovable`, con eventos de puntero para ratón, lápiz y
  táctil) para despejar la zona del mapa que interese. Al primer arrastre
  la caja pasa a posición fija y conserva desde entonces donde la deje el
  usuario; `clampToViewport` la mantiene alcanzable al reabrirla y al
  redimensionar la ventana. Todo diálogo nuevo debe registrarse con
  `makeDialogMovable`.
- **El diálogo de estilos NO es modal**: es una tarjeta flotante sobre el
  visor (`.dlg-float`, arriba a la derecha), no un `.dlg-overlay` a
  pantalla completa. Es lo que permite arrastrar el marcador mientras se
  edita: un modal cubre el mapa y se come todos los eventos del ratón.
  Como consecuencia se puede pulsar el 🎨 de otra fila con el diálogo
  abierto, y `openStyleDialog` cancela primero la edición en curso. Los
  subdiálogos transitorios (el selector de iconos) sí son modales y van por
  encima.
- **Arrastrar el marcador**: mientras el diálogo de estilos está abierto,
  el marcador editado es arrastrable y al moverlo actualiza las cajas de
  coordenadas. Es la excepción a la edición diferida —arrastrar es
  necesariamente en vivo—, pero «Cancelar» lo devuelve a su posición
  original. Si la capa está oculta no hay icono en el mapa que arrastrar y
  se esconde el aviso.
- **Crear un pin**: el botón 📍 de la barra de herramientas del visor crea
  un marcador en el centro de la vista, dentro de la sección «Marcadores»,
  y abre su diálogo de estilos para ajustar icono, texto, coordenadas y
  tamaños. Como el pin se ha creado solo para eso, «Cancelar» (o Escape) lo
  borra: `openStyleDialog(li, { isNew: true })` y `styleIsNew`. No es una
  herramienta de arrastre: actúa al hacer click, no pasa por `setTool` y no
  desactiva el pan.
- **Edición diferida (Cancelar / Aceptar)**: los diálogos NO aplican nada
  al mapa mientras están abiertos (única excepción: arrastrar el marcador,
  ver más abajo). Los controles escriben en un borrador
  (`styleDraft`) y solo «Aceptar» lo copia a cada capa y repinta;
  «Cancelar» descarta el borrador y las capas conservan su estilo previo,
  incluido el icono. El selector de iconos funciona igual: al pulsar un
  icono solo se marca (`pendingIcon`), y llega al borrador al aceptar.
  Cualquier diálogo nuevo debe seguir este patrón.
- **El contorno no tiene opacidad**: siempre 100%. Se ignora el alfa del
  `<LineStyle>` de KML y el `stroke-opacity` de simplestyle, y el diálogo
  fuerza `opacity: 1`. Solo el relleno tiene opacidad editable.
- **Los iconos importados no se respetan**: no hay equivalencia exacta con
  los pushpins de Google Earth y los `<IconStyle>` con `href` apuntan a
  URLs que el visor no carga. Toda capa de marcadores arranca con el estilo
  por defecto (`DEFAULT_MARKER_STYLE`: gota de Leaflet, `#1b5e97`, 41 px)
  vía `ensureMarkerDefaults`, tanto al importar KML/GeoJSON como al
  restaurar nodos sin `mstyle`. El color no afecta a la gota de Leaflet por
  ser un PNG, pero sí a cualquier icono MDI que se elija después.
- **Marcadores personalizados**: los iconos MDI se renderizan como
  `L.divIcon` con el SVG incrustado y coloreado vía `currentColor` (clase
  CSS `.mdi-pin`), anclado al centro; la gota de Leaflet usa `L.icon` con
  su PNG y sombra, anclada en la punta y escalada manteniendo su
  proporción 25:41. `buildMarkerIcon` devuelve el icono y el desplazamiento
  del texto que corresponde a cada familia. El texto del marcador usa las
  cajas compactas ajustadas al texto (clases `compacto` de popup y
  tooltip) para tapar el mínimo mapa posible. Renombrar la capa actualiza
  el texto.
- **Distancias y rumbos**: siempre geodésicos (esfera terrestre);
  rumbo 0° = norte, sentido horario. Las distancias se muestran en
  métrico **y** en millas náuticas (`METERS_PER_NM`), y la etiqueta de una
  medición se coloca en el punto medio geodésico (`midPoint`, promedio
  cartesiano 3D), que es correcto en arcos largos y al cruzar ±180°.
- **Retícula**: se recorta a la franja Mercator (±85°) y el paso crece
  hasta que el número de líneas cabe en `GRAT_MAX_LINES`, para que cerca
  de los polos no se generen decenas de miles de líneas.

## Exportar e importar carpetas

- El botón 💾 de una carpeta o un archivo descarga su subárbol como
  `<nombre>.kite.json`: el **mismo formato de registros** con el que se
  guarda el árbol (`serializeNode`), envuelto en `{ app, db, schema,
  exported, nodes }`. Reutilizar el formato interno es lo que hace que
  importar no cueste más que un `buildFromNodes`.
- El envoltorio declara **tres versiones distintas**: `format`
  (`EXPORT_FORMAT`, versiona el envoltorio del archivo), `schema`
  (`TREE_SCHEMA`, los registros) y `db` (`DB_VERSION`, los almacenes).
  Al importar se comprueban las dos primeras y cualquier discrepancia se
  rechaza con un mensaje claro; no se migra (ver el principio de no
  compatibilidad hacia atrás).
- Al soltar un `.json` se mira su contenido, no su extensión:
  `parseTreeExport` reconoce el envoltorio y, si no lo es, el archivo sigue
  su camino como GeoJSON.
- Lo importado **siempre se añade**: nunca sustituye ni fusiona nada, así
  que es el usuario quien decide qué copia conserva.

## Accesibilidad

- El árbol es `role="tree"` con `treeitem`, `role="group"`,
  `aria-selected` y `aria-expanded` (`syncExpanded` / `syncAllExpanded`
  tras cualquier cambio de colapso). Los botones que solo tienen icono
  llevan `aria-label` además del `title`.
- Los diálogos se registran con `setupDialog`: `role="dialog"`,
  `aria-modal` según sean modales o no, `aria-labelledby` a su título y
  atrapado de Tab dentro de la caja. `focusDialog` / `releaseFocus`
  llevan el foco al abrir y lo devuelven al elemento que lo abrió.
  Cualquier diálogo nuevo debe pasar por ahí.

## Persistencia (IndexedDB)

- Base `visor-kml`, `DB_VERSION` versiona los almacenes (hoy: solo
  `tree`); `TREE_SCHEMA` versiona el formato del árbol serializado, que
  se guarda como `{ v, nodes }` bajo la clave `root`. `TREE_SCHEMA` actual:
  **2** (los nodos de capa admiten `mstyle`, el estilo de marcador).
- `serializeNode(li)` serializa un nodo (y sus hijos vía
  `serializeNodes`); `serializeTree()` es esa misma pasada sobre la raíz.
  Los dos consumidores son el guardado automático y la exportación de una
  carpeta a un archivo. `serializeTree()` recorre el DOM del árbol; cada tipo de nodo guarda lo
  necesario para reconstruirse (geometría como GeoJSON vía
  `layer.toGeoJSON()`, estilo de trazo en `style`, estilo de marcador en
  `mstyle` si se ha personalizado, mediciones como tipo+origen+destino,
  contenedores con `collapsed` y `children`). `restoreTree()` reconstruye
  y reaplica `mstyle` (la petición del SVG está cacheada).
- **Una sola conexión** (`dbPromise`), con `onversionchange`/`onclose`
  para soltarla si otra pestaña necesita actualizar el esquema.
- **Los guardados se serializan** en una cadena de promesas
  (`saveChain`): el árbol se serializa cuando le llega el turno, así que
  lo que queda en disco es siempre el estado más reciente aunque se
  encadenen mutaciones rápidas.
- **Toda mutación del panel debe llamar a `scheduleSave()`** (debounce de
  400 ms). Al añadir una interacción nueva que cambie el árbol, añadir su
  `scheduleSave()` es parte del cambio, no un extra. Los cambios de estilo
  también son mutaciones del árbol.
- Si cambias el formato serializado, sube `TREE_SCHEMA`; si cambias los
  almacenes, sube `DB_VERSION`. En ambos casos lo viejo se descarta.

## Red externa

- Nominatim e Iconify se consultan con `AbortController` /
  `AbortSignal.timeout`: una búsqueda nueva o cerrar los resultados
  cancela la anterior y libera la conexión.
- `describeHttp` traduce el estado HTTP a algo accionable (429 = límite
  del servicio, 5xx = no disponible…), y los fallos de icono no quedan
  cacheados para que un corte puntual no inutilice ese icono.

## Pendiente (conocido y no hecho)

- **SRI en las dependencias de CDN**: no se han añadido `integrity`
  porque no se pueden calcular ni verificar sin descargar los archivos, y
  un hash equivocado deja la aplicación inservible. Si se añaden, hay que
  tomar los hashes publicados por unpkg/cdnjs y probarlos.
- **Antimeridiano completo**: el punto medio y las mediciones ya lo
  cruzan bien; el encuadre automático y las líneas de la retícula todavía
  no representan geometrías que cruzan ±180°.
- **Navegación completa del árbol con teclado** (flechas sin Shift para
  moverse y desplegar, Enter para activar) y monitorización de memoria y
  cuota de almacenamiento.

## Rendimiento y progreso

- Umbral `SIZE_THRESHOLD` (~2.5 MB): por debajo, carga silenciosa; por
  encima, indicador de tres fases: descompresión KMZ (determinada, JSZip
  da porcentaje), "Procesando XML…" (indeterminada: `DOMParser` es
  síncrono y monolítico) y construcción por lotes (determinada).
- Los constructores del árbol son `async` y ceden el hilo cada
  `PROGRESS_BATCH` capas con `yieldFrame()` para no congelar la interfaz.
  Cualquier bucle nuevo que cree muchas capas debe seguir el mismo patrón.
- Sin Web Workers: el tamaño objetivo (6–20 MB) no los justifica y
  complicarían el código (sin `DOMParser` ni Leaflet en el worker).
- Los SVG de iconos se piden una sola vez por nombre (`svgCache` guarda la
  promesa); `applyMarkerStyle` es asíncrona y usa un contador de secuencia
  por nodo para descartar aplicaciones obsoletas durante la edición en
  vivo.

## Cómo añadir una funcionalidad (checklist)

1. ¿Lo resuelve Leaflet u otra librería estable por CDN? Úsala.
2. Filas nuevas del árbol → `makeNode`. Controles nuevos del visor →
   `L.Control.extend` (ver `MeasureControl` / `ViewControl` como plantilla).
   Diálogos modales → patrón `.dlg-overlay` / `.dlg-box` con botones
   Cancelar/Aceptar y edición sobre borrador (ver el diálogo de estilos).
3. Si muta el árbol → `scheduleSave()`. Si cambia lo serializado →
   actualizar `serializeTree`/`buildFromNodes` y subir `TREE_SCHEMA`.
4. Si crea muchas capas → procesar por lotes con progreso.
5. Textos de interfaz en español; comentarios del código en inglés;
   mensajes al usuario vía `navMessage`.
6. Respetar los gestos reservados (Shift, Ctrl) y no tocar la vista del
   usuario sin que lo pida. Shift+click en la navegación respeta la regla
   de selección del mismo tipo.
7. **Siempre** actualizar la constante `BUILD` (AAAAMMDDHHMM, junto al
   crédito de Leaflet) en CADA generación del código, por pequeña que
   sea: es la única versión visible y sirve para saber qué se está
   ejecutando. Sin excepciones.
8. `node --check` del script; test en Node de la lógica pura; `grep` de
   referencias muertas de lo que se haya retirado.
