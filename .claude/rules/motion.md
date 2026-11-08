---
description: Movimiento y respuesta de la interfaz (criterios de apple-design): respuesta al pulsar, entradas ancladas sin rebote, cerrar inmediato, toda animación con su anulación en movimiento reducido, separador con Pointer Events, materiales y cambio de tema suave.
paths:
  - "src/styles.css"
  - "src/js/50-splitter.js"
  - "src/js/70-view-controls.js"
  - "src/js/43-points-editor.js"
  - "tests/browser/motion.mjs"
  - "tests/statics.js"
---

## Movimiento y respuesta de la interfaz

Salió de aplicar el skill `apple-design` al cromo de la aplicación. Es una herramienta de trabajo, no una demo: **poco movimiento, corto, y siempre al servicio de entender qué ha pasado**. Nada de lo de aquí necesita una librería de muelles (principio nº2): no hay nada que se arrastre y se suelte con inercia, así que bastan transiciones y `@keyframes` de CSS.

### Reglas

1. **Se responde al PULSAR, no al soltar.** Los controles que son botones (`.btn`, `.dlg-close`, `#nav-toggle`, `.base-toggle`, `.color-btn`, `.ctx-menu-item`, `.leaflet-bar a`) se hunden (`scale(.97)`) y se oscurecen (`brightness(.94)`) en `:active`, **sin retardo al entrar** (`transition-duration: 0s`) y 100 ms al volver. Solo `transform` y `filter`. Un botón `:disabled` o `.leaflet-disabled` no se hunde. **Un control nuevo que sea un botón entra en esa lista** (en las tres: la regla de reposo, la de `:active` y la anulación de movimiento reducido).
2. **Las entradas son de opacidad y escala casi imperceptible, sin rebote.** Menú contextual y popover de color: `enter-menu` (120 ms, desde `scale(.96)`); ventanas: `enter-dialog` (160 ms, `scale(.98)`) y su fondo `enter-backdrop`. Sin rebote porque no las lanza un gesto con inercia (un muelle con rebote es para lo que se lanza con un empujón). **Cerrar es inmediato, sin animación de salida**: Escape, la × y Cancelar encadenan trabajo (devolver el foco, restaurar la foto) y las pruebas comprueban el cierre al momento.
3. **El menú nace donde se pulsó.** `openCtxMenu` pone `--ctx-origin` = punto pulsado MENOS la esquina de la caja ya colocada, así que sigue en el puntero aunque el borde de la pantalla desplace la caja; el submenú, en el lado por el que se abre.
4. **TODA `animation:` del CSS tiene su `animation: none` dentro de `@media (prefers-reduced-motion: reduce)`** (bloque final de `styles.css`) y `tests/statics.js` falla si falta. Movimiento reducido NO es «sin respuesta»: se quita lo que se mueve (giros, latidos, rayas, entradas, el hundido) y se conserva lo que ayuda a entender (cambios de color y de opacidad; el botón sigue oscureciéndose). Una animación nueva se añade con su anulación en el mismo cambio.
5. **`transparencia reducida` y `contraste alto`** cambian el valor de los TOKENS (`--surface-glass` pasa a opaco y `--glass-blur` a `none`; `--border`, `--muted`, `--muted-2` más marcados), nunca escriben un color suelto: es la misma regla de `theme.md` y la única razón por la que un `@media` toca un token.
6. **El separador es de Pointer Events con captura** (`50-splitter.js`): ratón, lápiz y dedo con un solo camino, respeta dónde se agarró (desfase entre el puntero y el borde, o el borde saltaría al puntero) y sigue al puntero sobre el mapa. `setNavWidth` se aplica en cada evento (1:1) pero `map.invalidateSize()` va **UNA vez por fotograma** (`scheduleMapResize`; `performance.md`: los eventos llegan a más de 100/s) y una más al soltar. **No actúa con `phone-layout`**: `setNavWidth` escribe `--nav-width` en línea y taparía el ancho de móvil (`mobile-view.md`).
7. **Superficies translúcidas = material**: la caja de coordenadas y la atribución llevan `backdrop-filter: var(--glass-blur)` y `--surface-glass` a 0,78. Es cromo, dentro de la frontera de `theme.md`. **No se apila una superficie translúcida sobre otra** (la legibilidad se hunde). html2canvas ignora `backdrop-filter` y pinta el rgba: el PNG sale sin desenfoque, y está bien.
8. **El tema se suaviza al elegirlo, no al arrancar**: `applyUiTheme(theme, true)` (la elección de Propiedades y la reaplicación de Cancelar) pone `html.theme-switching` 250 ms (transición de fondo, texto y borde); `99-boot.js` llama sin el segundo argumento. Con movimiento reducido no hay transición.
9. **Cifras que se repintan al arrastrar** (`#ms-values`, `#ms-legs`, `.geocalc-result`) con `font-variant-numeric: tabular-nums`, para que no bailen de ancho. El título del panel lleva `letter-spacing` negativo: un título se aprieta, el tracking positivo es para texto pequeño.

### Trampas ya pisadas

- **`@starting-style` NO**: el minificador del build (clean-css) no la conoce y la DESTROZA en `kitelocal.min.html` (medido: perdió la regla de `.dlg-box` y dejó un `@starting-style{transform:scale(.98)}` suelto). El legible funcionaba y el minificado no. Se usan `@keyframes` solo con `from`: parten de ahí y llegan al estilo normal, y se repiten cada vez que el elemento pasa de `hidden` a visible.
- **`getBoundingClientRect()` lleva la escala de la entrada.** Con la caja a medio escalar, el tope contra el borde de la pantalla de `openCtxMenu` se calculaba con un ancho hasta un 4 % menor y la caja se salía 4,8 px. Para colocar una caja que se anima se usa `offsetWidth`/`offsetHeight` (tamaño de layout); `motion.mjs` lo comprueba y falla con el rect.
- **Las suites de navegador piden `reducedMotion: "reduce"`** (`openApp` y los `newContext` sueltos): clican y miden al instante, y con la entrada a medias saldrían medidas torcidas. Solo `motion.mjs` pide `no-preference`. Una suite nueva con su propio `newContext` tiene que ponerlo.
- **El cambio de tema también se anima al CANCELAR** (reaplica el original): una prueba que mida colores justo después espera a que `theme-switching` desaparezca, o el color está a medio camino.
- **`getComputedStyle(x).transitionDuration` devuelve una lista** (`0.25s, 0.25s, 0.25s`: una por propiedad).

### Lo que no se anima, a propósito

- **Plegar y mostrar el panel de navegación**: cada fotograma obligaría a `invalidateSize()` del mapa con miles de capas en lienzo.
- **El choque de un diálogo con el borde** (`clampToViewport`) y **la brújula** (`map-rotation.md`): lo que hay funciona y es más claro para una herramienta de trabajo.

Probado en `tests/browser/motion.mjs` y, la regla de la anulación, en `tests/statics.js`.
