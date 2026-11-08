---
title: "Un archivo de reglas nuevo en la carpeta de configuración del agente no se añade sin forzarlo, y un add que falla no debe encadenarse con el commit y el push"
author: Diego
date: 2026-11-08
branch: feat/apple-design-motion
cost: { minutes: 1, tokens: 1755 }
id: l-4643228f
scope: repo
status: active
src: agent
touches:
  - tools/capturas.mjs
---

## Decided
Una regla nueva de `.claude/rules/` se añade con `git add -f`, because la carpeta entera está en `.gitignore` aunque los archivos que ya existían sí están versionados: los modificados se añaden sin más y solo el NUEVO falla.

## Tried and ruled out
Encadenar `git add … && git commit … ; git push` con la regla nueva en la lista: fails porque el `add` se negó por el ignorado, el `&&` cortó antes del commit y el `;` empujó igualmente la rama vacía (igual que `main`). No se perdió nada, pero el remoto quedó sin el cambio hasta un segundo push.

## Watch out
Tras un `git add` con archivos nuevos, mirar `git status --short` antes de commitear y no encadenar el push con `;`, otherwise se publica una rama sin el cambio. Las capturas del manual (`npm run capturas`) se regeneran con `reducedMotion: "reduce"`, because sin él una ventana o un menú podían salir a medio escalar por la animación de entrada.

In the code: `.gitignore` (línea `.claude/`), `.claude/rules/motion.md` (alta con `git add -f`), `tools/capturas.mjs` (`openApp`, `reducedMotion`).
