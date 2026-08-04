# KITE Local

**KML Interactive Tree Explorer**

A privacy-first, browser-based viewer and organizer for **KML, KMZ and GeoJSON** files. It preserves nested KML folder structures as an interactive layer tree, runs from one self-contained HTML file, and keeps imported data inside the user's browser.

> **In short:** if a KML is used as a conventional collection of folders, placemarks, lines and polygons in Google Earth, KITE Local is designed to open it directly while retaining its folder hierarchy. Advanced Google Earth features such as 3D models, tours, overlays and network links are outside the current scope.

## Why this project exists

Google has announced that new downloads of **Google Earth Pro for desktop will end on 25 June 2027**. Existing installations are expected to continue working, but the desktop client will no longer be the long-term distribution path. Google is directing users towards its web and mobile products.

That transition leaves a practical gap for users who mainly need to open local KML/KMZ files, retain their organization, compare layers, adjust simple styles, add locations and make quick measurements without installing a full GIS package or uploading data to an application server.

KITE Local focuses deliberately on that workflow:

- **Preserve the original nested KML folder hierarchy.** Imported `Document` and `Folder` structures remain a browsable tree instead of being flattened into geometry layers or reduced to metadata.
- **Control visibility at every level.** Toggle a complete file, folder or subtree with one checkbox, or enable and disable individual layers.
- **Keep data local.** KML, KMZ and GeoJSON files are read and processed in the browser. They are not uploaded to an application server.
- **Use one self-contained HTML file.** There is no installer, package manager, compilation step or application backend.
- **Avoid application-imposed import quotas.** The viewer sets no file-size, feature-count or vertex-count limit; practical capacity is determined by the browser and the user's available memory and storage.
- retain the workspace locally through IndexedDB;
- export selected folders as portable `.kite.json` packages;
- provide map, marker, graticule and geodesic measurement tools.

It is an independent GPL-3.0 project and is **not affiliated with or endorsed by Google, Google Earth, QGIS, OpenStreetMap, Esri, Leaflet, Iconify or Instituto Geográfico Nacional de España**.

## Key differentiators

### KML hierarchy is a first-class feature

Many KML files are not merely collections of geometries: their nested folders carry operational meaning. KITE Local recreates this hierarchy in the navigation panel and allows each file, folder, subtree and individual layer to be enabled or disabled.

General-purpose GIS importers commonly translate KML folders into separate geometry layers or store the original path as an attribute. KITE Local instead keeps the structure visible and directly usable.

### Local processing and data control

Imported files are parsed locally. Their geometries and workspace remain in the browser and are stored locally through IndexedDB. No application account or backend upload is required.

