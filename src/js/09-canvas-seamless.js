/* ================= Polígonos de «solo relleno» sin costuras =================
   Canvas (y SVG) dibujan cada polígono con su propio antialiasing. Dos
   polígonos que comparten un borde dejan en él una costura de fondo:
   en el píxel que el borde cruza, cada uno cubre una fracción y las dos
   no suman uno (cobertura 0,5 + 0,5 compuestas → 0,75). Google Earth, que
   dibuja una malla en GPU, no la tiene. Con relleno translúcido se ve
   como una línea clara que cambia con el zoom, según dónde caiga el
   borde en la rejilla de píxeles.

   Lo que NO sirve (probado, y el primer intento lo hizo mal): pintar un
   contorno fino del color del relleno. Con opacidad < 1 ese trazo se
   solapa con el relleno del propio polígono y con el del vecino, y los
   solapes se SUMAN (0,7 sobre 0,7 = 0,91): el hueco claro se cambia por
   un contorno oscuro, justo lo que «solo relleno» promete no enseñar.

   Lo que sí: aplicar la opacidad UNA vez, al final. Los polígonos de solo
   relleno consecutivos en el orden de pintado, del mismo color y la misma
   opacidad (una «tanda»), se dibujan en un lienzo auxiliar TOTALMENTE
   OPACOS y con un trazo de 1 px de su color (opaco sobre opaco no se
   suma: es el mismo color), que tapa las costuras; y la tanda entera se
   compone sobre el mapa una sola vez con la opacidad del relleno. El
   resultado es el de un único polígono: opacidad uniforme, sin hueco y
   sin borde. Lo guardado y lo que recibe Leaflet no cambian (`stroke:
   false`); solo cambia cómo este lienzo los pinta.

   Una tanda se interrumpe con cualquier capa distinta (otro color u
   otra opacidad, o con contorno, o una línea), así que el orden de
   pintado es el de siempre. Lo que NO arregla: dos polígonos de
   colores distintos que se tocan (cada uno su tanda) siguen teniendo su
   costura, o, si ambas tandas tienen ≥ 2 polígonos, un borde de tres
   cuartos de píxel mezclado por el trazo de cada una — como cualquier
   par de capas translúcidas que se solapan. Una tanda de UN polígono no
   se abre (su vecino es de otro color: no ganaría nada) y hay un tope de
   tandas por redibujado (`SEAMLESS_MAX_RUNS`): cada una cuesta ~1,7 ms
   y 3 000 tandas de dos polígonos eran 5 s. El lienzo auxiliar es uno
   por renderizador y solo se limpia y se compone la caja que la tanda
   ha tocado.

   Atado a Leaflet 1.9.4: sustituye `L.Canvas._draw`, que es una copia de
   la de Leaflet con la tanda añadida, y envuelve `_fillStroke`. Al subir
   Leaflet, comparar con su `_draw` (tests/browser/seam-outline.mjs
   comprueba además que la tanda se compone y no se solapa). Va ANTES de
   crear el mapa (10-map.js), como 08 y 09.                            */

/* Grosor del trazo opaco que tapa la costura. Medido sobre cinco capas
   contiguas reales (pixeles de costura a z9; el resto son rendijas de los
   propios datos, que ningún grosor cierra): sin tanda ~16 800; con 1 px,
   144 con una opacidad al 80 % de la del relleno o más y 671 al 95 %;
   con 1,5 px, 123 y 133; con 2 px, 126 y 126. 1,5 es lo más fino que no
   deja un filete claro, y centrado en el borde solo engorda el polígono
   tres cuartos de píxel.                                              */
const SEAM_STROKE_WEIGHT = 1.5;

/* Tope de tandas con lienzo auxiliar por redibujado. Cada una cuesta
   ~1,7 ms (componer desde otro lienzo obliga al navegador a vaciar el
   auxiliar; medido sin GPU): 3 000 tandas de dos polígonos eran 5 s por
   redibujado. Pasado el tope se pinta como siempre —con costuras, sin
   estropear nada—. Medido con el tope: ver tests/browser/seam-outline.mjs.
   Una tanda de UN solo polígono no se cuenta ni se dibuja aparte: su
   vecino es de otro color y la costura seguiría ahí, así que no ganaría
   nada.                                                               */
const SEAMLESS_MAX_RUNS = 24;

/* ¿Se pinta esta capa como «solo relleno» sin costuras? Un polígono
   cerrado, relleno y SIN contorno, con algo que dibujar en la vista.   */
function isSeamlessFill(layer) {
  const o = layer.options;
  return layer instanceof L.Polygon && o.stroke === false && o.fill !== false
    && o.fillOpacity > 0 && !!layer._pxBounds && !!layer._parts;
}

/* ¿Van dos capas en la misma tanda? Mismo color y misma opacidad. */
function sameSeamlessFill(a, b) {
  return (a.options.fillColor || a.options.color) === (b.options.fillColor || b.options.color)
    && a.options.fillOpacity === b.options.fillOpacity;
}

