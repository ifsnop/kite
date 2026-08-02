const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const { parseHTML } = require("linkedom");
const fs = require("fs");
const script = fs.readFileSync(HTML_PATH,"utf8").match(/<script>\n([\s\S]*?)<\/script>/)[1];
function fn(name){ const i=script.indexOf(`function ${name}(`); let d=0;
  for(let k=script.indexOf("{",i);k<script.length;k++){ if(script[k]==="{")d++; else if(script[k]==="}"&&--d===0) return script.slice(i,k+1);} }
const ok=(c,m)=>{ if(!c){ console.error("FAIL: "+m); process.exitCode=1; } };

/* ---- saneado del HTML de las fichas ---- */
/* linkedom no construye el <body> implícito que sí crea el navegador al
   analizar como "text/html"; se envuelve para reproducirlo             */
class DOMParser {
  parseFromString(html) { return parseHTML(`<html><head></head><body>${html}</body></html>`).document; }
}
const tags = script.slice(script.indexOf("const DESC_TAGS"), script.indexOf("function sanitizeHtml"));
const sanitize = new Function("DOMParser", tags + fn("sanitizeHtml") + "\nreturn sanitizeHtml;")(DOMParser);

let out = sanitize('<table><tr><td>FIR</td><td>LECM</td></tr></table>');
ok(/<table>/.test(out) && /LECM/.test(out), "una tabla legítima se conserva: " + out);
out = sanitize('<p onclick="alert(1)">hola</p>');
ok(!/onclick/i.test(out) && /hola/.test(out), "los manejadores se eliminan: " + out);
out = sanitize('<script>alert(1)<\/script><b>ok</b>');
ok(!/alert/.test(out) && /<b>ok<\/b>/.test(out), "el script desaparece y el resto queda: " + out);
out = sanitize('<a href="javascript:alert(1)">x</a>');
ok(!/javascript/i.test(out), "las URL javascript: se quitan: " + out);
out = sanitize('<a href="https://ign.es">IGN</a>');
ok(/https:\/\/ign\.es/.test(out) && /noopener/.test(out), "los enlaces http(s) se conservan y se aíslan: " + out);
out = sanitize('<iframe src="https://x"></iframe><i>t</i>');
ok(!/iframe/i.test(out) && /<i>t<\/i>/.test(out), "los marcos se eliminan: " + out);
out = sanitize('<img src="https://x/a.png" onerror="alert(1)">');
ok(/src="https/.test(out) && !/onerror/i.test(out), "imagen sí, onerror no: " + out);
out = sanitize('<style>b{}</style><form><input></form><p>dato</p>');
ok(!/b\{\}/.test(out) && !/input/i.test(out) && /dato/.test(out),
   "estilos y formularios se tiran enteros, el dato queda: " + out);
out = sanitize('<marquee>texto</marquee>');
ok(/texto/.test(out) && !/marquee/i.test(out), "un elemento desconocido pierde la etiqueta pero conserva el texto");
out = sanitize('<div style="x"><span>a</span></div>');
ok(/<span>a<\/span>/.test(out) && !/style=/.test(out), "atributos no permitidos fuera: " + out);

/* ---- Ctrl+A en dos pasos ---- */
function selectAllStep(sibs, all, selection) {
  const already = sibs.length && sibs.every(n => selection.has(n));
  return already ? all : sibs;
}
const sibs=["a","b"], all=["a","b","c","d"];
ok(selectAllStep(sibs, all, new Set()).length === 2, "primera pulsación: la carpeta");
ok(selectAllStep(sibs, all, new Set(sibs)).length === 4, "segunda pulsación: todo el árbol");
ok(selectAllStep(sibs, all, new Set(["a"])).length === 2, "con la carpeta a medias, vuelve a la carpeta");

/* ---- escritura anticipada: acumular frente a repetir ---- */
function buffer(prev, ch, dt, ms=900) {
  const b = (dt > ms) ? ch : prev + ch;
  const repeat = b.length > 1 && [...b].every(c => c === b[0]);
  return { b, target: repeat ? b[0] : b };
}
ok(buffer("", "c", 9999).target === "c", "primera letra");
ok(buffer("c", "a", 100).target === "ca", "letras seguidas acumulan");
ok(buffer("c", "c", 100).target === "c", "la misma letra repetida recorre coincidencias");
ok(buffer("ca", "s", 5000).target === "s", "tras una pausa empieza de nuevo");

/* ---- franja de arrastre ---- */
const zone = (h, y, isFolder) => (isFolder && y > h*0.18 && y < h*0.82) ? "into" : (y < h/2 ? "before" : "after");
ok(zone(24, 12, true) === "into", "el centro de una carpeta mete dentro");
ok(zone(24, 6, true) === "into", "y ahora también a un cuarto de altura (antes no)");
ok(zone(24, 2, true) === "before", "el borde superior sigue reordenando");
ok(zone(24, 23, true) === "after", "y el inferior también");
ok(zone(24, 12, false) === "after", "sobre una capa nunca se mete dentro");
if (!process.exitCode) console.log("NEW FEATURES OK");
