---
description: Principios no negociables, vocabulario y checklist de KITE Local. Se carga siempre.
---

## Principios de base (no negociables)

1. **Un único archivo HTML como PRODUCTO; las fuentes, repartidas.**
   Se distribuye `kitelocal.html` (HTML+CSS+JS plano, abre con doble
   clic). Es **GENERADO**: se edita `src/` y se construye con
   `npm run build` (`build.js`, ver `build-and-release.md`). Sin
   Vue/React/TypeScript/empaquetadores: el build es concatenación
   literal. El producto que se lee/prueba/depura es el legible, sin
   minificar. `build.js` también escribe `kitelocal.min.html`
   (derivada para GitHub Pages; no se edita ni se lee) y `sw.js` (copia
   literal de `src/sw.js`: el service worker del uso sin conexión, que
   no forma parte del producto de un solo archivo —solo importa servido
   por http(s)— pero el navegador exige que sea un archivo propio; ver
   `offline.md`).
   **Nunca se edita a mano un archivo generado** — se pierde en el
   siguiente build. `node tests/run-all.js` comprueba esto primero y
   falla si alguno de los tres no corresponde a `src/`.
2. **Reusar librerías conocidas y estables; no reinventar.** CDN con
   versión fijada: Leaflet 1.9.4, JSZip 3.10.1 (KMZ y .zip de
   shapefile), shapefile 0.6.6 (.shp/.dbf → GeoJSON), y **BAJO
   DEMANDA** (`07-lazy-libs.js`, no bloquean el arranque; ver
   `performance.md`): geotiff.js 2.1.3 (fuentes de elevación sin rejilla
   ASCII, y ortofotos COG), proj4js 2.22.0 (reproyección del `.prj` de
   un shapefile y de las teselas de una ortofoto COG) y html2canvas
   1.4.1 (exportar PNG), Material Design
   Icons EMPOTRADOS sin red en ejecución (`src/js/05-mdi-icons.js`,
   generado por `fetch-icons.js`/`npm run icons` — ver
   `marker-icons.md`), Nominatim (geocodificación; ~1 req/s, solo al
   pulsar Enter/botón, nunca por tecla, `limit=5`), Catastro (parcela
   bajo el clic, solo al pedirla; ver `cadastre.md`). Antes de escribir
   código propio, comprobar si Leaflet ya lo resuelve. Excepción:
   `leaflet-pin` es el PNG de Leaflet, no un SVG de MDI, no coloreable.
   **La rotación del mapa es código INCORPORADO**, no CDN
   (`08-map-rotation.js`, derivado de leaflet-rotate 0.2.8): el plugin
   no se mantenía y ya había que corregirlo; recortado a lo que se usa
   y atado a Leaflet 1.9.4 (ver `map-rotation.md`). Incorporar otra
   librería así exige la misma justificación.
3. **Clean code, and English for everything other collaborators may read.**
   Rule requested by the maintainer (2026-11-09): from now on everything NEW
   that another collaborator can read is written in **English**, so that
   anyone can work on the project: all code comments (JS, CSS, HTML,
   `build.js`, tools and tests), everything on GitHub (commit messages, PR
   titles and descriptions, PR and issue comments and reviews, branch names)
   and any new developer-facing documentation (rule files under
   `.claude/rules/`, `tests/README.md`, `docs/pendientes…`, trail learnings,
   `README.md`). **There is no bulk translation of old text**: existing Spanish
   comments, rules and documents are not translated in a dedicated pass (a
   huge diff with no behavioural effect), so what nobody touches stays as it
   is. **But whatever a change modifies is translated**: when a change
   corrects or edits a line whose comment is in Spanish, that comment is
   rewritten in English in the same change (the same goes for a paragraph of
   a Spanish rule or document that gets edited), and text added to an
   existing Spanish file is written in English. **What stays in Spanish**: UI strings and
   messages to the user, written in Spanish inside `tr("…")` — Spanish is the
   key and English (or any other language) goes in a dictionary; see
   `i18n.md` — and the two documents written for end users and auditors, the
   user manual and the security study (`docs/`). Comments explain the *why*,
   not the *what*. Small functions, one responsibility. After finishing a
   change, `grep` and remove dead references.
