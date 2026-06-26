// Scenario registry — merges built-in scenarios (data files) with user-created
// ones saved in localStorage. Built-in vs user is tracked so the picker/builder
// can allow editing/deleting only user scenarios.

import sevenContinents from './builtin/seven-continents.js';
import himalaya from './builtin/himalaya.js';
import mariana from './builtin/mariana.js';

const BUILTIN = [sevenContinents, himalaya, mariana];
const USER_KEY = 'scenarios-user-v1';

function loadUser() {
  try {
    const list = JSON.parse(localStorage.getItem(USER_KEY) || '[]');
    return Array.isArray(list) ? list.filter(isValid) : [];
  } catch {
    return [];
  }
}
function saveUserList(list) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(list));
  } catch {
    /* private mode / quota — keep in-session only */
  }
}

/** Minimal shape check so a corrupt entry can't break the picker. */
export function isValid(s) {
  return !!s && typeof s.id === 'string' && Array.isArray(s.waypoints) && s.waypoints.length > 0;
}

/** Whether a scenario can run on a given engine ('cesium' | 'maplibre' | 'three'). */
export function supports(scenario, engine) {
  return !scenario.engines || scenario.engines.includes(engine);
}

/** All scenarios (built-in first, then user; user overrides built-in by id). */
export function getAll() {
  const map = new Map();
  for (const s of BUILTIN) map.set(s.id, { ...s, builtin: true });
  for (const s of loadUser()) map.set(s.id, { ...s, builtin: false });
  return [...map.values()];
}

export function get(id) {
  return getAll().find((s) => s.id === id) || null;
}

/** Default scenario for an engine (the showcase tour, else the first supported). */
export function getDefault(engine) {
  return get('seven-continents') || getAll().find((s) => supports(s, engine)) || getAll()[0] || null;
}

export function saveUser(scenario) {
  if (!isValid(scenario)) throw new Error('Invalid scenario');
  const list = loadUser().filter((s) => s.id !== scenario.id);
  list.push({ ...scenario, builtin: false });
  saveUserList(list);
}

export function deleteUser(id) {
  saveUserList(loadUser().filter((s) => s.id !== id));
}

export function exportJSON(scenario) {
  const { builtin, ...clean } = scenario;
  return JSON.stringify(clean, null, 2);
}

export function importJSON(text) {
  const s = JSON.parse(text);
  if (!isValid(s)) throw new Error('Not a valid scenario (needs id + waypoints[])');
  return s;
}

/** Make a URL-safe id from a title, de-duplicated against existing ids. */
export function makeId(title) {
  const base = (title || 'scenario').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario';
  const ids = new Set(getAll().map((s) => s.id));
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
