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

/**
 * Build a "Controls" instructions popup and a ❔ button (added to the HUD) to
 * reopen it. Auto-shows once per browser (remembered via localStorage); closes
 * on the Got it button, a backdrop click, or Escape.
 *
 * @param {Object} opts
 * @param {string} opts.engine                 Shown as the popup's subtitle.
 * @param {{keys:string, desc:string}[]} opts.controls  Rows: gesture → meaning.
 * @param {number} [opts.autoShowDelay=0]       Delay (ms) before the first auto-show
 *                                              (e.g. let the intro flythrough play first).
 * @returns {{ open:()=>void, close:()=>void }}
 */
export function createInstructions({ engine, controls, autoShowDelay = 0 }) {
  const modal = document.createElement('div');
  modal.className = 'help';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="help__backdrop"></div>
    <div class="help__card" role="dialog" aria-modal="true" aria-label="Controls">
      <h2 class="help__title">How to control it <span>${engine}</span></h2>
      <ul class="help__list">
        ${controls
          .map((c) => `<li><kbd>${c.keys}</kbd><span class="help__desc">${c.desc}</span></li>`)
          .join('')}
      </ul>
      <button class="help__close" type="button">Got it</button>
    </div>
  `;
  document.body.appendChild(modal);

  const open = () => {
    modal.hidden = false;
  };
  const close = () => {
    modal.hidden = true;
  };

  modal.querySelector('.help__close').addEventListener('click', close);
  modal.querySelector('.help__backdrop').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });

  // ❔ button in the HUD button row (falls back to a floating button if absent).
  const helpBtn = document.createElement('button');
  helpBtn.type = 'button';
  helpBtn.textContent = '❔ Controls';
  helpBtn.addEventListener('click', open);
  const row = document.querySelector('.hud__buttons');
  if (row) row.appendChild(helpBtn);
  else document.body.appendChild(helpBtn);

  // Auto-show once per browser per engine.
  const key = `globe-help-seen-${engine.toLowerCase().replace(/\s+/g, '-')}`;
  let seen = false;
  try {
    seen = localStorage.getItem(key) === '1';
  } catch {
    /* localStorage unavailable (private mode) — just show it */
  }
  if (!seen) {
    window.setTimeout(open, autoShowDelay);
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* ignore */
    }
  }

  return { open, close };
}

/**
 * Append a button to the HUD's button row and return it, so callers can update
 * its label later (e.g. for a toggle). Falls back to <body> if the row is absent.
 * @param {Object} opts
 * @param {string} opts.label
 * @param {string} [opts.title]
 * @param {(btn: HTMLButtonElement) => void} opts.onClick
 * @returns {HTMLButtonElement}
 */
export function addHudButton({ label, title, onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  if (title) btn.title = title;
  btn.addEventListener('click', () => onClick(btn));
  const row = document.querySelector('.hud__buttons');
  (row || document.body).appendChild(btn);
  return btn;
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
