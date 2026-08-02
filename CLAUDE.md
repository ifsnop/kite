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

## Estructura del árbol al importar

- **La jerarquía del archivo es intocable.** Un KML trae su propia
  estructura de `<Document>` y `<Folder>`, así que se vuelca
  directamente en la raíz: envolverla en una carpeta con el nombre del
  archivo añadiría un nivel que no existe en el original.
- Un GeoJSON, en cambio, es una lista plana sin jerarquía propia, y ahí
  la carpeta contenedora sí aporta: agrupa lo que llegó junto. Es la
  única importación que crea envoltorio.
- Si la construcción falla a medias, se retira lo que hubiera entrado:
  media importación es peor que ninguna.

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
- **Coordenadas con tolerancia de redondeo**: reproyectar acumula error
  de coma flotante y es corriente encontrar longitudes como
  `180.00000044181039`, fuera de rango por 4×10⁻⁷ grados (unos 5 cm).
  Descartarlas hacía perder la geometría entera por un redondeo, así que
  `clampDeg`/`clampLatLng` **ajustan al límite** lo que se pase por menos
  de `COORD_EPS` (10⁻⁵°, ~1,1 m) y siguen rechazando lo que se sale de
  verdad, como las latitudes de 32400 que produce escribir coordenadas
  con coma decimal. Los ajustes se cuentan y se avisan en el resumen de
  importación: corregir en silencio sería peor.
- En GeoJSON la validación **normaliza sobre el propio objeto**, de modo
  que lo que se dibuja y se guarda ya está dentro de rango sin recorrer
  la geometría dos veces. GeoJSON pasa
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
  teselas del mapa y del MDT, Iconify y Nominatim). Al añadir un origen nuevo hay que
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
- **Botón 🔍 de enfoque** (`focusOnNode`, `FOCUS_ZOOM`): centra la vista
  en el nodo y fija el zoom, siempre igual, sin depender de dónde
  estuviera la vista. Es la vía fiable frente al doble click, que
  encadena escalones.
- **El nombre de la fila NO activa la casilla**: se retiró el `htmlFor`
  del `<label>`. Pinchar el nombre selecciona la fila; un doble click
  sobre él alternaba la visibilidad a medias y parecía «desmarcar» la
  capa. La casilla se pulsa aparte y el espacio hace lo mismo desde el
  teclado.
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
- **Teclado del panel, como un árbol de Windows**: flechas arriba/abajo
  mueven el cursor y la selección le sigue (olvidando la anterior);
  derecha despliega y, si ya estaba abierta, entra en el primer hijo;
  izquierda colapsa y, si ya estaba cerrada, sube a la carpeta madre;
  Av/Re Pág saltan `PAGE_STEP` filas; **Inicio y Fin van a los extremos
  de la carpeta actual** (`siblingRows`), no de la lista entera; espacio
  activa o desactiva lo seleccionado; Escape limpia la selección y
  cancela un corte pendiente; Supr borra; Ctrl+C/X/V copian, cortan y
  pegan; Alt+Intro abre las propiedades.
- **Moverse cuesta O(profundidad), no O(nodos)**: `nextRow`, `prevRow`,
  `stepRows` y `selectRange` navegan mirando hermanos, hijos y madre.
  Construir la lista completa de filas visibles en cada pulsación costaba
  ~7 ms con 10.000 nodos y con la tecla repetida el panel se atascaba;
  ahora son 0,08 ms. No reintroducir barridos globales del árbol en el
  camino del teclado.
- **El click lleva el cursor donde se pulsa** y deja ese nodo como única
  selección, salvo si el click cae en los botones de la fila: esos actúan
  sobre la selección existente y no deben cambiarla.
- **Los botones de fila aparecen solo con el ratón encima.** Nada más:
  ni la fila del cursor ni `:focus-within` los muestran, porque al pulsar
  una fila el foco pasa a su casilla y con `:focus-within` se quedarían
  fijos sin ratón encima. A cambio no son alcanzables con el tabulador:
  el camino de teclado son los atajos (Alt+Intro, Supr, Ctrl+X/C/V,
  espacio), no los botones.
