---
description: Mantenimiento obligatorio de docs/manual-usuario y docs/estudio-seguridad al tocar lo que describen.
paths:
  - "docs/**"
---

## Documentación complementaria

Dos documentos en `docs/`, para quien usa o audita la aplicación:

- `docs/manual-usuario-kite-local.md` — manual de usuario con capturas
  reales (`docs/img/`): los dos paneles, el árbol, diálogos de estilo,
  menú contextual, atajos, tareas habituales.
- `docs/estudio-seguridad-kite-local.md` — evidencia de auditoría
  (AESA/EASA): origen de cada capa y servicio auxiliar, por qué la
  app no modifica los datos que carga/muestra (con sus excepciones
  controladas), y qué pruebas lo respaldan.

**Mantenerlos al día es parte del cambio, no un aparte.** Un documento
desactualizado induce a error activamente. **Antes de dar por
terminado cualquier cambio que toque algo que describen, revisarlos y
actualizarlos** (texto, tablas, capturas del manual si cambió el
aspecto). Ver punto 13 del checklist en `00-principles.md`.
