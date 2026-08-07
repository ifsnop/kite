# Pruebas de KITE Local

Los tests **extraen las funciones del propio `visor-kml.html`** y las
ejecutan en Node, de modo que comprueban el código que se entrega, no una
copia que pueda quedarse atrás.

## Ejecutar

```bash
npm install linkedom @xmldom/xmldom     # una sola vez
node pruebas/run-all.js                   # toda la batería
node pruebas/run-all.js --bench           # además, las mediciones
node pruebas/navtest.js                   # una suite suelta
```

`run-all.js` empieza por un `node --check` del script incrustado y
después lanza cada suite. Devuelve un código de salida distinto de cero
si algo falla, así que sirve tal cual en un gancho de git.

## Qué cubre cada suite

| Fichero | Cubre |
|---|---|
| `kmltest.js` | Parseo de KML con prefijo, con espacio de nombres por defecto y sin ninguno; cadenas de `StyleMap` con ciclos; polígonos con agujeros; color `aabbggrr`. |
| `repairtest.js` | Reparación de prefijos XML sin declarar (el fallo real de un KML de Google Earth), incluido el coste sobre un archivo grande. |
| `clamptest.js` | Validación de coordenadas y tolerancia de redondeo: se ajusta `180.00000044181039`, se rechaza una latitud de 32400. |
| `utmtest.js` | UTM contra valores publicados, invariante del meridiano central, husos de Noruega y Svalbard, e ida y vuelta sobre una malla mundial. |
| `coordfmt.js` | Formato de coordenadas: grados decimales, GMS con espacios (campos editables) y GMS compacto en negrita (caja de coordenadas del visor), acarreo de segundos/minutos e ida y vuelta con `parseCoord`. |
| `elevtest.js` | Cliente WCS del IGN: elección de cobertura (malla de 5 m), de formato (`ArcGrid`), de CRS (3857), ejes por nombre, excepciones OGC y rejilla ASCII. |
| `navtest.js` | Recorrido del árbol, colapsos anidados, ámbito de Inicio/Fin, rangos con Mayús y flechas laterales. |
| `selcorrect.js` | Cursor único y `topLevelSelection` (lo contenido viaja con su ancestro). |
| `reporttest.js` | Informe de importación: cargados, omitidos, agrupación de causas y cuándo exige lectura. |
| `newfeat.js` | Saneado del HTML de las fichas, Ctrl+A en dos pasos y zonas de arrastre. |
| `topojsontest.js` | `topologyToGeoJson`: une los objetos con nombre de una topología en un único `FeatureCollection` (la conversión de arcos la prueba topojson-client, no nosotros). |
| `groundoverlaytest.js` | GroundOverlay: `parseLatLonBox` (límites, rotación, tolerancia de redondeo) y `resolveKmzEntry` (ruta exacta y por nombre de archivo suelto dentro del zip). |
| `bytesfmt.js` | `fmtBytes`: las cuatro unidades (bytes/KB/MB/GB) y sus límites de tramo. |
| `reordertest.js` | Orden de pintado: `bringLayerToFront` despacha por forma de la capa (`bringToFront`, `eachLayer` recursivo, `getElement`+`L.DomUtil.toFront`); `reorderPaintOrder` recorre el árbol y trae al frente solo las capas activadas, en su orden, reflejando un reordenamiento del DOM sin pasar por Leaflet real. |
| `pngnametest.js` | `pngTimestamp`: `YYYYMMDD-HHMMSS` con zero-padding en cada campo (mes, día, hora, minuto, segundo), medianoche como `000000`, y forma correcta al usar la hora actual por defecto. |
| `selbench.js` | Medición (no aserciones): coste de seleccionar miles de capas y de `topLevelSelection`. |

## Dependencias

- **linkedom** para DOM de HTML.
- **@xmldom/xmldom** para XML: linkedom no implementa espacios de nombres
  ni `getElementsByTagName("*")`, y las pruebas del parser darían falsos
  negativos.

## Convenciones

- Los mensajes de las aserciones describen **qué comportamiento** se
  espera, no en qué línea está; al fallar, el mensaje debe bastar para
  entender qué se ha roto.
- Cuando una prueba nace de un fallo real, el comentario lo dice: sirve
  para que nadie la "simplifique" sin saber qué protegía.
- Los tests extraen funciones sueltas por nombre, no rangos amplios de
  texto: extraer rangos arrastraba código con efectos secundarios.
