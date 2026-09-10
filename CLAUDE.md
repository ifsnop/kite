# claude.md — Guía de desarrollo de KITE Local

**KITE Local** = *KML Interactive Tree Explorer*.

Instrucciones para seguir añadiendo funcionalidades a `kitelocal.html`
(el producto es KITE Local; el archivo se llamó `kitelocal.html` en
versiones anteriores) manteniendo los principios acordados durante el
desarrollo del proyecto.

## Principios de base (no negociables)

1. **Un único archivo HTML como PRODUCTO; las fuentes, repartidas.**
   Lo que se distribuye es `kitelocal.html`: HTML + CSS + JavaScript
   plano, un solo archivo que se abre directamente en el navegador con
   doble clic. Eso no se negocia. Pero **ese archivo es GENERADO**: se
   edita `src/` y se construye con `npm run build` (ver `build.js` y la
   sección «Fuentes y construcción»). Nada de Vue, React, TypeScript ni
   empaquetadores: el build es una concatenación literal, sin
   minificar, sin envolver y sin transformar nada.
   **Nunca se edita `kitelocal.html` a mano**: el cambio se perdería en
   la siguiente construcción. `node tests/run-all.js` lo comprueba antes
   de nada y falla si el archivo no corresponde a `src/`.
2. **Reusar librerías conocidas y estables; no reinventar.** Se cargan por
   CDN (unpkg / cdnjs) con versión fijada. Las actuales:
   - **Leaflet 1.9.4** — mapa, zoom, pan, controles, capas, tooltips.
   - **JSZip 3.10.1** — descompresión de KMZ.
   - **Material Design Icons — EMPOTRADOS, sin red en ejecución.** Los
     cuerpos SVG viven en `src/js/05-mdi-icons.js` (`MDI_ICON_BODIES`),
     un archivo GENERADO por `fetch-icons.js` (`npm run icons`) desde la
     API en bloque de Iconify. Ese script es la ÚNICA parte del proyecto
     que habla con Iconify, corre a mano y **no forma parte del build**:
     construir tiene que ser reproducible y sin red. Ver «Iconos de
     marcador» más abajo para el porqué (medido) y para cómo ampliar el
     catálogo. Excepción: `leaflet-pin` (gota de Leaflet) es el PNG de la
     propia distribución de Leaflet, no es un SVG de MDI y no es
     coloreable.
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
   **Toda modificación, por pequeña que sea, termina con
   `node tests/run-all.js` completo** (no una suite suelta): es lo único
   que confirma que el resto del comportamiento sigue intacto. Los tests
   se mantienen junto al código, no al margen de él: si un cambio altera
   comportamiento cubierto, la suite correspondiente se actualiza en el
   mismo cambio; si añade comportamiento nuevo o no cubierto, se añade su
   test (nueva suite en `tests/` si no encaja en ninguna existente,
   registrada en `run-all.js` y descrita en `tests/README.md`). Una
   funcionalidad no se da por terminada con la suite en rojo ni con una
   suite que ya no prueba lo que dice probar.

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
- **La altitud se conserva**: `clampLatLng(lat, lon, alt)` la transporta
  y `parseCoords` le pasa el tercer campo del KML. Antes ese campo se
  partía del texto y **no se leía nunca**, así que la altitud se perdía
  al importar KML mientras que la del GeoJSON sí sobrevivía (allí
  `validGeometry` valida con `pos.length < 2` y solo reescribe los dos
  primeros). La altitud **solo se añade si es finita**: sin ella la
  posición sigue teniendo dos elementos, para no inventar un `0` que
  nadie escribió. El resto del camino ya era transparente: Leaflet la
  lleva en `latlng.alt` y `toGeoJSON` la reemite.
  Sigue pendiente: `findDuplicatePlacemarks` compara solo latitud y
  longitud, así que dos placemarks a distinta altura se siguen tratando
  como duplicados.
- En GeoJSON la validación **normaliza sobre el propio objeto**, de modo
  que lo que se dibuja y se guarda ya está dentro de rango sin recorrer
  la geometría dos veces. GeoJSON pasa
  además por `validGeometry` (tipo conocido, anidamiento correcto, anillos
  de al menos cuatro posiciones, líneas de al menos dos).
- **Nombre de cada elemento de GeoJSON**: `resolveFeatureName` usa
  `properties.name`, si no `properties.title`, si no «Elemento N». Un
  archivo es **ambiguo** (`needsNamePicker`) cuando su primer Feature
  trae `properties` con alguna clave pero ni `name` ni `title`: solo
  entonces `pickNameProperty` muestra un diálogo con las claves y
  valores de ese primer objeto (se asume que el resto comparten forma)
  para elegir cuál usar. La elección se guarda en IndexedDB indexada por
  `propsFingerprint` (la forma de `properties`, no sus valores), así que
  un archivo futuro con esa misma forma —esta sesión o en otra— no
  vuelve a preguntar; dentro de la sesión actual, la primera vez que se
  fuera a aplicar una asociación ya guardada el diálogo se muestra
  igualmente para confirmarla (preseleccionada), y a partir de ahí el
  resto de archivos con esa forma en la misma sesión ya no preguntan.
  Cancelar (o Escape) no guarda nada y usa el nombrado automático de
  siempre para ese archivo. El botón 🏷️ de la cabecera abre un editor
  de las asociaciones guardadas (ver, cambiar con un `<select>` —las
  claves posibles ya están en la propia huella, no hace falta
  guardarlas aparte— y borrar, una por una o todas), con aplicación
  inmediata: es una lista de configuración, no una capa viva en el
  mapa, así que no sigue el patrón de borrador con Cancelar/Aceptar.
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
- **Solo hay DOS niveles de aviso, y no se añade un tercero**:
  `info` es una **notificación** (algo ha ocurrido o ha salido bien: una
  descarga terminada, una selección, un dato recibido) y se pinta en el
  color normal del texto —no en gris, que es el color de lo secundario y
  hacía que un aviso perfectamente vigente se leyera como
  deshabilitado—; `error` es una **alerta** (algo ha fallado, falta o no
  se puede hacer) y va en rojo. Es el tono por defecto a propósito: si
  se olvida, un fallo nunca pasa por notificación. «Exige lectura» no es
  un nivel: eso es `sticky`, ortogonal al tono. Al escribir un aviso
  nuevo, la pregunta es solo «¿esto es algo que ha fallado?»; confirmar
  lo que el usuario acaba de pedir (`Descargado «…»`) no lo es.
- **Un aviso repetido no añade línea: la funde y cuenta.** Se funde con
  una línea que **siga visible** y tenga el mismo texto y tono
  (`line._msgKey`); se incrementa el contador (`×3`), se **reinicia su
  temporizador** —mientras siga ocurriendo, sigue a la vista— y **no se
  mueve de sitio**, porque reordenar haría saltar el texto bajo el
  cursor. Sin esto, una capa base con conexión intermitente llenaba el
  panel de líneas idénticas. Buscar recorriendo las líneas (como mucho
  `MSG_MAX_LINES`) evita tener que escapar el texto para un selector.
- **Cada aviso lleva fecha y hora completas** (`msgStamp`,
  `2026-09-08 13:02:11`). En una línea fundida el panel muestra la marca
  de la **última** repetición: es una vista en vivo y ahí «cuándo se
  produjo» significa cuándo ha vuelto a pasar; el registro guarda la
  primera y la última. Ojo al relleno con ceros, que ya falló una vez en
  otra marca de tiempo (`pngTimestamp`).
- **Registro de la sesión** (`msgLog`, tope `MSG_LOG_MAX`): un aviso
  transitorio desaparecía a los `MSG_TIMEOUT` sin dejar rastro, así que
  el que no daba tiempo a leer se perdía. Ahora todos —los que se
  ocultan solos y los `sticky`— quedan consultables desde el botón 📋 de
  la cabecera del panel, que muestra un punto cuando hay entradas sin
  ver. **Solo en memoria**: no se guarda en IndexedDB y se pierde al
  cerrar la página. El diálogo lista en **orden cronológico, lo más
  reciente abajo**, como un fichero de log y como el propio panel, y por
  eso al abrirlo **baja el scroll del todo**. `logText()` serializa lo
  mismo para el portapapeles.
