# Estudio de seguridad de KITE Local

## Origen de los datos, integridad de la información representada y verificación mediante pruebas automatizadas

| | |
|---|---|
| **Documento** | Estudio de seguridad — KITE Local (KML Interactive Tree Explorer) |
| **Versión del documento** | 1.0 |
| **Fecha** | 14 de septiembre de 2026 |
| **Preparado por** | Diego Torres |
| **Versión de la aplicación auditada** | v1.2.1 (202609151429) |
| **Repositorio público del código fuente** | https://github.com/ifsnop/kite |

---

## 1. Resumen ejecutivo

KITE Local es una aplicación de visualización y consulta de información geoespacial (archivos KML, KMZ, GeoJSON y TopoJSON) que se ejecuta íntegramente en el navegador del usuario, sin ningún servidor propio que reciba, procese o almacene los datos cargados. Este documento se ha elaborado para dejar constancia, de forma verificable, de tres garantías sobre las que descansa la fiabilidad de la herramienta como instrumento de consulta:

1. **El origen de cada capa de información es conocido, declarado y verificable.** Tanto la cartografía de fondo como los servicios auxiliares (elevación del terreno, búsqueda de topónimos) proceden de organismos oficiales o de proveedores identificados, y la propia aplicación restringe por configuración los orígenes de red a los que puede conectarse.
2. **La aplicación no modifica los datos geoespaciales que muestra.** La geometría, las coordenadas y la altitud de cada elemento cargado se conservan tal como están definidas en el archivo de origen a lo largo de todo el ciclo de vida (carga, visualización, guardado y exportación). Las únicas excepciones son un número reducido de correcciones controladas, de alcance mínimo, siempre notificadas al usuario y nunca aplicadas en silencio, que se describen en detalle en el apartado 4.
3. **El comportamiento descrito está verificado mediante una batería de pruebas automatizadas** que se ejecuta contra el propio archivo que se distribuye —no contra una copia aparte del código— y que en la fecha de este documento supera sus 51 conjuntos de comprobaciones sin ninguna incidencia.

El documento está dirigido a personal auditor y experto en seguridad, no a personal programador: describe el comportamiento de la aplicación, su alcance y sus garantías, sin entrar en detalles de implementación.

---

## 2. Objeto y alcance

Este estudio tiene por objeto proporcionar a AESA/EASA, o a cualquier auditoría de seguridad que lo requiera, evidencia documental sobre:

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

La aplicación incorpora, apagados por defecto salvo la capa base de OpenStreetMap, un conjunto cerrado de fuentes de cartografía de fondo y modelos de elevación del terreno. Ninguna otra fuente puede añadirse sin modificar y volver a distribuir la propia aplicación (ver la restricción de red del apartado 6.2).

| Capa | Proveedor / organismo | Naturaleza del dato |
|---|---|---|
| OpenStreetMap | Fundación OpenStreetMap | Cartografía base colaborativa, activa por defecto |
| Físico (Esri World Terrain) | Esri | Cartografía de relieve mundial |
| IGN Base | Instituto Geográfico Nacional (España) | Cartografía base oficial |
| Mapa topográfico MTN | Instituto Geográfico Nacional (España) | Cartografía topográfica oficial (ráster del Mapa Topográfico Nacional) |
| Relieve sombreado | Esri | Sombreado de relieve mundial |
| Ortofoto PNOA (Máxima Actualidad) | Instituto Geográfico Nacional (España) | Ortofotografía aérea oficial del Plan Nacional de Ortofotografía Aérea |
| PNOA histórico | Instituto Geográfico Nacional (España) | Serie histórica de ortofotografías del PNOA, por años disponibles |
| Modelo Digital del Terreno de España (WMS) | Instituto Geográfico Nacional (España) | Elevación del terreno (servicio de mapas, para visualización) |
| Relieve SRTM30 | terrestris (servicio público sin coste, cobertura entre 56° S y 60° N) | Sombreado de relieve global derivado de la misión SRTM |
| Copernicus DEM | Copernicus Data Space / Sentinel Hub, bajo credencial propia del usuario | Modelo digital de superficie global |