- **Teclas al estilo Windows**: F2 renombra, Ctrl+A selecciona la carpeta
  actual y, repetido, todo el árbol; Ctrl+F lleva al buscador; Ctrl+Z y
  Ctrl+Y deshacen y rehacen; `?` abre la chuleta, también accesible con
  el botón junto al título. **Sin escritura anticipada**: se retiró
  porque el buscador del panel ya cubre esa necesidad y capturaba todas
  las teclas sueltas.
- **Renombrar es F2 o el diálogo de propiedades** (fila «Nombre», visible
  solo con un nodo seleccionado, para cualquier tipo de capa). Se retiró
  el botón del lápiz de cada fila.
- **Ancla y rangos**: con Shift (teclado o click) se selecciona todo lo
  que hay entre el ancla y el destino, reemplazando la selección;
  Ctrl+Shift+click marca o desmarca un solo nodo sin arrastrar los
  intermedios. `selAnchor` es el extremo fijo y solo lo mueven las
  acciones sin Shift.
- **Ya no se exige que la selección sea del mismo tipo**: se puede
  seleccionar lo que sea y es el diálogo de propiedades quien comprueba
  la mezcla y avisa de que no se pueden editar en bloque nodos de
  distinto tipo. Con varios nodos seleccionados no se editan ni el nombre
  ni la posición, que son propios de cada uno; el resto (colores,
  grosores, relleno, tamaños) sí va en bloque.
- **Portapapeles interno**: guarda los mismos registros de
  `serializeNode`, así que pegar es reconstruirlos con `buildFromNodes`.
  Cortar no borra nada hasta que se pega (y Escape lo cancela); pegar
  entra en la carpeta del cursor si está desplegada, y si no, coloca a
  continuación de él.
- **El estado de colapso es de cada nodo**: colapsar una carpeta no toca
  el de sus hijas, así que al reabrirla las subcarpetas aparecen como
  estaban. No introducir estados de colapso "heredados".
- **Botones de selección de la carpeta**: en la fila de cada contenedor,
  a la izquierda del AZ, ☑ selecciona de golpe todas las capas de la rama
  (`selectFolderLayers`) y ☐ quita la selección (lo mismo que Escape).
  Como solo caben capas del mismo tipo, manda el tipo de la primera capa
  encontrada y se avisa por `navMessage` de cuántas quedan fuera, en vez
  de marcarlas y desmarcarlas en silencio.
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
- **Lectura de coordenadas del visor**: tres filas de la misma posición
  —grados decimales, grados/minutos/segundos y UTM con su huso—, usando
  `formatCoord`, el mismo formateo con el que se editan las coordenadas
  de un marcador, para que visor y diálogo digan lo mismo.
- **UTM va sobre el elipsoide WGS84** (`latLngToUtm`, serie de Snyder),
  no sobre la esfera que usan las mediciones: con la esfera el error
  llegaría a cientos de metros. Incluye las excepciones reales de husos
  (sur de Noruega y Svalbard) y la banda X, que abarca 12° en vez de 8°.
  Por encima de 84°N y por debajo de 80°S UTM no está definido y se dice
  así en vez de dar un número falso.
- **Modo altura (MDT del IGN)**: el botón ⛰ del visor activa la consulta
  de altitud bajo el cursor contra el servicio XYZ del IGN
  (`raster-dem`, MDT05 del PNOA, codificación Terrain-RGB, zooms 5–15,
  solo España). Es **altitud ortométrica**, sobre el nivel medio del mar,
  no la elipsoidal de un GNSS, y se muestra en metros **y en pies**
  (`fmtAltitude`, con el pie internacional exacto de 0,3048 m), igual que
  las distancias se dan en métrico y en millas náuticas. Va apagado por defecto porque cada lectura
  cuesta una descarga a un servidor ajeno, y al activarlo se añade la
  atribución CC BY 4.0 que exige la licencia.
