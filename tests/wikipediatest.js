/* Nearby Wikipedia articles (67-wikipedia.js): the pure part, on the SHIPPED code.
   The responses in tests/fixtures/wikipedia-*.json are the REAL ones from the
   Spanish Wikipedia (2026-11-09), including the transient "search is too busy"
   error the service really returned while they were captured; what the real
   service cannot give on demand (hostile or broken data) is synthetic. The part
   that needs the network and the tree is in browser/wikipedia.mjs.           */
const fs = require("fs");
const path = require("path");
const { fn, between } = require("./_extract");

const pure = between("/* ===== Nearby Wikipedia articles", "/* ---------- Network and tree");
const src = between("const escapeHtml", "\n\n/* Leaflet layer behind") + "\n" + between("const METERS_PER_NM", "/* Una medida en la unidad elegida")
  + "\n" + between("const BADGED_ICONS", "function buildMarkerIcon") + "\nconst netFailText = g => `NET: ${g}`;\n"
  + pure + "\n" + fn("isRetryableElevError") + "\n"
  + "return { wikipediaLang, wikipediaCoord, wikipediaGeoUrl, wikipediaExtractsUrl, wikipediaArticleUrl,"
  + " cleanWikipediaText, wikipediaCheck, parseWikipediaGeosearch, parseWikipediaExtracts, wikipediaCardHtml,"
  + " isRetryableElevError, WIKIPEDIA_APIS, WIKIPEDIA_RADIUS_MIN_M, WIKIPEDIA_RADIUS_MAX_M, wikipediaRadius, WIKIPEDIA_LIMIT, WIKIPEDIA_EXTRACT_CHUNK,"
  + " WIKIPEDIA_MAX_EXTRACT, WIKIPEDIA_MAX_TITLE, wikipediaDistance, wikipediaWhy, wikipediaInRecords,"
  + " BADGED_ICONS, markerBadgeBackground, WIKIPEDIA_ICON, WIKIPEDIA_TRANSIENT };";
const api = new Function(src)();

let failed = 0, passed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.error("FAIL: " + m); } };
const fixture = n => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8"));
const throws = (f, m) => { try { f(); ok(false, m + " (did not throw)"); return null; } catch (e) { ok(true, m); return e; } };

const GEO = fixture("wikipedia-geosearch-madrid.json");
const EXT = fixture("wikipedia-extracts-madrid.json");
const BUSY = fixture("wikipedia-error-busy.json");
const SOL = { lat: 40.4169, lng: -3.7035 };

/* ---- Language: the interface's, or English ---- */
ok(api.wikipediaLang("es") === "es" && api.wikipediaLang("en") === "en", "es and en are served by their own Wikipedia");
for (const other of ["fr", "", undefined, null, "__proto__", "constructor", "toString", "ES"]) {
  ok(api.wikipediaLang(other) === "en", `an interface language without a server (${String(other)}) falls back to English`);
}

/* ---- The point that ends up in a URL ---- */
ok(api.wikipediaCoord({ lat: 40.4, lng: -3.7 }).lng === -3.7, "a valid point passes through");
ok(api.wikipediaCoord({ lat: 0, lng: 190 }).lng === -170 && api.wikipediaCoord({ lat: 0, lng: -190 }).lng === 170, "a longitude outside ±180 is wrapped");
ok(api.wikipediaCoord({ lat: "40.5", lng: "-3.5" }).lat === 40.5, "numeric strings are converted");
for (const bad of [null, undefined, {}, { lat: NaN, lng: 0 }, { lat: 91, lng: 0 }, { lat: -90.1, lng: 0 }, { lat: 0, lng: Infinity }, { lat: "a", lng: 0 }]) {
  throws(() => api.wikipediaCoord(bad), "an invalid point is rejected: " + JSON.stringify(bad));
}

/* ---- The geosearch request ---- */
const geoUrl = new URL(api.wikipediaGeoUrl("es", SOL, 5000));
ok(geoUrl.origin === "https://es.wikipedia.org" && geoUrl.pathname === "/w/api.php", "Spanish host and path: " + geoUrl.origin + geoUrl.pathname);
const got = Object.fromEntries(geoUrl.searchParams);
const expected = { action: "query", list: "geosearch", gscoord: "40.416900|-3.703500", gsradius: "5000", gslimit: "100",
  format: "json", formatversion: "2", origin: "*" };