- **La ventana del registro se redimensiona** con `resize: both`, el
  mismo recurso nativo que el editor de puntos. Las medidas van en la
  LISTA, no en la caja, para que al agrandarla crezca el diálogo con
  ella, y explícitas porque `resize` necesita una base de la que partir.
  El tirador de la esquina no estorba al arrastre por el `<h2>`.
  **Trampa medida**: el párrafo de ayuda prefiere ir en una línea
  (764 px) y con eso fijaba el ancho mínimo del diálogo, de modo que
  estrechar la lista no estrechaba la ventana. Se neutraliza con
  `width: 0; min-width: 100%`, que le quita el ancho preferido sin
  quitarle el ancho real.
- `msgLog` y `navMessage` viven juntos en `30-tree-walk.js` porque hay
  un aviso a nivel de módulo justo debajo (el de aceleración por
  hardware). Por eso `refreshLogButton`, que está en un archivo
  posterior, busca su botón con `getElementById` en cada llamada y no
  con una `const` de módulo, que estaría en zona muerta temporal en ese
  momento.
- **Los cuatro frenos ad hoc siguen ahí** (`ELEV_STATUS_QUIET`,
  `savePending`, `elevAccumCapped`, `updateNoticeShown`). La fusión los
  hace menos necesarios, pero el de `demStatus` cumple otra función
  —limitar una fuente de altísima frecuencia, el ratón sobre el MDT— y
  quitarlo dejaría esa línea viva indefinidamente reiniciando su
  temporizador.
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
- **Nodo**: cualquier fila del árbol — archivo, carpeta, capa, medición o
  cuadrícula de elevación.
- **Tipo de nodo (`styleKind`)**: clasificación usada por los estilos y la
  selección múltiple: `marker` (contiene marcadores), `polygon` (contiene
  trazos: polígonos/líneas; los mixtos cuentan como `marker`), `measure`
  (medición), `elevGrid` (cuadrícula de elevación acumulada), `group`
  (carpeta/archivo).

## Fuentes y construcción

```
src/index.html     plantilla: <head>, CSP, diálogos, <script> de CDN.
                   Dos marcadores: {{STYLES}} y {{SCRIPTS}}
src/styles.css     todo el CSS
src/js/*.js        20 archivos, en el orden del manifiesto de build.js
                   (el primero, 05-mdi-icons.js, es GENERADO)
build.js           concatena src/ → kitelocal.html
fetch-icons.js     GENERA src/js/05-mdi-icons.js (npm run icons). A mano,
                   NO forma parte del build: es lo único que habla con
                   Iconify y construir debe ser reproducible y sin red
kitelocal.html     GENERADO. Es el producto; se versiona (quien clone
                   debe tener algo que abrir) y está marcado como
                   generado en .gitattributes para que los diffs se
                   plieguen y no tapen el cambio real en src/
```

- `npm run build` construye, `npm run watch` reconstruye al guardar
  (quita casi toda la fricción del paso de build), `npm run check`
  comprueba sin escribir y `npm test` lanza la batería.
- **`kitelocal.html` SÍ se versiona**, aunque sea generado, porque es el
  producto: quien clone el repositorio —o descargue el archivo por su
  enlace directo en GitHub— tiene que obtener algo que funcione sin
  instalar Node ni construir nada. La objeción clásica a versionar
  artefactos (que se desincronicen) la cierra la comprobación de
  frescura, que corre en local y en CI.
- **Si `kitelocal.html` da conflicto al fusionar, no se resuelve a
  mano**: se resuelven los conflictos de `src/`, se ejecuta
  `npm run build` y se añade el resultado. El archivo generado no es
  una fuente que merezca un merge, y está marcado `-diff` en
  `.gitattributes` justamente porque su contenido no se lee.
- **El CI (`.github/workflows/tests.yml`) comprueba, no construye**: un
  paso propio (`npm run check`) para que el fallo se lea en el nombre
  del paso, y luego `npm test`, que vuelve a comprobarlo por su cuenta.
  Si el CI reconstruyera, un push con `src/` cambiado y el archivo sin
  regenerar pasaría en verde y se publicaría la versión anterior.
- **El orden del manifiesto (`JS` en `build.js`) es carga útil, no
  cosmética.** Todo comparte un único ámbito de nivel superior y hay
  dependencias de orden que ningún `node --check` detecta (ver el punto
  10 del checklist). Antes ese contrato solo existía como «está más
  arriba en el scroll»; ahora se lee y se revisa en el diff. Mover un
  archivo de sitio es un cambio de comportamiento potencial.
- `build.js` **valida el manifiesto en los dos sentidos**: un archivo
  suelto en `src/js` que nadie declare se perdería en silencio, y un
  nombre declarado que no exista aborta la construcción.
- **Por qué concatenación y no módulos**: Chrome bloquea
  `<script type="module">` sobre `file://` por CORS, y el producto tiene
  que abrirse con doble clic. Tampoco se envuelve en un IIFE: el código
  comparte ámbito global y las pruebas de navegador acceden a esos
  símbolos directamente.
- **Cuidado con `String.replace` al insertar el contenido**: con una
  cadena de reemplazo, los `$&`, `$1`, `$'`… del texto insertado se
  interpretan como patrones. El propio código tiene un
  `.replace(/…/g, "\\$&")` y salía corrompido. Por eso `build.js` usa
  una **función** de reemplazo. Lo cazó la comprobación de identidad
  byte a byte.
- **El criterio de cualquier reorganización de `src/` es la identidad
  byte a byte**: si mover código no cambia ni un byte de
  `kitelocal.html`, no hay cambio de comportamiento que discutir. Es la
  red que se usó para el reparto inicial y la que hay que usar al
  volver a partir un archivo grande.

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

- **«No hay capas cargadas» es una CONCLUSIÓN, y hasta leer IndexedDB no
  se puede sacar.** El panel arranca en «Inicializando…»
  (`showLoadingMessage`, a nivel de módulo en `30-tree-walk.js`) y es
  `99-boot.js`, ya con `dbLoadTree()` resuelto, quien decide si de
  verdad no hay nada. Antes el aviso de vacío se pintaba de entrada y
  se quedaba ahí durante toda la restauración, **contradiciendo a la
  barra de progreso**, que a la vez decía «Restaurando capas…»: el
  usuario veía las dos cosas al recargar. Los dos textos salen de
  `showTreePlaceholder`, que escribe por `textContent` y deja `rootUl`
  a null.
- **El arranque concluye mirando `rootUl`, no `nodes`**
  (`if (!rootUl) showEmptyMessage();`): leer IndexedDB es asíncrono y el
  usuario puede soltar un archivo mientras tanto; para entonces
  `ensureRootUl` ya sustituyó el aviso, y volver a pintarlo dejaría esa
  importación colgando de un `<ul>` desconectado del documento.

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
- **El texto de una fila NO siempre es su nombre**: una medición muestra
  «Nombre — 85,18 km / 46,0 NM · 89,7°», y ese texto lo repinta
  `updateMeasurement` desde `_onRename`. Por eso `startRename` devuelve
  la etiqueta **tal cual estaba** en vez de reescribirla con `li._name`:
  hacerlo borraba la medida, y se veía justo cuando el nombre no
  cambiaba (o al cancelar con Escape), porque entonces `setNodeName`
  sale antes de llamar a `_onRename` y ya no había quien la repintara.
  Cualquier fila nueva cuyo texto no sea el nombre a secas depende de
  esto.
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
  de polígonos: ancho y color del contorno, un selector "Contorno y
  relleno" / "Solo contorno" / "Solo relleno" (`pg-mode`), y color y
  opacidad del relleno. Es un selector de tres opciones, no dos casillas
  independientes, porque "ni contorno ni relleno" no es una combinación
  que tenga sentido ofrecer.