- **MDT y MDS por el MISMO camino** (`makeElevationSource`): los dos son
  WCS 2.0, rejilla ASCII, misma ventana y mismo recorte. Antes el terreno
  venía de teselas Terrain-RGB y la superficie de un WCS: distinto
  muestreo, distinta interpolación y distinto redondeo, así que restar
  ambos valores para saber qué hay construido no era fiable. El MDT usa
  `servicios.idee.es/wcs-inspire/mdt` y `pickMdtCoverage` elige la malla
  **más fina** (5 m, la del MDS) y, a igualdad, un sistema geográfico
  para poder preguntar en latitud/longitud.
- **El caché guarda REJILLAS y se busca por COBERTURA**: una rejilla
  sirve si contiene el punto pedido. Indexarlas por celdas de 25 m
  dejaba huecos de hasta 22 m —el caché devolvía una rejilla que no
  cubría el punto y, al darlo por resuelto, no se pedía otra—. Medido en
  un recorrido de 400 m: 444 puntos sin cobertura frente a ninguno, por
  20 peticiones en vez de 17. Las zonas SIN datos sí se siguen indexando
  por celda, porque no hay rejilla que delimite su extensión.
- **La ventana pedida es de ±20 m**, no ±10: con celdas del modelo de
  5 m, una consulta cubre varias y el ratón las recorre sin volver a
  pedir. Medido: a ±10 m harían falta 39 peticiones en el mismo
  recorrido; a ±20 m, 20.
- **Manda la COBERTURA de la rejilla, no la distancia recorrida**:
  mientras el cursor siga dentro de la última rejilla, sus valores se
  leen directamente (`gridSample`) y no se pide nada; se pide solo al
  salirse. Antes se decidía por celdas de caché de 25 m y, como la
  rejilla abarca solo ±10 m alrededor del punto donde estaba el ratón al
  pedirla, había puntos que caían fuera de la rejilla pero dentro de la
  celda ya «resuelta»: ni se repintaban ni se volvían a pedir. Medido:
  9 de cada 51 puntos de esa franja quedaban muertos.
- **La lectura muestrea bajo el CURSOR**, no la celda central de la
  rejilla: moverse por la cuadrícula actualiza el valor sin red.
- **Tres estados distintos** en `gridSample`: `undefined` = el punto
  queda fuera (hay que pedir), `null` = dentro pero sin dato (no se pide
  otra vez), y un número = dato bueno. Confundir los dos primeros es lo
  que dejaba zonas en «consultando…» para siempre.
- **Cuadrícula de elevaciones**: la respuesta del WCS se dibuja entera,
  celda a celda, con los tres valores (MDT, MDS y su diferencia). El
  disparo es la RESPUESTA, no el movimiento del ratón, y cada respuesta
  borra la anterior. `parseAsciiGrid` devuelve por eso la matriz
  completa con su cabecera (`xllcorner`, `yllcorner`, `cellsize`), no un
  solo valor; `gridValue` extrae el de la celda central para la lectura.
- **La rejilla viaja etiquetada con su CRS** (`web`, `geo` o `native`):
  sin saber en qué sistema se pidió no se pueden convertir sus esquinas a
  latitud y longitud. Web Mercator se deshace con la propia proyección de
  Leaflet; el sistema nativo (UTM) no se dibuja, porque no tenemos la
  conversión inversa y es preferible no pintar la malla a pintarla mal.
- **El texto de las celdas escala con el zoom** (`gridFontSize`): a
  partir del 21 crece un punto por nivel, con tope para que siga cabiendo
  en la celda. Es un tamaño relativo a la celda, no absoluto, así que las
  etiquetas se rehacen en `zoomend` (`rescaleElevGrid`) reutilizando el
  texto guardado en cada marcador: el zoom no vuelve a pedir datos.
- **Las celdas pueden ser RECTANGULARES**: la rejilla ASCII declara
  `cellsize` solo si son cuadradas; si no, `dx` y `dy` por separado.
  Exigir `cellsize` hacía descartar entera la respuesta del MDT, que al
  pedir una ventana cuadrada en metros devuelve 5x4 celdas frente a las
  4x4 del MDS. Todo el recorrido usa `cellX`/`cellY`.
- **Las dos mallas se emparejan por POSICIÓN, no por índice**: MDT y MDS
  pueden no empezar en el mismo punto y comparar celda con celda por su
  número daría diferencias falsas.
