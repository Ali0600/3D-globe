// ── CesiumJS prototype ────────────────────────────────────────────────
// Real global terrain + ocean-floor bathymetry (GEBCO-based) with runtime
// vertical exaggeration. Cinematic fly-in on load, then free orbit.

import * as Cesium from 'cesium';
import '../shared/styles.css';
import {
  createHud,
  createInstructions,
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

// Cesium World Bathymetry ion asset (real ocean-floor relief). NOT enabled on
// new ion accounts by default — add it free from the Asset Depot. We fall back
// gracefully if the token can't access it (404), so the page never breaks.
const BATHYMETRY_ASSET_ID = 2426648;

async function build() {
  let viewer;

  if (token) {
    Cesium.Ion.defaultAccessToken = token;
    // Start with default ion imagery + a smooth globe so something always renders
    // immediately; real terrain is loaded (with fallbacks) by loadTerrain() below.
    viewer = new Cesium.Viewer(CONTAINER, { ...widgetsOff });
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
  scene.fog.enabled = true;
  scene.skyAtmosphere.show = true;
  scene.verticalExaggeration = DEFAULT_EXAGGERATION;
  scene.verticalExaggerationRelativeHeight = 0; // exaggerate relative to sea level

  // Terrain shading (so exaggerated mountains read as 3D) WITHOUT a night side.
  // Default lighting uses the real sun position, which can leave the viewed area
  // in darkness depending on the time of day. Instead we drive a "head-light"
  // that tracks the camera — the side you're looking at is always lit — offset
  // up/right so terrain still casts raking relief shadows.
  scene.globe.enableLighting = true;
  const lightDir = new Cesium.Cartesian3();
  const lightTmp = new Cesium.Cartesian3();
  const trackingLight = new Cesium.DirectionalLight({
    direction: Cesium.Cartesian3.UNIT_X,
    intensity: 2.0,
  });
  scene.light = trackingLight;
  scene.preRender.addEventListener(() => {
    const cam = scene.camera;
    Cesium.Cartesian3.clone(cam.directionWC, lightDir);
    Cesium.Cartesian3.add(
      lightDir,
      Cesium.Cartesian3.multiplyByScalar(cam.rightWC, -0.4, lightTmp),
      lightDir
    );
    Cesium.Cartesian3.add(
      lightDir,
      Cesium.Cartesian3.multiplyByScalar(cam.upWC, -0.25, lightTmp),
      lightDir
    );
    Cesium.Cartesian3.normalize(lightDir, lightDir);
    trackingLight.direction = lightDir;
  });

  // ── Navigation feel ───────────────────────────────────────────────
  // The default wheel zoom is sluggish on trackpads and crawls (or gets trapped
  // against the exaggerated terrain) near the surface. Replace it with a steady
  // "percentage of altitude" step that feels the same at every scale and always
  // lets you pull back out to a full-globe view.
  const controller = scene.screenSpaceCameraController;
  controller.enableZoom = false; // we handle the wheel ourselves (below)
  const ellipsoid = scene.globe.ellipsoid;
  const wheelHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  wheelHandler.setInputAction((wheelDelta) => {
    const carto = ellipsoid.cartesianToCartographic(scene.camera.positionWC);
    const height = carto ? carto.height : 1e7;
    const step = Math.max(Math.abs(height) * 0.2, 50);
    if (wheelDelta > 0) {
      // Zoom in — but stop short of the surface so you never get stuck / go under.
      if (height > 160) scene.camera.zoomIn(Math.min(step, height - 140));
    } else if (height < 3.5e7) {
      // Zoom out, capped so you can't drift off into deep space.
      scene.camera.zoomOut(step);
    }
  }, Cesium.ScreenSpaceEventType.WHEEL);

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
    note: token
      ? 'Loading real terrain…'
      : 'No ion token set — showing a flat OSM globe. Add VITE_CESIUM_ION_TOKEN for real terrain.',
    exaggeration: { min: 1, max: 10, value: DEFAULT_EXAGGERATION, step: 0.5 },
    onExaggeration: (v) => {
      // Runtime — no tile refetch. Capped at 10 to avoid float jitter at depth.
      scene.verticalExaggeration = v;
    },
    onReplay: playIntro,
  });

  // Add a "Globe view" reset so you can always frame the whole Earth again.
  const buttons = document.querySelector('.hud__buttons');
  if (buttons) {
    const globeBtn = document.createElement('button');
    globeBtn.type = 'button';
    globeBtn.textContent = '🌍 Globe view';
    globeBtn.addEventListener('click', () => viewer.camera.flyHome(1.5));
    buttons.insertBefore(globeBtn, buttons.firstChild);
  }

  // ── Controls popup (auto-shows once, after the intro) ──────────────
  createInstructions({
    engine: 'CesiumJS',
    autoShowDelay: 8000,
    controls: [
      { keys: 'Drag', desc: 'Rotate / orbit the globe' },
      { keys: 'Scroll', desc: 'Zoom in and out' },
      { keys: 'Right-drag', desc: 'Tilt the camera angle' },
      { keys: '🌍 Globe view', desc: 'Snap back to the whole Earth' },
      { keys: 'Relief slider', desc: 'Exaggerate mountains & ocean depths' },
      { keys: '↻ Replay intro', desc: 'Replay the cinematic flythrough' },
    ],
  });

  // ── FPS meter (driven by Cesium's own render loop) ─────────────────
  const hud = document.querySelector('.hud__fps');
  const tick = createFpsMeter((fps) => {
    if (hud) hud.textContent = `${Math.round(fps)} fps`;
  });
  scene.postRender.addEventListener(tick);

  // ── Load terrain with graceful fallbacks; update the HUD note with the result.
  if (token) {
    loadTerrain(viewer).then(({ note }) => {
      const noteEl = document.querySelector('.hud__note');
      if (noteEl) noteEl.textContent = note;
    });
  }

  playIntro();
}

