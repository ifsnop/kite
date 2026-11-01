---
title: "Antes de «actualizar el PR», comprobar que no está fusionado: lo empujado después no entra en main"
author: Diego
date: 2026-11-01
branch: feat/servicios-arcgis-mapserver
cost: { minutes: 1, tokens: 11694 }
id: l-be214bd9
scope: repo
status: active
src: agent
---

## Decided
Antes de empujar commits nuevos a la rama de un PR abierto y editar su descripción, se mira `gh pr view <n> --json state,mergedAt,headRefOid`. Si ya está `MERGED`, los commits posteriores a su `headRefOid` no están en `main` y van en un PR NUEVO desde la misma rama (solo difieren esos commits); la descripción del PR fusionado se deja como estaba.

## Tried and ruled out
Empujar y editar la descripción del #56 a ciegas: fails porque estaba fusionado desde hacía rato (`mergedAt` 17:06, `headRefOid` `dbb4b73`); `gh pr view --json commits` seguía contando 8 y no cambiaba tras el push, que es la señal que lo delató. Hubo que deshacer la edición de la descripción, que contaba cambios que no estaban en lo fusionado.

## Watch out
Que `git log origin/main..HEAD` salga con 2 commits y no con todos los de la rama indica que `main` ya trae los anteriores. No hace falta rebase ni empuje forzado: un PR nuevo desde la misma rama enseña solo los 2.