- **Sin esquina la rejilla no se dibuja pero sí se lee**: se marca
  `located: false` en vez de descartarla, porque los valores siguen
  siendo válidos para el cuadro de coordenadas.
- **Mientras se consulta se escribe «Consultando…»**, no el valor
  anterior: un número viejo junto a unas coordenadas nuevas se lee como
  si fuera de ese punto. Cada fila lleva además el prefijo del modelo
  (MDT/MDS) porque son fuentes distintas.
- **Altura de superficie (MDS)**: el MDS —terreno más edificios y
  vegetación— **no** se publica como teselas XYZ, solo como **WCS 2.0**
  (`wcs-mds.idee.es/mds`). Eso obliga a un diseño distinto del MDT: una
  petición por punto en vez de una tesela que sirve para toda una
  comarca, así que se consulta solo cuando el cursor se para
  (`MDS_SETTLE_MS`) y se cachea por celdas de `MDS_CELL` metros.
- **Nada del WCS se da por sabido** (`mdsDiscover` +
  `parseMdsCoverage`): del GetCapabilities sale el identificador de
  cobertura y del DescribeCoverage el CRS, los nombres de los ejes y la
  extensión válida. Tres trampas comprobadas contra el servicio real:
  `axisLabels` es un ATRIBUTO del `<Envelope>`, no un elemento; **el eje
  se identifica por su nombre, nunca por su orden** (este servicio los
  declara `x y`, o sea este primero, al revés de la convención GML `N E`,
  y suponerlo produjo un `ExtentError`); y WCS exige repetir la clave
  `subset` una vez por eje, cosa que un objeto plano no permite.
- **El formato de salida también se descubre** (`formatSupported` del
  GetCapabilities + `pickMdsFormat`): suponer `text/plain` produjo un
  `InvalidParameterValue`. El servicio del IGN publica su rejilla ASCII
  como **`ArcGrid`** y **`application/asc`**, nombres que no se parecen a
  ninguna convención esperable, de ahí que se busque por patrón contra
  una lista de variantes y no por igualdad. Si solo ofreciera formatos
  binarios se dice claramente en vez de pedir a ciegas. Regla general de esta integración: **de un servicio ajeno no se
  supone nada; se lee de sus capacidades.**
- **Los errores OGC viajan en el CUERPO aunque el HTTP sea 400**:
  `mdsFetch` lee el cuerpo siempre y lanza el texto de la excepción, con
  su `exceptionCode` adjunto. Quedarse en el código HTTP tiraba justo el
  dato que sirve para arreglar la petición.
- **Se elige la cobertura ABSOLUTA** (`pickMdsCoverage`): el servicio
  publica `mds05` junto a `mdsn_e025` y `mdsn_v025`, que son
  *normalizadas* y dan la altura de edificios o vegetación **sobre el
  suelo**, no la altitud. Quedarse con la primera de la lista sin mirar
  habría producido una diferencia con el MDT sin ningún sentido.
- **Se pide en EPSG:3857 (Web Mercator) siempre que se pueda**, que es
  la proyección en la que dibuja el visor: así lo consultado está en el
  mismo sistema que lo que se ve. La conversión la hace Leaflet con su
  propia proyección (`map.options.crs.project`), no cálculos nuestros.
  **La ventana hay que corregirla por latitud** (`webMercatorHalf`): Web
  Mercator estira la escala con el coseno de la latitud, y sin corregir
  se pediría un recorte demasiado pequeño en el norte peninsular.
- Si el servicio no ofreciera 3857, o rechazara la petición, se cae a
  las geográficas y luego a las coordenadas nativas, recordando el
  descarte para no repetirlo. Salir de la cobertura NO cuenta como
  rechazo.
- **Se pedía en latitud/longitud siempre que se pueda** (ahora respaldo): si el servicio
  declara un CRS geográfico (`crsSupported` → `pickGeoCrs`), la consulta
  va con `subsettingCrs` y ejes `Lat`/`Long`, sin transformar nada por
  nuestra cuenta; así desaparece toda una clase de errores de conversión.
  Si el servidor rechazara esa forma se pasa a las coordenadas nativas
  **una sola vez** (`cfg.useGeo = false`) y se avisa. Quedar fuera de
  cobertura NO cuenta como rechazo: es una respuesta legítima.
