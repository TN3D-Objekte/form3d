// Fehleraufzeichnung abspielen (index.html?replay=<URL>, meist über tests/replay.html): stellt Modell, Ansicht
// und Gerät her, spielt die Eingaben in Originalreihenfolge ab und meldet Abweichungen vom aufgezeichneten Zustand.
const { vp, appState, replayStart } = window.form3d;
const host = parent !== window && parent.document.getElementById('out');
const out = host || Object.assign(document.body.appendChild(document.createElement('pre')), { id: 'replay', style: 'position:fixed;left:90px;bottom:80px;z-index:20;background:#fff;padding:8px;font:11px monospace;max-height:60%;overflow:auto' });
const log = s => { out.textContent += s + '\n'; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const sec = t => (t / 1000).toFixed(2) + 's';

// Zustände vergleichen: Ansicht grob, alles andere genau
const norm = s => JSON.stringify({ ...s, view: s.view && { ...s.view, target: s.view.target.map(x => Math.round(x)), dist: Math.round(s.view.dist), theta: +s.view.theta.toFixed(1), phi: +s.view.phi.toFixed(1) } });
function diff(want, have) {
  const keys = new Set([...Object.keys(want || {}), ...Object.keys(have || {})]), d = [];
  for (const k of keys) if (norm({ [k]: want?.[k] }) !== norm({ [k]: have?.[k] })) d.push(`${k}: aufgezeichnet ${JSON.stringify(want?.[k])} · jetzt ${JSON.stringify(have?.[k])}`);
  return d;
}

function resolve(tgt) {
  const root = document.getElementById(tgt.root) || document.body;
  let el = root;
  for (const i of tgt.path) el = el?.children[i];
  const same = e => e && ((tgt.title && e.getAttribute('title') === tgt.title) || (e.textContent || '').trim().slice(0, 40) === tgt.text);
  if (same(el)) return el;
  return [...root.querySelectorAll('button')].find(same) || null;
}

try {
  const r = await (await fetch(new URLSearchParams(location.search).get('replay'))).json();
  log(`Aufzeichnung ${r.started} · Gerät ${r.device} · ${r.screen.w}×${r.screen.h} (hier ${vp.w}×${vp.h}) · ${r.events.length} Ereignisse`);
  log(`Browser: ${r.ua}`);
  if (r.note) log(`Notiz: ${r.note}`);
  replayStart(r);
  await wait(300);
  for (const d of diff(r.state, appState())) log('  Start weicht ab – ' + d);
  let last = 0, pending = 0;
  for (const ev of r.events) {
    if (ev.t > last) await wait(Math.min(ev.t - last, 1500));
    last = ev.t;
    if (ev.k === 'p' && ev.gl) {
      if (ev.view) { // Ansicht wie beim Antippen (laufende Kamerafahrten sind zeitabhängig)
        const [x, y, z, dist, theta, phi] = ev.view, v = vp.view;
        if (Math.abs(v.dist - dist) > dist * 0.01 || Math.abs(v.theta - theta) > 0.01 || Math.abs(v.phi - phi) > 0.01) log(`${sec(ev.t)} Ansicht angeglichen (Abstand ${v.dist.toFixed(0)} → ${dist.toFixed(0)})`);
        vp._anim++;
        v.target.set(x, y, z); Object.assign(v, { dist, theta, phi });
        vp.render();
      }
      vp.canvas.dispatchEvent(new PointerEvent('pointer' + ev.type, { pointerId: ev.id, pointerType: ev.pt, button: ev.b, buttons: ev.bs, clientX: ev.x, clientY: ev.y, shiftKey: !!ev.sh, bubbles: true, cancelable: true }));
    } else if (ev.k === 'c') {
      const el = resolve(ev.tgt);
      if (el) el.click(); else log(`${sec(ev.t)} Schaltfläche nicht gefunden: ${JSON.stringify(ev.tgt)}`);
    } else if (ev.k === 'k') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ev.key, ctrlKey: !!ev.ctrl, metaKey: !!ev.meta, shiftKey: !!ev.sh }));
    } else if (ev.k === 'w') {
      vp.canvas.dispatchEvent(new WheelEvent('wheel', { clientX: ev.x, clientY: ev.y, deltaY: ev.dy, ctrlKey: !!ev.ctrl, bubbles: true, cancelable: true }));
    } else if (ev.k === 's') {
      await wait(0);
      const d = diff(ev.s, appState());
      if (d.length && pending++ < 15) log(`${sec(ev.t)} nach ${ev.why}: ` + d.join(' | '));
    } else if (ev.k === 'mark') log(`${sec(ev.t)} ★ markierter Moment – Zustand: ${JSON.stringify(appState())}`);
    else if (ev.k === 'toast') log(`${sec(ev.t)} Hinweis (aufgezeichnet): ${ev.msg}`);
    else if (ev.k === 'log') log(`${sec(ev.t)} ${ev.level} (aufgezeichnet): ${ev.msg}`);
  }
  await wait(400);
  log('Ende – ' + (diff(r.end.state, appState()).join(' | ') || 'Zustand stimmt mit der Aufzeichnung überein'));
  log('Zustand: ' + JSON.stringify(appState()));
} catch (e) { log('Ausnahme: ' + (e.stack || e)); }
log('REPLAY DONE');