- **Las mediciones SÍ tienen diálogo de estilos** (antes iban con
  `styleable: false` y un color fijo por tipo). Una medición es un trazo
  más: su estilo se guarda en `li._style`, se aplica con el mismo
  `applyPolygonStyle` que un polígono y se serializa con el nodo
  (`TREE_SCHEMA` 6). El diálogo (`#style-measure`) ofrece ancho y color
  del trazo, color y opacidad del relleno, y las **medidas en solo
  lectura**, como el perímetro y el área de un polígono: una línea da
  **distancia y rumbo**; un círculo, **radio y área**, con el mismo
  selector de unidad y la misma preferencia única (`measureUnit`) que el
  diálogo de polígonos y que las etiquetas del visor — ver «Una sola
  unidad de medida» más abajo.
- **El relleno de una medición es cosa del círculo**: una línea no
  encierra ninguna superficie, así que sus dos controles de relleno se
  **deshabilitan, no se esconden** (mismo criterio que las formas
  abiertas), y con una selección que mezcle líneas y círculos manda el
  caso restrictivo. La decisión se repite **por capa** al aceptar
  (`fill: t._measure.type === "circle" && …`) además de en el diálogo,
  por la misma razón que `clearFillOnOpenPaths`: la selección puede ser
  mixta y un trazo abierto relleno obliga a Leaflet a cerrarlo por su
  cuenta.
- **El guion de la línea de medición (`MEASURE_DASH`) no es estilo
  editable**: es lo que la distingue de una línea dibujada a mano.
  Sobrevive a `setStyle` porque Leaflet fusiona opciones en vez de
  reemplazarlas.
- **El área de un círculo es la del casquete esférico** (`capArea`,
  2πR²(1−cos r/R)), no πr². Para un círculo de metros coinciden, pero
  uno de decenas de kilómetros ya se separa y el resto del proyecto mide
  sobre la misma esfera (`EARTH_R`).
- **Los valores por defecto del diálogo caen en la rejilla de sus
  controles**: la opacidad de relleno del círculo es 0,10 y no 0,08
  porque `#ms-fill-opacity` va a pasos de 0,05 y el navegador redondea
  al asignar, de modo que abrir el diálogo y aceptar sin tocar nada
  cambiaba la opacidad por su cuenta. Al añadir un control numérico
  nuevo, comprobar que su valor por defecto es asignable tal cual.
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
- **Contorno y relleno sí/no son booleanos aparte de la opacidad**
  (`style.stroke` / `style.fill`, ambos con valor por defecto `true` vía
  `normalizePathStyle`): que un trazo se dibuje o no es independiente de
  que su opacidad sea siempre 100%. `<outline>0</outline>` y
  `<fill>0</fill>` de KML, y `stroke-opacity`/`fill-opacity` a `0` en
  simplestyle, se traducen a estos booleanos en la importación
  (`parseStyleElement`, `geojsonStyle`). El diálogo los presenta como un
  único selector de tres opciones (`pg-mode`: contorno y relleno / solo
  contorno / solo relleno) en vez de dos casillas independientes, para
  que no se pueda pedir un polígono sin ninguno de los dos;
  `polygonModeOf` hace la traducción de los dos booleanos al selector y
  viceversa. El renderizado usa el `stroke: false` nativo de Leaflet
  (omite el trazo por completo), no un truco de igualar color y opacidad
  del contorno con los del relleno.
- **Un contorno de grosor 0 también es "sin contorno"**: un `lineWidth`
  de 0 en canvas no deja de dibujar (la especificación ignora el valor y
  conserva el anterior), así que un `<width>0</width>` de KML o un
  `stroke-width: 0` de simplestyle no bastan por sí solos para ocultar el
  trazo. `parseStyleElement`/`geojsonStyle` los traducen también a
  `style.stroke = false`, no solo a `weight: 0`. El diálogo no puede
  producir este caso (`pg-weight` tiene `min="0.5"`): solo se da al
  importar.
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

### Iconos de marcador: por qué van EMPOTRADOS

- **Ningún icono se pide por red en ejecución.** `MDI_ICON_BODIES`
  (`src/js/05-mdi-icons.js`) trae los cuerpos SVG dentro del propio
  archivo; `mdiSvg(name, color?, size?)` los envuelve en un `<svg>`.
  Sin `color` deja el `currentColor` con el que vienen dibujados —lo
  tiñe el CSS de `.mdi-pin` en el mapa—; con `color` lo sustituye,
  porque una vista previa suelta en un `<img>` no hereda ningún CSS del
  que sacarlo. `iconUrl` devuelve un `data:` URI construido ahí mismo.
- **El motivo es medido, no estético.** Antes cada vista previa era un
  `<img>` contra `api.iconify.design`: abrir el selector costaba **79
  peticiones simultáneas**, y aplicar un icono a un marcador costaba
  otra más — con una URL DISTINTA (`?color=&height=` frente a la
  desnuda), así que ni siquiera compartían caché de HTTP. Pasado el
  límite del servicio, la respuesta era `429 text/plain` y se
  disfrazaba de dos maneras que no decían la verdad: en el `<img>`,
  Chrome la bloquea (`ERR_BLOCKED_BY_ORB`) y deja un **cuadro en blanco
  sin ningún aviso**; en el `fetch`, el 429 no lleva cabeceras CORS y
  llega como `TypeError: Failed to fetch`, de modo que `describeHttp`
  —que sí sabía decir «el servicio ha limitado las consultas»— nunca
  llegaba a ejecutarse. Con `retry-after: 236` medido, eran minutos de
  iconos rotos, y cuáles caían dependía de dónde cortara el limitador:
  parecía que «habían quitado» unos iconos concretos. Comprobado
  aparte que **no faltaba ninguno**: los 79 existen en el set `mdi`.
- **Coste**: ~21 KB de datos de trazado. A cambio, con la red externa
  bloqueada del todo: 80/80 iconos pintados, rejilla construida en
  8,5 ms y `applyMarkerStyle` en 0,9 ms.
- **`applyMarkerStyle` es SÍNCRONA.** Al desaparecer la red desapareció
  con ella el contador de secuencia por nodo (`_mseq`) que descartaba
  aplicaciones obsoletas durante la edición en vivo, y el aviso de «no
  se pudo cargar el icono». No volver a hacerla asíncrona sin una razón
  nueva.
- **Un icono desconocido no deja el marcador invisible**: `mdiSvg`
  devuelve `null` y `buildMarkerIcon` cae en la gota de Leaflet. Es lo
  que salva a un árbol guardado con un catálogo distinto del actual.
- **Para ampliar el catálogo**: añadir el nombre a `MDI_ICONS`
  (`41-selection.js`, que es la lista que ve el usuario y no se
  duplica) y ejecutar `npm run icons`, que lee esa lista del propio
  fuente, pide los cuerpos en UNA sola petición y regenera
  `05-mdi-icons.js`. Si el nombre no existe en `mdi`, el script falla
  ahí mismo en vez de dejarlo romperse en ejecución.
  `tests/icons.js` comprueba **sin tocar la red** que catálogo y tabla
  no se han desincronizado (olvidar `npm run icons` es el fallo humano
  que queda), que los cuerpos son dibujables y que en el archivo
  entregado no queda ninguna mención a `api.iconify.design`.
- `src/js/05-mdi-icons.js` se versiona y va marcado como generado en
  `.gitattributes`, igual que `kitelocal.html`: su contenido no se lee
  y en un diff solo taparía el cambio real.
