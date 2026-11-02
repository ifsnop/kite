# media/

Marca de KITE Local: el icono y las imágenes derivadas de él.

| Archivo | Para qué |
|---|---|
| `kite-icon.svg` | El icono original, 24×24, tal cual. Es la fuente de todo lo demás. |
| `favicon.svg` | El mismo dibujo escalado ×1,2 sobre su centro para llenar la casilla; a 16 px el original se queda pequeño dentro de su cuadrado. |
| `favicon.ico` | 16, 32 y 48 px en un solo `.ico` (con PNG dentro), para servirlo como `/favicon.ico` desde la raíz de un sitio. |
| `favicon-16.png`, `favicon-32.png` | Los mismos tamaños sueltos. |
| `apple-touch-icon.png` | 180×180 con fondo `#f7f7f5`: iOS no respeta la transparencia y pondría negro detrás. |
| `kite-icon-512.png` | El icono grande, por si hace falta un PWA o una tienda. |
| `kite-demo.gif` | El GIF de la portada del README: arrastrar un KMZ a la aplicación y verlo abierto (1100×700, unos 13 s, menos de 1 MB). Lo genera `tools/demo-gif.mjs`, no se toca a mano (ver abajo). |
| `kite-social.png` | 1200×630, la imagen de vista previa al compartir el enlace (`og:image` / `twitter:image`). |

## Cómo se enlazan

- **El favicon NO se enlaza desde aquí**: va incrustado como `data:` URI en
  `src/index.html`, porque el producto es un único archivo que se abre con
  doble clic y una ruta a `media/` no existiría junto a él. Si se cambia el
  icono hay que regenerar también esa URI.
- **La imagen social sí se enlaza por URL absoluta**, a `raw.githubusercontent.com`:
  ningún rastreador de redes sociales resuelve rutas relativas (la descargan
  desde sus propios servidores) ni dibuja SVG, así que tiene que ser un PNG
  con URL completa.

## Cómo se regeneran

**`kite-demo.gif`**: `npm run demo-gif` (hace falta red, por las teselas de OpenStreetMap; `-- --sin-fondo` para iterar el guion sin ella y `-- --fotogramas carpeta` para volcar cada fotograma como PNG y revisarlo). Arranca la aplicación limpia en inglés, «arrastra» `docs/ejemplos/operacion-sierra.kmz` con los mismos eventos `dragover` y `drop` que un archivo del escritorio (el cursor y el archivo que se ve moverse son dos elementos dibujados encima de la página: el navegador no deja a un script abrir una sesión de arrastre del sistema), y recorre lo que sale. Los fotogramas son capturas de la página, codificadas con una sola paleta de 255 colores y escribiendo solo los píxeles que cambian de un fotograma al siguiente. **Se regenera cuando cambia la interfaz que enseña** (caja de búsqueda, árbol, zona de soltar) y en cada release, junto con las capturas del manual.

**Los PNG** salen de rasterizar el SVG con Chromium (`--headless`), dibujándolo
sobre un `<canvas>` al tamaño exacto y leyendo `toDataURL`. Ojo: capturar con
`--screenshot` a ventanas pequeñas en esta VM sin GPU deja la imagen a medio
pintar; el camino del `<canvas>` sí es fiable.
