---
title: "Alcance acordado del soporte de idiomas de KITE Local: español + inglés implementados,…"
author: Diego
date: 2026-10-26
id: l-d842ce26
scope: repo
status: active
touches:
  - i18n-tool.js
  - build.js
---

## Decided
Los textos de la interfaz se soportan en español (idioma de origen) e inglés. El usuario NO piensa soportar más idiomas a largo plazo, pero quiere la app **preparada para un tercero (francés)**: añadirlo = `node i18n-tool.js new fr "Français"` + una línea en el manifiesto de `build.js`, sin tocar código.

**Why:** pidió «implementa inglés y español y deja la puerta abierta para francés» (22 oct 2026). Por eso el diseño es genérico (registro `UI_LANGS`, cadena de respaldo idioma → inglés → español, plurales con `Intl.PluralRules`) pero no se implementó ni RTL ni formatos de número no latinos.

## Watch out
el diseño y las reglas viven en `.claude/rules/i18n.md`. No proponer más idiomas ni RTL por iniciativa propia. El idioma se guarda en `localStorage` (`kite.uiLang`), única excepción a «ajustes en IndexedDB», porque hace falta síncrono antes de arrancar.

_From Claude Code's memory of this repo, last updated Oct 22._
