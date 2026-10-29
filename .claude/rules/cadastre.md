---
description: Parcela catastral desde el menú contextual — dos consultas al Catastro (RCCOOR + WFS INSPIRE), GML en ISO-8859-1, validación de lo recibido, capa normal del árbol con la ficha en las propiedades, repetidas, reintentos y trampas comprobadas.
paths:
  - "src/js/65-cadastre.js"
  - "tests/cadastretest.js"
  - "tests/browser/cadastre.mjs"
---

## Parcela catastral (`65-cadastre.js`)

«Parcela catastral» del menú contextual del visor (`CTX_MENU_ITEMS`, tras «Consultar elevación aquí») trae el polígono de la parcela bajo el puntero como una capa del árbol. Pedido por el usuario (mejora nº 7 de la lista de ideas); Dirección General del Catastro, solo territorio de régimen común (**País Vasco y Navarra tienen catastro propio y el servicio no responde por ellos**).

### Las dos consultas (comprobadas con curl, 29-10-2026; CORS `*` en ambas)

1. **`Consulta_RCCOOR`** (`ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx`): `SRS=EPSG:4326&Coordenada_X=<LONGITUD>&Coordenada_Y=<LATITUD>` (X es la longitud). Da la referencia (`pc1`+`pc2`, 14 caracteres) y la dirección (`ldt`). Sin parcela —vía pública, fuera de España— responde `<lerr><err><cod>16>` con HTTP 200: `parseRccoor` lo devuelve como `{ none: true }` y se avisa en tono info, no es un error. Una calle da «sin parcela» aunque haya fincas a unos metros: el punto tiene que caer DENTRO de la parcela.
2. **WFS INSPIRE `GetParcel`** (`ovc.catastro.meh.es/INSPIRE/wfsCP.aspx`, `STOREDQUERIE_ID=GetParcel&refcat=<rc>&srsname=EPSG::4326`): GML 3.2 con `cp:CadastralParcel`: `areaValue` (m²), `label`, `beginLifespanVersion`, `MultiSurface` › `PolygonPatch` › `exterior`/`interior` › `posList`. Una referencia que no existe, o un `srsname` que no entiende, llega como `ExceptionReport` con **HTTP 200**.

### Trampas que ya se pisaron o se previnieron

- **ISO-8859-1**: el WFS declara `encoding="ISO-8859-1"`; `Response.text()` decodifica siempre como UTF-8 y rompería las tildes de la dirección. Por eso `cadastreGet` lee BYTES (`readCapped`) y `decodeXmlBytes` mira la declaración.
- **Orden de ejes**: EPSG:4326 en GML es «lat lon»; GeoJSON es [lon, lat]. `parsePosList` los invierte, y **sin un `srsName` que acabe en `4326` no se coloca nada** (mejor error que una parcela frente a Somalia). `srsDimension` 2 o 3 (la altura se descarta); otro valor, error.
- **La referencia es una entrada ajena que acaba en una dirección** (`validRefcat`: `^[0-9A-Z]{14}$`, se pasa a mayúsculas): se valida al leerla del RCCOOR y otra vez al construir la URL del WFS.
- **Todo se valida antes de dibujar** (principio 5): números finitos, latitud ±90 y longitud ±180, `count` coherente con los valores, anillos de ≥ 4 puntos (uno sin cerrar se cierra), tope de `CADASTRE_MAX_VERTICES` (20 000) y de `CADASTRE_MAX_BYTES` (5 MB, contado por trozos). Lo inválido lanza; nada llega a Leaflet.
- **Una excepción OGC lleva `owsCode`**, que es lo que `isRetryableElevError` mira para NO reintentarla.

### Disciplina de red (`external-network.md`)

Petición SIMPLE (`credentials: "omit"`, sin cabeceras propias: nada de *preflight*, ver `url-import.md`), `AbortSignal.timeout(CADASTRE_TIMEOUT)` por intento (15 s), `withElevRetries` con 2 reintentos (esperas 1-2 s) solo de lo pasajero, errores por `describeHttp`, y `netFailText` en un `TypeError`. Solo al pedirlo el usuario; nunca al mover el ratón ni al arrancar. Sin aviso de «consultando» ni de éxito: la señal es el cursor de espera (`.cadastre-busy`, misma regla CSS que `.elev-busy`) y el resultado es la capa.

### En el árbol

- Una capa NORMAL (`t: "layer"`): `L.geoJSON(feature)` con las propiedades en el `Feature`, así que la ficha («Mostrar atributos», ℹ) es la tabla de propiedades de siempre y guardado, deshacer, exportar y copiar la tratan como a cualquier GeoJSON. **No sube `TREE_SCHEMA` ni `DB_VERSION`.**
- Sección raíz «Catastro» (`ensureNamedSection`), nombre «Parcela <referencia>». `pushUndo("consultar parcela catastral")` solo cuando ya hay algo que añadir. **La vista no se mueve.** Estilo naranja de relleno suave (`#e65100`), editable como cualquier polígono.
- **Las claves de la ficha** («Referencia catastral», «Dirección», «Superficie catastral (m²)», «Etiqueta», «Fecha de alta») salen en el idioma del momento y se guardan tal cual, como cualquier nombre creado (regla 8 de `i18n.md`). Lo que no hay no se escribe.
- **Repetir**: `cadastreKeys` (referencia → fila, SOLO de la sesión, como `elevSessionKeys`) evita pedir el polígono otra vez y señala la fila (`highlightNode` + `blinkLayer`). Siempre se pregunta antes la referencia (una petición): es lo único que dice qué parcela es. Tras recargar el mapa vuelve a poder pedirse una parcela ya guardada (duplicaría la fila): no se busca en el árbol por propiedades, ni un nombre sirve (el usuario lo renombra).
- Atribución «© Dirección General del Catastro» (`CADASTRE_ATTRIB`), añadida la primera vez de la sesión; es un crédito de proveedor y va en `KEEP` de `tests/i18n.js`.
- **No depende del giro del mapa** (a diferencia de la elevación): consultar un punto es una petición de un punto.

### Pruebas

`tests/cadastretest.js` (lo puro, con las respuestas REALES de `tests/fixtures/catastro-*.xml` más casos sintéticos y hostiles) y `tests/browser/cadastre.mjs` (menú real, servicio simulado con `page.route`). **Trampa de la suite de navegador**: borrar una fila a mitad de su parpadeo (`blinkLayer`, 600 ms) deja que el último paso vuelva a poner su capa en el mapa; `blinkLayer` no cancela su temporizador al borrar (latente, fuera de este cambio). La suite espera a que no quede ningún `_blinkTimer` antes de borrar.
