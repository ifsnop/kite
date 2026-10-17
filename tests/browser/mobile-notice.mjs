/* Aviso al abrir la aplicación desde un móvil (50-splitter.js): el panel
   de navegación y el mapa no caben a la vez, así que se recomienda un
   ordenador, y quien insiste se queda solo con el mapa.

   «Móvil» = puntero táctil Y lado corto de la ventana < 600 px. La suite
   emula dispositivos de verdad (táctil + `isMobile`) y comprueba tanto
   quién SÍ lo recibe —un teléfono en vertical y en horizontal— como quién
   NO: una tableta y una ventana de escritorio estrecha, que tiene ratón y
   puede ensancharse.

   Lo que importa del diseño, y que se comprueba:
   - «Continuar de todos modos» deja SOLO el mapa con el mismo estado
     `nav-hidden` del botón ◀ (no uno nuevo), y la flecha sigue siendo
     alcanzable con un dedo para volver al panel.
   - Con el panel mostrado en un móvil CABE en la pantalla y su botón
     también: con los 400 px de escritorio el botón quedaba fuera y, una
     vez abierto el panel, no había forma de volver al mapa.
   - La elección se recuerda: la carga siguiente no vuelve a preguntar.   */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER MOBILE NOTICE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8905);

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 };
const PHONE_LANDSCAPE = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 };
const TABLET = { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true };
const NARROW_DESKTOP = { viewport: { width: 390, height: 844 } };
const DESKTOP = { viewport: { width: 1280, height: 800 } };

const state = page => page.evaluate(() => {
  const r = id => document.getElementById(id).getBoundingClientRect();
  const nav = getComputedStyle(document.getElementById("nav-panel"));
  const dlg = document.getElementById("mobile-notice");
  return {
    noticeOpen: !dlg.hidden,
    phoneLayout: document.documentElement.classList.contains("phone-layout"),
    navHiddenClass: document.body.classList.contains("nav-hidden"),
    navDisplay: nav.display,
    navWidth: r("nav-panel").width,
    mapWidth: r("map").width,
    toggle: { left: r("nav-toggle").left, right: r("nav-toggle").right, w: r("nav-toggle").width, text: document.getElementById("nav-toggle").textContent },
    vw: window.innerWidth,
    coarse: matchMedia("(pointer: coarse)").matches
  };
});

/* ---------- Un teléfono en vertical recibe el aviso ---------- */
{
  const { page, ctx, errors } = await openApp(browser, srv.url, PHONE);
  const s = await state(page);
  ok(s.coarse, "el contexto emulado tiene puntero táctil (la base del criterio)");
  ok(s.noticeOpen, "el aviso se abre al cargar");
  ok(s.phoneLayout, "y el diseño de móvil está puesto");

  const dlg = await page.evaluate(() => {
    const box = document.querySelector("#mobile-notice .dlg-box");
    const b = box.getBoundingClientRect();
    const name = document.getElementById(box.getAttribute("aria-labelledby"));
    const close = document.getElementById("mobile-close").getBoundingClientRect();
    const cont = document.getElementById("mobile-continue").getBoundingClientRect();
    return {
      role: box.getAttribute("role"), modal: box.getAttribute("aria-modal"), name: name && name.textContent,
      inside: b.left >= 0 && b.right <= window.innerWidth && b.top >= 0 && b.bottom <= window.innerHeight,
      focusId: document.activeElement && document.activeElement.id,
      text: box.textContent,
      closeLeftOfContinue: close.left < cont.left
    };
  });
  ok(dlg.role === "dialog" && dlg.modal === "true", "es un diálogo modal accesible");
  ok(dlg.name === "Mejor desde un ordenador", "se llama «Mejor desde un ordenador»: " + dlg.name);
  ok(/ordenador/.test(dlg.text) && /solo el mapa/.test(dlg.text), "recomienda un ordenador y explica qué pasa si se continúa");
  ok(dlg.inside, "cabe entera en la pantalla del móvil");
  ok(dlg.focusId === "mobile-close" || dlg.focusId === "mobile-continue", "el foco entra en el diálogo: " + dlg.focusId);
  ok(dlg.closeLeftOfContinue, "«Cerrar» a la izquierda y lo que confirma a la derecha (orden de botones del proyecto)");

  /* Sin elegir nada, el panel ya cabe en la pantalla y su botón también */
  ok(s.navWidth <= s.vw - 20, `el panel cabe en el móvil: ${Math.round(s.navWidth)} de ${s.vw} px`);
  ok(s.toggle.right <= s.vw, `y el botón ◀ no queda fuera de la pantalla (borde derecho en ${Math.round(s.toggle.right)} de ${s.vw})`);
  ok(s.toggle.w >= 24, "con un tamaño que un dedo acierta: " + s.toggle.w + " px");

  /* ----- Continuar de todos modos: solo el mapa ----- */
  await page.click("#mobile-continue");
  const c = await state(page);
  ok(!c.noticeOpen, "el aviso se cierra");
  ok(c.navHiddenClass && c.navDisplay === "none", "el panel de navegación se oculta (el mismo nav-hidden del botón ◀)");
  ok(c.mapWidth >= c.vw - 2, `y el mapa ocupa toda la pantalla: ${Math.round(c.mapWidth)} de ${c.vw} px`);
  ok(c.toggle.left >= 0 && c.toggle.right <= c.vw && c.toggle.text === "▶", "la flecha ▶ está a la vista para volver al panel");
  ok(await page.evaluate(() => dbLoadMobileView()) === "map", "la elección se guarda");
  ok(await page.evaluate(() => { const m = map.getSize(); return m.x >= window.innerWidth - 2; }), "Leaflet conoce el tamaño nuevo del mapa (invalidateSize)");

  /* ----- Volver al panel con un toque, y otra vez al mapa ----- */
  await page.tap("#nav-toggle");
  const back = await state(page);
  ok(!back.navHiddenClass && back.navDisplay !== "none", "un toque en la flecha muestra el panel");
  ok(back.navWidth <= back.vw - 20 && back.toggle.right <= back.vw, "el panel cabe y la flecha sigue alcanzable: no es una trampa");
  await page.tap("#nav-toggle");
  ok((await state(page)).navHiddenClass, "y otro toque vuelve al mapa solo");

  /* ----- Recargar: se aplica lo elegido sin volver a preguntar ----- */
  await page.reload();
  await page.waitForFunction(() => typeof map === "object" && map && document.querySelector("#tree .empty, #tree ul.node-list"));
  const r = await state(page);
  ok(!r.noticeOpen, "al recargar no vuelve a preguntar");
  ok(r.navHiddenClass && r.phoneLayout, "y se queda solo con el mapa");
  ok(errors.length === 0, "sin errores en consola: " + errors.join(" | "));
  await ctx.close();
}

