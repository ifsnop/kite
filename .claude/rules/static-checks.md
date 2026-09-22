---
description: Comprobaciones estáticas sobre kitelocal.html (SRI, guardián de Leaflet, BUILD, bytes NUL, ids, funciones declaradas).
paths:
  - "tests/statics.js"
  - "tests/minified.js"
  - "tests/attribution.js"
---

## Comprobaciones estáticas del propio archivo

Sobre `kitelocal.html`, automatizadas:

- Todo recurso de librería lleva `integrity` y `crossorigin`
  (`tests/minified.js`).
- El guardián de Leaflet precede a cualquier uso de `L` (íd.).
- `BUILD` tiene la forma esperada y el mismo valor en ambos artefactos
  (`tests/attribution.js`, `tests/minified.js`).
- **Sin bytes NUL** (`tests/statics.js`): ya se coló uno en un
  separador de template literal de `navMessage`; no rompía el
  navegador pero hacía que `grep` sin `-a` tratara el archivo como
  binario.
- Todo `getElementById`/`$id` apunta a un `id` existente (íd.).
- **Toda función llamada está declarada** (íd.): un refactor puede
  eliminar un helper todavía en uso sin que `node --check` lo detecte
  (sigue siendo sintácticamente válido).

Las dos últimas requieren analizar el código, no el texto en bruto: un
barrido ingenuo contra comentarios en castellano llenos de paréntesis
daba 369 falsos positivos. `tests/statics.js` usa `maskCode` (borra
comentarios/cadenas/plantillas/regex conservando posiciones). Trampas:
un `${…}` dentro de una plantilla CONTIENE código con sus propias
cadenas (si no se recorre, `"cortado(s)"` se lee como llamada a
`cortado`); un getter (`get hasIssues()`) liga un nombre igual que una
declaración. Los globales del navegador van en lista explícita
(`GLOBALS`): depender de una API nueva es una decisión, no un
descuido.
