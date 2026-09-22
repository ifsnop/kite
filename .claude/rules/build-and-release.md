---
description: Fuentes y construcción (build.js), minificado para despliegue, SRI/dependencias externas, versión y proceso de release.
paths:
  - "build.js"
  - "package.json"
  - "src/index.html"
  - "scripts/hooks/**"
  - "fetch-icons.js"
  - ".github/workflows/**"
---

## Fuentes y construcción

```
src/index.html     plantilla: <head>, CSP, diálogos, <script> de CDN.
                   Dos marcadores: {{STYLES}} y {{SCRIPTS}}
src/styles.css     todo el CSS
src/js/*.js        20 archivos, en el orden del manifiesto de build.js
                   (el primero, 05-mdi-icons.js, es GENERADO)
build.js           concatena src/ → kitelocal.html, y minifica ese
                   resultado → kitelocal.min.html
fetch-icons.js     GENERA src/js/05-mdi-icons.js (npm run icons). A mano,
                   NO forma parte del build: es lo único que habla con
                   Iconify y construir debe ser reproducible y sin red
scripts/hooks/
  pre-commit       Sube BUILD y reconstruye SOLO cuando el commit toca
                   src/ o package.json. Tampoco forma parte de build.js
                   ni corre dentro de él: se instala con un symlink en
                   .git/hooks/pre-commit (ver «Versión y releases de
                   GitHub» y README.md, «Contributing»), que no se
                   versiona, así que hace falta enlazarlo a mano una vez
                   por clon
kitelocal.html     GENERADO. Es el producto; se versiona (quien clone
                   debe tener algo que abrir) y está marcado como
                   generado en .gitattributes para que los diffs se
                   plieguen y no tapen el cambio real en src/
kitelocal.min.html GENERADO a partir del anterior. Es lo que sirve
                   GitHub Pages (index.html redirige ahí). Se versiona
                   por lo mismo: Pages publica lo que hay en el
                   repositorio, sin construir nada
index.html         redirección de la raíz del sitio al minificado
```

- `npm run build` construye; `npm run watch` reconstruye al guardar; `npm run check` comprueba sin escribir; `npm test` lanza la batería.
- **`kitelocal.html` SÍ se versiona** aunque sea generado: es el producto, quien clone o descargue el archivo directo de GitHub debe obtener algo funcional sin Node. La comprobación de frescura (local + CI) evita la desincronización.
- **Conflicto de merge en `kitelocal.html` → no se resuelve a mano**: resolver `src/`, `npm run build`, añadir el resultado. Marcado `-diff` en `.gitattributes`.
- **El CI comprueba, no construye** (`npm run check` + `npm test`). Si reconstruyera, un push con `src/` cambiado y el archivo sin regenerar pasaría en verde publicando la versión vieja.
- **El orden del manifiesto `JS` en `build.js` es carga útil**: ámbito global compartido, dependencias de orden que `node --check` no detecta (ver punto 10 del checklist). Mover un archivo de sitio es un cambio de comportamiento potencial.
- `build.js` **valida el manifiesto en los dos sentidos**: archivo suelto sin declarar → se perdería en silencio; nombre declarado inexistente → aborta.
- **Concatenación, no módulos**: Chrome bloquea `<script type="module">` sobre `file://` por CORS y el producto debe abrirse con doble clic. Tampoco IIFE: el código comparte ámbito global a propósito (las pruebas de navegador acceden a esos símbolos directamente).
- **`String.replace` con función, no con cadena de reemplazo**: una cadena interpreta `$&`, `$1`, `$'`… del texto insertado como patrones (el propio código tiene `.replace(/…/g, "\\$&")`, que se corrompía). `build.js` usa una función de reemplazo.
- **Criterio de cualquier reorganización de `src/`: identidad byte a byte** de `kitelocal.html`. Si mover código no cambia ni un byte, no hay cambio de comportamiento que discutir.

## Minificado para el despliegue

`build.js` escribe `kitelocal.html` (legible, el producto) y `kitelocal.min.html` (derivada minificada, lo que sirve Pages).

- **Motivo medido**: Pages ya comprime (gzip). Minificar solo HTML/CSS apenas mueve la aguja (~5%, ruido contra gzip). Minificar también el JS sí: 460.123→213.605 bytes en disco, 150.765→66.285 comprimidos (**-56%**). Brotli no entra: Pages sirve `gzip` aunque se pida `br`.
- **No se minifica en su sitio (produciendo un solo archivo) porque 22 suites usan comentarios como marcadores** (`between("/* ===== Geodesia", …)`) sobre el archivo ENTREGADO; `removeComments` los borra. Reescribirlas para leer `src/` les quitaría la propiedad de probar lo que se entrega.
- **Dos opciones de `MINIFY_OPTS` son decisiones, no ajuste fino**:
  - `conservativeCollapse: true` — colapsa espacios a UNO, nunca a cero (hay `<strong>` en línea en `src/index.html` que se pegaría). Gratis contra gzip.
  - **No** `removeAttributeQuotes` ni similares: los atributos son carga útil (`integrity`+`crossorigin`, `<meta>` de CSP).
  - `minifyJS` (terser) con `mangle.toplevel: false` — nombres de nivel superior sobreviven, de eso depende el ámbito global compartido. Fijado por `tests/minified.js`.
