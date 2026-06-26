// Plays a scenario (a list of geographic waypoints) on any engine via an adapter,
// and derives the caption track + clip duration from the same waypoints so the
// captions stay perfectly in sync with the camera.

import { prefersReducedMotion } from './hud.js';

export const INTRO_PAUSE_MS = 500; // hold on the opening wide shot before legs begin

/**
 * Adapter interface each engine implements:
 *   flyTo(waypoint, durationMs, onComplete) — drive the camera to a geo pose
 *   getCurrentPose() -> { lon, lat, height, heading, pitch }
 *   applySettings(settings)   // { exaggeration?, night? }
 *   getCanvas() -> HTMLCanvasElement
 */

/** Caption track for clips: each waypoint's caption at its arrival time (seconds). */
export function captionTrack(scenario) {
  const track = [];
  let t = INTRO_PAUSE_MS;
  scenario.waypoints.forEach((w, i) => {
    if (i === 0) {
      if (w.caption) track.push({ at: 0, text: w.caption }); // opening title card
      return;
    }
    t += w.durationMs || 0;
    if (w.caption) track.push({ at: +(t / 1000).toFixed(2), text: w.caption });
    t += w.holdMs || 0;
  });
  return track;
}

/** Total clip length in ms (includes the opening pause + a short tail). */
export function scenarioDurationMs(scenario) {
  const legs = scenario.waypoints
    .slice(1)
    .reduce((s, w) => s + (w.durationMs || 0) + (w.holdMs || 0), 0);
  return INTRO_PAUSE_MS + legs + 1200;
}

let seq = 0;

/** Cancel any in-flight scenario (e.g. when switching scenarios). */
export function cancelScenario() {
  seq++;
}

/**
 * Fly the camera through a scenario. Returns the run id. A newer call (or
 * cancelScenario) supersedes an in-flight run; user interaction that cancels the
 * engine's flight also stops the chain (its onComplete never fires).
 */
export function playScenario(scenario, adapter) {
  const my = ++seq;
  adapter.applySettings?.(scenario.settings || {});
  const wps = scenario.waypoints || [];
  if (!wps.length) return my;

  adapter.flyTo(wps[0], 0); // snap to the opening wide shot

  if (prefersReducedMotion()) {
    adapter.flyTo(wps[wps.length - 1], 0);
    return my;
  }

  let i = 1;
  const next = () => {
    if (my !== seq || i >= wps.length) return;
    const w = wps[i++];
    adapter.flyTo(w, w.durationMs ?? 4000, () => {
      if (my !== seq) return;
      if (w.holdMs > 0) window.setTimeout(next, w.holdMs);
      else next();
    });
  };
  window.setTimeout(() => {
    if (my === seq) next();
  }, INTRO_PAUSE_MS);
  return my;
}
