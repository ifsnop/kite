# Estudio de seguridad de KITE Local

## Origen de los datos, integridad de la información representada y verificación mediante pruebas automatizadas

| | |
|---|---|
| **Documento** | Estudio de seguridad — KITE Local (KML Interactive Tree Explorer) |
| **Versión del documento** | 1.2 |
| **Fecha** | 24 de septiembre de 2026 |
| **Preparado por** | Diego Torres |
| **Versión de la aplicación auditada** | v1.7.0 (202610112341) |
| **Repositorio público del código fuente** | https://github.com/ifsnop/kite |

---

## 1. Resumen ejecutivo

KITE Local es una aplicación de visualización y consulta de información geoespacial (archivos KML, KMZ, GeoJSON, TopoJSON y shapefile, y ortofotos en GeoTIFF optimizado, COG) que se ejecuta íntegramente en el navegador del usuario, sin ningún servidor propio que reciba, procese o almacene los datos cargados. Este documento se ha elaborado para dejar constancia, de forma verificable, de tres garantías sobre las que descansa la fiabilidad de la herramienta como instrumento de consulta:

1. **El origen de cada capa de información es conocido, declarado y verificable.** Tanto la cartografía de fondo como los servicios auxiliares (elevación del terreno, búsqueda de topónimos) proceden de organismos oficiales o de proveedores identificados, y la propia aplicación restringe por configuración los orígenes de red a los que puede conectarse — con dos excepciones deliberadas y acotadas en las que el propio usuario elige el origen (descargar un archivo desde una dirección, y un mapa base de teselas de un servidor propio), descritas en el apartado 6.2.
2. **La aplicación no modifica los datos geoespaciales que muestra.** La geometría, las coordenadas y la altitud de cada elemento cargado se conservan tal como están definidas en el archivo de origen a lo largo de todo el ciclo de vida (carga, visualización, guardado y exportación). Las únicas excepciones son un número reducido de correcciones controladas, de alcance mínimo, siempre notificadas al usuario y nunca aplicadas en silencio, que se describen en detalle en el apartado 4.
3. **El comportamiento descrito está verificado mediante una batería de pruebas automatizadas** que se ejecuta contra el propio archivo que se distribuye —no contra una copia aparte del código— y que en la fecha de este documento supera sus 60 conjuntos de comprobaciones sin ninguna incidencia.

El documento está dirigido a personal auditor y experto en seguridad, no a personal programador: describe el comportamiento de la aplicación, su alcance y sus garantías, sin entrar en detalles de implementación.

---

## 2. Objeto y alcance

Este estudio tiene por objeto proporcionar a cualquier auditoría de seguridad que lo requiera, evidencia documental sobre:

- de dónde procede la información cartográfica y geoespacial que KITE Local pone a disposición del usuario;
- qué garantías existen de que esa información no se altera, se pierde ni se malinterpreta entre que se carga y se consulta;
- qué mecanismo de verificación independiente (pruebas automatizadas) respalda esas garantías, y con qué alcance.

Queda fuera del alcance de este documento la evaluación de los datos que el propio usuario decide cargar (por ejemplo, un archivo KML con zonas de vuelo, trazas o límites operativos): KITE Local es una herramienta de visualización y consulta de dicha información, no la fuente ni el garante de su exactitud operativa. Esta distinción se desarrolla en el apartado 8.

---

## 3. Descripción general de la aplicación

KITE Local es un visor de información geoespacial que se distribuye como un único archivo, sin instalación ni componente de servidor. Al abrirse, todo el procesamiento —interpretación de los archivos cargados, cálculo de distancias y superficies, dibujo del mapa— ocurre en el propio dispositivo del usuario. La aplicación no dispone de un backend propio: no existe ningún servidor de la aplicación al que se envíen los archivos o los datos que el usuario carga o consulta.

El único tráfico de red que genera la aplicación es el que el propio usuario origina de forma explícita:

- activar una capa de cartografía de fondo (mapa, ortofoto o modelo de elevación);
- realizar una búsqueda de un topónimo o lugar;
- consultar la altitud del terreno bajo el cursor;
- descargar un archivo desde una dirección web que el propio usuario proporciona.

En ningún caso la aplicación reenvía a un tercero el contenido de los archivos que el usuario ha cargado desde su propio equipo.

El código fuente es público y auditable en su totalidad (repositorio indicado en la cabecera de este documento), y cada versión distribuida lleva un identificador de versión visible en la propia interfaz, lo que permite comprobar en todo momento qué código se está ejecutando.

---

## 4. Origen y procedencia de la información geoespacial

Toda la información que KITE Local puede mostrar procede de dos categorías bien diferenciadas: servicios cartográficos de referencia, configurados de fábrica y con origen declarado, y archivos que el propio usuario aporta.

### 4.1 Cartografía y modelos de elevación de referencia

La aplicación incorpora, apagados por defecto salvo la capa base de OpenStreetMap, un conjunto de fuentes de cartografía de fondo y modelos de elevación del terreno configuradas de fábrica. Fuera de la excepción explícita descrita justo debajo de la tabla («Custom Maps»), ninguna otra fuente puede añadirse sin modificar y volver a distribuir la propia aplicación (ver la restricción de red del apartado 6.2).

