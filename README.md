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
- pan to a node, zoom to a node (a fixed level for a marker; a
  margin-framed fit-to-bounds for a polygon, line or measurement), and fit
  the map to loaded content
- an information panel per layer: the original KML `description`
  (sanitized against an allow-list) or a table of the GeoJSON
  `properties`
- right-click menu on the map, which resolves overlapping layers into a
  submenu instead of guessing one
- export any folder or file as a portable `.kite.json` package
- local storage usage indicator, and a session log of every notice shown
- a Properties panel with a Preferences tab for global settings — measurement
  unit, coordinate format and the interactive-vertex-edit cap — previewed
  live in any open dialog but only saved on Accept, plus a second tab that
  remembers which GeoJSON property was used as each file's name

### Loading

- drag KML, KMZ, GeoJSON, TopoJSON and exported `.kite.json` folders onto
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
- Opening a URL only works if that server allows other pages to read it (CORS headers). Most static hosts do; many portals do not, and the browser gives the page no detail about why. For those, download the file and drop it in — the dialog says so when it happens.
- `.kite.json` is application-specific and currently requires a matching tree schema version.
- The current interface is in Spanish.

## Security notes

`connect-src` accepts any https origin, which is the one directive that had to be opened: the address a URL import downloads from is chosen by the user, so enumerating origins is impossible by definition. Nothing else was relaxed — `default-src 'none'` stands, and `script-src`, `style-src` and `img-src` keep their closed lists, so a remote origin can supply data but never code or styles. `http:` is deliberately excluded.

Treat imported files as untrusted input. The viewer uses text insertion and explicit HTML escaping for marker labels, sanitizes KML `description` HTML against an allow-list, ships a restrictive `Content-Security-Policy` (`default-src 'none'` plus the specific origins it needs), and pins its CDN dependencies with Subresource Integrity. Marker icons are embedded rather than fetched, so no remote SVG is executed.

Do not use public tile, geocoding or CDN services for sensitive work without an appropriate security and privacy review.

## Development roadmap

### Done

- **The sources are split.** The application is edited as `src/index.html`,
  `src/styles.css` and twenty JavaScript files, concatenated into the shipped
  file by `build.js`. The single-file product is the output, not the source.
- **There are automated tests.** Fifty-eight suites run against the shipped
  file — most under Node, plus a set that drives a real headless browser —
  covering coordinate parsing and formatting, UTM, KML namespaces and
  styles, geometry conversion, serialization, tree navigation and
  selection, hit-testing, geodesic area and perimeter, multi-waypoint route
  measurement, interactive vertex editing, and more. Run them with
  `npm test`.
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

If what you hit is a freeze or a slowdown rather than a wrong result, the [`debug` branch](https://github.com/ifsnop/kite/tree/debug) carries an instrumented build that answers questions a console error cannot — see [Diagnosing a freeze or a slowdown](#diagnosing-a-freeze-or-a-slowdown-debug-branch). Its output pastes straight into an issue.

## Releasing

Feature work and fixes land on branches, each through its own pull request into `main`. Cutting a release once every intended PR is merged:

1. Bump `package.json`'s `"version"` and update the version shown in the two documents under `docs/` (the user manual and the security study), then commit — this is the release's final commit. The pre-commit hook (see "Contributing") notices `package.json` changing, bumps `BUILD` and runs `npm run build` on its own, so there's no separate manual build step here anymore.
2. Tag that exact commit and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`. The tag **must** match `package.json`'s version precisely (with a leading `v`).
3. [`.github/workflows/release.yml`](.github/workflows/release.yml) takes it from there: it verifies the tag matches `package.json`, that `kitelocal.html`/`kitelocal.min.html` are up to date with `src/`, and runs the full test suite (`npm test`, with the browser suites required) — only then does it publish the GitHub Release itself, with auto-generated release notes from the merged PRs and both artifacts attached as downloadable assets for that exact version.

If any of those checks fail, the workflow fails and **no Release is published** — the test run happens inside this same job specifically so a red suite stops it before the publish step ever runs, rather than racing independently against the separate `tests.yml` workflow that the same tag push also triggers. Fix what's missing (the version bump, `npm run build`, or the failing test), delete the bad tag (`git push --delete origin vX.Y.Z`), and tag the corrected commit.

`package.json`'s `"version"` is the single source of truth: `build.js` bakes it into the app's attribution line (`v<version> (<build>) | GitHub | Leaflet`, bottom-right of the map) at build time, the same way it already inlines the page's CSS and JS.

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
