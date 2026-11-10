/* Movimiento, respuesta al pulsar y materiales de la interfaz
   (.claude/rules/motion.md; criterios de apple-design).

   Lo que se comprueba, en un navegador de verdad y no sobre el texto del CSS:
   - Movimiento reducido (lo que piden las demás suites, ver `openApp`): NADA
     se anima —ni el giro de `.spinner`, ni la entrada del menú y de las
     ventanas, ni el hundido del botón—, pero el menú y las ventanas salen.
   - Sin esa preferencia: el menú contextual y las ventanas ENTRAN con una
     animación corta (120 y 160 ms) y el menú crece desde el punto pulsado,
     también cuando el borde de la pantalla lo desplaza. Cerrar es inmediato.
   - Un botón responde al PULSAR (no al soltar): `:active` lo hunde al
     instante, y soltarlo lo devuelve.
   - El separador se arrastra con Pointer Events: respeta dónde se agarró,
     sigue al puntero aunque salga del separador (captura), pide UN
     `invalidateSize` por fotograma y no actúa con el diseño de móvil.
   - Elegir un tema en Propiedades lo suaviza (250 ms) y el arranque no.
   - Transparencia reducida y contraste alto, si el navegador deja emularlos.
   - El título del panel lleva tracking negativo.                          */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER MOTION TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8913);

