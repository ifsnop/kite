# Manual de usuario de KITE Local

### KML Interactive Tree Explorer — versión v1.4.0 (202609221811)

Este manual da por hecho que KITE Local ya está desplegado y abierto en el navegador (como archivo local con doble clic, o servido desde una dirección web): no trata la instalación, sino el manejo diario de la aplicación. Todas las capturas de este documento corresponden a una sesión de ejemplo con datos ficticios (una zona de operación y unos sensores cerca de Madrid), usada solo para ilustrar cada función.

---

## Índice

1. [Idea general y estructura de la ventana](#1-idea-general-y-estructura-de-la-ventana)
2. [El panel de navegación](#2-el-panel-de-navegación)
3. [El árbol de capas](#3-el-árbol-de-capas)
4. [El panel del visor (el mapa)](#4-el-panel-del-visor-el-mapa)
5. [El menú contextual del visor](#5-el-menú-contextual-del-visor)
6. [Estilos de capa](#6-estilos-de-capa)
7. [Cómo hacer las tareas más habituales](#7-cómo-hacer-las-tareas-más-habituales)
8. [Atajos de teclado](#8-atajos-de-teclado)
9. [Qué se guarda y dónde](#9-qué-se-guarda-y-dónde)

---

## 1. Idea general y estructura de la ventana

KITE Local reparte la pantalla en dos zonas, separadas por una barra que se puede arrastrar para darle más sitio a una u otra:

- **El panel de navegación**, a la izquierda: el árbol de capas cargadas, con sus carpetas, y todos los controles para buscar, importar, ordenar y organizar esa información.
- **El panel del visor**, a la derecha: el mapa, con la cartografía de fondo y todas las capas que estén activas.

Un botón con una flecha (◀ / ▶), en el borde entre ambos, oculta o vuelve a mostrar el panel de navegación por completo, para quien quiera ver el mapa a pantalla completa un momento sin perder lo cargado.

![Vista general de KITE Local, con el panel de navegación a la izquierda y el visor a la derecha](img/01-vista-general.png)
*Figura 1. Vista general: panel de navegación (árbol con dos zonas, dos puntos de interés y una capa de sensores) y visor con la cartografía de fondo.*

Una idea recorre toda la aplicación: **la vista del mapa es del usuario y nadie la toca sin que se pida**. Cargar un archivo nuevo, por grande que sea, no mueve el encuadre ni cambia el zoom; para eso están los botones de encuadre que se describen más adelante. Del mismo modo, ningún diálogo aplica un cambio hasta que se pulsa «Aceptar»: se puede abrir el estilo de una capa, probar colores y tamaños, y cerrar con «Cancelar» sin que nada de lo probado llegue a aplicarse.

---

## 2. El panel de navegación

### 2.1 Cabecera

En la parte superior están el título de la aplicación y cuatro botones de alcance general, además del buscador de lugares y los controles de carpetas.

![Cabecera del panel de navegación, con sus botones y el buscador de lugares](img/02-cabecera-panel.png)
*Figura 2. Cabecera del panel: botones generales, buscador de lugares, creación de carpetas y los tres botones de activación masiva. Debajo, el aviso de la última carga.*

- **🔗 Añadir desde una dirección**: descarga un archivo desde una dirección web y lo incorpora, con el mismo tratamiento que si se hubiera arrastrado desde el disco. Se explica con detalle en el apartado 7.
- **🏷️ Propiedades**: abre un panel con dos pestañas. La primera, «Preferencias» —la que se ve al abrir—, reúne los ajustes generales de la aplicación: la **unidad de medida** (metros, kilómetros, pies, millas o millas náuticas, ver apartado 6.3), el **formato de latitud/longitud** (grados decimales o grados-minutos-segundos) y el tope de vértices editables interactivamente (apartado 6.2). La segunda, «Índices de GeoJSON», recuerda las asociaciones entre la forma de un archivo GeoJSON (qué claves trae) y la propiedad que se usa como nombre de cada elemento, y permite revisar, cambiar o borrar esas asociaciones; con un archivo que traiga muchas asociaciones guardadas, esa lista tiene su propio scroll interno en vez de agrandar la ventana. A diferencia de otras ventanas de configuración de versiones anteriores, este panel sí lleva Cancelar y Aceptar: los cambios se ven al momento en cualquier diálogo abierto (una previsualización), pero solo quedan guardados —y sobreviven a cerrar y volver a abrir la aplicación— al pulsar «Aceptar». «Cancelar» los deja exactamente como estaban.
- **📋 Registro de avisos**: abre el historial completo de avisos de la sesión en curso —cargas, advertencias, confirmaciones—, incluidos los que ya han desaparecido solos del panel. Un punto sobre el botón indica que hay avisos nuevos sin leer.
- **? Ayuda**: abre la chuleta de atajos de teclado (apartado 8), la misma que se abre con la tecla `?`.
- **Buscar un lugar y añadir marcador…**: un buscador de topónimos apoyado en el servicio Nominatim de OpenStreetMap. Se consulta solo al pulsar «Buscar» o la tecla Intro, nunca mientras se escribe. Los resultados aparecen debajo, dentro de la propia cabecera —empujando el árbol hacia abajo, no flotando encima— y se cierran con su «×»; elegir uno crea un marcador en una carpeta «Lugares» y centra la vista sobre él.
- **Nombre de carpeta / Nueva carpeta**: crea una carpeta vacía en el árbol, lista para arrastrar capas dentro o para servir de destino de una importación.
- **Activar todo / Desactivar todo / Colapsar todo**: actúan sobre el árbol completo. Activar y desactivar cambian de golpe la visibilidad de todas las capas; colapsar cierra todas las carpetas.

![Buscador de lugares desplegado, con dos resultados para "Toledo, España"](img/18-buscador-lugares.png)
*Figura 3. El buscador de lugares, con sus resultados desplegados dentro de la propia cabecera.*

Justo debajo aparecen los avisos de la sesión (en el color normal del texto si son solo información, en rojo si señalan un problema), con fecha y hora completas; uno que se repite no añade una línea nueva, funde con la anterior y la marca con un contador (×N). Un resumen de importación se queda fijo en pantalla hasta que se pulsa «Aceptar», precisamente para dar tiempo a leer qué se cargó y qué no. El botón 📋 de la cabecera abre el mismo historial completo, con todo lo ocurrido en la sesión aunque ya haya desaparecido del panel.

![Registro de avisos de la sesión, con las tres cargas de ejemplo de este manual](img/20-registro-avisos.png)
*Figura 4. Registro de avisos: todo lo ocurrido en la sesión, del más antiguo al más reciente, con los que exigían confirmación marcados con «!».*

### 2.2 Zona para soltar archivos

Debajo del árbol hay una franja que indica qué se puede soltar ahí: archivos KML y KMZ (incluidas las ortofotos que traiga incrustadas), JSON, GeoJSON y TopoJSON, o una carpeta previamente exportada por la propia aplicación (extensión «.kite.json»). Arrastrar cualquiera de esos archivos desde el escritorio y soltarlo sobre el panel —o sobre una carpeta concreta del árbol, para importar dentro de ella— es la vía más directa de cargar información.

### 2.3 Buscador del árbol

Al pie del panel hay un segundo buscador, distinto del de lugares: busca por nombre entre las capas y carpetas ya cargadas, en vivo mientras se escribe (a partir de tres letras, para no recorrer árboles grandes en cada pulsación). Las flechas ↑ / ↓ de su lado saltan a la ocurrencia anterior o siguiente, y un contador indica cuántas hay.

### 2.4 Pie del panel

Al final del todo, dos cifras: cuánto ocupa en disco lo guardado por la aplicación y cuánta memoria está usando la pestaña del navegador. Cualquiera de las dos desaparece sola cuando no hay un dato fiable que mostrar (por ejemplo, la memoria no puede medirse al abrir la aplicación con doble clic desde el disco, solo cuando se sirve desde una dirección web).

---

## 3. El árbol de capas

El árbol es el inventario de todo lo cargado: cada archivo, carpeta, capa, medición o cuadrícula de elevación es una fila. Refleja fielmente la estructura del archivo de origen: un KML vuelca sus carpetas tal cual las traía, y un GeoJSON —que no tiene jerarquía propia— se agrupa dentro de una carpeta con el nombre del archivo.

![El árbol de capas desplegado, con dos carpetas de un KML y una carpeta de un GeoJSON](img/03-arbol-estructura.png)
*Figura 5. Estructura del árbol: dos carpetas del KML importado («Zonas» y «Puntos de interés»), una capa de línea suelta y, más abajo, la carpeta que agrupa un GeoJSON importado.*

### 3.1 Qué lleva cada fila

- Una flecha (▾ / ▸) para desplegar o colapsar, solo en carpetas y archivos.
- Una casilla que activa o desactiva la capa en el mapa. Es la única que decide la visibilidad: la casilla de una carpeta es un interruptor masivo para todo lo de dentro, nunca un filtro por sí sola.
- Un cuadradito de color, en las capas que lo tienen, con el color con el que se dibuja.
- El nombre. Un clic sobre el nombre selecciona la fila; para renombrar hace falta `F2` o el diálogo de propiedades (apartado 8), no un doble clic sobre el texto.
- Unos botones de acción, que solo aparecen al pasar el ratón por encima de la fila (para no ocupar sitio permanentemente) y cambian según el tipo de nodo.

### 3.2 Los tres estados de una casilla

La casilla de una carpeta o un archivo puede estar marcada, sin marcar o **indeterminada** —un guion, no un cuadrado— cuando parte de lo que contiene está activo y parte no. Es el mismo indicador que usa cualquier gestor de archivos para una selección mixta.

![Una carpeta con la casilla indeterminada porque una de sus capas está desactivada](img/05-checkbox-indeterminado.png)
*Figura 6. La carpeta «Zonas» y la carpeta raíz quedan en su tercer estado (guion) al haber desactivado solo «Zona B».*

Al activar o desactivar una carpeta con muchas capas dentro, la casilla se sustituye brevemente por un pequeño indicador giratorio y el nombre parpadea mientras el cambio se aplica a todas; sobre el visor aparece además un aviso «Actualizando capas…», junto al control de zoom. Es solo para que quede claro que el cambio está en marcha —con una carpeta pequeña ni se llega a notar— y evita tener que pulsar otra vez pensando que no ha pasado nada.

### 3.3 Botones de acción por tipo de fila

Al pasar el ratón por una fila aparecen, según lo que sea:

- **En una carpeta o un archivo**: seleccionar todas sus capas (☑) o quitar la selección (☐), ordenar alfabéticamente (AZ, que alterna ascendente y descendente), colapsar la carpeta y todas las de dentro, y guardarla en un archivo aparte (💾).
- **En una capa**: centrar la vista y acercar el zoom a un nivel fijo (🔍), y abrir su diálogo de estilos (🎨). Sobre un polígono o una medición, en vez de un zoom fijo, encuadra toda su geometría con un margen alrededor —más útil para una figura o una ruta que puede ser mucho más grande, o más alargada, que lo que cabría en un solo nivel de zoom centrado.
- **Si la capa tiene una ficha o propiedades que enseñar**: un botón adicional (ℹ) para verlas.
- **En cualquier fila**: subir (↑) y bajar (↓) un puesto entre sus hermanas, y borrar (×).

![Una fila seleccionada, con sus botones de acción visibles al pasar el ratón](img/04-fila-seleccionada-acciones.png)
*Figura 7. La fila «Zona A», seleccionada (borde discontinuo) y con el ratón encima: aparecen sus botones de enfoque, estilo, subir/bajar y borrar. No tiene botón ℹ porque este polígono no trae ninguna ficha.*

### 3.4 Selección múltiple

Adem del clic normal (que selecciona una única fila y mueve el cursor del teclado hasta ella), `Mayús + clic` extiende la selección a todo lo que hay entre la fila donde estaba el cursor y la que se pulsa —igual que en un explorador de archivos de escritorio—, y `Ctrl + Mayús + clic` añade o quita una sola fila suelta sin arrastrar las intermedias.

![Dos filas seleccionadas a la vez con Mayús+clic](img/06-seleccion-multiple.png)
*Figura 8. «Base» y «Punto de control» seleccionadas juntas con `Mayús + clic`. Los cambios de estilo, el borrado o el arrastre se aplican después a las dos a la vez.*

Con una selección múltiple, borrar, arrastrar y cambiar el estilo actúan sobre todas las filas a la vez. Solo la posición de un marcador queda fuera de la edición conjunta, por ser un dato propio de cada uno.

Al quedar seleccionados varios nodos —con `Mayús + clic`, `Ctrl + Mayús + clic` o el botón ☑ de una carpeta— aparece en la ventana de avisos cuántos son en total. Es solo informativo (no es ningún error) y sirve, por ejemplo, para saber de un vistazo cuántas capas hay dentro de una carpeta al marcarla entera con ☑.

### 3.5 Mover capas de sitio

Arrastrar una fila con el ratón la mueve de carpeta o cambia su orden entre hermanas; una franja de seis píxeles arriba o abajo de cada fila reordena, y soltar sobre el resto de una carpeta mete dentro. `Escape` cancela un arrastre en marcha. También puede recolocarse tecleando: seleccionar la fila, pulsar `Ctrl + X` para cortarla (queda marcada en gris hasta que se pega o se cancela con `Escape`), poner el cursor en el destino y pulsar `Ctrl + V`.

---

## 4. El panel del visor (el mapa)

### 4.1 Mapas base

Un icono de capas, en la esquina superior derecha del mapa, despliega el panel de cartografías de fondo: OpenStreetMap, varias capas del Instituto Geográfico Nacional (mapa base, topográfico, ortofoto PNOA actual e histórica, modelo digital del terreno), un par de opciones de relieve sombreado y, bajo credencial propia del usuario, el modelo de superficie de Copernicus. Se pueden combinar varias a la vez, cada una con su propio control de opacidad, y reordenarse con las flechas de cada fila (el orden de la lista es el orden de apilado en el mapa).

La primera fila del panel no es un mapa, sino el color de fondo del propio visor: el que se ve detrás de las teselas, en un hueco sin cobertura o en el borde del mundo. Por defecto es el mismo azul claro de siempre; su muestra de color abre el mismo selector integrado que los colores de una capa (apartado 6.1) y el cambio se recuerda entre sesiones.

![Panel de mapas base desplegado, con OpenStreetMap activa y el resto disponibles](img/07-mapas-base.png)
*Figura 9. Panel de mapas base: primera fila para el color de fondo, y debajo cada mapa con su casilla de activación, control de opacidad y flechas de orden. La rueda dentada junto a Copernicus DEM abre su configuración de credencial.*

### 4.2 Barra de herramientas de dibujo y medición

En la esquina superior izquierda del mapa hay dos barras verticales.

La primera reúne las herramientas que dibujan sobre el mapa:

- **Medir ruta** (⤳): un clic por cada waypoint, doble clic para terminar — como varias líneas encadenadas, con la distancia y el rumbo de cada tramo por separado y el total. Una ruta de solo 2 waypoints es una línea recta de toda la vida; con más, sirve para planificar un trayecto con varias escalas.
- **Medir círculo** (◯): arrastrar del centro al borde calcula el radio y la superficie.
- **Dibujar polígono o línea** (⬠): un clic por cada vértice; un doble clic sobre el último vértice cierra la figura, y un doble clic fuera de un vértice la deja como una línea abierta. Mientras se dibuja, un vértice ya puesto se puede arrastrar a otra posición antes de cerrar la figura, y quitar con el botón derecho.
- **Crear un pin** (📍): añade un marcador en el centro de la vista actual y abre directamente su diálogo de estilo.
- **Exportar PNG** (📷): guarda una imagen del mapa tal como se ve, sin los controles superpuestos, pero con el cuadro de coordenadas, la escala y la atribución (que la licencia de la cartografía exige conservar).

La segunda barra reúne los controles de la propia vista:

- **Autoescalar** (⤢): ajusta el zoom para encuadrar todo lo cargado.
- **IB / GC**: centran la vista en la península y Baleares, o en las islas Canarias.
- **Modo altura** (⛰): activa la consulta de la altitud del terreno (y de la superficie) bajo el cursor, contra los servicios del Instituto Geográfico Nacional; solo tiene cobertura sobre España y necesita conexión. Un segundo botón, junto a él, cambia la unidad de esa lectura entre metros y pies.
- **Paralelos y meridianos** (#): muestra u oculta la retícula geográfica.

### 4.3 Cuadro de coordenadas, escala y atribución

En la esquina inferior izquierda, un cuadro de texto sigue al cursor mostrando la posición en tres notaciones a la vez (grados decimales, grados/minutos/segundos y coordenada UTM con su huso) y el nivel de zoom actual. Con el modo altura activo se le añaden las lecturas de terreno y de superficie, junto con la diferencia entre ambas.

![Cuadro de coordenadas con el modo altura activo, mostrando terreno y superficie](img/21-modo-altura.png)
*Figura 10. Cuadro de coordenadas con el modo altura activo: zoom, las tres notaciones de posición y, al final, las lecturas de terreno (MDT) y superficie (MDS) del IGN, con la diferencia entre ambas.*

En la esquina inferior derecha están la escala gráfica y, debajo, la línea de atribución (versión de la aplicación, enlace al repositorio y crédito de la cartografía activa).

---

## 5. El menú contextual del visor

Un clic derecho sobre el mapa abre un menú con las acciones más habituales: copiar las coordenadas del punto, activar el modo altura, las tres herramientas de dibujo, crear un pin, exportar a PNG, y los distintos encuadres y la retícula.

![Menú contextual genérico, sobre una zona del mapa sin ninguna capa debajo](img/08-menu-contextual-generico.png)
*Figura 11. Menú contextual sobre una zona vacía del mapa.*

Si el clic derecho cae sobre una capa, el menú antepone «Ir al nodo en el panel» (que despliega el árbol hasta esa fila, la selecciona y la hace parpadear en el mapa para identificarla), «Mostrar propiedades» si la capa tiene algo que mostrar (la ficha KML o la tabla de propiedades de un GeoJSON, la misma que el botón ℹ) y, si su tipo admite el diálogo de estilos, **«Editar propiedades»**, que lo abre directamente —el mismo diálogo que el botón 🎨 o Alt+Intro, sin tener que ir antes al árbol—. Cuando hay varias capas superpuestas exactamente bajo el cursor, estas opciones se convierten en un submenú con una entrada por capa, para elegir sobre cuál de todas se quiere actuar.

![Menú contextual con un submenú, al haber dos zonas superpuestas bajo el cursor](img/09-menu-contextual-submenu.png)
*Figura 12. Con «Zona A» y «Zona A (ampliación)» superpuestas en ese punto, «Ir al nodo en el panel» se convierte en un submenú con una entrada por cada una.*

---

## 6. Estilos de capa

El botón 🎨 de una fila (o de cualquiera de una selección múltiple) abre un diálogo flotante con el estilo de esa capa. El diálogo no aplica nada hasta que se pulsa «Aceptar»; «Cancelar» descarta cualquier cambio probado, incluido un icono distinto. El diálogo se puede arrastrar por su título para apartarlo de la zona del mapa que interese, y no bloquea el resto de la interfaz: se puede seguir trabajando en el mapa mientras está abierto.

Cada muestra de color del diálogo (marcador, texto, contorno, relleno…) abre, justo debajo de sí misma, un selector con el espectro, una paleta de colores habituales y sus propios botones «Cancelar»/«Aceptar». Sobre el cuadrado se elige tono y saturación con el cursor en forma de cruz; sobre la rampa horizontal de matiz, con el cursor en forma de mano, porque ahí solo se desliza en una dirección. Mover el espectro, tocar una muestra o escribir un valor previsualiza el color al momento sobre el elemento editado (el marcador y su icono, o el fondo del mapa en el panel de mapas base), pero no lo confirma: solo «Aceptar» lo deja hecho, y «Cancelar» —igual que repetir la muestra que abrió el selector, un clic fuera o Escape— lo devuelve al color que tenía al abrirlo. Los valores se escriben en cuatro notaciones intercambiables con las flechas ‹ › junto a su nombre: hexadecimal (un campo), RGB o HSV (tres campos, uno por componente) y CMYK (cuatro), cada uno con su propio control numérico de subida/bajada.

### 6.1 Estilo de un marcador

Icono, color y tamaño del marcador; tamaño y color del texto; si el nombre se muestra siempre o solo al pulsar sobre el marcador; y, cuando la capa es un único marcador, su posición exacta, en el formato elegido en el panel 🏷️ Propiedades (apartado 2.1) — grados decimales o grados/minutos/segundos, el mismo ajuste global que usa el centro de un círculo de medición. Mientras el diálogo está abierto, el propio marcador puede arrastrarse por el mapa para ajustar su posición a mano.

![Diálogo de estilo de un marcador, con icono, colores, tamaños y posición](img/10-estilo-marcador.png)
*Figura 13. Estilo de la capa «Base»: icono, color y tamaño del marcador, tamaño y color del texto, y sus coordenadas.*

El botón «Cambiar…» junto al icono abre el catálogo completo de iconos disponibles (banderas, estrellas, círculos numerados, aviación, barco, transporte, figuras geométricas y más), con la gota clásica de Leaflet siempre la primera.

![Selector de iconos, con la gota de Leaflet y varias categorías de iconos](img/11-selector-iconos.png)
*Figura 14. Catálogo de iconos: la gota clásica al frente y, debajo, las categorías temáticas.*

### 6.2 Estilo de un polígono o una línea

Ancho y color del contorno; un selector de tres opciones —contorno y relleno, solo contorno o solo relleno— en vez de dos casillas sueltas, porque «ni una cosa ni la otra» no es una combinación que tenga sentido ofrecer; color y opacidad del relleno; si el nombre se muestra siempre; y, en modo de solo lectura, el perímetro y el área en la unidad elegida. Un botón «Ver y editar…» abre además la lista completa de vértices como texto (uno por línea, con latitud, longitud y altitud separadas por tabulador), pensada para poder copiarla y pegarla directamente en una hoja de cálculo.

![Diálogo de estilo de un polígono, con contorno, relleno y medidas](img/12-estilo-poligono.png)
*Figura 15. Estilo de «Zona A»: modo de contorno/relleno, colores, medidas de solo lectura y acceso al editor de vértices.*

![Editor de la lista de puntos de un polígono, en formato de texto tabulado](img/13-editor-puntos.png)
*Figura 16. Lista de vértices de «Zona A», lista para copiarse a una hoja de cálculo.*

Una figura abierta (una línea, no un polígono cerrado) no tiene superficie que rellenar: sus controles de relleno aparecen entonces deshabilitados en vez de ocultos, para que se note que existen pero no aplican a ese caso.

Además del editor de texto, sus vértices se pueden mover, borrar, seleccionar e insertar directamente sobre el mapa — **con este diálogo abierto para ese polígono, y solo entonces**: sin él, ni un clic, ni arrastrar, ni el botón derecho hacen nada sobre ningún vértice, y un vértice sin diálogo abierto se ve como un círculo blanco pequeño que no cambia el cursor al pasar por encima (con el diálogo abierto, crece y el cursor pasa a una cruz de mover). Con el diálogo abierto: un clic sobre un vértice lo selecciona, arrastrarlo lo mueve (no hace falta ninguna tecla), el botón derecho lo quita (sin poder bajar de 3 vértices en un contorno cerrado, o de 2 en una línea abierta) y `Mayús` + clic en cualquier otro punto del mapa —o la tecla `Insertar`, sin necesitar hacer clic, pero en la posición ACTUAL del ratón sobre el mapa— inserta uno nuevo justo después del seleccionado —o al final, si no hay ninguno—, con el cursor cambiando a una flecha con un signo de más mientras se mantiene `Mayús` pulsado. Con el ÚLTIMO vértice seleccionado, `Mayús` + clic sobre el manejador del PRIMERO cierra una línea abierta (sin añadir ningún vértice nuevo); y borrar el vértice que dejaría un contorno cerrado por debajo de 3 lo abre en línea en vez de bloquear el borrado —un contorno cerrado con más de 3 vértices nunca se abre borrando, sea cual sea el vértice que se borre—. La tecla `Supr` borra el vértice seleccionado con prioridad sobre borrar la capa entera. Cada cambio se aplica al momento sobre el mapa, y las medidas de solo lectura de este mismo diálogo se actualizan en vivo, pero **«Cancelar» revierte todos los cambios de vértice hechos mientras el diálogo estuvo abierto** —mover, insertar, borrar, cerrar o abrir la forma—, igual que el resto de campos del diálogo; solo «Aceptar» los deja. Cerrar el diálogo apaga además la edición: los vértices dejan de responder a nada.

Las dos formas de editar los vértices —el texto y el mapa— muestran la misma lista de puntos, así que no conviven: mientras «Ver y editar…» esté abierto, la edición sobre el mapa se desactiva (para no dejar el texto ya escrito desactualizado si se moviera un vértice por debajo), y vuelve sola al cerrar esa ventana.

Con una figura de muchísimos vértices esta edición interactiva no se activa, y solo queda disponible el editor de texto: un aviso explica cuántos vértices tiene la capa y cuál es el tope vigente. Ese tope (500 de partida) depende del equipo de quien lo usa, así que es ajustable: botón 🏷️ de la cabecera → pestaña «Preferencias» → «Tope de vértices editables».

Mientras el diálogo de un polígono está abierto, el doble clic sobre el mapa no hace zoom —de lo contrario, insertar dos vértices seguidos con `Mayús` + clic podría dispararlo sin querer—; vuelve a funcionar con normalidad al cerrar el diálogo.

### 6.3 Estilo de una medición

Igual que un polígono en cuanto a trazo y relleno, pero con sus medidas propias en modo de solo lectura: un círculo muestra **radio, área y las coordenadas de su centro**; una ruta, la distancia total y la de cada uno de sus tramos por separado, numerados «Tramo 1», «Tramo 2»… (una ruta de solo 2 waypoints muestra un único tramo, con su distancia y su rumbo — el equivalente de la antigua «línea»). Una casilla «Mostrar las etiquetas de distancia y rumbo» permite ocultar esas etiquetas sobre el mapa sin borrar la medición, para despejar la vista cuando hay varias mediciones juntas o se va a exportar una imagen del mapa; se muestran por defecto. Un botón «Ver y editar…», igual que en un polígono (apartado 6.2), abre la lista de waypoints como texto tabulado: un círculo siempre con dos (centro y borde), una ruta con los que tenga (mínimo 2). **También aquí manda la misma regla que en 6.2, con «Cancelar» incluido**: mover el centro o el borde de un círculo, o un waypoint de una ruta —los tres, arrastrando sin más, ya no hace falta ninguna tecla— y, en una ruta, seleccionar, borrar e insertar waypoints igual que los vértices de un polígono, `Insertar` incluido, solo funciona con este diálogo abierto para esa medición; sin él, sus manejadores se ven como un punto pequeño sin cursor propio (con el diálogo abierto crecen y el cursor cambia a una cruz de mover, y ese aspecto se conserva aunque se apague y encienda la visibilidad de la capa mientras tanto), y el botón derecho abre el menú contextual normal en vez de borrar. Con el diálogo abierto, arrastrar actualiza estas cifras al momento, sin necesidad de cerrarlo y volver a abrirlo, y «Cancelar» revierte cualquier cambio hecho mientras estuvo abierto.

![Diálogo de estilo de una medición, con distancia y rumbo de solo lectura](img/16-estilo-medicion.png)
*Figura 17. Estilo de «Ruta 1»: mismo tipo de controles que un polígono, con la distancia y el rumbo de la medición debajo.*

### 6.4 Editar varias capas a la vez

Con más de una capa seleccionada, el diálogo de estilos se abre igual, pero con una regla importante: **un valor que no coincide en todas las capas seleccionadas no se aplica a menos que se toque expresamente**. La fila correspondiente se marca como «(varios)» y, al modificar ese control, deja de estarlo y pasa a aplicarse a toda la selección; lo que no se toca se queda exactamente como estaba en cada capa. Esto evita que, por ejemplo, cambiar solo el color de varias capas de golpe termine igualando también sus grosores o sus rellenos sin haberlo pedido.

### 6.5 Ficha de información y propiedades

Cuando una capa procede de un KML con una descripción, o de un GeoJSON con propiedades, el botón ℹ de su fila —o pasar el ratón por encima de la capa en el mapa, o «Mostrar propiedades» del menú contextual— abre una ficha con esa información: el texto original en el caso de un KML (filtrado de cualquier contenido peligroso, conservando el texto) o una tabla de clave y valor en el caso de un GeoJSON.

![Ficha de propiedades de un elemento GeoJSON, en tabla de clave y valor](img/14-ficha-propiedades.png)
*Figura 18. Propiedades de «Sensor 1», tal como venían en el archivo GeoJSON de origen.*

---

## 7. Cómo hacer las tareas más habituales

### 7.1 Importar un archivo con un polígono (o cualquier otro formato admitido)

La vía más directa es arrastrar el archivo desde el escritorio y soltarlo sobre el panel de navegación (o sobre una carpeta concreta, para que entre dentro de ella). KITE Local reconoce KML, KMZ, GeoJSON, TopoJSON y su propio formato de carpetas exportadas, mirando el contenido del archivo, no su extensión. Si el archivo contiene algún elemento con datos incorrectos, ese elemento se descarta de forma aislada y el resto se carga con normalidad; al terminar aparece siempre un resumen de lo cargado y lo omitido, con la causa.

Cuando no se tiene el archivo en el disco pero sí su dirección web, el botón 🔗 de la cabecera ofrece el mismo resultado en dos pasos: se escribe o se pega la dirección y se pulsa «Descargar»; solo cuando la aplicación confirma qué ha llegado (tipo y tamaño) se activa «Añadir al árbol» para incorporarlo. Mientras no se pulse ese botón, nada llega al mapa.

![Diálogo de añadir desde una dirección, tras descargar un archivo con éxito](img/17-anadir-url.png)
*Figura 19. Tras descargar «remoto.kml», el diálogo confirma el tipo y el tamaño y habilita «Añadir al árbol».*

Todo lo incorporado por esta vía queda dentro de una carpeta «Descargas», con una subcarpeta numerada por descarga («Descarga 1», «Descarga 2»…), para que varias descargas sucesivas no se mezclen entre sí.

### 7.2 Medir una distancia y un rumbo

Se pulsa la herramienta «Medir ruta» (⤳) de la barra de dibujo: un clic marca cada waypoint y un doble clic termina la ruta (siempre queda abierta; no se puede cerrar en anillo). Para una distancia y un rumbo sueltos basta con dos waypoints —origen y destino—, exactamente como una línea de toda la vida. **Desde ese segundo waypoint, dibujar una ruta se comporta como editarla**: la medición ya cuelga de una fila del árbol, dentro de una carpeta «Mediciones», con su propio nombre autonumerado («Ruta 1», «Ruta 2»…), y su diálogo de propiedades se abre solo, mostrando distancia y rumbo ya calculados — sin esperar a terminar el dibujo. Cada waypoint que se añade después actualiza esas cifras al momento. Cancelar el diálogo a medio dibujar —con `Escape` o con su propio botón «Cancelar»— borra la ruta, igual que cancelar un marcador recién creado, y sale del modo de dibujo; pulsar «Aceptar», o terminar con doble clic (se comporta exactamente igual que «Aceptar»), en cambio la GUARDA con los waypoints que tenga hasta ese momento, cierra el diálogo —señal visual de que la edición ha terminado— y sale del modo de dibujo.

![Una medición de ruta recién creada, con su etiqueta de distancia y rumbo sobre el mapa](img/15-medicion-mapa.png)
*Figura 20. Medición entre «Base» y «Punto de control»: 1,92 millas náuticas a un rumbo de 108,2°, con su fila correspondiente en el árbol.*

Para editar una ruta ya creada, con su diálogo de propiedades abierto (ver 6.3), basta con arrastrar uno de sus waypoints —ya no hace falta `Ctrl`—; con el botón derecho se quita uno (sin poder bajar de 2). **Sin el diálogo abierto**, el botón derecho sobre un waypoint no borra nada: abre el menú contextual normal del mapa, con acceso directo a «Editar propiedades». La unidad de medida (metros, kilómetros, pies, millas o millas náuticas —esta última la unidad por defecto, la habitual en navegación aérea y marítima—) y el formato de coordenadas se eligen una sola vez, en el panel 🏷️ Propiedades (apartado 2.1), y se aplican a la vez a todas las mediciones y a todos los polígonos, tanto en su diálogo de estilo como en las etiquetas que se ven sobre el mapa.

Para una ruta con varias escalas, en vez de un solo tramo, se añaden más de dos waypoints: cada tramo lleva su propia etiqueta de distancia y rumbo sobre el mapa —numerada «Tramo 1», «Tramo 2»…, para poder identificarla de un vistazo con la fila del mismo tramo en el diálogo de propiedades—, y la fila del árbol muestra la distancia total.

### 7.3 Medir una superficie, o dibujar una figura propia

La herramienta «Medir círculo» (◯) se arrastra del centro al borde y da el radio y la superficie. La herramienta «Dibujar polígono o línea» (⬠) es distinta: no se arrastra, se hace un clic por cada vértice; un doble clic sobre el primer vértice cierra la figura como un polígono con superficie, y un doble clic en cualquier otro punto la deja como una línea abierta, sin relleno.

### 7.4 Personalizar un marcador

Se abre su diálogo de estilo con el botón 🎨 de su fila. «Cambiar…» abre el catálogo de iconos; un clic sobre uno lo selecciona (sin aplicarlo todavía) y «Aceptar», en el selector, lo confirma como icono elegido para ese marcador. De vuelta en el diálogo principal, el color escogido tiñe cualquier icono del catálogo (no afecta a la gota clásica de Leaflet, que es una imagen fija). Solo al pulsar «Aceptar» en el diálogo de estilo se aplica todo el conjunto de cambios —icono, color, tamaños, texto y posición— a la capa.

### 7.5 Copiar capas entre dos instancias distintas de KITE Local

Al ser una aplicación que corre en el navegador, dos pestañas —o dos instalaciones en dos direcciones distintas— no comparten memoria entre sí de forma automática. Para pasar capas de una a otra:

1. En la primera instancia, se selecciona la carpeta o las capas que se quieren llevar (un clic, o `Mayús + clic` para varias) y se pulsa `Ctrl + C`. Esto no solo guarda una copia interna: también escribe la información en el portapapeles del propio sistema operativo.
2. En la segunda instancia —en otra pestaña, otra ventana o incluso otro ordenador con acceso al portapapeles compartido—, se pone el cursor donde se quiera recibir el contenido y se pulsa `Ctrl + V`. La carpeta y sus capas aparecen ahí, con su geometría y sus estilos intactos.

![Selección de la carpeta "Zonas" tras copiarla con Ctrl+C](img/22-copiar-origen.png)
*Figura 21a. Instancia de origen: la carpeta «Zonas» seleccionada justo después de `Ctrl + C`.*

![La misma carpeta, ya pegada en una segunda instancia vacía](img/23-pegar-destino.png)
*Figura 21b. Instancia de destino, antes vacía: tras `Ctrl + V`, la carpeta «Zonas» aparece con sus tres capas.*

Este mecanismo copia siempre; nunca mueve nada de la instancia de origen, aunque en esa misma instancia (no entre dos distintas) `Ctrl + X` sí corta de verdad. Pegar solo se interpreta como una importación de capas cuando el cursor está sobre el árbol: pegar en cualquier otro campo de texto de la aplicación —por ejemplo, en el editor de vértices— pega el texto tal cual, sin intentar interpretarlo.

### 7.6 Guardar una carpeta y volver a cargarla más tarde

El botón 💾 de una carpeta o un archivo la descarga entera a un archivo con extensión «.kite.json». Ese archivo puede volver a soltarse sobre el panel —en esta misma instalación o en cualquier otra— y se añade como una copia nueva, nunca sustituye ni fusiona lo que ya hubiera.

### 7.7 Deshacer y rehacer

`Ctrl + Z` deshace la última operación que cambió el árbol (borrar, pegar, arrastrar, ordenar…), y `Ctrl + Y` la rehace. Hacer algo nuevo después de deshacer descarta lo que se pudiera haber rehecho, igual que en cualquier editor de texto.

### 7.8 Consultar la altitud del terreno

Se activa con el botón ⛰ de la barra de vista (o «Modo elevación» del menú contextual). Mientras está encendido, el cuadro de coordenadas añade la altitud del terreno y de la superficie bajo el cursor —dos modelos distintos del Instituto Geográfico Nacional, con cobertura solo sobre España—, y sobre el mapa se va dibujando una cuadrícula con los valores de cada celda consultada, que se acumula mientras el modo sigue activo. Al desactivarlo, lo acumulado en esa sesión queda como una capa más del árbol, dentro de una carpeta «Elevaciones».

---

## 8. Atajos de teclado

La misma información está disponible en cualquier momento con la tecla `?` o el botón de ayuda de la cabecera, organizada en pestañas («Navegación», «Actuar», «Visor», «Dibujar y editar») para no tener que scrollear una única tabla larga.

![Chuleta de atajos de teclado completa](img/19-atajos.png)
*Figura 22. Chuleta de atajos de teclado (tecla `?`), pestaña «Navegación».*

**Moverse por el árbol**

| Tecla | Acción |
|---|---|
| ↑ / ↓ | Nodo anterior / siguiente |
| → / ← | Desplegar y entrar / colapsar y subir |
| Re Pág / Av Pág | Saltar diez nodos |
| Inicio / Fin | Primero / último de la carpeta actual |

**Seleccionar**

| Tecla | Acción |
|---|---|
| Mayús + flechas | Extender la selección |
| Mayús + clic | Seleccionar hasta ahí |
| Ctrl + Mayús + clic | Añadir o quitar un nodo suelto |
| Ctrl + A | La carpeta actual; otra vez, todo el árbol |
| Esc | Quitar la selección; si hay un diálogo abierto, lo cierra primero; si hay una herramienta de dibujo o medición activa, la cancela |

**Actuar**

| Tecla | Acción |
|---|---|
| Espacio | Activar o desactivar la capa |
| F2 | Renombrar (también desde las propiedades) |
| Intro (renombrando) | Confirma el nuevo nombre |
| Esc (renombrando) | Cancela y restaura el nombre anterior |
| Supr | Borrar lo seleccionado |
| Ctrl + C / X / V | Copiar, cortar y pegar (también entre pestañas de KITE) |
| Ctrl + Z / Ctrl + Y | Deshacer y rehacer |
| Alt + Intro | Propiedades de lo seleccionado |
| Ctrl + F | Ir al buscador |
| ? o Mayús + / | Abrir esta ayuda |
| Arrastrar una fila por su nombre | Mover el nodo a otra carpeta o posición (Esc cancela) |

**En el visor**

| Gesto | Acción |
|---|---|
| Mayús + arrastrar | Zoom a un rectángulo |
| Arrastrar (sobre el centro o el borde de un círculo de medición, con su diálogo abierto) | Moverlo o cambiar su radio (no hace falta ninguna tecla) |
| Doble clic en una capa | Ir a ella; repetido, acercar por peldaños |
| Re Pág / Av Pág (con el mapa enfocado) | Acercar / alejar un nivel de zoom hacia el puntero |

**Dibujar polígonos y rutas**

| Gesto | Acción |
|---|---|
| Clic | Fijar un vértice |
| Doble clic sobre el último vértice | Cerrar el polígono y terminar |
| Doble clic fuera de un vértice | Terminar la línea o la ruta sin cerrarla |
| Clic derecho sobre un vértice | Quitar ese vértice |
| Supr | Quitar el último vértice |

**Editar vértices de una ruta o un polígono ya creados**

| Gesto | Acción |
|---|---|
| Abrir sus propiedades (🎨 o Alt+Intro) | Activa mover/borrar/insertar vértices sobre el mapa |
| Clic en un vértice | Seleccionarlo |
| Arrastrar un vértice | Moverlo (no hace falta ninguna tecla) |
| Clic derecho sobre un vértice | Quitarlo |
| Mayús + clic en el mapa, o tecla Insertar | Insertar un vértice tras el seleccionado (o al final, si no hay ninguno) |
| Mayús + clic sobre el primer vértice, con el último seleccionado | Cerrar una línea abierta (sin añadir ningún vértice) |
| Supr | Quitar el vértice seleccionado (antes que borrar el nodo) y dejar seleccionado el SIGUIENTE, para poder seguir pulsando Supr y quitar varios vértices seguidos sin tener que volver a hacer clic; en un contorno cerrado de exactamente 3 vértices, lo abre en línea en vez de bloquear el borrado |

---

## 9. Qué se guarda y dónde

KITE Local guarda automáticamente, en el propio navegador y en el propio dispositivo (nunca en un servidor), el árbol completo de capas y la posición y el zoom del mapa, con un pequeño retardo tras cada cambio para no repetir el guardado en cada pulsación. Al volver a abrir la aplicación, el árbol y la vista se restauran tal como se dejaron. Este guardado es local a cada navegador: para llevar el mismo contenido a otro dispositivo hace falta exportarlo (apartado 7.6) o copiarlo por el portapapeles del sistema (apartado 7.5).

La **unidad de medida** y el **formato de latitud/longitud**, elegidos en el panel 🏷️ Propiedades (apartado 2.1), sí se guardan y se restauran al volver a abrir la aplicación. Otras preferencias de uso más puntuales —la unidad de la cuadrícula de elevación, o el formato de coordenadas del propio diálogo de un marcador— se recuerdan solo mientras la pestaña sigue abierta: son ajustes de lectura rápida, no parte de los datos cargados.
