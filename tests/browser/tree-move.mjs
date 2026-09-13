/* Mover un nodo a otra rama tiene que recalcular la casilla de los DOS
   extremos: la carpeta que lo pierde puede quedarse apagada o entera, y
   la que lo recibe pasar a indeterminada.

   Se prueba en navegador porque el gesto es un arrastre de verdad: el
   manejador vive en un `drop` de HTML5 con su DataTransfer, y montarlo
   a mano —mover el `<li>` con appendChild, que es lo que el manejador
   hace— probaría mi reconstrucción del manejador, no el manejador. Ese
   matiz importó: la primera versión de esta comprobación movía el nodo
   por su cuenta y seguía en rojo con el arreglo ya puesto.

   Van aquí también los dos caminos de PEGAR, que ya recalculaban
   —materializeRecords se encarga del destino y deleteNode del origen—:
   se reportaron como rotos y no lo estaban, así que conviene que quede
   escrito con qué se comprobó.                                        */
import { launch, serve, openApp, reporter, READABLE } from "./_browser.mjs";

const { ok, done } = reporter("BROWSER TREE MOVE TESTS OK");
const browser = await launch();
const srv = await serve(READABLE, 8845);
const { page, errors } = await openApp(browser, srv.url);

await page.evaluate(() => {
  /* Carpeta con dos capas; `marcadas` decide si van activas */
  window.__mk = (padre, nombre, marcadas) => {
    const f = makeNode({ name: nombre, isFolder: true, checked: true });
    (padre ? nodeUl(padre) : ensureRootUl()).appendChild(f);
    for (let i = 0; i < 2; i++) {
      const m = L.marker([40 + i * 0.01, -3]);
      if (marcadas) m.addTo(rootGroup);
      nodeUl(f).appendChild(makeNode({
        name: `${nombre} capa ${i}`, layer: m, checked: marcadas, style: { color: "#1b5e97" }
      }));
    }
    applyContainerState(f);
    return f;
  };

  /* Origen: una rama a medias (la viajera encendida, sus hermanas no).
     Destino: todo apagado. Así el movimiento tiene que apagar el origen
     y dejar el destino indeterminado, que es lo que se reportó.      */
  window.__montar = () => {
    document.getElementById("tree").innerHTML = "";
    rootUl = null;
    rootGroup.clearLayers();
    const origen = __mk(null, "Origen", false);
    const viajera = __mk(origen, "Viajera", true);
    const destino = __mk(null, "Destino", false);
    applyContainerState(origen);
    applyContainerState(destino);
    origen.classList.remove("collapsed");
    destino.classList.remove("collapsed");
    return (window.__n = { origen, viajera, destino });
  };

  window.__estado = li => {
    const c = nodeCheckbox(li);
    return c.indeterminate ? "mixed" : (c.checked ? "on" : "off");
  };
  window.__leer = () => ({
    origen: __estado(__n.origen), destino: __estado(__n.destino),
    /* lo que DEBERÍAN decir según sus hijos de ahora */
    origenDebe: containerState(__n.origen), destinoDebe: containerState(__n.destino)
  });

  /* Arrastre real: los mismos eventos que dispara el navegador, con su
     DataTransfer. `dragstart` es el que llena dragItems/dragLi, y el
     clientY del `drop` decide entre soltar DENTRO de la carpeta y
     reordenar entre hermanos (franjas de 6 px arriba y abajo).      */
  window.__arrastrar = async (origen, destino, donde) => {
    const items = Array.isArray(origen) ? origen : [origen];
    const fila = li => li.querySelector(":scope > .node-row");
    const dt = new DataTransfer();
    clearSelection();
    for (const it of items) setSelected(it, true);
    setSelCursor(items[0]);
    fila(items[0]).dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    const r = fila(destino).getBoundingClientRect();
    const y = donde === "dentro" ? r.top + r.height / 2 : r.top + 1;
    const ev = t => new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientY: y });
    fila(destino).dispatchEvent(ev("dragover"));
    fila(destino).dispatchEvent(ev("drop"));
    await new Promise(listo => setTimeout(listo, 150));  /* el manejador es async */
  };
});

const comprobar = async (etiqueta, esperado) => {
  const r = await page.evaluate(() => __leer());
  ok(r.origen === esperado.origen,
    `${etiqueta}: el origen queda «${esperado.origen}» — dice «${r.origen}»`);
  ok(r.destino === esperado.destino,
    `${etiqueta}: y el destino «${esperado.destino}» — dice «${r.destino}»`);
  /* Y que coincida con lo que dicen sus hijos, que es la regla */
  ok(r.origen === r.origenDebe && r.destino === r.destinoDebe,
    `${etiqueta}: los dos coinciden con containerState — ${JSON.stringify(r)}`);
};

/* ---------- El punto de partida ---------- */
await page.evaluate(() => __montar());
await comprobar("de partida", { origen: "mixed", destino: "off" });

/* ---------- Arrastrar DENTRO de una carpeta ---------- */
await page.evaluate(async () => { __montar(); await __arrastrar(__n.viajera, __n.destino, "dentro"); });
await comprobar("arrastrando dentro de la carpeta", { origen: "off", destino: "mixed" });