| Capa | Proveedor / organismo | Naturaleza del dato |
|---|---|---|
| OpenStreetMap | Fundación OpenStreetMap | Cartografía base colaborativa, activa por defecto |
| Físico (Esri World Terrain) | Esri | Cartografía de relieve mundial |
| IGN Base | Instituto Geográfico Nacional (España) | Cartografía base oficial |
| Mapa topográfico MTN | Instituto Geográfico Nacional (España) | Cartografía topográfica oficial (ráster del Mapa Topográfico Nacional) |
| Relieve sombreado | Esri | Sombreado de relieve mundial |
| Ortofoto PNOA (Máxima Actualidad) | Instituto Geográfico Nacional (España) | Ortofotografía aérea oficial del Plan Nacional de Ortofotografía Aérea |
| PNOA histórico | Instituto Geográfico Nacional (España) | Serie histórica de ortofotografías del PNOA, por años disponibles |
| Ortofoto Madrid | Ayuntamiento de Madrid (servicio WMS del Geoportal, sin credencial) | Ortofotografía municipal de la ciudad de Madrid; atribución «Origen de los datos: Ayuntamiento de Madrid» |
| Modelo Digital del Terreno de España (WMS) | Instituto Geográfico Nacional (España) | Elevación del terreno (servicio de mapas, para visualización) |
| Relieve SRTM30 | terrestris (servicio público sin coste, cobertura entre 56° S y 60° N) | Sombreado de relieve global derivado de la misión SRTM |
| Copernicus DEM | Copernicus Data Space / Sentinel Hub, bajo credencial propia del usuario | Modelo digital de superficie global |

**«Custom Maps» es la única excepción a esta lista cerrada, y es deliberada.** En vez de un proveedor fijo, pide sus teselas a la dirección que el propio usuario configura en el diálogo de esa capa —típicamente una caché o proxy propio delante de un servicio ya existente, para no cargar de tráfico ese servicio público—. Permanece apagada y sin ningún origen configurado hasta que el usuario introduce uno; la aplicación no elige, sugiere ni conoce de antemano ningún servidor para esta capa, y solo admite direcciones cifradas (https), nunca sin cifrar (http). Se detalla en el apartado 6.2.

Además, dos servicios de consulta puntual, no cartografiados como capa de fondo:

- **Modelos digitales del terreno (MDT) y de superficie (MDS)**, usados por la consulta de elevación, que el usuario lanza expresamente sobre un punto desde el menú contextual del visor (nunca al mover el ratón). Los servicios posibles forman una lista cerrada fijada en el código de la aplicación; el usuario solo elige, en el panel «Propiedades», cuál de ellos usar para cada modelo o ninguno, y no puede escribir una dirección propia. Hoy son: el **MDT y el MDS del Instituto Geográfico Nacional** (servicios de cobertura del propio IGN, la opción de partida), con altitud ortométrica (sobre el nivel medio del mar) y cobertura limitada al territorio español; del MDT, tres conjuntos de datos publicados por el propio servicio (identificadores INSPIRE **MDT05**, **MDT25** y **MDT200**, de celdas de 5, 25 y 200 m, comprobados en su declaración de capacidades), y del MDS, el conjunto **MDS**; y, como MDS alternativo, el **Copernicus DEM GLO-30** (modelo de superficie de la Agencia Espacial Europea y la Unión Europea, producido por DLR y Airbus) servido por **Digital Earth Africa**, con altitudes referidas al geoide EGM2008, celdas de unos 30 m y cobertura en África, Canarias y la península hasta los 39° N. Cada capa descargada lleva en su nombre el conjunto de datos y el proveedor de los que procede (por ejemplo «MDT25 + MDS (IGN)»). La primera consulta a cada servicio, en cada sesión, lee qué coberturas y formatos ofrece y, dentro del conjunto elegido, la malla más fina; esa elección queda anotada en el registro de avisos de la sesión.

