/* ================= Idiomas de la interfaz ================= */
/* El texto en ESPAÑOL es la clave: tr("Cancelar") devuelve "Cancelar" en
   español y lo que diga el diccionario en cualquier otro idioma. Así el
   español no necesita diccionario, una traducción que falta se ve en
   español (nunca una clave opaca) y migrar un literal es envolverlo.

   Un idioma se añade con UN archivo (`04-i18n-xx.js`, que llama a
   registerLang) y UNA línea en el manifiesto de build.js; ver i18n.md.

   El idioma queda fijado por 04-i18n-init.js, después de los
   diccionarios y antes del resto del código: desde ahí tr() puede
   llamarse en cualquier sitio, también en el nivel superior.            */

const SOURCE_LANG = "es";
/* código → nombre del idioma EN ese idioma (lo que ve quien lo busca).
   El orden de registro es el del selector.                            */
const UI_LANGS = { [SOURCE_LANG]: "Español" };
const I18N_DICT = {};
/* Idioma al que se recurre cuando el elegido no traduce una cadena,
   antes de caer al español de la clave.                                 */
const FALLBACK_LANG = "en";

function registerLang(code, name, dict) {
  UI_LANGS[code] = name;
  I18N_DICT[code] = dict;
}

let uiLang = SOURCE_LANG;
let uiLangChain = [SOURCE_LANG];

/* Idioma efectivo para una preferencia ("auto" o un código): "auto"
   toma el primero de los idiomas del navegador que tengamos (por su
   código base: "fr-CA" → "fr") y, si ninguno, el de respaldo.         */
function resolveUiLang(pref, navLangs) {
  if (pref && pref !== "auto" && UI_LANGS[pref]) return pref;
  for (const l of navLangs || []) {
    const base = String(l).toLowerCase().split("-")[0];
    if (UI_LANGS[base]) return base;
  }
  return FALLBACK_LANG;
}

function setUiLang(code) {
  uiLang = UI_LANGS[code] ? code : FALLBACK_LANG;
  uiLangChain = [...new Set([uiLang, FALLBACK_LANG, SOURCE_LANG])];
  if (typeof document !== "undefined") document.documentElement.lang = uiLang;
}

/* {nombre} → vars.nombre. Lo que no está en vars se deja tal cual: una
   llave suelta en un texto sin variables no se toca.                   */
