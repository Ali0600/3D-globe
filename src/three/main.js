// ── Three.js prototype ────────────────────────────────────────────────
// A displacement-mapped globe: the sphere's geometry literally deforms from a
// topo+bathy height map, so mountains rise and trenches sink. Stylized, fully
// custom look. Cinematic fly-in, then OrbitControls.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '../shared/styles.css';
import {
  createHud,
  createInstructions,
  createFpsMeter,
  addHudButton,
  showOverlay,
  hasWebGL,
  prefersReducedMotion,
} from '../shared/hud.js';
import { createClips } from '../shared/clips.js';
import { createScenarioUI } from '../shared/scenarioUI.js';
import { playScenario, captionTrack, scenarioDurationMs } from '../shared/scenarioPlayer.js';
import * as scenarios from '../scenarios/index.js';

const BASE = import.meta.env.BASE_URL;
const COLOR_URL = `${BASE}textures/earth_color.jpg`;
const HEIGHT_URL = `${BASE}textures/earth_height.png`;
const NIGHT_URL = `${BASE}textures/earth_night.jpg`;

const RADIUS = 1;
// Where sea level sits in the grayscale height map (deepest ocean = black = 0,
// highest land = white = 1). GEBCO elevation imagery puts 0 m near ~0.5.
const SEA_LEVEL = 0.5;
const DEFAULT_RELIEF = 5; // slider units (1–10)
// Maps a "relief" slider value to an actual displacement scale (radius units).
const reliefToScale = (v) => v * 0.022;
const INTRO_SECONDS = 7;

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
  const container = document.getElementById('scene');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);

  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.01,
    100
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Cap DPI so high-density displays don't tank the framerate.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  // ── Lighting ────────────────────────────────────────────────────────
  const ambient = new THREE.AmbientLight(0x4a5a7a, 0.75);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
  sun.position.set(-3, 1.2, 2);
  scene.add(sun);
  const DAY_SUN = sun.intensity;
  const DAY_AMBIENT = ambient.intensity;

  // Head-light: keep the sun behind the camera so the side you're looking at is
  // always lit — no permanently-dark hemisphere — offset up/left so the
  // displacement relief still casts some shading. Called every frame.
  const _viewDir = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  function updateHeadLight() {
    camera.getWorldDirection(_viewDir); // refreshes the camera's world matrix
    _right.crossVectors(_viewDir, camera.up).normalize();
    _up.crossVectors(_right, _viewDir).normalize();
    const d = camera.position.length() || 3;
    sun.position
      .copy(camera.position)
      .addScaledVector(_right, -0.3 * d)
      .addScaledVector(_up, 0.2 * d);
  }

  // ── Starfield backdrop ──────────────────────────────────────────────
  scene.add(makeStarfield());

  // ── The globe (built once textures resolve) ─────────────────────────
  const geometry = new THREE.SphereGeometry(RADIUS, 320, 320);
  const material = new THREE.MeshStandardMaterial({
    color: 0x8899aa,
    metalness: 0.05,
    roughness: 0.95,
  });
  const globe = new THREE.Mesh(geometry, material);
  scene.add(globe);

  // ── City lights (Black Marble) + Day/Night toggle ──────────────────
  // The emissive map glows everywhere by default; a shader patch fades it on the
  // lit hemisphere. A `uNightFull` uniform lets "Night lights" turn the WHOLE
  // globe to night (cities everywhere) rather than only the sun's dark side —
  // otherwise, with a fixed sun, the side you're looking at may still be in day.
  const sunDir = sun.position.clone().normalize();
  const uNightFull = { value: 0 }; // 0 = only the sun's night side, 1 = whole globe
  material.emissive = new THREE.Color(0xffffff);
  material.emissiveIntensity = 0; // off until the user toggles Night lights
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDirection = { value: sunDir };
    shader.uniforms.uNightFull = uNightFull;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCityWorldNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vCityWorldNormal = normalize(mat3(modelMatrix) * normal);'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vCityWorldNormal;\nuniform vec3 uSunDirection;\nuniform float uNightFull;'
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  float cityNight = 1.0 - smoothstep(-0.15, 0.25, dot(normalize(vCityWorldNormal), uSunDirection));\n  totalEmissiveRadiance *= mix(cityNight, 1.0, uNightFull);'
      );
  };
  let nightOn = false;
  const setNightLights = (on) => {
    nightOn = on;
    uNightFull.value = on ? 1 : 0; // light up the whole globe at night
    material.emissiveIntensity = on ? 1.6 : 0;
    // Dim the daylight so it actually reads as night (cities pop over a dark Earth).
    sun.intensity = on ? DAY_SUN * 0.05 : DAY_SUN;
    ambient.intensity = on ? 0.2 : DAY_AMBIENT;
  };

  // Soft atmospheric rim glow (additive fresnel shell).
  scene.add(makeAtmosphere(RADIUS));

  function setRelief(reliefValue) {
    const scale = reliefToScale(reliefValue);
    material.displacementScale = scale;
    // Push sea level back to the base radius so oceans dip inward (trenches)
    // and only land pushes outward.
    material.displacementBias = -scale * SEA_LEVEL;
    material.needsUpdate = true;
  }
  setRelief(DEFAULT_RELIEF);

  loadTextures(material);

  // ── Controls (enabled after the intro) ──────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.25;
  controls.maxDistance = 8;
  controls.enabled = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.3;
  controls.addEventListener('start', () => {
    controls.autoRotate = false; // stop idle spin once the user grabs it
  });

  // ── Camera tween (drives the scenario adapter) ─────────────────────
  const EARTH_R = 6_371_000;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  let tween = null; // { from, to, t, dur, onDone }

  function flyToPosition(to, durationS, onDone) {
    if (durationS <= 0) {
      camera.position.copy(to);
      camera.lookAt(0, 0, 0);
      tween = null;
      onDone?.();
      if (!tween) {
        controls.enabled = true;
        controls.autoRotate = true;
      }
      return;
    }
    tween = { from: camera.position.clone(), to: to.clone(), t: 0, dur: durationS, onDone };
    controls.enabled = false;
    controls.autoRotate = false;
  }

  // Geographic (lon, lat) → unit direction on the Blue-Marble-textured sphere.
  // (East/west may need a sign flip after a visual check — see notes.)
  function lonLatToDir(lon, lat) {
    const azim = ((lon + 180) / 360) * Math.PI * 2;
    const polar = ((90 - lat) / 180) * Math.PI;
    return new THREE.Vector3(
      -Math.cos(azim) * Math.sin(polar),
      Math.cos(polar),
      Math.sin(azim) * Math.sin(polar)
    ).normalize();
  }

  // ── HUD ──────────────────────────────────────────────────────────────
  const hudApi = createHud({
    engine: 'Three.js',
    note: 'Geometry deforms from a topo+bathy height map — mountains rise, ocean trenches sink.',
    exaggeration: { min: 1, max: 10, value: DEFAULT_RELIEF, step: 0.5 },
    onExaggeration: setRelief,
    onReplay: () => clips.play(),
  });

  // ── Controls popup (auto-shows once, after the intro) ────────────────
  createInstructions({
    engine: 'Three.js',
    autoShowDelay: 7500,
    controls: [
      { keys: 'Drag', desc: 'Orbit around the globe' },
      { keys: 'Scroll', desc: 'Zoom in and out' },
      { keys: 'Right-drag', desc: 'Pan the view' },
      { keys: '🌃 Night lights', desc: 'Toggle glowing city lights (day / night)' },
      { keys: 'Relief slider', desc: 'Raise mountains / sink trenches' },
      { keys: '🎬 Scenarios', desc: 'Pick a flythrough or build your own' },
      { keys: '↻ Replay intro', desc: 'Replay the current scenario' },
      { keys: '🔴 Record', desc: 'Record an MP4 clip with captions' },
      { keys: '✎ Captions', desc: 'Edit the on-screen caption text & timing' },
    ],
  });

  // ── Scenario system: geographic waypoints → Three.js camera ────────
  const adapter = {
    getCanvas: () => renderer.domElement,
    applySettings: (s) => {
      if (s.exaggeration != null) {
        setRelief(s.exaggeration);
        hudApi.setExaggeration(s.exaggeration);
      }
      if (s.night != null) setNightLights(!!s.night);
    },
    flyTo: (w, durationMs, onComplete) => {
      const dist = Math.max(1.6, 1 + (w.height || 0) / EARTH_R); // clamp so we never clip terrain
      flyToPosition(lonLatToDir(w.lon, w.lat).multiplyScalar(dist), durationMs / 1000, onComplete);
    },
    getCurrentPose: () => {
      const p = camera.position;
      const dir = p.clone().normalize();
      const polar = Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1));
      let azim = Math.atan2(dir.z, -dir.x);
      if (azim < 0) azim += Math.PI * 2;
      return {
        lon: +((azim / (Math.PI * 2)) * 360 - 180).toFixed(4),
        lat: +(90 - (polar / Math.PI) * 180).toFixed(4),
        height: Math.round((p.length() - 1) * EARTH_R),
        heading: 0,
        pitch: -90,
      };
    },
  };

  let currentScenario = null;
  const clips = createClips({
    engine: 'Three.js',
    getCanvas: adapter.getCanvas,
    onPlay: () => currentScenario && playScenario(currentScenario, adapter),
  });
  function selectScenario(s) {
    if (!s) return;
    currentScenario = s;
    const url = new URL(window.location.href);
    url.searchParams.set('scenario', s.id);
    window.history.replaceState(null, '', url);
    clips.setCaptions(captionTrack(s), scenarioDurationMs(s), `clips-captions-three-${s.id}`);
    clips.play();
  }
  createScenarioUI({ engine: 'three', adapter, onSelect: selectScenario });

  // Day/Night toggle — glowing city lights on the dark hemisphere.
  addHudButton({
    label: '🌃 Night lights',
    title: 'Toggle city lights on the night side',
    onClick: (btn) => {
      setNightLights(!nightOn);
      btn.textContent = nightOn ? '☀️ Day view' : '🌃 Night lights';
    },
  });

  // ── Render loop ──────────────────────────────────────────────────────
  const fpsTick = createFpsMeter(hudApi.setFps);
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    if (tween) {
      tween.t = Math.min(1, tween.t + dt / tween.dur);
      camera.position.lerpVectors(tween.from, tween.to, easeInOut(tween.t));
      camera.lookAt(0, 0, 0);
      if (tween.t >= 1) {
        const cb = tween.onDone;
        tween = null;
        cb?.();
        if (!tween) {
          controls.enabled = true;
          controls.autoRotate = true;
        }
      }
    } else {
      controls.update();
    }

    updateHeadLight(); // keep the lit side facing the camera (no dark hemisphere)
    renderer.render(scene, camera);
    fpsTick();
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const wantId = new URL(window.location.href).searchParams.get('scenario');
  selectScenario((wantId && scenarios.get(wantId)) || scenarios.getDefault('three'));
  animate();
}

