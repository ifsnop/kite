---
description: Por qué los iconos MDI van empotrados sin red, y cómo ampliar el catálogo con fetch-icons.js.
paths:
  - "src/js/05-mdi-icons.js"
  - "fetch-icons.js"
---

### Iconos de marcador: por qué van EMPOTRADOS

- **Ningún icono se pide por red en ejecución.** `MDI_ICON_BODIES` (`src/js/05-mdi-icons.js`) trae los cuerpos SVG en el propio archivo; `mdiSvg(name, color?, size?)` los envuelve en `<svg>`. Sin `color` deja el `currentColor` (lo tiñe `.mdi-pin` en el mapa); con `color` lo sustituye (un `<img>` suelto no hereda CSS). `iconUrl` devuelve un `data:` URI.
- **Motivo medido, no estético**: con `<img>` contra `api.iconify.design`, abrir el selector costaba 79 peticiones simultáneas (una URL distinta por marcador aplicado, sin caché compartida). Pasado el límite del servicio, el 429 se camuflaba como iconos rotos sin aviso útil (`ERR_BLOCKED_BY_ORB` en `<img>`, `TypeError: Failed to fetch` sin CORS en `fetch`, saltándose `describeHttp`) — no faltaba ningún icono, los 79 existen en `mdi`.
- **Coste**: ~21 KB de datos de trazado. A cambio, con red externa bloqueada: 80/80 iconos pintados, rejilla en 8,5 ms, `applyMarkerStyle` en 0,9 ms.
- **`applyMarkerStyle` es SÍNCRONA**: sin red no hace falta el contador de secuencia por nodo (`_mseq`) para descartar aplicaciones obsoletas ni el aviso de «no se pudo cargar». No volver a hacerla asíncrona sin razón nueva.
- **Icono desconocido no deja el marcador invisible**: `mdiSvg` devuelve `null` → `buildMarkerIcon` cae en la gota de Leaflet (salva árboles guardados con catálogo distinto al actual).
- **Para ampliar el catálogo**: añadir el nombre a `MDI_ICONS` (`41-selection.js`, lista que ve el usuario) y ejecutar `npm run icons` — lee esa lista, pide los cuerpos en UNA petición, regenera `05-mdi-icons.js`. Nombre inexistente en `mdi` → falla ahí mismo, no en ejecución. `tests/icons.js` comprueba sin red que catálogo/tabla están sincronizados, que los cuerpos son dibujables, y que no queda ninguna mención a `api.iconify.design`.
- `src/js/05-mdi-icons.js` se versiona y va marcado como generado en `.gitattributes` (igual que `kitelocal.html`): no se lee, un diff solo taparía el cambio real.