- **Las formas dibujadas, las mediciones y los pines se autonumeran**
  («Línea 3», «Polígono 2», «Círculo 1», «Marcador 4») con
  `nextNumberedName`, que
  deduce el número de **los nombres que ya hay en el árbol**, no de un
  contador en memoria. El contador no valdría: una línea o un polígono
  dibujados vuelven de IndexedDB por el camino genérico `t:"layer"`,
  que no sabe que los creó la herramienta, así que se reiniciaría en
  cada recarga y repetiría «Línea 1» — justo lo que esto evita. Las
  mediciones comparten el mecanismo (antes llevaban `measureCount`, ya
  retirado) para que una medición y una línea dibujada tampoco puedan
  llamarse igual: van por la misma serie. Manda el **máximo**, no la
  cuenta, así que borrar una no recicla su número mientras quede otra
  mayor. Se barre el árbol entero —los nodos se pueden mover a
  cualquier carpeta— incluidos los registros pendientes
  (`li._pending`) de las carpetas nunca desplegadas, que existen
  aunque no tengan fila. El pin del botón 📍 (`createPin`) entró tarde
  en esta regla: llevaba el nombre fijo «Marcador», así que veinte pines
  se llamaban todos igual y no había forma de distinguirlos en el árbol.
  Los marcadores del buscador de lugares NO se numeran: ya traen el
  nombre del lugar. `elevGridCount` sigue con contador propio
  porque `elevGrid` sí es un tipo de registro propio y lo
  resincroniza al restaurar.
- **Dibujar NO obliga a cerrar**: el doble click decide la forma. Sobre
  el último vértice **cierra** (`L.polygon`, mínimo 3 vértices); fuera de
  un vértice **termina abierta** (`L.polyline`, mínimo 2, el mismo umbral
  que una `<LineString>` importada). Lo decide `finishPolygon(closed)`,
  y **no hay una herramienta aparte**: hay nueve sitios acoplados al
  literal `activeTool === "polygon"` y decidir al terminar los evita
  todos. Una forma abierta ya clasifica como `styleKind "polygon"`
  (`L.Polyline` es `L.Path`) y se serializa sola como `LineString`, así
  que no tocó ni el diálogo ni la persistencia.
- **Cómo se distingue el doble click**: mirando si el PRIMER click del
  par añadió vértice (`prevClickAdded`/`lastClickAdded`). **No vale
  `e.target`**: comprobado en Chrome, el `dblclick` se despacha sobre el
  objetivo del SEGUNDO click, y en el caso «zona vacía» ese segundo
  click cae sobre el manejador que acaba de crear el primero, así que
  `e.target` es un `.measure-handle` en los dos casos.
- **La vista previa del dibujo es una polilínea**, no un polígono con
  relleno: la forma solo se cierra si el usuario termina sobre un
  vértice, y una previa rellena prometía un anillo que el gesto puede no
  producir.
- **Medidas de una forma abierta**: `polygonMeasures` recorre también las
  `L.Polyline` que no son `L.Polygon` y suma su longitud al perímetro,
  pero **sin tocar `allClosed`**, que habla solo de los anillos de los
  polígonos: un placemark KML puede traer un polígono y una línea juntos
  y el área del polígono sigue valiendo. Sin ningún polígono el área es
  `null` (no `0`, que anunciaría «0 m²» para una línea) y su fila se
  oculta sola. La medida devuelve además `open`, y con ella el diálogo
  escribe **«Longitud»** en vez de «Perímetro»: una línea no tiene
  perímetro, que es el contorno de una superficie cerrada.
- **Una forma abierta no puede tener relleno**. Rellenar un trazo
  abierto obliga a Leaflet a cerrarlo por su cuenta para pintar la
  superficie, dibujando un lado que el usuario nunca trazó. Se aplica en
  dos sitios y hacen falta los dos:
  - En el diálogo, cuando **todos** los nodos objetivo son abiertos
    (`isOpenOnly`), las opciones «Contorno y relleno» y «Solo relleno» y
    los dos controles de relleno se **deshabilitan, no se esconden**: en
    gris se ve que existen y que ahí no aplican, que explica más que
    hacerlas desaparecer. `pg-mode` queda además fijado en `stroke`,
    de modo que `readPolygonControls` no pueda devolver `fill: true`
    aunque algo se saltara la interfaz.
  - En la capa, `clearFillOnOpenPaths` quita el relleno a toda
    `L.Polyline` que no sea `L.Polygon`. Es imprescindible aparte del
    diálogo porque **un placemark KML comparte un mismo objeto de estilo
    entre todas sus geometrías**: con un polígono y una línea juntos, el
    polígono sí quiere relleno y la línea no debe recibirlo. Por eso se
    llama también al importar GeoJSON y al restaurar el árbol, que
    construyen capas sin pasar por `applyPolygonStyle`.
  - Ojo al orden de las comprobaciones: `L.Polygon` **extiende**
    `L.Polyline`, así que hay que preguntar por `Polygon` primero o un
    polígono contaría como línea y perdería su relleno y su área.
- **Editor de la lista de puntos** (botón «Ver y editar…» del diálogo de
  estilos, `#points-dialog`): texto con **un punto por línea y campos
  separados por tabulador**, con cabecera `Lat/Lon/Alt`, para poder
  copiarlo y pegarlo en una hoja de cálculo. Es un `<textarea>` y no una
  tabla de campos a propósito: con 1000 puntos una tabla serían 3000
  nodos del DOM, y aquí el scroll, la selección y el pegado son los
  nativos del navegador (medido: aplicar 1000 puntos, 24 ms). Al leer se
  toleran tabulador, coma, punto y coma o espacios, y se ignora la
  cabecera aunque venga repetida en medio (pegar dos veces). Los anillos
  y las partes van separados por una **línea en blanco**, exterior
  primero. Sigue la edición diferida: solo «Aceptar» toca la capa, y con
  líneas ilegibles **no cierra**, como las coordenadas del diálogo de
  estilos. Llama a `pushUndo` antes de tocar nada y a `invalidateGeo`
  después.
  **Límite deliberado**: cambia los vértices, no la naturaleza
  abierta/cerrada de la capa — eso exigiría sustituir el `L.Polygon` por
  un `L.Polyline` (y con él `chk._layer`, la pertenencia a `rootGroup` y
  los manejadores que ata `makeNode`). Para abrir una forma está la
  herramienta de dibujo.
- **Distancias y rumbos**: siempre geodésicos (esfera terrestre);
  rumbo 0° = norte, sentido horario. La etiqueta de una medición se
  coloca en el punto medio geodésico (`midPoint`, promedio cartesiano
  3D), que es correcto en arcos largos y al cruzar ±180°.
- **Una sola unidad de medida, elegida por el usuario** (`measureUnit`,
  m/km/ft/NM, **por defecto NM**, la unidad de trabajo en navegación
  aérea y marítima). Manda a la vez sobre el perímetro/área de un
  polígono, sobre las medidas de una medición y sobre las **etiquetas
  que la medición pinta en el visor y en su fila del árbol**. Antes esas
  etiquetas iban por su cuenta en métrico **y** náutico a la vez
  (`fmtDist`, ya retirado), sin relación con lo que dijera el diálogo.
  Formatean `fmtUnitDist`/`fmtUnitArea`, las MISMAS funciones que usa el
  diálogo: es la misma medida y verla escrita de dos formas distintas
  solo hace dudar de si de verdad lo es. El área usa el factor **al
  cuadrado**. El rumbo va siempre en grados: no es una distancia.
- **Cambiar la unidad repinta TODAS las mediciones**
  (`setMeasureUnit` → `refreshMeasureLabels`), desde cualquiera de los
  dos `<select>` —hay dos porque hay dos bloques del diálogo, pero una
  sola preferencia, y `setMeasureUnit` los mantiene sincronizados—.
  El barrido alcanza también los registros pendientes (`li._pending`) de
  las carpetas nunca desplegadas: su capa está en el mapa con su
  etiqueta aunque no tenga fila. Mismo barrido y mismo motivo que
  `nextNumberedName`.
