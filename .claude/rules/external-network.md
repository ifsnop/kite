---
description: Disciplina de peticiones de red externa (Nominatim, MDT/MDS, iconos empotrados).
paths:
  - "src/js/40-panel-actions.js"
  - "src/js/60-elevation.js"
  - "src/js/12-copernicus.js"
---

## Red externa

- Nominatim: `AbortController`/`AbortSignal.timeout` — búsqueda nueva o cerrar resultados cancela la anterior.
- `describeHttp` traduce el estado HTTP a algo accionable (404 = dirección inexistente, 401 = falta autenticación, 429 = límite del servicio, 5xx = no disponible…).
- Descarga por URL: misma disciplina + tope de tiempo/tamaño, aborto por cancelación/cierre, lectura por trozos — ver `url-import.md`.
- **Los iconos ya NO son tráfico de ejecución** (van empotrados, ver `marker-icons.md`): fue la única consulta externa sin tope ni caché compartida (79 a la vez) y por eso reventó.