4. **Sin código de compatibilidad hacia atrás.** El almacenamiento está
   versionado; lo que no corresponda a la versión actual se BORRA, no
   se migra. No subir versiones sin cambio que lo justifique.
   **Única excepción deliberada**: `TREE_SCHEMA` 6→7 (medición de
   ruta) sube un árbol v6 en silencio con `upgradeMeasuresV6`, por ser
   un cambio de forma trivial y acotado a un solo campo
   (`measure.a/b`→`measure.waypoints`) — no sienta precedente; la
   próxima subida de `TREE_SCHEMA` se evalúa por su cuenta. **Segunda
   excepción, evaluada y decidida con el usuario**: `TREE_SCHEMA` 7→8
   (nodo `cog`) lee un árbol v7 TAL CUAL, sin transformar nada (solo se
   añade un tipo), y `DB_VERSION` 3→4 añade el almacén `rasters` SIN
   vaciar `tree`. **Tercera, también decidida con el usuario**:
   `DB_VERSION` 4→5 (guardado en dos niveles, almacén `segments`) lee un
   `root` v8 con todo en línea TAL CUAL y el primer guardado lo reparte.
   **Cuarta, misma forma que la segunda**: `TREE_SCHEMA` 8→9 (nodos
   `arcgis`/`arcgisLayer`, ver `arcgis.md`) lee un árbol v8 TAL CUAL,
   solo se añaden tipos.
   Ver `persistence-indexeddb.md`.
5. **Robustez ante entradas ajenas.** KML/GeoJSON/KMZ/`.kite.json`/red
   se tratan como hostiles: validar antes de construir capas, aislar
   errores por entidad (una geometría mala no tumba la importación),
   cotas de tamaño/complejidad. Resumen siempre de lo cargado y omitido
   con la causa.
6. **Verificar con tests lo verificable.** Funciones puras (geodesia,
   parseo, orden, serialización) se prueban en Node extrayendo el
   script; `linkedom` para DOM, `@xmldom/xmldom` para XML (linkedom no
   soporta namespaces/`getElementsByTagName("*")`). Mínimo:
   `node --check`. **Toda modificación termina con
   `node tests/run-all.js` completo**, no una suite suelta. Un cambio
   que altera comportamiento cubierto actualiza esa suite EN EL MISMO
   cambio; comportamiento nuevo añade su test (suite nueva en `tests/`
   si no encaja, registrada en `run-all.js`, descrita en
   `tests/README.md`). `tests/README.md` se actualiza en el MISMO
   cambio que la suite (no solo al crearla): «Qué cubre» y, si cambia
   la salida, el bloque «Salida de `npm test`».

## Vocabulario del proyecto

- **Ventana de navegación**: panel izquierdo, árbol de capas.
- **Ventana del visor**: mapa Leaflet a la derecha.
- **Nodo**: cualquier fila del árbol (archivo, carpeta, capa, medición,
  cuadrícula de elevación).
- **Tipo de nodo (`styleKind`)**: `marker` (marcadores), `polygon`
  (polígonos/líneas; mixtos cuentan como `marker`), `measure`
  (medición), `elevGrid` (cuadrícula de elevación), `imageOverlay` y
  `cog` (ortofotos), `arcgis` (un servicio ArcGIS) y `arcgisLayer` (cada
  capa suya, fila fija), `group` (carpeta/archivo).

## Pendiente (conocido y no hecho)

**La lista vive en un solo sitio: `docs/pendientes-y-propuestas-kite-local.md`**
(pendientes conocidos, lo hecho a medias, ideas para desarrollar y lo
descartado a propósito, con su motivo). El README y el manual la enlazan para
que quien lea la documentación la encuentre. Aquí no se duplica:

- **Lo hecho se BORRA de ese documento en el mismo cambio que lo hace**, y se
  cuenta en el manual y el README si lo ve el usuario.
- Un pendiente nuevo que aparece al trabajar (una deuda que se deja a
  propósito, una limitación que se descubre) se APUNTA allí, no en esta regla.
- Una idea descartada pasa a su apartado «Descartado a propósito», con el
  motivo, para no volver a proponerla sin un caso nuevo.
- Las notas de contexto dentro de otras reglas (`import-parsing.md`,
  `performance.md`, `measurements-drawing-vertex-editing.md`…) siguen siendo
  útiles junto al código al que se refieren, pero la lista de lo pendiente es la
  del documento.

## Cómo añadir una funcionalidad (checklist)

1. ¿Lo resuelve Leaflet u otra librería estable por CDN? Úsala.
2. Filas nuevas del árbol → `makeNode`. Controles nuevos del visor →
   `L.Control.extend` (`MeasureControl`/`ViewControl` como plantilla).
   Diálogos modales → patrón `.dlg-overlay`/`.dlg-box` con
   Cancelar/Aceptar y edición sobre borrador (ver diálogo de estilos).
   **Todo diálogo nuevo lleva su × arriba a la derecha** (la de cálculos
   geodésicos; pulsarla = Cancelar o, sin cancelar, Cerrar): ver
   `dialog-close-button.md`; `tests/statics.js` falla si falta.
3. Si muta el árbol → `scheduleSave()`. Si cambia lo serializado →
   actualizar `serializeTree`/`buildFromNodes` y subir `TREE_SCHEMA`.
