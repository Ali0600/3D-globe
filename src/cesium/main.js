// ── CesiumJS prototype ────────────────────────────────────────────────
// Real global terrain + ocean-floor bathymetry (GEBCO-based) with runtime
// vertical exaggeration. Cinematic fly-in on load, then free orbit.

import * as Cesium from 'cesium';
import '../shared/styles.css';
import {
  createHud,
  createFpsMeter,
  showOverlay,
  prefersReducedMotion,
} from '../shared/hud.js';

const CONTAINER = 'scene';
const token = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim();

// Shared cinematic settings.
const DEFAULT_EXAGGERATION = 5;
// A dramatic, high-relief target for the intro: the Himalaya, looking north
// toward the high peaks at a low, horizon-skimming pitch.
const INTRO_VIEW = {
  destination: Cesium.Cartesian3.fromDegrees(86.9, 24.6, 160000),
  orientation: {
    heading: Cesium.Math.toRadians(8),
    pitch: Cesium.Math.toRadians(-16),
    roll: 0,
  },
};
const FAR_VIEW = {
  destination: Cesium.Cartesian3.fromDegrees(86.9, 5.0, 9_000_000),
  orientation: { heading: 0, pitch: Cesium.Math.toRadians(-55), roll: 0 },
};

// Common Viewer chrome: strip the default widgets for a clean, cinematic frame.
const widgetsOff = {
  timeline: false,
  animation: false,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
};

function build() {
  let viewer;
  let usingBathymetry = false;

  if (token) {
    Cesium.Ion.defaultAccessToken = token;
    viewer = new Cesium.Viewer(CONTAINER, {
      terrain: Cesium.Terrain.fromWorldBathymetry(),
      ...widgetsOff,
    });
    usingBathymetry = true;
  } else {
    // No ion token → avoid the default ion imagery (which would 401). Render a
    // flat globe with keyless OpenStreetMap tiles so the page still works.
    viewer = new Cesium.Viewer(CONTAINER, {
      baseLayer: new Cesium.ImageryLayer(
        new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })
      ),
      ...widgetsOff,
    });
  }

  const { scene } = viewer;
  scene.globe.enableLighting = true;
  scene.fog.enabled = true;
  scene.skyAtmosphere.show = true;
  scene.verticalExaggeration = DEFAULT_EXAGGERATION;
  scene.verticalExaggerationRelativeHeight = 0; // exaggerate relative to sea level

  // Surface ion load errors without a blank screen.
  viewer.scene.renderError.addEventListener((_, error) => {
    showOverlay({
      title: 'Rendering error',
      html: `<p>Cesium hit a rendering error:</p><p><code>${error}</code></p>`,
      isError: true,
    });
  });

  // ── Cinematic intro ────────────────────────────────────────────────
  function playIntro() {
    viewer.camera.flyTo({ ...FAR_VIEW, duration: 0 });
    if (prefersReducedMotion()) {
      viewer.camera.flyTo({ ...INTRO_VIEW, duration: 0 });
      return;
    }
    // Brief pause on the wide shot, then the sweeping descent.
    window.setTimeout(() => {
      viewer.camera.flyTo({ ...INTRO_VIEW, duration: 7, maximumHeight: 4_000_000 });
    }, 600);
  }

  // ── HUD wiring ─────────────────────────────────────────────────────
  createHud({
    engine: 'CesiumJS',
    note: usingBathymetry
      ? 'Real elevation + GEBCO ocean-floor bathymetry. Try flying out to the Mariana Trench.'
      : 'No ion token set — showing a flat OSM globe. Add VITE_CESIUM_ION_TOKEN for real bathymetry.',
    exaggeration: { min: 1, max: 10, value: DEFAULT_EXAGGERATION, step: 0.5 },
    onExaggeration: (v) => {
      // Runtime — no tile refetch. Capped at 10 to avoid float jitter at depth.
      scene.verticalExaggeration = v;
    },
    onReplay: playIntro,
  });

  // ── FPS meter (driven by Cesium's own render loop) ─────────────────
  const hud = document.querySelector('.hud__fps');
  const tick = createFpsMeter((fps) => {
    if (hud) hud.textContent = `${Math.round(fps)} fps`;
  });
  scene.postRender.addEventListener(tick);

  playIntro();
}

// ── Boot ──────────────────────────────────────────────────────────────
try {
  build();
} catch (err) {
  console.error(err);
  showOverlay({
    title: 'Could not start CesiumJS',
    html: `<p>Something went wrong initializing the globe:</p><p><code>${err.message}</code></p>`,
    isError: true,
  });
}
