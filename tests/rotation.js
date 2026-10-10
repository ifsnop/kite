/* Rotación del mapa (experimento, leaflet-rotate): las piezas PURAS que
   no dependen del plugin ni del navegador.

   1. La brújula: ángulo del puntero visto desde su centro (convenio de
      rumbo: 0 = arriba, sentido horario) y rumbo del mapa durante un
      arrastre — relativo al ángulo de partida, para que el mapa no salte
      al primer movimiento, y libre, sin pasos. Y el rumbo al girar con
      el botón central (desplazamiento horizontal → grados).
   2. La retícula: recorte de una línea al rectángulo del visor
      (Liang–Barsky), con el que se coloca la etiqueta donde la línea
      ENTRA en la vista aunque el mapa esté girado.
   3. «Una sola Tierra» rotada: el arrastre en pantalla se recorta en el
      marco del mapa sin girar y se vuelve a girar; con el norte arriba
      debe coincidir con el recorte por ejes de Leaflet.

   La integración con el mapa de verdad (brújula, R, etiquetas
   horizontales, detección de capas, PNG…) está en
   tests/browser/rotation.mjs.                                          */
const { fn, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const R = new Function(fn("pointerAngleDeg") + "\n" + fn("dragBearing") + "\n"
  + constDecl("ROTATE_DEG_PER_PX") + "\n" + fn("pivotDragBearing") + "\n"
  + fn("clipSegmentToRect") + "\n" + fn("clampRotatedDragOffset")
  + "\nreturn { pointerAngleDeg, dragBearing, pivotDragBearing, clipSegmentToRect, clampRotatedDragOffset };")();

/* ================= 1. Brújula ================= */
ok(near(R.pointerAngleDeg(0, 0, 0, -10), 0), "puntero arriba del centro → 0°");
ok(near(R.pointerAngleDeg(0, 0, 10, 0), 90), "a la derecha → 90° (sentido horario, Y hacia abajo)");
ok(near(R.pointerAngleDeg(0, 0, 0, 10), 180), "abajo → 180°");
ok(near(R.pointerAngleDeg(0, 0, -10, 0), 270), "a la izquierda → 270°, nunca negativo");

ok(near(R.dragBearing(0, 90, 90), 0), "sin girar el puntero, el mapa no se mueve (no salta al ángulo absoluto)");
ok(near(R.dragBearing(0, 90, 120), 30), "girar el puntero 30° gira el mapa 30°");
ok(near(R.dragBearing(30, 350, 10), 50), "cruzar el norte con el puntero suma, no resta 340°");
ok(near(R.dragBearing(10, 90, 60), 340), "girar al revés baja de 0 a 340, normalizado a [0, 360)");
ok(near(R.dragBearing(0, 0, 17.3), 17.3), "libre: sin redondear a pasos");

/* Botón central: medio grado por píxel en horizontal, derecha = horario */
ok(near(R.pivotDragBearing(0, 120), 60), "120 px a la derecha → 60°");
ok(near(R.pivotDragBearing(10, -40), 350), "a la izquierda resta y cruza el norte sin negativos");
ok(near(R.pivotDragBearing(45, 0), 45), "sin desplazamiento no cambia");
ok(near(R.pivotDragBearing(0, 3), 1.5), "libre también: 3 px → 1,5°");

/* ================= 2. Recorte al visor ================= */
const W = 100, H = 50;
let seg = R.clipSegmentToRect({ x: -50, y: 20 }, { x: 150, y: 20 }, W, H);
ok(seg && near(seg[0].x, 0) && near(seg[1].x, 100) && near(seg[0].y, 20),
  "una horizontal que cruza la vista se recorta a sus bordes: " + JSON.stringify(seg));
seg = R.clipSegmentToRect({ x: 150, y: 20 }, { x: -50, y: 20 }, W, H);
ok(seg && near(seg[0].x, 100), "el primer extremo devuelto es el del lado de p0 (por ahí se pone la etiqueta)");
ok(R.clipSegmentToRect({ x: -50, y: 80 }, { x: 150, y: 80 }, W, H) === null, "fuera de la vista → null");
seg = R.clipSegmentToRect({ x: -10, y: -10 }, { x: 60, y: 60 }, W, H);
ok(seg && near(seg[0].x, 0) && near(seg[0].y, 0) && near(seg[1].x, 50) && near(seg[1].y, 50),
  "una diagonal entra por la esquina y sale por abajo: " + JSON.stringify(seg));
seg = R.clipSegmentToRect({ x: 10, y: 10 }, { x: 20, y: 30 }, W, H);
ok(seg && near(seg[0].x, 10) && near(seg[1].y, 30), "un segmento dentro se queda entero");
ok(R.clipSegmentToRect({ x: -5, y: 10 }, { x: -5, y: 40 }, W, H) === null,
  "una vertical a la izquierda de la vista → null (caso p = 0)");

/* ================= 3. Arrastre limitado con el mapa girado ================= */
/* Con el norte arriba debe valer lo mismo que el recorte por ejes de
   Leaflet: el contenido se mueve `offset`, el centro lo contrario.    */
const c0 = { x: 500, y: 500 }, min = { x: 400, y: 450 }, max = { x: 600, y: 550 };
let o = R.clampRotatedDragOffset({ x: 30, y: -20 }, 0, c0, min, max);
ok(near(o.x, 30) && near(o.y, -20), "dentro del margen, a 0°, el arrastre no cambia: " + JSON.stringify(o));
o = R.clampRotatedDragOffset({ x: 300, y: 0 }, 0, c0, min, max);
ok(near(o.x, 100) && near(o.y, 0), "a 0°, el centro no baja de min.x: el arrastre se queda en 100: " + JSON.stringify(o));
o = R.clampRotatedDragOffset({ x: 0, y: -300 }, 0, c0, min, max);
ok(near(o.y, -50), "y por abajo, en max.y: " + JSON.stringify(o));

/* A 90° (horario) el norte del mapa apunta a la DERECHA de la
   pantalla: arrastrar el contenido hacia la derecha lleva el centro
   hacia el SUR del mapa (y creciente), así que topa con max.y.     */
o = R.clampRotatedDragOffset({ x: 30, y: 0 }, Math.PI / 2, c0, min, max);
ok(near(o.x, 30, 1e-6) && near(o.y, 0, 1e-6), "a 90°, un arrastre pequeño pasa tal cual: " + JSON.stringify(o));
o = R.clampRotatedDragOffset({ x: 300, y: 0 }, Math.PI / 2, c0, min, max);
ok(near(o.x, 50, 1e-6) && near(o.y, 0, 1e-6),
  "a 90°, el tope es el del eje Y del mapa (50 px), no el del X de pantalla (100): " + JSON.stringify(o));

/* Vista más grande que el mundo en un eje: el centro se queda en medio */
o = R.clampRotatedDragOffset({ x: 40, y: 0 }, 0, { x: 480, y: 500 }, { x: 600, y: 450 }, { x: 400, y: 550 });
ok(near(o.x, -20), "sin hueco en X, el centro va al punto medio (500): arrastre -20: " + JSON.stringify(o));

if (!process.exitCode) console.log("ROTATION TESTS OK");