- **La unidad NO es parte del borrador del diálogo**: «Cancelar» no la
  revierte, igual que no revierte `posFormat`. Es una preferencia de
  lectura, no un estilo de la capa; se recuerda entre aperturas y no
  persiste entre sesiones, como `elevUnit`.
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
  celda a celda. El disparo es la RESPUESTA, no el movimiento del ratón.
  `parseAsciiGrid` devuelve por eso la matriz completa con su cabecera
  (`xllcorner`, `yllcorner`, `cellsize`), no un solo valor; `gridValue`
  extrae el de la celda central para la lectura.
- **La cuadrícula se ACUMULA mientras el modo altura está activo**: cada
  respuesta se añade a las anteriores (`drawElevGrid` ya no borra),
  hasta que se desactiva el modo. Para que dos peticiones sobre la misma
  zona pidan exactamente lo mismo —y así se puedan deduplicar sin
  aproximaciones—, cada petición se ajusta (`snapTile`) a una retícula
  fija de teselas de 2×`ELEV_WINDOW` en vez de centrarse en el cursor:
  con origen y tamaño fijos para toda la vida de la página, una misma
  zona cae siempre en la misma tesela y las teselas vecinas nunca se
  solapan. El deduplicado de celdas dibujadas (`elevTileKey`) compara
  por eso la esquina de la rejilla devuelta, exacta, no por proximidad.
  Al desactivar el modo, lo acumulado en la sesión (`elevAccum`) se
  convierte en una capa normal del árbol de navegación («Elevación N»,
  dentro de la sección «Elevaciones»), con las mismas garantías que
  cualquier otra capa: persistente, con checkbox, borrable. Una sesión
  vacía (sin celdas) no crea ninguna capa. Hay un tope de celdas por
  sesión (`ELEV_ACCUM_MAX_CELLS`) porque cada celda es un `L.rectangle` y
  un `L.marker` con icono HTML —los marcadores de Leaflet son siempre
  nodos del DOM, no pasan por canvas como el resto del visor—, así que
  el tope es también un tope de nodos del DOM, no solo de memoria.
- **Qué se dibuja depende del zoom** (`elevZoomBand`): por debajo del 5
  m de la celda nativa, tres líneas de texto dejan de leerse mucho antes
  de que valga la pena seguir acercando. Por debajo del zoom 19
  (`ELEV_ZOOM_MINI`) no se escribe ningún número, solo el relleno del
  rectángulo, que se colorea en rojo pastel translúcido cuando MDS
  supera al MDT en más de `ELEV_ALERT_DIFF` (1 m) —la única señal visible
  de "aquí hay algo construido o vegetación"—; en blanco translúcido de
  siempre en cualquier otro caso. En el zoom 19 justo cabe una línea:
  solo la diferencia, en rojo (clase `.alert`) si supera el umbral. A
  partir del 20 se ven las tres líneas de siempre (terreno, superficie,
  diferencia), con la diferencia en rojo bajo el mismo umbral. El umbral
  de aviso se compara siempre en METROS, nunca en la unidad de
  visualización. `refreshElevCells` (antes `rescaleElevGrid`) recalcula
  relleno y texto de todas las celdas —las de la sesión en curso y las
  ya guardadas en el árbol— a partir de `_cell`, el registro crudo que
  cada capa guarda en sus propias capas Leaflet; no hace falta volver a
  pedir nada ni al cambiar de zoom ni al conmutar la unidad.
- **Unidad de la cuadrícula (m/ft)**: un botón junto al de modo altura
  conmuta `elevUnit` entre metros y pies (`toElevUnit`, con
  `METERS_PER_FOOT`). Afecta solo a los números de la capa de
  elevaciones, no al cuadro de coordenadas (que sigue mostrando ambas
  unidades como siempre); no se persiste entre sesiones, arranca en
  metros en cada carga de página, igual que `demOn`.
- **Repetir una medición con una capa de elevaciones visible la
  amplía en vez de crear otra**: al activar el modo altura,
  `pickClosestElevLi(visibleElevGridNodes())` busca las capas `elevGrid`
  con la casilla marcada; con una sola, la sesión se fusiona en ella
  (`mergeElevSession`); con varias a la vez, en la más cercana al centro
  de la vista (`map.distance`); con ninguna, se crea «Elevación N+1»
  como siempre. Mientras dura la fusión, `elevRequest` no vuelve a pedir
  un punto que la capa destino YA tiene (`coveredByPriorCells`,
  comprobación punto-en-rectángulo sobre sus celdas guardadas: no llevan
  la esquina de rejilla WCS que sí usa `elevTileKey`, así que ese
  deduplicado no sirve aquí). Si la capa destino se borra mientras la
  sesión sigue activa, se cae a crear una capa nueva en vez de perder lo
  medido.
- **La rejilla viaja etiquetada con su CRS** (`web`, `geo` o `native`):
  sin saber en qué sistema se pidió no se pueden convertir sus esquinas a
  latitud y longitud. Web Mercator se deshace con la propia proyección de
  Leaflet; el sistema nativo (UTM) no se dibuja, porque no tenemos la
  conversión inversa y es preferible no pintar la malla a pintarla mal.
- **El texto de las celdas escala con el zoom** (`gridFontSize`): a
  partir del 21 crece un punto por nivel, con tope para que siga cabiendo
  en la celda. Es un tamaño relativo a la celda, no absoluto, así que las
  etiquetas se rehacen en `zoomend` (`refreshElevCells`) recalculando el
  texto a partir del registro crudo (`_cell`) que guarda cada marcador:
  el zoom no vuelve a pedir datos.
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

- Base `visor-kml` (nombre interno heredado del archivo `visor-kml.html`
  de versiones anteriores; se mantiene así a propósito porque cambiarlo
  dejaría inaccesibles el árbol y la vista ya guardados de cualquier
  usuario existente — no es una referencia a actualizar).
  `DB_VERSION` versiona los almacenes (hoy: solo
  `tree`); `TREE_SCHEMA` versiona el formato del árbol serializado, que
  se guarda como `{ v, nodes }` bajo la clave `root`. `TREE_SCHEMA` actual:
  **6** — los nodos de capa admiten `mstyle` (el estilo de marcador),
  existen los tipos `elevGrid` (celdas de elevación de una sesión de
  modo altura) e `imageOverlay` (ortofotos de KMZ), y los nodos
  `measure` guardan su `style`. La lista completa por versión está en el
  comentario de la propia constante, que es donde hay que anotar la
  siguiente.
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
- **Nombres de GeoJSON recordados**: otra clave del mismo almacén
  (`geojsonNameProps`, `GNP_SCHEMA`), un mapa de huella de `properties`
  (`propsFingerprint`: el JSON de sus claves, ordenadas) a la propiedad
  elegida como nombre. Se explica en «Formatos y límites de entrada».

## Red externa

- Nominatim se consulta con `AbortController` / `AbortSignal.timeout`:
  una búsqueda nueva o cerrar los resultados cancela la anterior y
  libera la conexión.
- `describeHttp` traduce el estado HTTP a algo accionable (429 = límite
  del servicio, 5xx = no disponible…).
- **Los iconos ya NO son tráfico de ejecución**: van empotrados en el
  archivo (ver «Iconos de marcador»). Fue la única consulta externa que
  no seguía la disciplina de peticiones —79 a la vez, sin tope ni
  caché compartida— y por eso es la que reventó.

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

- **Capas dinámicas: una sola maquinaria, varias fuentes**
  (`DYNAMIC_SOURCES`, `dynSource`). Una capa base con `dynamic: true`
  declara además un `source`, y esa fuente aporta su catálogo
  (`get`/`error`/`ensure`), su valor por defecto (`pickDefault`) y su
  agrupación para el `<select>` (`groups`). Hoy hay dos: `pnoa-hist` y
  `copernicus`. Ni `applyBaseLayer` ni `buildDynamicLayerSelect` deben
  volver a nombrar una fuente concreta.