Además, dos servicios de consulta puntual, no cartografiados como capa de fondo:

- **Modelo Digital del Terreno y Modelo Digital de Superficie del Instituto Geográfico Nacional** (servicios de cobertura del propio IGN), usados por la función de lectura de altitud bajo el cursor. Ofrecen altitud ortométrica (sobre el nivel medio del mar), con cobertura limitada al territorio español.
- **Nominatim**, el servicio de geocodificación de OpenStreetMap, usado exclusivamente por el buscador de lugares del panel. La consulta se realiza únicamente cuando el usuario pulsa el botón de búsqueda o la tecla Intro —nunca mientras escribe— y respetando el límite de una petición por segundo que exige la política de uso pública de ese servicio.

Cada capa de cartografía activada muestra en el pie del visor la atribución del proveedor correspondiente, tal y como exigen las licencias de uso de esos servicios (por ejemplo, la licencia CC BY 4.0 del IGN o la atribución de OpenStreetMap).

### 4.2 Datos aportados por el usuario

El resto de la información que puede verse en KITE Local procede exclusivamente de archivos que el propio usuario carga de forma voluntaria: archivos KML y KMZ, GeoJSON y TopoJSON, o su propio formato de intercambio interno (usado para exportar e importar una carpeta de capas entre sesiones o entre instalaciones de la misma aplicación). También puede cargarse un archivo desde una dirección web indicada por el usuario, con el mismo tratamiento que un archivo local. Estos archivos son responsabilidad de quien los proporciona; KITE Local no genera, completa ni infiere ninguna información geoespacial por cuenta propia: se limita a interpretar y representar lo que el archivo contiene.

---

## 5. Principio de no alteración de los datos representados

Este es el punto central del presente estudio: **KITE Local no interpreta, recalcula ni modifica la geometría, las coordenadas ni la altitud de los elementos que carga.** Lo que se dibuja en el mapa, lo que se guarda y lo que se exporta es, en todos los casos, una reproducción fiel del archivo de origen.

### 5.1 Conservación de la geometría a lo largo de todo el ciclo de vida

La posición (latitud y longitud) y la altitud de cada punto se leen literalmente del archivo cargado y se conservan sin cambios a través de todas las operaciones internas de la aplicación: la visualización en el mapa, el guardado automático entre sesiones, y la exportación posterior a un archivo. La altitud, en particular, se transporta de forma explícita en todo ese recorrido y solo se omite cuando el propio archivo de origen no la incluye: la aplicación nunca añade un valor de altitud que el archivo original no traía.

Cuando el usuario modifica de forma intencionada un elemento —por ejemplo, arrastrando un marcador en el mapa o editando manualmente una lista de coordenadas desde el diálogo pensado para ello— ese cambio es una acción explícita y deliberada de la persona usuaria, claramente distinta de cualquier alteración automática por parte de la aplicación. Del mismo modo, personalizar el color, el icono o el grosor con que se representa un elemento es un ajuste puramente visual: no toca en ningún caso su posición ni su geometría.

### 5.2 Las únicas transformaciones automáticas, y por qué no comprometen la integridad del dato

Existen exactamente cuatro situaciones en las que la aplicación interviene sobre lo leído de un archivo, y todas comparten tres características: tienen un propósito de preservación de la información (evitar perder datos por errores menores y evitables del propio archivo), tienen un alcance mínimo y acotado, y se comunican siempre al usuario en el resumen de la carga, nunca de forma silenciosa.

