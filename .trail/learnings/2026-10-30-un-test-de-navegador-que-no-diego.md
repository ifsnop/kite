---
title: Un test de navegador que no cierra su servidor (srv.close) cuelga run-all; y run-all aborta si el build está desfasado
author: Diego
date: 2026-10-30
branch: feat/exportar-gpx-anillos-enlace-atributos-perfil
cost: { minutes: 19, tokens: 192577 }
id: l-7ead3e8c
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - build.js
  - docs/estudio-seguridad-kite-local.md
  - docs/img/capturas.json
  - docs/img/menu-exportar.png
  - docs/manual-usuario-kite-local.md
  - kitelocal.html
  - kitelocal.min.html
  - src/js/04-i18n-en.js
  - src/js/10-map.js
---

## Decided
Todo test de `tests/browser/*.mjs` que use `serve(READABLE, puerto)` (`tests/browser/_browser.mjs`) debe llamar a `srv.close()` antes de `done()`. `serve` deja un `http.Server` escuchando y, sin cerrarlo, el proceso de Node no termina aunque ya haya impreso «OK»: `tests/run-all.js` espera para siempre a esa suite. Corregido en `tests/browser/gpx-import.mjs` y `tests/browser/export-menu.mjs` (este último usaba `srv.close?.()` sobre un valor que ya era una función, y tardaba lo mismo).

## Tried and ruled out
- Pensar que era intermitente o un fallo de Playwright: con `DEBUG=pw:api` el log llegaba hasta `browser.close succeeded` y el proceso seguía vivo; una copia con `console.error` entre medias «pasaba» solo porque falló antes por otra razón.
- La primera vez que el test pareció pasar, en realidad terminó por el `timeout 120` del comando, no por sí mismo.
- `pkill -f "tests/run-all.js"` desde Bash mata también el shell que lo lanza (su línea de comandos contiene el patrón): usar el PID de `ps`.

## Watch out
- `node tests/run-all.js` empieza comprobando que `kitelocal.html`, `kitelocal.min.html` y `sw.js` correspondan a `src/`; si se editó `src/` (textos, diccionario inglés, `index.html`) después del último `npm run build`, aborta con «NO coincide con src/». No es un fallo del build: basta `npm run build` y repetir. Filtrar la salida con `grep` por «FAIL» oculta ese aborto (usa «✗»).
- La batería completa con navegador tarda más de 10 minutos: lanzarla con `run_in_background` y no tocar `src/` mientras corre (`tests/i18n.js` lee las fuentes).
