// ── MapLibre GL JS prototype ──────────────────────────────────────────
// Free/open globe with 3D land terrain (raster-DEM) and runtime exaggeration.
// Honest baseline: great relief on land, but oceans render flat — standard
// terrain data has no bathymetry. Cinematic fly-in, then free navigation.

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../shared/styles.css';
import {
  createHud,
  createFpsMeter,
  showOverlay,
  hasWebGL,
  prefersReducedMotion,
} from '../shared/hud.js';

const maptilerKey = import.meta.env.VITE_MAPTILER_KEY?.trim();
const DEFAULT_EXAGGERATION = 2.5;

// A dramatic, high-relief target for the intro sweep: Everest / the Himalaya.
const INTRO_TARGET = { center: [86.925, 27.62], zoom: 9.2, pitch: 78, bearing: 18 };
const WIDE_VIEW = { center: [86.9, 12], zoom: 1.6, pitch: 0, bearing: 0 };

if (!hasWebGL()) {
  showOverlay({
    title: 'WebGL not available',
    html: '<p>This prototype needs WebGL. Try a recent desktop browser.</p>',
    isError: true,
  });
} else {
  start();
}

function start() {
  // Imagery: MapTiler satellite if a key is set, else keyless EOX Sentinel-2.
  const imagery = maptilerKey
    ? {
        type: 'raster',
        tiles: [`https://api.maptiler.com/maps/satellite/256/{z}/{x}/{y}.jpg?key=${maptilerKey}`],
        tileSize: 256,
        attribution: '© MapTiler © Sentinel',
      }
    : {
        type: 'raster',
        tiles: [
          'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
        ],
        tileSize: 256,
        attribution: 'Sentinel-2 cloudless · © EOX',
      };

  // Keyless terrain + hillshade DEM (used in MapLibre's own official examples).
  const demUrl = 'https://tiles.mapterhorn.com/tilejson.json';

  const style = {
    version: 8,
    projection: { type: 'globe' },
    sources: {
      imagery,
      terrainSource: { type: 'raster-dem', url: demUrl },
      hillshadeSource: { type: 'raster-dem', url: demUrl },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#05070d' } },
      { id: 'imagery', type: 'raster', source: 'imagery' },
      {
        id: 'hills',
        type: 'hillshade',
        source: 'hillshadeSource',
        paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#1b1205' },
      },
    ],
    terrain: { source: 'terrainSource', exaggeration: DEFAULT_EXAGGERATION },
    sky: {
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    },
    light: { anchor: 'map', position: [1.5, 90, 80] },
  };

  const map = new maplibregl.Map({
    container: 'scene',
    style,
    ...WIDE_VIEW,
    maxPitch: 85,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

  // Non-fatal: log tile/source errors (e.g. an offline DEM) without a blank screen.
  map.on('error', (e) => console.warn('[maplibre]', e?.error?.message || e));

  // ── Cinematic intro ────────────────────────────────────────────────
  function playIntro() {
    map.jumpTo(WIDE_VIEW);
    if (prefersReducedMotion()) {
      map.jumpTo(INTRO_TARGET);
      return;
    }
    // Let the globe register, then swoop down and tilt toward the peaks.
    window.setTimeout(() => {
      map.flyTo({ ...INTRO_TARGET, duration: 9000, curve: 1.42, essential: true });
    }, 500);
  }

  // ── HUD ──────────────────────────────────────────────────────────────
  const hudApi = createHud({
    engine: 'MapLibre GL JS',
    note: '3D land terrain from open DEM tiles. Oceans render flat — standard terrain has no bathymetry.',
    exaggeration: { min: 1, max: 6, value: DEFAULT_EXAGGERATION, step: 0.5 },
    onExaggeration: (v) => map.setTerrain({ source: 'terrainSource', exaggeration: v }),
    onReplay: playIntro,
  });

  // ── FPS meter (ticked on each rendered frame) ──────────────────────
  const fpsTick = createFpsMeter(hudApi.setFps);
  map.on('render', fpsTick);

  map.on('load', playIntro);
}