Las peticiones a estos servicios siguen una disciplina fija: tope de peticiones por segundo entre todos ellos, tiempo máximo de respuesta por intento (mayor para Digital Earth Africa, que tarda hasta medio minuto en la primera petición a una zona) y **reintento automático solo ante fallos pasajeros** (el servicio no responde, error del servidor o límite de peticiones), hasta tres veces con una pausa creciente; una respuesta del servicio —incluida «fuera de cobertura»— nunca se reintenta, y un fallo que agota los intentos se comunica al usuario. El **perfil de una ruta** pide al MDT y al MDS elegidos el terreno que recorre la ruta por zonas acotadas, una tras otra y respetando ese mismo tope, solo para rutas por debajo de una longitud máxima configurable (10 millas náuticas de partida); obtenido una vez, se guarda con la capa del perfil y volver a mostrarlo no hace ninguna petición. Mientras descarga, su ventana muestra para depuración **cada petición tal como sale** (la dirección completa y el número de intento) **y lo que vuelve** (estado HTTP, tipo y tamaño de la respuesta, tiempo, la rejilla leída o el fallo y si se reintenta): solo lo que la aplicación pide porque el usuario lo ha pedido, y desaparece al terminar la descarga. Esas curvas guardadas, como todo lo que llega en un árbol exportado o pegado, se validan al leerse (forma, números finitos, longitudes acotadas, distancias crecientes): un perfil que no las cumple se descarta y la capa queda como una cuadrícula sin perfil. Ninguno de los dos procesos altera los valores recibidos: el perfil toma, para cada celda que recorre la ruta, el valor de esa celda tal cual, sin interpolar, y deja como hueco lo que el servicio no devolvió; con dos mallas de distinto tamaño, cada celda fina lleva el valor de la celda gruesa que la contiene, también sin interpolar. Los servicios no entregan su malla original: la remuestrean a una rejilla que construyen para cada petición. KITE fija esa rejilla —origen y tamaño de celda constantes por servicio, indicando el número de celdas con el parámetro estándar `scaleSize` de WCS 2.0— para que lo descargado en peticiones distintas coincida celda a celda; fija la geometría de la rejilla, no los valores, que son los que el servicio devuelve. Si un servicio no admite ese parámetro, se pide como antes.
- **Nominatim**, el servicio de geocodificación de OpenStreetMap, usado exclusivamente por el buscador de lugares del panel. La consulta se realiza únicamente cuando el usuario pulsa el botón de búsqueda o la tecla Intro —nunca mientras escribe— y respetando el límite de una petición por segundo que exige la política de uso pública de ese servicio.

Cada capa de cartografía activada muestra en el pie del visor la atribución del proveedor correspondiente, tal y como exigen las licencias de uso de esos servicios (por ejemplo, la licencia CC BY 4.0 del IGN o la atribución de OpenStreetMap).

### 4.2 Datos aportados por el usuario

El resto de la información que puede verse en KITE Local procede exclusivamente de archivos que el propio usuario carga de forma voluntaria: archivos KML y KMZ, GeoJSON y TopoJSON, shapefiles (sueltos o en un archivo .zip), ortofotos en formato COG (un GeoTIFF preparado para leerse a trozos), o su propio formato de intercambio interno (usado para exportar e importar una carpeta de capas entre sesiones o entre instalaciones de la misma aplicación). También puede cargarse un archivo desde una dirección web indicada por el usuario, con el mismo tratamiento que un archivo local. Estos archivos son responsabilidad de quien los proporciona; KITE Local no genera, completa ni infiere ninguna información geoespacial por cuenta propia: se limita a interpretar y representar lo que el archivo contiene.

---

## 5. Principio de no alteración de los datos representados

Este es el punto central del presente estudio: **KITE Local no interpreta, recalcula ni modifica la geometría, las coordenadas ni la altitud de los elementos que carga.** Lo que se dibuja en el mapa, lo que se guarda y lo que se exporta es, en todos los casos, una reproducción fiel del archivo de origen.

### 5.1 Conservación de la geometría a lo largo de todo el ciclo de vida

La posición (latitud y longitud) y la altitud de cada punto se leen literalmente del archivo cargado y se conservan sin cambios a través de todas las operaciones internas de la aplicación: la visualización en el mapa, el guardado automático entre sesiones, y la exportación posterior a un archivo. La altitud, en particular, se transporta de forma explícita en todo ese recorrido y solo se omite cuando el propio archivo de origen no la incluye: la aplicación nunca añade un valor de altitud que el archivo original no traía. Única excepción, en sentido contrario: la altura de los shapefiles tridimensionales no se importa (la biblioteca que los lee solo entrega la posición), y así se indica en el manual.

Cuando el usuario modifica de forma intencionada un elemento —por ejemplo, arrastrando un marcador en el mapa o editando manualmente una lista de coordenadas desde el diálogo pensado para ello— ese cambio es una acción explícita y deliberada de la persona usuaria, claramente distinta de cualquier alteración automática por parte de la aplicación. Del mismo modo, personalizar el color, el icono o el grosor con que se representa un elemento es un ajuste puramente visual: no toca en ningún caso su posición ni su geometría.

### 5.2 Las únicas transformaciones automáticas, y por qué no comprometen la integridad del dato

Existen exactamente cinco situaciones en las que la aplicación interviene sobre lo leído de un archivo, y todas comparten tres características: tienen un propósito de preservación de la información (evitar perder datos por errores menores y evitables del propio archivo), tienen un alcance mínimo y acotado, y se comunican siempre al usuario en el resumen de la carga, nunca de forma silenciosa.

