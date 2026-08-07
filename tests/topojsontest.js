const path = require("path");
const HTML_PATH = path.join(__dirname, "..", "kitelocal.html");
const fs = require("fs");
const html = fs.readFileSync(HTML_PATH, "utf8");
const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const src = script.slice(script.indexOf("/* Convierte una topología TopoJSON"),
                         script.indexOf("async function buildGeoJsonTree"));
const { topologyToGeoJson } = new Function(src + "\nreturn {topologyToGeoJson};")();
const ok = (c, m) => { if (!c) { console.error("FAIL: " + m); process.exitCode = 1; } };

/* topojson-client itself is an external, stable, versioned library: its
   arc-decoding math is not ours to test. What is ours is the orchestration
   in topologyToGeoJson — iterating every named object and merging the
   result into one FeatureCollection — so `topojson.feature` is stubbed
   here rather than pulling in the real library as a test dependency.   */
global.topojson = {
  feature(topology, obj) {
    if (obj.type === "GeometryCollection") {
      return {
        type: "FeatureCollection",
        features: obj.geometries.map(g => ({ type: "Feature", geometry: g, properties: {} }))
      };
    }
    return { type: "Feature", geometry: obj, properties: {} };
  }
};

const topology = {
  type: "Topology",
  objects: {
    counties: {
      type: "GeometryCollection",
      geometries: [
        { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        { type: "Polygon", coordinates: [[[2, 2], [3, 2], [3, 3], [2, 2]]] }
      ]
    },
    capital: { type: "Point", coordinates: [0.5, 0.5] }
  }
};

const gj = topologyToGeoJson(topology);
ok(gj.type === "FeatureCollection", "returns a FeatureCollection");
ok(gj.features.length === 3, "merges every named object's features: " + gj.features.length);
ok(gj.features.filter(f => f.geometry.type === "Polygon").length === 2, "both polygons kept");
ok(gj.features.some(f => f.geometry.type === "Point"), "the single-geometry object is kept too");

/* An empty topology (no named objects) must not throw */
const empty = topologyToGeoJson({ type: "Topology", objects: {} });
ok(empty.type === "FeatureCollection" && empty.features.length === 0, "empty topology yields an empty collection");
if (!process.exitCode) console.log("TOPOJSON TESTS OK");