- **Una fuente puede estar bloqueada** (`blocked()`): devuelve el texto
  del `<select>` (`label`) y su explicación (`hint`) cuando todavía no
  se puede listar nada. Es lo que hace Copernicus mientras no haya
  credencial: el selector queda deshabilitado diciendo «Requiere
  credencial», y **no se rehabilita al encender la capa** porque no hay
  nada que elegir. Al arrancar, una capa bloqueada guardada como
  encendida **se apaga**, en vez de fallar tesela a tesela.
- **Configurar una fuente es una tuerca ⚙**
  (`buildDynamicConfigButton`), del mismo estilo que los botones de
  acción de una fila del árbol, colocada en `.base-tools` **a la
  izquierda de las flechas** de apilado. Está siempre que la fuente
  tenga `configure`, haya credencial o no, y **no se deshabilita con la
  capa apagada**: si solo apareciera cuando falta la credencial, no
  habría forma de cambiarla ni de retirarla una vez guardada; y si se
  deshabilitara con la capa apagada, habría que encender una capa que
  todavía no puede funcionar para poder configurarla.
- **Copernicus DEM va por Sentinel Hub y con la credencial DEL USUARIO**
  (`COP_WMS_BASE`, `shWmsUrl`, `setInstanceId`, diálogo `#sh-creds`).
  Comprobado contra los servicios reales: **no existe ningún WMS anónimo
  de Copernicus**. El de la EEA (EU-DEM v1.1) está retirado —su
  MapServer responde `not started` y su `WMSServer` da 404— y el mirror
  de AWS sirve COG **sin CORS** (y su preflight `OPTIONS` da 403), así
  que es ilegible desde el navegador. Sentinel Hub sí manda CORS
  correctos y autentica con un *instance ID* de la cuenta de cada
  usuario: por eso se pide y se guarda en su navegador
  (clave `shCreds`, `SH_SCHEMA`) en lugar de incrustarse en el archivo,
  que se distribuye. **No se serializa con el árbol ni viaja en un
  `.kite.json` exportado.** Sus capas tampoco se fijan: cada usuario
  decide cuáles publica su configuración, así que salen de su
  GetCapabilities. Con un instance ID inexistente el servicio responde
  HTTP 400 con `<ServiceException>Invalid instance id</ServiceException>`
  en el cuerpo, y eso es lo que se muestra: quedarse en el código HTTP
  perdería el texto útil.
- **Copernicus DEM es un DSM, no un MDT**: incluye edificios y
  vegetación (los archivos se llaman `Copernicus_DSM_…`). No sustituye
  al MDT del IGN ni sirve para la resta MDT−MDS del modo altura; es una
  capa visual más.
- **Copernicus no tiene imagen por debajo del zoom 7**, y lo peor es
  cómo lo dice: responde 200 con una imagen fija de «no disponible», que
  se dibuja como si fuera dato en vez de fallar. La capa lleva
  `minNativeZoom: COP_MIN_NATIVE_ZOOM` (7), de modo que en el zoom 6 se
  pide el 7 y Leaflet lo reescala, y `minZoom: COP_MIN_ZOOM` (6), que
  corta por debajo. El corte no es arbitrario: medido con el visor a
  1075x900, pedir el 7 cuesta **80** teselas en el zoom 6, pero **270**
  en el 5, **986** en el 4 y **1659** en el 3 — y Sentinel Hub factura
  por uso, así que serían miles de peticiones de la cuota del usuario
  para rellenar un mapamundi. Consecuencia visible: por debajo del zoom
  6 la capa no dibuja nada aunque su casilla esté marcada.
- **`minZoom` y `minNativeZoom` se combinan, pero por un detalle del
  orden**: `GridLayer._setView` compara `minZoom` contra el zoom REAL y
  solo después aplica `minNativeZoom`. Si lo hiciera al revés, el zoom
  ya vendría elevado a 7 y `minZoom` no cortaría nunca.
- **SRTM30 de terrestris** (`srtm`) es la opción de relieve global sin
  credencial: su GetCapabilities declara `<Fees>None</Fees>` y se
  verificó devolviendo teselas reales en EPSG:3857 con **WMS 1.1.1**,
  que es la versión que Leaflet manda por defecto. Exige atribución
  (`SRTM_CREDIT`) y su cobertura es la del SRTM, **56°S–60°N**: por
  encima del paralelo 60 no hay dato, así que no reemplaza al sombreado
  de Esri. Lleva **`maxNativeZoom: 9`**: por encima no se le pide nada
  al servidor y Leaflet reescala la última tesela. El servicio sí
  responde 200 más allá (comprobado hasta z16), pero la malla es de
  30 m y esos niveles son interpolación, no detalle.
- **Un diálogo nuevo necesita su `max-width`**: `.dlg-box` trae
  `max-width: 90vw`, pensado para los diálogos anchos (estilos,
  iconos), así que una caja de texto corto se estira a casi toda la
  pantalla si no se acota. Los de texto van en la regla de
  `#kml-tags-picker, #kml-dup-picker, #sh-creds` con `max-width: 42ch`.
- **La ventana de propiedades tiene ANCHO propio, no de ajuste al
  contenido**: `#style-dialog .dlg-box { width: min(92vw, 24rem) }`. Su
  título lleva el nombre del nodo, y un nombre de KML puede tener
  cientos de caracteres, así que con la anchura de ajuste al contenido
  (tope 90vw) la ventana crecía con el texto hasta ocupar casi la
  pantalla: lo que se está editando no puede decidir el tamaño de la
  ventana. El nombre envuelve (`overflow-wrap: anywhere` en
  `.dlg-box h2`, que parte también un nombre sin espacios), y la caja de
  edición del nombre ocupa lo que dé la ventana (`#name-row input` sin
  los 190 px de `max-width` de un control corto): es el campo más largo
  del diálogo, así que es el que debe crecer con él.
- **`collectWmsLayers`/`parseWmsCapabilities` reciben sus opciones**
  (`exclude`, `rootGroup`), no las llevan dentro: las comparten el PNOA
  histórico (`PNOA_HIST_WMS_OPTS`) y Copernicus (`COP_WMS_OPTS`).
  `opts` no se desestructura en la firma, pero **ya no por obligación**:
  lo imponía el extractor de los tests, que contaba llaves desde la
  primera `{` y truncaba ahí la función. Desde que todas las suites usan
  `tests/_extract.js`, que salta la lista de parámetros, una
  desestructuración en la firma no rompe nada aquí ni en ninguna otra
  función.
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
- Una capa cuya URL no responda se marca en rojo en el panel tras
  `BASE_FAIL_TILES` errores de tesela, en vez de quedarse en blanco sin
  explicación. Las de IGN Base, MTN y Relieve usan las URL WMTS del IGN:
  si alguna cambiara, el aviso es lo que lo delata.
- **Y el aviso se retira solo al volver el servicio**: una tesela que SÍ
  llega (`tileload`) limpia `failed` y rearma el contador. Antes
  `failed` se ponía a `true` y no lo quitaba nadie, así que un corte de
  red dejaba la capa en rojo el resto de la sesión aunque volviera a
  funcionar; y como el disparo era `++errors !== 8` —el 8 exacto—,
  después de un corte tampoco podía volver a avisar nunca.
  Contar solo los fallos **sin acierto de por medio** es además más
  fiel: unas teselas fuera de cobertura repartidas por la sesión no
  significan que el servicio esté caído. El panel se repinta solo en la
  transición, no en cada tesela.
- **Al recuperar la red hay que forzar el redibujado**: Leaflet no
  reintenta por su cuenta las teselas que fallaron, así que sin esto se
  quedarían en blanco —y la capa en rojo— hasta que el usuario moviera
  el mapa. Un `window.addEventListener("online")` redibuja las capas
  marcadas como caídas. `navigator.onLine` no prueba que haya
  conectividad real, solo que hay interfaz, pero aquí se usa únicamente
  para REINTENTAR: si el servicio sigue caído, las teselas vuelven a
  fallar y la capa sigue marcada. Los dos caminos de recuperación están
  verificados en navegador: por evento `online` (corte de red) y solo
  moviendo el mapa (caída del servidor, donde `online` nunca llega).
