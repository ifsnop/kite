---
description: Botón 🔗 — descargar contenido de una URL arbitraria en dos pasos y añadirlo al árbol.
paths:
  - "src/js/40-panel-actions.js"
  - "src/index.html"
---

## Añadir desde una dirección (URL)

El botón 🔗 de la cabecera abre un diálogo que descarga una URL y la mete
en el árbol. Camino hermano de arrastrar; admite los mismos formatos.

- **DOS pasos, decisión de fondo**: lo que llega puede ser cualquier cosa
  (error, HTML, formato desconocido), así que primero se descarga y el
  diálogo dice QUÉ ha llegado (tipo, tamaño); solo entonces aparece
  «Añadir al árbol». Edición diferida como el resto de diálogos.
- Con la descarga hecha, «Descargar» se deshabilita (repetirla no aporta
  nada); tocar la dirección invalida el resultado y reactiva el botón
  (si no, se podría descargar A, escribir B y añadir A).
- **Cancelar en el acto**: el botón primario pasa a «Cancelar descarga»
  mientras descarga (no esperar los 20 s de tope). Cancelar deja el
  diálogo abierto con la dirección puesta, tono normal, sin aviso
  (acción explícita del usuario). Cerrar el diálogo / Escape también
  aborta.
- Todo lo descargado cuelga de una sección «Descargas» (como «Lugares»,
  «Marcadores»…, vía `ensureNamedSection`), y cada descarga en su propia
  «Descarga N» (`nextNumberedName`, deduce el máximo de los nombres ya en
  el árbol —incluidos pendientes—, nunca recicla). La carpeta es
  necesaria: sin ella dos descargas se mezclarían en la sección (GeoJSON
  crea envoltorio, KML vuelca jerarquía tal cual). Importa DENTRO de esa
  carpeta (`dropTargetUl`), tras `pushUndo`.
- Se envuelve en un `File` y se entrega a `handleDroppedFiles`: mismo
  camino de importación entero (formatos, diálogos, informe, guardado).
  Diálogo propio se cierra ANTES de llamarla (no se apilan).
- **Tipo por CONTENIDO, no extensión** (`sniffContentKind`): bytes
  primero (zip → KMZ, sin decodificar como texto), luego texto (`<kml>`
  con/sin prefijo, familia JSON por forma). `html` se reconoce solo para
  RECHAZARLO con mensaje claro (típico: pegar la página de GitHub en vez
  del enlace «Raw»).
- **Extensión sintetizada** (`downloadFileName`): `handleDroppedFiles`
  despacha por `file.name`, así que sin extensión útil lo descargado se
  autorrechazaría. Respeta la que traiga si cae en la misma rama; si no,
  añade la que toca (los tres tipos JSON comparten `.json`, esa rama
  vuelve a distinguir por forma). Invariante comprobado en Node: la
  extensión resultante siempre cae en una rama viva.
- **Fallo más probable: CORS**, llega como `TypeError` sin detalle (el
  navegador no cuenta por qué). El mensaje nombra la causa probable y
  ofrece la salida que funciona (descargar y arrastrar) — mismo criterio
  que `describeHttp`.
- **Dos cotas**: 20 s de respuesta, 100 MB (comprobado por
  `content-length` antes de leer y por cuenta real mientras llega, puede
  faltar o mentir). Lectura por trozos (`resp.body.getReader()`) permite
  cortar al pasarse, mostrar progreso y que cancelar sea inmediato.
- **Petición deliberadamente SIMPLE**: `credentials: "omit"`, sin
  cabeceras propias — cualquier cabecera no simple obliga a un
  *preflight* `OPTIONS` que la mayoría de alojamientos estáticos no
  contesta. No añadir cabeceras a esta petición sin pensarlo.
- No se tocó el pegado del árbol: la URL se pega dentro del campo del
  diálogo; el escucha de `paste` global tiene semántica delicada (corte,
  `clipboardText`, sus dos guardias — ver `multi-edit-clipboard.md`).
