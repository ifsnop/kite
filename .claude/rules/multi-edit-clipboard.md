---
description: Editar varios nodos a la vez (mezcla de valores) y portapapeles interno/del sistema (copiar, cortar, pegar entre pestañas).
paths:
  - "src/js/44-dialogs.js"
  - "src/js/41-selection.js"
  - "src/js/40-panel-actions.js"
---

### Editar varios a la vez

- **Un valor que no es igual en todos NO se aplica si el usuario no lo
  toca.** Regla base: abrir el diálogo para cambiar un color no debe
  igualar de paso grosores, rellenos, etc. Dos conjuntos:
  `styleMixed` (propiedades que no coinciden, de `mixedProps` al abrir)
  y `styleTouched` (las que el usuario movió). `draftProps` aplica una
  propiedad solo si no estaba mezclada o si se tocó; el resto se queda
  como estaba en cada nodo (`{ ...normalizePathStyle(t._style), ...pick }`).
  Con un solo nodo, `styleMixed` queda vacío y se aplica todo.
- **Se marca la FILA, no el control** (`.dlg-row.mixed`, añade
  «(varios)»): común a número, color, selector y casilla. Donde el
  control puede quedarse sin valor, se vacía (marcador de posición); un
  rango o selector no pueden vaciarse y enseñan el del primero, que es
  el que se aplicaría al tocarlos. Una casilla usa el mismo tercer
  estado nativo que una carpeta a medias.
- **Tocar un control lo saca de la mezcla al momento** (delegación
  sobre la caja del diálogo; `CONTROL_PROP` mapea control→propiedad, así
  un control nuevo queda cubierto con solo aparecer en esa tabla).
  Colores e icono NO disparan `input`: avisan a mano desde sus
  selectores.
- **El nombre ya NO se esconde con varios seleccionados**: el campo
  enseña los nombres que hay (`joinNames`) y escribir uno los renombra
  todos. Es marcador de posición, no valor: «no tocado» = campo vacío,
  sin bandera aparte, y aceptar sin escribir no renombra nada.
- **Un campo vacío no es un valor** (`numOr`): leerlo como 0 o por
  defecto metería en el borrador algo que nadie escribió.
- **`pg-mode` vale por DOS propiedades** (`stroke` y `fill`): se
  aplican juntas o ninguna — "ni contorno ni relleno" no es una
  combinación que el selector ofrezca.
- **Portapapeles interno**: guarda los registros de `serializeNode`;
  pegar reconstruye con `buildFromNodes`. Cortar no borra hasta que se
  pega (Escape cancela); pegar entra en la carpeta del cursor si está
  desplegada, si no, a continuación de él. No serializa a texto ni pasa
  por el sistema.
- **Portapapeles DEL SISTEMA**, para cruzar entre instancias (incluso
  de dominios distintos): al copiar se escribe el MISMO envoltorio
  `.kite.json` que exportar (`treeExportDoc`, compartido con
  `exportNode`) — pegar cuesta lo mismo que importar ese archivo, con
  las mismas comprobaciones de versión. Es el portapapeles del USUARIO,
  así que no hace falta CORS ni `postMessage`.
- **Copiar y pegar NO son simétricos.** `writeText` funciona con
  activación transitoria (Ctrl+C); `readText()` exige permiso — Firefox
  ni lo ofrece. Por eso LEER va por el evento `paste`, que entrega
  contenido sin pedir nada.
- **Probado de punta a punta**: `tests/browser/clipboard.mjs` copia con
  Ctrl+C en un origen y pega con Ctrl+V en otro, portapapeles real del
  sistema. Requiere Playwright, no puppeteer: con Chromium 129 vía
  puppeteer, `writeText` daba `NotAllowedError` incluso con permisos
  concedidos y Ctrl+V real no disparaba `paste` — límite de ese
  cliente/navegador, no del modo headless.
- **Ctrl+V no pega en el acto, y el keydown NO llama a
  `preventDefault`** (cancelaría el evento `paste`): el keydown deja un
  respaldo pendiente (`pasteFallback`, `setTimeout(0)`) que el evento
  `paste` cancela si trae un árbol nuestro. Si lo pegado no es nuestro,
  el respaldo pega el portapapeles interno.
- **Pegar solo IMPORTA sobre el árbol** (`closest("#tree")`). En
  cualquier otro sitio el navegador pega normal — p. ej. en la lista de
  puntos de un polígono queda el JSON en texto.
- **Cuidado con ese guardia: NO descartar todo `input`.** Al pulsar una
  fila el foco pasa a su `<input type=checkbox>` — estado normal desde
  el que se pega. Solo se aparta `input.rename-input` (el de renombrar).
- **Lo que llega de fuera nunca MUEVE**: `pasteClipboard(foreign)`
  siempre trata como copia (`move: false`), porque cortar en otra
  pestaña no puede borrar nada aquí.
- **NUESTRA propia copia va por el camino INTERNO**, y esto costó un
  fallo serio: al escribir también en el portapapeles del sistema,
  Ctrl+V leía de vuelta el envoltorio que la misma pestaña acababa de
  escribir y lo trataba como ajeno → cada Ctrl+X se duplicaba y la
  carpeta de origen quedaba cortada (gris) para siempre. Se reconoce
  comparando el texto pegado con `clipboardText` (lo último que esta
  pestaña escribió): si coincide, manda el portapapeles interno, que es
  el único que sabe si fue un corte. Resuelto en el propio escucha, no
  dejando correr el respaldo del keydown (un pegado puede llegar sin
  pulsación, vía menú del navegador).
- Ctrl+V sigue pegando el interno desde cualquier sitio fuera de campos
  de texto; acotar al árbol es solo para lo que llega de FUERA.
- **Tope de tamaño** (`CLIPBOARD_MAX`, 5 MB de texto): por encima se
  avisa y se sigue (el interno aún funciona), remitiendo al botón 💾.
  Un `writeText` rechazado se captura sin tumbar el copiado interno.
