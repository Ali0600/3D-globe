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

const CONTAINER = 'scene';
const token = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim();

// NASA "Earth at Night" (Black Marble) ion imagery asset — city lights.
const EARTH_AT_NIGHT_ASSET_ID = 3812;
const NIGHT_TEXTURE_URL = `${import.meta.env.BASE_URL}textures/earth_night.jpg`;

// Shared cinematic settings.
const DEFAULT_EXAGGERATION = 5;

// Opening wide shot: the whole globe from far out, near top-down.
const FAR_VIEW = {
  destination: Cesium.Cartesian3.fromDegrees(86.9, 5.0, 14_000_000),
  orientation: { heading: 0, pitch: Cesium.Math.toRadians(-88), roll: 0 },
};

// Game-of-Thrones-style title sequence: sweep over all 7 continents, then settle
// centred on Europe. Each leg is a high, near-top-down view so the WHOLE globe
// stays in frame with the continent centred (a low/oblique pass would overfill
// the frame and only show a sliver). The camera rotates around the planet,
// crossing the Atlantic into Europe for the finale.
const TOUR_HEIGHT = 10_000_000; // ~10,000 km — whole globe fits, continent centred
const TOUR_PITCH = -85; // near top-down (small tilt for a hint of 3D)
const CONTINENT_TOUR = [
  { name: 'Oceania', lon: 133, lat: -25, height: TOUR_HEIGHT, heading: 0, pitch: TOUR_PITCH },
  { name: 'Asia', lon: 86, lat: 30, height: TOUR_HEIGHT, heading: 0, pitch: TOUR_PITCH },
  { name: 'Africa', lon: 21, lat: 2, height: TOUR_HEIGHT, heading: 0, pitch: TOUR_PITCH },
  { name: 'Antarctica', lon: 20, lat: -78, height: TOUR_HEIGHT, heading: 0, pitch: TOUR_PITCH },
  { name: 'South America', lon: -63, lat: -16, height: TOUR_HEIGHT, heading: 0, pitch: TOUR_PITCH },
  { name: 'North America', lon: -98, lat: 41, height: TOUR_HEIGHT, heading: 0, pitch: TOUR_PITCH },
];
// The 7th continent and final resting view: Europe, centred, near top-down,
// slightly closer so it's a touch more prominent (still whole-globe in frame).
const EUROPE_VIEW = { name: 'Europe', lon: 14, lat: 50, height: 9_000_000, heading: 0, pitch: -88 };
const LEG_SECONDS = 6.0; // continent-to-continent flight time (slower = more majestic)
const FINALE_SECONDS = 8.0;

// Build a Cesium flyTo config from a { lon, lat, height, heading, pitch } waypoint.
function waypointToFlyTo(w, duration) {
  return {
    destination: Cesium.Cartesian3.fromDegrees(w.lon, w.lat, w.height),
    orientation: {
      heading: Cesium.Math.toRadians(w.heading),
      pitch: Cesium.Math.toRadians(w.pitch),
      roll: 0,
    },
    duration,
    maximumHeight: 12_000_000, // gentle pull-back as the globe rotates between continents
  };
}

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

  // ── Cinematic intro: a sweep over all 7 continents, ending on Europe ─
  let tourSeq = 0;
  function playIntro() {
    const seq = ++tourSeq; // a newer run (or Replay) invalidates this chain
    const cam = viewer.camera;

    if (prefersReducedMotion()) {
      cam.flyTo(waypointToFlyTo(EUROPE_VIEW, 0));
      return;
    }

    cam.flyTo({ ...FAR_VIEW, duration: 0 }); // snap to the opening wide shot

    const legs = [
      ...CONTINENT_TOUR.map((c) => waypointToFlyTo(c, LEG_SECONDS)),
      waypointToFlyTo(EUROPE_VIEW, FINALE_SECONDS),
    ];

    let i = 0;
    const next = () => {
      // Stop if a newer intro started, the tour finished, or the user took over
      // (user interaction cancels the flight, so `complete` never fires).
      if (seq !== tourSeq || i >= legs.length) return;
      cam.flyTo({ ...legs[i++], complete: next });
    };
    // Hold on the wide shot for a beat, then begin the tour.
    window.setTimeout(() => {
      if (seq === tourSeq) next();
    }, 500);
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
      { keys: '↻ Replay intro', desc: 'Replay the cinematic flythrough' },
      { keys: '🔴 Record', desc: 'Record an MP4 clip with captions' },
      { keys: '✎ Captions', desc: 'Edit the on-screen caption text & timing' },
    ],
  });

  // ── Clips: continent-name captions synced to the tour + MP4 recorder ─
  const CLIP_PAUSE = 0.5; // matches the wide-shot hold in playIntro()
  const clips = createClips({
    engine: 'Cesium',
    getCanvas: () => viewer.scene.canvas,
    captions: [
      ...CONTINENT_TOUR.map((c, i) => ({ at: CLIP_PAUSE + i * LEG_SECONDS, text: c.name })),
      { at: CLIP_PAUSE + CONTINENT_TOUR.length * LEG_SECONDS, text: EUROPE_VIEW.name },
    ],
    durationMs: (CLIP_PAUSE + CONTINENT_TOUR.length * LEG_SECONDS + FINALE_SECONDS) * 1000,
    onPlay: playIntro,
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

  clips.play(); // play the intro and start the caption clock together
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
