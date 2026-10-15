// Fehleraufzeichnung: zeichnet Eingaben (Zeiger, Tasten, Klicks auf Schaltflächen), Hinweise, Fehlermeldungen
// und den Programmzustand auf. Ergebnis ist eine JSON-Datei mit Modell, Bildschirmfotos und Notiz, die sich mit
// tests/replay.html wieder abspielen lässt. Alles bleibt auf dem Gerät, bis man die Datei selbst weitergibt.
import { h, toast } from './ui.js';

const MAX_EVENTS = 60000, MAX_SHOTS = 6;
let rec = null, t0 = 0, lastHover = 0, pill = null, cfg = null;
const undo = [];

export const recording = () => !!rec;

// Element eindeutig beschreiben: nächster Vorfahr mit id plus Kindindizes, dazu Text/Titel zur Kontrolle
export function describe(el) {
  const path = [];
  let e = el;
  while (e && !e.id && e.parentElement) { path.unshift([...e.parentElement.children].indexOf(e)); e = e.parentElement; }
  return { root: e?.id || 'body', path, text: (el.textContent || '').trim().slice(0, 40), title: el.getAttribute?.('title') || '' };
}

const now = () => Math.round(performance.now() - t0);
const push = ev => { if (rec.events.length < MAX_EVENTS) rec.events.push(ev); };
const own = el => pill?.contains(el);

function snapState(why) { push({ k: 's', t: now(), why, s: cfg.state() }); }