- **El MDS está en un solo huso** (el 30 extendido para toda España), no
  en el huso local de cada punto: `latLngToUtm` admite `forceZone` y se
  usa el que declare el EPSG de la cobertura. En Barcelona la diferencia
  entre el huso 31 y el 30 es de medio millón de metros, así que usar el
  local pedía un punto que no existía.
- **Los errores OGC llegan como XML con HTTP 200**: `parseOwsException`
  los reconoce; sin eso, un `ExtentError` se leía como «sin datos». Salir
  del área cubierta no se reporta como error, solo se muestra que no hay
  dato.
- **Se comprueba la extensión antes de pedir**: ahorra una petición
  condenada a fallar y permite decir «fuera de cobertura» al instante.
- **CSP**: los navegadores piden los *sourcemaps* de las librerías por
  `connect-src`, así que unpkg y cdnjs deben figurar también ahí, y
  `frame-ancestors` no se pone en el `<meta>` porque solo vale como
  cabecera HTTP y Chrome avisa de que lo ignora.
- **Disciplina de peticiones al MDT**: teselas cacheadas con tope
  (`DEM_CACHE_MAX`, se descarta lo más antiguo), muestreo del ratón con
  retardo (`DEM_SAMPLE_MS`), tope de peticiones por segundo
  (`DEM_MAX_RPS`, ventana deslizante), peticiones en vuelo compartidas
  (`demPending`) y teselas fallidas recordadas para no insistir. El
  estado se avisa en el panel agrupado por rachas (`DEM_STATUS_QUIET`):
  moviendo el ratón se piden muchas teselas y un aviso por cada una
  inundaría la ventana. Cualquier consulta externa nueva debe seguir el
  mismo patrón.
- **Distinción de tres estados**: `undefined` = aplazada por el tope,
  `null` = no hay cobertura, y un valor = dato bueno. Un píxel
  transparente o una altura imposible se muestran como «sin datos», no
  como un número inventado.
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

- ~~SRI en las dependencias de CDN~~: **hecho**. Ver la sección
  «Dependencias externas».
- **Antimeridiano completo**: el punto medio y las mediciones ya lo
  cruzan bien; el encuadre automático y las líneas de la retícula todavía
  no representan geometrías que cruzan ±180°.
- **Navegación completa del árbol con teclado** (flechas sin Shift para
  moverse y desplegar, Enter para activar) y monitorización de memoria y
  cuota de almacenamiento.

## Dependencias externas

- Los tres archivos de librería llevan `integrity` (SRI) y
  `crossorigin`: Leaflet 1.9.4 (CSS y JS, desde unpkg) y JSZip 3.10.1
  (desde cdnjs). El navegador verifica el hash antes de aplicar o
  ejecutar el archivo, de modo que un CDN comprometido no puede colar
  otro contenido.
- **Al subir la versión de una librería hay que sustituir su hash**, o el
  navegador la bloqueará y la aplicación no arrancará. Se obtienen de la
  documentación de Leaflet y del botón de copiar de cdnjs, o con
  `curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`.
- SRI introduce una forma nueva de fallar, así que el script empieza
  comprobando que Leaflet existe y, si no, muestra un aviso explicando
  qué mirar en vez de dejar una página en blanco. Ese guardián debe ir
  **lo primero del script**, antes de cualquier uso de `L`.
- Lo que NO puede llevar SRI: las teselas y los iconos PNG (los `<img>`
  no lo admiten) y las respuestas de las APIs REST (Iconify, Nominatim,
  IGN), que son datos, no código.

## Mapas base

- **Se pueden reordenar** con las flechas de cada fila: el orden del Map
  `baseState` ES el de apilado y los `zIndex` se recalculan al moverlas.
  El orden se guarda junto a las opacidades, ignorando al leerlo los
  identificadores que ya no existan y añadiendo al final los nuevos.
