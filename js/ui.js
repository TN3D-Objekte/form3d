// DOM-Oberfläche: Werkzeugleiste, Kontextleiste, Ziffernblock, Elementliste, Menü, Hinweise.
const ICONS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
  select: '<path d="M6 3l12 9-5.5 1.2L10 19z"/>',
  line: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  arc: '<path d="M4 18A14 14 0 0118 4"/><circle cx="4" cy="18" r="1.6"/><circle cx="18" cy="4" r="1.6"/>',
  extrude: '<path d="M5 17l7 3 7-3-7-3z"/><path d="M12 14V4M8.5 7.5L12 4l3.5 3.5"/>',
  revolve: '<path d="M12 3v18"/><path d="M12 6c5 0 7 2 7 6s-2 6-7 6"/><path d="M5 9a8 3 0 0014 0" stroke-dasharray="2 2"/>',
  fillet: '<path d="M4 20v-7a9 9 0 019-9h7"/>',
  chamfer: '<path d="M4 20v-8l8-8h8"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  cyl: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>',
  sphere: '<circle cx="12" cy="12" r="9"/><path d="M3 12c0 2 4 3.5 9 3.5s9-1.500 9-3.500"/>',
  union: '<path d="M4 4h10v6h6v10H10v-6H4z"/>',
  subtract: '<path d="M4 4h10v6h-4v4H4z"/><path d="M14 10h6v10H10v-6" stroke-dasharray="2 2"/>',
  intersect: '<path d="M4 4h10v10H4z" stroke-dasharray="2 2"/><path d="M10 10h10v10H10z" stroke-dasharray="2 2"/><path d="M10 10h4v4h-4z" fill="currentColor"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.600 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.600 6.200A9.700 9.700 0 0112 6c6.400 0 10 6 10 6a17 17 0 01-3.200 3.900M6.300 7.700A16.800 16.800 0 002 12s3.600 7 10 7c1.700 0 3.200-.4 4.500-1"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  check: '<path d="M5 12.500l4.500 4.500L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="9" y="9" width="6" height="6"/>',
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.500 2.500 0 113.500 2.300c-.7.4-1 .9-1 1.700M12 17v.01"/>',
};

