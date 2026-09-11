/* Copiar y pegar entre instancias de KITE, incluso de dominios
   distintos, por el portapapeles DEL SISTEMA.

   Lo que se copia es el mismo envoltorio `.kite.json` con el que se
   guarda una carpeta en un archivo: así pegar cuesta lo mismo que
   importar ese archivo y las comprobaciones de versión ya escritas
   valen igual. El portapapeles del sistema es del USUARIO, no del
   origen, así que no hace falta CORS ni que las dos instancias se
   conozcan.

   Copiar y pegar NO son simétricos, y esto se comprobó contra el
   navegador antes de elegirlo: `navigator.clipboard.writeText` funciona
   porque Ctrl+C trae activación transitoria del usuario, pero
   `readText()` está tras un permiso que hay que conceder —una prueba se
   quedó colgada dos minutos esperándolo— y que Firefox ni siquiera
   ofrece a la página. Por eso pegar va por el evento `paste`, que
   entrega el contenido sin pedir nada.                               */
const { fn, script, constDecl } = require("./_extract");
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* ---------- El envoltorio es el MISMO que el de exportar ---------- */
const envelope = new Function("EXPORT_KIND", "EXPORT_FORMAT", "DB_VERSION", "TREE_SCHEMA", "BUILD",
  fn("treeExportDoc") + "\nreturn treeExportDoc;")("kite-local/tree", 1, 3, 6, "202609120000");
const doc = envelope([{ name: "Ruta", t: "folder", checked: true, children: [] }]);
ok(doc.app === "kite-local/tree", "lleva el identificador de la aplicación: " + doc.app);
ok(doc.format === 1 && doc.schema === 6 && doc.db === 3,
  "y las TRES versiones, que es lo que deja rechazar lo incompatible");
ok(Array.isArray(doc.nodes) && doc.nodes.length === 1, "con los nodos dentro");
ok(typeof doc.exported === "string" && doc.exported.includes("T"), "y cuándo se generó");

/* exportNode usa esa misma función, no una copia: si se duplicara, un
   cambio de versión se aplicaría a un camino y no al otro.          */
ok(/const doc = treeExportDoc\(nodes\);/.test(fn("exportNode")),
  "exportNode comparte el envoltorio en vez de construirlo aparte");

/* ---------- parseTreeExport reconoce lo nuestro y descarta lo demás ---------- */
const parse = new Function("EXPORT_KIND", fn("parseTreeExport") + "\nreturn parseTreeExport;")("kite-local/tree");
ok(parse(JSON.stringify(doc)) !== null, "reconoce un envoltorio válido");
ok(parse("hola, esto no es un árbol") === null, "texto suelto: null, y no rompe");
ok(parse("") === null, "cadena vacía: null");
ok(parse("{}") === null, "un JSON que no es nuestro: null");
ok(parse('{"app":"otra-cosa","nodes":[]}') === null, "otra aplicación: null");
ok(parse('{"app":"kite-local/tree"}') === null, "sin `nodes` no vale");
/* Que un GeoJSON pegado NO se confunda con un árbol: sigue su camino */
ok(parse('{"type":"FeatureCollection","features":[]}') === null, "un GeoJSON no es un árbol");

/* ---------- Pegar lo de fuera nunca MUEVE ---------- */
/* Cortar en otra pestaña no puede borrar nada aquí, así que lo que
   llega por el portapapeles del sistema se pega siempre como copia. */
const paste = fn("pasteClipboard");
ok(/async function pasteClipboard\(foreign = null\)/.test(paste),
  "pasteClipboard acepta nodos de fuera");
ok(/const source = foreign \? \{ nodes: foreign, cut: \[\], move: false \} : clipboard;/.test(paste),
  "y los envuelve con move:false y sin lista de cortados");
ok(!/\bclipboard\.nodes\b/.test(paste) && !/\bclipboard\.move\b/.test(paste),
  "el cuerpo trabaja sobre `source`, no sobre el portapapeles interno");

