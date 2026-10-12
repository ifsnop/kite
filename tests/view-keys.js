/* Teclado y rueda del visor: las piezas PURAS del desplazamiento
   continuo con flechas y del zoom continuo con Re/Av Pág y con la rueda
   (70-view-controls.js).

   1. keyPanSpeed: velocidad de una flecha según el tiempo pulsada —
      constante al empezar, rampa lineal después, con tope.
   2. keyPanVector: dirección combinada de las flechas vivas — diagonal,
      opuestas se anulan, Mayús multiplica.
   3. keyZoomTarget: nivel ENTERO en que termina un zoom continuo — un
      toque es ±1, si no el siguiente entero en la dirección del zoom,
      siempre dentro de [min, max].
   4. wheelLevels: niveles que pide un evento de rueda — una muesca es
      uno, como mucho uno por evento aunque venga en líneas o páginas;
      los deltas pequeños del panel táctil dan fracciones.
   5. wheelZoomTarget: nivel ENTERO en que se asienta la rueda — el
      siguiente en la dirección del último giro, sin el «al menos ±1»
      de las teclas (subir y bajar lo mismo deja donde estaba).

   La integración con teclas de verdad (sin esperar a la autorrepetición,
   borde del mundo, mapa girado, cursor) está en
   tests/browser/keyboard-nav.mjs.                                      */
const { fn, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const K = new Function(["KEY_PAN_STEP", "KEY_PAN_SPEED", "KEY_PAN_MAX_SPEED", "KEY_PAN_ACCEL_MS",
  "KEY_PAN_RAMP_MS", "KEY_PAN_SHIFT", "KEY_PAN_DIRS"].map(constDecl).join("\n")
  + "\n" + constDecl("WHEEL_PX_PER_LEVEL")
  + "\n" + fn("keyPanSpeed") + "\n" + fn("keyPanVector") + "\n" + fn("keyZoomTarget")
  + "\n" + fn("wheelLevels") + "\n" + fn("wheelZoomTarget")
  + "\nreturn { keyPanSpeed, keyPanVector, keyZoomTarget, wheelLevels, wheelZoomTarget,"
  + " KEY_PAN_SPEED, KEY_PAN_MAX_SPEED, KEY_PAN_ACCEL_MS, KEY_PAN_RAMP_MS, KEY_PAN_SHIFT };")();

/* ================= 1. Perfil de velocidad ================= */
ok(K.keyPanSpeed(0) === K.KEY_PAN_SPEED, "arranca ya a la velocidad base, sin pausa");
ok(K.keyPanSpeed(K.KEY_PAN_ACCEL_MS) === K.KEY_PAN_SPEED, "constante hasta el umbral de aceleración");
ok(near(K.keyPanSpeed(K.KEY_PAN_ACCEL_MS + K.KEY_PAN_RAMP_MS / 2), (K.KEY_PAN_SPEED + K.KEY_PAN_MAX_SPEED) / 2),
  "a mitad de la rampa, a mitad de camino");
ok(K.keyPanSpeed(K.KEY_PAN_ACCEL_MS + K.KEY_PAN_RAMP_MS) === K.KEY_PAN_MAX_SPEED, "al final de la rampa, el tope");
ok(K.keyPanSpeed(60000) === K.KEY_PAN_MAX_SPEED, "y no pasa del tope");
ok(K.keyPanSpeed(-5) === K.KEY_PAN_SPEED, "un tiempo negativo (marca de fotograma anterior al keydown) no frena");

/* ================= 2. Dirección combinada ================= */
let v = K.keyPanVector([["ArrowRight", 100]], false);
ok(v.x === 100 && v.y === 0, "→ mueve la vista a la derecha (x positiva): " + JSON.stringify(v));
v = K.keyPanVector([["ArrowUp", 100]], false);
ok(v.x === 0 && v.y === -100, "↑ hacia arriba de la pantalla (y negativa): " + JSON.stringify(v));
v = K.keyPanVector([["ArrowRight", 100], ["ArrowDown", 100]], false);
ok(v.x === 100 && v.y === 100, "→ y ↓ a la vez: diagonal: " + JSON.stringify(v));
v = K.keyPanVector([["ArrowLeft", 100], ["ArrowRight", 100]], false);
ok(v.x === 0 && v.y === 0, "opuestas se anulan: " + JSON.stringify(v));
v = K.keyPanVector([["ArrowLeft", 100]], true);
ok(v.x === -100 * K.KEY_PAN_SHIFT, "Mayús multiplica: " + JSON.stringify(v));
v = K.keyPanVector([["PageUp", 100]], false);
ok(v.x === 0 && v.y === 0, "una tecla que no es flecha no mueve nada");

/* ================= 3. Nivel final del zoom ================= */
ok(K.keyZoomTarget(6, 6.2, 1, 0, 25) === 7, "un toque (apenas empezado) acerca un nivel entero");
ok(K.keyZoomTarget(6, 5.8, -1, 0, 25) === 5, "y aleja uno");
ok(K.keyZoomTarget(6, 8.4, 1, 0, 25) === 9, "mantenido, sigue hasta el entero siguiente (no vuelve atrás)");
ok(K.keyZoomTarget(6, 3.6, -1, 0, 25) === 3, "lo mismo alejando");
ok(K.keyZoomTarget(6, 8, 1, 0, 25) === 8, "ya en un entero, se queda en él");
ok(K.keyZoomTarget(6, 6, 1, 0, 25) === 7, "sin haber avanzado, un toque sigue siendo +1");
ok(K.keyZoomTarget(5.5, 5.6, 1, 0, 25) === 6, "desde un zoom fraccionario, al entero siguiente, no a 6,5");
ok(K.keyZoomTarget(5.5, 5.4, -1, 0, 25) === 5, "y alejando, al anterior");
ok(K.keyZoomTarget(25, 25, 1, 0, 25) === 25, "en el máximo no se pasa");
ok(K.keyZoomTarget(2, 2, -1, 2, 25) === 2, "ni del mínimo");

/* ================= 4. Niveles por evento de rueda ================= */
ok(K.wheelLevels(-100, 0) === 1, "una muesca hacia arriba (100 px) acerca un nivel");
ok(K.wheelLevels(120, 0) === -1, "una de 120 px hacia abajo aleja uno, no más");
ok(near(K.wheelLevels(-10, 0), 0.1), "un delta pequeño de panel táctil da una fracción");
ok(K.wheelLevels(-3, 1) === 1, "tres líneas (rueda en modo líneas) = un nivel");
ok(K.wheelLevels(1, 2) === -1, "una página, como mucho un nivel");
ok(K.wheelLevels(0, 0) === 0, "sin delta vertical, nada");

/* ================= 5. Nivel final de la rueda ================= */
ok(K.wheelZoomTarget(6.3, 1, 0, 25) === 7, "acercando, al entero siguiente");
ok(K.wheelZoomTarget(6.7, -1, 0, 25) === 6, "alejando, al anterior");
ok(K.wheelZoomTarget(8, 1, 0, 25) === 8, "ya en un entero, se queda (tres muescas = tres niveles)");
ok(K.wheelZoomTarget(6, -1, 0, 25) === 6, "subir y bajar lo mismo deja donde estaba, sin el ±1 de las teclas");
ok(K.wheelZoomTarget(24.5, 1, 0, 25) === 25 && K.wheelZoomTarget(2.4, -1, 2, 25) === 2,
  "dentro de [min, max]");

if (!process.exitCode) console.log("VIEW KEYS TESTS OK");
