const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const fs = require("fs");
const html = fs.readFileSync(HTML_PATH, "utf8");
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const src = script.slice(script.indexOf("function pngTimestamp"),
                         script.indexOf("/* Exporta el contenido del visor"));
const { pngTimestamp } = new Function(src + "\nreturn {pngTimestamp};")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* Fixed instants, zero-padded across every field: month, day, hour,
   minute and second all need padding at their low end.                */
ok(pngTimestamp(new Date(2026, 0, 5, 3, 7, 9)) === "20260105-030709",
  "single-digit month/day/hour/min/sec all zero-padded: " + pngTimestamp(new Date(2026, 0, 5, 3, 7, 9)));
ok(pngTimestamp(new Date(2026, 11, 31, 23, 59, 59)) === "20261231-235959",
  "end of year, 24h clock, no padding needed: " + pngTimestamp(new Date(2026, 11, 31, 23, 59, 59)));
ok(pngTimestamp(new Date(2000, 0, 1, 0, 0, 0)) === "20000101-000000",
  "midnight rolls to 00, not 24: " + pngTimestamp(new Date(2000, 0, 1, 0, 0, 0)));
ok(/^\d{8}-\d{6}$/.test(pngTimestamp()), "default (no argument) uses the current time and the same shape");
if (!process.exitCode) console.log("PNG FILENAME TESTS OK");
