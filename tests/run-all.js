#!/usr/bin/env node
/* Lanzador de la batería de pruebas de KITE Local.
   Uso:  node tests/run-all.js  [--bench]
   Los tests extraen las funciones del propio kitelocal.html y las
   ejecutan en Node, así que comprueban EL CÓDIGO QUE SE ENTREGA, no una
   copia. Los que necesitan un DOM usan linkedom (HTML) o @xmldom/xmldom
   (XML, porque linkedom no implementa espacios de nombres).          */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const SUITES = [
  ["kmltest.js",    "Parseo de KML: espacios de nombres, estilos, geometrías"],
  ["repairtest.js", "Reparación de prefijos XML sin declarar"],
  ["htmltagstest.js", "Detección y limpieza de etiquetas tipo HTML en nombres de un KML"],
  ["dupetest.js", "Fusión de marcadores duplicados: mismo nombre y posición, en KML y en GeoJSON"],
  ["clamptest.js",  "Coordenadas: validación y tolerancia de redondeo"],
  ["parsecoords.js", "parseCoords en una sola pasada: idéntico al de siempre (aleatorias, hostiles, \\s carácter a carácter) y no cuadrático"],
  ["utmtest.js",    "Conversión a UTM y husos"],
  ["daynight.js",   "Iluminación día/noche: punto subsolar y elevación solar en fechas y puntos de referencia"],
  ["coordfmt.js",   "Formato de coordenadas: decimal, GMS con espacios y GMS compacto"],
  ["elevtest.js",   "Elevaciones: catálogo de fuentes WCS por conjunto de datos, reintentos, ASCII o GeoTIFF, rejilla, unidades y cálculo del perfil"],
  ["docs.js", "Documentación: recuentos de suites, versiones, figuras, anclas y manifiesto de capturas; servidores del código frente al Anexo A del estudio y su política de contenido; atajos de la chuleta, menú contextual y ventanas frente al manual; y tests/README.md frente a run-all.js"],
  ["arcgistest.js", "Servicios ArcGIS (MapServer): direcciones pegadas, catálogo real de ENAIRE, grupos y ciclos, extent, caja de tesela, URL de /export, ids de show:, registros ajenos y datos de una capa (/query: ficha real, recuento y páginas)"],
  ["cadastretest.js", "Parcela catastral: direcciones y referencia validada, RCCOOR y GetParcel reales, agujeros y varias partes, Latin-1, excepciones OGC, entradas hostiles y lectura con tope"],
  ["pnoahisttest.js", "PNOA histórico: descubrimiento de capas del WMS del IGN"],
  ["copernicustest.js", "Copernicus DEM: instance ID de Sentinel Hub y sus capas"],
  ["customtiles.js", "Custom Tile Map Service: validación de la URL del servidor, normalización y plantilla XYZ"],
  ["tilediag.js", "Teselas de un servidor propio con error: qué dijo el servidor en lugar de la imagen"],
  ["customwms.js", "Custom Web Map Service: dirección, GetCapabilities y capas del servidor del usuario"],
  ["navtest.js",    "Navegación del árbol y selección por rangos"],
  ["a11ytreetest.js", "Accesibilidad del árbol: role=group del <ul> raíz, aria-label de las casillas"],
  ["selcorrect.js", "Selección: cursor y nodos de nivel superior"],
  ["reporttest.js", "Informe de importación"],
  ["placemarklayertest.js", "buildPlacemarkLayer: un placemark sin geometría útil cuenta una sola vez; PolyStyle.outline no oculta una línea sin polígono"],
  ["newfeat.js",    "Saneado de fichas, Ctrl+A y zonas de arrastre"],
  ["topojsontest.js",     "Conversión de TopoJSON a GeoJSON"],
  ["cogtest.js",          "Ortofotos COG: sistemas admitidos, GeoKeys, nivel y ventana, reparto de la tesela (máscara, nodata, alfa), modelos de elevación (rampa, sombreado, rango), blobs huérfanos y registros ajenos"],
  ["shptest.js",          "Shapefile: agrupar piezas, codificación del .dbf, sin .prj, datum ED50 y reproyección en su sitio"],
  ["groundoverlaytest.js","GroundOverlay: LatLonBox y resolución de assets del KMZ"],
  ["bytesfmt.js",         "Formato de tamaños: bytes/KB/MB/GB"],
  ["reordertest.js",      "Orden de pintado: bringLayerToFront por tipo, reorderPaintOrder por árbol"],
  ["pngnametest.js",      "Nombre de archivo del PNG exportado: marca de tiempo con zero-padding"],
  ["geojsonnametest.js",  "Propiedad-nombre de GeoJSON, tabla de properties y menú contextual con varias capas"],
  ["cascadetest.js",      "Cascada de visibilidad por lotes: cesión del hilo, doble toggle rápido, borrado a mitad"],
  ["lazytree.js",         "Construcción perezosa de filas para carpetas colapsadas (materializeRecords/ensureMaterialized)"],
  ["treefilter.js",       "Filtro del árbol, lo puro: normalización sin tildes ni mayúsculas, clave de filas y registros con su caché, recuento en carpetas sin desplegar y criterio de qué se construye"],
  ["pointsedit.js", "Editor de la lista de puntos: formato TSV, anillos, errores"],
  ["msglog.js", "Avisos: fusión de repetidos con contador y registro de sesión"],
  ["naming.js", "Autonumerado de formas dibujadas y mediciones"],
  ["measure.js", "Mediciones: estilo propio, medidas del diálogo, ruta multi-waypoint y renombrado sin perder la medida"],
  ["schemaupgrade.js", "Subida silenciosa de TREE_SCHEMA v6 a v7: measure.a/b a measure.waypoints"],
  ["splitsave.js", "Guardado en dos niveles: esqueleto y segmentos, ida y vuelta exacta, solo lo cambiado, copias compartidas, auto-reparación, lo que falta, y qué fundir al arrancar"],
  ["vertexedit.js", "Edición interactiva de vértices de un polígono: arrastrar, borrar, mínimo por anillo, tope"],
  ["icons.js", "Iconos MDI empotrados: catálogo y tabla sincronizados, sin red en ejecución"],
  ["boot.js", "Arranque: el panel no concluye «no hay capas» antes de leer IndexedDB"],
  ["attribution.js", "Línea inferior del visor: versión, enlace al repositorio y escala"],
  ["xmllookup.js", "Búsquedas por nombre local en el XML: mismos resultados que antes y sin el recorrido de todos los descendientes por búsqueda vacía"],
  ["offline.js", "Uso sin conexión: qué guarda y qué deja pasar el service worker, qué acepta de la lista de la página, red primero con tope para el HTML y caché primero para las librerías, y la lista que manda la página sobre el HTML entregado"],
  ["lazylibs.js", "Librerías bajo demanda: mismo origen, versión y SRI, nadie usa el global sin ensureLib, una sola carga y un fallo que no se queda pegado"],
  ["minified.js", "kitelocal.min.html: el minificado que sirve Pages no viene roto del proceso"],
  ["statics.js", "Comprobaciones estáticas: sin bytes NUL, todo id referido existe, toda función llamada está declarada, ningún nombre declarado dos veces y los diálogos de un solo botón lo llevan arriba a la derecha"],
  ["tristate.js", "Tercer estado de la casilla: indeterminada cuando la carpeta está a medias"],
  ["urlimport.js", "Reconocer lo descargado de una URL: nombre, tipo por contenido (KMZ o shapefile en zip) y extensión sintetizada"],
  ["multiedit.js", "Edición en bloque: qué se aplica a todos cuando los nodos no coinciden"],
  ["usage.js", "Pie del panel: la línea de memoria se esconde si no hay cifra que dar"],
  ["clipboard.js", "Portapapeles del sistema: copiar y pegar entre instancias de distinto dominio"],
  ["hittest.js", "Acierto bajo el cursor: geometría real, no caja envolvente"],
  ["openshape.js", "Formas abiertas: una línea no tiene área ni relleno"],
  ["polyarea.js",         "Perímetro y área de polígonos: anillos cerrados/sin cerrar, agujeros, multipolígono"],
  ["geocalc.js",          "Calculadora geodésica: elevación, cono, corrección por presión (ISA) y vector GPS, con su validación"],
  ["toolstest.js",        "showLayerInfo/setTool: el panel de información no se cuela ni queda pegado al salir de una herramienta de dibujo"],
  ["rotation.js",         "Rotación del mapa: ángulo de la brújula, giro con el botón central, recorte de la retícula y arrastre limitado al mundo con el mapa girado; giro, transform y caja envolvente del código incorporado, y versión de Leaflet fijada"],
  ["placecoords.js", "Buscador de lugares: reconocer unas coordenadas escritas (decimales con punto o coma, GMS con letras de hemisferio en cualquier orden) y rechazar lo que no lo es (lugares, direcciones, latitudes imposibles, cifras sueltas)"],
  ["profileexport.js", "Exportar el perfil de ruta a CSV: una fila por distancia de cualquier serie, huecos vacíos, unidades de la gráfica, posición de cada punto, torres, línea de vista y Fresnel al 60 %, y sin notación científica"],
  ["profileobstacles.js", "Polígonos con altitud como obstáculos del perfil: cruces de la ruta con un polígono (interpolación en el lado cortado, agujeros, cóncavos, ruta que empieza dentro), techo AMSL y AGL sobre el terreno del perfil, qué obstáculos tapan la línea inicio–fin y por dónde, modo de altitud del KML y validación de obstáculos y torres guardados"],
  ["attrstyle.js", "Estilo por atributo: paletas, rampa, rupturas (iguales y cuantiles), categorías con «Otros» y «sin valor», graduado, y el estilo de un marcador"],
  ["attrtable.js", "Tabla de atributos: columnas, orden (numérico, texto, vacíos al final), filtro, CSV con defensa de fórmulas, filas de carpetas sin desplegar y lectura de <ExtendedData> de KML"],
  ["viewlink.js", "Enlace a la vista: construir y leer #map=…, qué mapas base viajan, ida y vuelta, giro normalizado y entrada hostil rechazada"],
  ["rings.js", "Anillos de alcance y sectores: vértices a su radio, sentido horario y apertura por el norte, coronas, radiales, antimeridiano, lista de radios y tope de anillos"],
  ["gpxtest.js", "Importar GPX: waypoints, rutas y tracks de varios segmentos, altitud y tiempos, GPX 1.0 y 1.1, con prefijo, entradas hostiles, ajuste de redondeo avisado y cota de puntos"],
  ["exportformats.js",   "Exportar a KML y GeoJSON: registros a texto, estilos, altitud, mediciones, ida y vuelta por el importador y lo que se deja fuera"],
  ["view-keys.js",        "Teclado y rueda del visor: velocidad de las flechas mantenidas, dirección combinada y nivel final del zoom continuo (teclas y rueda)"],
  ["i18n.js",             "Idiomas de la interfaz: cada texto con su traducción al inglés y marcadores iguales, ningún literal en español fuera de tr(), diccionarios en el manifiesto, y el motor (respaldo inglés → español, plurales, contexto, «Automático»)"]
];
const BENCH = [["selbench.js", "Coste de seleccionar y de topLevelSelection"]];