/* ---------- Cerrar el aviso: se queda con la navegación, y también se recuerda ---------- */
{
  const { page, ctx } = await openApp(browser, srv.url, PHONE);
  ok((await state(page)).noticeOpen, "(contexto nuevo) el aviso se abre otra vez");
  await page.click("#mobile-close");
  const s = await state(page);
  ok(!s.noticeOpen && !s.navHiddenClass, "«Cerrar» deja el panel de navegación");
  ok(s.navWidth <= s.vw - 20 && s.toggle.right <= s.vw, "ocupando la pantalla, con su flecha a la vista");
  ok(await page.evaluate(() => dbLoadMobileView()) === "nav", "se guarda «nav»");
  await page.reload();
  await page.waitForFunction(() => typeof map === "object" && map && document.querySelector("#tree .empty, #tree ul.node-list"));
  const r = await state(page);
  ok(!r.noticeOpen && !r.navHiddenClass && r.phoneLayout, "al recargar no vuelve a preguntar y el panel sigue ahí");
  await ctx.close();
}

/* ---------- Escape es «Cerrar», no «Continuar» ---------- */
{
  const { page, ctx } = await openApp(browser, srv.url, PHONE);
  ok((await state(page)).noticeOpen, "(Escape) el aviso se abre");
  await page.keyboard.press("Escape");
  const s = await state(page);
  ok(!s.noticeOpen && !s.navHiddenClass, "Escape cierra el aviso SIN ocultar el panel (no compromete)");
  ok(await page.evaluate(() => dbLoadMobileView()) === "nav", "y cuenta como «Cerrar»");
  await ctx.close();
}

/* ---------- Un teléfono en horizontal también ---------- */
{
  const { page, ctx } = await openApp(browser, srv.url, PHONE_LANDSCAPE);
  const s = await state(page);
  ok(s.noticeOpen && s.phoneLayout, `en horizontal (${s.vw} px de ancho, 390 de alto) también recibe el aviso`);
  await ctx.close();
}

/* ---------- Quien NO lo recibe ---------- */
for (const [label, opts] of [["una tableta (820 × 1180, táctil)", TABLET],
  ["una ventana de escritorio estrecha (390 px, con ratón)", NARROW_DESKTOP],
  ["un escritorio normal", DESKTOP]]) {
  const { page, ctx } = await openApp(browser, srv.url, opts);
  const s = await state(page);
  ok(!s.noticeOpen && !s.phoneLayout, `${label}: ni aviso ni diseño de móvil`);
  ok(!s.navHiddenClass && s.navDisplay !== "none", `${label}: el panel de navegación se queda como siempre`);
  ok(await page.evaluate(() => dbLoadMobileView()) === null, `${label}: no se guarda nada`);
  if (opts === DESKTOP) ok(Math.round(s.navWidth) === 400, "el panel mide sus 400 px de siempre: " + s.navWidth);
  await ctx.close();
}

await browser.close();
srv.close();
done();