1. **Corrección de errores de redondeo de coma flotante en coordenadas al límite de rango.** Es habitual que un archivo, tras haber pasado por procesos de reproyección de coordenadas en otro programa, contenga una longitud o latitud que se sale del rango válido por una cantidad ínfima (del orden de una diezmilésima de grado, equivalente a unos pocos centímetros sobre el terreno), en vez de por un error real de los datos. KITE Local ajusta ese valor al límite válido más cercano únicamente cuando la desviación es menor que un margen fijo y muy estrecho (aproximadamente 0,00001 grados, del orden de un metro sobre el terreno); cualquier desviación mayor se sigue rechazando como dato inválido. Cada ajuste realizado se cuenta y se informa al usuario en el resumen de la importación: nunca se corrige en silencio.
2. **Fusión de marcadores duplicados, solo bajo confirmación explícita del usuario.** Algunos programas exportan el mismo elemento por duplicado (mismo nombre y misma posición). Al detectar este patrón, la aplicación pregunta al usuario si desea fusionarlos; si no se confirma, los duplicados se cargan tal cual venían en el archivo. No hay fusión automática sin esa confirmación.
3. **Reparación de espacios de nombres XML mal declarados.** Algunos archivos KML, aun siendo aceptados por otros programas, contienen un error de formato (un prefijo usado pero no declarado) que un analizador de XML estándar rechaza en bloque, perdiéndose el archivo entero. KITE Local detecta este caso concreto, lo repara de forma mínima para poder leer el archivo y anota la reparación en el informe de importación. Esta reparación afecta solo a la estructura del documento XML, nunca a los valores de coordenadas, nombres o atributos.
4. **Limpieza de etiquetas de tipo HTML incrustadas en nombres o en atributos descriptivos, solo bajo confirmación del usuario.** Es una medida de seguridad de la interfaz (evitar que un archivo ajeno pueda inyectar marcado HTML en el panel de la aplicación), no una alteración del dato geoespacial: no toca la geometría, la posición ni la altitud, y solo actúa sobre el texto visible de nombres y de atributos descriptivos, y únicamente cuando el usuario lo confirma.

5. **Cambio de sistema de coordenadas de un shapefile.** Un shapefile suele venir en coordenadas proyectadas (en España, casi siempre ETRS89 UTM), que el mapa no puede representar tal cual. La aplicación lee el sistema de referencia que el propio archivo declara (su `.prj`) y convierte cada posición a coordenadas geográficas con una biblioteca de reproyección estándar y verificada (apartado 6.1); no elige ni supone un sistema por su cuenta. Si el archivo no declara sistema, solo se acepta cuando sus coordenadas ya son geográficas, y el resumen dice que se ha supuesto; si son métricas, el archivo se rechaza, porque no hay forma honesta de colocarlo. Cuando el sistema declarado es ED50 (la referencia de la cartografía española anterior a ETRS89) sin parámetros de cambio de datum, se aplican los estándar para la España peninsular, de precisión métrica, y el resumen lo advierte; un datum que no se sabe transformar se representa igualmente, con un aviso de que puede estar desplazado. ETRS89 y WGS84 se tratan como equivalentes (difieren en menos de un metro).

Una ortofoto COG no pasa por ninguno de estos casos: se guarda tal cual llegó, byte a byte, y es solo al DIBUJARLA cuando cada píxel del mapa toma el píxel de la imagen que le corresponde según el sistema de coordenadas que la propia imagen declara. Ese muestreo es del vecino más próximo, a propósito: nunca promedia píxeles, así que no aparece en pantalla ningún color que no esté en la imagen original. Una imagen sin sistema declarado, o en uno que la aplicación no sabe transformar, se rechaza con un aviso que lo nombra; nunca se coloca suponiendo.

Fuera de estos cinco casos, acotados y siempre comunicados, ningún otro proceso de la aplicación modifica el contenido de un archivo cargado.

### 5.3 Saneado de la información descriptiva: una medida de seguridad, no de contenido geoespacial

Además de lo anterior, el texto descriptivo asociado a un elemento (la ficha de información que puede llevar un KML, con formato HTML embebido) pasa por un filtro de seguridad antes de mostrarse: se eliminan las etiquetas y los atributos que podrían ejecutar código o cargar contenido de orígenes no controlados, conservando siempre el texto. Esta medida protege a la persona usuaria frente a un archivo manipulado con fines maliciosos; no afecta en ningún caso a las coordenadas, la altitud ni a ningún otro dato geoespacial del elemento, que quedan fuera de este filtro por no ser contenido HTML.

### 5.4 Aislamiento de errores por elemento

Cuando un archivo contiene un elemento con datos defectuosos (una geometría incompleta, unas coordenadas fuera de rango por encima del margen de tolerancia descrito, o una referencia rota), ese elemento concreto se descarta de forma aislada y el resto del archivo se sigue cargando con normalidad: un solo dato erróneo no invalida ni corrompe la importación completa. Al finalizar la carga, la aplicación presenta siempre un resumen con el número de elementos cargados, los tipos detectados, los elementos omitidos y la causa de cada omisión, de modo que la persona usuaria conoce en todo momento qué se ha incorporado y qué no, y por qué.

Si la construcción de un archivo se interrumpe a mitad de proceso (por ejemplo, por un fallo inesperado), lo que se hubiera llegado a incorporar se retira por completo: la aplicación nunca deja una importación a medias en el árbol de capas.

### 5.5 Límites frente a archivos comprimidos desproporcionados o manipulados

Los archivos KMZ (KML comprimido) se someten a comprobaciones antes de descomprimirse: un número máximo de archivos dentro del comprimido (2000), un tamaño máximo una vez descomprimido (300 megabytes) y una relación máxima entre el tamaño descomprimido y el comprimido (200 veces). Estas cotas evitan que un archivo comprimido de forma desproporcionada o deliberadamente hostil ("bomba de descompresión") agote los recursos del dispositivo antes de que la aplicación pueda siquiera informar del problema. Las mismas cotas se aplican a un shapefile comprimido en .zip, y cada shapefile tiene además las suyas: 300 megabytes entre geometría y atributos y 100 000 elementos, por encima de los cuales lo sobrante se omite y se cuenta en el resumen.