/* Suites que necesitan un NAVEGADOR de verdad. Prueban lo que Node no
   puede decir: que la aplicación arranque, que los iconos empotrados se
   pinten, que el minificado se comporte igual que el legible y que el
   portapapeles del sistema lleve un árbol de una instancia a otra.
   Todo eso se comprobaba a mano, fuera del repositorio, y por tanto
   casi nunca.                                                        */
const BROWSER = [
  ["browser/app.mjs", "Navegador: la aplicación arranca y funciona, en los DOS artefactos"],
  ["browser/clipboard.mjs", "Navegador: copiar y pegar entre instancias de distinto origen, con el portapapeles real"],
  ["browser/sun-times-info.mjs", "Navegador: horas del sol y crepúsculos en la ficha de un marcador con la iluminación real activa"],
  ["browser/geojson-name.mjs", "Navegador: nombre de GeoJSON con varias claves, selección guardada sin preguntar, cancelar y cambiarla desde Propiedades"],
  ["browser/geojson-html.mjs", "Navegador: etiquetas tipo HTML en properties de GeoJSON, de punta a punta"],
  ["browser/seam-outline.mjs", "Navegador: polígonos de solo relleno sin costura ni contorno entre ellos (tandas compuestas con la opacidad una sola vez), coste acotado y opacidad del contorno en Propiedades, sin tocar lo guardado"],
  ["browser/dialogs.mjs", "Navegador: las ventanas fijan cabecera y pie, y se redimensionan"],
  ["browser/split-save.mjs", "Navegador: guardado en dos niveles — plegar, marcar y borrar solo reescriben el esqueleto; disco = memoria tras borrar, mover, ordenar, cortar, pegar, editar una copia, deshacer y 200 operaciones aleatorias; fusión al arrancar, archivo soltado al arrancar, dos pestañas y subida desde la base v4"],
  ["browser/tree-move.mjs", "Navegador: mover un nodo de rama recalcula la casilla de los dos extremos"],
  ["browser/multiedit.mjs", "Navegador: editar varios nodos a la vez y el nombre siempre a la vista de un trazo"],
  ["browser/live-preview.mjs", "Navegador: el diálogo de estilos aplica en vivo tamaño, icono y color, y Cancelar los revierte"],
  ["browser/lazy-cascade.mjs", "Navegador: desplegar y marcar una carpeta grande a la vez no la deja a medio encender"],
  ["browser/tree-filter.mjs", "Navegador: filtro del árbol con teclado y ratón reales — filtra a la 3.ª letra o con Intro, sin tildes ni mayúsculas y dentro de las palabras; no toca lo guardado ni collapsed; carpetas sin desplegar con «(n)» sobre el tope y solo las coincidentes por debajo; desplegar con el filtro construye solo lo que coincide; la × y Escape lo quitan; el teclado y Ctrl+A saltan lo oculto; lo nuevo se filtra solo; y lo guardado a medio construir es lo mismo, en el mismo orden, también tras recargar"],
  ["browser/measure-dialog-live.mjs", "Navegador: el diálogo de una medición se repinta en vivo al arrastrar, y 🔍 la encuadra con margen"],
  ["browser/vertex-select.mjs", "Navegador: seleccionar un vértice, Mayús+clic para insertar y Supr para borrar — en rutas y polígonos, sin diálogo"],
  ["browser/context-menu.mjs", "Navegador: menú contextual del visor — «Editar propiedades» abre el diálogo de propiedades (Estilos y Atributos)"],
  ["browser/route-live-draw.mjs", "Navegador: crear una ruta se comporta como editarla, con su diálogo abierto y en vivo desde el 2º waypoint"],
  ["browser/props-panel.mjs", "Navegador: panel Propiedades — unidad y formato de coordenadas globales, con Cancelar/Aceptar de verdad"],
  ["browser/perf-markers.mjs", "Navegador: índice de oyentes de Leaflet — mismo comportamiento con y sin el parche, trabajo y tiempo al añadir miles de marcadores"],
  ["browser/offline.mjs", "Navegador: uso sin conexión — el worker guarda las librerías y la página, recargar sin red arranca con el árbol guardado y las librerías bajo demanda, una red colgada saca la copia, y con red se ve la versión nueva"],
  ["browser/lazy-libs.mjs", "Navegador: html2canvas, geotiff.js y proj4 bajo demanda — el arranque ya no las descarga, una sola petición, el SRI sigue bloqueando y el PNG funciona"],
  ["browser/mobile-notice.mjs", "Navegador: aviso al abrir desde un móvil — «Continuar» deja solo el mapa, el panel cabe y su flecha es alcanzable, se recuerda, y no lo reciben una tableta ni un escritorio estrecho"],
  ["browser/theme.mjs", "Navegador: tema de la interfaz — automático según el sistema, claro/oscuro forzados, Cancelar/Aceptar y recarga, sin tocar el mapa"],
  ["browser/motion.mjs", "Navegador: movimiento y respuesta — con movimiento reducido nada se anima; sin él el menú y las ventanas entran (120/160 ms, el menú desde el punto pulsado y sin pasarse del borde), cerrar es inmediato, el botón responde al pulsar, el separador va con Pointer Events (agarre, captura, un invalidateSize por fotograma, nada en móvil), el tema se suaviza, la caja de coordenadas es un material y el título lleva tracking negativo"],
  ["browser/arcgis.mjs", "Navegador: servicios ArcGIS (MapServer) como nodo del árbol — alta desde 🔗 leyendo solo el catálogo, filas por capa, layers=show de lo marcado con un solo redibujado, caja de cada tesela frente a Leaflet (también girado), opacidad, «Traer como datos» (páginas, etiquetas HTML, errores, reintento, tope y cancelación), recarga sin catálogo, borrar y deshacer, lo ajeno llega apagado y un servicio que falla se ve"],
  ["browser/custom-wms.mjs", "Navegador: mapas base propios — Custom Tile Map Service renombrada y Custom Web Map Service con su GetCapabilities, capas, versión del servidor, recarga y errores"],
  ["browser/url-import.mjs", "Navegador: añadir desde una dirección, en dos pasos y con cancelación"],
  ["browser/cog.mjs", "Navegador: ortofotos COG — UTM 30N y Web Mercator en su sitio, vista general, malla frente a proj4, giro, opacidad, MDT con altitud bajo el cursor, recargar, deshacer, limpieza de blobs y subida de la base v3"],
  ["browser/shp-import.mjs", "Navegador: shapefiles — piezas sueltas, .zip y 🔗, EPSG:25830 en su sitio, codificación, ED50 y huérfanos"],
  ["browser/oneworld.mjs", "Navegador: una sola Tierra — sin copias en horizontal, con tope de arrastre y suelo de zoom"],
  ["browser/undo-create.mjs", "Navegador: crear un marcador, un polígono o una medición se puede deshacer y rehacer"],
  ["browser/arc-draw.mjs", "Navegador: medir un arco — centro, inicio y recorrido del perímetro, guardado como ruta de N tramos"],
  ["browser/rotation.mjs", "Navegador: rotación del mapa — brújula, botón central, R, etiquetas horizontales, detección de capas, consulta de elevación deshabilitada, PNG y bordes del mundo"],
  ["browser/rotation-core.mjs", "Navegador: giro incorporado — conversiones, marcadores, etiquetas, popups, arrastre, teselas, encuadre y pellizco con el mapa girado"],
  ["browser/keyboard-nav.mjs", "Navegador: teclado y rueda del visor — flechas, Re/Av Pág y rueda continuos, y el foco que se queda en el visor"],
  ["browser/elev-sources.mjs", "Navegador: fuentes de elevación en Propiedades y consulta puntual desde el menú contextual — carpeta por sesión, unidad de altitud, GeoTIFF, MDT25, reintentos y descubrimiento una vez por sesión"],
  ["browser/elev-font.mjs", "Navegador: tamaño de las cifras de elevación (A− / A+ encima de la escala) — solo con una cuadrícula visible, se recuerda al recargar, y unas cifras que no caben en su celda se sustituyen por el relleno rojo o blanco del zoom 18"],
  ["browser/kmz-limit.mjs", "Navegador: tamaño máximo de un KMZ descomprimido en Propiedades — 500 MB de partida, un KMZ que lo supera se rechaza diciendo tamaño y límite, subirlo lo deja entrar, fuera de rango se ajusta, Cancelar no guarda y Aceptar sobrevive a recargar"],
  ["browser/elev-profile.mjs", "Navegador: perfil de una ruta — MDT y MDS por trozos, dos curvas, lectura con MDS−MDT, × arriba a la derecha, registro de la descarga, «Mostrar perfil» sin red, flecha en el mapa, zoom de cada eje, bloqueo del eje Y, solo segmentos rectos, malla común con la consulta puntual, clic derecho con el perfil debajo, huecos y cancelar"],
  ["browser/base-panel-close.mjs", "Navegador: la lista de mapas base se cierra al actuar fuera (clic en el mapa, el árbol o la cabecera, o una tecla), no con lo que se hace dentro ni con el selector de color, y Escape cierra antes lo que tenga encima"],
  ["browser/draw-pan.mjs", "Navegador: desplazar el mapa arrastrando mientras se dibuja un polígono o una ruta (el clic tras el arrastre no añade vértice), arrastrar un vértice no hace pan, el doble clic sigue cerrando, y el círculo y el arco siguen dibujando al arrastrar"],
  ["browser/click-to-place.mjs", "Navegador: pin, anillos de alcance y sector son herramientas de un clic: el clic fija el centro y abre sus propiedades (Cancelar no deja nada), Escape y otro botón las cancelan, el «Pin» del menú contextual usa el punto pulsado, arrastrar el mapa no las dispara y no resaltan la capa de debajo"],
  ["browser/style-dialog-actions.mjs", "Navegador: lupa y Borrar en el diálogo de propiedades — con una capa, igual que las de su fila del árbol (borrar sin preguntar y deshacer devuelve el estilo original); con varias, la lupa encuadra el conjunto y Borrar pide confirmación (Cancelar, × y Escape no borran); un pin nuevo no lleva Borrar; el × del árbol sigue igual"],
  ["browser/elev-obstacles.mjs", "Navegador: polígonos con altitud como obstáculos del perfil — el modo de altitud del KML se conserva (y avisa una vez por archivo lo del fondo marino), el perfil recoge los visibles que cruzan la ruta (AMSL con su techo, AGL sobre el terreno del perfil sin peticiones nuevas), bloques en la gráfica con la frase de qué tapa la línea, lectura bajo el cursor, obstáculos y torres guardados con el perfil, «Actualizar obstáculos», el modo en la lista de puntos del polígono, y que mover o insertar un vértice con el ratón conserva las altitudes del resto"],
  ["browser/cadastre.mjs", "Navegador: parcela catastral desde el menú contextual — capa y ficha, dos peticiones simples, repetir no pide el polígono, sin parcela, excepción OGC sin reintentos, 503 reintentado con cursor de espera, deshacer, recargar y atribución"],
  ["browser/geocalc.mjs", "Navegador: calculadora geodésica — dos pestañas que se recalculan solas, presión, unidades que convierten, sin crecer y no modal"],
  ["browser/attr-style.mjs", "Navegador: estilo por atributo — categorías y graduado desde la tabla de una carpeta cerrada, vista previa en vivo, Cancelar y Escape lo devuelven todo, Aceptar sin desplegar con deshacer y recarga, y marcadores"],
  ["browser/attr-table.mjs", "Navegador: tabla de atributos de una carpeta — <ExtendedData> de KML, sin desplegar la carpeta, filtro, orden numérico, CSV real (con punto y coma en español y, cambiando el idioma, con comas en inglés) con defensa de fórmulas, ir a una capa, recargar y 5 000 capas con solo las filas visibles"],
  ["browser/view-link.mjs", "Navegador: enlaces a la vista — abrir #map=… manda sobre lo guardado y se quita de la dirección, copiarlo con el portapapeles real, abrirlo en otra pestaña, pegarlo con la aplicación abierta y direcciones manipuladas"],
  ["browser/rings.mjs", "Navegador: anillos de alcance y sectores desde «Crear» — el centro es el punto pulsado, vista previa en vivo, entradas inválidas con su motivo, Cancelar y Escape sin dejar nada, carpeta de anillos a su radio, deshacer, sector entre azimuts, y recargar (también cruzando el antimeridiano)"],
  ["browser/gpx-import.mjs", "Navegador: importar un GPX — waypoints, ruta y track con su <name> sin selector, altitud y tiempos, la pregunta de las etiquetas HTML y el fallo limpio de lo que no es un GPX"],
  ["browser/export-menu.mjs", "Navegador: el menú de 💾 — se abre y se cierra (Escape, clic fuera, segunda pulsación), exporta KML, GeoJSON y .kite.json con descarga real, sin desplegar la carpeta, y el KML vuelve a importarse"],
  ["browser/restore-db.mjs", "Navegador: Propiedades › Restaurar — la pestaña y su botón solo abren una segunda confirmación, Cancelar, la × y Escape no borran nada (y Escape no cierra Propiedades), la guardia impide que un guardado recree la base, y «Borrar todo» recarga con la base vacía conservando el idioma"],
  ["browser/app-sections.mjs", "Navegador: las secciones que crea la aplicación (Marcadores, Mediciones…) van en azul pastel, distinto de un archivo y de una fila con el ratón encima, en claro y oscuro; se guardan como sec, sobreviven a recargar, un árbol anterior las recibe al usarlas y sec ajeno solo vale como true exacto en un archivo"],
  ["browser/context-pending.mjs", "Navegador: el clic derecho sobre una capa de una carpeta nunca desplegada (tras recargar) la materializa y ofrece sus entradas, y una ruta con su perfil ofrece «Mostrar perfil» con «Mediciones» y «Perfiles de ruta» desplegadas o colapsadas"],
  ["browser/place-coords.mjs", "Navegador: unas coordenadas escritas en el buscador crean un marcador en «Lugares» y llevan el mapa allí a zoom 17 sin ninguna petición a Nominatim (con Intro y con el botón), un lugar sigue yendo a Nominatim, y una búsqueda en vuelo no repinta tras unas coordenadas"],
  ["browser/lazy-layers.mjs", "Navegador: un placemark apagado de polígonos o líneas guarda solo su GeoJSON (igual que toGeoJSON() de Leaflet, con un corpus) y su capa se construye al leerla: guardar, encuadrar, atributos y borrar no la construyen; recargar los deja perezosos; encender los construye"],
  ["browser/focus-zoom.mjs", "Navegador: la lupa de un marcador centra el visor y acerca al zoom 14, siempre igual, y un polígono se encuadra entero sin ese zoom"],
  ["browser/i18n.mjs", "Navegador: idioma de la interfaz — «Automático» según el navegador, español e inglés sin español colado, el ajuste de Propiedades (guarda al Aceptar, vale al recargar) y un idioma nuevo sin tocar código"]
];