ok(JSON.stringify(got) === JSON.stringify(expected), "exactly these parameters, nothing else: " + JSON.stringify(got));
ok(api.WIKIPEDIA_RADIUS_MIN_M === 10 && api.WIKIPEDIA_RADIUS_MAX_M === 10000, "the radius range is the service's own: 10 m to 10 km");
ok(new URL(api.wikipediaGeoUrl("es", SOL, 300)).searchParams.get("gsradius") === "300", "the radius asked for is the one in the URL");
for (const bad of [9, 10001, 20000, 0, -5, 123.5, NaN, Infinity, "5000", null, undefined, true]) {
  throws(() => api.wikipediaGeoUrl("es", SOL, bad), "a radius outside the range or not a whole number never reaches a URL: " + String(bad));
}

/* ---- The radius is what the view covers, inside the service's range ---- */
ok(JSON.stringify(api.wikipediaRadius(2400.2)) === '{"radius":2401,"capped":false}', "the reach of the view, rounded up to whole metres: " + JSON.stringify(api.wikipediaRadius(2400.2)));
ok(api.wikipediaRadius(10).radius === 10 && api.wikipediaRadius(10000).radius === 10000 && !api.wikipediaRadius(10000).capped, "the ends of the range are valid");
ok(api.wikipediaRadius(3).radius === 10 && api.wikipediaRadius(0).radius === 10 && !api.wikipediaRadius(3).capped, "a view smaller than 10 m asks for the minimum");
const wide = api.wikipediaRadius(35000.5);
ok(wide.radius === 10000 && wide.capped === true, "a view wider than 10 km is searched up to 10 km and says so: " + JSON.stringify(wide));
ok(api.wikipediaRadius(10000.2).capped === true && api.wikipediaRadius(10000.2).radius === 10000, "just beyond the range is already capped");
for (const bad of [NaN, Infinity, -1, "x", null, undefined, true, {}]) {
  throws(() => api.wikipediaRadius(bad), "an impossible reach is rejected, not turned into a radius: " + String(bad));
}
ok(new URL(api.wikipediaGeoUrl("en", SOL, 5000)).origin === "https://en.wikipedia.org", "English host for the English interface");
ok(new URL(api.wikipediaGeoUrl("xx", SOL, 5000)).origin === "https://en.wikipedia.org", "an unknown language is served by the English one");
for (const host of Object.values(api.WIKIPEDIA_APIS)) {
  ok(/^https:\/\/[a-z]{2}\.wikipedia\.org\/w\/api\.php$/.test(host), "servers are https and fixed in the code: " + host);
}

/* ---- The extracts request: ids that come from the service and go into a URL again ---- */
const ids = GEO.query.geosearch.slice(0, 20).map(r => r.pageid);
const extUrl = new URL(api.wikipediaExtractsUrl("es", ids));
ok(extUrl.searchParams.get("pageids") === ids.join("|") && extUrl.searchParams.get("exintro") === "1"
  && extUrl.searchParams.get("explaintext") === "1" && extUrl.searchParams.get("exsentences") === "3"
  && extUrl.searchParams.get("exlimit") === "max" && extUrl.searchParams.get("origin") === "*", "the extracts request: " + extUrl.search.slice(0, 120));
ok(api.WIKIPEDIA_EXTRACT_CHUNK === 20, "20 pages per request, the API's cap for extracts");
for (const bad of [[], null, "1|2", Array.from({ length: 21 }, (_, i) => i + 1), [0], [-3], [1.5], ["7"], [NaN], [2 ** 53], ["1|2"], [null]]) {
  throws(() => api.wikipediaExtractsUrl("es", bad), "bad page ids are rejected: " + JSON.stringify(bad));
}

