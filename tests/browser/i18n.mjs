/* Idioma de la interfaz: español e inglés, «Automático» según el navegador,
   el ajuste de Propiedades → Preferencias → Idioma (que se guarda al
   Aceptar y vale al recargar), y que en inglés no se cuele español en
   ningún texto: ni en el HTML estático ni en lo que pinta el código.

   El idioma no vive en IndexedDB como el resto de ajustes sino en
   localStorage, porque hace falta de forma SÍNCRONA antes de que arranque
   nada (los controles del visor se crean al cargar el script).            */
import { launch, serve, openApp, reporter, READABLE, MINIFIED } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER I18N TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8911);
const srvMin = await serve(MINIFIED, 8912);

/* Lo que el navegador dice que habla es lo que decide «Automático» */
const open = (url, locale, opts = {}) => openApp(browser, url, { locale, ...opts });
const snap = page => page.evaluate(() => ({
  lang: document.documentElement.lang,
  uiLang,
  pref: loadUiLangPref(),
  search: document.getElementById("search-box").placeholder,
  newFolder: document.getElementById("new-folder-btn") ? document.getElementById("new-folder-btn").title : null,
  fit: [...document.querySelectorAll(".measure-bar a")].map(a => a.title).join(" | "),
  accept: document.getElementById("props-accept").textContent,
  h2: document.querySelector("#props-dialog h2").textContent,
  tab: document.getElementById("props-tab-btn-prefs").textContent,
  mixed: getComputedStyle(document.documentElement).getPropertyValue("--txt-mixed")
}));

/* ---------- Automático: el navegador en español ---------- */
{
  const { ctx, page, errors } = await open(srv.url, "es-ES");
  const s = await snap(page);
  ok(s.lang === "es" && s.uiLang === "es", "navegador es-ES → español: " + s.uiLang);
  ok(s.search === "Buscar capas y carpetas…" && s.accept === "Aceptar" && s.tab === "Preferencias", "el texto sigue siendo el de siempre: " + JSON.stringify(s));
  ok(s.pref === "auto", "sin nada guardado la preferencia es «Automático»");
  ok(!errors.length, "sin errores: " + errors.join(" | "));
  await ctx.close();
}

/* ---------- Automático: cualquier otro idioma → inglés ---------- */
for (const locale of ["en-US", "fr-FR", "de-DE"]) {
  const { ctx, page } = await open(srv.url, locale);
  const s = await snap(page);
  ok(s.lang === "en" && s.uiLang === "en", `navegador ${locale} → inglés: ${s.uiLang}`);
  ok(s.search === "Search layers and folders…", `${locale}: el HTML estático (atributo placeholder) está en inglés: ${s.search}`);
  ok(s.accept === "OK" && s.h2 === "Properties" && s.tab === "Preferences", `${locale}: texto y títulos del HTML en inglés: ${s.accept} / ${s.h2} / ${s.tab}`);
  ok(/Auto-fit/.test(s.fit), `${locale}: lo que crea el código al cargar (controles del visor) también: ${s.fit}`);
  ok(s.mixed.includes("(various)"), `${locale}: el texto que pinta el CSS: ${s.mixed}`);
  await ctx.close();
}

/* ---------- Un bloque de HTML con marcado en medio (data-i18n-html) ---------- */
{
  const { ctx, page } = await open(srv.url, "en-US");
  const html = await page.evaluate(() => document.querySelector('[data-i18n-html="html.points-help"]').innerHTML);
  ok(/One point per line, with <strong>latitude, longitude and altitude<\/strong>/.test(html), "un párrafo con <strong> se traduce entero: " + html.slice(0, 90));
  await ctx.close();
}

/* ---------- En inglés no se cuela español ---------- */
for (const [name, url] of [["legible", srv.url], ["minificado", srvMin.url]]) {
  const { ctx, page, errors } = await open(url, "en-US");
  /* Abrir lo que se pinta con código (diálogos, menús, pestañas) para que haya algo que mirar */
  await page.evaluate(() => {
    document.getElementById("gnp-editor-btn").click();
  });
  await page.waitForFunction(() => !document.getElementById("props-dialog").hidden);
  const leaks = await page.evaluate(() => {
    const en = I18N_DICT.en, out = [];
    walkI18nDom(document.body, (key, apply, isHtml) => {
      if (isHtml) return;
      /* una clave en español cuya traducción es otra cosa: se está viendo el español */
      const v = en[key];
      if (typeof v === "string" && v && v !== key) out.push(key);
    });
    return out;
  });
  ok(!leaks.length, `${name}: ${leaks.length} texto(s) en español en la interfaz en inglés: ${leaks.slice(0, 5).join(" | ")}`);
  ok(!errors.length, `${name}: sin errores en inglés: ${errors.join(" | ")}`);
  await ctx.close();
}

