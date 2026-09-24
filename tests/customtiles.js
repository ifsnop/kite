/* "Custom Maps": servidor de teselas del propio usuario, sin catálogo
   ni nombre de capa que elegir — solo una URL base a la que el código
   añade siempre {z}/{x}/{y}.png. Aquí se prueban las tres funciones
   puras: validación (solo https, forma de URL válida), normalización
   (sin barra final) y la plantilla final que consume L.tileLayer.     */
const { fn } = require("./_extract");
/* `customTilesUrl` es un `let` de módulo, no una `const`: cada llamada
   a api() lo declara ella misma (ver más abajo), en vez de extraerlo. */
const src = [fn("normalizeCustomTilesBase"), fn("validCustomTilesUrl"), fn("buildCustomTilesUrl")].join("\n");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* ---------- Validación: solo https, forma de URL reconocible ---------- */
const api = (custom) => new Function(
  `let customTilesUrl = ${JSON.stringify(custom)};\n` + src
  + "\nreturn {normalizeCustomTilesBase, validCustomTilesUrl, buildCustomTilesUrl};")();

ok(api(null).validCustomTilesUrl("https://mi-cache.example.com/tiles/"),
  "una URL https válida se acepta");
ok(api(null).validCustomTilesUrl("  https://mi-cache.example.com/tiles  "),
  "se toleran espacios alrededor, como el instance ID de Copernicus");
ok(!api(null).validCustomTilesUrl("http://mi-cache.example.com/tiles/"),
  "http NO vale — mismo criterio que connect-src, nunca http:");
ok(!api(null).validCustomTilesUrl("no es una url"), "texto suelto no vale");
ok(!api(null).validCustomTilesUrl(""), "vacío no vale");
ok(!api(null).validCustomTilesUrl("ftp://mi-cache.example.com/tiles/"),
  "otro esquema (ftp) tampoco vale, solo https");

/* ---------- Normalización: sin barra final, para no duplicarla ---------- */
ok(api(null).normalizeCustomTilesBase("https://x.example.com/tiles/") === "https://x.example.com/tiles",
  "una barra final se quita");
ok(api(null).normalizeCustomTilesBase("https://x.example.com/tiles///") === "https://x.example.com/tiles",
  "varias barras finales seguidas también");
ok(api(null).normalizeCustomTilesBase("https://x.example.com/tiles") === "https://x.example.com/tiles",
  "sin barra final no cambia nada");
ok(api(null).normalizeCustomTilesBase("  https://x.example.com/tiles/  ") === "https://x.example.com/tiles",
  "espacios alrededor se recortan igual que la barra");

/* ---------- Plantilla final: SIEMPRE termina en {z}/{x}/{y}.png ---------- */
ok(api("https://x.example.com/tiles").buildCustomTilesUrl()
  === "https://x.example.com/tiles/{z}/{x}/{y}.png",
  "una barra, ni una más, entre la base y el patrón XYZ");
ok(api(null).buildCustomTilesUrl() === "/{z}/{x}/{y}.png",
  "sin URL configurada no lanza excepción (blocked() es quien evita construir la capa)");

if (!process.exitCode) console.log("CUSTOM MAPS TESTS OK");
