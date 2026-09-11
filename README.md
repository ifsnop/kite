# KITE Local

**KML Interactive Tree Explorer**

A privacy-first, browser-based viewer and organizer for **KML, KMZ and GeoJSON** files. It preserves nested KML folder structures as an interactive layer tree, runs from one self-contained HTML file, and keeps imported data inside the user's browser.

### ▶ [Try the live demo](https://ifsnop.github.io/kite/)

The demo is the application itself, not a hosted service: the page is served from GitHub Pages and everything then runs in the browser. Files dropped onto it are **not uploaded anywhere** — the same guarantee as opening the downloaded file locally. Drop a KML, KMZ or GeoJSON file onto the left panel and it opens straight away.

> **In short:** if a KML is used as a conventional collection of folders, placemarks, lines and polygons in Google Earth, KITE Local is designed to open it directly while retaining its folder hierarchy. Advanced Google Earth features such as 3D models, tours, screen overlays and network links are outside the current scope; georeferenced ground overlays are supported.

## Why this project exists

Google has announced that new downloads of **Google Earth Pro for desktop will end on 25 June 2027**. Existing installations are expected to continue working, but the desktop client will no longer be the long-term distribution path. Google is directing users towards its web and mobile products.

That transition leaves a practical gap for users who mainly need to open local KML/KMZ files, retain their organization, compare layers, adjust simple styles, add locations and make quick measurements without installing a full GIS package or uploading data to an application server.

KITE Local focuses deliberately on that workflow:

- **Preserve the original nested KML folder hierarchy.** Imported `Document` and `Folder` structures remain a browsable tree instead of being flattened into geometry layers or reduced to metadata.
- **Control visibility at every level.** Toggle a complete file, folder or subtree with one checkbox, or enable and disable individual layers.
- **Keep data local.** KML, KMZ and GeoJSON files are read and processed in the browser. They are not uploaded to an application server.
- **Use one self-contained HTML file.** There is no installer, package manager, compilation step or application backend.
- **Avoid application-imposed import quotas.** The viewer sets no file-size, feature-count or vertex-count limit; practical capacity is determined by the browser and the user's available memory and storage.
- **Keep the workspace between sessions.** The tree, its styles, the saved view
  and the measurements are stored locally through IndexedDB, so closing the tab
  does not mean starting over.
- **Take work out again.** Any folder can be exported as a portable
  `.kite.json` package, and the current view as a PNG image.

It is an independent GPL-3.0 project and is **not affiliated with or endorsed by Google, Google Earth, QGIS, OpenStreetMap, Esri, Leaflet, Iconify or Instituto Geográfico Nacional de España**.

## Key differentiators

### KML hierarchy is a first-class feature

Many KML files are not merely collections of geometries: their nested folders carry operational meaning. KITE Local recreates this hierarchy in the navigation panel and allows each file, folder, subtree and individual layer to be enabled or disabled.

General-purpose GIS importers commonly translate KML folders into separate geometry layers or store the original path as an attribute. KITE Local instead keeps the structure visible and directly usable.

### Local processing and data control

Imported files are parsed locally. Their geometries and workspace remain in the browser and are stored locally through IndexedDB. No application account or backend upload is required.

