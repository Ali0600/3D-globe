// ── Fantasy World prototype (v2, GPU shader) ──────────────────────────
// A procedurally-generated planet rendered in a Game-of-Thrones "parchment
// cartography" style. All terrain is evaluated PER-PIXEL in a fragment shader
// (not per-vertex), so detail is independent of mesh resolution: fine relief
// hill-shading, anti-aliased topographic contour lines, inked coastlines,
// slope-shaded mountains and paper grain. Seed + relief are uniforms, so a
// "New world" / slider change is instant.
//
// Techniques: simplex noise (Ashima/Gustavson, MIT) + domain-warped fBm + ridged
// multifractal; finite-difference normals; fwidth-based AA contour/coast lines
// (cf. iquilezles.org/articles/morenoise & madebyevan.com/shaders/grid).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
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
const DETAIL = 100; // icosphere subdivisions — only affects the silhouette; surface detail is per-pixel
const DEFAULT_RELIEF = 5;
const reliefToAmp = (v) => v * 0.013; // slider 1..10 → displacement amplitude
const INTRO_SECONDS = 7;
const PAPER_BG = '#191309';

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Shared GLSL: simplex noise + domain-warped fBm + ridged terrain ──
const NOISE_GLSL = /* glsl */ `
  uniform float uAmp;
  uniform vec3  uSeed;
  uniform float uSeaLevel;

  // Simplex 3D noise — Ashima Arts / Stefan Gustavson (MIT).
  vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  float fbm(vec3 p){
    float a = 0.5, f = 1.0, s = 0.0, n = 0.0;
    for (int i = 0; i < 5; i++) {
      s += a * snoise(p * f + uSeed);
      n += a; a *= 0.5; f *= 2.0;
    }
    return s / n; // ~[-1,1]
  }

  // Ridged multifractal → sharp mountain spines.
  float ridged(vec3 p){
    float a = 0.5, f = 1.0, s = 0.0, n = 0.0;
    for (int i = 0; i < 4; i++) {
      float r = 1.0 - abs(snoise(p * f + uSeed * 1.7));
      s += a * r * r;
      n += a; a *= 0.5; f *= 2.2;
    }
    return s / n; // ~[0,1]
  }

  // Elevation at a surface direction. Domain warp gives organic, wandering coasts.
  float terrain(vec3 dir){
    vec3 w = vec3(
      snoise(dir * 1.4 + 11.3),
      snoise(dir * 1.4 + 27.9),
      snoise(dir * 1.4 + 43.1)
    );
    vec3 p = dir + 0.20 * w;
    float base = fbm(p * 1.9);                               // continents
    float mtn  = ridged(p * 2.6);                            // mountain ridges
    return base + 0.85 * mtn * smoothstep(0.0, 0.45, base);  // ridges mostly on high land
  }
`;

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vDir;
  ${NOISE_GLSL}
  void main(){
    vDir = normalize(position);
    float landH = max(terrain(vDir) - uSeaLevel, 0.0);
    vec3 displaced = vDir * (1.0 + landH * uAmp);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uSunDir;
  ${NOISE_GLSL}

  // Aged-parchment palette (linear-ish; tone mapping is off for this page).
  const vec3 OCEAN_DEEP    = vec3(0.42, 0.49, 0.47);
  const vec3 OCEAN_SHALLOW = vec3(0.74, 0.70, 0.55);
  const vec3 LOWLAND       = vec3(0.80, 0.69, 0.49);
  const vec3 HILLS         = vec3(0.67, 0.51, 0.31);
  const vec3 MOUNTAIN      = vec3(0.46, 0.34, 0.20);
  const vec3 PEAK          = vec3(0.91, 0.85, 0.71);
  const vec3 ROCK          = vec3(0.40, 0.33, 0.23);
  const vec3 INK           = vec3(0.16, 0.11, 0.05);

  // Anti-aliased isoline: ~1 on the line, 0 off, using screen-space derivatives.
  float isoLine(float v){
    float d = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-5);
    return 1.0 - min(d, 1.0);
  }

  void main(){
    vec3 dir = normalize(vDir);
    float h = terrain(dir);

    // Finite-difference normal of the displaced land surface (per-pixel relief).
    vec3 up = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t = normalize(cross(dir, up));
    vec3 b = cross(dir, t);
    float eps = 0.0016;
    float lh  = max(h - uSeaLevel, 0.0);
    float lhT = max(terrain(normalize(dir + t * eps)) - uSeaLevel, 0.0);
    float lhB = max(terrain(normalize(dir + b * eps)) - uSeaLevel, 0.0);
    vec3 grad = (t * (lhT - lh) + b * (lhB - lh)) / eps;
    vec3 n = normalize(dir - grad * uAmp * 2.4);

    float diff = clamp(dot(n, normalize(uSunDir)), 0.0, 1.0);
    float light = 0.45 + 0.75 * diff;

    vec3 col;
    if (h < uSeaLevel) {
      float depth = clamp((uSeaLevel - h) * 1.6, 0.0, 1.0);
      col = mix(OCEAN_SHALLOW, OCEAN_DEEP, depth);
      // Coast-hugging "form lines" in the sea (classic antique style).
      float sea = isoLine((uSeaLevel - h) * 55.0);
      col = mix(col, OCEAN_DEEP * 0.78, sea * 0.22 * (1.0 - depth));
      light = 0.9 + 0.1 * diff; // oceans stay flat & evenly lit
    } else {
      float lhN = clamp(lh / 0.85, 0.0, 1.0);
      col = mix(LOWLAND, HILLS, smoothstep(0.0, 0.5, lhN));
      col = mix(col, MOUNTAIN, smoothstep(0.5, 0.85, lhN));
      col = mix(col, PEAK, smoothstep(0.9, 1.0, lhN));
      float slope = 1.0 - clamp(dot(n, dir), 0.0, 1.0); // 0 flat → 1 steep
      col = mix(col, ROCK, smoothstep(0.18, 0.55, slope));
      // Topographic contour lines (minor + emphasised major).
      col = mix(col, INK, isoLine(lh * 42.0) * 0.16);
      col = mix(col, INK, isoLine(lh * 8.5) * 0.34);
    }

    // Inked coastline at the shore.
    float coast = 1.0 - smoothstep(0.0, fwidth(h) * 2.5 + 1e-4, abs(h - uSeaLevel));
    col = mix(col, INK, coast * 0.85);

    // Parchment grain + hill-shade + gentle sepia.
    col *= 0.88 + 0.12 * (snoise(dir * 42.0) * 0.5 + 0.5);
    col *= light;
    col = mix(col, col * vec3(1.07, 1.0, 0.85), 0.5);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ── Boot ──────────────────────────────────────────────────────────────
if (!hasWebGL()) {
  showOverlay({
    title: 'WebGL not available',
    html: '<p>This prototype needs WebGL. Try a recent desktop browser.</p>',
    isError: true,
  });
} else {
  try {
    start();
  } catch (err) {
    console.error(err);
    showOverlay({
      title: 'Could not start Fantasy World',
      html: `<p>Something went wrong:</p><p><code>${err.message}</code></p>`,
      isError: true,
    });
  }
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
  // Cap DPI to protect fill-rate (the fragment shader is noise-heavy).
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.NoToneMapping; // stylized map — keep flat colours
  container.appendChild(renderer.domElement);

  scene.add(makeStarfield());

  // ── Planet ─────────────────────────────────────────────────────────
  let geometry = new THREE.IcosahedronGeometry(RADIUS, DETAIL);
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('normal');
  geometry = mergeVertices(geometry);

  const uniforms = {
    uAmp: { value: reliefToAmp(DEFAULT_RELIEF) },
    uSeed: { value: new THREE.Vector3() },
    uSeaLevel: { value: 0.0 },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    extensions: { derivatives: true }, // fwidth() for AA contour/coast lines
  });
  const planet = new THREE.Mesh(geometry, material);
  scene.add(planet);

  scene.add(makeAtmosphere(RADIUS));

  // ── Seed handling (sharable via the URL hash) ──────────────────────
  function seedToUniforms(seed) {
    const r = mulberry32(seed);
    uniforms.uSeed.value.set(r() * 120 - 60, r() * 120 - 60, r() * 120 - 60);
    uniforms.uSeaLevel.value = -0.02 + (r() * 0.14 - 0.07); // per-seed land/ocean ratio
  }
  function readSeedFromHash() {
    const m = /seed=(\d+)/.exec(window.location.hash);
    return m ? Number(m[1]) >>> 0 : null;
  }
  let seed = readSeedFromHash() ?? (Math.random() * 0xffffffff) >>> 0;
  function setSeed(s) {
    seed = s >>> 0;
    seedToUniforms(seed);
    window.history.replaceState(null, '', `#seed=${seed}`);
    const noteEl = document.querySelector('.hud__note');
    if (noteEl) noteEl.textContent = `Procedural parchment world · seed ${seed}`;
  }
  seedToUniforms(seed);
  window.history.replaceState(null, '', `#seed=${seed}`);

  // ── Controls (enabled after the intro) ─────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.25;
  controls.maxDistance = 8;
  controls.enabled = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.32;
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
    onExaggeration: (v) => {
      uniforms.uAmp.value = reliefToAmp(v);
    },
    onReplay: playIntro,
  });

  createInstructions({
    engine: 'Fantasy World',
    autoShowDelay: 7500,
    controls: [
      { keys: 'Drag', desc: 'Orbit around the world' },
      { keys: 'Scroll', desc: 'Zoom in and out' },
      { keys: 'Right-drag', desc: 'Pan the view' },
      { keys: '🎲 New world', desc: 'Generate a fresh procedural world (instant)' },
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
    uniforms.uSunDir.value
      .copy(camera.position)
      .normalize()
      .addScaledVector(_right, -0.35)
      .addScaledVector(_up, 0.25)
      .normalize();
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
    uniforms: { uColor: { value: new THREE.Color(0xd9b878) } },
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