- **Versión del minificador EXACTA en `package.json`, sin `^`**: `build.js --check` compara byte a byte; un cambio menor en la salida rompería el CI sin tocar `src/`.
- **`npm run watch` NO minifica** (lo dice al arrancar). `npm run build` antes de empujar; si se olvida, lo caza `npm run check`.
- **`tests/minified.js` no demuestra que la app funcione** (hace falta navegador, el CI es solo Node). Comprobación MANUAL obligatoria al tocar el minificado: cargar ambos artefactos en Chromium headless y comparar arranque, selector de iconos, aplicar icono, una medición con diálogo, escala y atribución.

## Dependencias externas

- Leaflet 1.9.4 (CSS+JS, unpkg) y JSZip 3.10.1 (cdnjs) llevan `integrity` (SRI) + `crossorigin`: el navegador verifica el hash antes de ejecutar, un CDN comprometido no puede colar otro contenido.
- **Al subir versión de librería, sustituir su hash** o el navegador bloquea el arranque. Se obtiene de la doc de Leaflet, el botón de copiar de cdnjs, o `curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`.
- El script empieza comprobando que `L` (Leaflet) existe, con aviso explicativo si no — este guardián va **lo primero del script**, antes de cualquier uso de `L`.
- Sin SRI: teselas/iconos PNG (`<img>` no lo admite) y respuestas de APIs REST (Iconify, Nominatim, IGN) — son datos, no código.

## Versión y releases de GitHub

Dos números, cadencia y origen distintos:

- **`BUILD`** (`src/js/10-map.js`, `AAAAMMDDHHMM`): reescrito por el hook `pre-commit` justo antes de `build.js`, solo si el commit toca `src/`/`package.json`. NO se hornea dentro de `build.js` — eso rompería la identidad byte a byte de `build.js --check` (`build()` debe seguir siendo función pura de lo que hay en disco). `.git/hooks/` no se versiona: el hook es un symlink que hay que enlazar a mano una vez por clon (README «Contributing»); sin él, `BUILD` se queda quieto y `npm run check`/CI lo detectan igual que cualquier fuente desincronizada. El hook también reconstruye (`npm run build`) y valida sintaxis (`node --check`) antes de dejar pasar el commit.
- **`VERSION`** (mismo archivo): versión semántica del release (`1.4.0`, sin `v`). Marcador `const VERSION = "{{VERSION}}";` que `build.js` sustituye por `package.json.version` AL CONSTRUIR (mismo mecanismo que `{{STYLES}}`/`{{SCRIPTS}}`) — a diferencia de `BUILD`, que el hook reescribe ANTES de invocar `build.js`. Cadencia: `VERSION` solo al preparar release (bump manual), `BUILD` en cada commit que toque `src/`. `package.json` es la ÚNICA fuente de la versión.

Proceso de release (creación del Release en sí sigue siendo decisión humana, no automatizada):

1. Ramas con PR a `main`.
2. Al reunir todos los PR de un release: **a mano**, subir `package.json.version`, actualizar versión en cabecera de los dos documentos de `docs/`, commitear (commit final del release). El hook de pre-commit ve `package.json` y se encarga de `BUILD` + `npm run build`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z` sobre ese commit — el tag debe coincidir EXACTAMENTE con `package.json.version`.
4. `.github/workflows/release.yml` (disparado por el push del tag) comprueba tag↔`package.json`, `npm run check`, y **que las 58 suites de `npm test` pasan** (con navegador, `KITE_REQUIRE_BROWSER=1`) — corren DENTRO de este job, no dependiendo de `tests.yml` (que se dispara aparte con el mismo push pero sin relación `needs`; antes un tag con tests en rojo podía publicarse porque `release.yml` nunca ejecutaba `npm test`). Si todo cuadra, publica el Release (notas automáticas, dos artefactos adjuntos). Si no, falla en rojo y no publica — hay que arreglar, borrar el tag y recrearlo sobre el commit correcto.

**El bump de versión es a mano, antes de tagear, no una Action tras crear el tag**: el tag se crea sobre la punta de `main`; si el bump fuera posterior, el tag apuntaría a un commit sin esa versión todavía, obligando a mover el tag (`-f`). Bumpear antes evita el problema.