const html = path.join(__dirname, "..", "kitelocal.html");
if (!fs.existsSync(html)) {
  console.error(`No se encuentra ${html}. Los tests deben ir junto al visor.`);
  process.exit(2);
}

/* Las dependencias se comprueban antes de lanzar nada: si faltan, todas
   las suites fallarían con un error de módulo que no dice qué hacer. */
const DEPS = ["linkedom", "@xmldom/xmldom"];
const missing = DEPS.filter(d => {
  try { require.resolve(d); return false; } catch { return true; }
});
if (missing.length) {
  console.error(`Faltan dependencias de prueba: ${missing.join(", ")}\n`
    + `Instálelas con:\n\n    npm install ${DEPS.join(" ")}\n\n`
    + "Solo hacen falta para los tests; el visor no depende de ellas.");
  process.exit(2);
}

/* kitelocal.html es GENERADO desde src/. Las suites lo leen a él, que es
   lo que se entrega, así que hay que asegurarse de que corresponde a las
   fuentes actuales: si no, se probaría una versión vieja y pasarían
   pruebas que no dicen nada del código que se acaba de escribir.
   Se COMPRUEBA, no se construye: un runner de pruebas que reescribe un
   archivo del repo ensucia el árbol de trabajo sin avisar y, peor,
   enmascara justo este error. La comparación es por CONTENIDO, nunca
   por fecha: los mtime no sobreviven a un `git checkout`.
   Cubre también kitelocal.min.html, la derivada que sirve Pages: es el
   artefacto que nadie mira, así que es justo el que se queda atrás. Y
   sw.js (el service worker del uso sin conexión), copia de src/sw.js.  */