const rightClickMap = async (page, fx, fy) => {
  const box = await page.evaluate(() => {
    const r = document.getElementById("map").getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height };
  });
  const x = box.l + box.w * fx, y = box.t + box.h * fy;
  await page.mouse.click(x, y, { button: "right" });
  await page.waitForFunction(() => !document.getElementById("map-ctxmenu").hidden);
  return { x, y };
};
const closeMenu = async page => {
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.getElementById("map-ctxmenu").hidden);
};
const menuAnim = page => page.evaluate(() => {
  const m = document.getElementById("map-ctxmenu");
  const a = m.getAnimations().find(x => x.animationName === "enter-menu");
  const out = {
    name: getComputedStyle(m).animationName,
    duration: a ? a.effect.getComputedTiming().duration : null,
    origin: m.style.getPropertyValue("--ctx-origin")
  };
  /* la caja se mide con la entrada ACABADA: a medias el rect lleva la escala */
  m.getAnimations().forEach(x => x.finish());
  const r = m.getBoundingClientRect();
  return { ...out, left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
});

/* ============ 1. Movimiento reducido (lo de siempre en las suites) ============ */
{
  const { ctx, page, errors } = await openApp(browser, srv.url); /* reducedMotion: "reduce" */
  ok(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches),
    "el contexto de prueba pide movimiento reducido");

  const spin = await page.evaluate(() => {
    const s = document.createElement("span");
    s.className = "spinner";
    document.body.appendChild(s);
    const r = { reduced: getComputedStyle(s).animationName };
    s.remove();
    return r;
  });
  ok(spin.reduced === "none", "movimiento reducido: el spinner no gira: " + spin.reduced);

  await rightClickMap(page, 0.3, 0.3);
  const m = await menuAnim(page);
  ok(m.name === "none" && m.duration === null, "movimiento reducido: el menú sale sin animación: " + JSON.stringify(m));
  ok(await page.evaluate(() => getComputedStyle(document.getElementById("map-ctxmenu")).opacity) === "1",
    "…y a opacidad completa al instante");
  await closeMenu(page);

  await page.evaluate(() => document.getElementById("gnp-editor-btn").click());
  await page.waitForFunction(() => !document.getElementById("props-dialog").hidden);
  const d = await page.evaluate(() => {
    const b = document.querySelector("#props-dialog .dlg-box");
    return { name: getComputedStyle(b).animationName, n: b.getAnimations().length };
  });
  ok(d.name === "none" && d.n === 0, "movimiento reducido: la ventana sale sin animación: " + JSON.stringify(d));
  await page.evaluate(() => document.getElementById("props-cancel").click());

  /* El botón no se hunde con movimiento reducido: sigue respondiendo (el
     fondo y el filtro cambian) pero no se mueve. */
  const btn = await page.evaluate(() => {
    const r = document.getElementById("help-btn").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(btn.x, btn.y);
  await page.mouse.down();
  const pressedReduced = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById("help-btn"));
    return { t: cs.transform, f: cs.filter };
  });
  await page.mouse.move(btn.x, btn.y + 80); /* soltar fuera: no es un clic */
  await page.mouse.up();
  ok(pressedReduced.t === "none", "movimiento reducido: el botón pulsado no se mueve: " + pressedReduced.t);
  ok(/brightness\(0\.94\)/.test(pressedReduced.f), "…pero sí responde (se oscurece): " + pressedReduced.f);

  /* Tema: con movimiento reducido no hay transición de colores */
  const th = await page.evaluate(() => {
    document.getElementById("gnp-editor-btn").click();
    return true;
  });
  await page.waitForFunction(() => !document.getElementById("props-dialog").hidden);
  await page.evaluate(() => {
    const sel = document.getElementById("props-theme");
    sel.value = "dark";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const soft = await page.evaluate(() => ({
    cls: document.documentElement.classList.contains("theme-switching"),
    dur: getComputedStyle(document.getElementById("nav-panel")).transitionDuration
  }));
  ok(soft.dur === "0s", "movimiento reducido: el cambio de tema no se anima: " + soft.dur);
  await page.evaluate(() => document.getElementById("props-cancel").click());

  ok(errors.length === 0, "sin errores en consola (reducido): " + errors.join(" | "));
  await ctx.close();
}

/* ============ 2. Sin preferencia: animaciones, pulsar, separador, tema ============ */
{
  const { ctx, page, errors } = await openApp(browser, srv.url, { reducedMotion: "no-preference" });
  ok(await page.evaluate(() => !matchMedia("(prefers-reduced-motion: reduce)").matches),
    "este contexto NO pide movimiento reducido");

  /* --- Menú contextual: entra en 120 ms desde el punto pulsado --- */
  const p1 = await rightClickMap(page, 0.3, 0.3);
  const m1 = await menuAnim(page);
  ok(m1.name === "enter-menu" && m1.duration === 120, "el menú entra con enter-menu en 120 ms: " + JSON.stringify(m1));
  const [ox1, oy1] = m1.origin.split(" ").map(parseFloat);
  ok(Math.abs(m1.left + ox1 - p1.x) < 1.5 && Math.abs(m1.top + oy1 - p1.y) < 1.5,
    `el menú crece desde el punto pulsado: origen ${m1.origin} en la caja (${m1.left.toFixed(0)}, ${m1.top.toFixed(0)}), clic (${p1.x.toFixed(0)}, ${p1.y.toFixed(0)})`);
  /* La animación acaba en el estado normal, sin transformación que se quede */
  ok(await page.evaluate(() => getComputedStyle(document.getElementById("map-ctxmenu")).transform) === "none",
    "tras entrar, el menú no conserva ninguna transformación");
  await closeMenu(page);
  ok(await page.evaluate(() => document.getElementById("map-ctxmenu").getAnimations().length) === 0,
    "cerrar es inmediato: sin animación de salida");

  /* Cerca de la esquina inferior derecha el borde de la pantalla desplaza la
     caja: el origen sigue en el puntero (queda a la derecha y abajo de ella). */
  const p2 = await rightClickMap(page, 0.97, 0.97);
  const m2 = await menuAnim(page);
  const [ox2, oy2] = m2.origin.split(" ").map(parseFloat);
  ok(ox2 > 5 && oy2 > 5, "con el menú desplazado por el borde, el origen no es la esquina: " + m2.origin);
  ok(Math.abs(m2.left + ox2 - p2.x) < 1.5 && Math.abs(m2.top + oy2 - p2.y) < 1.5,
    "…y sigue siendo el punto pulsado: " + m2.origin);
  /* El tope contra el borde usa el tamaño de layout, no el de la caja a medio
     escalar: con la entrada acabada la caja cabe, con su margen de 4 px */
  ok(m2.right <= m2.vw - 3 && m2.bottom <= m2.vh - 3,
    `la caja desplazada cabe en la pantalla con su margen (derecha ${m2.right.toFixed(1)}/${m2.vw}, abajo ${m2.bottom.toFixed(1)}/${m2.vh})`);
  await closeMenu(page);

  /* --- Ventana: entra en 160 ms, cerrar es inmediato, la posición no se toca --- */
  await page.evaluate(() => document.getElementById("gnp-editor-btn").click());
  await page.waitForFunction(() => !document.getElementById("props-dialog").hidden);
  const d = await page.evaluate(async () => {
    const b = document.querySelector("#props-dialog .dlg-box");
    const a = b.getAnimations().find(x => x.animationName === "enter-dialog");
    const during = getComputedStyle(b).transform;
    const out = { name: a && a.animationName, dur: a && a.effect.getComputedTiming().duration, during };
    const before = b.getBoundingClientRect();
    if (a) await a.finished;
    const after = b.getBoundingClientRect();
    out.after = getComputedStyle(b).transform;
    out.dx = Math.abs((before.left + before.width / 2) - (after.left + after.width / 2));
    return out;
  });
  ok(d.name === "enter-dialog" && d.dur === 160, "la ventana entra con enter-dialog en 160 ms: " + JSON.stringify(d));
  ok(d.after === "none", "tras entrar, la ventana no conserva ninguna transformación: " + d.after);
  ok(d.dx < 1, "la escala parte del centro: la ventana no se desplaza al entrar: " + d.dx);
  await page.evaluate(() => document.getElementById("props-cancel").click());
  ok(await page.evaluate(() => document.getElementById("props-dialog").hidden), "cerrar la ventana es inmediato");

  /* --- Pulsar: respuesta al bajar el botón, no al soltarlo --- */
  const btn = await page.evaluate(() => {
    const r = document.getElementById("help-btn").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(btn.x, btn.y);
  const resting = await page.evaluate(() => getComputedStyle(document.getElementById("help-btn")).transform);
  await page.mouse.down();
  const pressed = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById("help-btn"));
    return { t: cs.transform, f: cs.filter };
  });
  ok(resting === "none", "el botón en reposo no tiene transformación: " + resting);
  ok(pressed.t === "matrix(0.97, 0, 0, 0.97, 0, 0)", "al PULSAR el botón se hunde al instante (scale .97): " + pressed.t);
  ok(/brightness\(0\.94\)/.test(pressed.f), "…y se oscurece: " + pressed.f);
  ok(await page.evaluate(() => document.getElementById("shortcuts").hidden),
    "…sin haber soltado todavía: la ayuda aún no se ha abierto");
  await page.mouse.move(btn.x, btn.y + 80);
  await page.mouse.up();
  ok(await page.evaluate(() => document.getElementById("shortcuts").hidden),
    "soltar fuera del botón no lo acciona (la respuesta al pulsar no cambia el gesto)");
  await page.waitForFunction(() => getComputedStyle(document.getElementById("help-btn")).transform === "none");
  ok(true, "al soltar, el botón vuelve a su sitio");

  /* Un botón deshabilitado no se hunde */
  const dis = await page.evaluate(() => {
    const b = document.createElement("button");
    b.className = "btn"; b.disabled = true; b.textContent = "x";
    document.getElementById("nav-panel").appendChild(b);
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(dis.x, dis.y);
  await page.mouse.down();
  ok(await page.evaluate(() => getComputedStyle(document.querySelector("#nav-panel > button.btn:disabled")).transform) === "none",
    "un botón deshabilitado no se hunde");
  await page.mouse.up();
  await page.evaluate(() => document.querySelector("#nav-panel > button.btn:disabled").remove());

  /* --- Separador: Pointer Events, agarre, captura y un invalidateSize por fotograma --- */
  const geo = await page.evaluate(() => {
    const r = document.getElementById("splitter").getBoundingClientRect();
    return { x: r.left, y: r.top + r.height / 2, w: r.width,
      nav: document.getElementById("nav-panel").getBoundingClientRect().width };
  });
  await page.evaluate(() => {
    window.__resizes = 0; window.__frames = 0;
    const orig = map.invalidateSize.bind(map);
    map.invalidateSize = (...a) => { window.__resizes++; return orig(...a); };
    const tick = () => { window.__frames++; window.__raf = requestAnimationFrame(tick); };
    tick();
  });
  const grabX = geo.x + 3; /* agarrado a 3 px del borde izquierdo del separador */
  await page.mouse.move(grabX, geo.y);
  await page.mouse.down();
  ok(await page.evaluate(() => document.body.classList.contains("resizing")), "pulsar el separador empieza el arrastre");
  await page.mouse.move(grabX, geo.y);
  const still = await page.evaluate(() => document.getElementById("nav-panel").getBoundingClientRect().width);
  ok(Math.abs(still - geo.nav) < 0.5, `agarrar el separador no hace saltar el borde (${geo.nav} → ${still})`);
  /* 40 movimientos hasta 120 px a la derecha, saliendo del separador y del panel: la
     captura del puntero mantiene el seguimiento sobre el mapa */
  await page.mouse.move(grabX + 120, geo.y, { steps: 40 });
  const moved = await page.evaluate(() => document.getElementById("nav-panel").getBoundingClientRect().width);
  ok(Math.abs(moved - (geo.nav + 120)) < 0.5, `el borde sigue al puntero 1:1 sobre el mapa (${geo.nav} + 120 = ${geo.nav + 120}; hay ${moved})`);
  await page.mouse.up();
  const rs = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    return { resizes: window.__resizes, frames: window.__frames, resizing: document.body.classList.contains("resizing") };
  });
  ok(!rs.resizing, "soltar termina el arrastre");
  ok(rs.resizes >= 1, "el mapa se redimensiona al soltar: " + rs.resizes);
  ok(rs.resizes <= rs.frames + 1, `como mucho UN invalidateSize por fotograma (${rs.resizes} llamadas, ${rs.frames} fotogramas)`);
  /* Tras soltar, mover el puntero no arrastra */
  await page.mouse.move(grabX + 300, geo.y);
  ok(Math.abs(await page.evaluate(() => document.getElementById("nav-panel").getBoundingClientRect().width) - moved) < 0.5,
    "tras soltar, mover el puntero ya no arrastra");

  /* Con el diseño de móvil el separador no actúa (setNavWidth taparía --nav-width) */
  await page.evaluate(() => { document.documentElement.classList.add("phone-layout"); });
  const g2 = await page.evaluate(() => {
    const r = document.getElementById("splitter").getBoundingClientRect();
    return { x: r.left + 2, y: r.top + r.height / 2, inline: document.documentElement.style.getPropertyValue("--nav-width") };
  });
  await page.mouse.move(g2.x, g2.y);
  await page.mouse.down();
  await page.mouse.move(g2.x + 60, g2.y, { steps: 5 });
  await page.mouse.up();
  ok(await page.evaluate(() => document.documentElement.style.getPropertyValue("--nav-width")) === g2.inline,
    "con phone-layout el separador no escribe --nav-width");
  await page.evaluate(() => document.documentElement.classList.remove("phone-layout"));

  /* --- Tema: suave desde Propiedades, no al arrancar --- */
  ok(await page.evaluate(() => !document.documentElement.classList.contains("theme-switching")),
    "al arrancar no hay transición de tema");
  await page.evaluate(() => document.getElementById("gnp-editor-btn").click());
  await page.waitForFunction(() => !document.getElementById("props-dialog").hidden);
  const sw = await page.evaluate(() => {
    const sel = document.getElementById("props-theme");
    sel.value = "dark";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      cls: document.documentElement.classList.contains("theme-switching"),
      dur: getComputedStyle(document.getElementById("nav-panel")).transitionDuration
    };
  });
  ok(sw.cls && /^0\.25s(, 0\.25s)*$/.test(sw.dur), "elegir un tema lo suaviza 250 ms: " + JSON.stringify(sw));
  await page.waitForFunction(() => !document.documentElement.classList.contains("theme-switching"), null, { timeout: 2000 });
  ok(await page.evaluate(() => getComputedStyle(document.getElementById("nav-panel")).transitionDuration) === "0s",
    "pasados 250 ms la clase se retira y no queda ninguna transición");
  await page.evaluate(() => document.getElementById("props-cancel").click());
  /* Cancelar reaplica el tema original, también suave: se mide con el
     cambio ACABADO, o el fondo estaría a medio camino entre los dos. */
  await page.waitForFunction(() => !document.documentElement.classList.contains("theme-switching"), null, { timeout: 2000 });

  /* --- Material y tipografía --- */
  const mat = await page.evaluate(() => ({
    coords: getComputedStyle(document.querySelector(".coords-box")).backdropFilter,
    attr: getComputedStyle(document.querySelector(".leaflet-control-attribution")).backdropFilter,
    h1: getComputedStyle(document.querySelector("#nav-panel h1")).letterSpacing
  }));
  ok(/blur\(8px\)/.test(mat.coords), "la caja de coordenadas es un material (desenfoque): " + mat.coords);
  ok(/blur\(8px\)/.test(mat.attr), "la atribución también: " + mat.attr);
  ok(parseFloat(mat.h1) < 0, "el título del panel lleva tracking negativo: " + mat.h1);

  /* --- Transparencia reducida y contraste alto, si el navegador deja emularlos --- */
  const cdp = await ctx.newCDPSession(page);
  try {
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
    const supported = await page.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches);
    if (supported) {
      const t = await page.evaluate(() => ({
        coords: getComputedStyle(document.querySelector(".coords-box")).backdropFilter,
        bg: getComputedStyle(document.querySelector(".coords-box")).backgroundColor
      }));
      ok(t.coords === "none", "con transparencia reducida la caja de coordenadas no desenfoca: " + t.coords);
      ok(!/rgba/.test(t.bg), "…y es opaca: " + t.bg);
    } else console.log("(transparencia reducida no emulable en este Chromium: omitido)");
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "no-preference" }] });
  } catch (e) { console.log("(transparencia reducida no emulable: " + e.message.split("\n")[0] + ")"); }
  try {
    const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--border").trim());
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-contrast", value: "more" }] });
    const supported = await page.evaluate(() => matchMedia("(prefers-contrast: more)").matches);
    if (supported) {
      const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--border").trim());
      ok(after !== before, `con contraste alto el borde cambia (${before} → ${after})`);
    } else console.log("(contraste alto no emulable en este Chromium: omitido)");
  } catch (e) { console.log("(contraste alto no emulable: " + e.message.split("\n")[0] + ")"); }

  ok(errors.length === 0, "sin errores en consola: " + errors.join(" | "));
  await ctx.close();
}

await browser.close();
srv.close();
done();
