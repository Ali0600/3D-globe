// ── Fantasy World prototype ───────────────────────────────────────────
// A procedurally-generated planet rendered in a Game-of-Thrones "parchment
// cartography" style: noise-driven terrain displaces the actual geometry (real
// 3D mountains over flat oceans), coloured by elevation with inked coastlines on
// an aged-paper palette. Every world is unique (seeded); "New world" reseeds it.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise3D } from 'simplex-noise';
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

const RADIUS = 1;
const DETAIL = 48; // icosphere subdivisions (~23k verts) — smooth re-displace on the slider
const DEFAULT_RELIEF = 5;
const reliefToAmp = (v) => v * 0.026; // slider 1..10 → displacement amplitude
const INTRO_SECONDS = 7;
const SEA_PERCENTILE = 0.55; // ~45% of the surface is land
const BASE_FREQ = 1.7; // lower = larger continents

// Aged-parchment palette.
const COL = {
  oceanDeep: new THREE.Color('#94a298'),
  oceanShallow: new THREE.Color('#c3b99c'),
  coastInk: new THREE.Color('#403318'),
  lowland: new THREE.Color('#cdb184'),
  hills: new THREE.Color('#b3894f'),
  mountain: new THREE.Color('#7c5d35'),
  peak: new THREE.Color('#e7d9b6'),
};
const PAPER_BG = '#191309';

// ── Small math helpers ───────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function fbm(noise, x, y, z, octaves = 5, lac = 2.0, gain = 0.5) {
  let amp = 0.5,
    freq = 1,
    sum = 0,
    norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm; // ~[-1, 1]
}

