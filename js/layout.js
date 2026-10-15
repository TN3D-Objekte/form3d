// Eigene Anordnung der Leisten und Meldungen, getrennt für Hoch- und Querformat. Jede Fläche merkt sich
// die nächste Bildschirmkante (links/mitte/rechts, oben/unten) und den Abstand dazu, damit sie bei
// anderer Bildschirmgröße an derselben Stelle bleibt.
import { h } from './ui.js';

const ITEMS = [
  ['top-file', 'Menü'], ['top-hist', 'Rückgängig'], ['top-view', 'Ansichten'],
  ['rail', 'Werkzeuge'], ['panel', 'Elemente'], ['bar', 'Werkzeugoptionen'], ['numpad', 'Ziffernblock'],
  ['toast', 'Meldungen'], ['check', 'Druckprüfung'], ['gridchip', 'Raster'],
];
const CENTER = new Set(['bar', 'numpad', 'toast', 'check']); // per CSS mittig (translateX(-50%))
const DUMMY = new Set(['bar', 'numpad', 'toast', 'check']); // beim Anordnen mit Platzhalter zeigen
const KEY = 'form3d-layout';
const $ = id => document.getElementById(id);
const mode = () => (innerWidth > innerHeight ? 'land' : 'port');

let saved = { port: {}, land: {} };
try { Object.assign(saved, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* privater Modus */ }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* privater Modus */ } };

function apply(id) {
  const el = $(id), p = saved[mode()]?.[id];
  if (!el) return;
  const s = el.style;
  for (const k of ['position', 'left', 'right', 'top', 'bottom', 'transform', 'maxHeight', 'maxWidth']) s[k] = '';
  if (!p) return;
  s.position = 'fixed';
  if (p.ax === 'c') { s.left = `calc(50% + ${p.x}px)`; s.right = 'auto'; s.transform = 'translateX(-50%)'; }
  else {
    s[p.ax === 'l' ? 'left' : 'right'] = p.x + 'px';
    s[p.ax === 'l' ? 'right' : 'left'] = 'auto';
    if (CENTER.has(id)) s.transform = 'none';
  }
  s[p.ay === 't' ? 'top' : 'bottom'] = p.y + 'px';
  s[p.ay === 't' ? 'bottom' : 'top'] = 'auto';
  if (id === 'rail') s.maxHeight = `calc(100% - ${p.y + 12}px)`;
  if (id === 'bar') s.maxWidth = 'calc(100% - 20px)';
}
export const applyAll = () => ITEMS.forEach(([id]) => apply(id));

// jetzige Lage aller Flächen als Anker merken
function snapshot() {
  const W = innerWidth, H = innerHeight, out = {};
  for (const [id] of ITEMS) {
    const el = $(id);
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect(), cx = (r.left + r.right) / 2;
    const ax = CENTER.has(id) && Math.abs(cx - W / 2) < W / 6 ? 'c' : cx < W / 2 ? 'l' : 'r';
    const x = ax === 'c' ? Math.round(cx - W / 2) : Math.max(0, Math.round(ax === 'l' ? r.left : W - r.right));
    const ay = id === 'rail' || (r.top + r.bottom) / 2 < H / 2 ? 't' : 'b'; // Werkzeugleiste: oben verankert, unten frei
    out[id] = { ax, x, ay, y: Math.max(0, Math.round(ay === 't' ? r.top : H - r.bottom)) };
  }
  return out;
}

// ---- Anordnen ----
let arr = null;

export function arrange() {
  if (arr) return;
  const label = h('span', {});
  const ctl = h('div', { id: 'arrange' }, label,
    h('button', { class: 'plain', onclick: () => { saved[mode()] = {}; persist(); applyAll(); } }, 'Zurücksetzen'),
    h('button', { onclick: finish }, 'Fertig'));
  arr = { ctl, label, kept: new Map(), panelClosed: $('panel').classList.contains('closed'), drag: null };
  for (const id of DUMMY) {
    const el = $(id);
    arr.kept.set(id, { hidden: el.hidden, kids: [...el.childNodes] });
    el.replaceChildren(h('div', { class: 'ph ph-' + id }, ITEMS.find(i => i[0] === id)[1]));
    el.hidden = false;
  }
  $('panel').classList.remove('closed');
  for (const [id] of ITEMS) $(id)?.classList.add('lay-item');
  document.body.classList.add('arranging');
  document.body.append(h('div', { id: 'arrange-shade' }), ctl);
  setLabel();
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('click', block, true);
}

function setLabel() {
  if (arr) arr.label.textContent = `Flächen ziehen · ${mode() === 'land' ? 'Querformat' : 'Hochformat'}`;
}

const itemOf = t => { const el = t.closest?.('.lay-item'); return el && !arr.ctl.contains(t) ? el : null; };
function block(e) { if (itemOf(e.target)) { e.preventDefault(); e.stopPropagation(); } }

function down(e) {
  const el = itemOf(e.target);
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  const r = el.getBoundingClientRect();
  Object.assign(el.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', right: 'auto', bottom: 'auto', transform: 'none' });
  arr.drag = { el, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height };
  addEventListener('pointermove', move, true);
  addEventListener('pointerup', up, true);
  addEventListener('pointercancel', up, true);
}

function move(e) {
  const d = arr?.drag;
  if (!d) return;
  e.preventDefault();
  // die Werkzeugleiste darf nach unten kürzer werden (sie rollt dann), alles andere bleibt ganz sichtbar
  const tall = d.el.id === 'rail', x = Math.min(Math.max(0, e.clientX - d.dx), innerWidth - d.w);
  const y = Math.min(Math.max(0, e.clientY - d.dy), innerHeight - (tall ? 160 : d.h));
  Object.assign(d.el.style, { left: x + 'px', top: y + 'px' }, tall ? { maxHeight: innerHeight - y - 12 + 'px' } : {});
}

function up() {
  removeEventListener('pointermove', move, true);
  removeEventListener('pointerup', up, true);
  removeEventListener('pointercancel', up, true);
  if (!arr?.drag) return;
  arr.drag = null;
  saved[mode()] = snapshot();
  persist();
  applyAll();
}

function finish() {
  document.removeEventListener('pointerdown', down, true);
  document.removeEventListener('click', block, true);
  for (const [id, k] of arr.kept) {
    const el = $(id);
    el.replaceChildren(...k.kids);
    el.hidden = id === 'toast' ? true : k.hidden;
  }
  if (arr.panelClosed) $('panel').classList.add('closed');
  for (const [id] of ITEMS) $(id)?.classList.remove('lay-item');
  document.body.classList.remove('arranging');
  arr.ctl.remove();
  $('arrange-shade').remove();
  arr = null;
}

export function init() {
  applyAll();
  addEventListener('resize', () => { applyAll(); setLabel(); });
}
