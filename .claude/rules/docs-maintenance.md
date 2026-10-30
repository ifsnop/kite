---
description: Mantenimiento obligatorio de docs/ (manual y estudio de seguridad): cuándo hay captura, cómo se regeneran, qué vigila tests/docs.js, matriz de cobertura y cadencia de revisión.
paths:
  - "docs/**"
  - "tools/capturas.mjs"
  - "tests/docs.js"
---

## Documentación complementaria

Dos documentos en `docs/`, para quien usa o audita la aplicación:

- `docs/manual-usuario-kite-local.md` — manual de usuario con capturas
  reales (`docs/img/`): los dos paneles, el árbol, diálogos de estilo,
  menú contextual, atajos, tareas habituales.
- `docs/estudio-seguridad-kite-local.md` — evidencia de auditoría
  (AESA/EASA): origen de cada capa y servicio auxiliar, por qué la
  app no modifica los datos que carga/muestra (con sus excepciones
  controladas), y qué pruebas lo respaldan.

**Mantenerlos al día es parte del cambio, no un aparte.** Un documento
desactualizado induce a error activamente. **Antes de dar por
terminado cualquier cambio que toque algo que describen, revisarlos y
actualizarlos.** Ver punto 13 del checklist en `00-principles.md`.

## Capturas del manual

- **Cuándo hay captura** (dos casos, no uno): (a) cambia el aspecto de
  algo ya capturado; (b) se introduce funcionalidad nueva con algo que
  ver — diálogo, control, opción de menú, indicador, estado visual. En
  el segundo caso el apartado que la describe lleva su captura aunque
  nada de lo anterior haya cambiado de aspecto.
- **Cómo**: `npm run capturas` regenera todas; `npm run capturas
  perfil-ruta` una sola (`tools/capturas.mjs`, un escenario por captura,
  sobre `tests/browser/_browser.mjs`). Nada de capturas a mano: sin
  escenario no se puede repetir y la siguiente interfaz deja la figura
  desfasada sin que nadie lo note. Funcionalidad nueva = escenario nuevo
  en el MISMO cambio.
- **Datos de ejemplo versionados** en `docs/ejemplos/` (los de «Operación
  Sierra», `sensores.geojson`, `remoto.kml`); los servicios externos se
  simulan con `page.route` (WCS, Catastro con los fixtures reales), el
  reloj va fijo y el idioma es `es-ES` con el tema claro (salvo la figura
  del tema oscuro). El fondo es OpenStreetMap real: `--sin-fondo` para
  iterar sin red.
- **`docs/img/capturas.json`** lo escribe el script: versión, build,
  fecha, `sha256` y apartado de cada imagen. `tests/docs.js` exige que su
  versión sea la de `package.json` y que los hash coincidan: una captura
  tocada a mano, o sin regenerar al subir de versión, falla.
- **Imágenes externas**: `ortofoto-cog.png` (Sentinel-2, 362 MB) no se
  puede versionar ni regenerar; está en el manifiesto como `externa`.
- Nombres de archivo sin número (`vista-general.png`): el número de figura
  vive solo en el pie (`*Figura N.*`), para que insertar una no obligue a
  renombrar; `tests/docs.js` exige que vayan en orden de documento.
- **Se mira cada PNG** antes de darla por buena.

### Trampas del script (ya pisadas)

- **No se fija el reloj de la página** (`page.clock.setFixedTime`): Leaflet mide el fundido de entrada de las teselas con `Date` y se quedaban TRANSPARENTES (mapa en blanco con las teselas «cargadas»). Las fechas y horas visibles (avisos, «Sesión …») se sustituyen en el texto justo antes de fotografiar (`stamps`).
- **El aviso de falta de aceleración** sale en esta máquina (sin GPU) y no debe estar en el manual: el script le contesta a `getParameter` de WebGL con una tarjeta cualquiera (que no case con `SOFTWARE_RENDERER_RE`, `10-map.js`: «Mesa» sí casa).
- **Un diálogo con altura fija** (`#props-dialog`, `#shortcuts`: `resize: both`) se corta en la captura: el escenario le sube la altura a la caja, como haría quien lo redimensiona.
- **Mayús + clic selecciona texto** del navegador entre los dos clics: `treeShot` lo quita antes de fotografiar.
- **OpenStreetMap**: cada tesela se pide una vez por ejecución (caché en el script) y con un User-Agent que dice quién es; a partir del zoom 19 Leaflet amplía las teselas, así que se espera a las del 19.
- Un escenario que borra una fila a mitad de su parpadeo (`blinkLayer`, 600 ms) deja la capa en el mapa: ver `cadastre.md`.