function fillVars(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/* Traducción de `key` (texto en español) en el primer idioma de la
   cadena que la tenga. Las variables se sustituyen DESPUÉS, así que
   quien las escapa para HTML sigue siendo quien las pasa.             */
function tr(key, vars) {
  for (const code of uiLangChain) {
    if (code === SOURCE_LANG) break;
    const v = I18N_DICT[code] && I18N_DICT[code][key];
    if (typeof v === "string" && v) return fillVars(v, vars);
  }
  return fillVars(key, vars);
}

/* Texto con CONTEXTO, para dos textos que en español son idénticos y en
   otro idioma se dicen distinto («Longitud» de un punto y de una línea).
   La entrada del diccionario es `contexto + "\u0004" + texto`; si un idioma
   no la tiene se sigue por inglés y, al final, el español, NUNCA por la
   entrada del texto sin contexto (sería la palabra equivocada).          */
function trc(ctx, key, vars) {
  for (const code of uiLangChain) {
    if (code === SOURCE_LANG) break;
    const v = I18N_DICT[code] && I18N_DICT[code][ctx + "\u0004" + key];
    if (typeof v === "string" && v) return fillVars(v, vars);
  }
  return fillVars(key, vars);
}

/* Marca un texto en español que se traduce MÁS TARDE, al usarlo (un
   dato de una tabla, una constante): no hace nada, pero el extractor lo
   cuenta como clave. En el punto de uso va tr(dato).                    */
const N_ = s => s;

/* Plural: `one` y `other` son las dos formas EN ESPAÑOL (la clave es
   `other`). Un idioma con más formas las da en su entrada del
   diccionario como objeto { one, few, many, other } según
   Intl.PluralRules; una cadena sola vale para todos los números. {n}
   queda disponible además de `vars`.                                   */
const pluralRules = new Map();
function pluralCategory(code, n) {
  let r = pluralRules.get(code);
  if (!r) pluralRules.set(code, r = new Intl.PluralRules(code));
  return r.select(n);
}
function trn(n, one, other, vars) {
  const all = { n, ...vars };
  for (const code of uiLangChain) {
    if (code === SOURCE_LANG) break;
    const v = I18N_DICT[code] && I18N_DICT[code][other];
    if (typeof v === "string" && v) return fillVars(v, all);
    if (v && typeof v === "object") {
      const form = v[pluralCategory(code, n)] || v.other;
      if (form) return fillVars(form, all);
    }
  }
  return fillVars(pluralCategory(SOURCE_LANG, n) === "one" ? one : other, all);
}

/* ---- HTML estático ----
   El texto de index.html está en español y se traduce al arrancar,
   buscando cada fragmento por su texto: nodos de texto sueltos y los
   atributos de texto. Un elemento con marcado en medio (<b>, <kbd>)
   que no se puede partir sin romper el orden de las palabras lleva
   data-i18n-html="identificador": su innerHTML entero es la entrada del
   diccionario con ese identificador (no su texto, porque cada navegador
   serializa el HTML a su manera). Sin entrada, se queda en español.
   Los fragmentos de texto pasan por tr() con los espacios colapsados.   */
const I18N_ATTRS = ["title", "aria-label", "placeholder", "alt"];

function i18nNorm(s) { return s.replace(/\s+/g, " ").trim(); }

/* Recorre `root` y llama a visit(clave, aplicar, esHtml) por cada
   fragmento traducible; aplicar(texto) lo sustituye. Lo usan el
   traductor y el test que comprueba que no queda nada sin diccionario. */
function walkI18nDom(root, visit) {
  const doc = root.ownerDocument || root;
  for (const el of root.querySelectorAll("[data-i18n-html]")) {
    visit(el.getAttribute("data-i18n-html"), txt => { el.innerHTML = txt; }, true);
  }
  const skip = n => {
    for (let p = n.parentElement; p; p = p.parentElement) {
      const tag = p.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || p.hasAttribute("data-i18n-html")) return true;
    }
    return false;
  };
  /* Un texto con entidades (&#243;) puede llegar partido en varios nodos
     seguidos, según el analizador: se juntan para que la clave sea la
     frase entera, también en las pruebas que leen el HTML sin navegador.  */
  root.normalize();
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
  for (const n of texts) {
    const key = i18nNorm(n.data);
    if (!key || skip(n)) continue;
    visit(key, txt => {
      const lead = n.data.match(/^\s*/)[0], trail = n.data.match(/\s*$/)[0];
      n.data = lead + txt + trail;
    }, false);
  }
  for (const attr of I18N_ATTRS) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const key = i18nNorm(el.getAttribute(attr));
      if (key) visit(key, txt => el.setAttribute(attr, txt), false);
    }
  }
}

function translateDom(root) {
  if (uiLang === SOURCE_LANG) return;
  walkI18nDom(root, (key, apply) => {
    const txt = tr(key);
    if (txt !== key) apply(txt);
  });
}

/* ---- Preferencia ----
   Vive en localStorage y NO en IndexedDB como el resto de ajustes: hace
   falta de forma SÍNCRONA antes de ejecutar nada más (los controles del
   visor se crean al cargar el script y ya llevan su texto), y leer
   IndexedDB es asíncrono. Si el almacenamiento no está disponible
   (ventana privada, bloqueado) la preferencia no se recuerda y manda
   «Automático».                                                         */
const UI_LANG_PREF_KEY = "kite.uiLang";

function loadUiLangPref() {
  try {
    const v = localStorage.getItem(UI_LANG_PREF_KEY);
    return v && UI_LANGS[v] ? v : "auto";
  } catch { return "auto"; }
}

function saveUiLangPref(pref) {
  try {
    if (pref === "auto" || !UI_LANGS[pref]) localStorage.removeItem(UI_LANG_PREF_KEY);
    else localStorage.setItem(UI_LANG_PREF_KEY, pref);
  } catch { /* sin almacenamiento: no se recuerda */ }
}