/* ---------- Ctrl+V no pega en el acto: espera al evento `paste` ---------- */
/* Es lo que evita pegar DOS veces. El orden está garantizado porque
   `paste` es la acción por defecto de esa misma pulsación, así que
   ocurre antes que un setTimeout(0); y por eso el keydown tampoco
   puede llamar a preventDefault, que cancelaría el evento.          */
const keydown = script.slice(script.indexOf('if (k === "v")'), script.indexOf('if (k === "v")') + 700);
ok(/pasteFallback = setTimeout\(\(\) => \{ pasteFallback = null; pasteClipboard\(\); \}, 0\);/.test(keydown),
  "Ctrl+V deja un respaldo pendiente en vez de pegar en el acto");
ok(!/if \(k === "v"\) \{ e\.preventDefault\(\)/.test(script),
  "y NO llama a preventDefault, que impediría que llegara el evento paste");

const listener = script.slice(script.indexOf('document.addEventListener("paste"'));
ok(/clearTimeout\(pasteFallback\)/.test(listener),
  "el evento paste cancela ese respaldo cuando trae algo nuestro");
ok(/if \(!doc\) return;/.test(listener),
  "y si NO es nuestro se va sin tocar nada, dejando que el respaldo pegue lo interno");
/* ---------- Solo importa si se pega EN EL ÁRBOL ----------
   En cualquier otro sitio el navegador pega como siempre y la
   aplicación no interpreta nada; quien pegue un árbol en la lista de
   puntos de un polígono se queda el JSON en el cuadro de texto y es
   cosa suya. Acotarlo así es lo que hace que "pegar aquí importa" sea
   una regla que el usuario puede tener en la cabeza.               */
ok(/if \(!t \|\| !t\.closest \|\| !t\.closest\("#tree"\)\) return;/.test(listener),
  "el pegado solo se interpreta dentro de #tree");
/* Y el guardia NO puede descartar todo `input`: al pulsar una fila el
   foco pasa a SU CASILLA, un <input type=checkbox> dentro del árbol,
   que es justo el estado normal desde el que se pega. Descartarlo
   dejaba el pegado entre pestañas sin funcionar NUNCA (comprobado en
   navegador: foco "checkbox", no importaba nada).                  */
ok(!/matches\("input, textarea/.test(listener),
  "no se descarta todo <input>: la casilla de una fila es uno, y es el foco normal");
ok(/if \(t\.matches\("input\.rename-input"\)\) return;/.test(listener),
  "solo se aparta el único campo de texto que vive dentro del árbol: el de renombrar");
/* Las mismas dos comprobaciones de versión que al importar un archivo */
ok(/format !== EXPORT_FORMAT/.test(listener) && /doc\.schema !== TREE_SCHEMA/.test(listener),
  "comprueba las dos versiones antes de reconstruir nada");

/* ---------- Tope de tamaño ---------- */
const cap = constDecl("CLIPBOARD_MAX");
ok(/5 \* 1024 \* 1024/.test(cap), "hay un tope de tamaño para el portapapeles del sistema: " + cap.trim());
const copyFn = fn("copyToSystemClipboard");
ok(/txt\.length > CLIPBOARD_MAX/.test(copyFn), "y se comprueba antes de escribir");
ok(/return;/.test(copyFn) && /navMessage/.test(copyFn),
  "por encima se avisa y se sigue: el portapapeles interno aún funciona en esta pestaña");
/* Un fallo al escribir no puede tumbar el copiado interno */
ok(/\.catch\(/.test(copyFn), "un writeText rechazado se captura, no se propaga");
ok(/if \(!navigator\.clipboard \|\| !navigator\.clipboard\.writeText\) return;/.test(copyFn),
  "y en un navegador sin la API simplemente no se intenta");

/* copySelection escribe en los DOS portapapeles */
const copySel = fn("copySelection");
ok(/clipboard = \{ nodes, cut:/.test(copySel), "copySelection sigue llenando el interno");
ok(/copyToSystemClipboard\(nodes\)/.test(copySel), "y además el del sistema");

if (!process.exitCode) console.log("SYSTEM CLIPBOARD TESTS OK");