## Qué vigila `tests/docs.js`

- **Números y referencias**: recuentos de suites del estudio frente a `run-all.js`
  (y falla si no encuentra ninguna frase, para que reescribirla no lo desactive),
  versión de la cabecera de los dos documentos frente a `package.json`, imágenes
  (existen, texto alternativo, pie numerado en orden, sin huérfanas), anclas del
  índice y referencias «apartado X.Y», manifiesto de capturas y que cada suite de
  `run-all.js` tenga su sección en `tests/README.md`. Un número de `docs/` que se
  pueda evitar, se evita («todas las suites»).
- **Servidores** (Anexo A del estudio): los servidores que salen de los literales
  de `src/js` (con `acorn`; los comentarios no cuentan), de `src/sw.js` y de
  `index.html` están TODOS en la primera columna de las tablas del Anexo A, y todo
  servidor del anexo está en el código. **Un servidor nuevo en el código = una fila
  en el Anexo A en el mismo cambio** (proveedor, para qué, cuándo, qué se le
  envía); uno retirado, fuera del anexo. También lo que no recibe tráfico
  (enlaces de la atribución, `www.w3.org`, direcciones de ejemplo de la ayuda).
- **Política de contenido** (`<meta>` CSP de `index.html`): solo `img-src` y
  `connect-src` admiten `https:` abierto (la excepción documentada en el 6.2 del
  estudio), ninguna fuente es `*` ni `http:`, todo host de la política está en el
  anexo y el anexo nombra esas dos directivas.
- **Atajos**: las tablas del apartado 8 del manual son las de la chuleta de la
  aplicación (`#shortcuts`), cabeceras y filas, **con las mismas palabras y en el
  mismo orden**. La chuleta es la fuente (es lo que ve el usuario): un atajo nuevo
  va a la chuleta (con `node i18n-tool.js sync en`) y se copia al manual tal cual.
- **Menú contextual**: cada etiqueta `label: tr("…")` de `CTX_MENU_ITEMS`,
  `layerCtxItems`, `ctxItemsFor` y `routeProfileCtxItem` aparece entre « » en el
  apartado 5 del manual. Una entrada nueva se describe ahí con su etiqueta exacta.
- **Ventanas**: cada `dlg-overlay`/`dlg-float` de `index.html` tiene en
  `DIALOG_DOC` (en `tests/docs.js`) la frase con que el manual la describe o una
  exención con su motivo. Una ventana nueva sin decidir hace fallar la prueba.

## Matriz de cobertura del manual (exenciones)

Un apartado con diálogo, control o estado visual propio lleva captura. Los
que no, y por qué:

| Apartado | Motivo |
|---|---|
| 3.1 Qué lleva cada fila | cubierto por las figuras del árbol |
| 3.5 Mover capas | gesto de arrastre; la marca de destino no se aprecia en una imagen fija |
| 4.5 Teclado y rueda | gestos sin efecto visual propio |
| 7.4 Personalizar un marcador | remite a los diálogos del apartado 6.1 |
| 7.7 Deshacer y rehacer | sin elemento visual propio |
| 7.14 Compartir una vista | la entrada del menú se ve en el submenú «Copiar» del apartado 5 |
| 9 Qué se guarda y dónde | solo texto |

## Cadencia de revisión

| Cuándo | Qué |
|---|---|
| Cada cambio | punto 13 del checklist; `tests/docs.js` en el CI |
| Cada release | `npm run capturas`; revisar el estudio (cifras, fecha, resultado verificado); subir la versión de los dos documentos; la lista completa está en `build-and-release.md` |
| Cada seis meses | revisión de calidad completa: exactitud afirmación a afirmación, matriz de completitud, estudio (afirmación → prueba), lectura por alguien que no conoce la aplicación, accesibilidad de los textos y enlaces externos |

