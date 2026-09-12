/* La aplicación arranca y funciona — en LOS DOS artefactos.

   Las mismas comprobaciones se pasan sobre `kitelocal.html` y sobre
   `kitelocal.min.html`, así que esta suite ES la comprobación de
   paridad que hasta ahora estaba documentada como «manual y
   obligatoria al tocar el minificado». Si terser rompiera algo, aquí se
   ve: el legible pasaría y el minificado no.

   Lo que se prueba es justo lo que Node no puede decir: que el mapa se
   construye, que el panel pasa por «Inicializando…» y concluye, que los
   iconos empotrados se PINTAN (no solo que estén en una tabla), que un
   icono se aplica a un marcador, que una medición escribe su etiqueta y
   su diálogo, que la casilla de una carpeta se pone indeterminada, y
   que la escala y la atribución están donde deben.                    */
import { launch, serve, openApp, reporter, READABLE, MINIFIED } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER APP TESTS OK");
const browser = await launch();

for (const [nombre, archivo, puerto] of [["legible", READABLE, 8821], ["minificado", MINIFIED, 8822]]) {
  const srv = await serve(archivo, puerto);
  const { ctx, page, errors } = await openApp(browser, srv.url);
  const et = m => `[${nombre}] ${m}`;

  const r = await page.evaluate(async () => {
    const out = {};
    const st = li => {
      const c = nodeCheckbox(li);
      return c.indeterminate ? "gris" : (c.checked ? "on" : "off");
    };

    /* --- Arranque: sin capas guardadas concluye que no hay nada --- */
    out.avisoInicial = (document.querySelector("#tree .empty") || {}).textContent || null;

    /* --- Escala y atribución --- */
    out.escala = [...document.querySelectorAll(".leaflet-control-scale div")].map(d => d.textContent);
    const attr = document.querySelector(".leaflet-control-attribution");
    out.version = (attr.textContent.match(/v\d{12}/) || [])[0] || null;
    out.enlaceGitHub = !!attr.querySelector('a[href*="github.com"]');
    /* La escala va ENCIMA de la atribución, en su misma esquina */
    out.escalaEncima = document.querySelector(".leaflet-control-scale")
      .getBoundingClientRect().bottom <= attr.getBoundingClientRect().top;

    /* --- Un pin y un icono MDI empotrado --- */
    createPin();
    const pin = [...document.querySelectorAll("#tree li")].find(x => x._mstyle);
    pin._mstyle = { ...pin._mstyle, icon: "airplane", color: "#c62828", size: 32 };
    applyMarkerStyle(pin);
    const el = nodeCheckbox(pin)._layer.getElement();
    out.iconoAplicado = !!(el && el.querySelector("svg path"));

    /* --- La rejilla del selector: los 80 iconos se PINTAN --- */
    document.getElementById("icon-preview-btn").click();
    const imgs = [...document.querySelectorAll("#icon-grid .icon-opt img")];
    await Promise.all(imgs.map(i => i.complete ? null : new Promise(res => {
      i.addEventListener("load", res, { once: true });
      i.addEventListener("error", res, { once: true });
    })));
    out.iconos = `${imgs.filter(i => i.naturalWidth > 0).length}/${imgs.length}`;
    document.getElementById("icon-cancel").click();
    document.getElementById("style-accept").click();

    /* --- Una medición: etiqueta y diálogo, en la misma unidad --- */
    const m = buildMeasurement("line", L.latLng(40, -3), L.latLng(40, -2));
    finalizeMeasurement(m);
    out.etiquetaMedida = m.label.getContent();
    const mli = [...document.querySelectorAll("#tree li")].find(x => x._measure);
    openStyleDialog(mli);
    out.dlgMedida = document.getElementById("ms-dist").textContent;
    document.getElementById("style-cancel").click();

    /* --- Tercer estado: una carpeta a medias --- */
    const ul = ensureRootUl();
    const f = makeNode({ name: "Carpeta", isFolder: true });
    ul.appendChild(f);
    const hojas = [];
    for (let i = 0; i < 2; i++) {
      const mk = L.marker([41 + i * 0.01, -3]).addTo(rootGroup);
      const li = makeNode({ name: "C" + i, layer: mk, style: { color: "#1b5e97" } });
      nodeUl(f).appendChild(li);
      hojas.push(li);
    }
    refreshAncestorChecks(hojas[0]);
    out.carpetaEntera = st(f);
    const c = nodeCheckbox(hojas[1]);
    c.checked = false;
    c.dispatchEvent(new Event("change", { bubbles: true }));
    out.carpetaAMedias = st(f);
    out.aria = f.getAttribute("aria-checked");

    out.csp = window.__csp;
    return out;
  });

  ok(r.avisoInicial === "No hay capas cargadas.", et("el panel concluye el arranque: " + r.avisoInicial));
  ok(r.escala.length === 2, et("la escala pinta sus dos barras: " + JSON.stringify(r.escala)));
  ok(/^v\d{12}$/.test(r.version || ""), et("la atribución lleva la versión: " + r.version));
  ok(r.enlaceGitHub, et("y el enlace al repositorio"));
  ok(r.escalaEncima, et("con la escala por encima de ella"));
  ok(r.iconoAplicado, et("un icono MDI empotrado llega al marcador"));
  ok(/^(\d+)\/\1$/.test(r.iconos) && r.iconos !== "0/0",
    et("todos los iconos del selector se pintan: " + r.iconos));
  ok(/NM · \d/.test(r.etiquetaMedida), et("la medición se etiqueta en NM: " + r.etiquetaMedida));
  ok(r.dlgMedida.endsWith("NM"), et("y el diálogo dice lo mismo: " + r.dlgMedida));
  ok(r.carpetaEntera === "on", et("carpeta con todo activo: " + r.carpetaEntera));
  ok(r.carpetaAMedias === "gris", et("y a medias queda indeterminada: " + r.carpetaAMedias));
  ok(r.aria === "mixed", et("con aria-checked=mixed: " + r.aria));
  ok(r.csp.length === 0, et("sin violaciones de CSP: " + JSON.stringify(r.csp)));
  ok(errors.length === 0, et("sin errores de página: " + JSON.stringify(errors)));

  await ctx.close();
  srv.close();
}

await browser.close();
done();