- **El icono de `.base-toggle` va con `position: absolute; right: 0`**,
  no en flujo normal: la caja (`.base-box`) es `float: right` con ancho
  automático dentro de la esquina `topright` de Leaflet, así que su
  borde derecho es fijo pero el izquierdo se desplaza al desplegar
  `.base-list`. Un icono en flujo (pegado al borde izquierdo) se alejaba
  del punto donde el usuario lo había pulsado para desplegar, obligando
  a mover el ratón para volver a pulsarlo y plegar. Mismo patrón que ya
  usa `.actions` (los botones de una fila) para anclarse al borde
  derecho de un padre `position: relative`.

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
- **Soltar un archivo externo sobre una carpeta lo importa DENTRO de
  ella**, en vez de siempre en la raíz: `folderDropTarget` resuelve el
  `<li>` bajo el puntero con el mismo test de "esto es un contenedor"
  que ya usan `dropZone()` (reordenar interno) y `pasteClipboard()`
  (pegar) —`nodeUl(li)`—, y ese destino se enhebra hasta los
  importadores (`handleDroppedFiles` → `addFileNode`/`importTreeExport`)
  exactamente como `pasteClipboard` ya elige entre la carpeta del cursor
  y la raíz. Para KML esto NO añade un envoltorio (la jerarquía del
  archivo cuelga directa de la carpeta soltada); para GeoJSON/`.kite.json`
  es la propia carpeta envoltorio la que cuelga de ahí. El recuadro
  `#dropzone` vive ahora bajo el árbol (`#tree`), no en la cabecera.

## Ficha del elemento / panel de información de la capa

- La `<description>` del KML se guarda en `li._desc` y se serializa.
  **Se pasa a `makeNode` como opción**, no se asigna después: los
  botones se crean dentro de `makeNode`, así que asignarla luego dejaba
  el botón sin aparecer nunca.
- Es HTML de un archivo AJENO, así que se sanea con lista blanca
  (`sanitizeHtml`): los elementos peligrosos se tiran **enteros**
  (`DESC_DROP`), a los desconocidos se les quita la etiqueta pero se
  conserva el texto —que suele ser el dato—, y se eliminan todos los
  atributos `on*` y las URL que no sean http(s).
- **El mismo diálogo (`#desc-dialog`/`showLayerInfo`) también muestra
  `properties` de GeoJSON**, como una tabla clave/valor
  (`propertiesTableHtml`, con los valores completos, sin truncar: es
  una ventana de consulta). `infoHtmlFor(li)` decide qué enseñar: la
  ficha KML si `li._desc` existe, si no la tabla de `properties` de la
  capa (`layerProperties`, leída de `layer.feature.properties`, que
  sobrevive íntegro el ciclo guardar/restaurar porque todo pasa por
  `toGeoJSON()`/`L.geoJSON()`), si no `null` (nada que mostrar). Ambas
  fuentes son mutuamente excluyentes: una capa KML no tiene
  `properties` de GeoJSON, y viceversa.
- **Tres formas de abrirlo**: el botón ℹ de la fila (solo aparece si
  `infoHtmlFor` tiene algo que enseñar); al pasar el ratón por la capa
  en el visor (`mouseover`, con `{ focus: false }` para no robarle el
  foco al usuario en cada hover — no se cierra solo al quitar el
  ratón, es no modal y se cierra con «Cerrar» o Escape como siempre); y
  «Mostrar propiedades» del menú contextual del visor (ver esa
  sección). Con el diálogo ya abierto, pasar a otra capa solo actualiza
  su contenido, sin recolocar la caja.

## Menú contextual del visor

- `CTX_MENU_ITEMS` es la lista genérica (centrar, medir, exportar PNG…)
  que se muestra al hacer click derecho donde no hay ninguna capa.
  Sobre una capa, se anteponen «Ir al nodo en el panel»
  (`highlightNode`, expande ancestros, selecciona y hace scroll) y,
  si la capa tiene algo que enseñar, «Mostrar propiedades»
  (`showLayerInfo`).
- **Con varias capas superpuestas bajo el cursor, esos dos ítems se
  convierten en un submenú** con una entrada por capa
  (`ctxItemsFor`/`openCtxSubmenu`), en vez de actuar sobre una sola.
- **Hit-testing propio, con geometría real**: Leaflet solo resuelve
  UNA capa por click en su renderizador de lienzo (comprobado en el
  propio `Canvas.js` de Leaflet 1.9.4: no hay bubbling real a las capas
  de debajo). Para detectar varias, `layersAtPoint`/`layerHitTest`
  recorren las capas visibles de `rootGroup` a mano.
  **Antes esto probaba los trazos por caja envolvente**, como
  simplificación deliberada, y era incorrecto: la caja de una línea
  diagonal cubre todo el rectángulo entre sus extremos, así que el menú
  ofrecía mediciones y polígonos lejísimos del cursor (medido en la
  reproducción: un punto a 226 px de una diagonal la «acertaba»), y un
  polígono cóncavo se acertaba en su escotadura, donde no hay nada
  dibujado. Ahora se prueba la geometría: ray-casting
  (`pointInRing`/`pointInRings`) más distancia a los segmentos
  (`segDistSq`/`nearPolyline`), todo en **píxeles de contenedor** —un
  margen en grados vale distancias muy distintas según latitud y zoom—
  con `PATH_HIT_PX` (10, el `clickTolerance` de Leaflet) ensanchado por
  el grosor del trazo. La caja envolvente sigue, pero **solo como criba
  barata previa**: medido, 7,2 ms por click derecho con 2002 capas.
- **Acierta un polígono el click dentro de su área o cerca de su
  contorno**, que es lo que hace el propio renderizador de Leaflet: así
  el menú ofrece lo mismo que la capa captura en un click normal. Un
  punto dentro de un agujero queda fuera, salvo pegado a su borde.
- **El lado de cierre de un anillo hay que añadirlo a mano**:
  `getLatLngs()` de un `L.Polygon` NO repite el punto inicial (Leaflet
  lo quita al construirse), así que sin el parámetro `closed` de
  `nearPolyline` el último lado no se probaría y un click justo sobre
  él no acertaría. Lo encontró su test.
- **El despacho es POR CLASE, no por «tiene este método»**: con duck
  typing un `L.Circle` entraba por la rama de `getLatLng` —lo hereda de
  `L.CircleMarker`— y se probaba como un punto de 20 px en su centro,
  sin mirar jamás su radio, así que una medición circular de kilómetros
  solo se podía acertar en el centro. El orden importa además porque
  `L.Polygon` extiende `L.Polyline`.
- **Se descartó "pelar" capas** (ocultar la de más arriba y volver a
  preguntarle a Leaflet, repitiendo) por mirar el propio código:
  `Canvas._initPath` siempre reinserta una capa reañadida al FINAL del
  orden de pintado, así que ocultar y restaurar deja el orden alterado
  en cuanto hay alguna capa no tocada intercalada entre las que sí lo
  fueron. Arreglarlo habría exigido recrear el orden de pintado
  completo tras cada click derecho.

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

Además de los tests, conviene pasar sobre `kitelocal.html`:
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