/* ---- The link to the article is built, not trusted ---- */
ok(api.wikipediaArticleUrl("es", "Puerta del Sol") === "https://es.wikipedia.org/wiki/Puerta_del_Sol", "spaces become underscores");
ok(api.wikipediaArticleUrl("en", "Madrid") === "https://en.wikipedia.org/wiki/Madrid", "English host");
ok(api.wikipediaArticleUrl("es", "Estación de Sol") === "https://es.wikipedia.org/wiki/Estaci%C3%B3n_de_Sol", "accents are percent-encoded");
const hostile = api.wikipediaArticleUrl("es", 'evil.com/../x?a=1&b="2"#<script>');
ok(new URL(hostile).origin === "https://es.wikipedia.org" && !/[<>"]/.test(hostile) && !/\/\.\./.test(hostile),
  "a hostile title cannot change the host or break out of an attribute: " + hostile);

/* ---- Text from the service ---- */
const clean = api.cleanWikipediaText;
ok(clean("a\u200bb\u200f\ufeffc", 100) === "abc", "zero-width characters (the footnote markers of an extract) are removed");
ok(clean("a\u0000b\u0007c\u007fd", 100) === "abcd", "control characters are removed");
ok(clean("one\r\n\r\n  two  \r\nthree\n\n", 100) === "one\ntwo\nthree", "line breaks are normalized and empty lines dropped");
ok(clean("x".repeat(50), 10) === "x".repeat(9) + "…" && clean("x".repeat(50), 10).length === 10, "capped, with an ellipsis, at exactly the maximum");
ok(clean("short", 10) === "short", "short text is untouched");
ok(clean("  \n \u200b ", 10) === "", "only whitespace gives nothing");

/* ---- Errors: they come inside a 200 response ---- */
let err = throws(() => api.wikipediaCheck(BUSY), "the real 'search is too busy' answer is an error");
ok(err && err.status === 503 && !err.owsCode && api.isRetryableElevError(err), "…and it is TRANSIENT: treated like a 503 and retried");
err = throws(() => api.wikipediaCheck({ error: { code: "badvalue", info: "Invalid value for <b>gscoord</b>" } }), "a permanent API error is an error");
ok(err && err.owsCode === "badvalue" && !api.isRetryableElevError(err) && /^badvalue: /.test(err.message), "…which is NOT retried and says what the service said: " + (err && err.message));
for (const code of ["maxlag", "ratelimited", "readonly", "internal_api_error_DBQueryError", "cirrussearch-too-busy-error"]) {
  const e = throws(() => api.wikipediaCheck({ error: { code } }), "transient code " + code);
  ok(e && api.isRetryableElevError(e), code + " is retried");
}
err = throws(() => api.wikipediaCheck({ error: { code: "x".repeat(500), info: "y".repeat(5000) } }), "a huge error is still an error");
ok(err && err.message.length < 300, "…and its text is capped: " + (err && err.message.length));
for (const bad of [null, undefined, 5, "text", []]) throws(() => api.wikipediaCheck(bad), "not an object: " + JSON.stringify(bad));
ok(api.wikipediaCheck(GEO) === GEO, "a normal response passes through untouched");

/* ---- The real geosearch response ---- */
const geo = api.parseWikipediaGeosearch(GEO);
ok(geo.articles.length === 100 && geo.skipped === 0, "the real response: 100 articles, none skipped: " + geo.articles.length);
ok(geo.articles[0].title === "Puerta del Sol" && geo.articles[0].pageid === 404042, "the nearest first: " + geo.articles[0].title);
ok(geo.articles.every((a, i, all) => i === 0 || a.dist >= all[i - 1].dist), "in order of distance");
ok(geo.articles.every(a => Number.isFinite(a.lat) && Number.isFinite(a.lon) && a.dist >= 0 && a.dist <= 10000), "valid coordinates, inside the service's maximum radius");
ok(new Set(geo.articles.map(a => a.pageid)).size === 100, "no repeats");

/* ---- Hostile or broken geosearch data ---- */
const entry = (over = {}) => ({ pageid: 1, ns: 0, title: "Valid", lat: 40.4, lon: -3.7, dist: 10, primary: true, ...over });
const parse = list => api.parseWikipediaGeosearch({ query: { geosearch: list } });
const bad = [
  entry({ pageid: 0 }), entry({ pageid: -4 }), entry({ pageid: 1.5 }), entry({ pageid: "7" }), entry({ pageid: null }),
  entry({ title: "" }), entry({ title: "   " }), entry({ title: 42 }), entry({ title: null }), entry({ title: "\u200b\u0000" }),
  entry({ lat: "40.4" }), entry({ lat: 91 }), entry({ lat: -91 }), entry({ lon: 181 }), entry({ lon: null }), entry({ lat: undefined }),
  entry({ dist: -1 }), entry({ dist: "3" }), entry({ dist: null }), null, 5, "x", [], undefined
];
const mixed = parse([entry({ pageid: 11 }), ...bad, entry({ pageid: 12, title: "Another" })]);
ok(mixed.articles.length === 2 && mixed.skipped === bad.length, `${bad.length} broken entries are skipped one by one and the good ones survive: ${mixed.articles.length}/${mixed.skipped}`);
ok(parse([entry({ pageid: 5 }), entry({ pageid: 5, title: "Repeat" })]).articles.length === 1, "a repeated page id counts once");
ok(parse(Array.from({ length: 300 }, (_, i) => entry({ pageid: i + 1 }))).articles.length === api.WIKIPEDIA_LIMIT, "never more than the limit, whatever the service sends");
ok(parse([entry({ title: "Casa\u200b del\u0007 Rey" })]).articles[0].title === "Casa del Rey", "invisible characters are removed from a title");
ok(parse([entry({ title: "t".repeat(1000) })]).articles[0].title.length === api.WIKIPEDIA_MAX_TITLE, "a long title is capped");
ok(parse([]).articles.length === 0, "an empty answer is not an error");
for (const broken of [{}, { query: {} }, { query: { geosearch: null } }, { query: { geosearch: {} } }, { query: { geosearch: "x" } }]) {
  throws(() => api.parseWikipediaGeosearch(broken), "unexpected shape: " + JSON.stringify(broken));
}

/* ---- The real extracts response ---- */
const extracts = api.parseWikipediaExtracts(EXT);
ok(extracts.size === 20, "20 summaries from the real response: " + extracts.size);
ok(extracts.get(1791).startsWith("Madrid es un municipio y una ciudad de España."), "the summary of Madrid: " + extracts.get(1791).slice(0, 60));
ok([...extracts.values()].every(t => !/[\u200b-\u200f\ufeff]/.test(t)), "no invisible characters in any summary (the real ones carry footnote markers)");
ok([...extracts.values()].every(t => t.length > 0 && t.length <= api.WIKIPEDIA_MAX_EXTRACT), "all within the cap");
ok([...extracts.values()].some(t => t.includes("\n")), "paragraphs keep their line breaks");

/* ---- Hostile or broken extracts data ---- */
const page = (over = {}) => ({ pageid: 1, ns: 0, title: "T", extract: "Text.", ...over });
const parseE = pages => api.parseWikipediaExtracts({ query: { pages } });
ok(parseE([page(), page({ pageid: 2, missing: true }), page({ pageid: 3, extract: 7 }), page({ pageid: 4, extract: "  \n " }),
  page({ pageid: 0 }), page({ pageid: "5" }), page({ pageid: 6, extract: undefined }), null, 9, [], page({ pageid: 8, extract: "Ok." })])
  .size === 2, "only valid pages with a real summary are kept");
ok(parseE([page({ extract: "z".repeat(10000) })]).get(1).length === api.WIKIPEDIA_MAX_EXTRACT, "a huge summary is capped");
for (const broken of [{}, { query: {} }, { query: { pages: null } }, { query: { pages: {} } }]) {
  throws(() => api.parseWikipediaExtracts(broken), "unexpected shape: " + JSON.stringify(broken));
}
throws(() => api.parseWikipediaExtracts(BUSY), "the transient error is an error here too");

/* ---- The card of a marker ---- */
const art = { pageid: 1791, title: "Madrid", lat: 40.4, lon: -3.7, dist: 15 };
const card = api.wikipediaCardHtml("es", art, "First paragraph.\nSecond paragraph.", "0.01 NM");
ok(card.includes("<p>First paragraph.</p><p>Second paragraph.</p>"), "one paragraph per line of the summary");
ok(card.includes('<a href="https://es.wikipedia.org/wiki/Madrid">'), "the link to the full article: " + card.slice(-260));
ok(card.includes("0.01 NM") && card.includes("CC BY-SA 4.0"), "the distance given to the card, and the licence credit");
const nasty = api.wikipediaCardHtml("en", { ...art, title: 'Ti"tle <b>' }, '<script>alert(1)</script> & "quotes" <img src=x onerror=y>', "1 m");
ok(!/<script|<img|<b>/.test(nasty) && nasty.includes("&lt;script&gt;") && nasty.includes("&amp;"), "text that came from the service is escaped: " + nasty.slice(0, 120));
ok(!/href="[^"]*["<>][^"]*"/.test(nasty.replace(/href="[^"]*"/, m => m.replace(/%[0-9A-F]{2}/g, ""))), "the link cannot break out of its attribute");
ok(!api.wikipediaCardHtml("es", art, "", "1 m").includes("<p></p>"), "no empty paragraph without a summary");
ok(api.wikipediaCardHtml("es", art, "", "1 m").includes("<a href="), "…but the link is always there");

