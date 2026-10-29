---
title: "tests/docs.js vigila servidores, atajos, menú y ventanas: la chuleta manda y el Anexo A lista todos los servidores"
author: Diego
date: 2026-10-29
branch: docs/fases-2-3-pruebas-docs
cost: { minutes: 37, tokens: 186085 }
id: l-36f87243
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - build.js
  - docs/ejemplos/operacion-sierra.kml
  - docs/ejemplos/remoto.kml
  - docs/ejemplos/sensores.geojson
  - docs/estudio-seguridad-kite-local.md
---

## Decided
- El Anexo A del estudio lista TODOS los servidores que salen de los literales del código (también enlaces, metadatos y direcciones de ejemplo), así `tests/docs.js` no necesita lista de exentos: falta en el anexo = falla, sobra en el anexo = obsoleto. Un servidor nuevo = una fila en el mismo cambio.
- La chuleta de la app (`#shortcuts` de `src/index.html`) es la fuente de los atajos; el apartado 8 del manual se copia con las mismas palabras y en el mismo orden. Única excepción hasta ahora: la fila de Supr de la edición de vértices, donde el código (`deleteSelectedVertex` selecciona el vecino) obligó a corregir la chuleta.
- Cada etiqueta del menú contextual va entre « » en el apartado 5 del manual; cada ventana de `index.html` tiene su frase en `DIALOG_DOC` (o una exención con motivo).

## Tried and ruled out
- Comparar solo la columna de teclas de los atajos: dejaba pasar redacciones que se contradicen.
- Extraer servidores con una regex sobre el texto de los fuentes: contaba direcciones de comentarios; se usa `acorn` sobre literales de cadena y plantillas.

## Watch out
- Cambiar un texto estático de `index.html` cambia su clave de traducción: `node i18n-tool.js sync en` y traducir (en inglés Supr se escribe «Del»).
- El menú tiene 20 etiquetas, no 17 (los tres «Medir» y «Perfil de ruta» cuentan).
