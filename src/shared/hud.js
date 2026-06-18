// Shared HUD + small utilities used by all three engine prototypes.
// Keeps the comparison apples-to-apples: same controls, same look.

/**
 * Build the on-screen HUD.
 *
 * @param {Object} opts
 * @param {string} opts.engine            Badge label, e.g. "CesiumJS".
 * @param {string} [opts.note]            One-line caveat shown under the badge.
 * @param {Object} opts.exaggeration      Slider config.
 * @param {number} opts.exaggeration.min
 * @param {number} opts.exaggeration.max
 * @param {number} opts.exaggeration.value
 * @param {number} [opts.exaggeration.step=0.5]
 * @param {string} [opts.exaggeration.unit='×']
 * @param {(v:number)=>void} opts.onExaggeration  Called when the slider moves.
 * @param {()=>void} opts.onReplay                Called when "Replay intro" is clicked.
 * @returns {{ setFps:(n:number)=>void, setExaggeration:(v:number)=>void }}
 */
export function createHud({ engine, note, exaggeration, onExaggeration, onReplay }) {
  const { min, max, value, step = 0.5, unit = '×' } = exaggeration;

  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.innerHTML = `
    <span class="hud__badge">${engine}</span>
    ${note ? `<p class="hud__note">${note}</p>` : ''}
    <div class="hud__row">
      <label for="exag">Relief</label>
      <input id="exag" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
      <span class="hud__value" id="exag-val">${value}${unit}</span>
    </div>
    <div class="hud__buttons">
      <button id="replay" type="button">↻ Replay intro</button>
      <a class="hud__back" href="./index.html">← Lab</a>
    </div>
  `;
  document.body.appendChild(hud);

  const fps = document.createElement('div');
  fps.className = 'hud__fps';
  fps.textContent = '— fps';
  document.body.appendChild(fps);

  const slider = hud.querySelector('#exag');
  const valOut = hud.querySelector('#exag-val');
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    valOut.textContent = `${v}${unit}`;
    onExaggeration(v);
  });

  hud.querySelector('#replay').addEventListener('click', () => onReplay());

  return {
    setFps: (n) => {
      fps.textContent = `${Math.round(n)} fps`;
    },
    setExaggeration: (v) => {
      slider.value = String(v);
      valOut.textContent = `${v}${unit}`;
    },
  };
}

/**
 * Lightweight FPS meter. Call tick() once per rendered frame.
 * @param {(fps:number)=>void} onUpdate  Invoked ~twice per second.
 */
export function createFpsMeter(onUpdate) {
  let frames = 0;
  let last = performance.now();
  return function tick() {
    frames++;
    const now = performance.now();
    if (now - last >= 500) {
      onUpdate((frames * 1000) / (now - last));
      frames = 0;
      last = now;
    }
  };
}

/** True if the browser can create a WebGL context. */
export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext('webgl') || c.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

/** Respect the user's reduced-motion preference for the auto-intro. */
export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Show a full-screen overlay card (missing token, WebGL failure, load error).
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} opts.html      Body HTML (already trusted, app-authored).
 * @param {boolean} [opts.isError=false]
 */
export function showOverlay({ title, html, isError = false }) {
  const el = document.createElement('div');
  el.className = `overlay${isError ? ' overlay--error' : ''}`;
  el.innerHTML = `
    <div class="overlay__card">
      <h2>${title}</h2>
      ${html}
      <a class="overlay__back" href="./index.html">← Back to the lab</a>
    </div>
  `;
  document.body.appendChild(el);
  return el;
}
