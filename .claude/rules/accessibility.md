---
description: Accesibilidad del árbol (ARIA) y de los diálogos (setupDialog, atrapado de foco).
paths:
  - "src/js/**"
  - "src/index.html"
---

## Accesibilidad

- El árbol es `role="tree"` con `treeitem`, `role="group"`,
  `aria-selected` y `aria-expanded` (`syncExpanded` / `syncAllExpanded`
  tras cualquier cambio de colapso). Los botones que solo tienen icono
  llevan `aria-label` además del `title`.
- **El buscador del panel** (`#nav-search`, `role="search"`): el campo lleva `aria-label`; los botones ↑ ↓ y la × llevan `aria-label` además del `title`; `#search-count` es una región `aria-live="polite"` (el recuento de coincidencias se anuncia) y el aviso «Ninguna coincidencia» (`#tree-filter-empty`) es `role="status"`. Una fila que el filtro oculta es `hidden` (fuera del árbol de accesibilidad) y una carpeta que el filtro enseña abierta tiene `aria-expanded="true"`.
- `<html lang>` sigue al idioma de la interfaz (`setUiLang`, ver `i18n.md`); los textos de `aria-label` y `title` se traducen como cualquier otro.
- Los diálogos se registran con `setupDialog`: `role="dialog"`,
  `aria-modal` según sean modales o no, `aria-labelledby` a su título y
  atrapado de Tab dentro de la caja. `focusDialog` / `releaseFocus`
  llevan el foco al abrir y lo devuelven al elemento que lo abrió.
  Cualquier diálogo nuevo debe pasar por ahí. Con el × de cerrar en la
  cabecera (TODOS los diálogos, ver `dialog-close-button.md`), el
  nombre sale del `.dlg-title` y no del `<h2>` entero (si no, acabaría
  en «Cerrar»), y el foco de apertura salta el × salvo que no haya otro
  control visible; el ×, sin texto, lleva `title` y `aria-label`. **Excepción**: un
  diálogo que abre un clic EN EL VISOR a mitad de un gesto (la ruta que
  se está creando) no se lleva el foco (`focusDialog(box, false)`, vía
  `openStyleDialog(li, { focus: false })`): las teclas del visor tienen
  que seguir llegando (ver `view-controls-map.md`).
- **Marker icons have an accessible name** (`nameMarkerIcon`, `42-hittest.js`): Leaflet makes every marker icon a keyboard-focusable `role="button"` and names none of them, so a screen reader heard "button" a hundred times in a folder of Wikipedia articles. The node name goes in `aria-label` (not `title`, which would add a native tooltip over the hover card). It is set where the style is applied (`applyMarkerText`, for rows) and on the raw layer of a restored record (`styleMarkerIcon(layer, s, name)`, which has no row yet), and again on the layer's `add` event because Leaflet recreates the icon element. Only marker layers with a custom style go through there; the default Leaflet pin is unchanged.
- **The info card's stack of recent cards** (`#desc-stack`, under the title): an `<ol role="tablist">` named by a screen-reader-only label («Fichas recientes (n)»); each tab is a `<button role="tab">` with `aria-selected` (its card is the one shown) and `aria-controls="desc-body"` (`role="tabpanel"`), and a `title` that says «bajo el cursor» or «fijada»; ← and → move the focus between tabs and Enter or Space chooses one (a click; hovering does nothing). Each tab's pin (`.info-tab-pin`, a separate button next to the tab) and the header pin `#desc-pin` have `aria-pressed` and a label that says what they will do («Fijar esta ficha»/«Soltar esta ficha», «Fijar la ficha»/«Soltar la ficha»). The pin and the tabs carry `.dlg-skip-focus`, which `focusDialog` skips, so opening the card puts the focus on its content; a mouse click on them does not take the focus (`keepFocusOnClick`), or the card would stop shrinking when the pointer leaves the layers.