External requests are still made for libraries, map tiles, WMS imagery and optional place searches; see [Internet access and privacy](#internet-access-and-privacy).

### One portable HTML file

The complete application—interface, styles and program logic—is contained in one HTML file. Download it and open it in a modern browser. No build, installation or server is needed **to use it**. Developing it is another matter: the sources live in `src/` and are concatenated into that file by `build.js` (see the roadmap), but nobody running the viewer ever needs that step.

### No artificial KML import quota

KITE Local does not impose fixed limits on KML file size, imported features or vertices. Actual limits depend on browser capabilities, available RAM, local storage quota and rendering performance.

## Features

### File support

- KML files, preserving nested `Document` and `Folder` structures
- KMZ archives, including the images referenced by their ground overlays
- GeoJSON, TopoJSON and plain JSON
- KITE Local folder exports (`.kite.json`)
- drag-and-drop import; dropping onto a folder imports inside it
- tolerant XML parsing: a namespace prefix that a file uses but never
  declares — accepted by Google Earth, rejected by any XML parser — is
  repaired once and reported, instead of losing the whole file
- per-entity error isolation: one broken geometry cannot abort an import,
  and every load ends with a summary of what came in, what was skipped
  and why
- optional removal of HTML-like tags left in names by some exporters
- optional merging of duplicate placemarks (same name and position)
- for a GeoJSON whose features carry no `name` or `title`, a prompt to
  choose which property to use as the name, remembered for future files
  with the same property structure
- progress indication and batched layer construction for larger files

### Layer workspace

- hierarchical tree of files, folders and layers
- global, file, folder, subtree and individual visibility controls
- rename, delete, reorder and alphabetically sort nodes
- drag layers and folders within the tree
- multi-selection, including Shift ranges and single-node toggles
- cut, copy and paste; undo and redo
- keyboard navigation modelled on a file-explorer tree, with a shortcut
  cheat sheet built in
- collapse and expand folders; deep collapse of a whole branch
- search by layer or folder name, with previous/next match
- pan to a node, zoom to a node, and fit the map to loaded content
- an information panel per layer: the original KML `description`
  (sanitized against an allow-list) or a table of the GeoJSON
  `properties`
- right-click menu on the map, which resolves overlapping layers into a
  submenu instead of guessing one
- export any folder or file as a portable `.kite.json` package
- local storage usage indicator, and a session log of every notice shown

### Styling and editing

- Leaflet and Material Design marker icons, embedded in the file
- marker size, colour, label size and label colour
- optional permanent marker labels
- marker renaming and coordinate editing in decimal degrees or DMS
- marker repositioning by dragging
- polygon and line outline width and colour
- polygon fill colour and opacity, with an outline/fill/both selector
- read-only perimeter (or length) and area, in metres, kilometres, feet
  or nautical miles
- a point-list editor: one vertex per line, tab-separated, so a geometry
  can be copied into a spreadsheet and pasted back
- ground-overlay image opacity
- batch style changes for selected compatible layers
- every dialog edits a draft: nothing reaches the map until Accept

### Base maps

Several can be enabled at once, each with its own opacity, and their
stacking order can be changed:

- OpenStreetMap
- Esri World Terrain and Esri hillshade
- IGN Base and MTN topographic maps (Spain)
- PNOA orthophotography, current and historical (Spain)
- IGN terrain WMS (Spain)
- SRTM30 relief (terrestris, 56°S–60°N)
- Copernicus DEM through Sentinel Hub, which needs the user's own
  instance ID; it is stored in that browser only and never travels with
  an export
- optional blank base map

A base layer whose service stops answering is flagged in the panel, and
the flag clears by itself when the tiles come back.

### Map tools

- place search through Nominatim
- pointer coordinates in decimal degrees, degrees/minutes/seconds and UTM
- scale bar
- latitude/longitude graticule
- shortcuts for the Iberian Peninsula/Balearic Islands and Canary Islands
- drop a marker at the centre of the view
- draw polygons and open lines vertex by vertex
- export the current view as a PNG image

### Elevation (Spain)

- terrain (MDT) and surface (MDS) elevation under the pointer, queried
  from the IGN's WCS services, with the difference between them — the
  visible sign of buildings or vegetation
- the answers accumulate as a readable grid of cells, which becomes an
  ordinary layer of the tree when the mode is switched off: persistent,
  toggleable and deletable like any other
- metres or feet
- coverage is Spain only, and each reading costs a request to a third
  party, so the mode is off by default

### Measurements

- geodesic line distance and initial bearing
- geodesic circle radius and area
- editable measurement handles
- stroke and fill styling, and values shown in metres, kilometres, feet
  or nautical miles — the same unit the map labels use
- persistent measurements stored with the workspace

## Quick start

The fastest way is **[the live demo](https://ifsnop.github.io/kite/)** — nothing to download, and the files still never leave the browser.

To keep a local copy:

1. Download or clone this repository.
2. Open `kitelocal.html` in a modern desktop browser — double-clicking the file is enough.
3. Drag KML, KMZ, GeoJSON or `.kite.json` files onto the left navigation panel.
4. Use the retained folder tree to organize, compare, show, hide and style the imported content.

```bash
git clone <repository-url>
cd <repository-directory>
```

No package manager, web server or build process is required to *use* the viewer. The complete application is distributed as one HTML file.

Two copies of that file are published, and they are the same application:

- **`kitelocal.html`** — the readable build, with the source and its comments intact. This is the one to download, read or debug.
- **`kitelocal.min.html`** — a minified derivative, and what the demo link serves: 67 KB over the wire instead of 152 KB.

## Local persistence and backups

The complete tree is serialized to GeoJSON and saved in the browser using IndexedDB. Imported source files are not required after a successful import. The application also requests persistent browser storage when the browser supports it.

Browser storage is convenient, but it is **not a backup**. It may be cleared by the user, browser policy or storage pressure. Export important folders to `.kite.json` and keep copies outside the browser profile.

## Internet access and privacy

Imported KML/KMZ/GeoJSON content is parsed locally and is **not uploaded to an application server**. The imported geometries and workspace remain in the user's browser.

The current build is not fully offline and makes external requests:

- Leaflet CSS, JavaScript and default marker images, topojson-client and
  html2canvas are loaded from `unpkg.com`;
- JSZip is loaded from `cdnjs.cloudflare.com`;
- place searches are sent to the public Nominatim service;
- base-map tiles and WMS images are requested from their respective providers;
- elevation readings are requested from the IGN's WCS services, and only while
  elevation mode is switched on;
- the Copernicus DEM base layer, if enabled, is requested from Sentinel Hub
  with the user's own instance ID.

Material Design marker icons are **embedded in the file** and cost no request at all. They used to be fetched one by one from `api.iconify.design`, which meant 79 simultaneous requests every time the icon picker was opened; past the service's rate limit the icons silently went blank. They are now baked in at build time.

These providers receive ordinary request metadata, and text entered in the place search is sent to Nominatim. The imported KML geometry itself is not sent by the application to these services.

For controlled or offline deployments, vendor the JavaScript, CSS, image and icon dependencies locally, disable or replace the geocoder, and configure approved tile/WMS services.

## Why not just use QGIS or Google Earth on the web?

These tools solve different problems:

- **QGIS** is the better choice for advanced geoprocessing, coordinate reference systems, data editing and cartographic production. KITE Local is optimized for direct viewing and manipulation of the original nested KML tree rather than translating it into GIS layers.
- **Google Earth** is the better choice for a 3D globe, terrain and imagery. KITE Local provides direct file-, folder- and subtree-level visibility controls, requires no application-side upload, and retains the working tree locally.

KITE Local covers the simpler but common task of opening, organizing, comparing and measuring structured KML content quickly while keeping it under the user's control.

## Supported KML subset

The viewer handles the core structures used by many conventional KML files:

- `Document` and `Folder` hierarchy
- `Placemark`
- `Point`
- `LineString`
- `Polygon`, including inner rings
- `MultiGeometry`
- node `visibility` and folder/document `open`
- shared and inline `Style` for basic line and polygon appearance
- resolvable `StyleMap` normal-style references
- `GroundOverlay` georeferenced images, including those bundled in a KMZ
  (axis-aligned `LatLonBox` only: a `rotation` is read and reported, but
  not applied)

KML is a broad specification. The following are not fully supported or are intentionally simplified:

- Google Earth icon styles and arbitrary remote/local icon resources
- altitude rendering and altitude modes
- extrusions and 3D geometry
- screen overlays
- network links and refresh behavior
- tracks, tours, models and time primitives
- balloon templates and rich KML descriptions
- highlight styles in `StyleMap`
- all KML namespaces and extensions
- exact Google Earth rendering parity

Imported marker icons are replaced by the viewer's default marker unless the user selects another icon.

## GeoJSON styling

The viewer recognizes a subset of Mapbox simplestyle properties:

- `stroke`
- `stroke-width`
- `fill`
- `fill-opacity`

Other properties remain part of the GeoJSON data but may not affect rendering.

## Browser compatibility

A recent desktop browser is recommended. The application relies on IndexedDB, Fetch, File and Blob APIs, async/await, pointer events, CSS custom properties and `:scope` selectors.

The interface is primarily designed for mouse and keyboard use. Touch support and accessibility remain areas for improvement.

## Known limitations

- The application is a 2D Leaflet viewer, not a 3D virtual globe.
- The simple compatibility statement applies to conventional folder/placemark/line/polygon KML, not every feature in the full KML specification.
- `DOMParser` and `JSON.parse` are synchronous and can briefly block the interface on large inputs.
- The application sets no explicit KML-size or feature-count limit, but the browser, RAM, IndexedDB quota and rendering performance impose practical limits.
- Altitude is carried through import, storage and export, but it is not rendered: this is a 2D viewer. Two placemarks at the same latitude and longitude but different altitudes are still treated as duplicates.
- KML style handling is partial: shared and inline styles for basic line and polygon appearance, and `StyleMap` normal-style references. (Namespaces are not a limitation — elements are matched by local name, so prefixed, default-namespaced and namespace-less KML all work.)
- External services can change, rate-limit requests or become unavailable.
- `.kite.json` is application-specific and currently requires a matching tree schema version.
- The current interface is in Spanish.

## Security notes

Treat imported files as untrusted input. The viewer uses text insertion and explicit HTML escaping for marker labels, sanitizes KML `description` HTML against an allow-list, ships a restrictive `Content-Security-Policy` (`default-src 'none'` plus the specific origins it needs), and pins its CDN dependencies with Subresource Integrity. Marker icons are embedded rather than fetched, so no remote SVG is executed.

Do not use public tile, geocoding or CDN services for sensitive work without an appropriate security and privacy review.

## Development roadmap

### Done

- **The sources are split.** The application is edited as `src/index.html`,
  `src/styles.css` and twenty JavaScript files, concatenated into the shipped
  file by `build.js`. The single-file product is the output, not the source.
- **There are automated tests.** Thirty-six suites run under Node against the
  shipped file, covering coordinate parsing and formatting, UTM, KML
  namespaces and styles, geometry conversion, serialization, tree navigation
  and selection, hit-testing, geodesic area and perimeter, and more. Run them
  with `npm test`.
- **CDN dependencies carry Subresource Integrity**, so a compromised CDN
  cannot substitute other content, and marker icons are now embedded in the
  file rather than fetched.
- **Input validation and preventive limits.** Everything arriving from outside
  is treated as hostile: geometry is validated before layers are built,
  failures are isolated per entity so one bad placemark cannot abort an
  import, KMZ archives have entry/size/ratio caps, and the user always gets a
  summary of what loaded and what was skipped, with the reason.
- **Keyboard navigation, focus management and ARIA labels.** The tree is a
  proper `role="tree"` with roving focus, dialogs trap and restore focus, and
  the panel is driven entirely from the keyboard.

### Still open

- Touch interaction, which remains weak: the interface is built for mouse and
  keyboard.
- Optional export to standard KML and GeoJSON. Today the only export format is
  the application's own `.kite.json`.
- A fully vendored offline build. Leaflet and JSZip are still loaded from a CDN.
- Configurable resource limits; the current caps are constants in the source.
- An English interface. The UI is in Spanish.

### Deliberately not planned

- **Web Workers for parsing.** The target file sizes do not justify them, and
  a worker has neither `DOMParser` nor Leaflet, so the work would have to be
  split awkwardly across the boundary.
- **IndexedDB and `.kite.json` migrations.** Storage is versioned, and data
  from a different version is discarded rather than migrated. The version is
  only raised when a change requires it, and the user is told when a saved
  workspace is dropped.

## Contributing

Issues and pull requests are welcome. Include the browser/version, a minimal non-sensitive sample, the expected result, and the actual result or console error.

Do not attach operational, confidential or personally identifiable geospatial data to a public issue.

## License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)**.

See the repository's `LICENSE` file for the complete license text. Redistribution and modification are subject to the GPL-3.0 terms.

## Third-party services and libraries

This application currently uses or accesses:

- [Leaflet](https://leafletjs.com/)
- [JSZip](https://stuk.github.io/jszip/)
- [topojson-client](https://github.com/topojson/topojson-client)
- [html2canvas](https://html2canvas.hertzen.com/)
- [Material Design Icons](https://pictogrammers.com/library/mdi/) (Pictogrammers, Apache-2.0) — embedded at build time through [Iconify](https://iconify.design/); not requested at runtime
- [OpenStreetMap](https://www.openstreetmap.org/)
- [Nominatim](https://nominatim.org/)
- Esri World Terrain and hillshade
- Spanish PNOA, IGN WMTS, WMS and WCS services
- [SRTM30 tiles from terrestris](https://ows.terrestris.de/) (SRTM data © NASA LP DAAC)
- [Copernicus DEM through Sentinel Hub](https://dataspace.copernicus.eu/)

Their licenses, attribution requirements, acceptable-use policies and service limits apply independently.

## Google Earth desktop transition references

- Google Earth Help Community announcement — add the canonical announcement URL when confirmed
- [PCWorld coverage of the 25 June 2027 download cutoff](https://www.pcworld.com/article/3186820/you-have-until-2027-to-download-google-earth-pro-do-it-now.html)
- [Geopera analysis of the desktop transition](https://geopera.com/blog/google-earth-pro-desktop-discontinued)

Google Earth and Google Earth Pro are trademarks of Google LLC.