/**
 * Try real ocean-floor bathymetry first, then fall back so the globe always has
 * terrain. Cesium World Bathymetry isn't on new ion accounts by default (its
 * asset request 404s), so we degrade to World Terrain, then to a smooth globe.
 * @returns {Promise<{ mode: string, note: string }>}
 */
async function loadTerrain(viewer) {
  try {
    const provider = await Cesium.CesiumTerrainProvider.fromIonAssetId(
      BATHYMETRY_ASSET_ID,
      { requestVertexNormals: true }
    );
    viewer.scene.terrainProvider = provider;
    return {
      mode: 'bathymetry',
      note: 'Real elevation + GEBCO ocean-floor bathymetry. Fly out to the Mariana Trench.',
    };
  } catch (e) {
    console.warn(
      '[cesium] Cesium World Bathymetry (asset 2426648) is not available on this ion ' +
        'account. Add it free at https://ion.cesium.com/assetdepot for real ocean depths. ' +
        'Falling back to Cesium World Terrain.',
      e?.message ?? e
    );
  }
  try {
    const provider = await Cesium.createWorldTerrainAsync({ requestVertexNormals: true });
    viewer.scene.terrainProvider = provider;
    return {
      mode: 'terrain',
      note: 'Real land terrain (World Terrain). For ocean depths, add Cesium World Bathymetry to your ion account.',
    };
  } catch (e) {
    console.warn('[cesium] World Terrain unavailable; using a smooth ellipsoid.', e?.message ?? e);
  }
  return {
    mode: 'ellipsoid',
    note: 'Smooth globe — terrain failed to load. Check your ion token and network.',
  };
}

// ── Boot ──────────────────────────────────────────────────────────────
build().catch((err) => {
  console.error(err);
  showOverlay({
    title: 'Could not start CesiumJS',
    html: `<p>Something went wrong initializing the globe:</p><p><code>${err.message}</code></p>`,
    isError: true,
  });
});
