// ── MapLibre GL JS prototype ──────────────────────────────────────────
// Free/open globe with 3D land terrain (raster-DEM) and runtime exaggeration.
// Honest baseline: great relief on land, but oceans render flat — standard
// terrain data has no bathymetry. Cinematic fly-in, then free navigation.

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../shared/styles.css';
import {
  createHud,
  createInstructions,
  createFpsMeter,
  showOverlay,
  hasWebGL,
  prefersReducedMotion,
} from '../shared/hud.js';
import { createClips } from '../shared/clips.js';
import { createScenarioUI } from '../shared/scenarioUI.js';
import { playScenario, captionTrack, scenarioDurationMs } from '../shared/scenarioPlayer.js';
import * as scenarios from '../scenarios/index.js';

const maptilerKey = import.meta.env.VITE_MAPTILER_KEY?.trim();
const DEFAULT_EXAGGERATION = 2.5;

// Opening wide globe view (also the map's initial camera).
const WIDE_VIEW = { center: [86.9, 12], zoom: 1.6, pitch: 0, bearing: 0 };

// Convert a geographic altitude (m) ↔ MapLibre zoom (approximate; calibrated so
// ~10,000 km ≈ whole-globe and a few hundred km ≈ regional).
const heightToZoom = (h) => Math.max(0, Math.min(18, Math.log2(2.0e7 / Math.max(h, 1000))));
const zoomToHeight = (z) => 2.0e7 / Math.pow(2, z);

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
    preserveDrawingBuffer: true, // lets the clip recorder read the rendered frame
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

  // Non-fatal: log tile/source errors (e.g. an offline DEM) without a blank screen.
  map.on('error', (e) => console.warn('[maplibre]', e?.error?.message || e));

  // ── HUD ──────────────────────────────────────────────────────────────
  const hudApi = createHud({
    engine: 'MapLibre GL JS',
    note: '3D land terrain from open DEM tiles. Oceans render flat — standard terrain has no bathymetry.',
    exaggeration: { min: 1, max: 6, value: DEFAULT_EXAGGERATION, step: 0.5 },
    onExaggeration: (v) => map.setTerrain({ source: 'terrainSource', exaggeration: v }),
    onReplay: () => clips.play(),
  });

  // ── Controls popup (auto-shows once, after the intro) ──────────────
  createInstructions({
    engine: 'MapLibre GL JS',
    autoShowDelay: 9500,
    controls: [
      { keys: 'Drag', desc: 'Pan across the map' },
      { keys: 'Scroll', desc: 'Zoom in and out' },
      { keys: 'Right-drag', desc: 'Rotate & tilt the view' },
      { keys: 'Relief slider', desc: 'Exaggerate the terrain' },
      { keys: '🎬 Scenarios', desc: 'Pick a flythrough or build your own' },
      { keys: '↻ Replay intro', desc: 'Replay the current scenario' },
      { keys: '🔴 Record', desc: 'Record an MP4 clip with captions' },
      { keys: '✎ Captions', desc: 'Edit the on-screen caption text & timing' },
    ],
  });

  // ── Scenario system: geographic waypoints → MapLibre camera ────────
  const adapter = {
    getCanvas: () => map.getCanvas(),
    applySettings: (s) => {
      if (s.exaggeration != null) {
        map.setTerrain({ source: 'terrainSource', exaggeration: s.exaggeration });
        hudApi.setExaggeration(s.exaggeration);
      }
    },
    flyTo: (w, durationMs, onComplete) => {
      const view = {
        center: [w.lon, w.lat],
        zoom: heightToZoom(w.height),
        pitch: Math.max(0, Math.min(85, 90 + (w.pitch ?? -90))), // cesium pitch → maplibre
        bearing: w.heading || 0,
      };
      if (durationMs <= 0) {
        map.jumpTo(view);
        onComplete?.();
      } else {
        map.once('moveend', () => onComplete?.());
        map.flyTo({ ...view, duration: durationMs, curve: 1.42, essential: true });
      }
    },
    getCurrentPose: () => {
      const c = map.getCenter();
      return {
        lon: +c.lng.toFixed(4),
        lat: +c.lat.toFixed(4),
        height: Math.round(zoomToHeight(map.getZoom())),
        heading: +map.getBearing().toFixed(1),
        pitch: +(map.getPitch() - 90).toFixed(1), // maplibre pitch → cesium-style
      };
    },
  };

  let currentScenario = null;
  const clips = createClips({
    engine: 'MapLibre',
    getCanvas: adapter.getCanvas,
    onPlay: () => currentScenario && playScenario(currentScenario, adapter),
  });

  function selectScenario(s) {
    if (!s) return;
    currentScenario = s;
    const url = new URL(window.location.href);
    url.searchParams.set('scenario', s.id);
    window.history.replaceState(null, '', url);
    clips.setCaptions(captionTrack(s), scenarioDurationMs(s), `clips-captions-maplibre-${s.id}`);
    clips.play();
  }

  createScenarioUI({ engine: 'maplibre', adapter, onSelect: selectScenario });

  // ── FPS meter (ticked on each rendered frame) ──────────────────────
  const fpsTick = createFpsMeter(hudApi.setFps);
  map.on('render', fpsTick);

  map.on('load', () => {
    const wantId = new URL(window.location.href).searchParams.get('scenario');
    selectScenario((wantId && scenarios.get(wantId)) || scenarios.getDefault('maplibre'));
  });
}
