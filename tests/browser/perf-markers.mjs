/* Índice de oyentes de Leaflet (09-leaflet-events.js): añadir N capas al
   mapa dejó de ser O(N²). Esta suite compara el ANTES y el DESPUÉS en la
   misma página —el parche se puede apagar con `setListenerIndex(false)`,
   que devuelve los métodos originales de Leaflet— y comprueba tres cosas:

   1. EQUIVALENCIA: sin y con el parche, los mismos escenarios dan el mismo
      resultado. Un índice que dijera «no está» de algo que sí está dejaría
      registrar un oyente dos veces (un marcador se movería dos veces por
      zoom); uno que dijera «sí está» de algo que ya se quitó impediría
      volver a registrarlo. Los escenarios son los que lo romperían:
      duplicados, quitar uno, volver a ponerlo, `once`, quitar con un
      `fire` en marcha (Leaflet sustituye entonces la lista por una copia),
      quitar todos, y un marcador real que sigue al zoom.
   2. TRABAJO, determinista: cuántos oyentes recorre la búsqueda lineal
      original al añadir N marcadores. Sin parche es N²/2; con él, casi
      nada. No depende de la velocidad de la máquina.
   3. TIEMPO, con holgura: añadir 10 000 marcadores es claramente más
      rápido con el parche y su coste crece más despacio con N.          */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER MARKER PERF TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8903);
const { page, errors } = await openApp(browser, srv.url);

/* ---------- 1. Equivalencia, antes y después ---------- */
const traces = await page.evaluate(() => {
  const scenario = () => {
    const out = [];
    const ev = new L.Evented();
    const calls = [];
    const mk = i => { const f = () => calls.push(i); f.i = i; return f; };
    const fns = Array.from({ length: 120 }, (_, i) => mk(i));
    const ctxs = Array.from({ length: 120 }, () => ({}));
    const flush = () => { const c = calls.splice(0).join(","); return c; };
    const n = () => (ev._events.go || []).length;

    /* 120 oyentes (cruza el umbral del índice), mismo contexto cada uno */
    fns.forEach((f, i) => ev.on("go", f, ctxs[i]));
    out.push(["alta", n()]);
    ev.fire("go"); out.push(["fire", flush().split(",").length]);

    /* duplicados: ni con la misma función y contexto, ni con `on` repetido */
    fns.forEach((f, i) => ev.on("go", f, ctxs[i]));
    out.push(["duplicados rechazados", n()]);
    /* misma función con OTRO contexto SÍ es otro oyente */
    ev.on("go", fns[0], ctxs[1]);
    out.push(["otro contexto", n()]);
    ev.off("go", fns[0], ctxs[1]);
    out.push(["y se quita", n()]);

    /* quitar uno y volver a ponerlo */
    ev.off("go", fns[50], ctxs[50]);
    out.push(["quitado", n()]);
    ev.fire("go"); out.push(["fire sin él", !flush().split(",").includes("50")]);
    ev.on("go", fns[50], ctxs[50]);
    out.push(["vuelto a poner", n()]);
    ev.on("go", fns[50], ctxs[50]);
    out.push(["y sin duplicarlo", n()]);
    ev.fire("go"); out.push(["fire con él", flush().split(",").filter(x => x === "50").length]);

    /* quitar algo que no está no rompe nada */
    ev.off("go", fns[3], ctxs[4]);
    out.push(["off de lo inexistente", n()]);

    /* once: se dispara una vez y puede volver a registrarse */
    const o = mk("once"), octx = {};
    ev.once("go", o, octx);
    ev.fire("go"); ev.fire("go");
    out.push(["once, disparos", flush().split(",").filter(x => x === "once").length]);
    ev.once("go", o, octx);
    ev.fire("go");
    out.push(["once registrado otra vez", flush().split(",").filter(x => x === "once").length]);

    /* quitar con un fire en marcha: Leaflet cambia la lista por una copia */
    const killer = () => { calls.push("killer"); ev.off("go", fns[10], ctxs[10]); };
    const kctx = {};
    ev.on("go", killer, kctx);
    ev.fire("go");
    out.push(["fire con off dentro", flush().split(",").includes("killer")]);
    ev.on("go", fns[10], ctxs[10]);
    out.push(["tras la copia, volver a poner el quitado", n()]);
    ev.on("go", fns[10], ctxs[10]);
    out.push(["y sin duplicar", n()]);
    ev.off("go", killer, kctx);
    ev.fire("go");
    out.push(["la copia sigue siendo coherente", flush().split(",").length]);

    /* quitar todos y volver a empezar */
    ev.off("go");
    out.push(["off total", (ev._events.go || []).length]);
    fns.forEach((f, i) => ev.on("go", f, ctxs[i]));
    out.push(["tras off total, alta de nuevo", n()]);

    /* el propio objeto como contexto (Leaflet guarda `undefined`) */
    const self = new L.Evented(), sf = () => {};
    for (let i = 0; i < 80; i++) self.on("x", () => {});
    self.on("x", sf, self); self.on("x", sf, self); self.on("x", sf);
    out.push(["contexto = el propio objeto", self._events.x.length]);
    self.off("x", sf, self);
    out.push(["y su baja", self._events.x.length]);

    /* un marcador real sigue al zoom, y el mapa no acumula oyentes */
    const g = L.featureGroup();
    const markers = [];
    for (let i = 0; i < 150; i++) {
      const m = L.marker([40 + (i % 15) * 0.01, -3.7 + Math.floor(i / 15) * 0.01]);
      markers.push(m); g.addLayer(m);
    }
    const before = (map._events.zoom || []).length;
    map.addLayer(g);
    out.push(["oyentes de zoom tras añadir", (map._events.zoom || []).length - before]);
    map.removeLayer(g);
    out.push(["y tras quitar", (map._events.zoom || []).length - before]);
    map.addLayer(g);
    out.push(["y tras volver a añadir", (map._events.zoom || []).length - before]);
    const z = map.getZoom();
    map.setView([40.07, -3.65], z + 1, { animate: false });
    const m0 = markers[0], pos = map.latLngToLayerPoint(m0.getLatLng()).round();
    out.push(["el marcador siguió al zoom", m0._icon._leaflet_pos.x === pos.x && m0._icon._leaflet_pos.y === pos.y]);
    map.removeLayer(g);
    map.setView([40.4, -3.7], z, { animate: false });
    return JSON.stringify(out);
  };
  setListenerIndex(false);
  const before = scenario();
  setListenerIndex(true);
  const after = scenario();
  return { before, after };
});
ok(traces.before === traces.after,
  "con y sin el índice, los mismos escenarios dan lo mismo:\n  antes   " + traces.before + "\n  después " + traces.after);
