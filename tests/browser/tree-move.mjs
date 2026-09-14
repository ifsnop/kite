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
/* Panel alto: el gesto necesita ver a la vez el nodo que se agarra y el
   destino, y con la ventana por defecto el árbol se queda corto.    */
await page.setViewportSize({ width: 1280, height: 1000 });

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

  /* Dónde agarrar y dónde soltar, en coordenadas de pantalla: el
     arrastre lo conduce Playwright con el ratón DE VERDAD (ver
     `arrastrar`). Desde que no se usa el arrastre nativo de HTML5, el
     gesto completo se puede automatizar; antes no, porque ningún
     cliente abre la sesión de arrastre del navegador y había que
     despachar DragEvents a mano, que probaban media cosa.
     Se agarra por el NOMBRE (45 px desde el borde): el centro de la
     fila cae sobre los botones de acción, que aparecen al pasar el
     ratón y NO son asa.                                             */
  window.__punto = (nombre, donde) => {
    const li = [...document.querySelectorAll("#tree li")].find(x => x._name === nombre);
    /* A la vista antes de medir: con el ratón DE VERDAD, una fila fuera
       del área visible del panel no está bajo ningún píxel, y
       elementFromPoint devuelve el panel en vez de la fila. Con los
       eventos sintéticos de antes esto daba igual, y por eso no
       aparecía.                                                      */
    li.scrollIntoView({ block: "nearest" });
    const r = li.querySelector(":scope > .node-row").getBoundingClientRect();
    return { x: Math.round(r.x + 45),
      y: Math.round(donde === "antes" ? r.y + 2 : r.y + r.height / 2) };
  };
});

/* El gesto entero: agarrar por el nombre, moverse lo justo para que
   deje de ser un clic, llevar al destino y soltar.                  */
const arrastrar = async (origenes, destino, donde) => {
  const nombres = Array.isArray(origenes) ? origenes : [origenes];
  await page.evaluate(ns => {
    clearSelection();
    const buscar = n => [...document.querySelectorAll("#tree li")].find(x => x._name === n);
    for (const n of ns) setSelected(buscar(n), true);
    setSelCursor(buscar(ns[0]));
  }, nombres);
  const a = await page.evaluate(n => __punto(n, "dentro"), nombres[0]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 20, a.y + 4, { steps: 3 });
  /* El destino se mide con el arrastre ya empezado: `scrollIntoView`
     puede haber movido las filas, y el punto de antes ya no valdría. */
  const b = await page.evaluate(([n, d]) => __punto(n, d), [destino, donde]);
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(350);
};

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
await page.evaluate(() => __montar());
await arrastrar("Viajera", "Destino", "dentro");
await comprobar("arrastrando dentro de la carpeta", { origen: "off", destino: "mixed" });

/* ---------- Arrastrar ENTRE hermanos de otra rama ----------
   Otra zona del mismo manejador: aquí el destino no es la carpeta que
   se señala, sino la que la contiene.                                */
await page.evaluate(() => __montar());
await arrastrar("Viajera", "Destino capa 0", "antes");
await comprobar("arrastrando entre hermanos", { origen: "off", destino: "mixed" });

/* ---------- Varias a la vez, de la misma rama ----------
   Los contenedores de origen se capturan ANTES de mover: después los
   nodos ya cuelgan del destino y no habría desde dónde recalcular.  */
await page.evaluate(() => { __montar(); __mk(__n.origen, "Otra", true); applyContainerState(__n.origen); });
await arrastrar(["Viajera", "Otra"], "Destino", "dentro");
await comprobar("arrastrando dos carpetas de golpe", { origen: "off", destino: "mixed" });

/* ---------- Vaciar una carpeta a medias no puede dejar el guion ----------
   Sin hijos no hay nada que agregar y la casilla se deja como esté,
   pero "unas activas y otras no" es mentira cuando no queda ninguna. */
const antesDeVaciar = await page.evaluate(() => {
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
  return __estado(padre);
});
await arrastrar("Hija", "Destino", "dentro");
const vaciada = await page.evaluate(() => ({
  antes: null, despues: __estado(__n.origen),
  aria: __n.origen.getAttribute("aria-checked"),
  hijos: nodeUl(__n.origen).children.length
}));
vaciada.antes = antesDeVaciar;
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

/* ---------- Un clic NO puede convertirse en arrastre ----------
   Aquí estaba el cuelgue. El arrastre nativo de HTML5 abre un BUCLE DE
   EVENTOS ANIDADO en el navegador: mientras dura, la página no recibe
   temporizadores, ni fotogramas, ni entrada, y parece muerta sin
   ejecutar una línea de código propio. Medido en la sesión real: 27 s
   y 33 s de hilo parado sin una sola función del visor en marcha, la
   memoria plana y un hueco de fotogramas de 119 s; la firma era
   siempre un `pointerdown` sobre una fila SIN su `click`.

   Y no bastaba con acotar el asa: un clic normal lleva unos píxeles de
   temblor —justo lo que el navegador toma por principio de arrastre—.
   Por eso ya no se usa el arrastre nativo, y esto lo comprueba con el
   ratón de verdad: pulsar y moverse dos o tres píxeles tiene que
   seguir siendo un clic.                                            */
await page.evaluate(() => {
  document.getElementById("tree").innerHTML = "";
  rootUl = null;
  rootGroup.clearLayers();
  __mk(null, "Uno", false);
  __mk(null, "Dos", false);
});
const temblor = await page.evaluate(() => __punto("Uno", "dentro"));
await page.mouse.move(temblor.x, temblor.y);
await page.mouse.down();
await page.mouse.move(temblor.x + 3, temblor.y + 2);
const duranteElClic = await page.evaluate(() => !!dragItems);
await page.mouse.up();
await page.waitForTimeout(150);
ok(!duranteElClic,
  "un clic con tres píxeles de temblor NO empieza ningún arrastre");
ok((await page.evaluate(() => [...document.querySelectorAll("#tree > ul > li")].map(li => li._name)))
  .join() === "Uno,Dos", "y no mueve nada");

/* Ni un solo elemento del árbol es arrastrable por el navegador: es lo
   que garantiza que esa sesión no pueda abrirse por ningún camino.  */
ok(await page.evaluate(() => document.querySelectorAll("#tree [draggable=true]").length) === 0,
  "no queda ningún draggable nativo en el árbol");

/* Escape cancela a mitad, que con el arrastre nativo no se podía */
await page.mouse.move(temblor.x, temblor.y);
await page.mouse.down();
await page.mouse.move(temblor.x + 30, temblor.y + 4, { steps: 3 });
const duranteArrastre = await page.evaluate(() => !!dragItems);
await page.keyboard.press("Escape");
const trasEscape = await page.evaluate(() => ({ arrastrando: !!dragItems,
  marcas: document.querySelectorAll(".drop-into,.drop-before,.drop-after").length }));
await page.mouse.up();
ok(duranteArrastre, "moviendo de verdad sí arranca el arrastre");
ok(!trasEscape.arrastrando && trasEscape.marcas === 0,
  "y Escape lo cancela sin dejar marcas: " + JSON.stringify(trasEscape));

ok(errors.length === 0, "sin errores de página: " + JSON.stringify(errors));

await browser.close();
srv.close();
done();