1. **Corrección de errores de redondeo de coma flotante en coordenadas al límite de rango.** Es habitual que un archivo, tras haber pasado por procesos de reproyección de coordenadas en otro programa, contenga una longitud o latitud que se sale del rango válido por una cantidad ínfima (del orden de una diezmilésima de grado, equivalente a unos pocos centímetros sobre el terreno), en vez de por un error real de los datos. KITE Local ajusta ese valor al límite válido más cercano únicamente cuando la desviación es menor que un margen fijo y muy estrecho (aproximadamente 0,00001 grados, del orden de un metro sobre el terreno); cualquier desviación mayor se sigue rechazando como dato inválido. Cada ajuste realizado se cuenta y se informa al usuario en el resumen de la importación: nunca se corrige en silencio.
2. **Fusión de marcadores duplicados, solo bajo confirmación explícita del usuario.** Algunos programas exportan el mismo elemento por duplicado (mismo nombre y misma posición). Al detectar este patrón, la aplicación pregunta al usuario si desea fusionarlos; si no se confirma, los duplicados se cargan tal cual venían en el archivo. No hay fusión automática sin esa confirmación.
3. **Reparación de espacios de nombres XML mal declarados.** Algunos archivos KML, aun siendo aceptados por otros programas, contienen un error de formato (un prefijo usado pero no declarado) que un analizador de XML estándar rechaza en bloque, perdiéndose el archivo entero. KITE Local detecta este caso concreto, lo repara de forma mínima para poder leer el archivo y anota la reparación en el informe de importación. Esta reparación afecta solo a la estructura del documento XML, nunca a los valores de coordenadas, nombres o atributos.
4. **Limpieza de etiquetas de tipo HTML incrustadas en nombres o en atributos descriptivos, solo bajo confirmación del usuario.** Es una medida de seguridad de la interfaz (evitar que un archivo ajeno pueda inyectar marcado HTML en el panel de la aplicación), no una alteración del dato geoespacial: no toca la geometría, la posición ni la altitud, y solo actúa sobre el texto visible de nombres y de atributos descriptivos, y únicamente cuando el usuario lo confirma.

Fuera de estos cuatro casos, acotados y siempre comunicados, ningún otro proceso de la aplicación modifica el contenido de un archivo cargado.

### 5.3 Saneado de la información descriptiva: una medida de seguridad, no de contenido geoespacial

Además de lo anterior, el texto descriptivo asociado a un elemento (la ficha de información que puede llevar un KML, con formato HTML embebido) pasa por un filtro de seguridad antes de mostrarse: se eliminan las etiquetas y los atributos que podrían ejecutar código o cargar contenido de orígenes no controlados, conservando siempre el texto. Esta medida protege a la persona usuaria frente a un archivo manipulado con fines maliciosos; no afecta en ningún caso a las coordenadas, la altitud ni a ningún otro dato geoespacial del elemento, que quedan fuera de este filtro por no ser contenido HTML.

### 5.4 Aislamiento de errores por elemento

Cuando un archivo contiene un elemento con datos defectuosos (una geometría incompleta, unas coordenadas fuera de rango por encima del margen de tolerancia descrito, o una referencia rota), ese elemento concreto se descarta de forma aislada y el resto del archivo se sigue cargando con normalidad: un solo dato erróneo no invalida ni corrompe la importación completa. Al finalizar la carga, la aplicación presenta siempre un resumen con el número de elementos cargados, los tipos detectados, los elementos omitidos y la causa de cada omisión, de modo que la persona usuaria conoce en todo momento qué se ha incorporado y qué no, y por qué.

Si la construcción de un archivo se interrumpe a mitad de proceso (por ejemplo, por un fallo inesperado), lo que se hubiera llegado a incorporar se retira por completo: la aplicación nunca deja una importación a medias en el árbol de capas.

### 5.5 Límites frente a archivos comprimidos desproporcionados o manipulados

Los archivos KMZ (KML comprimido) se someten a comprobaciones antes de descomprimirse: un número máximo de archivos dentro del comprimido (2000), un tamaño máximo una vez descomprimido (300 megabytes) y una relación máxima entre el tamaño descomprimido y el comprimido (200 veces). Estas cotas evitan que un archivo comprimido de forma desproporcionada o deliberadamente hostil ("bomba de descompresión") agote los recursos del dispositivo antes de que la aplicación pueda siquiera informar del problema.