External requests are still made for libraries, map tiles, WMS imagery, marker icons and optional place searches; see [Internet access and privacy](#internet-access-and-privacy).

### One portable HTML file

The complete application—interface, styles and program logic—is contained in one HTML file. Download it and open it in a modern browser. No build, installation or server is needed.

### No artificial KML import quota

KITE Local does not impose fixed limits on KML file size, imported features or vertices. Actual limits depend on browser capabilities, available RAM, local storage quota and rendering performance.

## Features

### File support

- KML files, preserving nested `Document` and `Folder` structures
- KMZ archives containing KML
- GeoJSON and JSON files
- KITE Local folder exports (`.kite.json`)
- drag-and-drop import
- progress indication and batched layer construction for larger files

### Layer workspace

- hierarchical tree of files, folders and layers
- global, file, folder, subtree and individual visibility controls
- rename, delete, reorder and alphabetically sort nodes
- drag layers and folders within the tree
- multi-selection for compatible layer types
- collapse and expand folders
- search by layer or folder name
- pan to a node and fit the map to loaded content

### Styling and editing

- Leaflet and Material Design marker icons
- marker size, colour, label size and label colour
- optional permanent marker labels
- marker renaming and coordinate editing in decimal degrees or DMS
- marker repositioning by dragging
- polygon and line outline width and colour
- polygon fill colour and opacity
- batch style changes for selected compatible layers

### Mapping tools

- OpenStreetMap base map
- Esri World Terrain base map
- Spanish PNOA orthophotography
- Spanish IGN terrain WMS
- optional blank base map
- place search through Nominatim
- pointer coordinates
- latitude/longitude graticule
- shortcuts for the Iberian Peninsula/Balearic Islands and Canary Islands

### Measurements

- geodesic line distance and initial bearing
- geodesic circle radius and bearing
- editable measurement handles
- persistent measurements stored with the workspace

## Quick start

1. Download or clone this repository.
2. Open the application HTML file in a modern desktop browser.
3. Drag KML, KMZ, GeoJSON or `.kite.json` files onto the left navigation panel.
4. Use the retained folder tree to organize, compare, show, hide and style the imported content.

```bash
git clone <repository-url>
cd <repository-directory>
```

No package manager, web server or build process is required. The complete application is distributed as one HTML file.

## Local persistence and backups

The complete tree is serialized to GeoJSON and saved in the browser using IndexedDB. Imported source files are not required after a successful import. The application also requests persistent browser storage when the browser supports it.

Browser storage is convenient, but it is **not a backup**. It may be cleared by the user, browser policy or storage pressure. Export important folders to `.kite.json` and keep copies outside the browser profile.

## Internet access and privacy

Imported KML/KMZ/GeoJSON content is parsed locally and is **not uploaded to an application server**. The imported geometries and workspace remain in the user's browser.

The current build is not fully offline and makes external requests:

- Leaflet CSS, JavaScript and default marker images are loaded from `unpkg.com`;
- JSZip is loaded from `cdnjs.cloudflare.com`;
- Material Design marker SVGs are loaded from `api.iconify.design`;
- place searches are sent to the public Nominatim service;
- base-map tiles and WMS images are requested from their respective providers.

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

KML is a broad specification. The following are not fully supported or are intentionally simplified:

- Google Earth icon styles and arbitrary remote/local icon resources
- altitude rendering and altitude modes
- extrusions and 3D geometry
- ground and screen overlays
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
- KML point altitude is currently ignored.
- KML namespace and style handling is partial.
- External services can change, rate-limit requests or become unavailable.
- `.kite.json` is application-specific and currently requires a matching tree schema version.
- The current interface is in Spanish.

## Security notes

Treat imported files as untrusted input. The viewer uses text insertion and explicit HTML escaping for marker labels, but a public deployment should also add a restrictive Content Security Policy, validate imported sizes and numeric values, and pin or self-host external dependencies. Remote SVG responses should be considered untrusted until sanitized or replaced with locally reviewed assets.

Do not use public tile, geocoding or CDN services for sensitive work without an appropriate security and privacy review.

## Development roadmap

1. Split the application into modules for parsing, state, persistence, rendering, dialogs and measurements.
2. Add automated tests for coordinate parsing, KML colours, hierarchy preservation, geometry conversion, serialization and schema validation.
3. Run KML/GeoJSON parsing in Web Workers.
4. Add input validation and configurable resource limits.
5. Pin dependencies with Subresource Integrity or provide a fully vendored offline build.
6. Improve keyboard navigation, focus management, ARIA labels and touch interaction.
7. Add documented IndexedDB and `.kite.json` migrations.
8. Add optional export to standard KML and GeoJSON.

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
- [Material Design Icons through Iconify](https://iconify.design/)
- [OpenStreetMap](https://www.openstreetmap.org/)
- [Nominatim](https://nominatim.org/)
- Esri World Terrain
- Spanish PNOA and IGN WMS services

Their licenses, attribution requirements, acceptable-use policies and service limits apply independently.

## Google Earth desktop transition references

- Google Earth Help Community announcement — add the canonical announcement URL when confirmed
- [PCWorld coverage of the 25 June 2027 download cutoff](https://www.pcworld.com/article/3186820/you-have-until-2027-to-download-google-earth-pro-do-it-now.html)
- [Geopera analysis of the desktop transition](https://geopera.com/blog/google-earth-pro-desktop-discontinued)

Google Earth and Google Earth Pro are trademarks of Google LLC.
