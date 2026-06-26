// Scenario picker + in-app builder. Engine-agnostic: it talks to the registry
// and a per-engine `adapter` (for capturing the current camera pose), and calls
// `onSelect(scenario)` when the user picks / previews / saves one.

import * as registry from '../scenarios/index.js';
import { addHudButton } from './hud.js';

const WP_FIELDS = ['lon', 'lat', 'height', 'heading', 'pitch', 'durationMs', 'holdMs', 'arcHeight', 'caption'];

export function createScenarioUI({ engine, adapter, onSelect }) {
  let panel = null;
  let mode = 'list'; // 'list' | 'edit'
  let draft = null; // working scenario while editing

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function open() {
    if (panel) return close();
    panel = document.createElement('div');
    panel.className = 'scenario-panel';
    document.body.appendChild(panel);
    mode = 'list';
    render();
  }
  function close() {
    panel?.remove();
    panel = null;
    draft = null;
  }

  function render() {
    if (!panel) return;
    panel.innerHTML = mode === 'list' ? listHTML() : editHTML();
    wire();
  }

  function listHTML() {
    const items = registry
      .getAll()
      .filter((s) => registry.supports(s, engine))
      .map(
        (s) => `<li>
          <button class="scn-play" data-id="${esc(s.id)}" type="button" title="${esc(s.description || '')}">${esc(s.title)}</button>
          ${
            s.builtin
              ? '<span class="scn-tag">built-in</span>'
              : `<button class="scn-edit" data-id="${esc(s.id)}" type="button">edit</button><button class="scn-del" data-id="${esc(s.id)}" type="button" title="Delete">✕</button>`
          }
        </li>`
      )
      .join('');
    return `<div class="scenario-panel__card">
      <h3>Scenarios <span>pick one, or build your own</span></h3>
      <ul class="scn-list">${items}</ul>
      <div class="scenario-panel__row">
        <button data-act="new" type="button">＋ New</button>
        <button data-act="import" type="button">Import JSON</button>
        <button data-act="close" type="button">Close</button>
      </div>
    </div>`;
  }

  function editHTML() {
    const wps = draft.waypoints
      .map(
        (w, i) => `<li data-i="${i}">
          <div class="scn-wp-head">
            <strong>#${i + 1}${i === 0 ? ' · opening' : ''}</strong>
            <span class="scn-wp-pos">${(+w.lat).toFixed(1)}, ${(+w.lon).toFixed(1)} · ${Math.round(w.height / 1000)} km</span>
            <span class="scn-wp-btns">
              <button data-wact="up" data-i="${i}" type="button">▲</button>
              <button data-wact="down" data-i="${i}" type="button">▼</button>
              <button data-wact="del" data-i="${i}" type="button">✕</button>
            </span>
          </div>
          <div class="scn-wp-fields">
            <input data-wf="caption" data-i="${i}" placeholder="caption (optional)" value="${esc(w.caption || '')}" />
            ${i === 0 ? '<span class="scn-snap">snap</span>' : `<span class="scn-dur"><input data-wf="dur" data-i="${i}" type="number" min="0" step="0.5" value="${(w.durationMs || 0) / 1000}" /> s</span>`}
          </div>
        </li>`
      )
      .join('');
    return `<div class="scenario-panel__card">
      <h3>${draft._editingId ? 'Edit scenario' : 'New scenario'} <span>capture views + captions</span></h3>
      <input class="scn-title" data-f="title" placeholder="Scenario title" value="${esc(draft.title || '')}" />
      <ul class="scn-list">${wps || '<li class="scn-empty">No views yet — frame the globe, then “Add current view”.</li>'}</ul>
      <div class="scenario-panel__row">
        <button data-act="capture" type="button">＋ Add current view</button>
        <button data-act="preview" type="button">▶ Preview</button>
      </div>
      <div class="scenario-panel__row">
        <button data-act="save" type="button">💾 Save</button>
        <button data-act="export" type="button">⤓ Export</button>
        <button data-act="cancel" type="button">Cancel</button>
      </div>
      <p class="scn-hint"></p>
    </div>`;
  }

  function wire() {
    const q = (s) => panel.querySelector(s);
    const qa = (s) => [...panel.querySelectorAll(s)];
    if (mode === 'list') {
      qa('.scn-play').forEach((b) => (b.onclick = () => {
        const s = registry.get(b.dataset.id);
        if (s) { onSelect(s); close(); }
      }));
      qa('.scn-edit').forEach((b) => (b.onclick = () => {
        draft = clone(registry.get(b.dataset.id));
        draft._editingId = b.dataset.id;
        mode = 'edit';
        render();
      }));
      qa('.scn-del').forEach((b) => (b.onclick = () => {
        registry.deleteUser(b.dataset.id);
        render();
      }));
      q('[data-act="new"]').onclick = () => { draft = { title: '', waypoints: [] }; mode = 'edit'; render(); };
      q('[data-act="import"]').onclick = importFlow;
      q('[data-act="close"]').onclick = close;
    } else {
      q('[data-f="title"]').oninput = (e) => (draft.title = e.target.value);
      qa('[data-wf="caption"]').forEach((el) => (el.oninput = (e) => (draft.waypoints[+el.dataset.i].caption = e.target.value)));
      qa('[data-wf="dur"]').forEach((el) => (el.oninput = (e) => (draft.waypoints[+el.dataset.i].durationMs = Math.max(0, (+e.target.value || 0) * 1000))));
      qa('[data-wact="up"]').forEach((b) => (b.onclick = () => move(+b.dataset.i, -1)));
      qa('[data-wact="down"]').forEach((b) => (b.onclick = () => move(+b.dataset.i, 1)));
      qa('[data-wact="del"]').forEach((b) => (b.onclick = () => { draft.waypoints.splice(+b.dataset.i, 1); render(); }));
      q('[data-act="capture"]').onclick = capture;
      q('[data-act="preview"]').onclick = () => onSelect(finalize());
      q('[data-act="save"]').onclick = save;
      q('[data-act="export"]').onclick = () => download(`${finalize().id}.json`, registry.exportJSON(finalize()));
      q('[data-act="cancel"]').onclick = () => { mode = 'list'; draft = null; render(); };
    }
  }

  function capture() {
    const p = adapter.getCurrentPose();
    const first = draft.waypoints.length === 0;
    draft.waypoints.push({ ...p, durationMs: first ? 0 : 4000, caption: '' });
    render();
  }
  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= draft.waypoints.length) return;
    const a = draft.waypoints;
    [a[i], a[j]] = [a[j], a[i]];
    render();
  }
  function finalize() {
    return {
      id: draft._editingId || registry.makeId(draft.title),
      title: draft.title || 'Untitled scenario',
      engines: ['cesium', 'maplibre', 'three'],
      waypoints: draft.waypoints.map(pickWaypoint),
    };
  }
  function save() {
    if (draft.waypoints.length < 2) return hint('Add at least 2 views (an opening + one more).');
    const s = finalize();
    try {
      registry.saveUser(s);
    } catch (e) {
      return hint('Save failed: ' + e.message);
    }
    onSelect(s);
    mode = 'list';
    draft = null;
    render();
  }
  function importFlow() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const s = registry.importJSON(await f.text());
        registry.saveUser(s);
        onSelect(s);
        close();
      } catch (e) {
        alert('Import failed: ' + e.message);
      }
    };
    input.click();
  }
  function hint(msg) {
    const h = panel?.querySelector('.scn-hint');
    if (h) h.textContent = msg;
  }

  addHudButton({ label: '🎬 Scenarios', title: 'Pick or build a scenario', onClick: open });
  return { open, close };
}

function clone(s) {
  return JSON.parse(JSON.stringify(s));
}
function pickWaypoint(w) {
  const out = {};
  for (const k of WP_FIELDS) if (w[k] !== undefined && w[k] !== '') out[k] = w[k];
  return out;
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