// ── Helpers ─────────────────────────────────────────────────────────────

function loadTextures(material) {
  const loader = new THREE.TextureLoader();
  const maxAniso = 8;
  Promise.allSettled([
    loader.loadAsync(COLOR_URL),
    loader.loadAsync(HEIGHT_URL),
    loader.loadAsync(NIGHT_URL),
  ]).then(
    ([color, height, night]) => {
      if (color.status === 'fulfilled') {
        color.value.colorSpace = THREE.SRGBColorSpace;
        color.value.anisotropy = maxAniso;
        material.map = color.value;
        material.color.set(0xffffff);
      }
      if (night.status === 'fulfilled') {
        night.value.colorSpace = THREE.SRGBColorSpace;
        night.value.anisotropy = maxAniso;
        material.emissiveMap = night.value; // city lights (shown only at night)
      }
      if (height.status === 'fulfilled') {
        material.displacementMap = height.value;
        material.bumpMap = height.value; // cheap extra surface detail
        material.bumpScale = 1.5;
      } else {
        showOverlay({
          title: 'Height map missing',
          html:
            '<p>The displacement (topo+bathy) texture failed to load, so the globe is smooth.</p>' +
            '<p>Run the asset download step from the README to populate ' +
            '<code>public/textures/</code>.</p>',
          isError: true,
        });
      }
      material.needsUpdate = true;
    }
  );
}

function makeStarfield() {
  const count = 2500;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Random points on a large sphere shell.
    const r = 40 + Math.random() * 20;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xaecbff, size: 0.08, sizeAttenuation: true });
  return new THREE.Points(geo, mat);
}

function makeAtmosphere(radius) {
  const geo = new THREE.SphereGeometry(radius * 1.04, 64, 64);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    uniforms: { uColor: { value: new THREE.Color(0x4ea1ff) } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      uniform vec3 uColor;
      void main() {
        float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
        gl_FragColor = vec4(uColor, 1.0) * intensity;
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}
