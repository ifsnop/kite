---
description: Aviso «Mejor desde un ordenador» al abrir la aplicación desde un móvil, y el diseño de móvil (panel de navegación a pantalla completa, solo el mapa si se insiste).
paths:
  - "src/js/50-splitter.js"
  - "src/js/99-boot.js"
  - "src/index.html"
  - "src/styles.css"
---

## Aviso y diseño de móvil

- **Qué es «móvil»** (`isPhoneScreen`, `50-splitter.js`): puntero táctil como principal (`(pointer: coarse)`) **y** lado corto de la ventana por debajo de `MOBILE_MAX_PX` (600). Entra un teléfono en vertical o en horizontal (lado corto ≈ 360-430); NO entra una tableta (≥ 768) ni una ventana de escritorio estrecha, que tiene ratón y puede ensancharse. Se decide UNA vez, al cargar: girar el teléfono o redimensionar no lo vuelve a preguntar.
- **Dos salidas**, en el orden de botones del proyecto (lo que no compromete a la izquierda): «Cerrar» (y Escape) deja el panel de navegación; «Continuar de todos modos» lo oculta y deja solo el mapa. Se pidió así: en una pantalla de móvil no caben el panel y el visor, así que quien insiste se queda con el visor. El texto del aviso explica las dos salidas y que se recordará la elección.
- **«Solo el mapa» es el `nav-hidden` de siempre**, no un estado nuevo: `setNavHidden(hidden)` (la comparte el botón ◀/▶ y el aviso) pone la clase, cambia la flecha y llama a `map.invalidateSize()`. Cualquier cambio del botón vale para los dos.
- **`phone-layout`** (clase en `<html>`, `styles.css`) se pone en TODO móvil, con aviso o sin él, hayan elegido lo que hayan elegido: fija `--nav-width: calc(100vw - 34px)` y agranda la flecha a 28 px. **Sin él, el panel de 400 px es más ancho que la pantalla y su flecha (en `left: nav-width + 5px`) queda FUERA: abierto el panel no habría forma de volver al mapa.** `tests/browser/mobile-notice.mjs` lo comprueba con un toque real y se comprobó que falla sin la regla. Ojo: `setNavWidth` (el arrastre del separador, solo ratón) escribe `--nav-width` en línea y ganaría a esta regla; en un móvil no hay arrastre, pero no se debe llamar desde código de arranque.
- **Se recuerda** (`mobileView`, clave del almacén `tree`, ver `persistence-indexeddb.md`): `map` o `nav`. Las cargas siguientes aplican la elección sin preguntar (`initPhoneLayout(saved)`, llamado lo primero del arranque, `99-boot.js`, para no ver el panel desbordado mientras se lee el resto). No hay forma de volver a ver el aviso desde la interfaz: la recomendación ya se leyó, y la flecha cubre lo que importa.
- **Diálogo**: `#mobile-notice`, modal, `setupDialog` + `makeDialogMovable`, `max-width: 42ch` como las demás confirmaciones. Va en la cadena de Escape de `52-measure.js` (como «Cerrar», nunca como «Continuar»: Escape no compromete).
- **No se usa el agente de usuario**: se pueden emular las dos cosas en las pruebas (táctil + tamaño) y un navegador de escritorio con las herramientas de desarrollador en modo móvil se comporta como un móvil, que es lo que se quiere.
- Probado en `tests/browser/mobile-notice.mjs`.