Una ortofoto COG se valida antes de copiarse al almacenamiento del navegador: tiene que ser un GeoTIFF legible, de 8 bits por canal, georreferenciado en uno de los sistemas admitidos y con una extensión geográfica válida; si no, se rechaza y no ocupa espacio. También se comprueba antes que cabe en la cuota del navegador. Al dibujarla, cada trozo del mapa lee como máximo una ventana acotada de la imagen (unos cuatro millones de píxeles), y la lectura de varios trozos a la vez está limitada, de modo que una imagen sin niveles reducidos no puede agotar la memoria al alejarse: esos trozos simplemente no se dibujan, y el aviso de la carga ya lo advierte.

---

## 6. Integridad y procedencia verificable de los componentes de la aplicación

### 6.1 Verificación criptográfica de las librerías de terceros

KITE Local reutiliza un número reducido de bibliotecas de software de terceros, ampliamente usadas y estables, en lugar de reescribir funcionalidad ya resuelta: una biblioteca de mapas interactivos, una de descompresión de archivos, una de conversión de un formato cartográfico adicional (TopoJSON), una de generación de imágenes para la exportación a PNG, una de lectura de imágenes georreferenciadas (GeoTIFF), necesaria para un servicio de elevación que solo entrega ese formato y para las ortofotos COG, una de lectura de shapefiles y una de reproyección de coordenadas (proj4js, la referencia de facto en aplicaciones web), que pasa a coordenadas geográficas lo que un shapefile o una ortofoto declaran en otro sistema. Las siete se cargan desde redes de distribución de contenido públicas y reconocidas, y las siete llevan asociado un mecanismo de verificación de integridad criptográfica (subresource integrity): el navegador calcula la huella del archivo recibido y la compara con la huella declarada por la propia aplicación antes de ejecutarlo. Si un proveedor de contenidos fuera comprometido y sirviera un archivo distinto del esperado, el navegador lo bloquearía y no se ejecutaría, en lugar de ejecutar código no verificado.

La rotación del mapa no se obtiene de ninguna red externa: el código que la hace posible, derivado de una extensión de código abierto para la biblioteca de mapas que ya no recibía mantenimiento, está incorporado en la propia aplicación, reducido a las partes que se usan. Forma así parte del mismo archivo que se distribuye y que verifican las pruebas automatizadas (apartado 7), y su conservación de la autoría y la licencia originales queda indicada en el propio código.

### 6.2 Política de seguridad de contenido con lista cerrada de orígenes

La aplicación declara una política de seguridad de contenido (Content Security Policy) que restringe, a nivel de navegador, con qué orígenes puede comunicarse o de qué orígenes puede cargar código, estilos o imágenes. Por defecto, todo está denegado; se autoriza explícitamente, uno a uno, cada origen necesario: las dos redes de distribución de las bibliotecas de terceros para código y para hojas de estilo, y la lista cerrada de servicios cartográficos oficiales enumerados en el apartado 4.1 para imágenes de mapa. Ningún origen no declarado en esa lista puede servir código, estilos o imágenes de mapa a la aplicación, aunque el código de la propia aplicación intentara solicitarlo — con las dos excepciones deliberadas, y solo esas dos, descritas a continuación.

Hay dos excepciones deliberadas, y las dos comparten la misma justificación: en ambas el origen no puede enumerarse de antemano porque **es, precisamente, lo que el usuario decide** en el momento de usar la función, no algo que la aplicación elija.

- **"Añadir desde una dirección"**, que debe poder conectarse al origen que el usuario escribe para descargar un archivo.
- **El mapa base "Custom Maps"**, que debe poder pedir sus teselas al servidor que el usuario configure (apartado 4.1) — típicamente una caché o proxy propio delante de un servicio ya existente.

Las dos conexiones se permiten solo hacia direcciones cifradas (https), nunca hacia direcciones sin cifrar (http), de modo que una aplicación servida de forma segura no pueda verse forzada a comunicarse por un canal inseguro. La restricción de código y de estilos (qué puede ejecutar la página, qué puede darle apariencia) no tiene ninguna excepción: sigue limitada, sin más, a las dos redes de distribución de las bibliotecas de terceros. La de imágenes de mapa sí se amplía a cualquier origen cifrado —es una regla del navegador, no puede limitarse a "solo si lo pide la capa Custom Maps"—, pero en la práctica ninguna de las demás capas de la tabla del apartado 4.1 llega a ejercer esa amplitud: sus direcciones están fijadas en el propio código de la aplicación, no aceptan ninguna entrada del usuario, y seguirían pidiendo exactamente esos mismos orígenes aunque la política fuera más estricta.

### 6.3 Sin telemetría ni almacenamiento remoto

