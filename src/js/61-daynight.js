/* ================= Iluminación real (día/noche) ================= */
/* Efecto puramente decorativo (pedido explícito: "wow", no una utilidad
   técnica) que sombrea la parte visible del mapa según la posición real
   del sol AHORA MISMO, con la hora del propio reloj del navegador (que
   ya lleva la zona horaria incorporada: `Date.getTime()` es el instante
   UTC real, así que no hace falta ninguna lógica de huso horario aparte).

   Solo `subsolarPoint`/`sublunarPoint`/`solarElevationDeg` son
   matemática pura y verificable (tests/daynight.js); el resto es un
   shader WebGL que sombrea por píxel más una capa de Leaflet normal con
   la trayectoria y la posición del sol y la luna — no hay caída a
   Canvas2D si no hay WebGL, igual de deliberado que
   `hasHardwareAcceleration` en 10-map.js: es un extra visual, no algo
   de lo que dependa la aplicación.                                    */

/* Punto subsolar (donde el sol está en el cénit) en el instante `date`,
   por el algoritmo solar aproximado habitual (declinación + ecuación
   del tiempo a partir de los días transcurridos desde J2000.0). Precisión
   de sobra (~0,01°) para un efecto decorativo, no para navegación.    */
function subsolarPoint(date = new Date()) {
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const ms = date.getTime();
  const days = ms / 86400000 - 10957.5; /* desde 2000-01-01 12:00 UTC */
  const meanLon = (280.460 + 0.9856474 * days) % 360;
  const meanAnom = ((357.528 + 0.9856003 * days) % 360) * rad;
  const eclLon = (meanLon + 1.915 * Math.sin(meanAnom) + 0.020 * Math.sin(2 * meanAnom)) * rad;
  const obliquity = (23.439 - 0.0000004 * days) * rad;
  const decl = Math.asin(Math.sin(obliquity) * Math.sin(eclLon)) * deg;
  /* Ascensión recta, solo para la ecuación del tiempo */
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclLon), Math.cos(eclLon)) * deg;
  const eqTimeMin = 4 * (((meanLon - ra + 540) % 360) - 180); /* 4 min por grado */
  const utcHours = (ms / 3600000) % 24;
  const lng = ((-15 * (utcHours - 12 + eqTimeMin / 60) + 540) % 360) - 180;
  return { lat: decl, lng };
}

/* Elevación solar (grados sobre el horizonte, negativa bajo él) en
   (lat,lng) dado el punto subsolar. Pura trigonometría esférica: NO
   depende de ningún radio terrestre (son ángulos), así que no hay que
   tocar el EARTH_R de 51-geodesy.js — es un radio para distancias, un
   concepto distinto que aquí no pinta nada. */
function solarElevationDeg(lat, lng, subLat, subLng) {
  const rad = Math.PI / 180;
  const p1 = lat * rad, p2 = subLat * rad, dl = (lng - subLng) * rad;
  const sinEl = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.asin(Math.max(-1, Math.min(1, sinEl))) * (180 / Math.PI);
}

/* Punto sublunar (bajo el cual la luna está en el cénit) en el instante
   `date`. Fórmula lunar de baja precisión (los mismos términos
   principales que usa, por ejemplo, SunCalc.js): error de hasta ~1° en
   longitud, de sobra para un marcador decorativo — no para predecir
   eclipses. A diferencia del sol, la luna se mueve demasiado rápido
   para el atajo de "hora solar media" de `subsolarPoint`: hace falta el
   tiempo sidéreo de Greenwich (`gmst`) y la ascensión recta real.
   Contrastado contra un cálculo independiente (posición de referencia
   externa) para hoy: separación angular con el sol e iluminación
   aparente coherentes con la fase lunar real (~99% frente al ~97%
   publicado), y orto/ocaso en Madrid a menos de 15 minutos de la hora
   real — el margen esperable de una fórmula de baja precisión.        */