4. Si crea muchas capas → procesar por lotes con progreso.
5. Textos de interfaz en español **dentro de `tr()`** (plurales `trn()`,
   homónimos `trc()`; en el HTML estático, tal cual y se traducen al
   arrancar); nunca concatenados sino con `{variables}`; después
   `node i18n-tool.js sync en` y traducir lo nuevo (`tests/i18n.js` falla
   si falta). Comentarios en inglés; mensajes al usuario vía
   `navMessage`. Nunca comparar un texto de interfaz: se guarda un estado.
6. Respetar gestos reservados (Shift, Ctrl); no tocar la vista del
   usuario sin que lo pida. Shift+click en navegación respeta la regla
   de selección del mismo tipo.
7. **Todo atajo nuevo se documenta en la chuleta** (`#shortcuts`, `?`):
   fila nueva en la tabla. Un atajo que no está ahí no existe para el
   usuario.
8. `BUILD` (`src/js/10-map.js`) **no se toca a mano**: el hook
   pre-commit (`scripts/hooks/pre-commit`) lo sube y reconstruye si el
   commit toca `src/`/`package.json`. Requiere el hook instalado
   (symlink, README «Contributing»); si no lo está, `npm run check`/CI
   lo detectan como fuente desincronizada.
9. `VERSION` solo se toca al preparar un release: subir
   `package.json.version` a mano, actualizar cabecera de los dos
   documentos de `docs/` (punto 13), commitear (el hook hace `BUILD` y
   build), y SOLO ENTONCES crear/empujar el tag `vX.Y.Z` — debe
   coincidir EXACTO con `package.json.version` o
   `release.yml` lo rechaza.
10. **Editar en `src/`, nunca en `kitelocal.html`**; `npm run build`
    antes de probar. Después: `node --check`; test en Node de la
    lógica pura si aplica; `grep -F` (con `-F`, no patrón normal —
    `$id(...)` con `$` se rompe si no) de referencias muertas; y
    `node tests/run-all.js` completo.
11. Cuidado con el ORDEN: dentro de un archivo y entre archivos
    (manifiesto `JS` de `build.js`). Una variable usada en el `onAdd`
    de un control debe declararse antes de ese control (zona muerta
    temporal). `node --check` no lo detecta.
12. **Al reportar cambios de código, mostrar `git diff --stat`.**
13. **Revisar `docs/`** si el cambio afecta a lo que describe: opción,
    diálogo, atajo o flujo (`manual-usuario...md`); origen de capa,
    servidor contactado, política de red, transformación de datos
    importados o alcance de tests (`estudio-seguridad...md`). Si
    ninguno habla de ello, no hace falta tocarlos — pero comprobarlo es
    parte del cambio. **Captura en el manual, en DOS casos**: (a) cambia
    el aspecto de algo ya capturado, y (b) se introduce **funcionalidad
    nueva con algo que ver**: un diálogo, control, opción de menú,
    indicador o estado visual lleva su captura, además de la prosa.
    Las capturas NO se hacen a mano: se añade (o se ajusta) su
    escenario en `tools/capturas.mjs` en el mismo cambio y se
    regeneran con `npm run capturas`. Un apartado que no necesita
    captura (gestual o ya cubierto por otra figura) se anota como
    exención en la matriz de `docs-maintenance.md`. Los números de
    `docs/` (suites, versión, figuras) los vigila `tests/docs.js`, y también
    que un **servidor nuevo** esté en el Anexo A del estudio, que un **atajo**
    esté en la chuleta Y en el apartado 8 del manual con las mismas palabras,
    que una **entrada de menú contextual** esté en el apartado 5 y que una
    **ventana nueva** tenga su sitio en el manual (`DIALOG_DOC`).
14. **Poner al día `README.md`** si la funcionalidad es visible para quien
    lo lee: *Features* (qué hace, en inglés, una o dos líneas por cosa),
    *Internet access and privacy* (un servidor nuevo), *Known limitations*
    (una limitación que aparece o desaparece) y *Development roadmap*
    («Done» / «Still open»: lo hecho sale de «Still open» y entra en
    «Done»). El README es lo primero que lee quien llega al repositorio y
    se había quedado muy por detrás del manual. Las cifras que da (suites, archivos
    de `src/js`) las vigila `tests/docs.js`. Si el cambio no toca nada de
    eso, anotarlo en el resumen («README: sin cambios»), como con `docs/`.
15. **Pendientes**: si el cambio hace algo que estaba en
    `docs/pendientes-y-propuestas-kite-local.md`, BORRARLO de ahí; si deja una
    deuda a propósito o descubre una limitación, APUNTARLA. Ver el apartado
    «Pendiente» de arriba.
16. **Language of what is written**: new code comments and everything on
    GitHub (commits, PR titles and bodies, comments, branch names), and any new
    developer-facing documentation, are written in ENGLISH (principle no. 3).
    UI strings stay Spanish inside `tr()`; the user manual and the security
    study stay in Spanish. No bulk translation of old text, but a comment (or
    paragraph) that a change modifies is rewritten in English in that change.
