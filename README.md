# KITE Local

## ▶ [Try it now — ifsnop.github.io/kite](https://ifsnop.github.io/kite/)

Nothing to install, no account, nothing uploaded: open the link and drop a KML or KMZ onto the left panel. No file of your own at hand? Download the [sample KMZ](https://github.com/ifsnop/kite/raw/main/docs/ejemplos/operacion-sierra.kmz) and drop that.

![Dragging a KMZ onto KITE Local: the folder tree appears, and the layers can be turned off and on from it](media/kite-demo.gif)

[![Tests](https://github.com/ifsnop/kite/actions/workflows/tests.yml/badge.svg)](https://github.com/ifsnop/kite/actions/workflows/tests.yml)
[![Release](https://img.shields.io/github/v/release/ifsnop/kite)](https://github.com/ifsnop/kite/releases/latest)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

**KML Interactive Tree Explorer**

A privacy-first, browser-based viewer and organizer for **KML, KMZ, GeoJSON, shapefile and GPX** files, Cloud Optimized GeoTIFF orthophotos and ArcGIS map services. It preserves nested KML folder structures as an interactive layer tree, runs from one self-contained HTML file, and keeps imported data inside the user's browser.

The demo is the application itself, not a hosted service: the page is served from GitHub Pages and everything then runs in the browser. Files dropped onto it are **not uploaded anywhere** — the same guarantee as opening the downloaded file locally.

> **In short:** if a KML is used as a conventional collection of folders, placemarks, lines and polygons in Google Earth, KITE Local is designed to open it directly while retaining its folder hierarchy. Advanced Google Earth features such as 3D models, tours, screen overlays and network links are outside the current scope; georeferenced ground overlays are supported.

## Documentation

The documents live in [`docs/`](docs/) and are written in Spanish:

- [**User manual**](docs/manual-usuario-kite-local.md) — every panel, dialog, menu and shortcut, with screenshots, and step-by-step recipes for the usual tasks.
- [**Security study**](docs/estudio-seguridad-kite-local.md) — where each layer and service comes from, why the application does not alter the data it shows, and which automated tests back that up.
- [**Pending work and proposals**](docs/pendientes-y-propuestas-kite-local.md) — what is known to be missing and the ideas for developing it further, in a single list.

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
- **Take work out again.** Any folder, file or layer can be exported as KML,
  GeoJSON or a portable `.kite.json` package; the current view, as a PNG image
  or a link; a route profile, as a PNG image or a CSV file (comma and decimal point in English, semicolon and decimal comma in Spanish).

It is an independent AGPL-3.0 project and is **not affiliated with or endorsed by Google, Google Earth, QGIS, OpenStreetMap, Esri, Leaflet, Iconify or Instituto Geográfico Nacional de España**.

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
- GPX: waypoints, routes and tracks (with elevation and times), named from the
  file's own `<name>`
- Shapefiles: drop the `.shp` together with its `.dbf`, `.prj` and `.cpg`,
  or the `.zip` that holds them (one folder per layer). Coordinates are
  reprojected from the `.prj` with proj4 (ETRS89 UTM, the usual case in
  Spain; ED50 with the standard peninsular parameters, flagged in the
  summary). Without a `.prj`, only coordinates already in degrees are
  accepted. Text encoding comes from the `.cpg`, or is detected (UTF-8,
  else Windows-1252). Z values are not imported
- Cloud Optimized GeoTIFF orthophotos (`.tif`, 8-bit RGB or grey) and
  single-band elevation models (16/32-bit integer or float, drawn with a
  colour ramp and relief shading, altitude under the cursor): dropped
  onto the panel, validated, then copied as a Blob into the browser's own
  IndexedDB store so they survive a reload. Drawn by a custom
  `L.GridLayer` that reads only the window and overview level each tile
  needs (geotiff.js `fromBlob`), reprojected per tile through a 16×16
  proj4 grid (WGS84 UTM any zone north or south, ETRS89 UTM 28–38 (EPSG:258xx and 3040–3050), ED50 UTM
  28–31, REGCAN95, WGS84, ETRS89, Web Mercator). Not included in `.kite.json` exports or the system
  clipboard; a deleted one is purged from storage on the next start
- KITE Local folder exports (`.kite.json`)
- ArcGIS map services (`MapServer`): see [ArcGIS map services](#arcgis-map-services)
- drag-and-drop import; dropping onto a folder imports inside it
- tolerant XML parsing: a namespace prefix that a file uses but never
  declares — accepted by Google Earth, rejected by any XML parser — is
  repaired once and reported, instead of losing the whole file
- per-entity error isolation: one broken geometry cannot abort an import,
  and every load ends with a summary of what came in, what was skipped
  and why
- KML `ExtendedData` (`<Data>` and `<SchemaData>`) are kept as layer attributes
- optional removal of HTML-like tags left in names by some exporters
- optional merging of duplicate placemarks (same name and position)
- for a GeoJSON whose features carry no `name` or `title`, a prompt to
  choose which property to use as the name, remembered for future files
  with the same property structure
- progress indication and batched layer construction for larger files
- layers a file brings switched off are not drawn until you switch them on: a 309 MB KML with 62 000 hidden polygons loads in about 13 seconds and reopens in about 5, instead of rebuilding every layer on each start

### Layer workspace

- hierarchical tree of files, folders and layers
- global, file, folder, subtree and individual visibility controls
- rename, delete, reorder and alphabetically sort nodes
- drag layers and folders within the tree
- multi-selection, including Shift ranges and single-node toggles; on a row
  that belongs to the selection, the visibility checkbox, the 🔍 magnifier, delete
  and properties act on the whole selection (the magnifier frames the set)
- cut, copy and paste; undo and redo
- keyboard navigation modelled on a file-explorer tree, with a shortcut
  cheat sheet built in
- collapse and expand folders; deep collapse of a whole branch
- live filter of the tree by name as you type (from the third letter, or Enter):
  case-, accent- and in-word-insensitive, only the matching rows and the folders
  that hold them stay visible; folders you have never opened are counted without
  being built (a 20,000-layer folder filters instantly, "(37)" next to its name);
  the × or Esc clears it, Enter and the ↑ ↓ buttons jump between matches
- pan to a node, zoom to a node (a fixed level for a marker; a
  margin-framed fit-to-bounds for a polygon, line or measurement), and fit
  the map to loaded content
- an information panel per layer: the original KML `description`
  (sanitized against an allow-list) or a table of the GeoJSON
  `properties` (a pin, shape or measurement without attributes shows its
  name, kind and position or measures); sweeping the mouse across the map only changes it where the
  pointer rests, and every layer rested on stays as a tab in one strip under
  the card's title (click a tab to see its card, one at a time, and outline
  the layer on the map; the small pin on each tab, or F over a layer, keeps
  it, and a pinned card on screen no longer follows the mouse;
  selecting text to copy it never changes the card)
- right-click menu on the map, which resolves overlapping layers into a
  submenu instead of guessing one
- export any folder, file or layer as KML, GeoJSON or a portable `.kite.json`
  package (the 💾 button on its row)
- sections that the application creates itself (Markers, Elevations,
  Downloads, Measurements…) are tinted pastel blue, so they are not mistaken
  for an imported file or a row under the mouse
- local storage usage indicator, and a session log of every notice shown
- a Properties panel with five tabs. *Preferences*: theme, language, the
  distance and altitude units, coordinate format, the interactive-vertex-edit
  cap, arc segments, the longest profile and the largest size a KMZ may take
  once uncompressed (500 MB by default) — previewed live where it can be, and
  only saved on Accept. *GeoJSON indexes*: remembers which property names each GeoJSON
  structure. *Data sources*: which service supplies the terrain and surface
  models. *Frequencies*: the Fresnel frequency. *Restore*: deletes everything
  the application has saved in the browser, after a second confirmation
- a light/dark interface theme that follows the system or is forced, and
  English and Spanish interfaces that follow the browser or are forced
- the interface follows the system's accessibility preferences (reduced motion,
  reduced transparency, increased contrast); buttons respond the moment they are
  pressed, menus and dialogs enter with a short animation (closing is instant),
  and the panel splitter works with a mouse, a pen or a finger
- a phone notice («better from a computer») and a full-screen panel layout on
  small touch screens

### Loading

- drag KML, KMZ, GeoJSON, TopoJSON, shapefiles and exported `.kite.json` folders onto
  the panel, or drop them straight into a folder
- **open a URL**: paste an address, download it, see what actually
  arrived — the format is recognised from the content, not the
  extension — and only then add it to the tree. Downloads collect under a
  «Descargas» section, one numbered folder each, so where something came
  from stays visible whatever the format. A download in progress can be cancelled without waiting
  for the timeout.

### Styling and editing

- Leaflet and Material Design marker icons, embedded in the file
- marker size, colour, label size and label colour
- optional permanent marker labels
- marker renaming and coordinate editing in decimal degrees or DMS
- marker repositioning by dragging
- polygon and line outline width and colour
- polygon fill colour and opacity, with an outline/fill/both selector
- optional permanent polygon and line labels, like the marker ones
- read-only perimeter (or length) and area, in metres, kilometres, feet,
  statute miles or nautical miles
- interactive vertex editing on the map for an already-created polygon,
  line or route, while its style dialog is open: drag a vertex to move it,
  right-click to delete it, Shift+click or the Insert key to add one — with
  a minimum per ring and an adjustable cap (500 by default) on how many
  vertices get on-map handles before it falls back to the text editor
- the properties dialog has the tree row's 🔍 and × (centre on the layer and
  delete it): with several layers in the dialog, the magnifier frames them all
  and delete asks for confirmation; Ctrl+Z brings back the original style
- a point-list editor: one vertex per line, tab-separated, so a geometry
  can be copied into a spreadsheet and pasted back
- ground-overlay image opacity
- batch style changes for selected compatible layers, including renaming.
  A value that differs across the selection is shown as such and is left
  alone unless it is edited, so accepting the dialog never quietly
  levels the settings that were only being looked at
- every dialog edits a draft: nothing reaches the map until Accept

### Base maps

Several can be enabled at once, each with its own opacity, and their
stacking order can be changed:

- OpenStreetMap
- Esri World Terrain and Esri hillshade
- IGN Base and MTN topographic maps (Spain)
- PNOA orthophotography, current and historical (Spain)
- Madrid city orthophotography (Ayuntamiento de Madrid WMS)
- IGN terrain WMS (Spain)
- SRTM30 relief (terrestris, 56°S–60°N)
- Copernicus DEM through Sentinel Hub, which needs the user's own
  instance ID; it is stored in that browser only and never travels with
  an export
- optional blank base map

A base layer whose service stops answering is flagged in the panel, and
the flag clears by itself when the tiles come back.

### Attributes

- the ▦ button of a folder or file opens an attribute table: one row per layer
  and one column per attribute (GeoJSON and shapefile properties, KML
  `ExtendedData`). Sort by column (numbers as numbers, empty cells last),
  filter, jump to a layer and export what is shown as CSV (commas and a decimal point in English, semicolons and a decimal comma in Spanish), with the standard
  defence against spreadsheet formulas hidden in a foreign file. A folder of
  5 000 layers keeps about twenty rows in the DOM
- «Estilo por atributo» colours all the layers of that table once, by category
  (the most frequent values, plus «Otros» and «sin valor») or graduated over a
  numeric column (equal intervals or quantiles), with colour-blind-safe
  palettes, a live preview and Cancel. The result is ordinary layer styles,
  not a stored rule

### Range rings and sectors

- right-click → «Crear» › «Anillos de alcance…» / «Sector…»: concentric
  geodesic rings (every radius you list, optional radials) or a sector between
  two azimuths, optionally an annulus, centred on the point you clicked, with
  a live preview. They become ordinary layers of the tree, so they can be
  styled, edited and exported like any other
- the ◎ and ◔ buttons of the drawing toolbar are one-click tools: press one,
  click on the map where the centre goes, and the same dialog opens centred
  there (it can still be moved before saving). The pin (📍) works the same way.
  The toolbar lists polygon or line, rings, sector and pin in that order — the
  same order as the «Crear» menu

### ArcGIS map services

- paste the address of an ArcGIS REST `MapServer` into the 🔗 dialog: the
  service becomes one node of the tree with a row per server layer, drawn by
  the server itself as image tiles (so its symbols and labels are intact),
  and the checkboxes choose which layers it is asked for
- a layer that offers data can be brought in as real features («Traer como
  datos»), paged, capped, cancellable and imported like any downloaded GeoJSON
- no credentials are ever stored or exported (a `token` in the address is
  dropped), and a service that arrives inside someone else's `.kite.json`
  arrives switched off, with a notice naming the server

### Cadastral parcel, Wikipedia articles and orthophotos

- right-click → «Consultas» › «Parcela catastral» asks the Spanish Cadastre
  which parcel lies under the click and adds it as a polygon, with its
  cadastral reference
- right-click → «Consultas» › «Artículos de Wikipedia en la vista» asks Wikipedia
  for the geotagged articles within the reach of the current view from the click
  (up to the service's 10 km maximum; the 100 nearest) and adds
  them as «W» markers in a new folder; each marker's card holds the article's
  summary, a link to the full article and its distance, and the CC BY-SA credit
  is added to the map's attribution
- Cloud Optimized GeoTIFF orthophotos and elevation models (see
  [File support](#file-support)) stay in the browser's own store and are never
  part of an export

### Map tools

- while drawing a polygon, line or route the map can still be panned by
  dragging it (the click that ends a drag adds no vertex); removing the second
  point of a route being created undoes the route and leaves its first point
  as the preview
- the layers list of the base maps closes when you act anywhere else
- map rotation: drag the compass (or hold the middle button) to turn the map
  freely, with a click or the R key to put north back up; layers and the
  graticule rotate with it and the labels stay horizontal
- share a view as a link: right-click → «Copiar» › «Enlace a esta vista» keeps
  centre, zoom, rotation and active base maps in the `#map=…` part of the
  address, and opening such a link restores them
- place search through Nominatim; coordinates typed in the same box (decimal, decimal comma, or degrees-minutes-seconds with hemisphere letters) create a marker in "Places" and take the map there at zoom 17 without any request
- pointer coordinates in decimal degrees, degrees/minutes/seconds and UTM
- scale bar
- latitude/longitude graticule
- shortcuts for the Iberian Peninsula/Balearic Islands and Canary Islands
- drop a marker where you click (the 📍 tool; its properties open first and Cancel discards it)
- draw polygons and open lines vertex by vertex
- a day/night overlay and the sun and twilight times of a marker
- a geodesic calculator (📐): elevation angle with cone of silence and
  atmospheric-pressure correction, and the vector between two GPS positions
- export the current view as a PNG image

### Elevation

- right-click on the map → «Consultas» › «Elevación»: terrain (MDT) and
  surface (MDS) elevation of a ~40 m square around the point, drawn as a
  readable grid of cells with the difference between them — the visible
  sign of buildings or vegetation
- A− / A+ buttons above the scale make the numbers in the cells smaller or
  bigger (remembered); when the numbers no longer fit inside a cell it falls
  back to the plain red/white fill used at low zoom
- each query becomes an ordinary layer of the tree, inside one folder per
  session under «Elevaciones»: persistent, toggleable and deletable like
  any other; hovering a cell shows its values in the coordinates box
- the data sources are chosen in Properties → «Fuentes de datos», from a
  list built into the application (or none, to skip that model): the
  IGN's WCS services by default — MDT05 (5 m), MDT25 or MDT200 for the
  terrain, MDS (5 m) for the surface; Spain only — and Digital Earth
  Africa's Copernicus DEM as an alternative surface model (Africa, the
  Canary Islands and the Iberian Peninsula up to 39° N, ~30 m cells);
  each layer is named after the dataset and provider it came from
  («Elevación 3 — MDT25 + MDS (IGN)»)
- the first query to each service in a session reads its capabilities
  once, picks the finest grid of the chosen dataset and the ASCII format
  when offered (GeoTIFF otherwise), and notes the choice in the message
  log
- transient failures (timeout, network, 429, 5xx) are retried up to three
  times with a growing pause; Digital Earth Africa gets a longer timeout,
  since its first answer for an area takes 17–33 s (measured)
- heights follow their own unit of altitude, independent of the unit of
  distance (Properties → Preferencias)
- each query costs a request to a third party, so nothing is requested
  until you ask

### Route profile

- right-click on a route (or its properties dialog) → «Obtener perfil»:
  the chosen terrain (MDT) and surface (MDS) models are downloaded along
  the route in bounded chunks, with a progress bar and a scrollable debug
  log of every request sent and what came back, and drawn as an
  elevation profile — distance from the start across, height up, MDT in
  blue and MDS in green, leg vertices in bold
- hovering the chart moves a red line across it and a red arrow along the
  route on the map, pointing the way of travel; the readout gives the
  distance, both heights and their MDS−MDT difference (red above 1 m)
- the mouse wheel zooms the chart's distance around the pointer (from the
  whole route down to 0.1 m per pixel) and dragging pans it; Shift+wheel,
  or the wheel over the height axis, zooms the heights on their own
- heights rescale to what is shown unless the Y axis is locked; a toolbar
  has −/+ for each axis, «Bloquear eje Y» and «Ver todo»; the curves are
  straight segments between cell values
- only the cells the route actually crosses are kept, as a layer of the
  «Perfiles de ruta» root folder that also stores the curves: from then on
  the option reads «Mostrar perfil» and shows them without downloading
  again; editing the route's waypoints asks for a new profile
- routes longer than a configurable limit (10 NM by default) get no
  profile, so a long route cannot fill the browser storage with cells
- polygons with altitude as obstacles: the visible polygons of a KML or a GeoJSON that cross the route are drawn as blocks from the terrain up to their roof, in red where the start–end line passes below it, with a sentence saying which ones block the line and the clearance of each under the cursor. The KML altitude mode of each polygon (`absolute`, `relativeToGround`, `clampToGround`; sea-floor modes are left out with one warning per file) is kept, shown and editable in the polygon's list of points; altitude without a mode, and GeoJSON altitude, count as above sea level. Above-ground heights are added to the terrain the profile has just downloaded, with no extra request. Obstacles and the tower heights and vertices are saved with the profile; «Actualizar obstáculos» collects the visible polygons again
- the chart exports as a PNG image and its numbers as a CSV file; with the line of sight or the Fresnel ellipsoid on, the file also carries the tower positions (1 for the start tower, 2 for the end tower, 0 elsewhere), the altitude of the line of sight, the lower and upper altitude of the 60 % Fresnel zone and, with obstacles shown, their names and the highest roof at each distance, in the format of the interface language: commas and a decimal point in English, semicolons and a decimal comma in Spanish (what Excel expects there)

### Measurements

- geodesic route measurement: click each waypoint, double-click to finish —
  distance and initial bearing per leg, plus the running total; a
  two-waypoint route is the old straight-line measurement
- geodesic circle radius and area
- drag a waypoint, or a circle's centre or edge, to move it — no modifier
  key needed; insert and delete route waypoints the same way as polygon
  vertices (right-click, Shift+click, Insert, Delete)
- while its dialog is open, a measurement's figures refresh live as it is
  dragged, with no need to close and reopen the dialog, and the 🔍 action
  fits the map to its full geometry with a margin instead of a fixed zoom
  level
- stroke and fill styling, and values shown in metres, kilometres, feet,
  statute miles or nautical miles — the same unit the map labels use
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
- **`kitelocal.min.html`** — a minified derivative, and what the demo link serves: roughly 55 % smaller over the wire (gzip) than the readable build.

When it is served over https (the demo link, or your own server), a third file, **`sw.js`**, lets the page reload **without a network connection**: a small service worker that keeps the app and its pinned, integrity-checked libraries, so a tab the browser discarded comes back with your saved tree. Map tiles, place search and elevation services still need a network; the app says so instead of failing obscurely. Opened by double click (`file://`) no worker is registered and nothing changes. `sw.js` is generated from `src/sw.js` like the other two.

## Local persistence and backups

The complete tree is serialized to GeoJSON and saved in the browser using IndexedDB. Imported source files are not required after a successful import. The application also requests persistent browser storage when the browser supports it.

Browser storage is convenient, but it is **not a backup**. It may be cleared by the user, browser policy or storage pressure. Export important folders to `.kite.json` and keep copies outside the browser profile.

To start over, Properties → **Restore** deletes everything the application has saved in the browser (the tree, the copied orthophotos and every setting). A button alone does nothing: it opens a second confirmation, and the page reloads when it is done. The interface language is kept.

## Internet access and privacy

Imported KML/KMZ/GeoJSON content is parsed locally and is **not uploaded to an application server**. The imported geometries and workspace remain in the user's browser.

The current build is not fully offline and makes external requests:

- Leaflet CSS, JavaScript and default marker images, topojson-client and
  shapefile are loaded from `unpkg.com`, and JSZip from
  `cdnjs.cloudflare.com`, when the page opens;
- html2canvas and geotiff.js (`unpkg.com`) and proj4js
  (`cdnjs.cloudflare.com`) are loaded only the first time they are needed
  (PNG export, GeoTIFF/COG reading, reprojecting a shapefile `.prj`), with
  the same pinned version and integrity hash as before;
- place searches are sent to the public Nominatim service (coordinates typed in the search box are resolved locally and never sent);
- base-map tiles and WMS images are requested from their respective providers;
- elevation queries and route profiles are requested from the chosen WCS
  services (IGN by default, or Digital Earth Africa), and only when you ask
  for one; a profile is a handful of sequential requests along the route,
  under the same per-second cap. Digital Earth Africa currently answers
  Chromium-based browsers (Chrome, Edge…) with 403 Forbidden; it works
  from Firefox and Safari;
- the Copernicus DEM base layer, if enabled, is requested from Sentinel Hub
  with the user's own instance ID;
- a cadastral parcel is requested from the Spanish Cadastre (INSPIRE WFS), only
  when you ask for one from the context menu;
- the Wikipedia articles near a point are requested from the MediaWiki API of
  `es.wikipedia.org` or `en.wikipedia.org` (the language of the interface),
  only when you ask for them from the context menu: the coordinates of the
  click and the radius of the current view (10 m to 10 km), then the ids of the
  articles found;
- an ArcGIS map service you add is asked for its layer list once, and then for
  the images of the layers you tick, from the address you pasted — the only
  server in this list that the user names.

Material Design marker icons are **embedded in the file** and cost no request at all. They used to be fetched one by one from `api.iconify.design`, which meant 79 simultaneous requests every time the icon picker was opened; past the service's rate limit the icons silently went blank. They are now baked in at build time.

These providers receive ordinary request metadata, and text entered in the place search is sent to Nominatim. The imported KML geometry itself is not sent by the application to these services.

For controlled or offline deployments, vendor the JavaScript, CSS, image and icon dependencies locally, disable or replace the geocoder, and configure approved tile/WMS services.

Opening a URL downloads exactly the address you paste, with no credentials attached, and the content is then processed locally like any dropped file. Nothing is sent anywhere: the download is the only request, and it goes to the server you named.

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
- tracks, tours, models and time primitives (GPX tracks, on the other hand, are
  imported)
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

The interface is primarily designed for mouse and keyboard use. On a phone it shows a notice recommending a computer and offers a map-only layout; touch support and accessibility otherwise remain areas for improvement.

## Known limitations

- The application is a 2D Leaflet viewer, not a 3D virtual globe.
- The simple compatibility statement applies to conventional folder/placemark/line/polygon KML, not every feature in the full KML specification.
- `DOMParser` and `JSON.parse` are synchronous and can briefly block the interface on large inputs (reading the XML of a 309 MB KML is one task of about 4 seconds).
- The application sets no explicit KML-size or feature-count limit, but the browser, RAM, IndexedDB quota and rendering performance impose practical limits. A KMZ (or shapefile `.zip`) is checked before anything is unpacked: at most 2000 entries, a 200× compression ratio and an uncompressed size of 500 MB by default, which you can change in Properties → Preferences.
- Altitude is carried through import, storage and export, but it is not drawn on the map: this is a 2D viewer (the one place it is used is a route profile, where a polygon with altitude counts as an obstacle; `<extrude>` is not read, so such a polygon is always a block from the terrain up). Two placemarks at the same latitude and longitude but different altitudes are still treated as duplicates.
- KML style handling is partial: shared and inline styles for basic line and polygon appearance, and `StyleMap` normal-style references. (Namespaces are not a limitation — elements are matched by local name, so prefixed, default-namespaced and namespace-less KML all work.)
- External services can change, rate-limit requests or become unavailable.
- Opening a URL only works if that server allows other pages to read it (CORS headers). Most static hosts do; many portals do not, and the browser gives the page no detail about why. For those, download the file and drop it in — the dialog says so when it happens.
- `.kite.json` is application-specific and currently requires a matching tree schema version.
- The interface is available in Spanish and English; right-to-left languages are not supported.

## Security notes

`connect-src` accepts any https origin, which is the one directive that had to be opened: the address a URL import downloads from is chosen by the user, so enumerating origins is impossible by definition. Nothing else was relaxed — `default-src 'none'` stands, and `script-src`, `style-src` and `img-src` keep their closed lists, so a remote origin can supply data but never code or styles. `http:` is deliberately excluded.

Treat imported files as untrusted input. The viewer uses text insertion and explicit HTML escaping for marker labels, sanitizes KML `description` HTML against an allow-list, ships a restrictive `Content-Security-Policy` (`default-src 'none'` plus the specific origins it needs), and pins its CDN dependencies with Subresource Integrity. Marker icons are embedded rather than fetched, so no remote SVG is executed.

Do not use public tile, geocoding or CDN services for sensitive work without an appropriate security and privacy review.

## Development roadmap

### Done

- **The sources are split.** The application is edited as `src/index.html`,
  `src/styles.css`, `src/sw.js` and 42 JavaScript files, concatenated into the
  shipped file by `build.js`. The single-file product is the output, not the
  source.
- **There are automated tests.** 134 suites run against the shipped
  file — most under Node, plus a set that drives a real headless browser —
  covering coordinate parsing and formatting, UTM, KML namespaces and
  styles, geometry conversion, serialization, tree navigation and
  selection, hit-testing, geodesic area and perimeter, route measurement,
  interactive vertex editing, import and export formats, the attribute
  table, elevation and route profiles, the interface languages, the
  documentation itself, and more. Run them with `npm test`.
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
- **Export to KML and GeoJSON**, next to `.kite.json`, and import of GPX.
- **Obstacles in a route profile**: polygons with altitude (the KML altitude mode is now kept, shown and editable) cross the route as blocks and show whether they block the start–end line; they are saved with the profile, together with its towers.
- **An English interface**, with Spanish as the source language, and a
  light/dark theme.
- **A live tree filter**: typing in the layer search keeps only what matches (a
  20,000-layer folder filters in about 20 ms instead of building every row), and
  interface motion that respects the reduced-motion preference.
- **Nearby Wikipedia articles** from the context menu: the geotagged articles
  within the current view of a point become «W» markers with a summary and a link to the
  full article.
- **Offline reload**: a small service worker keeps the application and its
  pinned libraries, so a discarded tab comes back without a network.
- **Recent cards**: the information card no longer flickers or vanishes while
  the mouse sweeps across many markers; the ones the pointer rested on stay as
  tabs that can be looked at again, outlined on the map, and pinned.

### Still open

The full list, with the ideas that have been proposed (exporting to KMZ and GPX, importing CSV points, a visibility map, MGRS coordinates, marker clustering, time-aware KML, GeoPackage and QGIS projects…), is kept in one place: [pending work and proposals](docs/pendientes-y-propuestas-kite-local.md). The known gaps, in short:

- Touch interaction in the tree, which remains weak: the interface is built for
  mouse and keyboard.
- A fully vendored build. Leaflet and JSZip are still loaded from a CDN (the
  service worker only keeps them after a first online visit).
- More configurable resource limits: only the uncompressed KMZ size and the longest profile are adjustable; the other caps are constants in the source.
- Crossing the antimeridian: the midpoint and measurements already do, the
  automatic framing and the graticule do not yet.
- Two placemarks at the same position but different altitudes are still merged
  as duplicates.

### Deliberately not planned

- **Web Workers for parsing.** The target file sizes do not justify them, and
  a worker has neither `DOMParser` nor Leaflet, so the work would have to be
  split awkwardly across the boundary.
- **IndexedDB and `.kite.json` migrations.** Storage is versioned, and data
  from a different version is discarded rather than migrated. The version is
  only raised when a change requires it, and the user is told when a saved
  workspace is dropped.

## Diagnosing a freeze or a slowdown (`debug` branch)

There is a second branch, [`debug`](https://github.com/ifsnop/kite/tree/debug), which is `main` plus a main-thread watchdog. The released product on `main` does not carry it, and is not meant to: it is diagnostic code, it wraps several dozen functions to count and time them, and it has no business running in something people use. The two branches are otherwise the same, and this README is kept identical on both so the instructions are wherever you happen to be looking.

The watchdog exists because a reported freeze could not be reproduced under test automation: the page was dead to the user while, from the inside, nothing seemed to be running. The instrument is what eventually named the cause — a native HTML5 drag session, which is a nested event loop in the browser, so the page receives no timers, no frames and no input while it lasts, without executing a line of its own code.

Keep it for the next time something hangs or drags its feet.

**How to use it**

1. `git checkout debug && git pull`, then open `kitelocal.html` from that branch. It is already built — no `npm run build` needed.
2. Work normally. On startup it says `Vigilante activo (N funciones)`.
3. When something freezes or stalls, run `__kiteDiag()` in the browser console **before reloading**, and keep the output.

**How to read it**

| Field | What it answers |
|---|---|
| `bloqueos` | The main thread stopped. Each entry says for how long, which functions ran during the gap, which were still in flight, and the heap before and after — if that number drops sharply, the pause was garbage collection. |
| `fotogramas` | Gaps between animation frames. Frames stalling while `bloqueos` stays empty means painting is stuck, not scripting: look at the browser, not at the code. |
| `pulsaciones` | The last presses, each with what was really under the pointer and which layers were open. `tapado: true` is a click eaten by something on top. A `pointerdown` with no matching `click` is a press that turned into a drag — that was the signature of the freeze. |
| `llamadas` | Cumulative call counts, useful for spotting something called a thousand times more than it should be. |
| `memoriaSinRecolectar` | `usedJSHeapSize`, which is **not** collected memory: a large number here is not proof of a leak. Measured once at 240 MB where the live heap, after forcing collection, was 15 MB. |

**Two things it taught us, worth remembering before trusting a reading**

- "None of the watched functions" only means what it says if the right functions are watched. The first version did not cover the single-layer toggle path (`applyVisibility` → `setLayerVisible` → `rootGroup`) nor any of Leaflet's, so it reported an idle app during a 30-second block.
- Asking "what is running now" is useless. For the timer to fire again the thread must already be free, so the stack is always unwound by then. What tells the truth is the difference in call counters between two heartbeats.

To bring the branch up to date after `main` moves: `git checkout debug && git merge main`, then `npm run build` and `node tests/run-all.js`.

## Contributing

Issues and pull requests are welcome. Include the browser/version, a minimal non-sensitive sample, the expected result, and the actual result or console error.

Do not attach operational, confidential or personally identifiable geospatial data to a public issue.

**One-time setup after cloning**, alongside `npm install`: link the pre-commit hook that keeps `BUILD` and the generated artifacts in sync automatically.

```bash
ln -s ../../scripts/hooks/pre-commit .git/hooks/pre-commit
chmod +x scripts/hooks/pre-commit
```

`.git/hooks/` isn't tracked by git, so this symlink has to be created once per clone — the script itself lives at `scripts/hooks/pre-commit`, a normal tracked file, reviewable like anything else. Once linked, any commit that touches `src/` or `package.json` bumps `BUILD` (`src/js/10-map.js`) to the current timestamp, runs `npm run build`, and stages the regenerated `kitelocal.html`/`kitelocal.min.html` before the commit is created — a commit that only touches `docs/`, `tests/` or this file is left untouched. If the hook's own build or syntax check fails, the commit is aborted and the working tree is restored to exactly how it was, so the actual error (whatever broke `src/`) is the only thing left to look at. Without the symlink, nothing breaks — `BUILD` just stays whatever it was until someone bumps it (or the hook gets linked), and `npm run check`/CI still catch a stale artifact the same way they always have.

**Translations.** The interface is available in Spanish (the source language) and English, and picks the browser's language by default (Properties → Preferences → Language overrides it). The Spanish text in the code *is* the translation key (`tr("Cancelar")`), so there is no separate catalogue to keep in step; each language is one dictionary file, `src/js/04-i18n-<code>.js`. To add one:

```bash
node i18n-tool.js new fr "Français"   # creates src/js/04-i18n-fr.js with every key empty
# add "04-i18n-fr.js", to the JS manifest in build.js, before "04-i18n-init.js"
npm run i18n                          # how much of each language is translated
node i18n-tool.js sync fr             # after the code changes: keep what is translated, add new keys
```

An empty value falls back to English, then to Spanish, so a partial translation is fine; English must stay complete (`npm test` checks it, along with placeholders and that no Spanish literal is left outside `tr()`). Right-to-left languages are not supported yet. The details are in `.claude/rules/i18n.md`.

If what you hit is a freeze or a slowdown rather than a wrong result, the [`debug` branch](https://github.com/ifsnop/kite/tree/debug) carries an instrumented build that answers questions a console error cannot — see [Diagnosing a freeze or a slowdown](#diagnosing-a-freeze-or-a-slowdown-debug-branch). Its output pastes straight into an issue.

## Releasing

Feature work and fixes land on branches, each through its own pull request into `main`. Cutting a release once every intended PR is merged:

1. Bump `package.json`'s `"version"` and update the version shown in the user manual and the security study under `docs/`, then commit — this is the release's final commit. The pre-commit hook (see "Contributing") notices `package.json` changing, bumps `BUILD` and runs `npm run build` on its own, so there's no separate manual build step here anymore.
2. Tag that exact commit and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. The tag **must** match `package.json`'s version precisely (with a leading `v`).
3. [`.github/workflows/release.yml`](.github/workflows/release.yml) takes it from there: it verifies the tag matches `package.json`, that `kitelocal.html`/`kitelocal.min.html`/`sw.js` are up to date with `src/`, and runs the full test suite (`npm test`, with the browser suites required) — only then does it publish the GitHub Release itself, with auto-generated release notes from the merged PRs and both artifacts attached as downloadable assets for that exact version.

If any of those checks fail, the workflow fails and **no Release is published** — the test run happens inside this same job specifically so a red suite stops it before the publish step ever runs, rather than racing independently against the separate `tests.yml` workflow that the same tag push also triggers. Fix what's missing (the version bump, `npm run build`, or the failing test), delete the bad tag (`git push --delete origin vX.Y.Z`), and tag the corrected commit.

`package.json`'s `"version"` is the single source of truth: `build.js` bakes it into the app's attribution line (`v<version> (<build>) | GitHub | Leaflet`, bottom-right of the map) at build time, the same way it already inlines the page's CSS and JS.

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

See the repository's `LICENSE` file for the complete license text. Redistribution and modification are subject to the AGPL-3.0 terms.

The map rotation code (`src/js/08-map-rotation.js`) is derived from [leaflet-rotate](https://github.com/Raruto/leaflet-rotate) 0.2.8 by Raruto and contributors (IvanSanchez, Fnicollet, Hyperknot), released under the GPL-3.0. It has been incorporated, cut down and modified, and is distributed as part of KITE Local under the AGPL-3.0, as section 13 of the GPLv3 allows; its authorship notice is kept in the file.

## Third-party services and libraries

This application currently uses or accesses:

- [Leaflet](https://leafletjs.com/)
- [JSZip](https://stuk.github.io/jszip/)
- [topojson-client](https://github.com/topojson/topojson-client)
- [html2canvas](https://html2canvas.hertzen.com/)
- [geotiff.js](https://geotiffjs.github.io/) (MIT) — reads elevation grids from services that only offer GeoTIFF, and COG orthophotos
- [shapefile](https://github.com/mbostock/shapefile) (BSD-3-Clause) — reads `.shp` and `.dbf` into GeoJSON
- [proj4js](https://proj4js.org/) (MIT) — reprojects shapefile coordinates from their `.prj`, and COG orthophotos per tile
- [leaflet-rotate](https://github.com/Raruto/leaflet-rotate) (GPL-3.0) — incorporated into the source (see License); not requested at runtime
- [Material Design Icons](https://pictogrammers.com/library/mdi/) (Pictogrammers, Apache-2.0) — embedded at build time through [Iconify](https://iconify.design/); not requested at runtime
- [OpenStreetMap](https://www.openstreetmap.org/)
- [Nominatim](https://nominatim.org/)
- Esri World Terrain and hillshade
- Spanish PNOA, IGN WMTS, WMS and WCS services
- [Dirección General del Catastro](https://www.sedecatastro.gob.es/) — cadastral reference and INSPIRE parcel service, only when you ask for a parcel
- [Wikipedia](https://www.wikipedia.org/) (MediaWiki API, Wikimedia Foundation) — geotagged articles and their summaries, only when you ask for them; the text is under CC BY-SA 4.0
- [Ayuntamiento de Madrid orthophoto WMS](https://geoportal.madrid.es/) (data source: Ayuntamiento de Madrid)
- [SRTM30 tiles from terrestris](https://ows.terrestris.de/) (SRTM data © NASA LP DAAC)
- [Copernicus DEM through Sentinel Hub](https://dataspace.copernicus.eu/)
- [Digital Earth Africa](https://www.digitalearthafrica.org/) WCS — Copernicus DEM GLO-30 (© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA)

Their licenses, attribution requirements, acceptable-use policies and service limits apply independently.

## Google Earth desktop transition references

- Google Earth Help Community announcement — add the canonical announcement URL when confirmed
- [PCWorld coverage of the 25 June 2027 download cutoff](https://www.pcworld.com/article/3186820/you-have-until-2027-to-download-google-earth-pro-do-it-now.html)
- [Geopera analysis of the desktop transition](https://geopera.com/blog/google-earth-pro-desktop-discontinued)

Google Earth and Google Earth Pro are trademarks of Google LLC.