/* ---------- El ajuste: se guarda al Aceptar y vale al recargar ---------- */
{
  const { ctx, page } = await open(srv.url, "en-US");
  await page.evaluate(() => document.getElementById("gnp-editor-btn").click());
  await page.waitForFunction(() => !document.getElementById("props-dialog").hidden);
  const opts = await page.evaluate(() => [...document.getElementById("props-lang").options].map(o => `${o.value}:${o.textContent}`));
  ok(opts.join(",") === "auto:Automatic,es:Español,en:English", "el selector ofrece Automático y cada idioma registrado, con su nombre: " + opts.join(","));
  ok(await page.evaluate(() => document.getElementById("props-lang").value) === "auto", "parte en «Automático»");

  /* Cancelar no guarda nada */
  await page.selectOption("#props-lang", "es");
  await page.click("#props-cancel");
  ok(await page.evaluate(() => loadUiLangPref()) === "auto", "Cancelar no guarda el idioma");

  /* Aceptar sí, y avisa de que vale al recargar */
  await page.evaluate(() => document.getElementById("gnp-editor-btn").click());
  await page.waitForFunction(() => !document.getElementById("props-dialog").hidden);
  await page.selectOption("#props-lang", "es");
  await page.click("#props-accept");
  ok(await page.evaluate(() => loadUiLangPref()) === "es", "Aceptar guarda el idioma");
  const msg = await page.evaluate(() => document.getElementById("nav-msg").textContent);
  ok(/language will change when the page is reloaded/.test(msg), "avisa de que cambia al recargar, en el idioma de ahora: " + msg);
  ok(await page.evaluate(() => uiLang) === "en", "la interfaz no cambia hasta recargar");

  await page.reload();
  await page.waitForFunction(() => typeof map === "object" && !!document.getElementById("tree"));
  let s = await snap(page);
  ok(s.uiLang === "es" && s.lang === "es" && s.accept === "Aceptar", "tras recargar, español aunque el navegador sea en-US: " + JSON.stringify(s));
  ok(s.pref === "es", "la preferencia sigue guardada");

  /* Y volver a «Automático» la borra */
  await page.evaluate(() => document.getElementById("gnp-editor-btn").click());
  await page.waitForFunction(() => !document.getElementById("props-dialog").hidden);
  ok(await page.evaluate(() => document.getElementById("props-lang").value) === "es", "el selector enseña lo guardado");
  await page.selectOption("#props-lang", "auto");
  await page.click("#props-accept");
  ok(await page.evaluate(() => localStorage.getItem("kite.uiLang")) === null, "«Automático» borra la clave");
  await page.reload();
  await page.waitForFunction(() => typeof map === "object" && !!document.getElementById("tree"));
  s = await snap(page);
  ok(s.uiLang === "en", "con «Automático» vuelve a mandar el navegador: " + s.uiLang);

  /* Forzar inglés en un navegador en español */
  await page.evaluate(() => localStorage.setItem("kite.uiLang", "en"));
  await ctx.close();
}
{
  const { ctx, page } = await open(srv.url, "es-ES", {});
  await page.evaluate(() => localStorage.setItem("kite.uiLang", "en"));
  await page.reload();
  await page.waitForFunction(() => typeof map === "object" && !!document.getElementById("tree"));
  const s = await snap(page);
  ok(s.uiLang === "en" && s.accept === "OK", "inglés forzado en un navegador en español: " + s.uiLang);
  /* Una preferencia que no es un idioma registrado se ignora */
  await page.evaluate(() => localStorage.setItem("kite.uiLang", "klingon"));
  await page.reload();
  await page.waitForFunction(() => typeof map === "object" && !!document.getElementById("tree"));
  ok(await page.evaluate(() => uiLang) === "es", "una preferencia desconocida se ignora y manda el navegador");
  await ctx.close();
}

/* ---------- Sin almacenamiento disponible: arranca igual ---------- */
{
  const { ctx, page } = await open(srv.url, "en-US", {});
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
  });
  await page.reload();
  await page.waitForFunction(() => typeof map === "object" && !!document.getElementById("tree"));
  ok(await page.evaluate(() => uiLang) === "en", "sin localStorage cae a «Automático» y arranca");
  await ctx.close();
}

/* ---------- Lo que se oye: un tercer idioma entra sin tocar código ---------- */
{
  const { ctx, page } = await open(srv.url, "fr-FR");
  const r = await page.evaluate(() => {
    registerLang("fr", "Français", { "Cancelar": "Annuler", "Aceptar": "" });
    const before = resolveUiLang("auto", ["fr-FR"]);
    setUiLang("fr");
    return { before, cancel: tr("Cancelar"), accept: tr("Aceptar"), open: tr("Abrir"), lang: document.documentElement.lang, name: UI_LANGS.fr };
  });
  ok(r.before === "fr" && r.lang === "fr" && r.name === "Français", "registerLang basta para que «Automático» lo encuentre: " + JSON.stringify(r));
  ok(r.cancel === "Annuler", "su traducción");
  ok(r.accept === "OK", "lo que le falta cae a inglés antes que a español: " + r.accept);
  ok(r.open === "Abrir", "y sin nada en ningún idioma, el español");
  await ctx.close();
}

await browser.close();
srv.close();
srvMin.close();
done();
