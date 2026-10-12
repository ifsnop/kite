---
description: Suites de Playwright (tests/browser) — por qué existen, cómo se saltan si no hay navegador, y qué comprueban.
paths:
  - "tests/browser/**"
---

## Pruebas con navegador

Las suites de Node extraen funciones del `<script>` pero no pueden
comprobar que la app ARRANQUE, que los iconos empotrados se pinten,
que el minificado se comporte igual que el legible, o el portapapeles
del sistema entre instancias. Viven en `tests/browser/`.

- **Playwright, no puppeteer**: único que conduce el portapapeles de
  punta a punta; y `npm install` no trae navegador (puppeteer sí) —
  el navegador (~300 MB) va aparte, solo con
  `npx playwright install chromium` (o `npm run browser`).
- **Versión EXACTA, sin `^`: `playwright@1.61.1`** — última que corre
  en Node 18 (Ubuntu 24 LTS); 1.62 exige Node 20. `engines: >=18` no
  sirve para decidir (versiones que lo declaran luego se niegan).
- **Opcionales en local, OBLIGATORIAS en CI.** `npm test` detecta
  navegador lanzándolo de verdad (`_detect.mjs`). Sin navegador: se
  SALTAN y `npm test` sigue en verde. En CI, `KITE_REQUIRE_BROWSER=1`
  convierte el salto en FALLO.
- Sin poder descargar Chromium: `KITE_BROWSER=/ruta/al/chrome` usa uno
  ya instalado (o `channel: "chrome"`/`"msedge"`, Firefox/WebKit).
- **Se sirve por `http://`, nunca `file://`**: IndexedDB necesita
  origen real; dos puertos = dos orígenes, necesario para probar
  copiar/pegar entre instancias.
- **`tests/browser/app.mjs` compara legible vs. minificado**: si terser
  rompe algo, el legible pasa y el minificado no.
- **Se espera por CONDICIÓN, no por tiempo** (`openApp` aguarda a que
  `map` exista y el árbol esté resuelto) — nunca `waitForTimeout` fijo.
- Coste: lanzar navegador 99 ms, cargar app 528 ms, `evaluate` 9 ms.
  Las dos suites completas no llegan a unos pocos segundos.
