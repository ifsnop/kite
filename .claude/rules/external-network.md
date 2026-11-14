---
description: Disciplina de peticiones de red externa (Nominatim, MDT/MDS, iconos empotrados).
paths:
  - "src/js/40-panel-actions.js"
  - "src/js/60-elevation.js"
  - "src/js/12-copernicus.js"
  - "src/js/63-route-profile.js"
  - "src/js/65-cadastre.js"
  - "src/js/67-wikipedia.js"
---

## Red externa

- Nominatim: `AbortController`/`AbortSignal.timeout` — búsqueda nueva o cerrar resultados cancela la anterior.
- **Servicios de elevación (WCS)**: solo los del catálogo `ELEV_SOURCES` (IGN y Digital Earth Africa), solo al pedirlo el usuario («Consultas › Elevación», «Obtener perfil»), con tope de peticiones/s (el perfil espera turno, `demRateWait`), `AbortSignal.timeout` POR INTENTO (con el `timeout` de la fuente si lo trae; combinado con la cancelación del perfil vía `AbortSignal.any`), **reintentos solo de lo pasajero** (`withElevRetries`: tiempo agotado, red, 429, 5xx; hasta 3, esperas 1-2-4 s) y descubrimiento una vez por sesión — ver `elevation-dem.md`. Digital Earth Africa responde 403 sin CORS a los navegadores Chromium (User-Agent con `Chrome/`); la página no puede evitarlo.
- **Todo servidor nuevo se añade al Anexo A del estudio de seguridad** (`docs/estudio-seguridad-kite-local.md`: proveedor, para qué, cuándo, qué se le envía); `tests/docs.js` falla si el código nombra uno que no está, o si el anexo conserva uno que ya no se usa.
- **Catastro (parcela bajo el clic)**: solo `ovc.catastro.meh.es` (RCCOOR y WFS INSPIRE), solo al pedirlo desde el menú contextual, petición simple, `AbortSignal.timeout` de 15 s por intento, hasta 2 reintentos de lo pasajero (`withElevRetries`), una excepción OGC nunca se reintenta, respuesta con tope de 5 MB leída por trozos — ver `cadastre.md`.
- **Wikipedia (artículos cercanos)**: solo `es.wikipedia.org` o `en.wikipedia.org` (API de MediaWiki, `origin=*`), solo al pedirlo desde el menú contextual, petición simple (`credentials: "omit"`), `AbortSignal.timeout` de 15 s por intento, hasta 3 reintentos de lo pasajero (`withElevRetries`; `cirrussearch-too-busy-error` llega dentro de un HTTP 200 y se reintenta), respuesta con tope de 2 MB leída por trozos — ver `wikipedia.md`.
- **Sin conexión**: el service worker (`offline.md`) NO toca ninguna petición de datos —Nominatim, WCS, catálogos, 🔗, teselas—; todo eso pasa de largo. Cuando una de ellas falla por `TypeError` con `navigator.onLine === false`, el mensaje dice «sin conexión a la red» (`netFailText`, `06-offline.js`) en vez de achacarlo a CORS o al servicio. Una petición NUEVA con ese `TypeError` debe pasar su texto genérico por `netFailText`.
- `describeHttp` traduce el estado HTTP a algo accionable (404 = dirección inexistente, 401 = falta autenticación, 429 = límite del servicio, 5xx = no disponible…).
- Descarga por URL: misma disciplina + tope de tiempo/tamaño, aborto por cancelación/cierre, lectura por trozos — ver `url-import.md`.
- **Los iconos ya NO son tráfico de ejecución** (van empotrados, ver `marker-icons.md`): fue la única consulta externa sin tope ni caché compartida (79 a la vez) y por eso reventó.
- **User WMS base layer: ONE `GetCapabilities` per address and session** (`fetchUserWmsCatalog`, `11-base-panel.js`; each user WMS layer has its own): `AbortSignal.timeout` of `CUSTOM_WMS_TIMEOUT` (15 s), no retries (same treatment as PNOA histórico and Copernicus: the user sees the reason in the selector and opens the panel again), the OGC error in the body before the HTTP status, and `netFailText` in the «no se pudo conectar» text. An answer for an address already changed, or for a layer already deleted, is discarded (`stale`): it does not overwrite the new catalog nor error.
- **Diagnosis of a failed tile of a user base layer** (`diagnoseTile`): ONE `fetch` of the tile per layer and session, with an `AbortSignal.timeout` of `TILE_DIAG_TIMEOUT`, no retries, only after a `tileerror`; without CORS it fails and the notice has no reason (see `base-maps.md`).
- **Servicio ArcGIS (MapServer)**: UNA consulta de catálogo (`?f=json`) por alta, desde el diálogo 🔗 (`URL_TIMEOUT`, cancelable, tope `ARCGIS_JSON_MAX`, `netFailText` en el texto de CORS); después, teselas `/export` como `<img>` (sin esta disciplina, ver abajo) y un `diagnoseTile` por capa y sesión con el `{error}` del cuerpo. Solo https y sin credenciales; la consulta de la dirección pegada (un `token`) se descarta. Ver `arcgis.md`.
- **Tiles (the user base layers' included) do not go through this discipline**: they are Leaflet `<img>` (`L.tileLayer`), not `fetch`, so there is no `AbortController`/time cap to apply — the retry mechanism is the generic one of any base layer (`tileerror`/`tileload`, `BASE_FAIL_TILES`, see `base-maps.md`). Only `https:` (CSP `img-src`, see `import-parsing.md`), the same rule as `connect-src`.
