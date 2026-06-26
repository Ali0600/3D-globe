// ── Clips: caption overlays + in-browser MP4 recorder ─────────────────
// Engine-agnostic. Shows cinematic captions synced to a scenario's intro, lets
// the user edit them, and records the canvas — with the text composited in — to
// a downloadable MP4 (WebCodecs via canvas-record; lazy-loaded on first record).
//
// HTML overlays are NOT captured by canvas recording, so for the text to appear
// in the file we draw the engine canvas + caption onto a 2D canvas and record
// THAT. Requires the engine context to be created with preserveDrawingBuffer.

import { addHudButton } from './hud.js';

const FPS = 30;
const MAX_DIM = 1600; // cap output resolution for file size / encode load
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {Object} o
 * @param {string} o.engine                       Label, used for filenames + storage key.
 * @param {() => HTMLCanvasElement} o.getCanvas    Returns the engine's live canvas.
 * @param {{at:number, text:string}[]} o.captions  Default caption track (seconds + text).
 * @param {number} o.durationMs                    Clip length (≈ intro length).
 * @param {() => void} o.onPlay                     Restart the scenario intro from t=0.
 * @param {string} [o.storageKey]
 * @returns {{ play: () => void, record: () => void }}
 */
export function createClips({ engine, getCanvas, captions, durationMs, onPlay, storageKey }) {
  const slug = engine.toLowerCase().replace(/\s+/g, '-');
  let STORAGE = storageKey || `clips-captions-${slug}`;
  let defaults = normalize(captions || []);
  let track = loadTrack(STORAGE, defaults);
  let clipStart = null; // performance.now() when play() was called
  let recording = false;
  let recordBtn = null;

  // Swap in a new caption track + duration (e.g. when the scenario changes).
  // Loads any saved per-scenario edits for the new storage key.
  function setCaptions(newCaptions, newDurationMs, newStorageKey) {
    if (newStorageKey) STORAGE = newStorageKey;
    defaults = normalize(newCaptions || []);
    track = loadTrack(STORAGE, defaults);
    if (newDurationMs) durationMs = newDurationMs;
    if (recordBtn) recordBtn.title = `Record a ~${Math.round(durationMs / 1000)}s MP4 clip with captions`;
  }

  // ── Live caption overlay ───────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'caption';
  const overlayText = document.createElement('span');
  overlay.appendChild(overlayText);
  document.body.appendChild(overlay);

  function activeCaption(elapsedSec) {
    let cur = null;
    let idx = -1;
    for (let i = 0; i < track.length; i++) {
      if (elapsedSec >= track[i].at) {
        cur = track[i];
        idx = i;
      } else break;
    }
    if (!cur) return { text: '', alpha: 0 };
    const next = track[idx + 1];
    const end = next ? next.at : durationMs / 1000;
    const fadeIn = Math.min(1, (elapsedSec - cur.at) / 0.4);
    const fadeOut = Math.min(1, (end - elapsedSec) / 0.4);
    return { text: cur.text, alpha: Math.max(0, Math.min(fadeIn, fadeOut)) };
  }

  function tickOverlay() {
    requestAnimationFrame(tickOverlay);
    if (clipStart == null) {
      overlay.style.opacity = '0';
      return;
    }
    const e = (performance.now() - clipStart) / 1000;
    if (e > durationMs / 1000 + 0.6) {
      clipStart = null;
      overlay.style.opacity = '0';
      return;
    }
    const { text, alpha } = activeCaption(e);
    overlayText.textContent = text;
    overlay.style.opacity = String(alpha);
  }
  tickOverlay();

  function play() {
    clipStart = performance.now();
    onPlay?.();
  }

  // ── Recording ──────────────────────────────────────────────────────
  function makeRecordCanvas(src) {
    const sw = src.width || src.clientWidth;
    const sh = src.height || src.clientHeight;
    const aspect = sw / sh;
    let w, h;
    if (sw >= sh) {
      w = Math.min(sw, MAX_DIM);
      h = Math.round(w / aspect);
    } else {
      h = Math.min(sh, MAX_DIM);
      w = Math.round(h * aspect);
    }
    w -= w % 2; // h264 likes even dimensions
    h -= h % 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return { canvas, ctx: canvas.getContext('2d') };
  }

  function drawCaption(ctx, canvas, text, alpha) {
    const W = canvas.width;
    const H = canvas.height;
    const fontSize = Math.round(H * 0.06);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `600 ${fontSize}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = W / 2;
    const y = H * 0.84;
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = fontSize * 0.5;
    ctx.lineWidth = Math.max(2, fontSize * 0.08);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#fdf3dc';
    ctx.fillText(text, x, y);
    const tw = ctx.measureText(text).width;
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(253,243,220,0.7)';
    ctx.fillRect(x - tw * 0.3, y + fontSize * 0.72, tw * 0.6, Math.max(1, fontSize * 0.03));
    ctx.restore();
  }

  function drawComposite(ctx, canvas) {
    try {
      ctx.drawImage(getCanvas(), 0, 0, canvas.width, canvas.height);
    } catch {
      /* canvas may be momentarily unreadable; skip this frame */
    }
    if (clipStart == null) return;
    const { text, alpha } = activeCaption((performance.now() - clipStart) / 1000);
    if (text && alpha > 0.01) drawCaption(ctx, canvas, text, alpha);
  }

  async function record(btn) {
    if (recording) return;
    recording = true;
    const label = btn?.textContent;
    if (btn) {
      btn.textContent = '⏺ Recording…';
      btn.disabled = true;
    }
    const { canvas, ctx } = makeRecordCanvas(getCanvas());
    play(); // restart the scenario + caption clock
    try {
      const { Recorder } = await import('canvas-record');
      const recorder = new Recorder(ctx, {
        name: `${slug}-clip`,
        frameRate: FPS,
        extension: 'mp4', // WebCodecs encoder; falls back to wasm H264 if needed
        download: true,
        duration: Infinity, // we stop manually after durationMs
      });
      await recorder.start({ initOnly: true });
      const endAt = performance.now() + durationMs;
      while (performance.now() < endAt) {
        const t0 = performance.now();
        drawComposite(ctx, canvas);
        await recorder.step();
        await sleep(Math.max(0, 1000 / FPS - (performance.now() - t0)));
      }
      await recorder.stop();
    } catch (err) {
      console.error('[clips] recording failed', err);
      flash(`Recording failed — ${err?.message || err}`);
    } finally {
      recording = false;
      if (btn) {
        btn.textContent = label;
        btn.disabled = false;
      }
    }
  }

  // ── Caption editor ─────────────────────────────────────────────────
  let editor = null;
  function openEditor() {
    if (editor) {
      editor.remove();
      editor = null;
      return;
    }
    editor = document.createElement('div');
    editor.className = 'clip-editor';
    editor.innerHTML = `
      <div class="clip-editor__card">
        <h3>Captions <span>time&nbsp;&nbsp;text — one per line (e.g. <code>0:06 Asia</code>)</span></h3>
        <textarea spellcheck="false" rows="8"></textarea>
        <p class="clip-editor__hint"></p>
        <div class="clip-editor__row">
          <button data-act="apply" type="button">Apply</button>
          <button data-act="reset" type="button">Reset</button>
          <button data-act="close" type="button">Close</button>
        </div>
      </div>`;
    const ta = editor.querySelector('textarea');
    const hint = editor.querySelector('.clip-editor__hint');
    ta.value = formatTrack(track);
    editor.querySelector('[data-act="apply"]').onclick = () => {
      const parsed = parseTrack(ta.value);
      if (!parsed.length) {
        hint.textContent = 'No valid lines found — keeping the previous captions.';
        return;
      }
      track = parsed;
      saveTrack(STORAGE, track);
      hint.textContent = `Applied ${parsed.length} caption${parsed.length > 1 ? 's' : ''}.`;
    };
    editor.querySelector('[data-act="reset"]').onclick = () => {
      track = normalize(defaults);
      saveTrack(STORAGE, track);
      ta.value = formatTrack(track);
      hint.textContent = 'Reset to defaults.';
    };
    editor.querySelector('[data-act="close"]').onclick = () => {
      editor.remove();
      editor = null;
    };
    document.body.appendChild(editor);
  }

  // ── HUD buttons ────────────────────────────────────────────────────
  recordBtn = addHudButton({
    label: '🔴 Record',
    title: `Record a ~${Math.round(durationMs / 1000)}s MP4 clip with captions`,
    onClick: (b) => record(b),
  });
  addHudButton({ label: '✎ Captions', title: 'Edit the on-screen captions', onClick: openEditor });

  return { play, record, setCaptions };
}

// ── Track helpers ─────────────────────────────────────────────────────
function normalize(track) {
  return [...track].filter((c) => c && c.text).sort((a, b) => a.at - b.at);
}
function loadTrack(key, def) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return def;
}
function saveTrack(key, track) {
  try {
    localStorage.setItem(key, JSON.stringify(track));
  } catch {
    /* private mode — keep in-session only */
  }
}
function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = +(s % 60).toFixed(2);
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : String(sec);
}
function parseTime(s) {
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    return Number(m) * 60 + Number(sec);
  }
  return Number(s);
}
function formatTrack(track) {
  return track.map((c) => `${fmtTime(c.at)}  ${c.text}`).join('\n');
}
function parseTrack(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = /^(\d+(?::\d+)?(?:\.\d+)?)\s+(.+)$/.exec(t);
    if (!m) continue;
    const at = parseTime(m[1]);
    if (!Number.isFinite(at)) continue;
    out.push({ at, text: m[2].trim() });
  }
  return out.sort((a, b) => a.at - b.at);
}

// Small transient toast for errors.
function flash(msg) {
  const el = document.createElement('div');
  el.className = 'clip-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}