// ── Boot ──────────────────────────────────────────────────────────────
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
  scene.background = new THREE.Color(PAPER_BG);

  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.01,
    100
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  // Lighting: warm key light + fill. The key tracks the camera (head-light) so
  // the side you're looking at is always lit, offset for relief shadows.
  const ambient = new THREE.AmbientLight(0xb9a980, 0.7);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff1d4, 2.1);
  sun.position.set(-3, 1.5, 2);
  scene.add(sun);

  scene.add(makeStarfield());

  // ── Planet geometry ───────────────────────────────────────────────
  // Icosphere gives even, pole-free vertices. mergeVertices makes it indexed
  // (deduped) → ~6× lighter and smoothly shaded instead of faceted.
  let geometry = new THREE.IcosahedronGeometry(RADIUS, DETAIL);
  geometry.deleteAttribute('uv');
  geometry = mergeVertices(geometry);
  const pos = geometry.attributes.position;
  const vertexCount = pos.count;

  // Cache unit directions once; (re)generation only scales along these.
  const baseDir = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const inv = 1 / Math.hypot(x, y, z);
    baseDir[i * 3] = x * inv;
    baseDir[i * 3 + 1] = y * inv;
    baseDir[i * 3 + 2] = z * inv;
  }

  const unitElev = new Float32Array(vertexCount); // land height above sea (0 in ocean)
  const colors = new Float32Array(vertexCount * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
  });
  const planet = new THREE.Mesh(geometry, material);
  scene.add(planet);

  scene.add(makeAtmosphere(RADIUS));

  let currentRelief = DEFAULT_RELIEF;

  // Generate a world from a seed: fill unitElev + vertex colors.
  function generateWorld(seed) {
    const land = createNoise3D(mulberry32(seed));
    const warp = createNoise3D(mulberry32((seed ^ 0x9e3779b9) >>> 0));
    const grain = createNoise3D(mulberry32((seed ^ 0x85ebca6b) >>> 0));

    const elev = new Float32Array(vertexCount);
    let eMin = Infinity,
      eMax = -Infinity;
    for (let i = 0; i < vertexCount; i++) {
      const dx = baseDir[i * 3],
        dy = baseDir[i * 3 + 1],
        dz = baseDir[i * 3 + 2];
      // Domain warp for organic, wandering coastlines.
      const w = 0.22;
      const wx = dx + w * warp(dx * 2, dy * 2, dz * 2);
      const wy = dy + w * warp(dy * 2 + 5.1, dz * 2, dx * 2);
      const wz = dz + w * warp(dz * 2, dx * 2 + 9.7, dy * 2);
      let e = fbm(land, wx * BASE_FREQ, wy * BASE_FREQ, wz * BASE_FREQ, 5);
      // Ridge boost so mountain spines feel sharper.
      e += 0.35 * Math.pow(Math.max(0, fbm(land, wx * 3.1, wy * 3.1, wz * 3.1, 3)), 2);
      elev[i] = e;
      if (e < eMin) eMin = e;
      if (e > eMax) eMax = e;
    }

    // Sea level as a percentile → consistent land/ocean ratio across seeds.
    const sorted = Float32Array.from(elev).sort();
    const seaLevel = sorted[Math.floor(SEA_PERCENTILE * (vertexCount - 1))];
    const landRange = Math.max(1e-4, eMax - seaLevel);
    const oceanRange = Math.max(1e-4, seaLevel - eMin);
    const coastBand = 0.02 * (eMax - eMin);

    const c = new THREE.Color();
    for (let i = 0; i < vertexCount; i++) {
      const e = elev[i];
      if (e < seaLevel) {
        unitElev[i] = 0; // flat ocean surface
        const depth = clamp((seaLevel - e) / oceanRange, 0, 1);
        c.copy(COL.oceanShallow).lerp(COL.oceanDeep, depth);
      } else {
        const h = (e - seaLevel) / landRange; // 0..1
        unitElev[i] = e - seaLevel;
        if (h < 0.5) c.copy(COL.lowland).lerp(COL.hills, h / 0.5);
        else c.copy(COL.hills).lerp(COL.mountain, (h - 0.5) / 0.5);
        if (h > 0.82) c.lerp(COL.peak, (h - 0.82) / 0.18); // drawn snow caps
      }
      // Inked coastline near the shore.
      const coast = 1 - smoothstep(0, coastBand, Math.abs(e - seaLevel));
      c.lerp(COL.coastInk, coast * 0.7);
      // Parchment grain mottle.
      const g =
        0.9 +
        0.1 * (grain(baseDir[i * 3] * 9, baseDir[i * 3 + 1] * 9, baseDir[i * 3 + 2] * 9) * 0.5 + 0.5);
      colors[i * 3] = c.r * g;
      colors[i * 3 + 1] = c.g * g;
      colors[i * 3 + 2] = c.b * g;
    }
    geometry.attributes.color.needsUpdate = true;
    applyRelief(currentRelief);
  }

  // Re-displace geometry from stored unit elevations (cheap; used by the slider).
  function applyRelief(reliefValue) {
    currentRelief = reliefValue;
    const amp = reliefToAmp(reliefValue);
    for (let i = 0; i < vertexCount; i++) {
      const r = RADIUS + unitElev[i] * amp;
      pos.setXYZ(i, baseDir[i * 3] * r, baseDir[i * 3 + 1] * r, baseDir[i * 3 + 2] * r);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  // ── Seed handling (sharable via the URL hash) ──────────────────────
  function readSeedFromHash() {
    const m = /seed=(\d+)/.exec(window.location.hash);
    return m ? Number(m[1]) >>> 0 : null;
  }
  let seed = readSeedFromHash() ?? (Math.random() * 0xffffffff) >>> 0;
  function setSeed(s) {
    seed = s >>> 0;
    window.history.replaceState(null, '', `#seed=${seed}`);
    generateWorld(seed);
    const noteEl = document.querySelector('.hud__note');
    if (noteEl) noteEl.textContent = `Procedural parchment world · seed ${seed}`;
  }

  generateWorld(seed);
  window.history.replaceState(null, '', `#seed=${seed}`);

  // ── Controls (enabled after the intro) ─────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.25;
  controls.maxDistance = 8;
  controls.enabled = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
  });

  // ── Cinematic intro ────────────────────────────────────────────────
  const introFrom = new THREE.Vector3(0, 2.4, 5.2);
  const introTo = new THREE.Vector3(1.3, 0.7, 1.9);
  let introT = 0;
  let introActive = true;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  function playIntro() {
    if (prefersReducedMotion()) {
      camera.position.copy(introTo);
      finishIntro();
      return;
    }
    introT = 0;
    introActive = true;
    controls.enabled = false;
    controls.autoRotate = false;
    camera.position.copy(introFrom);
    camera.lookAt(0, 0, 0);
  }
  function finishIntro() {
    introActive = false;
    controls.target.set(0, 0, 0);
    controls.enabled = true;
    controls.autoRotate = true;
    camera.lookAt(0, 0, 0);
  }

  // ── HUD ────────────────────────────────────────────────────────────
  const hudApi = createHud({
    engine: 'Fantasy World',
    note: `Procedural parchment world · seed ${seed}`,
    exaggeration: { min: 1, max: 10, value: DEFAULT_RELIEF, step: 0.5 },
    onExaggeration: applyRelief,
    onReplay: playIntro,
  });

  createInstructions({
    engine: 'Fantasy World',
    autoShowDelay: 7500,
    controls: [
      { keys: 'Drag', desc: 'Orbit around the world' },
      { keys: 'Scroll', desc: 'Zoom in and out' },
      { keys: 'Right-drag', desc: 'Pan the view' },
      { keys: '🎲 New world', desc: 'Generate a fresh procedural world' },
      { keys: 'Relief slider', desc: 'Exaggerate mountains & valleys' },
      { keys: '↻ Replay intro', desc: 'Replay the cinematic flythrough' },
    ],
  });

  addHudButton({
    label: '🎲 New world',
    title: 'Generate a fresh procedural world',
    onClick: () => setSeed((Math.random() * 0xffffffff) >>> 0),
  });

  // ── Head-light + render loop ───────────────────────────────────────
  const _viewDir = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  function updateHeadLight() {
    camera.getWorldDirection(_viewDir);
    _right.crossVectors(_viewDir, camera.up).normalize();
    _up.crossVectors(_right, _viewDir).normalize();
    const d = camera.position.length() || 3;
    sun.position
      .copy(camera.position)
      .addScaledVector(_right, -0.35 * d)
      .addScaledVector(_up, 0.25 * d);
  }

  const fpsTick = createFpsMeter(hudApi.setFps);
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    if (introActive) {
      introT = Math.min(1, introT + dt / INTRO_SECONDS);
      camera.position.lerpVectors(introFrom, introTo, easeInOut(introT));
      camera.lookAt(0, 0, 0);
      if (introT >= 1) finishIntro();
    } else {
      controls.update();
    }
    updateHeadLight();
    renderer.render(scene, camera);
    fpsTick();
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  playIntro();
  animate();
}

// ── Helpers ─────────────────────────────────────────────────────────────
function makeStarfield() {
  const count = 1800;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 40 + Math.random() * 20;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xd8c79a, size: 0.07, sizeAttenuation: true });
  return new THREE.Points(geo, mat);
}

function makeAtmosphere(radius) {
  const geo = new THREE.SphereGeometry(radius * 1.05, 64, 64);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    uniforms: { uColor: { value: new THREE.Color(0xd9b878) } }, // warm parchment glow
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
        float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
        gl_FragColor = vec4(uColor, 1.0) * intensity;
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}