try {
  execFileSync(process.execPath, [path.join(__dirname, "..", "build.js"), "--check"], { stdio: "pipe" });
  console.log("✓ kitelocal.html, kitelocal.min.html y sw.js están al día respecto de src/");
} catch (e) {
  console.error((e.stdout || "") + (e.stderr || ""));
  process.exit(1);
}

/* Antes que nada, lo más barato: que el script sea válido */
const script = fs.readFileSync(html, "utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];
const tmp = path.join(require("os").tmpdir(), "kite-script-check.js");
fs.writeFileSync(tmp, script);
try {
  execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  console.log("✓ node --check del script incrustado");
} catch (e) {
  console.error("✗ el script incrustado no es válido\n" + e.stderr);
  process.exit(1);
}

const run = list => list.reduce((failed, [file, desc]) => {
  process.stdout.write(`\n── ${desc}\n`);
  try {
    console.log(execFileSync(process.execPath, [path.join(__dirname, file)],
      { encoding: "utf8", stdio: "pipe" }).trim());
    return failed;
  } catch (e) {
    console.error((e.stdout || "") + (e.stderr || ""));
    return failed + 1;
  }
}, 0);

/* El navegador es OPCIONAL en local y OBLIGATORIO en el CI.
   Opcional para que `npm test` funcione en cualquier entorno: quien no
   pueda o no quiera descargar 300 MB sigue teniendo las suites de Node.
   Obligatorio en el CI (KITE_REQUIRE_BROWSER=1) para que esa cobertura
   no se pierda en silencio, que es lo que pasaría si saltarse las
   pruebas fuera gratis en todas partes.                              */
function runBrowserSuites() {
  let detail = "";
  try {
    execFileSync(process.execPath, [path.join(__dirname, "browser", "_detect.mjs")], { stdio: "pipe" });
  } catch (e) {
    detail = String(e.stderr || "").trim();
    const msg = "No hay navegador disponible para las pruebas de navegador.\n"
      + (detail ? `  Motivo: ${detail}\n` : "")
      + "  Instálelo con:  npx playwright install chromium\n"
      + "  O apunte a uno ya instalado:  KITE_BROWSER=/ruta/al/chrome npm test";
    if (process.env.KITE_REQUIRE_BROWSER) {
      console.error(`\n✗ ${msg}\n  (KITE_REQUIRE_BROWSER está puesto: esto es un fallo, no un salto)`);
      return { failed: 1, ran: 0 };
    }
    console.log(`\n⚠ ${msg}\n  Se SALTAN ${BROWSER.length} suite(s) de navegador.`);
    return { failed: 0, ran: 0 };
  }
  return { failed: run(BROWSER), ran: BROWSER.length };
}

const failed = run(SUITES);
const browser = runBrowserSuites();
if (process.argv.includes("--bench")) run(BENCH);

const total = SUITES.length + browser.ran;
console.log(failed + browser.failed
  ? `\n${failed + browser.failed} suite(s) con fallos.`
  : `\nTodas las suites (${total}) han pasado.`
    + (browser.ran ? "" : " (sin las de navegador)"));
process.exit(failed + browser.failed ? 1 : 0);
