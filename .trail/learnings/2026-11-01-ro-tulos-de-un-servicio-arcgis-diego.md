---
title: "Rótulos de un servicio ArcGIS: no son datos; se rotulan desde los polígonos con el campo de la regla del servidor"
author: Diego
date: 2026-11-01
branch: feat/servicios-arcgis-mapserver
cost: { minutes: 1, tokens: 2728 }
id: l-1a4d0bb6
scope: repo
status: active
src: agent
---

## Decided
Al traer una capa de un servicio ArcGIS, si el servidor publica una regla de rotulado (`drawingInfo.labelingInfo`), su campo pasa a ser el nombre de cada elemento (sin selector, `file.kiteNameKeys`) y se ve siempre sobre el mapa (`textAlways`, desplegando la carpeta), porque la imagen de `/export` corta los rótulos en el borde de cada tesela y los polígonos no. Lo eligió el usuario entre tres salidas (teselas más grandes, una imagen por vista, rotular desde los polígonos).

## Tried and ruled out
- Tomar «el primer campo de la expresión» a secas: en el script de `TMA_CTA_texto_niveles` el primero es `NOTAS_LOWER`, que está dentro de un `isEmpty(…)` y es una condición, así que el test con la ficha real fallaba con «NOTAS_LOWER ≠ NAME_TXT». Ahora se quitan los `isEmpty(…)` antes de buscar.
- Ejecutar Arcade: no se hace porque es un lenguaje de scripts completo; con una regla de un campo el resultado es exacto y con un script es una aproximación.

## Watch out
Los textos de las capas `*_texto` no son datos (polígonos transparentes con una regla de etiquetado) y `/export` no admite un margen, por eso se cortan. `applyPolygonText` solo corre al construir la fila y un GeoJSON recién importado está colapsado: sin desplegarlo (`arcgisShowLabels`) no hay rótulos, y tras recargar una carpeta sin desplegar tampoco.
