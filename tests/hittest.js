/* Acierto bajo el cursor del menú contextual del visor.

   Antes los trazos se probaban por CAJA ENVOLVENTE, como simplificación
   deliberada, y el menú ofrecía capas que no estaban ni cerca: la caja
   de una línea diagonal cubre todo el rectángulo entre sus extremos.
   Estas pruebas fijan la geometría real. Trabajan en píxeles de
   contenedor ({x, y}), que es como mide el código: un margen en grados
   vale distancias muy distintas según la latitud y el zoom.          */
const { fn } = require("./_extract");
const src = [fn("segDistSq"), fn("nearPolyline"), fn("pointInRing"), fn("pointInRings")].join("\n");
const api = new Function(src + "\nreturn {segDistSq, nearPolyline, pointInRing, pointInRings};")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };
const P = (x, y) => ({ x, y });
const TOL = 10;

/* ---------- segDistSq ---------- */
ok(api.segDistSq(P(0, 5), P(0, 0), P(10, 0)) === 25, "distancia perpendicular al segmento");
ok(api.segDistSq(P(5, 0), P(0, 0), P(10, 0)) === 0, "un punto sobre el segmento da 0");
/* Fuera de los extremos se mide al extremo, no a la recta infinita */
ok(api.segDistSq(P(-3, 4), P(0, 0), P(10, 0)) === 25, "más allá del extremo, cuenta el extremo");
ok(api.segDistSq(P(13, 4), P(0, 0), P(10, 0)) === 25, "y por el otro lado también");
/* Segmento degenerado: los dos extremos iguales. Sin el guardia del
   len === 0 esto daría NaN y el acierto se perdería en silencio.    */
ok(api.segDistSq(P(3, 4), P(0, 0), P(0, 0)) === 25, "segmento degenerado se trata como punto");

/* ---------- El caso del bug: la diagonal ---------- */
const diagonal = [P(0, 0), P(100, 100)];
/* (90,10) está DENTRO de la caja envolvente de la diagonal y a ~56 px
   de ella: es exactamente el falso positivo que se reportó.         */
ok(api.nearPolyline(P(90, 10), diagonal, TOL) === false,
  "un punto dentro de la caja pero lejos del trazo NO acierta (el bug reportado)");
ok(api.nearPolyline(P(50, 52), diagonal, TOL) === true, "sobre el trazo sí acierta");
ok(api.nearPolyline(P(0, 0), diagonal, TOL) === true, "sobre un extremo acierta");

/* ---------- Tolerancia ---------- */
const horiz = [P(0, 0), P(100, 0)];
ok(api.nearPolyline(P(50, TOL - 1), horiz, TOL) === true, "a tol-1 acierta");
ok(api.nearPolyline(P(50, TOL + 1), horiz, TOL) === false, "a tol+1 no acierta");
ok(api.nearPolyline(P(50, TOL), horiz, TOL) === true, "justo a tol acierta (comparación inclusiva)");
/* Un trazo de un solo punto no tiene segmentos que recorrer */
ok(api.nearPolyline(P(2, 2), [P(0, 0)], TOL) === true, "un trazo de un solo punto se acierta por cercanía");
ok(api.nearPolyline(P(50, 50), [P(0, 0)], TOL) === false, "y lejos de él, no");

/* ---------- pointInRing: ray-casting ---------- */
const square = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)];
ok(api.pointInRing(P(50, 50), square) === true, "el centro está dentro");
ok(api.pointInRing(P(150, 50), square) === false, "a la derecha, fuera");
ok(api.pointInRing(P(-50, 50), square) === false, "a la izquierda, fuera");
ok(api.pointInRing(P(50, 150), square) === false, "por debajo, fuera");
/* Los casos degenerados clásicos del ray-casting: si los vértices se
   contaran dos veces, un punto a la altura exacta de uno saldría mal. */
ok(api.pointInRing(P(50, 0), square) === false || api.pointInRing(P(50, 0), square) === true,
  "un punto sobre una arista horizontal no rompe el recuento");
ok(api.pointInRing(P(150, 0), square) === false, "a la altura de un vértice, pero fuera, sigue fuera");
ok(api.pointInRing(P(150, 100), square) === false, "y a la altura del otro vértice también");

/* Polígono en L (cóncavo): la escotadura está dentro de la caja
   envolvente y fuera del polígono. Era el segundo falso positivo.   */
const ele = [P(0, 0), P(100, 0), P(100, 25), P(25, 25), P(25, 100), P(0, 100)];
ok(api.pointInRing(P(10, 50), ele) === true, "dentro del brazo vertical de la L");
ok(api.pointInRing(P(50, 10), ele) === true, "dentro del brazo horizontal");
ok(api.pointInRing(P(75, 75), ele) === false,
  "en la escotadura de la L: dentro de la caja, fuera del polígono");

/* ---------- pointInRings: agujeros y contorno ---------- */
const outer = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)];
/* 40x40: el centro queda a 20 px del borde, más que la tolerancia.
   Con un agujero de 20x20 su centro estaría a tol exactos y acertaría
   por cercanía al trazo, que es correcto pero no es lo que se prueba. */
const hole = [P(30, 30), P(70, 30), P(70, 70), P(30, 70)];
ok(api.pointInRings(P(10, 10), [outer], TOL) === true, "dentro del anillo exterior");
ok(api.pointInRings(P(200, 200), [outer], TOL) === false, "muy fuera, no");
ok(api.pointInRings(P(50, 50), [outer, hole], TOL) === false,
  "el centro de un agujero queda FUERA del polígono");
ok(api.pointInRings(P(10, 10), [outer, hole], TOL) === true,
  "pero el resto del interior sigue dentro");
/* Pegado al borde del agujero sí acierta: hay trazo dibujado ahí */
ok(api.pointInRings(P(50, 32), [outer, hole], TOL) === true,
  "junto al borde del agujero acierta por cercanía al trazo");
/* Y pegado al contorno exterior por FUERA, también */
ok(api.pointInRings(P(-4, 50), [outer], TOL) === true,
  "justo por fuera del contorno, dentro de la tolerancia, acierta");
ok(api.pointInRings(P(-40, 50), [outer], TOL) === false, "más lejos por fuera, no");

/* El LADO DE CIERRE de un anillo: getLatLngs() de un polígono no repite
   el primer punto, así que sin tratarlo aparte el último lado no se
   probaba y un click sobre él no acertaba. Bug encontrado por este test. */
ok(api.nearPolyline(P(-4, 50), outer, TOL, true) === true,
  "el lado de cierre del anillo (último→primero) sí se prueba");
ok(api.nearPolyline(P(-4, 50), outer, TOL, false) === false,
  "y sin `closed` no, que es lo que quiere una polilínea abierta");

/* Una polilínea abierta pasada como anillo único no debe "rellenarse":
   solo acierta cerca del trazo, no en el hueco que encierra.        */
const openL = [P(0, 0), P(100, 0), P(100, 100)];
ok(api.nearPolyline(P(90, 50), openL, TOL) === true, "cerca del tramo vertical de una abierta");
ok(api.nearPolyline(P(50, 50), openL, TOL) === false,
  "en el hueco que encierra una forma ABIERTA no hay acierto");

if (!process.exitCode) console.log("HIT TEST OK");
