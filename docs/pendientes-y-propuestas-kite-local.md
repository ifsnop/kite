# KITE Local — pendientes y propuestas

### Lo que se sabe que falta y las ideas para desarrollar

Este documento reúne en un solo sitio lo que **está pendiente** en KITE Local y las **ideas** que se han propuesto para seguir desarrollándolo. Antes estaba repartido entre las reglas del proyecto, el README y notas de varias conversaciones; aquí es la única lista. Quien quiera saber qué hace hoy la aplicación debe leer el [manual de usuario](manual-usuario-kite-local.md); quien quiera saber en qué se apoya la confianza en sus datos, el [estudio de seguridad](estudio-seguridad-kite-local.md).

- **Última revisión:** 2 de noviembre de 2026 (versión 2.2.0 de la aplicación).
- **Cómo se mantiene:** lo que se hace **se borra** de este documento en el mismo cambio que lo hace (y se cuenta en el manual y el README, si lo ve el usuario); una idea que se descarta pasa a «Descartado» con su motivo, para no volver a proponerla sin un caso nuevo. Una idea se convierte en pendiente cuando alguien decide hacerla. Ver `.claude/rules/docs-maintenance.md`.
- **Qué NO es:** no es un compromiso de calendario. Hay ideas que quizá no se hagan nunca.

## Índice

