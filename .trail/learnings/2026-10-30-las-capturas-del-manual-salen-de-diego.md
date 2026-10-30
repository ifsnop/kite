---
title: "Las capturas del manual salen de kitelocal.html (no de src/): construir antes, y regenerar solo las imágenes afectadas"
author: Diego
date: 2026-10-30
branch: feat/exportar-gpx-anillos-enlace-atributos-perfil
cost: { minutes: 6, tokens: 109878 }
id: l-020954dd
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - build.js
  - docs/estudio-seguridad-kite-local.md
  - docs/img/anadir-url.png
  - docs/img/aviso-movil.png
  - docs/img/capturas.json
  - docs/img/fila-seleccionada.png
  - docs/img/pie-panel.png
  - docs/img/tema-oscuro.png
  - docs/img/vista-general.png
---

## Decided
- `npm run capturas <nombre>` abre `kitelocal.html`, el artefacto generado, no `src/`. Tras tocar HTML, CSS o JS hay que ejecutar `npm run build` ANTES, o la figura sale con la interfaz anterior (pasó con `anillos-dialogo.png`: se veía «Radios (NM)» cuando el HTML ya llevaba la unidad tras el campo).
- Regenerar todas (`npm run capturas`) reescribe ~40 PNG aunque casi ninguno haya cambiado de aspecto (teselas, subpíxeles) y llena el commit de binarios. Se regeneran solo las que cambian de verdad: `git checkout docs/img` y luego `npm run capturas a b c` con las afectadas (una franja de arrastre o un botón de fila nuevos tocan `pie-panel`, `vista-general`, `tema-oscuro`, `aviso-movil`, `fila-seleccionada`, `anadir-url`).

## Tried and ruled out
- `--sin-fondo` para la versión final de una figura con mapa: sirve para iterar rápido, pero reescribe `"fondo"` en `docs/img/capturas.json` a «liso» y el mapa sale sin teselas. La figura definitiva se genera con red y el campo se devuelve a «OpenStreetMap».

## Watch out
- Un anillo o sector restaurado tras recargar es un `L.geoJSON` (un grupo), no el `L.polygon` creado: su polígono es `nodeLayer(li).getLayers()[0]`. Los tests de navegador que miren la geometría después de `page.reload()` deben leerlo así (`tests/browser/rings.mjs`).
- Los anillos que cruzan ±180° dejan longitudes continuas (>180) y sobreviven al guardado y a la recarga; otros formatos (`validGeometry`, GeoJSON estricto) las rechazarían. Es el caso pendiente «Antimeridiano incompleto» de `00-principles.md`, no un olvido.
