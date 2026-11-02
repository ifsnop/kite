/* ================= Librerías que se cargan bajo demanda =================
   html2canvas (exportar PNG), geotiff.js (fuentes de elevación sin rejilla
   ASCII, ortofotos COG) y proj4js (el .prj de un shapefile, ortofotos COG)
   solo hacen falta en esas funciones, pero estaban como <script> de
   bloqueo en src/index.html: 646 KB sin comprimir (unos 194 KB por la
   red) descargados y ejecutados ANTES de poder arrancar la aplicación,
   la use quien la use para eso o no.

   Medido (Chromium headless, carga en frío, mediana de 5): DOMContentLoaded
   de 299 ms a 202 ms (−32 %) sin ellas; el primer pintado no cambia.

   JSZip (KMZ), topojson-client y shapefile siguen en el HTML: los KMZ y
   los shapefile son el uso corriente, y las dos últimas pesan 7 KB.

   Reglas que no son obvias:
   - **La integridad (SRI) y el origen no cambian**: la misma URL con
     versión fijada y el mismo hash que tenían en el HTML, comprobados
     por el navegador antes de ejecutar (`integrity` + `crossorigin`
     funcionan igual en un <script> insertado por código). La CSP ya
     admite esos dos orígenes (`script-src`). Al subir la versión de
     una librería se cambia AQUÍ, no en el HTML (ver build-and-release.md).
   - **Una sola carga por librería** aunque la pidan dos a la vez
     (`lazyLibPromises`), y un FALLO se olvida (sin red, bloqueo del
     SRI): el siguiente intento vuelve a probar, en vez de quedarse con
     un error pegado hasta recargar la página.
   - **Quien la use va por `ensureLib`, nunca por el global suelto**: el
     global solo existe tras la primera carga.                          */
const LAZY_LIBS = {
  html2canvas: {
    url: "https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js",
    integrity: "sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H",
    global: "html2canvas",
    what: N_("exportar PNG")
  },
  /* El bundle de navegador, ya minificado y en un solo archivo (sin
     trozos cargados aparte que el SRI no cubriría).                    */
  geotiff: {
    url: "https://unpkg.com/geotiff@2.1.3/dist-browser/geotiff.js",
    integrity: "sha384-m5adk5PRgt3JjiYbYoG8oXxc3EgRFKc1aCBgKzyxqxnbYpdiAMlHkR0gVDp03Q/H",
    global: "GeoTIFF",
    what: N_("GeoTIFF")
  },
  /* Un solo archivo, con el lector de WKT dentro.                      */
  proj4: {
    url: "https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.22.0/proj4.js",
    integrity: "sha384-RCBbAm8IhfOOoFV7vqUhspSb+BCSvVSd84WJpv5VMq4rNiXJ88VMHtndxQntlbnd",
    global: "proj4",
    what: N_("proyecciones")
  }
};
const lazyLibPromises = new Map();

/* Carga la librería si hace falta y devuelve su global. Rechaza con
   «no se pudo cargar el soporte de …», el mismo texto que los avisos
   de antes, para que el usuario vea lo mismo.                         */
function ensureLib(name) {
  const lib = LAZY_LIBS[name];
  if (!lib) return Promise.reject(new Error(tr("librería desconocida: {name}", { name })));
  if (window[lib.global] !== undefined) return Promise.resolve(window[lib.global]);
  let p = lazyLibPromises.get(name);
  if (p) return p;
  p = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = lib.url;
    s.integrity = lib.integrity;
    s.crossOrigin = "anonymous";
    s.referrerPolicy = "no-referrer";
    s.onload = () => {
      if (window[lib.global] !== undefined) resolve(window[lib.global]);
      else { s.remove(); reject(new Error(tr("no se pudo cargar el soporte de {what}", { what: tr(lib.what) }))); }
    };
    s.onerror = () => { s.remove(); reject(new Error(tr("no se pudo cargar el soporte de {what}", { what: tr(lib.what) }))); };
    document.head.appendChild(s);
  });
  lazyLibPromises.set(name, p);
  /* Un fallo no se queda: el próximo intento vuelve a probar */
  p.catch(() => lazyLibPromises.delete(name));
  return p;
}
