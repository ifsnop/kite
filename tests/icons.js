/* Iconos MDI empotrados: el catálogo y la tabla de cuerpos no pueden
   desincronizarse, y las dos formas de usar un icono deben salir bien.

   Antes los SVG se pedían a la API de Iconify en ejecución: abrir el
   selector costaba 79 peticiones simultáneas y aplicar un icono a un
   marcador otra más (con una URL distinta, así que ni compartían caché
   de HTTP). Pasado el límite del servicio, la respuesta era un
   `429 text/plain` que el `<img>` mostraba como cuadro en blanco SIN
   ningún aviso y el `fetch` como "Failed to fetch", durante los minutos
   que dijera su `retry-after`. Ahora van dentro del archivo.

   El fallo que queda posible es humano: añadir un nombre a MDI_ICONS y
   olvidar `npm run icons`. Eso es lo primero que se comprueba aquí, y
   sin tocar la red — el CI no puede depender de que Iconify esté en
   pie, que es justo lo que este cambio elimina.                      */
const { fn, constDecl, between, script } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* La tabla acaba en un marcador explícito, no en una línea en blanco:
   05-mdi-icons.js se concatena pegado al archivo siguiente, así que un
   `between(..., "\n\n")` se tragaba medio 10-map.js.                 */
const src = constDecl("LEAFLET_PIN") + "\n"
  + between("const MDI_VIEWBOX", "/* fin de MDI_ICON_BODIES */") + "\n"
  + between("const MDI_ICONS", "\n\n/* Un nombre que la tabla") + "\n"
  + fn("mdiSvg") + "\n" + constDecl("knownIcon");
const api = new Function("LEAFLET_PIN_URL",
  src + "\nreturn {MDI_ICONS, MDI_ICON_BODIES, MDI_VIEWBOX, mdiSvg, knownIcon, LEAFLET_PIN};")("pin.png");

const names = api.MDI_ICONS.flatMap(([, ns]) => ns).filter(n => n !== api.LEAFLET_PIN);

/* ---------- Catálogo y tabla, sincronizados en los dos sentidos ---------- */
const sinCuerpo = names.filter(n => !api.MDI_ICON_BODIES[n]);
ok(sinCuerpo.length === 0,
  "todo icono del catálogo tiene cuerpo empotrado (¿falta `npm run icons`?): " + sinCuerpo.join(", "));
const sobran = Object.keys(api.MDI_ICON_BODIES).filter(n => !names.includes(n));
ok(sobran.length === 0,
  "y la tabla no arrastra cuerpos que ya no ofrece el catálogo: " + sobran.join(", "));
ok(names.length > 0 && names.length === Object.keys(api.MDI_ICON_BODIES).length,
  `mismo número a los dos lados: ${names.length} vs ${Object.keys(api.MDI_ICON_BODIES).length}`);

/* La gota de Leaflet NO está en la tabla: es un PNG de la distribución
   de Leaflet, no un SVG de MDI, y no es coloreable.                  */
ok(!api.MDI_ICON_BODIES[api.LEAFLET_PIN], "la gota de Leaflet no es un cuerpo MDI");

/* ---------- Los cuerpos son dibujables ---------- */
for (const n of names) {
  const body = api.MDI_ICON_BODIES[n];
  if (!/^<(path|g|circle|rect|ellipse|polygon|polyline)[\s>]/.test(body)) {
    ok(false, `el cuerpo de «${n}» no empieza por una forma SVG: ${body.slice(0, 40)}`);
    break;
  }
}
const sinColor = names.filter(n => !api.MDI_ICON_BODIES[n].includes("currentColor"));
ok(sinColor.length === 0,
  "todos se dibujan con currentColor, que es lo que permite colorearlos: " + sinColor.join(", "));

/* ---------- mdiSvg: las dos formas de usarlo ---------- */
/* Sin color: el cuerpo se deja tal cual, lo colorea el CSS de .mdi-pin
   (así es como llega al marcador del mapa).                          */
const raw = api.mdiSvg("airplane");
ok(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24">/.test(raw),
  "sin tamaño no se escriben width/height: " + raw.slice(0, 70));
ok(raw.includes("currentColor"), "y currentColor sobrevive para que lo tiña el CSS");
ok(raw.endsWith("</svg>"), "el SVG cierra");

/* Con color: se sustituye, porque una vista previa suelta en un <img>
   no hereda ningún CSS del que sacar currentColor.                   */
const colored = api.mdiSvg("airplane", "#ff0000");
ok(!colored.includes("currentColor"), "con color no queda ningún currentColor sin sustituir");
ok(colored.includes('fill="#ff0000"'), "sino el color pedido: " + colored.slice(0, 90));

/* Con tamaño: hace falta para #icon-preview, que es height:28px con
   width:auto, y `auto` sin proporción intrínseca no sale de ningún sitio */
const sized = api.mdiSvg("airplane", "#ff0000", 24);
ok(sized.includes('width="24" height="24"'), "el tamaño va en el propio SVG: " + sized.slice(0, 80));

/* Un icono que la tabla no conoce: null, no una excepción ni un SVG
   vacío. Es lo que hace que un árbol guardado con otro catálogo caiga
   en la gota de Leaflet en vez de dejar el marcador invisible.       */
ok(api.mdiSvg("no-existe-este-icono") === null, "un nombre desconocido devuelve null");
ok(api.knownIcon("airplane") === true, "knownIcon reconoce uno del catálogo");
ok(api.knownIcon(api.LEAFLET_PIN) === true, "y la gota de Leaflet, que no está en la tabla");
ok(api.knownIcon("no-existe-este-icono") === false, "y descarta lo que no conoce");

/* ---------- Ya no se toca la red por un icono ---------- */
/* La comprobación es sobre el archivo ENTREGADO, no sobre estas
   funciones: lo que importa es que no quede ninguna petición viva.  */
ok(!/api\.iconify\.design/.test(script),
  "el archivo entregado no menciona api.iconify.design en ninguna parte");
ok(!/svgCache|fetchIconSvg/.test(script),
  "y no quedan restos del camino antiguo (svgCache / fetchIconSvg)");

/* El icono del marcador se resuelve SIN promesas: applyMarkerStyle dejó
   de ser async al desaparecer la red, y con ella el contador de
   secuencia que descartaba aplicaciones obsoletas.                   */
const apply = fn("applyMarkerStyle");
ok(!/^async /.test(apply), "applyMarkerStyle ya no es async");
ok(!/await|_mseq/.test(apply), "ni espera nada ni lleva contador de secuencia");

if (!process.exitCode) console.log("EMBEDDED ICONS TESTS OK");