KITE Local no incorpora ningún mecanismo de telemetría, analítica de uso ni envío de informes de error a un servidor propio o de terceros. El único almacenamiento persistente de los datos cargados es local, dentro del propio navegador del usuario, en su propio dispositivo; no se sincroniza ni se replica a ningún servidor. Las ortofotos COG también: se copian a un almacén propio del navegador, separado del árbol de capas, y no salen de él (no se incluyen al exportar una carpeta ni al copiar al portapapeles del sistema). Una ortofoto borrada del árbol se elimina de ese almacén la siguiente vez que se abre la aplicación. La aplicación puede usarse, de hecho, completamente desconectada de red salvo por las conexiones explícitas descritas en el apartado 3.

---

## 7. Verificación mediante pruebas automatizadas

### 7.1 Metodología

La corrección del comportamiento descrito en los apartados 4 y 5 no descansa únicamente en la revisión manual del código: está respaldada por una batería de pruebas automatizadas que se ejecuta directamente contra el archivo que se distribuye a las personas usuarias, y no contra una copia distinta usada solo internamente durante el desarrollo. Antes de ejecutar cualquier prueba, el propio proceso de verificación comprueba que el archivo entregado corresponde exactamente al código fuente del que procede; si no correspondiera, la ejecución se detiene con un error, precisamente para impedir que una prueba en apariencia satisfactoria esté validando una versión distinta de la que llegaría a la persona usuaria.

Esta forma de proceder asegura que lo que las pruebas certifican es, literalmente, el comportamiento del artefacto final, no el de una aproximación a él.

### 7.2 Alcance actual de la batería de pruebas

En la fecha de este documento, la batería está compuesta por 61 conjuntos de pruebas independientes, agrupados por área, y todos ellos superados sin ninguna incidencia en la última ejecución realizada para este estudio. Las áreas cubiertas incluyen, entre otras:

**Interpretación de archivos y formatos de origen**
- Lectura de archivos KML, con independencia del prefijo de espacio de nombres que use cada archivo.
- Reparación controlada de espacios de nombres mal declarados en un KML (ver apartado 5.2).
- Conversión del formato TopoJSON al formato GeoJSON equivalente.
- Ortofotos COG: sistemas de coordenadas admitidos y lectura de los que declara la imagen, elección del nivel de detalle y de la ventana que se lee, muestreo de cada píxel sin mezclar colores (con máscara, valor sin dato y transparencia propia), qué copias del almacén ya no nombra nadie, validación de una referencia leída de fuera, y que una exportación las deja fuera.
- Comprobaciones estáticas sobre el propio archivo de la aplicación, entre ellas que ningún nombre de función o constante se declare dos veces (la segunda declaración anularía en silencio a la primera).
- Importación de shapefiles: agrupación de sus piezas (y aviso de las que llegan sin su geometría), codificación de los textos, reconocimiento de un shapefile comprimido descargado de una dirección, el caso sin sistema de coordenadas declarado, el cambio de datum de ED50 y la conversión de coordenadas en su sitio.
- Resolución de las imágenes de referencia (ortofotos superpuestas) contenidas dentro de un archivo KMZ.
- Generación del informe de importación: qué se cargó, qué se omitió y por qué.
- Detección y limpieza, bajo confirmación, de marcado de tipo HTML en nombres y atributos (ver apartado 5.3).

**Integridad geométrica y numérica**
- Validación de coordenadas y el margen de tolerancia de redondeo descrito en el apartado 5.2, incluyendo los casos límite que deben aceptarse y los que deben rechazarse.
- Conversión de coordenadas al sistema UTM y verificación de husos, incluidas sus excepciones geográficas reales.
- Formato de coordenadas en las distintas notaciones que ofrece la aplicación (grados decimales; grados, minutos y segundos).
- Cálculo del ángulo de elevación entre dos alturas (plano, esfera y esfera con refracción 4/3), con distancia de superficie u oblicua, del cono de silencio y de la corrección de la altura por presión atmosférica según la atmósfera estándar (contrastada con la tabla publicada de presiones, con fórmulas cerradas independientes por capa y con la continuidad en la tropopausa), y del vector entre dos posiciones con altitud (distancia, distancia horizontal y orientación); todo contrastado con una formulación independiente y con rechazo de datos no válidos.
- Cálculo de perímetros y superficies de polígonos, incluidos anillos abiertos o cerrados, huecos interiores y multipolígonos.
- Tratamiento de formas geométricas abiertas (una línea no tiene superficie ni puede rellenarse).
- Mediciones de ruta con varios tramos: distancia y rumbo de cada tramo por separado y el total, con su propia numeración independiente de la de las figuras dibujadas.
- Edición interactiva de vértices de un polígono o de los waypoints de una ruta ya creados (arrastrar, insertar, borrar), con el mínimo exigido por anillo y un tope configurable de cuántos vértices reciben manejador en el mapa, siempre bajo edición diferida (revertible con «Cancelar»).

**Consistencia y deduplicación**
- Fusión de marcadores duplicados por nombre y posición, tanto en archivos KML como en archivos GeoJSON, siempre bajo confirmación del usuario (ver apartado 5.2).

