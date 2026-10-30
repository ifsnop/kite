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
  ["profileexport.js", "Exportar el perfil de ruta a CSV: una fila por distancia de cualquier serie, huecos vacíos, unidades de la gráfica, posición de cada punto y sin notación científica"],
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
  ["browser/elev-profile.mjs", "Navegador: perfil de una ruta — MDT y MDS por trozos, dos curvas, lectura con MDS−MDT, × arriba a la derecha, registro de la descarga, «Mostrar perfil» sin red, flecha en el mapa, zoom de cada eje, bloqueo del eje Y, solo segmentos rectos, malla común con la consulta puntual, clic derecho con el perfil debajo, huecos y cancelar"],
  ["browser/cadastre.mjs", "Navegador: parcela catastral desde el menú contextual — capa y ficha, dos peticiones simples, repetir no pide el polígono, sin parcela, excepción OGC sin reintentos, 503 reintentado con cursor de espera, deshacer, recargar y atribución"],
  ["browser/geocalc.mjs", "Navegador: calculadora geodésica — dos pestañas que se recalculan solas, presión, unidades que convierten, sin crecer y no modal"],
  ["browser/attr-style.mjs", "Navegador: estilo por atributo — categorías y graduado desde la tabla de una carpeta cerrada, vista previa en vivo, Cancelar y Escape lo devuelven todo, Aceptar sin desplegar con deshacer y recarga, y marcadores"],
  ["browser/attr-table.mjs", "Navegador: tabla de atributos de una carpeta — <ExtendedData> de KML, sin desplegar la carpeta, filtro, orden numérico, CSV real con defensa de fórmulas, ir a una capa, recargar y 5 000 capas con solo las filas visibles"],
  ["browser/view-link.mjs", "Navegador: enlaces a la vista — abrir #map=… manda sobre lo guardado y se quita de la dirección, copiarlo con el portapapeles real, abrirlo en otra pestaña, pegarlo con la aplicación abierta y direcciones manipuladas"],
  ["browser/rings.mjs", "Navegador: anillos de alcance y sectores desde «Crear» — el centro es el punto pulsado, vista previa en vivo, entradas inválidas con su motivo, Cancelar y Escape sin dejar nada, carpeta de anillos a su radio, deshacer, sector entre azimuts, y recargar (también cruzando el antimeridiano)"],
  ["browser/gpx-import.mjs", "Navegador: importar un GPX — waypoints, ruta y track con su <name> sin selector, altitud y tiempos, la pregunta de las etiquetas HTML y el fallo limpio de lo que no es un GPX"],
  ["browser/export-menu.mjs", "Navegador: el menú de 💾 — se abre y se cierra (Escape, clic fuera, segunda pulsación), exporta KML, GeoJSON y .kite.json con descarga real, sin desplegar la carpeta, y el KML vuelve a importarse"],
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