const trace = JSON.parse(traces.after);
const get = k => (trace.find(([n]) => n === k) || [])[1];
ok(get("duplicados rechazados") === 120, "duplicado rechazado: " + get("duplicados rechazados"));
ok(get("vuelto a poner") === 120 && get("y sin duplicarlo") === 120, "quitado y vuelto a poner: una sola vez");
ok(get("fire con él") === 1, "y se dispara una vez");
ok(get("once, disparos") === 1 && get("once registrado otra vez") === 1, "once: una vez, y se puede volver a registrar");
ok(get("y sin duplicar") === 121, "tras la copia de la lista, sin duplicados: " + get("y sin duplicar"));
ok(get("el marcador siguió al zoom") === true, "un marcador real sigue al zoom");
ok(get("oyentes de zoom tras añadir") === get("y tras volver a añadir"), "añadir, quitar y volver a añadir no acumula oyentes en el mapa");
ok(get("y tras quitar") === 0, "quitar el grupo deja el mapa sin sus oyentes: " + get("y tras quitar"));

/* ---------- 2. Trabajo de la búsqueda lineal, determinista ---------- */
const work = await page.evaluate(() => {
  const N = 4000;
  /* Se cuenta donde está la BÚSQUEDA LINEAL de Leaflet: sin parche es el
     propio prototipo; con él, el original que el índice solo consulta
     cuando no puede descartar el oyente por sí mismo.                  */
  const count = on => {
    setListenerIndex(on);
    const holder = on ? LEAFLET_EVENTS_ORIGINAL : L.Evented.prototype;
    let scanned = 0;
    const orig = holder._listens;
    holder._listens = function (type, fn, context) {
      scanned += ((this._events && this._events[type]) || []).length;
      return orig.call(this, type, fn, context);
    };
    const g = L.featureGroup();
    for (let i = 0; i < N; i++) g.addLayer(L.marker([40 + (i % 100) * 0.001, -4 + Math.floor(i / 100) * 0.001]));
    map.addLayer(g);
    holder._listens = orig;
    map.removeLayer(g);
    return scanned;
  };
  const before = count(false);
  const after = count(true);
  setListenerIndex(true);
  return { N, before, after };
});
ok(work.before > work.N * work.N / 4, `sin el índice la búsqueda recorre del orden de N²/2 oyentes (${work.before} con N=${work.N})`);
ok(work.after < work.N * 40, `con el índice, casi nada: ${work.after} oyentes recorridos con N=${work.N} (antes ${work.before})`);
ok(work.before / work.after > 100, `unas ${Math.round(work.before / Math.max(1, work.after))} veces menos trabajo`);

/* ---------- 3. Tiempo, con holgura ---------- */
const timing = await page.evaluate(() => {
  const best = (on, N) => {
    setListenerIndex(on);
    let t = Infinity;
    for (let r = 0; r < 2; r++) {
      const g = L.featureGroup();
      for (let i = 0; i < N; i++) g.addLayer(L.marker([40 + (i % 200) * 0.001, -4 + Math.floor(i / 200) * 0.001]));
      const s = performance.now();
      map.addLayer(g);
      t = Math.min(t, performance.now() - s);
      map.removeLayer(g);
    }
    return t;
  };
  const r = {};
  for (const N of [2500, 10000]) { r["before" + N] = best(false, N); r["after" + N] = best(true, N); }
  setListenerIndex(true);
  return r;
});
const f = x => Math.round(x);
console.log(`  añadir al mapa (ms): 2 500 → ${f(timing.before2500)} antes, ${f(timing.after2500)} después; ` +
  `10 000 → ${f(timing.before10000)} antes, ${f(timing.after10000)} después`);
ok(timing.after10000 < timing.before10000 * 0.8,
  `10 000 marcadores se añaden claramente más rápido con el índice (${f(timing.after10000)} ms frente a ${f(timing.before10000)} ms)`);
ok(timing.after10000 / timing.after2500 < timing.before10000 / timing.before2500,
  `y el coste crece más despacio con N (×${(timing.after10000 / timing.after2500).toFixed(1)} frente a ×${(timing.before10000 / timing.before2500).toFixed(1)} al cuadruplicarlo)`);

ok(errors.length === 0, "sin errores en consola: " + errors.join(" | "));
await browser.close();
srv.close();
done();