- **No inventar capas**: la capa «Relieve» del WMTS del IGN devolvía 404
  en todas las teselas porque ese servicio no publica ese nombre. Se
  sustituyó por el sombreado mundial de Esri, del mismo servidor que la
  capa física, que sí existe. Cualquier capa nueva debe verificarse
  contra el servicio antes de darla por buena.
- **`maxZoom` va también en el mapa**, no solo en cada capa: sin él
  `getMaxZoom()` devuelve `Infinity` cuando no hay ninguna capa base
  activa, y eso salía escrito en el cuadro de coordenadas y rompía la
  escalera de zoom del doble clic.

- Son **independientes**: se encienden a la vez, en cualquier
  combinación, cada uno con su opacidad. `BASE_LAYERS` es la lista y su
  orden es el de apilado (el primero, al fondo); las capas se crean
  perezosamente al encenderlas.
- La configuración (encendidas y opacidades) se guarda en el mismo
  almacén bajo la clave `bases`, con su propio `BASE_SCHEMA`, y al leerla
  se descartan las capas que ya no existan y los valores fuera de rango.
- Una capa cuya URL no responda se marca en rojo en el panel tras varios
  errores de tesela, en vez de quedarse en blanco sin explicación. Las de
  IGN Base, MTN y Relieve usan las URL WMTS del IGN: si alguna cambiara,
  el aviso es lo que lo delata.

## Deshacer y rehacer

- `pushUndo(etiqueta)` guarda una instantánea del árbol antes de cada
  operación destructiva (borrar, pegar, mover arrastrando, ordenar).
  Es viable porque serializar es barato desde que la geometría se cachea
  y porque las instantáneas **comparten** esa geometría en vez de
  clonarla: lo que ocupan es la estructura.
- Toda operación nueva que destruya o reordene debe llamar a `pushUndo`
  ANTES de tocar nada.
- Ctrl+Y rehace: `undoLast` guarda el presente en `redoStack` antes de
  retroceder. Una acción nueva vacía esa pila, porque la historia se
  bifurca y lo rehacible deja de tener sentido.

## Arrastrar y soltar

- Las franjas de destino van en **píxeles**, no en porcentaje: con filas
  de 24 px, un porcentaje dejaba bordes de 4 px imposibles de acertar.
  Seis píxeles arriba y abajo reordenan entre hermanos; el resto de una
  carpeta mete dentro.
- La marca de destino la lleva **una sola fila** (`dropMarked`). Barrer
  el árbol con `querySelectorAll` en cada `dragover` —que se dispara
  decenas de veces por segundo— hacía que arrastrar fuera a tirones.

## Ficha del elemento

- La `<description>` del KML se guarda en `li._desc` y se serializa; el
  botón ℹ la muestra en un diálogo. **Se pasa a `makeNode` como opción**,
  no se asigna después: los botones se crean dentro de `makeNode`, así
  que asignarla luego dejaba el botón sin aparecer nunca.
- Es HTML de un archivo AJENO, así que se sanea con lista blanca
  (`sanitizeHtml`): los elementos peligrosos se tiran **enteros**
  (`DESC_DROP`), a los desconocidos se les quita la etiqueta pero se
  conserva el texto —que suele ser el dato—, y se eliminan todos los
  atributos `on*` y las URL que no sean http(s).

## Vista guardada

- El centro y el zoom se guardan en el MISMO almacén que el árbol, bajo
  la clave `view`: es otra clave, no otro almacén, así que no toca subir
  `DB_VERSION`. Lleva su propia versión de formato (`VIEW_SCHEMA`) porque
  su contenido no tiene nada que ver con el del árbol.
- Se guarda con retardo tras `moveend`/`zoomend`, nunca durante el gesto,
  y no se guarda nada hasta haber restaurado (`viewRestoring`), o la
  vista por defecto pisaría a la guardada en el arranque.
- Al arrancar se restaura ANTES que el árbol: el mapa aparece donde se
  dejó mientras la reconstrucción, que puede tardar, ocurre por detrás.
- Lo leído se valida (`validView`) antes de mover el mapa: un registro
  corrupto dejaría la vista en un sitio del que el usuario no sabe salir.
  Se usa `Number.isFinite`, que no convierte, para que un `"12"` guardado
  por error no se cuele como número.
