# 🌍 3D Earth Lab — Mountains & Depths

A cinematic, *Game of Thrones*-style flight over the real Earth, where **mountains rise and ocean trenches plunge**. It is a side-by-side lab that compares the three leading ways to render a 3D globe with exaggerated terrain on the web, so you can feel the trade-offs yourself.

Each prototype shares the same experience: **a cinematic intro flythrough on load, then free orbit/zoom/tilt**. A live **Relief** slider exaggerates the terrain in real time.

| Engine | Style | Ocean depths | Needs a key? |
|---|---|---|---|
| **CesiumJS** | Data-accurate real globe | ✅ Native (GEBCO bathymetry) | Free Cesium ion token (graceful fallback without) |
| **Three.js** | Stylized, displacement-mapped | ⚠️ Artistic (height-map driven) | No — uses local textures |
| **MapLibre GL JS** | Free & open | ❌ Land only (flat oceans) | No — keyless data sources |

## Highlights

- **Built a lab that compares three WebGL engines** (CesiumJS, Three.js, MapLibre GL JS) for cinematic 3D Earth terrain and sea-floor rendering, with terrain exaggeration you can change at runtime.
- **Built a Vite multi-page app** with shared UI modules and one exaggeration/animation layer per engine. It still works when API keys are missing.
- **Set up CI/CD with GitHub Actions** that builds the static site and deploys it to GitHub Pages, with API keys held as secrets and restricted by domain.

## Quick start

```bash
npm install
npm run download-assets   # fetch + downscale the Three.js Earth textures
npm run dev               # open the printed localhost URL
```

> Everything works right away. Without API keys, each prototype falls back to a keyless source. Without the textures, the Three.js globe simply stays smooth and shows a notice on screen.

## API keys (optional, both free)

Copy `.env.example` to `.env` and fill in what you want:

- **`VITE_CESIUM_ION_TOKEN`** — free at <https://ion.cesium.com/tokens>. Unlocks real Cesium World Bathymetry. Without it, the Cesium page shows a flat OpenStreetMap globe with a notice.
- **`VITE_MAPTILER_KEY`** — free at <https://cloud.maptiler.com/account/keys/>. Optional higher-resolution satellite basemap for MapLibre. Without it, MapLibre uses keyless EOX Sentinel-2 imagery + Mapterhorn DEM.

All keys are **public, browser-side keys**. Restrict them by domain in each provider's dashboard before you deploy publicly.

## Assets (textures)

The Three.js prototype pushes a sphere's surface in and out from a grayscale height map of land and sea floor (topo+bathy), then drapes a colour map over it. Both globes use a night-lights map for the city-lights effect. All three are public-domain NASA imagery (Blue Marble color, GEBCO elevation/bathymetry, Black Marble night lights). Fetch and downscale them with:

```bash
npm run download-assets
```

That runs [`scripts/download-assets.sh`](scripts/download-assets.sh). It downloads the originals and resizes them (the raw GEBCO height map is 21600×10800) into `public/textures/` (`earth_color.jpg`, `earth_height.png`, `earth_night.jpg`). It uses `sips` on macOS, or ImageMagick (`magick`) elsewhere. Missing textures are not an error: the Three.js globe just stays smooth and unlit.

## How each prototype works

- **CesiumJS** (`src/cesium/main.js`) — `Cesium.Terrain.fromWorldBathymetry()` gives real land and ocean-floor relief; `scene.verticalExaggeration` drives the slider at runtime (no tile refetch). Fly out to the Mariana Trench to see the depths.
- **Three.js** (`src/three/main.js`) — `MeshStandardMaterial` with a `displacementMap`; `displacementBias` pins sea level, so oceans dip inward and land pushes out. Adds a starfield and a fresnel atmosphere. *(`globe.gl` is simpler, but its bump map only shades — it does not move geometry — so we use raw Three.js for true relief.)*
- **MapLibre GL JS** (`src/maplibre/main.js`) — globe projection + `raster-dem` terrain via `setTerrain({ exaggeration })`. Oceans stay flat, and it says so.
- **Fantasy World** (`src/fantasy/main.js`) — *not Earth.* A planet generated from seeded simplex noise on an icosphere, drawn in a Game-of-Thrones **parchment** style: the noise moves the real geometry to make 3D mountains over flat oceans, coloured by height, with inked coastlines. **🎲 New world** reseeds it. The seed lives in the URL hash, so you can bookmark or share a world.