/* ---- Distance: decimals that say something in every unit ---- */
ok(api.wikipediaDistance(17, "nm") === "0.009 NM", "17 m in NM is 0.009 (fmtUnitDist would say 0.01): " + api.wikipediaDistance(17, "nm"));
ok(api.wikipediaDistance(17, "m") === "17 m" && api.wikipediaDistance(17.4, "m") === "17 m", "metres without decimals");
ok(api.wikipediaDistance(17, "ft") === "56 ft", "feet without decimals: " + api.wikipediaDistance(17, "ft"));
ok(api.wikipediaDistance(17, "km") === "0.017 km" && api.wikipediaDistance(4998, "km") === "4.998 km", "kilometres with three");
ok(api.wikipediaDistance(17, "mi") === "0.011 mi", "miles with three: " + api.wikipediaDistance(17, "mi"));
ok(api.wikipediaDistance(0, "nm") === "0.000 NM", "zero keeps its decimals");
ok(api.wikipediaDistance(100, "furlong") === "100 m" && api.wikipediaDistance(100, undefined) === "100 m", "an unknown unit falls back to metres, never NaN");

/* ---- Why a request failed ---- */
const timeoutErr = Object.assign(new Error("x"), { name: "TimeoutError" });
ok(/15 s/.test(api.wikipediaWhy(timeoutErr)), "a time-out says how long: " + api.wikipediaWhy(timeoutErr));
ok(/^NET: /.test(api.wikipediaWhy(new TypeError("Failed to fetch"))), "a network failure goes through netFailText");
ok(api.wikipediaWhy(new Error("boom")) === "boom", "any other error keeps its own text");
ok(api.wikipediaWhy(null) === "error desconocido" && api.wikipediaWhy({}) === "error desconocido", "and one without text says so");

