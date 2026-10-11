---
description: Disciplina de peticiones de red externa (Nominatim, MDT/MDS, iconos empotrados).
paths:
  - "src/js/40-panel-actions.js"
  - "src/js/60-elevation.js"
  - "src/js/12-copernicus.js"
  - "src/js/63-route-profile.js"
---

## Red externa

- Nominatim: `AbortController`/`AbortSignal.timeout` — búsqueda nueva o cerrar resultados cancela la anterior.
- **Servicios de elevación (WCS)**: solo los del catálogo `ELEV_SOURCES` (IGN y Digital Earth Africa), solo al pedirlo el usuario («Consultar elevación aquí», «Obtener perfil»), con tope de peticiones/s (el perfil espera turno, `demRateWait`), `AbortSignal.timeout` POR INTENTO (con el `timeout` de la fuente si lo trae; combinado con la cancelación del perfil vía `AbortSignal.any`), **reintentos solo de lo pasajero** (`withElevRetries`: tiempo agotado, red, 429, 5xx; hasta 3, esperas 1-2-4 s) y descubrimiento una vez por sesión — ver `elevation-dem.md`. Digital Earth Africa responde 403 sin CORS a los navegadores Chromium (User-Agent con `Chrome/`); la página no puede evitarlo.
- `describeHttp` traduce el estado HTTP a algo accionable (404 = dirección inexistente, 401 = falta autenticación, 429 = límite del servicio, 5xx = no disponible…).
- Descarga por URL: misma disciplina + tope de tiempo/tamaño, aborto por cancelación/cierre, lectura por trozos — ver `url-import.md`.
- **Los iconos ya NO son tráfico de ejecución** (van empotrados, ver `marker-icons.md`): fue la única consulta externa sin tope ni caché compartida (79 a la vez) y por eso reventó.
- **Teselas (Custom Maps incluido) no pasan por esta disciplina**: son `<img>` de Leaflet (`L.tileLayer`), no `fetch`, así que no hay `AbortController`/tope de tiempo que aplicar — el mecanismo de reintento es el genérico de cualquier capa base (`tileerror`/`tileload`, `BASE_FAIL_TILES`, ver `base-maps.md`). Solo `https:` (CSP `img-src`, ver `import-parsing.md`), igual criterio que `connect-src`.
