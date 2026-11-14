/* The «Novedades» window (68-whats-new.js), end to end.

   Every other suite keeps it closed (stubTiles sets `__kiteSkipWhatsNew`);
   this one asks for it. What is tested: it opens on its own at startup,
   once the tree is resolved, with the releases since 2.0 newest first and
   never the unreleased "next"; «Cerrar», the × and Escape close it; closing
   without the box brings it back at the next start; with the box ticked it
   stays closed until a new version, which shows it again listing only what
   came after the version last run; and on a phone it waits for the «Mejor
   desde un ordenador» notice instead of stacking on it. Expectations are
   computed from the page's own VERSION and WHATS_NEW, so a release does not
   need this suite to be touched.                                        */
import { launch, serve, stubTiles, waitAppReady, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER WHATS NEW TESTS OK");

const srv = await serve(READABLE, 8985);
const browser = await launch();

async function open(opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", locale: "es-ES", reducedMotion: "reduce", ...opts });
  await stubTiles(ctx, { whatsNew: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", e => window.__csp.push(e.violatedDirective));
  });
  await page.goto(srv.url);
  await waitAppReady(page);
  return { ctx, page, errors };
}
const shown = page => page.evaluate(() => {
  const d = document.getElementById("whats-new");
  return { open: !d.hidden, title: d.querySelector(".dlg-title").textContent,
    intro: (d.querySelector("#whats-new-body > p") || {}).textContent || "",
    heads: [...d.querySelectorAll("#whats-new-body h3")].map(h => h.textContent),
    items: [...d.querySelectorAll("#whats-new-body li")].map(li => li.textContent),
    focusInside: d.contains(document.activeElement) };
});
const waitShown = async (page, want = true) => {
  for (let i = 0; i < 60; i++) { if ((await shown(page)).open === want) return true; await page.waitForTimeout(50); }
  return false;
};
const record = page => page.evaluate(() => dbLoadWhatsNew());
const putRecord = (page, rec) => page.evaluate(rec => dbSaveWhatsNew(rec), rec);

/* ---------- 1. The first time: on its own, everything since 2.0 ---------- */
const { ctx, page, errors } = await open();
ok(await waitShown(page), "se abre sola al arrancar");
let s = await shown(page);
const expected = await page.evaluate(() => ({ version: VERSION,
  heads: whatsNewEntries(WHATS_NEW, WHATS_NEW_FIRST, VERSION).map(e => tr("Versión {version}", { version: e.version })),
  next: (WHATS_NEW.find(e => e.version === "next") || { items: [] }).items.map(i => tr(i)) }));
ok(s.title === "Novedades" && /desde la versión 2\.0\.0/.test(s.intro), "titulada «Novedades», desde la 2.0: " + s.intro);
ok(s.heads.length > 0 && s.heads.join("|") === expected.heads.join("|"),
  "una sección por versión publicada, de la más nueva a la más vieja: " + s.heads.join(", "));
ok(s.heads[0] === `Versión ${expected.version}`, "la primera es la que está abierta: " + s.heads[0]);
ok(!s.items.some(i => expected.next.includes(i)), "lo de «next» (aún sin publicar) no sale");
ok(s.focusInside, "el foco está en la ventana");
ok(await page.evaluate(() => !document.getElementById("whats-new-dismiss").checked), "la casilla empieza sin marcar");
let r = await record(page);
ok(r && r.shownFor === expected.version && r.since === "2.0.0" && r.dismissed === false,
  "se apunta para qué versión se enseñó y desde cuál lista: " + JSON.stringify(r));

/* ---------- 2. Closing without the box: it comes back ---------- */
await page.click("#whats-new-close");
ok(!(await shown(page)).open, "«Cerrar» la cierra");
await page.reload(); await waitAppReady(page);
ok(await waitShown(page), "sin marcar la casilla, vuelve a salir al recargar");
s = await shown(page);
ok(/2\.0\.0/.test(s.intro) && s.heads.join("|") === expected.heads.join("|"), "con la misma lista");
await page.click("#whats-new .dlg-close");
ok(!(await shown(page)).open, "la × la cierra");
await page.reload(); await waitAppReady(page);
ok(await waitShown(page), "y sigue volviendo");
await page.keyboard.press("Escape");
ok(!(await shown(page)).open, "Escape también la cierra");

/* ---------- 3. The box: closed until a new version ---------- */
await page.reload(); await waitAppReady(page);
await waitShown(page);
await page.check("#whats-new-dismiss");
await page.click("#whats-new-close");
await page.waitForTimeout(200);
r = await record(page);
ok(r && r.dismissed === true && r.shownFor === expected.version, "marcada la casilla, se guarda hasta esta versión: " + JSON.stringify(r));
await page.reload(); await waitAppReady(page);
await page.waitForTimeout(600);
ok(!(await shown(page)).open, "y al recargar ya no sale");

/* ---------- 4. A new version shows it again, with only what came after ---------- */
const older = await page.evaluate(() => whatsNewEntries(WHATS_NEW, WHATS_NEW_FIRST, VERSION).map(e => e.version)[1]);
ok(!!older, "hay una versión anterior con la que simular el salto");
await putRecord(page, { shownFor: older, since: "2.0.0", dismissed: true });
await page.reload(); await waitAppReady(page);
ok(await waitShown(page), "con una versión nueva vuelve a salir aunque se marcara la casilla");
s = await shown(page);
const after = await page.evaluate(older => whatsNewEntries(WHATS_NEW, older, VERSION).map(e => tr("Versión {version}", { version: e.version })), older);
ok(s.intro.includes(older) && s.heads.join("|") === after.join("|"),
  `y lista solo lo posterior a la ${older}: ${s.heads.join(", ")}`);
r = await record(page);
ok(r && r.shownFor === expected.version && r.since === older && r.dismissed === false, "y lo apunta: " + JSON.stringify(r));
await page.click("#whats-new-close");

/* ---------- 5. A tampered record counts as nothing saved ---------- */
await putRecord(page, { shownFor: "<img src=x>", since: 3, dismissed: "sí" });
await page.reload(); await waitAppReady(page);
ok(await waitShown(page), "un registro manipulado se ignora y se enseña como la primera vez");
ok(/2\.0\.0/.test((await shown(page)).intro), "desde la 2.0");
ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));
ok((await page.evaluate(() => window.__csp)).length === 0, "sin violaciones de CSP");
await ctx.close();

/* ---------- 6. On a phone it waits for the «Mejor desde un ordenador» notice ---------- */
const phone = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
await phone.page.waitForTimeout(600);
const both = await phone.page.evaluate(() => ({ mobile: !document.getElementById("mobile-notice").hidden,
  whatsNew: !document.getElementById("whats-new").hidden }));
ok(both.mobile && !both.whatsNew, "en un móvil sale primero el aviso, sin las novedades encima: " + JSON.stringify(both));
await phone.page.click("#mobile-close");
ok(await waitShown(phone.page), "y las novedades salen al cerrarlo");
ok(phone.errors.length === 0, "sin errores de página en el móvil: " + JSON.stringify(phone.errors));
await phone.ctx.close();

await browser.close();
srv.close();
done();