/* ---------- Arrastrar ENTRE hermanos de otra rama ----------
   Otra zona del mismo manejador: aquí el destino no es la carpeta que
   se señala, sino la que la contiene.                                */
await page.evaluate(async () => {
  __montar();
  await __arrastrar(__n.viajera, nodeUl(__n.destino).children[0], "antes");
});
await comprobar("arrastrando entre hermanos", { origen: "off", destino: "mixed" });

/* ---------- Varias a la vez, de la misma rama ----------
   Los contenedores de origen se capturan ANTES de mover: después los
   nodos ya cuelgan del destino y no habría desde dónde recalcular.  */
await page.evaluate(async () => {
  __montar();
  const otra = __mk(__n.origen, "Otra", true);
  applyContainerState(__n.origen);
  await __arrastrar([__n.viajera, otra], __n.destino, "dentro");
});
await comprobar("arrastrando dos carpetas de golpe", { origen: "off", destino: "mixed" });

/* ---------- Vaciar una carpeta a medias no puede dejar el guion ----------
   Sin hijos no hay nada que agregar y la casilla se deja como esté,
   pero "unas activas y otras no" es mentira cuando no queda ninguna. */
const vaciada = await page.evaluate(async () => {
  document.getElementById("tree").innerHTML = "";
  rootUl = null;
  rootGroup.clearLayers();
  const padre = __mk(null, "Padre", false);
  for (const c of [...nodeUl(padre).children]) deleteNode(c);   /* solo queda la hija */
  const hija = __mk(padre, "Hija", true);
  nodeCheckbox(nodeUl(hija).children[1]).checked = false;
  applyContainerState(hija);
  applyContainerState(padre);
  const destino = __mk(null, "Destino", false);
  destino.classList.remove("collapsed");
  window.__n = { origen: padre, viajera: hija, destino };
  const antes = __estado(padre);
  await __arrastrar(hija, destino, "dentro");
  return { antes, despues: __estado(padre), aria: padre.getAttribute("aria-checked"),
    hijos: nodeUl(padre).children.length };
});
ok(vaciada.antes === "mixed", "la carpeta estaba a medias antes: " + vaciada.antes);
ok(vaciada.hijos === 0, "y se queda sin hijos al llevarse el único: " + vaciada.hijos);
ok(vaciada.despues !== "mixed" && vaciada.aria !== "mixed",
  "al vaciarse pierde el guion: " + vaciada.despues + " / aria " + vaciada.aria);

/* ---------- Y pegar, que ya lo hacía ---------- */
await page.evaluate(async () => {
  __montar();
  clearSelection();
  setSelected(__n.viajera, true);
  setSelCursor(__n.viajera);
  copySelection(true);            /* cortar */
  setSelCursor(__n.destino);
  await pasteClipboard();
});
await comprobar("cortando y pegando", { origen: "off", destino: "mixed" });

await page.evaluate(async () => {
  __montar();
  clearSelection();
  setSelected(__n.viajera, true);
  setSelCursor(__n.viajera);
  copySelection(false);           /* copiar: el origen no se toca */
  setSelCursor(__n.destino);
  await pasteClipboard();
});
await comprobar("copiando y pegando", { origen: "mixed", destino: "mixed" });

/* ---------- Un arrastre solo empieza desde el NOMBRE ----------
   El <li> entero es `draggable` —tiene que serlo para poder moverlo—,
   así que el navegador abría una sesión de arrastre aunque la pulsación
   empezara en el caret, en la casilla o en un botón de la fila: basta
   apretar y moverse unos píxeles. Y una sesión de arrastre HTML5 es un
   bucle de eventos ANIDADO del navegador: mientras dura, la página no
   recibe temporizadores, ni fotogramas, ni entrada, y parece colgada
   sin que se ejecute una línea de código propio. Medido en la sesión
   real que lo destapó: 27 s y 33 s de hilo parado sin una sola función
   del visor en marcha, la memoria plana y un arrastre en curso.     */
const asas = await page.evaluate(() => {
  const ul = ensureRootUl();
  const f = makeNode({ name: "Carpeta", isFolder: true });
  ul.appendChild(f);
  nodeUl(f).appendChild(makeNode({ name: "capa", layer: L.marker([40, -3]) }));
  const fila = f.querySelector(":scope > .node-row");
  const prueba = sel => {
    dragItems = null;
    dragFromBlocked = false;
    (fila.querySelector(sel) || fila).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    const ev = new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
    f.dispatchEvent(ev);
    return { cancelado: ev.defaultPrevented, arrastra: !!dragItems };
  };
  return { caret: prueba(".caret"), casilla: prueba("input[type=checkbox]"),
    nombre: prueba("label"), boton: prueba(".actions button") };
});
for (const [donde, r] of [["el caret", asas.caret], ["la casilla", asas.casilla], ["un botón", asas.boton]]) {
  ok(r.cancelado && !r.arrastra,
    `apretar ${donde} NO puede empezar un arrastre: ` + JSON.stringify(r));
}
ok(!asas.nombre.cancelado && asas.nombre.arrastra,
  "y desde el nombre sí se arrastra, que es el gesto de siempre: " + JSON.stringify(asas.nombre));

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