Los tres procedimientos de abajo son la receta para repetirlos sin tener que
volver a pensarlos. Orden obligatorio dentro de cada uno.

### A. Cada cambio (minutos)

1. Editar `src/`; `npm run build`.
2. ¿Toca algo que describen `docs/`? (opción, diálogo, atajo, flujo, servidor
   contactado, origen de datos, alcance de las pruebas). Si no, anotarlo en el
   resumen del cambio («docs/: sin cambios») y seguir en el punto 6.
3. Texto: editar el manual y/o el estudio.
4. ¿Algo con algo que ver (diálogo, control, opción de menú, indicador, estado
   visual) o cambia el aspecto de lo ya capturado? Entonces captura:
   - Escenario nuevo o ajustado en `tools/capturas.mjs` (receta en «Añadir una
     captura», abajo).
   - `npm run build && npm run capturas <nombre>` (necesita red para el mapa, o
     `-- --sin-fondo`; y Chromium: `npm run browser` o `KITE_BROWSER=…`).
   - **Abrir la PNG y mirarla.**
5. Figura nueva en el manual: bloque `![descripción](img/x.png)` + pie
   `*Figura ?. …*` y renumerar (receta abajo).
6. `node tests/docs.js`, y al final `node tests/run-all.js` completo (principio 6).
   El mensaje del commit dice qué parte de `docs/` se tocó.

### B. Cada release (una hora)

Después de reunir los PR y ANTES de tagear (ver `build-and-release.md`):

1. `npm run build` y `git status`: árbol limpio salvo lo que se va a subir.
2. Subir `package.json.version`.
3. `npm run capturas` (todas; ~1 minuto más lo que tarden las teselas). Mirar las
   PNG que hayan cambiado respecto a la versión anterior (`git diff --stat
   docs/img`; las que casi no cambian de tamaño suelen ser las que no cambiaron).
   `ortofoto-cog.png` no se regenera: se mantiene.
4. `KITE_REQUIRE_BROWSER=1 node tests/run-all.js`. Anotar el total («N de N»).
5. Estudio de seguridad (`docs/estudio-seguridad-kite-local.md`):
   - Las cuatro frases de recuento (resumen, 7.2, 7.4, conclusión) al total del
     paso 4; `tests/docs.js` dice cuáles no coinciden.
   - «Fecha» = la del release; «Versión del documento» +1 (1.3 → 1.4);
     «Versión de la aplicación auditada» = `package.json` (el build entre paréntesis
     es informativo: el que quede en `src/js/10-map.js` tras el commit del hook).
   - 7.2: cada suite NUEVA desde el último release cabe en alguna área (lista de
     suites: `grep -o '^  \["[^"]*"' tests/run-all.js`). Si no, bullet nuevo.
   - 4.1: si se añadió un servidor o servicio, está descrito (ver el comando de
     servidores en C.3).
6. Manual: la cabecera lleva la misma versión (`tests/docs.js` lo exige).
7. `node tests/docs.js` y `npm run check`. Commit del release (el hook sube
   `BUILD`).
8. Tag y empuje: `build-and-release.md`.

### C. Cada seis meses (una jornada) — revisión de calidad completa

Anotar el resultado (discrepancias halladas y corregidas) en la descripción del
PR y en la tabla «Registro de revisiones» de abajo. Cada paso, con su método:

1. **Exactitud del manual.** Lista de lo cambiado desde la última revisión:
   `git log --since=<fecha> --name-only --format= -- src | sort | uniq -c | sort -rn`,
   y de cada archivo, su apartado del manual (la tabla de `CLAUDE.md` dice qué
   regla y qué apartado). Por cada afirmación con número, valor por defecto,
   límite o nombre de botón: comprobarla en el código (`grep -F`) o en la
   aplicación. Empezar por lo más tocado. Discrepancia = se corrige en el acto.
2. **Completitud.** Las entradas del menú contextual, las ventanas de
   `index.html` y los atajos ya los comprueba `tests/docs.js`; queda a mano lo que
   la prueba no ve: cada control de Propiedades y cada botón de la cabecera con su
   apartado y figura (o en la matriz de exenciones de arriba), y que las ventanas
   con captura la tengan. Los huecos se cierran o se anotan.