function sublunarPoint(date = new Date()) {
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const ms = date.getTime();
  const days = ms / 86400000 - 10957.5; /* desde 2000-01-01 12:00 UTC */
  const meanLon = (218.316 + 13.176396 * days) % 360;
  const meanAnom = ((134.963 + 13.064993 * days) % 360) * rad;
  const argLat = ((93.272 + 13.229350 * days) % 360) * rad;
  const eclLon = (meanLon + 6.289 * Math.sin(meanAnom)) * rad;
  const eclLat = 5.128 * Math.sin(argLat) * rad;
  const obliquity = (23.439 - 0.0000004 * days) * rad;

  const sinDec = Math.sin(eclLat) * Math.cos(obliquity) + Math.cos(eclLat) * Math.sin(obliquity) * Math.sin(eclLon);
  const decl = Math.asin(Math.max(-1, Math.min(1, sinDec))) * deg;
  const y = Math.sin(eclLon) * Math.cos(obliquity) - Math.tan(eclLat) * Math.sin(obliquity);
  const ra = Math.atan2(y, Math.cos(eclLon)) * deg;

  /* Tiempo sidéreo medio de Greenwich (grados). El punto sublunar es
     donde el ángulo horario de la luna es 0, es decir, donde la
     longitud cancela exactamente ese tiempo sidéreo menos la ascensión
     recta.                                                             */
  const gmst = (280.46061837 + 360.98564736629 * days) % 360;
  const gha = (((gmst - ra) % 360) + 360) % 360;
  const lng = ((-gha + 540) % 360) - 180;
  return { lat: decl, lng };
}

let dayNightOn = false;
let dnButton = null; /* asignado por el botón de la barra, en 70-view-controls.js */
let dnCanvas = null, dnGl = null, dnProgram = null, dnUniforms = null;
let dnFrame = null; /* rAF pendiente: un solo repintado por lote de eventos */
let dnTimer = null; /* refresco periódico mientras está activo (paso del tiempo real) */
const DAYNIGHT_REFRESH_MS = 60000;

/* Trayectoria (línea discontinua) y posición actual (icono) del sol y
   la luna. NO es una capa de Leaflet (L.Polyline/L.Marker): esas viven
   dentro de `.leaflet-map-pane`, que en cuanto se arrastra el mapa una
   sola vez recibe una transformación CSS que YA NO se deshace al
   soltar (Leaflet la deja puesta y compensa por su cuenta con el
   origen de píxel interno) — comprobado a mano: colocar aquí un pane
   propio dejaba el lienzo y los iconos desplazados exactamente lo que
   se había arrastrado, de forma permanente. La solución, la misma que
   usa Leaflet para sus PROPIOS controles (`.leaflet-control-container`,
   fuera del pane a propósito): un `<div>` normal, hermano de
   `.leaflet-map-pane`, con posición recalculada a mano en cada
   redibujado con `map.latLngToContainerPoint` — la misma función que
   usan los controles y que sí tiene en cuenta el arrastre en curso.
   Como la latitud fija a lo largo de un día en Web Mercator es una
   línea horizontal (el píxel Y de una latitud no depende de la
   longitud), basta un `border-top` a todo lo ancho, sin trazar nada. */
let dnOverlay = null, dnSunLine = null, dnMoonLine = null, dnSunIconEl = null, dnMoonIconEl = null;

function dnBuildCelestialOverlay() {
  dnOverlay = document.createElement("div");
  dnOverlay.className = "dn-celestial-overlay";
  map.getContainer().appendChild(dnOverlay);

  dnSunLine = document.createElement("div");
  dnSunLine.className = "dn-path dn-sun-path";
  dnMoonLine = document.createElement("div");
  dnMoonLine.className = "dn-path dn-moon-path";
  dnSunIconEl = document.createElement("span");
  dnSunIconEl.className = "dn-sun-icon";
  dnSunIconEl.textContent = "☀";
  dnMoonIconEl = document.createElement("span");
  dnMoonIconEl.className = "dn-moon-icon";
  dnMoonIconEl.textContent = "☽";
  dnOverlay.append(dnSunLine, dnMoonLine, dnSunIconEl, dnMoonIconEl);
}

/* Y del píxel de una latitud (misma para toda la anchura visible, ver
   arriba) y X,Y exactos del punto sub-solar/sub-lunar, todo con la
   MISMA función que usan los controles de Leaflet para su posición en
   pantalla — coherente con lo que se ve ahora mismo, arrastre incluido. */
function dnUpdateCelestialOverlay(sub, moon) {
  const sunY = map.latLngToContainerPoint([sub.lat, 0]).y;
  const moonY = map.latLngToContainerPoint([moon.lat, 0]).y;
  dnSunLine.style.top = `${sunY}px`;
  dnMoonLine.style.top = `${moonY}px`;
  const sunPt = map.latLngToContainerPoint([sub.lat, sub.lng]);
  const moonPt = map.latLngToContainerPoint([moon.lat, moon.lng]);
  dnSunIconEl.style.left = `${sunPt.x}px`;
  dnSunIconEl.style.top = `${sunPt.y}px`;
  dnMoonIconEl.style.left = `${moonPt.x}px`;
  dnMoonIconEl.style.top = `${moonPt.y}px`;
}