### 🌃 Day / Night city lights

CesiumJS and Three.js have a **Night lights** toggle (HUD button). It lights up the dark side of the globe with NASA **Black Marble** city lights and a real sun terminator:

- **CesiumJS** adds the ion "Earth at Night" layer (asset `3812`) with `nightAlpha`, so it shows only on the dark side. Toggling it swaps the always-on head-light for the real sun and drifts time, so the terminator moves. If the ion asset is not on your account, it falls back to the local `earth_night.jpg` texture.
- **Three.js** uses an emissive Black Marble map. A small `onBeforeCompile` shader tweak masks it, so cities glow **only** on the night hemisphere (not in daylight).

### 🎬 Record clips (captions + MP4 export)

Every scenario has a **🔴 Record** button and an **✎ Captions** editor (shared module [`src/shared/clips.js`](src/shared/clips.js)):

- **Captions** are a simple editable list (`time  text`, one per line, saved to `localStorage`). They appear as cinematic on-screen titles synced to the intro. Cesium's defaults are the **7 continent names**, generated from the tour timings; the other engines get one editable title card.
- **🔴 Record** replays the scenario and exports an **MP4** with the text baked in. It draws the engine canvas plus the caption onto a 2D canvas and encodes it with **WebCodecs** ([`canvas-record`](https://github.com/dmnsgn/canvas-record), loaded only on the first record — so no page-load cost, and no cross-origin-isolation headers needed). Each engine is created with `preserveDrawingBuffer: true` so the recorder can read frames.

### 🎬 Scenarios (data-driven, cross-engine)

Camera tours are **data**, not hardcoded, so many scenarios can be added:

- A **scenario** is a list of geographic waypoints (`{ lon, lat, height, heading, pitch, durationMs, caption }`) plus optional settings, in [`src/scenarios/`](src/scenarios/). To add one, add a data entry. Captions and clip length come from the waypoints.
- **Cross-engine**: a shared [player](src/shared/scenarioPlayer.js) runs the same scenario on **CesiumJS, MapLibre, and the Three.js Earth**. Tiny per-engine adapters convert the geographic pose to each camera API. So `seven-continents` runs on all three. (Fidelity differs: MapLibre clamps pitch to ≤85°, and the Three.js globe is top-down-centric.)
- **Picker + deep-link**: a **🎬 Scenarios** menu lists the built-in and your saved scenarios; `?scenario=<id>` links straight to one.
- **In-app builder**: capture the current camera view as a waypoint, add captions and timings, then **Save** (localStorage) or **Export/Import JSON**.

## Deploy

`npm run build` writes a static site to `dist/`. The included GitHub Actions workflow (`.github/workflows/deploy.yml`) builds it and publishes it to **GitHub Pages** on every push to `main`. Add `VITE_CESIUM_ION_TOKEN` and `VITE_MAPTILER_KEY` as repository **Secrets**, and enable Pages → "GitHub Actions" in the repo settings.

## Tech stack

Vite (multi-page) · Vanilla JS · CesiumJS · Three.js · MapLibre GL JS · GitHub Actions / GitHub Pages

## Experience Gained

- Compared 3 rendering engines (CesiumJS, Three.js, MapLibre GL JS) side by side for 3D terrain on the web, each behind the same intro flythrough and Relief slider.
- Hardened the deploy workflow (`.github/workflows/deploy.yml`): all 4 actions are pinned to a commit SHA, and `pages: write` / `id-token: write` are granted only on the deploy job, not the build job.
- Wrote an asset-download script (`scripts/download-assets.sh`) that fetches and shrinks 3 public-domain NASA textures, including a 21600×10800 GEBCO height map.
- Made every prototype work with 0 API keys: each falls back to a keyless data source and shows a notice instead of failing.

## License

MIT. Earth imagery courtesy of NASA (public domain), EOX (Sentinel-2 cloudless), and the GEBCO bathymetric grid.