3. **Estudio de seguridad: afirmación → prueba.** Los servidores y la política de
   contenido ya los comprueba `tests/docs.js` (Anexo A). A mano: cada garantía de
   los apartados 4–6 apunta a una suite de `run-all.js`, cada suite figura en
   alguna área del 7.2, y lo que el Anexo A dice que se envía a cada servidor sigue
   siendo cierto (leer la petición en el código del servicio).
4. **Lectura.** Alguien (o un agente sin contexto) hace las tareas 7.1–7.12 con
   SOLO el manual y anota dónde se atasca. Párrafos de más de ~10 líneas se
   parten en pasos; los mismos nombres de botón en todo el documento (`grep -n`
   de cada uno). Estudio: lectura como auditor, ¿qué es evidencia y qué opinión?
5. **Accesibilidad y forma.** Texto alternativo que describe (no repite el pie),
   títulos sin saltos de nivel, tablas con cabecera, enlaces con texto propio,
   capturas legibles en claro y oscuro. Enlaces externos:
   `grep -o 'https\?://[^) ]*' docs/*.md | sort -u` y `curl -sI` a cada uno.
6. Anotar la revisión en el registro, corregir, y `node tests/run-all.js`.

### Añadir una captura (receta)

En `tools/capturas.mjs`, antes de «Lanzador»:

```js
scenario("mi-captura.png", "7.13", async out => {   // nombre, apartado del manual
  const { ctx, page } = await openApp({ /* viewport, colorScheme, route, touch, url */ });
  await sierra(page);                    // la escena de ejemplo (docs/ejemplos/)
  // …llevar la aplicación al estado… (UI real: clics, drop(), onRow(), pt())
  await fullShot(page, out);             // o dialog(page, out, "id"), treeShot(page, out)
  await ctx.close();
}, ["otra.png"]);                        // opcional: las demás imágenes que escribe
```

Ayudantes: `openApp`, `sierra`, `drop`, `view`, `pt` (lat/lng → píxeles de la
página), `onRow`/`clickRow`/`rowRect`/`expandNode`, `settle` (teselas),
`stamps` (fechas visibles), `fullShot`/`dialog`/`treeShot`/`clip`. Servicios
externos: `page.route` con los fixtures de `tests/fixtures` o `ignFakes()` de
`tests/browser/_fakes.mjs`. Luego: `npm run capturas mi-captura`, mirarla, y la
figura en el manual.

**Renumerar las figuras** tras insertar o quitar una (idempotente):

```
node -e 'const fs=require("fs"),f="docs/manual-usuario-kite-local.md";let n=0;fs.writeFileSync(f,fs.readFileSync(f,"utf8").split("\n").map(l=>/^\*Figura \S+?\. /.test(l)?l.replace(/^\*Figura \S+?\. /,`*Figura ${++n}. `):l).join("\n"))'
```

(Los pies nuevos se escriben `*Figura ?. …*`; el manual no cita figuras por su
número en el texto, solo en los pies.)

### Registro de revisiones

| Fecha | Alcance | Resultado |
|---|---|---|
| 2026-10-29 | Parcial: capturas rehechas con script, recuentos del estudio, checklist, cobertura de 7.2, textos del manual con errores (7.3, 3.4, 2.1) y explicación de etiquetas HTML y duplicados | 97 de 97 suites; las 44 figuras revisadas una a una. **No** se hizo la revisión C completa |
| 2026-10-29 | Fases 2 y 3 de `tests/docs.js` (servidores, política de contenido, atajos, menú, ventanas) | Las pruebas encontraron 9 filas de atajos distintas (una era un error de la chuleta: Supr), 13 de las 20 etiquetas del menú sin citar en el apartado 5 y 22 servidores sin documentar; corregido |

### Pendiente (comprobaciones automáticas, de `tests/docs.js`)

Fase 4: un cuadro de límites y valores por defecto del manual (300 MB, 100 000
elementos, 10 NM, 15 s…) con el nombre de su constante en el código, y una prueba
que extraiga esas constantes y las compare. Mientras no exista, la revisión C.1 las
comprueba a mano.
