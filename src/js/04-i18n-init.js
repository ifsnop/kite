/* Fija el idioma de la interfaz y traduce el HTML estático. Va DESPUÉS
   de todos los diccionarios (03-i18n.js los registra, 04-i18n-xx.js los
   rellena) porque resolver «Automático» necesita saber cuáles hay, y
   ANTES del resto: a partir de aquí tr() ya responde en el idioma
   elegido, también en el nivel superior de cualquier módulo.          */
setUiLang(resolveUiLang(loadUiLangPref(), navigator.languages));
translateDom(document.body);
/* Texto que el CSS pinta con content: no es DOM, así que no lo alcanza el
   traductor. Cada uno es una variable que el CSS lee (con el español de
   respaldo) y que se fija aquí.                                          */
document.documentElement.style.setProperty("--txt-mixed", JSON.stringify(" " + tr("(varios)")));
