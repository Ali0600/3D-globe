// ── CesiumJS prototype ────────────────────────────────────────────────
// Real global terrain + ocean-floor bathymetry (GEBCO-based) with runtime
// vertical exaggeration. Cinematic fly-in on load, then free orbit.

import * as Cesium from 'cesium';
import '../shared/styles.css';
import {
  createHud,
  createInstructions,
  createFpsMeter,
  addHudButton,
  showOverlay,
  prefersReducedMotion,
} from '../shared/hud.js';
import { createClips } from '../shared/clips.js';
import { createScenarioUI } from '../shared/scenarioUI.js';
import { playScenario, captionTrack, scenarioDurationMs } from '../shared/scenarioPlayer.js';
import * as scenarios from '../scenarios/index.js';

const CONTAINER = 'scene';
const token = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim();

// NASA "Earth at Night" (Black Marble) ion imagery asset — city lights.
const EARTH_AT_NIGHT_ASSET_ID = 3812;
const NIGHT_TEXTURE_URL = `${import.meta.env.BASE_URL}textures/earth_night.jpg`;

// Shared cinematic settings.
const DEFAULT_EXAGGERATION = 5;

// Common Viewer chrome: strip the default widgets for a clean, cinematic frame.
// preserveDrawingBuffer lets the clip recorder read the rendered frame.
const widgetsOff = {
  contextOptions: { webgl: { preserveDrawingBuffer: true } },
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
  // Night mode (city lights) flips this off so the real sun can drive a terminator.
  let headlightActive = true;
  scene.preRender.addEventListener(() => {
    if (!headlightActive) return;
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

  // ── City lights (Black Marble) + Day/Night toggle ──────────────────
  // Lazily added the first time night mode is switched on. Shows ONLY on the
  // dark side via nightAlpha, blending with day imagery at the terminator.
  let nightLayer = null;
  let nightMode = false;

  async function ensureNightLayer() {
    if (nightLayer) return nightLayer;
    let provider;
    try {
      provider = await Cesium.IonImageryProvider.fromAssetId(EARTH_AT_NIGHT_ASSET_ID);
    } catch (e) {
      console.warn(
        '[cesium] ion "Earth at Night" (asset 3812) unavailable — falling back to the ' +
          'local Black Marble texture.',
        e?.message ?? e
      );
      provider = await Cesium.SingleTileImageryProvider.fromUrl(NIGHT_TEXTURE_URL, {
        rectangle: Cesium.Rectangle.MAX_VALUE,
      });
    }
    nightLayer = viewer.imageryLayers.addImageryProvider(provider);
    nightLayer.dayAlpha = 0.0; // hidden on the lit side
    nightLayer.nightAlpha = 1.0; // city lights on the dark side
    nightLayer.show = false;
    return nightLayer;
  }

  async function setNightMode(on) {
    nightMode = on;
    const layer = await ensureNightLayer();
    layer.show = on;
    if (on) {
      headlightActive = false; // stop the head-light so a real terminator forms
      scene.light = new Cesium.SunLight();
      // Gently drift time so the terminator moves and cities sweep into view.
      if (!prefersReducedMotion()) {
        viewer.clock.multiplier = 1600;
        viewer.clock.shouldAnimate = true;
      }
    } else {
      headlightActive = true;
      scene.light = trackingLight;
      viewer.clock.shouldAnimate = false;
    }
  }

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

  // ── HUD wiring ─────────────────────────────────────────────────────
  const hudApi = createHud({
    engine: 'CesiumJS',
    note: token
      ? 'Loading real terrain…'
      : 'No ion token set — showing a flat OSM globe. Add VITE_CESIUM_ION_TOKEN for real terrain.',
    exaggeration: { min: 1, max: 10, value: DEFAULT_EXAGGERATION, step: 0.5 },
    onExaggeration: (v) => {
      // Runtime — no tile refetch. Capped at 10 to avoid float jitter at depth.
      scene.verticalExaggeration = v;
    },
    onReplay: () => clips.play(),
  });

  // Add a "Globe view" reset so you can always frame the whole Earth again.
  addHudButton({
    label: '🌍 Globe view',
    title: 'Fly back to the whole Earth',
    onClick: () => viewer.camera.flyHome(1.5),
  });

  // Day/Night toggle — glowing city lights on the dark side.
  addHudButton({
    label: '🌃 Night lights',
    title: 'Toggle city lights / day–night',
    onClick: (btn) => {
      setNightMode(!nightMode);
      btn.textContent = nightMode ? '☀️ Day view' : '🌃 Night lights';
    },
  });

  // ── Controls popup (auto-shows once, after the intro) ──────────────
  createInstructions({
    engine: 'CesiumJS',
    autoShowDelay: 8000,
    controls: [
      { keys: 'Drag', desc: 'Rotate / orbit the globe' },
      { keys: 'Scroll', desc: 'Zoom in and out' },
      { keys: 'Right-drag', desc: 'Tilt the camera angle' },
      { keys: '🌍 Globe view', desc: 'Snap back to the whole Earth' },
      { keys: '🌃 Night lights', desc: 'Toggle glowing city lights (day / night)' },
      { keys: 'Relief slider', desc: 'Exaggerate mountains & ocean depths' },
      { keys: '🎬 Scenarios', desc: 'Pick a flythrough or build your own' },
      { keys: '↻ Replay intro', desc: 'Replay the current scenario' },
      { keys: '🔴 Record', desc: 'Record an MP4 clip with captions' },
      { keys: '✎ Captions', desc: 'Edit the on-screen caption text & timing' },
    ],
  });

  // ── Scenario system: data-driven, geographic camera tours ──────────
  const adapter = {
    getCanvas: () => viewer.scene.canvas,
    applySettings: (s) => {
      if (s.exaggeration != null) {
        scene.verticalExaggeration = s.exaggeration;
        hudApi.setExaggeration(s.exaggeration);
      }
      if (s.night === true && !nightMode) setNightMode(true);
      if (s.night === false && nightMode) setNightMode(false);
    },
    flyTo: (w, durationMs, onComplete) => {
      const destination = Cesium.Cartesian3.fromDegrees(w.lon, w.lat, w.height);
      const orientation = {
        heading: Cesium.Math.toRadians(w.heading || 0),
        pitch: Cesium.Math.toRadians(w.pitch ?? -90),
        roll: 0,
      };
      if (durationMs <= 0) {
        // Instant + reliable (zero-duration flyTo can flash Cesium's default view).
        viewer.camera.setView({ destination, orientation });
        onComplete?.();
        return;
      }
      viewer.camera.flyTo({
        destination,
        orientation,
        duration: durationMs / 1000,
        maximumHeight: w.arcHeight,
        complete: onComplete,
      });
    },
    getCurrentPose: () => {
      const c = viewer.camera;
      const carto = Cesium.Cartographic.fromCartesian(c.positionWC);
      return {
        lon: +Cesium.Math.toDegrees(carto.longitude).toFixed(4),
        lat: +Cesium.Math.toDegrees(carto.latitude).toFixed(4),
        height: Math.round(carto.height),
        heading: +Cesium.Math.toDegrees(c.heading).toFixed(1),
        pitch: +Cesium.Math.toDegrees(c.pitch).toFixed(1),
      };
    },
  };

  let currentScenario = null;
  const clips = createClips({
    engine: 'Cesium',
    getCanvas: adapter.getCanvas,
    onPlay: () => currentScenario && playScenario(currentScenario, adapter),
  });

  function selectScenario(s) {
    if (!s) return;
    currentScenario = s;
    const url = new URL(window.location.href);
    url.searchParams.set('scenario', s.id);
    window.history.replaceState(null, '', url);
    clips.setCaptions(captionTrack(s), scenarioDurationMs(s), `clips-captions-cesium-${s.id}`);
    clips.play();
  }

  createScenarioUI({ engine: 'cesium', adapter, onSelect: selectScenario });

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

  // Initial scenario from ?scenario=… (sharable) or the default tour.
  const wantId = new URL(window.location.href).searchParams.get('scenario');
  selectScenario((wantId && scenarios.get(wantId)) || scenarios.getDefault('cesium'));
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
