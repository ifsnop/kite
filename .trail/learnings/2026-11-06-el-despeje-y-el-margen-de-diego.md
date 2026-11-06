---
title: "El despeje y el margen de Fresnel del perfil se miden contra una referencia elegida (MDT, MDS u obstáculo) y la etiqueta lo dice; las torres siguen apoyadas en…"
author: Diego
date: 2026-11-06
branch: feat/obstaculos-en-perfil
cost: { minutes: 15, tokens: 96182 }
id: l-375b1760
scope: repo
status: active
src: agent
touches:
  - src/js/63-route-profile.js
  - src/index.html
---

## Decided
La lectura del perfil enseñaba «Despeje» y «Margen» sin decir contra qué: salía de la serie del extremo de la línea (la superficie MDS, o el terreno MDT sin ella). Ahora un desplegable «Despeje y Fresnel respecto a» elige MDT, MDS u Obstáculos (el techo del obstáculo más alto bajo el cursor), y las filas se llaman «Despeje (MDS)», «Margen Fresnel (Obstáculo)», etc. Por defecto sigue siendo la superficie, o el terreno si no hay. El radio de Fresnel no depende de la referencia. La base de las torres (el suelo bajo cada antena) NO sigue la referencia: sigue saliendo del MDS, o del MDT sin MDS, y la leyenda de la línea lo dice.

## Tried and ruled out
Casillas independientes (una pareja de filas Despeje/Margen por cada referencia marcada): más información a la vez, pero un rectángulo de lectura más grande, y su alto fijo de 2 × 5 filas es una decisión previa.
Una opción «el más restrictivo de las tres»: responde a si hay línea de vista, pero no dice contra qué.
Que la referencia también cambie el suelo de las torres: cambiaría la línea inicio–fin, no lo que se mide.

## Watch out
Con «Obstáculos» como referencia la fila «Despeje obstáculo» se atenúa (sería el mismo número). Donde no hay obstáculo bajo el cursor, el despeje queda en guiones.
El «Margen» de Fresnel contra un obstáculo existe solo en la lectura bajo el cursor; la frase «Obstáculos que tapan la línea» sigue midiendo solo el despeje, sin Fresnel.

In the code: `src/js/63-route-profile.js` (`profileRef`, `profileRefKind`, `showProfileCursor`, `setProfileInfo`), `src/index.html` (`#pf-ref`), `tests/browser/elev-obstacles.mjs` (sección 3).