function screenshot(vp) {
  vp.render(); // Zeichenpuffer ist nur direkt nach dem Rendern gültig
  const c = document.createElement('canvas');
  c.width = vp.w; c.height = vp.h;
  const g = c.getContext('2d');
  g.fillStyle = '#e8ebf0';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(vp.canvas, 0, 0, c.width, c.height);
  g.drawImage(vp.overlay, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}

function on(target, type, fn, opts) { target.addEventListener(type, fn, opts); undo.push(() => target.removeEventListener(type, fn, opts)); }

function onPointer(e) {
  if (own(e.target)) return;
  const gl = e.target === cfg.vp.canvas, type = e.type.slice(7);
  if (type === 'move') {
    if (!e.buttons && e.pointerType === 'mouse') { // Schweben nur gedrosselt (Vorschau beim Zeichnen)
      if (!gl || performance.now() - lastHover < 40) return;
      lastHover = performance.now();
    } else if (!gl) return;
  }
  const v = cfg.vp.view, view = gl && type === 'down' ? [...v.target.toArray(), v.dist, v.theta, v.phi] : undefined; // Ansicht beim Antippen
  push({ k: 'p', t: now(), view, type, id: e.pointerId, pt: e.pointerType, x: Math.round(e.clientX * 10) / 10, y: Math.round(e.clientY * 10) / 10, b: e.button, bs: e.buttons, sh: e.shiftKey || undefined, gl: gl || undefined, tgt: gl ? undefined : describe(e.target) });
  if (type === 'up' || type === 'cancel') setTimeout(() => rec && snapState('pointer' + type));
}

function onClick(e) {
  if (own(e.target)) return;
  const btn = e.target.closest?.('button, input, [onclick]');
  if (!btn || btn === cfg.vp.canvas) return;
  push({ k: 'c', t: now(), tgt: describe(btn) });
  setTimeout(() => rec && snapState('click'));
}

function onKey(e) {
  if (e.repeat) return;
  push({ k: 'k', t: now(), key: e.key, ctrl: e.ctrlKey || undefined, meta: e.metaKey || undefined, sh: e.shiftKey || undefined });
  setTimeout(() => rec && snapState('key'));
}

function onWheel(e) {
  if (e.target !== cfg.vp.canvas) return;
  push({ k: 'w', t: now(), x: e.clientX, y: e.clientY, dy: Math.round(e.deltaY * 100) / 100, ctrl: e.ctrlKey || undefined });
}

function hookConsole(name) {
  const orig = console[name];
  console[name] = (...args) => {
    if (rec) push({ k: 'log', t: now(), level: name, msg: args.map(a => a?.stack || (typeof a === 'object' ? safeJSON(a) : String(a))).join(' ').slice(0, 2000) });
    orig.apply(console, args);
  };
  undo.push(() => { console[name] = orig; });
}
const safeJSON = o => { try { return JSON.stringify(o).slice(0, 500); } catch { return String(o); } };

export function start(config) {
  if (rec) return;
  cfg = config;
  const vp = cfg.vp, v = vp.view;
  t0 = performance.now();
  rec = {
    format: 'form3d-bug/1', started: new Date().toISOString(), app: location.href.split('?')[0],
    ua: navigator.userAgent, device: vp.device, penSeen: vp.penSeen,
    screen: { w: vp.w, h: vp.h, dpr: devicePixelRatio, sw: screen.width, sh: screen.height, touch: navigator.maxTouchPoints },
    view: { target: v.target.toArray(), dist: v.dist, theta: v.theta, phi: v.phi },
    state: cfg.state(), doc: cfg.toFile(), events: [], shots: [],
  };
  rec.shots.push({ t: 0, why: 'Start', img: screenshot(vp) });
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) on(window, t, onPointer, { capture: true, passive: true });
  on(window, 'click', onClick, { capture: true });
  on(window, 'keydown', onKey, { capture: true });
  on(window, 'wheel', onWheel, { capture: true, passive: true });
  on(window, 'error', e => push({ k: 'log', t: now(), level: 'error', msg: (e.error?.stack || e.message || '') + ' @' + e.filename + ':' + e.lineno }));
  on(window, 'unhandledrejection', e => push({ k: 'log', t: now(), level: 'error', msg: 'Promise: ' + (e.reason?.stack || e.reason) }));
  hookConsole('error'); hookConsole('warn');
  const toastEl = document.getElementById('toast'), mo = new MutationObserver(() => { if (!toastEl.hidden) push({ k: 'toast', t: now(), msg: toastEl.textContent }); });
  mo.observe(toastEl, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  undo.push(() => mo.disconnect());

  pill = h('div', { id: 'recpill' },
    h('span', { class: 'rec-dot' }), h('span', {}, 'Aufnahme'),
    h('button', { class: 'chip-btn', title: 'Bildschirmfoto und Zustand merken', onclick: mark }, 'Hier!'),
    h('button', { class: 'chip-btn primary', onclick: stop }, 'Fertig'));
  document.body.append(pill);
  toast('Aufnahme läuft – Fehler nachstellen, bei Bedarf „Hier!“ tippen, dann „Fertig“', 4200);
}

function mark() {
  if (!rec) return;
  if (rec.shots.length >= MAX_SHOTS) rec.shots.splice(1, 1);
  rec.shots.push({ t: now(), why: 'Markiert', img: screenshot(cfg.vp), s: cfg.state() });
  push({ k: 'mark', t: now() });
  toast('Moment gemerkt');
}

function stop() {
  if (!rec) return;
  const r = rec;
  r.shots.push({ t: now(), why: 'Ende', img: screenshot(cfg.vp) });
  r.end = { t: now(), state: cfg.state(), doc: cfg.toFile() };
  rec = null;
  while (undo.length) undo.pop()();
  pill.remove(); pill = null;
  finish(r);
}

// Abschluss: Notiz eingeben, dann teilen oder als Datei sichern
function finish(r) {
  const el = document.getElementById('help');
  const note = h('textarea', { class: 'rec-note', rows: 4, placeholder: 'Was ist falsch? Was hätte passieren sollen?' });
  const name = 'form3d-fehler-' + r.started.slice(0, 16).replace(/[:T]/g, '-') + '.json';
  const file = () => {
    r.note = note.value.trim();
    return new File([JSON.stringify(r)], name, { type: 'application/json' });
  };
  const save = () => {
    const a = h('a', { href: URL.createObjectURL(file()), download: name });
    document.body.append(a); a.click(); a.remove();
  };
  const close = () => { el.hidden = true; };
  const canShare = !!navigator.canShare?.({ files: [new File(['{}'], name, { type: 'application/json' })] });
  el.replaceChildren(h('div', { class: 'help-card rec-card' },
    h('h2', {}, 'Fehleraufzeichnung'),
    h('p', { class: 'rec-info' }, `${r.events.length} Eingaben, ${r.shots.length} Bildschirmfotos, ${Math.round(r.end.t / 1000)} s. Die Datei enthält das Modell, die Eingaben und den Gerätetyp und bleibt auf diesem Gerät, bis du sie selbst weitergibst.`),
    h('img', { class: 'rec-shot', src: r.shots[r.shots.length - 1].img, alt: 'Bildschirmfoto' }),
    note,
    h('div', { class: 'rec-actions' },
      canShare ? h('button', { class: 'btn primary', onclick: () => navigator.share({ files: [file()], title: 'Form3D Fehlerbericht' }).then(close, e => { if (e?.name !== 'AbortError') save(); }) }, 'Teilen …') : null,
      h('button', { class: 'btn' + (canShare ? '' : ' primary'), onclick: () => { save(); close(); } }, 'Als Datei sichern'),
      h('button', { class: 'btn danger', onclick: () => { if (confirm('Aufzeichnung verwerfen?')) close(); } }, 'Verwerfen'))));
  el.hidden = false;
}
