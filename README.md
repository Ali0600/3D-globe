# 🌍 3D Earth Lab — Mountains & Depths

A cinematic, *Game of Thrones*-style flight over the real Earth, where **mountains rise and ocean trenches plunge**. It's a side-by-side lab comparing the three leading ways to render a 3D globe with exaggerated terrain on the web, so you can feel the trade-offs yourself.

Each prototype shares the same experience — **a cinematic intro flythrough on load, then free orbit/zoom/tilt** — plus a live **Relief** slider to exaggerate the terrain in real time.

| Engine | Style | Ocean depths | Needs a key? |
|---|---|---|---|
| **CesiumJS** | Data-accurate real globe | ✅ Native (GEBCO bathymetry) | Free Cesium ion token (graceful fallback without) |
| **Three.js** | Stylized, displacement-mapped | ⚠️ Artistic (height-map driven) | No — uses local textures |
| **MapLibre GL JS** | Free & open | ❌ Land only (flat oceans) | No — keyless data sources |

## Highlights

- **Engineered a comparative WebGL geospatial visualization lab** benchmarking three rendering engines (CesiumJS, Three.js, MapLibre GL JS) for cinematic 3D Earth terrain + bathymetry rendering with runtime vertical exaggeration.
- **Built a Vite multi-page application** with shared UI modules and a per-engine exaggeration/animation abstraction, plus graceful degradation when API keys are absent.
- **Implemented CI/CD with GitHub Actions** to build and deploy a static site to GitHub Pages, with secret-managed, domain-restricted API keys.

## Quick start

```bash
npm install
npm run download-assets   # fetch + downscale the Three.js Earth textures
npm run dev               # open the printed localhost URL
```

> Everything works immediately. Without API keys each prototype falls back gracefully; without the textures the Three.js globe simply stays smooth (with an on-screen notice).

## API keys (optional, both free)

Copy `.env.example` to `.env` and fill in what you want:

- **`VITE_CESIUM_ION_TOKEN`** — free at <https://ion.cesium.com/tokens>. Unlocks real Cesium World Bathymetry. Without it, the Cesium page shows a flat OpenStreetMap globe with a notice.
- **`VITE_MAPTILER_KEY`** — free at <https://cloud.maptiler.com/account/keys/>. Optional higher-res satellite basemap for MapLibre. Without it, MapLibre uses keyless EOX Sentinel-2 imagery + Mapterhorn DEM.

All keys are **public, browser-side keys** — restrict them by domain in each provider's dashboard before deploying publicly.

## Assets (Three.js only)

The Three.js prototype displaces a sphere from a grayscale topo+bathy height map and drapes a color map over it. Both are public-domain NASA imagery (Blue Marble color + GEBCO elevation/bathymetry). Fetch and downscale them with:

```bash
npm run download-assets
```

That runs [`scripts/download-assets.sh`](scripts/download-assets.sh), which downloads the originals and resizes them (the raw GEBCO height map is 21600×10800) into `public/textures/`. It uses `sips` on macOS, or ImageMagick (`magick`) elsewhere. If the height map is missing, the Three.js page still runs but the globe stays smooth (with an on-screen notice).

## How each prototype works

- **CesiumJS** (`src/cesium/main.js`) — `Cesium.Terrain.fromWorldBathymetry()` for real land + ocean-floor relief; `scene.verticalExaggeration` drives the slider at runtime (no tile refetch). Fly out to the Mariana Trench to see the depths.
- **Three.js** (`src/three/main.js`) — `MeshStandardMaterial` with a `displacementMap`; `displacementBias` pins sea level so oceans dip inward and land pushes out. Adds a starfield + fresnel atmosphere. *(`globe.gl` is simpler but its bump map only shades — it doesn't move geometry — so we use raw Three.js for true relief.)*
- **MapLibre GL JS** (`src/maplibre/main.js`) — globe projection + `raster-dem` terrain via `setTerrain({ exaggeration })`. Honest about flat oceans.

## Deploy

`npm run build` outputs a static site to `dist/`. The included GitHub Actions workflow (`.github/workflows/deploy.yml`) builds and publishes to **GitHub Pages** on push to `main`. Add `VITE_CESIUM_ION_TOKEN` and `VITE_MAPTILER_KEY` as repository **Secrets**, and enable Pages → "GitHub Actions" in repo settings.

## Tech stack

Vite (multi-page) · Vanilla JS · CesiumJS · Three.js · MapLibre GL JS · GitHub Actions / GitHub Pages

## License

MIT. Earth imagery courtesy of NASA (public domain), EOX (Sentinel-2 cloudless), and the GEBCO bathymetric grid.