**Modelos de elevación del terreno**
- Catálogo de servicios de elevación por conjunto de datos (contrastado con los identificadores que declara el IGN) y validación de la elección guardada contra él; elección de la cobertura de malla más fina dentro de cada conjunto y del formato de texto (ASCII) antes que el binario (GeoTIFF); lectura de rejillas en los dos formatos (con una respuesta real de Digital Earth Africa) y de las descripciones de cobertura del IGN y de Digital Earth Africa; tratamiento de la falta de cobertura como ausencia de dato, nunca como valor; combinación del terreno y la superficie por posición, también con mallas de distinto tamaño; reintentos solo ante fallos pasajeros, con su número y su pausa; y el cálculo del perfil de una ruta (un punto por celda recorrida, vértices exactamente en la suma de los tramos, huecos donde no hay dato, la posición en el mapa de cada punto de la gráfica, las celdas guardadas con la regla de la malla más fina y la validación de un perfil guardado).
- Descubrimiento de las capas disponibles del servicio de ortofoto histórica del IGN.
- Configuración y uso de la credencial propia del usuario para el servicio Copernicus DEM.

**Mapa base configurable por el usuario ("Custom Maps")**
- Validación de la dirección del servidor de teselas (exige cifrado, rechaza texto sin forma de dirección válida), normalización antes de construir la petición y verificación de que la plantilla final se genera de forma correcta.

**Comportamiento de la interfaz y del árbol de capas**
- Navegación y selección de elementos en el árbol de capas.
- Accesibilidad del árbol de navegación para tecnología de asistencia.
- Comportamiento del tercer estado (indeterminado) de una carpeta cuando su contenido está parcialmente activo.
- Construcción diferida de árboles de gran tamaño sin bloquear la interfaz.
- Edición conjunta de varios elementos a la vez, sin aplicar por error un valor no confirmado a todos ellos.
- Registro de avisos de la sesión, incluida la fusión de avisos repetidos.

**Comprobaciones sobre el propio artefacto entregado**
- Que todo elemento de la interfaz referenciado internamente exista realmente.
- Que toda función invocada esté efectivamente definida en el archivo entregado.
- Que la versión visible en la aplicación y el enlace al repositorio público sean correctos.
- Que el archivo optimizado para su publicación en línea se comporte exactamente igual que el archivo legible que constituye el producto de referencia.

**Pruebas de extremo a extremo sobre un navegador real**
- Arranque correcto de la aplicación, tanto en su versión legible como en la optimizada para publicación.
- Copiar y pegar información entre dos instancias de la aplicación abiertas en orígenes distintos, usando el portapapeles real del sistema operativo.
- Comportamiento correcto del filtrado de marcado HTML en propiedades de un GeoJSON, de principio a fin.
- Redimensionado correcto de las ventanas de diálogo.
- Recalculo correcto del estado de una carpeta al mover un elemento de una rama a otra del árbol.
- Edición conjunta de varios elementos en un navegador real.
- Comportamiento correcto al desplegar y activar a la vez una carpeta con un gran número de elementos.
- Conservación del icono personalizado de un marcador, restaurado desde el almacenamiento local, al activarlo dentro de una carpeta que nunca ha llegado a desplegarse.
- Comportamiento correcto de la función de añadir contenido desde una dirección web, incluida su cancelación.
- Ortofotos COG con la lectura y la reproyección reales: imágenes fabricadas por la propia prueba, con un color por cuadrante, en ETRS89 UTM 30N y en Web Mercator, comprobadas en el lienzo del mapa (cada cuadrante en su sitio, también con el mapa girado); el nivel reducido al alejarse; la diferencia entre la malla de proyección y la proyección exacta, por debajo de una vigésima de píxel; opacidad; persistencia al recargar desde el almacenamiento del navegador; deshacer un borrado; la limpieza de copias sin dueño al arrancar; el rechazo, sin dejar restos, de una imagen en un sistema no admitido o de 16 bits; y que una base de datos de la versión anterior conserva su árbol al actualizarse.
- Importación de shapefiles con la lectura y la reproyección reales: un punto conocido en ETRS89 UTM 30N cae a menos de medio metro de su posición, textos con tildes en las dos codificaciones habituales, polígonos con agujeros, ED50 desplazado lo que corresponde y advertido, rechazo sin restos de un archivo métrico sin sistema declarado, un .zip con varias capas y su descarga desde una dirección.
- Límite del desplazamiento del mapa a una única representación del planeta, sin duplicados horizontales.
- Selección, inserción y borrado de vértices sobre el mapa en una ruta o un polígono ya creados, activos únicamente mientras su diálogo de propiedades está abierto.
- Creación de una ruta de medición como una edición en vivo desde su segundo waypoint, con el diálogo de propiedades ya abierto y actualizándose a cada punto añadido.
- Repintado en vivo de las cifras del diálogo de una medición mientras se arrastra uno de sus manejadores, y encuadre de toda su geometría con margen al pulsar el botón de enfoque.
- El menú contextual del visor abre «Editar propiedades» directamente sobre la capa señalada. Ese diálogo incluye una pestaña «Atributos» con la misma ficha que «Mostrar atributos» (`infoHtmlFor`, ya saneada por `sanitizeHtml` o escapada): no añade superficie nueva.
- El panel «Propiedades»: unidades de distancia y de altitud y formato de coordenadas globales, con vista previa en vivo sobre un diálogo ya abierto y aplicación real solo al pulsar «Aceptar».
- La consulta de elevación con los servicios simulados: elección de fuentes en «Propiedades» (con Cancelar y Aceptar), consulta desde el menú contextual, una capa por consulta en una carpeta por sesión, ninguna petición al servicio en «Ninguna» ni fuera de la cobertura declarada, descubrimiento de cada servicio una sola vez por sesión y anotado en el registro, lectura de una respuesta GeoTIFF real, cifras en la unidad de altitud elegida (independiente de la de distancia), petición del conjunto de datos elegido (MDT25) y nombre de cada capa con su conjunto y proveedor, y recuperación de dos errores pasajeros seguidos sin aviso al usuario.
- El perfil de una ruta con el MDT y el MDS simulados: descarga por zonas de las dos fuentes con barra de progreso, gráfica con una curva por modelo y los vértices de los tramos en sus distancias exactas, solo las celdas recorridas guardadas en el árbol, un perfil ya guardado que se vuelve a mostrar sin ninguna petición (también tras recargar) y deja de valer al cambiar la forma de la ruta, la flecha del mapa sobre el punto de la ruta que marca la gráfica, zonas sin respuesta como huecos declarados, cancelación sin efectos y límite de longitud; el detalle de depuración de la descarga (una línea por cada petición lanzada, con su dirección, y por lo recibido, incluidos los intentos fallidos con su espera) en un registro con scroll propio que no agranda la ventana.
- La calculadora geodésica: ángulo de elevación con cono de silencio y corrección por presión, y vector GPS; cálculo inmediato al cambiar cualquier dato, sin avisos mientras faltan datos, unidades independientes por campo que convierten su valor, ventana que no cambia de tamaño al calcular y validación de los datos, sin ninguna petición de red.

