const { DOMParser } = require("@xmldom/xmldom");
const { between } = require("./_extract");

/* parseLatLonBox lives in the KML geometry section, after the namespace
   helpers and coordinate clamping it depends on, and before
   buildGroundOverlay (which needs Leaflet + an async zip read and is
   therefore not exercised in Node — same boundary kmltest.js draws
   around buildPlacemarkLayer).                                         */
const geomSrc = between("/* Nombre sin prefijo", "/* A GroundOverlay is a single georeferenced image");
/* resolveKmzEntry: standalone, next to kmzToKml */
const zipSrc = between("/* Resolves a GroundOverlay Icon/href", "const fmtBytes =");

const api = new Function(geomSrc + zipSrc
  + "\nreturn {parseLatLonBox, resolveKmzEntry};")();
const { parseLatLonBox, resolveKmzEntry } = api;
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

const parse = xml => new DOMParser().parseFromString(xml, "text/xml").documentElement;

/* ---------- parseLatLonBox ---------- */
let el = parse(`<GroundOverlay>
  <LatLonBox><north>40.5</north><south>40.4</south><east>-3.6</east><west>-3.8</west></LatLonBox>
</GroundOverlay>`);
let box = parseLatLonBox(el);
ok(box && box.north === 40.5 && box.south === 40.4 && box.east === -3.6 && box.west === -3.8,
  "bounds read correctly: " + JSON.stringify(box));
ok(box.rotation === 0, "rotation defaults to 0 when absent");

el = parse(`<GroundOverlay><LatLonBox>
  <north>40.5</north><south>40.4</south><east>-3.6</east><west>-3.8</west><rotation>12.5</rotation>
</LatLonBox></GroundOverlay>`);
ok(parseLatLonBox(el).rotation === 12.5, "rotation read when present");

el = parse(`<GroundOverlay></GroundOverlay>`);
ok(parseLatLonBox(el) === null, "missing LatLonBox returns null");

el = parse(`<GroundOverlay><LatLonBox>
  <north>91</north><south>40.4</south><east>-3.6</east><west>-3.8</west>
</LatLonBox></GroundOverlay>`);
ok(parseLatLonBox(el) === null, "an out-of-range limit (not a rounding slip) is rejected");

/* the same rounding tolerance as the rest of the coordinate parser */
el = parse(`<GroundOverlay><LatLonBox>
  <north>40.5</north><south>40.4</south><east>180.00000044181039</east><west>-3.8</west>
</LatLonBox></GroundOverlay>`);
box = parseLatLonBox(el);
ok(box && box.east === 180, "tiny rounding overshoot is clamped, not rejected: " + (box && box.east));

/* ---------- resolveKmzEntry ---------- */
const makeFakeZip = entries => ({
  file(arg) {
    if (typeof arg === "string") return entries[arg] || null;
    return Object.keys(entries).filter(k => arg.test(k)).map(k => entries[k]);
  }
});
const zip = makeFakeZip({
  "images/ortho1.png": { name: "images/ortho1.png" },
  "doc.kml": { name: "doc.kml" }
});
ok(resolveKmzEntry(zip, "images/ortho1.png") === zip.file("images/ortho1.png"), "exact path match");
ok(resolveKmzEntry(zip, "./images/ortho1.png").name === "images/ortho1.png", "leading ./ is stripped");
ok(resolveKmzEntry(zip, "ortho1.png").name === "images/ortho1.png", "falls back to a bare filename match");
ok(resolveKmzEntry(zip, "missing.png") === null, "nothing found returns null, not throws");
ok(resolveKmzEntry(null, "ortho1.png") === null, "no zip (loose .kml) returns null safely");
if (!process.exitCode) console.log("GROUND OVERLAY TESTS OK");