---

## 6. Integridad y procedencia verificable de los componentes de la aplicación

### 6.1 Verificación criptográfica de las librerías de terceros

KITE Local reutiliza un número reducido de bibliotecas de software de terceros, ampliamente usadas y estables, en lugar de reescribir funcionalidad ya resuelta: una biblioteca de mapas interactivos, una de descompresión de archivos, una de conversión de un formato cartográfico adicional (TopoJSON) y una de generación de imágenes para la exportación a PNG. Las cuatro se cargan desde redes de distribución de contenido públicas y reconocidas, y las cuatro llevan asociado un mecanismo de verificación de integridad criptográfica (subresource integrity): el navegador calcula la huella del archivo recibido y la compara con la huella declarada por la propia aplicación antes de ejecutarlo. Si un proveedor de contenidos fuera comprometido y sirviera un archivo distinto del esperado, el navegador lo bloquearía y no se ejecutaría, en lugar de ejecutar código no verificado.

### 6.2 Política de seguridad de contenido con lista cerrada de orígenes

La aplicación declara una política de seguridad de contenido (Content Security Policy) que restringe, a nivel de navegador, con qué orígenes puede comunicarse o de qué orígenes puede cargar código o estilos. Por defecto, todo está denegado; se autoriza explícitamente, uno a uno, cada origen necesario: las dos redes de distribución de las bibliotecas de terceros para código y para hojas de estilo, y la lista cerrada de servicios cartográficos oficiales enumerados en el apartado 4.1 para imágenes de mapa. Ningún origen no declarado en esa lista puede servir código, estilos o imágenes de mapa a la aplicación, aunque el código de la propia aplicación intentara solicitarlo.

La única excepción deliberada es la función de "añadir desde una dirección", que por su propia naturaleza debe poder conectarse a un origen que decide el usuario en el momento de usarla —el origen es, precisamente, lo que el usuario escribe—. Esa conexión se permite solo hacia direcciones cifradas (https), nunca hacia direcciones sin cifrar (http), de modo que una aplicación servida de forma segura no pueda verse forzada a comunicarse por un canal inseguro. El resto de restricciones (qué puede ejecutar código, qué puede aportar estilos, qué imágenes de mapa se aceptan) permanece con su lista cerrada intacta.

### 6.3 Sin telemetría ni almacenamiento remoto

KITE Local no incorpora ningún mecanismo de telemetría, analítica de uso ni envío de informes de error a un servidor propio o de terceros. El único almacenamiento persistente de los datos cargados es local, dentro del propio navegador del usuario, en su propio dispositivo; no se sincroniza ni se replica a ningún servidor. La aplicación puede usarse, de hecho, completamente desconectada de red salvo por las conexiones explícitas descritas en el apartado 3.

---

## 7. Verificación mediante pruebas automatizadas

### 7.1 Metodología

La corrección del comportamiento descrito en los apartados 4 y 5 no descansa únicamente en la revisión manual del código: está respaldada por una batería de pruebas automatizadas que se ejecuta directamente contra el archivo que se distribuye a las personas usuarias, y no contra una copia distinta usada solo internamente durante el desarrollo. Antes de ejecutar cualquier prueba, el propio proceso de verificación comprueba que el archivo entregado corresponde exactamente al código fuente del que procede; si no correspondiera, la ejecución se detiene con un error, precisamente para impedir que una prueba en apariencia satisfactoria esté validando una versión distinta de la que llegaría a la persona usuaria.

Esta forma de proceder asegura que lo que las pruebas certifican es, literalmente, el comportamiento del artefacto final, no el de una aproximación a él.

### 7.2 Alcance actual de la batería de pruebas

