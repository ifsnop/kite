---
title: "Self-hosting needs only the minified page and sw.js side by side, and the sample file is linked from the demo's own site"
author: Diego
date: 2026-11-20
branch: docs/readme-pitch
cost: { minutes: 10, tokens: 1337909 }
id: l-d1ca7adf
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - CONTRIBUTING.md
  - DEVELOPMENT.md
  - README.md
  - tests/README.md
  - tests/docs.js
  - kitelocal.min.html
  - index.html
  - sw.js
  - src/js/06-offline.js
---

## Decided
The README tells self-hosters to copy `kitelocal.min.html` (renamed to `index.html` if they want it at the folder's address) and `sw.js` into the same folder of any static server, with HTTPS or localhost only needed for the offline reload. It also says plainly that the page still loads its libraries from public CDNs and map tiles from their providers, so an air-gapped intranet must vendor them first. The sample KMZ is linked from the same site as the demo (`/docs/ejemplos/…`), because Pages publishes the whole repository and serves it with the KMZ content type.

## Tried and ruled out
The `raw/main` link to the sample: it works (GitHub serves it as `application/octet-stream`, so the browser downloads it) and was kept out only for being a redirect to another host. A reviewer's worry that it opens a tab of binary characters did not hold, because that content type forces a download. Promising «no network needed» for a self-hosted copy: ruled out because Leaflet and JSZip come from unpkg and cdnjs on every start, otherwise the sentence would be false for exactly the readers it targets.

## Watch out
The recipe was verified with a plain `python3 -m http.server` over `127.0.0.1` (a secure context): the app boots, the worker activates with the folder as its scope, 11 entries are precached and a reload with the network off boots the app with no page errors. The worker is registered as a relative `sw.js`, so it must sit next to the page; renaming the page is safe, moving the worker is not. A «404 badge not found» seen in a review of the README could not be reproduced: the three badges return 200 (check the live preview after publishing rather than trusting a cached screenshot).

In the code: `README.md` (Quick start › Self-hosting, the sample link, the badges), `src/js/06-offline.js` (`OFFLINE_WORKER`), `.github/workflows/deploy-pages.yml` (uploads `.`).
