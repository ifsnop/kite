# claude.md — Guía de desarrollo de KITE Local

**KITE Local** = *KML Interactive Tree Explorer*.

Instrucciones para seguir añadiendo funcionalidades a `kitelocal.html`
(el producto es KITE Local; el archivo se llamó `kitelocal.html` en
versiones anteriores) manteniendo los principios acordados durante el
desarrollo del proyecto.

## Este archivo es un ÍNDICE

Este documento pesaba antes ~3300 líneas y se cargaba entero en cada
conversación. Se ha repartido en `.claude/rules/`, un archivo por
subsistema, cada uno con una cabecera `paths` que le dice al agente
CUÁNDO cargarlo: solo al leer o tocar archivos que casen esos patrones.
Así, trabajar en `60-elevation.js` ya no carga las 400 líneas del
selector de color o las de Copernicus.

**`.claude/rules/00-principles.md` no lleva `paths` y se carga
siempre**: ahí viven los principios no negociables del proyecto, el
vocabulario, la lista de pendientes y el checklist para añadir una
funcionalidad. Léelo primero si es tu primera vez en este repositorio.

Si tocas algo que no está claramente cubierto por ninguna de las reglas
de abajo, revisa igualmente `00-principles.md` (los principios generales
aplican siempre) y usa el juicio: probablemente falte documentar un caso
nuevo, no que la regla no exista.

## Mapa de reglas (`.claude/rules/`)