En la fecha de este documento, la batería está compuesta por 51 conjuntos de pruebas independientes, agrupados por área, y todos ellos superados sin ninguna incidencia en la última ejecución realizada para este estudio. Las áreas cubiertas incluyen, entre otras:

**Interpretación de archivos y formatos de origen**
- Lectura de archivos KML, con independencia del prefijo de espacio de nombres que use cada archivo.
- Reparación controlada de espacios de nombres mal declarados en un KML (ver apartado 5.2).
- Conversión del formato TopoJSON al formato GeoJSON equivalente.
- Resolución de las imágenes de referencia (ortofotos superpuestas) contenidas dentro de un archivo KMZ.
- Generación del informe de importación: qué se cargó, qué se omitió y por qué.
- Detección y limpieza, bajo confirmación, de marcado de tipo HTML en nombres y atributos (ver apartado 5.3).

**Integridad geométrica y numérica**
- Validación de coordenadas y el margen de tolerancia de redondeo descrito en el apartado 5.2, incluyendo los casos límite que deben aceptarse y los que deben rechazarse.
- Conversión de coordenadas al sistema UTM y verificación de husos, incluidas sus excepciones geográficas reales.
- Formato de coordenadas en las distintas notaciones que ofrece la aplicación (grados decimales; grados, minutos y segundos).
- Cálculo de perímetros y superficies de polígonos, incluidos anillos abiertos o cerrados, huecos interiores y multipolígonos.
- Tratamiento de formas geométricas abiertas (una línea no tiene superficie ni puede rellenarse).

**Consistencia y deduplicación**
- Fusión de marcadores duplicados por nombre y posición, tanto en archivos KML como en archivos GeoJSON, siempre bajo confirmación del usuario (ver apartado 5.2).

**Modelos de elevación del terreno**
- Consulta y combinación de coberturas, formatos y rejillas del servicio de elevación del Instituto Geográfico Nacional.
- Descubrimiento de las capas disponibles del servicio de ortofoto histórica del IGN.
- Configuración y uso de la credencial propia del usuario para el servicio Copernicus DEM.

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
- Comportamiento correcto de la función de añadir contenido desde una dirección web, incluida su cancelación.
- Límite del desplazamiento del mapa a una única representación del planeta, sin duplicados horizontales.

### 7.3 Integración continua

Esta batería de pruebas se ejecuta de forma obligatoria en cada cambio propuesto sobre el código, antes de que ese cambio pueda incorporarse a la versión publicada, mediante un sistema de integración continua automatizado. Las pruebas que requieren un navegador real —que verifican, entre otras cosas, el comportamiento del portapapeles del sistema operativo entre distintos orígenes— son obligatorias en ese proceso automatizado, de forma que ningún cambio se publica sin haberlas superado.

### 7.4 Resultado verificado para este documento

Como parte de la elaboración de este estudio se ha vuelto a ejecutar la batería completa de pruebas contra la versión de la aplicación identificada en la cabecera de este documento. Resultado: **51 de 51 conjuntos de pruebas superados, sin ninguna incidencia.**

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

1. El origen de cada fuente de cartografía y de cada servicio auxiliar que KITE Local puede consultar está identificado, documentado y restringido por configuración a una lista cerrada de proveedores oficiales o reconocidos.
2. KITE Local no modifica la geometría, las coordenadas ni la altitud de los datos que carga y representa; las únicas intervenciones automáticas están acotadas a corregir errores menores y evitables del propio archivo de origen, tienen un alcance mínimo y verificable, y se comunican siempre a la persona usuaria.
3. Este comportamiento está verificado por una batería de 51 conjuntos de pruebas automatizadas, ejecutadas contra el artefacto realmente distribuido, con resultado íntegramente satisfactorio en la fecha de este documento.

Estas tres garantías, tomadas en conjunto, sustentan el uso de KITE Local como herramienta de consulta y visualización fiel de información geoespacial dentro del alcance descrito en el apartado 8.