export const icon = n => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ''}</svg>`;

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.filter(c => c != null));
  return el;
}

export const fmt = n => (+(+n).toFixed(2)).toString().replace('.', ',');

// ---- Werkzeugleiste ----
export function buildRail(el, groups, onPick) {
  el.replaceChildren();
  for (const g of groups) {
    el.append(h('div', { class: 'rail-title' }, g.title));
    for (const t of g.tools) {
      el.append(h('button', { class: 'rail-btn', 'data-tool': t.id, title: t.label, onclick: () => onPick(t.id), html: icon(t.icon) + `<span>${t.label}</span>` }));
    }
  }
}
export function setRailActive(el, id) {
  for (const b of el.querySelectorAll('.rail-btn')) b.classList.toggle('active', b.dataset.tool === id);
}

// ---- Kontextleiste ----
export function renderBar(el, items) {
  el.replaceChildren();
  el.hidden = !items.length;
  for (const it of items) {
    if (it.type === 'label') el.append(h('span', { class: 'bar-label' + (it.dim ? ' dim' : '') }, it.text));
    else if (it.type === 'sep') el.append(h('span', { class: 'bar-sep' }));
    else if (it.type === 'field') {
      el.append(h('button', {
        class: 'chip', onclick: () => openNumpad({ label: it.label, value: it.value, unit: it.unit, onOk: it.onSet }),
      }, h('small', {}, it.label), h('b', {}, fmt(it.value) + (it.unit ? ' ' + it.unit : ''))));
    } else if (it.type === 'btn') {
      el.append(h('button', {
        class: 'btn ' + (it.kind || ''), title: it.label, onclick: it.onClick,
        html: (it.icon ? icon(it.icon) : '') + (it.iconOnly ? '' : `<span>${it.label}</span>`),
      }));
    } else if (it.type === 'seg') {
      el.append(h('div', { class: 'seg' }, ...it.options.map(([val, label]) =>
        h('button', { class: val === it.value ? 'on' : '', onclick: () => it.onChange(val) }, label))));
    } else if (it.type === 'colors') {
      el.append(h('div', { class: 'swatches' }, ...it.colors.map(c =>
        h('button', { class: 'swatch' + (c === it.value ? ' on' : ''), style: `background:${c}`, 'aria-label': 'Farbe', onclick: () => it.onChange(c) }))));
    }
  }
}

// ---- Ziffernblock (ersetzt die Bildschirmtastatur) ----
let np = null;
const npEl = () => document.getElementById('numpad');

export function openNumpad({ label, value, unit, onOk }) {
  np = { text: fmt(value), fresh: true, onOk };
  const el = npEl();
  const keys = ['7', '8', '9', '⌫', '4', '5', '6', '±', '1', '2', '3', 'C', '0', ',', 'OK'];
  el.replaceChildren(
    h('div', { class: 'np-head' }, h('span', {}, label), h('button', { class: 'np-close', onclick: closeNumpad, html: icon('x') })),
    h('div', { class: 'np-display' }, h('b', { id: 'np-text' }, np.text), h('span', {}, unit || '')),
    h('div', { class: 'np-keys' }, ...keys.map(k => h('button', { class: k === 'OK' ? 'ok' : '', onclick: () => numpadKey(k) }, k))),
  );
  el.hidden = false;
}
export function closeNumpad() { np = null; npEl().hidden = true; }
export const numpadOpen = () => !!np;

export function numpadKey(k) {
  if (!np) return;
  if (k === 'OK' || k === 'Enter') {
    const val = parseFloat(np.text.replace(',', '.'));
    const cb = np.onOk;
    closeNumpad();
    if (isFinite(val)) cb(val);
    return;
  }
  if (k === 'Escape') return closeNumpad();
  if (k === '⌫' || k === 'Backspace') np.text = np.fresh ? '' : np.text.slice(0, -1);
  else if (k === 'C') np.text = '';
  else if (k === '±' || k === '-') np.text = np.text.startsWith('-') ? np.text.slice(1) : '-' + np.text;
  else if (k === ',' || k === '.') { if (np.fresh) np.text = '0'; if (!np.text.includes(',')) np.text += ','; }
  else if (/^\d$/.test(k)) np.text = (np.fresh ? '' : np.text) + k;
  else return;
  if (k !== '±' && k !== '-') np.fresh = false;
  document.getElementById('np-text').textContent = np.text || '0';
}

// ---- Elementliste ----
export function renderPanel(el, m, on) {
  const row = (item, kind, active) => h('div', { class: 'row' + (active ? ' active' : '') },
    h('button', { class: 'row-eye' + (item.visible ? '' : ' off'), 'aria-label': 'Sichtbarkeit', onclick: () => on.toggle(kind, item.id), html: icon(item.visible ? 'eye' : 'eyeoff') }),
    kind === 'body' ? h('span', { class: 'dot', style: `background:${item.color}` }) : null,
    h('button', { class: 'row-name', onclick: () => on.pick(kind, item.id), ondblclick: () => on.rename(kind, item.id) }, item.name),
    h('button', { class: 'row-del', 'aria-label': 'Löschen', onclick: () => on.remove(kind, item.id), html: icon('trash') }));
  el.replaceChildren(
    h('div', { class: 'panel-title' }, 'Körper'),
    ...(m.bodies.length ? m.bodies.map(b => row(b, 'body', m.selBodies.includes(b.id))) : [h('div', { class: 'empty' }, 'Noch keine Körper')]),
    h('div', { class: 'panel-title' }, 'Skizzen'),
    ...(m.sketches.length ? m.sketches.map(s => row(s, 'sketch', s.id === m.activeSketch)) : [h('div', { class: 'empty' }, 'Noch keine Skizzen')]),
  );
}

// ---- Menü, Hinweise, Hilfe ----
export function openMenu(el, entries) {
  el.replaceChildren(...entries.map(e => e === '-' ? h('hr') :
    h('button', { onclick: () => { el.hidden = true; e.onClick(); } }, e.label)));
  el.hidden = false;
  const close = ev => { if (!el.contains(ev.target)) { el.hidden = true; document.removeEventListener('pointerdown', close, true); } };
  setTimeout(() => document.addEventListener('pointerdown', close, true));
}

let toastTimer = 0;
export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function showHelp() {
  const el = document.getElementById('help');
  el.replaceChildren(h('div', { class: 'help-card' },
    h('h2', {}, 'Form3D – Kurzanleitung'),
    h('div', { class: 'help-grid', html: `
      <div><h3>Navigieren</h3><ul>
        <li><b>1 Finger ziehen</b> – Ansicht drehen</li>
        <li><b>2 Finger</b> – verschieben und zoomen</li>
        <li><b>Maus</b> – rechte Taste drehen, Rad zoomen, mittlere Taste verschieben</li></ul></div>
      <div><h3>Skizzieren</h3><ul>
        <li>Linie, Rechteck, Kreis oder Bogen wählen, dann <b>Ebene oder Körperfläche antippen</b></li>
        <li>Mit dem <b>Apple Pencil</b> zeichnen (ohne Stift mit dem Finger): ziehen oder Punkt für Punkt tippen</li>
        <li>Maße nach dem Zeichnen in der Leiste unten antippen und exakt eingeben</li>
        <li><b>Punkte und Linien ziehen</b>, um die Skizze zu ändern; Linie oder Kreis antippen für Bedingungen (horizontal, parallel, gleich, tangential …)</li></ul></div>
      <div><h3>Körper formen</h3><ul>
        <li><b>Skizzenfläche antippen</b> und am Pfeil ziehen – extrudieren</li>
        <li><b>Körperfläche antippen</b> und am Pfeil ziehen – drücken/ziehen</li>
        <li>Nach außen wird Material hinzugefügt, nach innen abgezogen</li></ul></div>
      <div><h3>Körper bearbeiten</h3><ul>
        <li><b>Kante antippen</b> – verrunden oder fasen, Maß unten eingeben</li>
        <li><b>Fläche zweimal antippen</b> – ganzen Körper wählen, weitere Körper dazutippen</li>
        <li>Unten erscheinen Bewegen, Vereinigen, Abziehen, Farbe, Löschen</li>
        <li>Export als STL/OBJ über das Menü oben links</li></ul></div>` }),
    h('button', { class: 'btn primary', onclick: () => (el.hidden = true) }, 'Los geht’s'),
    h('p', { class: 'help-foot', html: 'Privates Testprojekt · <a href="datenschutz.html">Datenschutz &amp; Lizenzen</a>' })));
  el.hidden = false;
}
