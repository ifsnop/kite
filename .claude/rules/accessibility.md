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
- Los diálogos se registran con `setupDialog`: `role="dialog"`,
  `aria-modal` según sean modales o no, `aria-labelledby` a su título y
  atrapado de Tab dentro de la caja. `focusDialog` / `releaseFocus`
  llevan el foco al abrir y lo devuelven al elemento que lo abrió.
  Cualquier diálogo nuevo debe pasar por ahí. **Excepción**: un
  diálogo que abre un clic EN EL VISOR a mitad de un gesto (la ruta que
  se está creando) no se lleva el foco (`focusDialog(box, false)`, vía
  `openStyleDialog(li, { focus: false })`): las teclas del visor tienen
  que seguir llegando (ver `view-controls-map.md`).