const DN_VERTEX_SRC = `
  attribute vec2 aPos;
  void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/* Cada píxel se traduce a lat/lng invirtiendo la MISMA proyección de
   teselas que usa Leaflet (Web Mercator "de teselas": la conversión
   píxel↔fracción normalizada no necesita ningún radio terrestre, solo
   hace falta para pasar de metros a píxeles, y aquí no se pasa por
   metros). El píxel del CENTRO en ese "mundo de teselas" lo da
   `map.project` en JS, así que el shader nunca reimplementa la
   proyección DIRECTA de Leaflet, solo la inversa alrededor de ese ancla
   — evita el fallo sutil de usar un radio distinto del que usa Leaflet
   (6378137 m de EPSG:3857, que no es el 6371000 de 51-geodesy.js).    */
const DN_FRAGMENT_SRC = `
  precision highp float;
  uniform vec2 uResolution;  /* tamaño del lienzo, en píxeles de DISPOSITIVO */
  uniform vec2 uCenterWorld; /* map.project(centro, zoom), píxeles de mundo (CSS) */
  uniform float uScale;      /* píxeles de mundo (CSS) por píxel de dispositivo */
  uniform float uWorldSize;  /* 256 * 2^zoom */
  uniform vec2 uSubsolar;    /* lat, lng del punto subsolar, en RADIANES */

  const float PI = 3.14159265358979;

  void main() {
    /* gl_FragCoord crece hacia ARRIBA; el mundo de teselas crece hacia
       el SUR, de ahí el signo distinto en cada eje. */
    vec2 screen = gl_FragCoord.xy - uResolution * 0.5;
    vec2 world = uCenterWorld + vec2(screen.x, -screen.y) * uScale;
    vec2 frac = world / uWorldSize;
    float lng = fract(frac.x) * 2.0 * PI - PI;
    /* GLSL ES 1.00 (WebGL1) no tiene sinh(): es de GLSL ES 3.00 en
       adelante. Forma explícita (exp(x)-exp(-x))/2, con exp() que sí es
       de siempre.                                                      */
    float x = PI - 2.0 * PI * frac.y;
    float lat = atan((exp(x) - exp(-x)) * 0.5);

    float sinEl = sin(lat) * sin(uSubsolar.x)
      + cos(lat) * cos(uSubsolar.x) * cos(lng - uSubsolar.y);
    float elevDeg = asin(clamp(sinEl, -1.0, 1.0)) * 180.0 / PI;

    /* Degradado día → crepúsculo → noche entre 0° y -18° (civil/náutico/
       astronómico); por encima de 0° totalmente transparente. Un halo
       cálido dentro de esa misma franja (nunca en el lado de día, donde
       ya es transparente y no se vería). */
    float night = 1.0 - smoothstep(-18.0, 0.0, elevDeg);
    float glow = smoothstep(-16.0, -9.0, elevDeg) * (1.0 - smoothstep(-9.0, -1.0, elevDeg));
    vec3 nightColor = vec3(0.02, 0.05, 0.14);
    vec3 glowColor = vec3(0.85, 0.45, 0.20);
    vec3 color = mix(nightColor, glowColor, glow * 0.7);
    gl_FragColor = vec4(color, night * 0.78);
  }