| Archivo | Contenido | Se carga al tocar |
|---|---|---|
| `00-principles.md` | Principios no negociables, vocabulario, pendientes, checklist | **siempre** |
| `architecture.md` | Orden y dependencias del manifiesto de `src/js` | `src/js/**`, `build.js` |
| `import-parsing.md` | Parseo KML/KMZ/GeoJSON y shapefile (piezas, `.prj`, ED50, codificación), namespaces, estilos, tolerancias, duplicados | `20-kml-geom.js`, `32-geojson.js`, `33-kml-import.js`, `34-shp-import.js` |
| `build-and-release.md` | `build.js`, minificado, SRI, versión y proceso de release | `build.js`, `package.json`, `src/index.html`, `scripts/hooks/**`, `fetch-icons.js`, `.github/workflows/**` |
| `tree-navigation-selection.md` | Árbol: visibilidad, checkbox de tres estados, teclado, selección, exportar/importar carpetas, arrastrar y soltar, deshacer/rehacer | `30-tree-walk.js`, `31-tree-node.js`, `40-panel-actions.js`, `41-selection.js`, `70-view-controls.js` |
| `multi-edit-clipboard.md` | Editar varios nodos a la vez, portapapeles interno y del sistema | `44-dialogs.js`, `41-selection.js`, `40-panel-actions.js` |
| `style-dialogs-ui.md` | Diálogo de estilos de capa, selector de color propio, mecánica de ventanas, ficha de información | `44-dialogs.js`, `43-points-editor.js` |
| `dialog-close-button.md` | Regla: un diálogo cuyo único botón es el de cerrar lo lleva como × arriba a la derecha, sin pie | `src/index.html`, `src/styles.css`, `43-points-editor.js`, `44-dialogs.js` |
| `measurements-drawing-vertex-editing.md` | Mediciones (ruta/círculo), dibujo de formas, edición interactiva de vértices | `52-measure.js`, `43-points-editor.js` |
| `marker-icons.md` | Iconos MDI empotrados sin red, cómo ampliar el catálogo | `05-mdi-icons.js`, `fetch-icons.js` |
| `units-coordinates-properties-panel.md` | Unidades de distancia y de altitud, formato de coordenadas, límite del perfil, panel Propiedades | `44-dialogs.js`, `43-points-editor.js` |
| `geocalc.md` | Calculadora geodésica (botón 📐): pestañas (elevación con cono y corrección por presión, vector GPS), cálculo inmediato, unidades copiadas de Propiedades (distancia y altitud), modelos de Tierra | `62-geocalc.js` |
| `elevation-dem.md` | Elevaciones MDT/MDS por WCS: catálogo por conjunto de datos (IGN MDT05/25/200 y MDS, Digital Earth Africa), consulta puntual desde el menú contextual, carpeta por sesión, ASCII/GeoTIFF, reintentos, unidad de altitud, perfil de una ruta | `60-elevation.js`, `63-route-profile.js` |
| `mobile-view.md` | Aviso «Mejor desde un ordenador» en un móvil, solo el mapa si se insiste, diseño de móvil (panel a pantalla completa), elección recordada | `50-splitter.js`, `99-boot.js`, `index.html`, `styles.css` |
| `theme.md` | Tema claro/oscuro de la interfaz: tokens `light-dark()`, `data-theme`, ajuste Tema de Propiedades, qué se tematiza (el cromo) y qué no (el contenido del mapa) | `styles.css`, `index.html`, `43-points-editor.js`, `99-boot.js` |
| `cog.md` | Ortofotos COG: almacén `rasters` (Blob nativo), validación antes de copiar, CRS admitidos, `GridLayer` reproyectada por malla, niveles, limpieza al arrancar, lo que no se exporta | `64-cog.js`, `32-geojson.js`, `99-boot.js` |
| `offline.md` | Uso sin conexión: service worker `sw.js` (generado desde `src/sw.js`), qué guarda y qué deja pasar, lista de librerías mandada por la página, indicador «Sin conexión», `netFailText` | `src/sw.js`, `06-offline.js`, `07-lazy-libs.js`, `99-boot.js`, `build.js` |
| `i18n.md` | Idiomas de la interfaz (español, inglés, y cómo añadir otro): el texto en español es la clave, `tr()`/`trn()`/`trc()`/`N_()`, diccionarios, preferencia, HTML estático, `i18n-tool.js`, pruebas | `src/js/**`, `src/index.html`, `src/styles.css`, `i18n-tool.js`, `tests/i18n.js`, `tests/browser/i18n.mjs`, `tests/_extract.js` |
| `accessibility.md` | ARIA del árbol y de los diálogos | `src/js/**`, `src/index.html` |
| `persistence-indexeddb.md` | `DB_VERSION`/`TREE_SCHEMA`, serialización del árbol, claves del almacén | `src/js/**` |
| `external-network.md` | Disciplina de peticiones de red externa (tope, tiempo por intento, reintentos de lo pasajero) | `40-panel-actions.js`, `60-elevation.js`, `63-route-profile.js`, `12-copernicus.js` |
| `base-maps.md` | Capas base, fuentes dinámicas, color de fondo, apilado | `10-map.js`, `11-base-panel.js`, `12-copernicus.js` |
| `url-import.md` | Botón 🔗, descarga de una URL en dos pasos | `40-panel-actions.js`, `src/index.html` |
| `context-menu.md` | Menú contextual del visor, hit-testing por geometría | `42-hittest.js`, `70-view-controls.js` |
| `map-rotation.md` | Rotación del mapa (código propio derivado de leaflet-rotate): qué se conservó y qué no, pellizco, fallos del plugin corregidos, brújula, botón central, tecla R, «una sola Tierra» girada, etiquetas horizontales, retícula, día/noche, consulta de elevación, PNG | `08-map-rotation.js`, `10-map.js`, `42-hittest.js`, `60-elevation.js`, `61-daynight.js`, `70-view-controls.js` |
| `view-controls-map.md` | Vista guardada, uso de almacenamiento/memoria, una sola Tierra, teclado y rueda del visor (flechas, Re/Av Pág y rueda continuos; el foco se queda en el visor), zoom sobre teselas, cuadro de coordenadas y atribución | `10-map.js`, `70-view-controls.js`, `99-boot.js` |
| `performance.md` | Reglas de rendimiento nacidas de medir | `src/js/**` |
| `browser-tests.md` | Suites de Playwright (`tests/browser`) | `tests/browser/**` |
| `static-checks.md` | Comprobaciones estáticas sobre `kitelocal.html` | `tests/statics.js`, `tests/minified.js`, `tests/attribution.js` |
| `docs-maintenance.md` | Mantenimiento obligatorio de `docs/` | `docs/**` |

**Al reorganizar `.claude/rules/` en el futuro**: la fuente de verdad de
cada regla es su propio archivo, no este índice. Si se añade, renombra o
retira un archivo de reglas, actualizar esta tabla es parte del mismo
cambio — igual que el resto de documentación complementaria del
proyecto (ver `docs-maintenance.md`).