### 7.3 Integración continua

Esta batería de pruebas se ejecuta de forma obligatoria en cada cambio propuesto sobre el código, antes de que ese cambio pueda incorporarse a la versión publicada, mediante un sistema de integración continua automatizado. Las pruebas que requieren un navegador real —que verifican, entre otras cosas, el comportamiento del portapapeles del sistema operativo entre distintos orígenes— son obligatorias en ese proceso automatizado, de forma que ningún cambio se publica sin haberlas superado.

### 7.4 Resultado verificado para este documento

Como parte de la elaboración de este estudio se ha vuelto a ejecutar la batería completa de pruebas contra la versión de la aplicación identificada en la cabecera de este documento. Resultado: **61 de 61 conjuntos de pruebas superados, sin ninguna incidencia.**

---

## 8. Alcance previsto y advertencia de uso

KITE Local es una herramienta de **visualización y consulta** de información geoespacial ya existente, no una fuente de información aeronáutica ni un sistema de planificación certificado. En consecuencia:

- La aplicación muestra exactamente la información contenida en los archivos que el usuario decide cargar, en los términos descritos en el apartado 5; no la genera, no la completa y no emite ningún juicio sobre su vigencia, su exactitud operativa ni su idoneidad para una operación concreta.
- Ante cualquier discrepancia entre lo representado en la aplicación y una publicación oficial (por ejemplo, la Publicación de Información Aeronáutica, un NOTAM o cualquier otra fuente de la autoridad competente), prevalece siempre la fuente oficial.
- La responsabilidad sobre qué archivos se cargan, de qué fuente proceden y con qué vigencia se usan corresponde a la persona usuaria de la aplicación.

Esta acotación no debilita las garantías descritas en este documento —el origen declarado de la cartografía de referencia (apartado 4), la ausencia de alteración de los datos cargados (apartado 5) y su verificación mediante pruebas automatizadas (apartado 7)—; las sitúa en su papel correcto: KITE Local garantiza que lo que se ve en pantalla es fiel a lo que había en el archivo de origen, no sustituye al juicio profesional ni a las fuentes oficiales sobre las que ese archivo, a su vez, se apoye.

---

## 9. Conclusión

Sobre la base de la revisión del código fuente, de la configuración de red y de seguridad declarada por la propia aplicación, y de la ejecución completa de su batería de pruebas automatizadas, este estudio concluye que:

1. El origen de cada fuente de cartografía y de cada servicio auxiliar que KITE Local puede consultar está identificado, documentado y restringido por configuración a una lista cerrada de proveedores oficiales o reconocidos, salvo dos excepciones deliberadas y acotadas en las que el propio usuario elige el origen (descargar un archivo desde una dirección, y el mapa base "Custom Maps" contra un servidor de teselas propio), ambas descritas en el apartado 6.2.
2. KITE Local no modifica la geometría, las coordenadas ni la altitud de los datos que carga y representa; las únicas intervenciones automáticas están acotadas a corregir errores menores y evitables del propio archivo de origen, tienen un alcance mínimo y verificable, y se comunican siempre a la persona usuaria.
3. Este comportamiento está verificado por una batería de 60 conjuntos de pruebas automatizadas, ejecutadas contra el artefacto realmente distribuido, con resultado íntegramente satisfactorio en la fecha de este documento.

Estas tres garantías, tomadas en conjunto, sustentan el uso de KITE Local como herramienta de consulta y visualización fiel de información geoespacial dentro del alcance descrito en el apartado 8.