const LEAFLET_CANVAS_FILL_STROKE = L.Canvas.prototype._fillStroke;

L.Canvas.include({
  /* Copia de `L.Canvas._draw` de Leaflet 1.9.4; lo único añadido son las
     tandas. Primero se recogen las capas que hay que pintar (en orden),
     luego se recorren: una tanda es un trecho seguido de polígonos de
     solo relleno con el mismo color y opacidad.                        */
  _draw() {
    const bounds = this._redrawBounds;
    const ctx = this._ctx;
    ctx.save();
    if (bounds) {
      const size = bounds.getSize();
      ctx.beginPath();
      ctx.rect(bounds.min.x, bounds.min.y, size.x, size.y);
      ctx.clip();
    }

    this._drawing = true;

    const layers = [];
    for (let order = this._drawFirst; order; order = order.next) {
      const layer = order.layer;
      if (bounds && !(layer._pxBounds && layer._pxBounds.intersects(bounds))) continue;
      /* Un trazo sin partes (recortado fuera de la vista) no dibuja
         nada: fuera, que no corte una tanda.                        */
      if (layer instanceof L.Polyline && layer._parts && !layer._parts.length) continue;
      layers.push(layer);
    }

    let runsLeft = SEAMLESS_MAX_RUNS;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      let end = i + 1;
      if (runsLeft > 0 && isSeamlessFill(layer)) {
        while (end < layers.length && isSeamlessFill(layers[end]) && sameSeamlessFill(layer, layers[end])) end++;
      }
      const run = end - i >= 2 && runsLeft > 0 ? this._beginSeamlessRun(layer) : null;
      if (run) {
        runsLeft--;
        for (; i < end; i++) this._drawInSeamlessRun(run, layers[i]);
        i = end - 1;
        this._endSeamlessRun(run);
      } else {
        layer._updatePath();
      }
    }

    this._drawing = false;

    ctx.restore(); /* Restore state before clipping. */
  },

  /* Abre una tanda: lienzo auxiliar del tamaño del principal y con su
     misma transformación (escala de pantalla retina y desplazamiento).
     Devuelve null si el navegador no puede (sin `getTransform`).       */
  _beginSeamlessRun(layer) {
    const main = this._ctx;
    if (!main.getTransform) return null;
    const cv = this._container;
    const off = this._seamlessCanvas || (this._seamlessCanvas = document.createElement("canvas"));
    if (off.width !== cv.width || off.height !== cv.height) { off.width = cv.width; off.height = cv.height; }
    const ctx = off.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(main.getTransform());
    const o = layer.options;
    return { off, ctx, alpha: o.fillOpacity,
      x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  },

  /* Dibuja una capa de la tanda en el lienzo auxiliar (cambiando
     `_ctx` para que `_updatePoly` de Leaflet escriba ahí) y anota la
     caja de pantalla que toca.                                         */
  _drawInSeamlessRun(run, layer) {
    const main = this._ctx;
    this._ctx = run.ctx;
    this._seamlessLayer = layer;
    try { layer._updatePath(); } finally { this._ctx = main; this._seamlessLayer = null; }
    const t = run.ctx.getTransform(), b = layer._pxBounds;
    const pad = SEAM_STROKE_WEIGHT * t.a + 2;
    run.x0 = Math.min(run.x0, t.a * b.min.x + t.e - pad);
    run.y0 = Math.min(run.y0, t.d * b.min.y + t.f - pad);
    run.x1 = Math.max(run.x1, t.a * b.max.x + t.e + pad);
    run.y1 = Math.max(run.y1, t.d * b.max.y + t.f + pad);
  },

  /* Cierra la tanda: la compone en el mapa con la opacidad del relleno y
     deja limpio el lienzo auxiliar para la siguiente. Siempre null.     */
  _endSeamlessRun(run) {
    const w = this._container.width, h = this._container.height;
    const x = Math.max(0, Math.floor(run.x0)), y = Math.max(0, Math.floor(run.y0));
    const sw = Math.min(w, Math.ceil(run.x1)) - x, sh = Math.min(h, Math.ceil(run.y1)) - y;
    if (sw > 0 && sh > 0) {
      const ctx = this._ctx;
      ctx.save(); /* el recorte de la zona a repintar sigue puesto */
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = run.alpha;
      ctx.drawImage(run.off, x, y, sw, sh, x, y, sw, sh);
      ctx.restore();
      run.ctx.save();
      run.ctx.setTransform(1, 0, 0, 1, 0, 0);
      run.ctx.clearRect(x, y, sw, sh);
      run.ctx.restore();
    }
    return null;
  },

  _fillStroke(ctx, layer) {
    if (layer !== this._seamlessLayer) return LEAFLET_CANVAS_FILL_STROKE.call(this, ctx, layer);
    const o = layer.options;
    ctx.globalAlpha = 1;
    ctx.fillStyle = ctx.strokeStyle = o.fillColor || o.color;
    ctx.fill(o.fillRule || "evenodd");
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.lineWidth = SEAM_STROKE_WEIGHT;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.stroke();
  }
});