/* ---- Transient codes: exact, not any code that happens to contain a word ---- */
for (const code of ["cirrussearch-too-busy-error", "maxlag", "ratelimited", "readonly", "internal_api_error_X"]) {
  ok(api.WIKIPEDIA_TRANSIENT.test(code), code + " is transient");
}
for (const code of ["badvalue", "invalid-param", "mylagoon", "nolag", "backend-fail-permanent", "timeoutish", "toobusy"]) {
  ok(!api.WIKIPEDIA_TRANSIENT.test(code), code + " is NOT retried");
}

/* ---- Saved tree: are there Wikipedia markers? (the credit at start-up) ---- */
const rec = (icon, children) => ({ type: "layer", name: "x", mstyle: icon ? { icon } : undefined, children });
ok(api.wikipediaInRecords([{ type: "folder", children: [{ type: "folder", children: [rec("wikipedia")] }] }]) === true, "found three levels down");
ok(api.wikipediaInRecords([rec("pin"), rec(null), { type: "folder", children: [rec("map-marker")] }]) === false, "other icons do not count");
ok(api.wikipediaInRecords([]) === false && api.wikipediaInRecords(null) === false && api.wikipediaInRecords([null, 3, "x", {}]) === false, "empty and hostile input is just false");
ok(api.wikipediaInRecords([{ children: "no" }, { children: [null] }]) === false, "a malformed children field does not throw");

/* ---- The badge: the bare letter never goes without a background ---- */
ok(api.BADGED_ICONS.has(api.WIKIPEDIA_ICON), "the Wikipedia icon is one of the badged glyphs");
ok(api.markerBadgeBackground("#202122") === "#fff" && api.markerBadgeBackground("#000000") === "#fff", "a dark glyph gets a light badge");
ok(api.markerBadgeBackground("#ffffff") === "#202122" && api.markerBadgeBackground("#ffeb3b") === "#202122", "a light glyph gets a dark badge");
ok(api.markerBadgeBackground("red") === "#fff" && api.markerBadgeBackground(undefined) === "#fff" && api.markerBadgeBackground("#12") === "#fff", "an unreadable colour falls back to the light badge");

if (failed) { console.error(`${failed} failed, ${passed} passed`); process.exit(1); }
console.log(`WIKIPEDIA TESTS OK (${passed} checks)`);