`;

function dnCompileShader(type, src) {
  const s = dnGl.createShader(type);
  dnGl.shaderSource(s, src);
  dnGl.compileShader(s);
  if (!dnGl.getShaderParameter(s, dnGl.COMPILE_STATUS)) {
    const info = dnGl.getShaderInfoLog(s);
    dnGl.deleteShader(s);
    throw new Error(info || "fallo al compilar el shader");
  }
  return s;
}

/* Crea el lienzo y el contexto WebGL. Devuelve false (sin dejar nada a
   medio montar) si el navegador no ofrece WebGL o falla la compilación
   — caso raro, tratado igual que `hasHardwareAcceleration`: se apaga el
   efecto, no la aplicación entera.

   El lienzo es HIJO DIRECTO del contenedor del mapa, hermano de
   `.leaflet-map-pane` (donde viven teselas, capas vectoriales y
   marcadores), NUNCA dentro de un pane de Leaflet — mismo motivo que
   `dnOverlay` más arriba: un pane hereda la transformación de arrastre
   de `.leaflet-map-pane`, que no se resetea al soltar (se probó: el
   lienzo quedaba desplazado exactamente el arrastre, de forma
   permanente). Como hermano, con `width/height: 100%` (el contenedor
   del mapa SÍ tiene tamaño propio, a diferencia de un pane) y un
   z-index por encima de `.leaflet-map-pane` (400), tapa el mapa entero
   —lo pretendido, la sombra debe cubrir también las capas del propio
   usuario— pero SIN pane que lo arrastre consigo; el shader recalcula
   su propia proyección en cada `dnRender()`, así que no necesita
   arrastrarse, solo mantenerse fijo sobre el visor. `dnOverlay` (arriba)
   va por encima de este lienzo, para que la sombra no tape sol/luna.  */
function dnInit() {
  dnCanvas = document.createElement("canvas");
  dnCanvas.className = "daynight-canvas"; /* solo para ocultarlo al exportar PNG */
  Object.assign(dnCanvas.style, {
    position: "absolute", top: "0", left: "0", width: "100%", height: "100%",
    pointerEvents: "none", /* nunca debe robar el arrastre del mapa ni los clics de los controles */
    zIndex: 610
  });
  map.getContainer().appendChild(dnCanvas);
  /* `preserveDrawingBuffer: true`: SIN esto el navegador puede borrar el
     lienzo entre un fotograma compuesto y el siguiente si no se ha
     vuelto a dibujar — y aquí NO se redibuja cada fotograma a propósito
     (solo al mover/hacer zoom/redimensionar o cada DAYNIGHT_REFRESH_MS),
     así que sin esta opción el efecto desaparecía solo unos instantes
     después de activarlo. Comprobado a mano: sin ella, un repintado
     hecho y no repetido se perdía en el siguiente fotograma compuesto. */
  const glOpts = { preserveDrawingBuffer: true };
  dnGl = dnCanvas.getContext("webgl", glOpts) || dnCanvas.getContext("experimental-webgl", glOpts);
  if (!dnGl) { dnCanvas.remove(); dnCanvas = null; return false; }
  try {
    const vs = dnCompileShader(dnGl.VERTEX_SHADER, DN_VERTEX_SRC);
    const fs = dnCompileShader(dnGl.FRAGMENT_SHADER, DN_FRAGMENT_SRC);
    dnProgram = dnGl.createProgram();
    dnGl.attachShader(dnProgram, vs);
    dnGl.attachShader(dnProgram, fs);
    dnGl.linkProgram(dnProgram);
    if (!dnGl.getProgramParameter(dnProgram, dnGl.LINK_STATUS)) {
      throw new Error(dnGl.getProgramInfoLog(dnProgram) || "fallo al enlazar el programa");
    }
  } catch (err) {
    console.error("Iluminación día/noche: WebGL no disponible", err);
    dnCanvas.remove();
    dnCanvas = null; dnGl = null; dnProgram = null;
    return false;
  }
  dnGl.useProgram(dnProgram);
  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  const buf = dnGl.createBuffer();
  dnGl.bindBuffer(dnGl.ARRAY_BUFFER, buf);
  dnGl.bufferData(dnGl.ARRAY_BUFFER, quad, dnGl.STATIC_DRAW);
  const aPos = dnGl.getAttribLocation(dnProgram, "aPos");
  dnGl.enableVertexAttribArray(aPos);
  dnGl.vertexAttribPointer(aPos, 2, dnGl.FLOAT, false, 0, 0);
  dnGl.enable(dnGl.BLEND);
  /* Separado para el canal alfa: con blendFunc a secas, el alfa de
     salida sale al CUADRADO (srcAlpha·srcAlpha sobre fondo transparente)
     y el efecto se ve mucho más tenue de lo pensado.                   */
  dnGl.blendFuncSeparate(dnGl.SRC_ALPHA, dnGl.ONE_MINUS_SRC_ALPHA, dnGl.ONE, dnGl.ONE_MINUS_SRC_ALPHA);
  dnGl.clearColor(0, 0, 0, 0); /* transparente: es el valor por defecto, explícito para no depender de él */
  dnUniforms = {
    resolution: dnGl.getUniformLocation(dnProgram, "uResolution"),
    centerWorld: dnGl.getUniformLocation(dnProgram, "uCenterWorld"),
    scale: dnGl.getUniformLocation(dnProgram, "uScale"),
    worldSize: dnGl.getUniformLocation(dnProgram, "uWorldSize"),
    subsolar: dnGl.getUniformLocation(dnProgram, "uSubsolar")
  };
  dnBuildCelestialOverlay();
  return true;
}

/* Recalcula tamaño de lienzo (por si cambió el devicePixelRatio o el
   tamaño de ventana) y repinta un fotograma con la posición del sol y
   la proyección actuales. `map.project` es la ÚNICA parte que reutiliza
   la proyección de Leaflet en vez de reimplementarla (ver comentario del
   fragment shader).                                                   */
function dnRender() {
  if (!dnGl) return;
  const size = map.getSize();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(size.x * dpr)), h = Math.max(1, Math.round(size.y * dpr));
  if (dnCanvas.width !== w || dnCanvas.height !== h) {
    dnCanvas.width = w;
    dnCanvas.height = h;
    dnCanvas.style.width = size.x + "px"; /* tamaño CSS en píxeles, ver dnInit */
    dnCanvas.style.height = size.y + "px";
    dnGl.viewport(0, 0, w, h);
  }
  const zoom = map.getZoom();
  const centerWorld = map.project(map.getCenter(), zoom);
  const worldSize = 256 * Math.pow(2, zoom);
  const sub = subsolarPoint();
  const moon = sublunarPoint();
  dnUpdateCelestialOverlay(sub, moon);

  dnGl.uniform2f(dnUniforms.resolution, w, h);
  dnGl.uniform2f(dnUniforms.centerWorld, centerWorld.x, centerWorld.y);
  dnGl.uniform1f(dnUniforms.scale, 1 / dpr);
  dnGl.uniform1f(dnUniforms.worldSize, worldSize);
  dnGl.uniform2f(dnUniforms.subsolar, sub.lat * Math.PI / 180, sub.lng * Math.PI / 180);
  /* `preserveDrawingBuffer: true` conserva el lienzo ENTRE fotogramas
     compuestos (necesario, ver dnInit), pero eso significa que también
     conserva el contenido del redibujado ANTERIOR: sin este `clear`,
     cada nuevo redibujado se mezclaría sobre el anterior en vez de
     sustituirlo, y el efecto se iría oscureciendo solo con cada
     movimiento del mapa o cada aviso del temporizador.                 */
  dnGl.clear(dnGl.COLOR_BUFFER_BIT);
  dnGl.drawArrays(dnGl.TRIANGLES, 0, 6);
}

function dnRequestRender() {
  if (dnFrame) return;
  dnFrame = requestAnimationFrame(() => { dnFrame = null; dnRender(); });
}

/* Se pausa el refresco periódico con la pestaña oculta (no hay nada que
   ver, y seguiría corriendo sin motivo) y se retoma al volver, con un
   repintado inmediato porque el sol no ha esperado.                   */
function dnVisibilityHandler() {
  if (!dayNightOn) return;
  if (document.hidden) {
    clearInterval(dnTimer);
    dnTimer = null;
  } else {
    dnRequestRender();
    if (!dnTimer) dnTimer = setInterval(dnRequestRender, DAYNIGHT_REFRESH_MS);
  }
}

function dnTeardown() {
  if (dnFrame) { cancelAnimationFrame(dnFrame); dnFrame = null; }
  if (dnTimer) { clearInterval(dnTimer); dnTimer = null; }
  document.removeEventListener("visibilitychange", dnVisibilityHandler);
  map.off("move zoom resize", dnRequestRender);
  if (dnCanvas) { dnCanvas.remove(); dnCanvas = null; }
  dnGl = null; dnProgram = null; dnUniforms = null;
  if (dnOverlay) { dnOverlay.remove(); dnOverlay = null; }
  dnSunLine = dnMoonLine = dnSunIconEl = dnMoonIconEl = null;
}

/* Interruptor único: no se persiste (como la retícula, es una
   preferencia de VISTA efímera, no de datos — no toca TREE_SCHEMA). */
function toggleDayNight() {
  dayNightOn = !dayNightOn;
  if (!dayNightOn) {
    dnTeardown();
    if (dnButton) dnButton.classList.remove("active");
    return;
  }
  if (!dnInit()) {
    dayNightOn = false;
    navMessage("Este navegador no admite WebGL: no se puede mostrar la iluminación real.");
    return;
  }
  if (dnButton) dnButton.classList.add("active");
  map.on("move zoom resize", dnRequestRender);
  document.addEventListener("visibilitychange", dnVisibilityHandler);
  dnTimer = setInterval(dnRequestRender, DAYNIGHT_REFRESH_MS);
  dnRequestRender();
}