- **Exportar PNG (`exportMapPng`) oculta los controles superpuestos**
  (`.leaflet-control-zoom`, `.measure-bar` —cubre a la vez la barra de
  medición/pin/📷 y la de vista, que comparten esa clase—, `.base-box`)
  antes de llamar a `html2canvas` y los restaura en un `finally`,
  incluso si la captura falla: son hijos del propio `#map` y no aportan
  información en la imagen. El cuadro de coordenadas y la atribución NO
  se ocultan a propósito: el primero sí es información del punto, y la
  segunda es la atribución CC BY que exige la licencia del PNOA/IGN.

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
  geometrías, hay que invalidar ahí también. **`buildFromNodes` también
  rellena `li._geo` con el `n.geo` ya guardado** (en vez de dejarlo en
  blanco y forzar un `toGeoJSON()` completo en el primer guardado
  siguiente): sin esto, cualquier reconstrucción del árbol —deshacer,
  rehacer, pegar, importar un `.kite.json`, incluso la carga inicial de
  la app— pagaba otra vez el coste de 349 ms que esta caché existe para
  evitar. Cualquier código nuevo que reconstruya nodos «layer» desde un
  registro serializado debe seguir haciendo lo mismo. **Verificado con
  un benchmark** (código real extraído de `kitelocal.html`, mismo
  patrón que `tests/selbench.js`, 8.000 nodos): entre 3× y 4× más
  rápido con la caché tibia frente a fría, incluso en un entorno
  pesimista (DOM de Node/`linkedom`, más lento en `querySelector` que
  un navegador real, así que el beneficio real es probablemente mayor).
  No es overhead prescindible: sin ella, el coste se repetiría en CADA
  guardado, no solo el primero.
- **`serializeNode` solo consulta el `<ul class="node-list">` de un
  nodo si `li._isContainer`** (asignado una vez en `makeNode` como
  `isFolder || isFile`), en vez de preguntarle siempre al DOM
  (`nodeUl(li)`) aunque el nodo sea una capa hoja que nunca puede
  tenerlo — que es la inmensa mayoría de los nodos de un árbol grande.
  Ese `querySelector` de más pesaba, en el mismo benchmark, tanto o más
  que el propio `toGeoJSON()` para geometrías pequeñas/medias.
- **El retardo del guardado se ajusta solo** al coste medido del último
  (`saveCost`, entre `SAVE_MIN_MS` y `SAVE_MAX_MS`): en un árbol pequeño
  guarda casi al instante y en uno enorme no repite un trabajo caro
  mientras el usuario sigue trabajando.
- **La lectura de coordenadas se pinta una vez por fotograma**
  (`requestAnimationFrame`), no una por evento de ratón: cada lectura
  proyecta a UTM y reescribe varias filas, y llegan más de 100 eventos por
  segundo. Se pinta siempre la última posición, nunca una atrasada. El
  arrastre de un marcador en el diálogo de estilos (`onMarkerDragged`)
  sigue el mismo patrón: el evento `"drag"` de Leaflet llega a la misma
  cadencia que `mousemove`, así que solo `invalidateGeo` (una simple
  asignación) corre en cada evento; leer la posición y repintar las
  cajas de coordenadas (`renderCoords`) se difiere a un único
  `requestAnimationFrame`, cancelado si el diálogo se cierra antes de
  que llegue.
- **Moverse por el árbol cuesta O(profundidad)**, ver la sección del
  teclado. Ninguna operación de selección puede recorrer la selección
  entera ni consultar el árbol por nodo. El buscador del panel
  (`search-box`) sigue la misma disciplina: busca en vivo mientras se
  teclea, pero con `SEARCH_DEBOUNCE_MS` (150 ms) y solo a partir de
  `SEARCH_MIN_CHARS` (3) caracteres, para no recorrer el árbol completo
  (`treeEl.querySelectorAll("li")`, ~8.000-10.000 nodos) en cada tecla
  ni saltar de resultado mientras el término todavía se está afinando;
  Enter/Shift+Enter y los botones ◀▶ no llevan ese mínimo, son una
  acción explícita del usuario.
- **Los borrados de una selección completa purgan el `Set` de selección
  UNA SOLA VEZ**, con `clearSelection()` tras el bucle, no dentro de
  `deleteNode` por cada nodo borrado (`deleteNode(li, {pruneSelection})`):
  purgar la misma selección una vez por nodo era O(k²) al borrar k
  nodos de golpe (botón × con selección múltiple, tecla Supr). El resto
  de llamadas a `deleteNode` (cortar, cancelar un pin nuevo, limpiar una
  carpeta de mediciones vacía) siguen purgando por defecto, que es lo
  correcto para un borrado suelto que no vacía toda la selección.
- **Cuidado al reconstruir una carpeta desde un snapshot previo**
  (`before`, el `[...ul.children]`/`Set` tomado antes de mutar): buscar
  pertenencia con `Array.includes` dentro de un bucle sobre los hijos
  actuales es O(m²) donde m es el tamaño de la carpeta destino. Se usa
  siempre un `Set` (`before.has(...)`), nunca un array, en
  `importTreeExport`, `addFileNode` y `pasteClipboard`.
- **Pendiente de medir, no confirmado**: `reorderPaintOrder`
  (`scheduleReorder`, agrupado por `requestAnimationFrame`) se dispara
  desde `scheduleSave()` en CUALQUIER mutación del árbol, también las
  que no pueden cambiar el orden de pintado (renombrar, editar
  estilos), recorriendo `treeEl.querySelectorAll("input[type=checkbox]")`
  sobre el árbol completo. No es O(n²) (una sola pasada por frame) y
  `bringToFront` es barato por capa en el renderer Canvas, pero nadie ha
  medido el coste real con miles de capas activas. Separar "esto sí
  puede afectar al orden" de "esto no puede" exigiría auditar todos los
  sitios que llaman a `scheduleSave()`, con riesgo de dejar el z-order
  desincronizado si se pasa por alto algún caso: no tocar sin medir
  antes con `performance.now()` alrededor de `reorderPaintOrder()`.
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
- Los iconos de marcador no cuestan ninguna petición: están empotrados
  y `applyMarkerStyle` es síncrona (ver «Iconos de marcador»).

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
7. **Toda tecla o atajo nuevo se documenta en la chuleta de atajos**
   (`#shortcuts`, el diálogo que abre `?` o el botón de ayuda del panel
   de navegación): una fila nueva en la tabla, en la sección que
   corresponda (o una sección nueva si no encaja en ninguna). Un atajo
   que solo vive en el código y no en esa tabla es, a efectos del
   usuario, un atajo que no existe.
8. **Siempre** actualizar la constante `BUILD` (AAAAMMDDHHMM, junto al
   crédito de Leaflet, hoy en `src/js/10-map.js`) en CADA generación del
   código, por pequeña que sea: es la única versión visible y sirve para
   saber qué se está ejecutando. Sin excepciones. Y **comprobar que la
   sustitución ha surtido efecto**: editar por el valor anterior falla en
   silencio si no es el que se creía, y la versión se queda congelada sin
   que nadie lo note. Sustituir por patrón (`const BUILD = "\d{12}"`) y
   verificar. Se mantiene a mano a propósito: inyectarla en cada
   construcción rompería la comprobación de identidad byte a byte, que es
   la red de seguridad de cualquier reorganización de `src/`.
9. **Editar en `src/`, nunca en `kitelocal.html`**, y `npm run build`
   antes de probar. Después: `node --check` del script; test en Node de
   la lógica pura (nuevo o actualizado si el cambio lo exige); `grep -F`
   de referencias muertas de lo retirado (con `-F`: el `$` de `$id(...)`
   se toma como fin de línea en un patrón normal y da falsos negativos,
   error ya cometido aquí); y `node tests/run-all.js` completo antes de
   dar el cambio por terminado — empieza comprobando que el archivo
   generado corresponde a las fuentes.
10. Cuidado con el ORDEN: dentro de un archivo y **entre archivos** (el
    manifiesto `JS` de `build.js`). Una variable que se asigna dentro del
    `onAdd` de un control debe declararse antes que ese control, o al
    añadirlo se cae por zona muerta temporal. `node --check` no lo
    detecta.
11. **Al reportar que se han hecho cambios en el código, mostrar siempre
    la salida de `git diff --stat`** (sobre lo modificado en esa
    respuesta), para que quede a la vista qué archivos y cuántas líneas
    cambiaron sin tener que ir a comprobarlo aparte.