1. [Pendientes conocidos](#1-pendientes-conocidos)
2. [Hecho a medias](#2-hecho-a-medias)
3. [Ideas para desarrollar](#3-ideas-para-desarrollar)
4. [Descartado a propósito](#4-descartado-a-propósito)

---

## 1. Pendientes conocidos

Lo que se sabe que no está bien o no está hecho, y que no es una idea nueva sino una deuda. Ordenado por lo que más puede afectar al usuario.

### 1.1 Antimeridiano incompleto

El punto medio de una medición y las propias mediciones cruzan ±180° bien, y los anillos de alcance también (sus longitudes pueden pasar de 180). **Todavía no**: el encuadre automático de lo cargado y la retícula de paralelos y meridianos. Además, otros formatos rechazarían esas longitudes como fuera de rango (un anillo que cruza el antimeridiano no se exportaría igual a todos).

### 1.2 Dos placemarks a distinta altura se fusionan como duplicados

`findDuplicatePlacemarks` compara solo latitud y longitud. Es el único punto del recorrido de los datos donde la altitud, que se conserva en todo lo demás (importar, guardar, exportar), no se tiene en cuenta: dos marcadores en la misma posición y a distinta altura se pueden fusionar sin querer, aunque el usuario siempre responde antes a la pregunta de «Marcadores duplicados».

### 1.3 Preguntar por archivo al filtrar etiquetas HTML

Hoy el diálogo «Etiquetas en los nombres» sale **una vez por archivo** (KML `<name>` y propiedades de GeoJSON): cincuenta archivos son cincuenta preguntas. Alternativas si molesta: recordar la respuesta durante la sesión, recordarla por huella de archivo, o quitar la pregunta y dejar constancia en el resumen de la carga. Sin decidir.

### 1.4 `reorderPaintOrder` está por medir, no por arreglar

Se dispara desde `scheduleSave()` en cualquier mutación del árbol (también las que no cambian el orden de pintado) y recorre todas las casillas. No es cuadrático, pero nadie ha medido su coste con miles de capas. **No se toca sin medir antes** con `performance.now()` alrededor de la llamada (ver `.claude/rules/performance.md`).

### 1.5 Memoria de la pestaña sobre `file://`

El indicador «Memoria de la pestaña» funciona por `http(s)`; abierto con doble clic como archivo local, Chromium congela `performance.memory` y la línea se oculta. No hay arreglo conocido: la API normalizada exige aislamiento de origen cruzado (COOP/COEP), que ni un archivo local ni GitHub Pages pueden dar.

### 1.6 Soporte táctil

La navegación del árbol con teclado está hecha, pero **no tiene equivalente táctil** (arrastrar filas, selección múltiple, botones que solo aparecen al pasar el ratón). En un teléfono la aplicación avisa de que es mejor desde un ordenador y ofrece solo el mapa, pero una tableta con la interfaz completa sigue siendo incómoda. La accesibilidad más allá de las etiquetas ARIA existentes tampoco está auditada.

### 1.7 Una copia de la aplicación sin librerías desde Internet

Leaflet y JSZip siguen cargándose desde una red de distribución al abrir la página (el service worker las guarda tras la primera visita, y proj4, geotiff.js y html2canvas se piden solo cuando hacen falta). Para un despliegue controlado sin red hay que vendorizar esas librerías (el README lo menciona). El código no lo impide, pero no hay un modo de construcción que lo haga.

### 1.8 Límites de recursos no configurables

Los topes de importación (2000 entradas y razón de compresión de un KMZ, 100 000 elementos de un shapefile, 100 000 entidades de un servicio ArcGIS…) son constantes del código. Solo la longitud máxima de un perfil y el tamaño máximo de un KMZ descomprimido se ajustan en Propiedades.

### 1.9 Cuadro de límites del manual contrastado con el código

Fase 4 de `tests/docs.js`: un cuadro de límites y valores por defecto del manual (300 MB, 100 000 elementos, 10 NM, 15 s…) con el nombre de su constante y una prueba que extraiga esas constantes y las compare. Mientras no exista, la revisión semestral (`.claude/rules/docs-maintenance.md`, C.1) las comprueba a mano.

---

## 2. Hecho a medias

No confundir con pendiente: está hecho lo principal y queda un cabo.

- **Navegación del árbol con teclado:** hecha (flechas, Inicio/Fin, Re/Av Pág, espacio, Supr, F2, Ctrl+A/C/X/V/Z/Y/F, Alt+Intro). Falta el soporte táctil (1.6).
- **Comprobaciones estáticas:** las seis automatizadas (SRI, guardián de Leaflet, `BUILD`, sin bytes NUL, `$id`/`getElementById` válido, toda función llamada declarada). Nada más pendiente salvo lo que vaya apareciendo.
- **Exportar:** KML, GeoJSON y `.kite.json` están; faltan KMZ y GPX (3.1). Una ortofoto COG nunca se exporta (sus bytes viven en un almacén del navegador).

---

## 3. Ideas para desarrollar

Propuestas, de más a menos prioritaria según lo que más ayudaría a quien usa la aplicación. Ninguna está decidida. Las que ya se hicieron (exportar a KML y GeoJSON, importar GPX, anillos de alcance y sectores, enlace compartible de la vista, tabla de atributos y estilo por atributo, exportar el perfil, parcela catastral, servicios ArcGIS) están descritas en el manual y se han borrado de aquí.

### 3.1 Exportar también a KMZ y a GPX

Hoy lo que se dibuja, mide o importa sale como `.kite.json`, KML o GeoJSON. Falta **KMZ** (el KML con sus imágenes, para llevar ground overlays a Google Earth) y **GPX** (rutas y mediciones para un GPS). Se añaden al botón 💾 de la fila, sin red ni librerías nuevas (JSZip ya está). Un GPX solo admite puntos, rutas y tracks: lo que no cabe (polígonos, anillos) se nombra en un aviso, como ya hace la exportación a KML y GeoJSON.

### 3.2 Importar un CSV de puntos

Es lo que se suele recibir de una hoja de cálculo: columnas latitud/longitud, o X/Y con un EPSG elegido. Un diálogo para elegir columnas, del estilo de «Elegir nombre»; reproyección con proj4 (ya se carga bajo demanda para los shapefile) y detección de separador y codificación (como la del `.dbf`). Entraría por `addFileNode` como un GeoJSON ya construido, igual que un GPX o un shapefile, y heredaría el resumen, los duplicados y deshacer.

### 3.3 Mapa de visibilidad desde un punto (cobertura radar o de radioenlace)

Se pulsa un punto, se da la altura de antena y el alcance, y se pinta qué celdas del MDT/MDS se ven y cuáles quedan tapadas. Es la extensión natural del perfil de una ruta, que ya calcula línea de vista, curvatura 4/3 y elipsoide de Fresnel, pero solo entre dos puntos. Una entrada nueva en «Consultas» del menú contextual, con la misma descarga por trozos del perfil y la misma disciplina de red (`.claude/rules/external-network.md`). Es el trabajo más grande de la lista y el que más encaja con el uso aeronáutico de la aplicación.

### 3.4 MGRS y UTM en el buscador

El buscador ya entiende latitud y longitud (decimales o en grados, minutos y segundos, con letras de hemisferio) y va allí a zoom 9 sin consultar nada. Faltan las referencias **MGRS** y las coordenadas **UTM** («30T 440610 4473779»), que hoy solo se leen en el cuadro de coordenadas del visor. Ayudaría a quien trabaja con coordenadas dictadas o impresas. Se resolvería en `parsePlaceCoordinates` (`43-points-editor.js`), y la calculadora geodésica ganaría un conversor.

### 3.5 Agrupar marcadores cuando son miles

Con miles de marcadores el visor se ralentiza, y está medido: 10 000 marcadores tardan unos 236 ms por fotograma en rasterizado por software (ver `.claude/rules/performance.md`: no se ha medido en un equipo con GPU). Agrupar los cercanos a un zoom bajo lo resolvería. Hay que decidir si es una opción por capa o automática, y qué pasa con el hit-testing propio del menú contextual (`42-hittest.js`), que hoy trabaja sobre geometría.

### 3.6 Capas con fecha: `TimeSpan`, `TimeStamp` y `gx:Track` de KML

Hoy se ignoran (un track de GPX sí entra, con sus horas). Un control de tiempo (deslizador) que muestre solo lo vigente en una fecha, y que anime un track con hora, ayudaría a seguir recorridos, vuelos o campañas. Es lo más costoso de la lista (modelo de datos, control nuevo, rendimiento con muchas capas) y lo que sirve a menos usuarios.

### 3.7 Leer GeoPackage y proyectos de QGIS

**GeoPackage** (`.gpkg`, una base SQLite): casi todos los proyectos modernos apuntan a él, y leerlo exigiría una librería de SQLite en el navegador, cargada bajo demanda como las demás. **Proyecto de QGIS** (`.qgz`/`.qgs`): habría que soltarlo junto a sus archivos, como las piezas de un shapefile; leería el árbol de grupos, el orden, la visibilidad y los nombres, los estilos de símbolo único y, con el estilo por atributo ya hecho, los categorizados, y las capas WMS/XYZ del proyecto como fuentes base dinámicas (`11-base-panel.js` ya las admite). Va detrás del GeoPackage porque sin él solo serviría para proyectos de shapefile, KML o GeoJSON.

### 3.8 KML más completo

Más allá de los atributos (`ExtendedData`, ya leídos y exportados): `NetworkLink` solo descargaría **una vez**, a petición, con la misma confirmación en dos pasos que el botón 🔗. El tiempo (`TimeSpan`, `TimeStamp`, `gx:Track`) está en la propuesta 3.6. Siguen fuera de alcance a propósito los modelos 3D, los tours y las superposiciones de pantalla.

### 3.9 Operaciones geométricas

Con Turf.js por CDN y bajo demanda (como proj4): zona de influencia (buffer) de un punto, una ruta o un polígono; unión, intersección y diferencia de polígonos; simplificar; centroide. El resultado sería un nodo nuevo del árbol, con deshacer, como el de los anillos de alcance. Hay que decidir hasta dónde llegar sin convertir KITE en un SIG (para eso está QGIS: ver el README).

### 3.10 «Mi ubicación»

Con la API de geolocalización del navegador: centrar el mapa en la posición, con su círculo de precisión, y un seguimiento opcional que deje un track grabable. Va al final porque el producto está pensado para trabajar con archivos y no en campo, y porque obliga a tratar un dato sensible (la posición del usuario) con cuidado: nada saldría del navegador, pero habría que decirlo.

---

## 4. Descartado a propósito

Para no volver a proponerlo sin un caso nuevo.

- **Web Workers para el análisis de archivos.** El tamaño objetivo no los justifica, y un worker no tiene `DOMParser` ni Leaflet, así que el trabajo habría que partirlo de forma forzada.
- **Migrar el almacenamiento o los `.kite.json` de otra versión.** El almacenamiento está versionado y lo que no corresponde a la versión actual se **borra**, no se migra; la versión solo se sube cuando un cambio lo exige y el usuario recibe un aviso si se descarta un espacio de trabajo. Hay excepciones puntuales, decididas con el usuario, cuando solo se añaden tipos de nodo.
- **Un plugin de ArcGIS (esri-leaflet) en vez de código propio.** Choca con el mapa girado y con «una sola Tierra», y pinta los vectores fuera del árbol. Ver `.claude/rules/arcgis.md`.
- **Leer ortofotos ECW.** No hay decodificador en JavaScript y el del fabricante es propietario; se rechazan con la receta para convertirlas a COG.
- **Más idiomas de la interfaz por ahora.** Español e inglés están hechos; el francés es solo una puerta abierta (`.claude/rules/i18n.md`), y los idiomas de derecha a izquierda no se contemplan.
- **Arrastre nativo de HTML5 en el árbol.** Un arrastre empezado sin querer congelaba la aplicación 30 segundos; el arrastre es propio (`.claude/rules/tree-navigation-selection.md`).
