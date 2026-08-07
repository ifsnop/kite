const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const fs = require("fs");
const html = fs.readFileSync(HTML_PATH, "utf8");
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const src = script.slice(script.indexOf("const fmtBytes ="),
                         script.indexOf("/* Procesa archivos soltados"));
const { fmtBytes } = new Function(src + "\nreturn {fmtBytes};")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* the four tiers used by the "Almacenamiento usado" row */
ok(fmtBytes(0) === "0 bytes", "zero: " + fmtBytes(0));
ok(fmtBytes(512) === "512 bytes", "plain bytes: " + fmtBytes(512));
ok(fmtBytes(1023) === "1023 bytes", "just under the KB boundary: " + fmtBytes(1023));
ok(fmtBytes(1024) === "1.0 KB", "exactly 1 KB: " + fmtBytes(1024));
ok(fmtBytes(1536) === "1.5 KB", "KB with a fraction: " + fmtBytes(1536));
ok(fmtBytes(1024 * 1024 - 1) === "1024.0 KB", "just under the MB boundary: " + fmtBytes(1024 * 1024 - 1));
ok(fmtBytes(1024 * 1024) === "1.0 MB", "exactly 1 MB: " + fmtBytes(1024 * 1024));
ok(fmtBytes(1024 * 1024 * 1024) === "1.0 GB", "exactly 1 GB: " + fmtBytes(1024 * 1024 * 1024));
ok(fmtBytes(2.5 * 1024 * 1024 * 1024) === "2.5 GB", "GB with a fraction: " + fmtBytes(2.5 * 1024 * 1024 * 1024));
if (!process.exitCode) console.log("BYTE FORMAT TESTS OK");