- Descartar un árbol de otra versión borra **solo** la clave `root`, no
  el almacén entero: la vista es independiente y sigue siendo válida.

## Comprobaciones estáticas del propio archivo

Además de los tests, conviene pasar sobre `visor-kml.html`:
- que todo recurso de librería lleve `integrity` y `crossorigin`;
- que el guardián de Leaflet preceda a cualquier uso de `L`;
- que haya UNA sola constante `BUILD` y con el valor esperado;
- que todo `getElementById`/`$id` apunte a un `id` existente;
- **que toda función llamada esté declarada**: un refactor puede
  llevarse por delante ayudantes que siguen en uso y `node --check` no lo
  detecta, porque sigue siendo sintácticamente válido.

## Zoom por encima de las teselas

`maxZoom` es 25 en el mapa y cada capa declara su `maxNativeZoom` (19
normalmente, 9 en la física de Esri). Por encima de su último nivel
publicado, Leaflet **escala** la última tesela recibida en vez de pedir
niveles que no existen: la cartografía se ve borrosa, pero la cuadrícula
de elevaciones —celdas de 5 m— se puede leer.

La escalera del doble clic se corta en `ZOOM_LADDER_TOP` (19): más allá
solo se amplía la imagen, y no es a donde se quiere ir de un doble clic.

## Cuadro de coordenadas y atribución

La línea inferior del visor queda **solo** para la atribución de
Leaflet, que crece cada vez que se activa un mapa base o el modo altura.
El cuadro de coordenadas vive siempre por encima de ella
(`margin-bottom`), y por eso **no lleva ancho máximo**: limitarlo cortaba
la línea de la diferencia entre superficie y terreno, que es larga. La
atribución se mantiene en una sola línea con elipsis si no cabe.

## Rendimiento (reglas nacidas de medir)

- **El mapa se dibuja en lienzo** (`preferCanvas: true`). Con miles de
  geometrías, el renderizador SVG crea decenas de miles de nodos DOM y el
  zoom y el pan se arrastran.
- **La geometría serializada se cachea por nodo** (`li._geo`).
  `toGeoJSON()` clona todas las coordenadas de la capa, y como se guarda
  tras CUALQUIER cambio del panel, renombrar un nodo reconstruía el
  archivo entero: 349 ms por guardado con 8.000 capas, frente a 5 ms
  ahora. Solo se invalida donde cambia la geometría de verdad (mover un
  marcador), vía `invalidateGeo`. Si se añade otra forma de alterar
  geometrías, hay que invalidar ahí también.
- **El retardo del guardado se ajusta solo** al coste medido del último
  (`saveCost`, entre `SAVE_MIN_MS` y `SAVE_MAX_MS`): en un árbol pequeño
  guarda casi al instante y en uno enorme no repite un trabajo caro
  mientras el usuario sigue trabajando.
- **La lectura de coordenadas se pinta una vez por fotograma**
  (`requestAnimationFrame`), no una por evento de ratón: cada lectura
  proyecta a UTM y reescribe varias filas, y llegan más de 100 eventos por
  segundo. Se pinta siempre la última posición, nunca una atrasada.
- **Moverse por el árbol cuesta O(profundidad)**, ver la sección del
  teclado. Ninguna operación de selección puede recorrer la selección
  entera ni consultar el árbol por nodo.
- Regla general: antes de optimizar, medir; y dejar la medida escrita en
  el comentario, que es lo que impide que alguien "simplifique" la
  optimización sin saber lo que costaba.

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
   ejecutando. Sin excepciones. Y **comprobar que la sustitución ha
   surtido efecto**: editar por el valor anterior falla en silencio si no
   es el que se creía, y la versión se queda congelada sin que nadie lo
   note. Sustituir por patrón (`const BUILD = "\d{12}"`) y verificar.
8. `node --check` del script; test en Node de la lógica pura; `grep` de
   referencias muertas de lo que se haya retirado.
9. Cuidado con el ORDEN de las secciones: una variable que se asigna
   dentro del `onAdd` de un control debe declararse antes que ese
   control, o al añadirlo se cae por zona muerta temporal. `node --check`
   no lo detecta.
