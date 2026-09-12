/* ¿Hay un navegador utilizable aquí?

   Se comprueba LANZÁNDOLO, no mirando si existe un archivo: es lo
   único que responde de verdad a la pregunta, y cuesta unos 100 ms.
   Un binario presente pero al que le falte una librería del sistema
   pasaría cualquier comprobación de ruta y luego fallaría en cada
   suite, que es peor que decirlo aquí una vez.

   Sale con 0 si se puede, con 1 si no; el motivo va por stderr para
   que el runner lo enseñe tal cual.                                  */
import { launch } from "./_browser.mjs";

try {
  const b = await launch();
  await b.close();
  process.exit(0);
} catch (err) {
  process.stderr.write(String(err && err.message ? err.message : err).split("\n")[0] + "\n");
  process.exit(1);
}
