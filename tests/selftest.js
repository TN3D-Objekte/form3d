// Entwickler-Selbsttest: index.html?demo&selftest – spielt Bedienabläufe mit synthetischen Zeigerereignissen durch.
import * as K from '../js/kernel.js';
import * as S from '../js/sketch.js';
import { toFile, fromFile } from '../js/doc.js';
import { exportSTL } from '../js/exporters.js';
import { edgeChains, buildEdgeTool } from '../js/edges.js';
import { solveSketch } from '../js/solver.js';
const { doc, vp, st, sel, railPick, applyOp } = window.form3d;
const out = document.createElement('pre');
out.id = 'selftest';
out.style.cssText = 'position:fixed;left:90px;bottom:80px;z-index:20;background:#fff;padding:8px;font:11px monospace;max-height:60%;overflow:auto';
document.body.append(out);
const log = (ok, msg) => { out.textContent += (ok ? 'PASS ' : 'FAIL ') + msg + '\n'; };
const canvas = document.getElementById('gl');
const stopAt = new URLSearchParams(location.search).get('selftest');
const wait = ms => new Promise(r => setTimeout(r, ms));
let pid = 100;
const fire = (type, x, y, o = {}) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: o.id ?? pid, pointerType: o.pt ?? 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true }));
const tap = (x, y, o) => { pid++; fire('pointerdown', x, y, o); fire('pointerup', x, y, o); };
const dragTo = (x0, y0, x1, y1, o) => { pid++; fire('pointerdown', x0, y0, o); for (let i = 1; i <= 6; i++) fire('pointermove', x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6, o); fire('pointerup', x1, y1, o); };
// Bildschirmposition eines Weltpunkts
const scr = (x, y, z) => { vp.applyView(); const v = vp.camera.position.clone().set(x, y, z).project(vp.camera); return [(v.x + 1) / 2 * vp.w, (1 - v.y) / 2 * vp.h]; };

try {
  await wait(600);
  const vol = K.props(doc.bodies[0].mesh).volume;
  log(doc.bodies.length === 1 && Math.abs(vol - 37888) < 400, `Demo-Körper, Volumen ${vol.toFixed(0)} (Soll ~37888)`);

  // Körperfläche (Oberseite der Nabe bei z=26) antippen → Drücken/Ziehen
  tap(...scr(11.5, 0, 26));
  log(st.op?.type === 'extrude' && st.op.face && Math.abs(st.op.plane.o[2] - 26) < 1e-3, 'Fläche gewählt, Ebene z=' + st.op?.plane.o[2]);
  // am Pfeil ziehen
  const h0 = scr(0, 0, 26 + 42 * vp.pxSize({ x: 0, y: 0, z: 26 })), c = st.op.origin;
  const h1 = scr(c[0], c[1], c[2] + 42 * vp.pxSize({ x: c[0], y: c[1], z: c[2] }));
  vp.render();
  dragTo(h1[0], h1[1], h1[0], h1[1] - 60);
  log(st.op.dist > 0, 'Pfeil gezogen, Abstand ' + st.op.dist);
  st.op.dist = 10;
  if (stopAt === 'op') { window.form3d.sync(); out.remove(); throw 0; }
  applyOp();
  const vol2 = K.props(doc.bodies[0].mesh).volume;
  log(doc.bodies.length === 1 && Math.abs(vol2 - vol - Math.PI * (225 - 64) * 10) < 60, `Drücken/Ziehen +10: ΔV ${(vol2 - vol).toFixed(0)} (Soll ~5058)`);

  // Skizze auf Grundebene: Rechteck ziehen, Kreis hinein, dann extrudieren
  railPick('rect');
  log(st.pickPlane, 'Ebenenwahl aktiv');
  vp.view.phi = 0.5; vp.render();
  tap(...scr(-60, -60, 0));
  await wait(700);
  log(st.sketchId != null && st.tool === 'rect', 'Skizze angelegt, Werkzeug ' + st.tool);
  dragTo(...scr(60, -60, 0), ...scr(100, -20, 0));
  const sk = doc.sketches.find(s => s.id === st.sketchId);
  log(sk.entities.length === 4, 'Rechteck: ' + JSON.stringify(sk.entities.map(e => [e.a, e.b])));
  railPick('circle');
  tap(...scr(80, -40, 0)); tap(...scr(90, -40, 0));
  log(sk.entities.length === 5 && sk.entities[4].type === 'circle', 'Kreis r=' + sk.entities[4]?.r);
  if (stopAt === 'sketch') { railPick('line'); tap(...scr(20, -80, 0)); tap(...scr(40, -100, 0)); fire('pointermove', ...scr(10, -110, 0), { id: 999 }); out.remove(); throw 0; }
  // Skizze nachträglich ändern: Ecke ziehen (Rechteck bleibt Rechteck), dann zurück
  railPick('select');
  log(sk.constraints?.length === 4, 'Rechteck hat automatisch H/V-Bedingungen: ' + sk.constraints?.map(c => c.type).join(''));
  dragTo(...scr(100, -20, 0), ...scr(110, -10, 0));
  const skNow = () => doc.sketches.find(s => s.id === st.sketchId);
  const corners = () => JSON.stringify(skNow().entities.filter(e => e.type === 'line').map(e => e.a));
  log(corners() === '[[60,-60],[110,-60],[110,-10],[60,-10]]', 'Ecke gezogen: ' + corners());
  document.getElementById('btn-undo').click();
  log(corners() === '[[60,-60],[100,-60],[100,-20],[60,-20]]', 'Rückgängig stellt die Skizze wieder her');
  // Linie antippen → Länge als Maß setzen, danach Maß-Marke antippen und löschen
  tap(...scr(80, -60, 0));
  log(sel.ents.length === 1, 'Skizzenlinie gewählt');
  if (stopAt === 'con') {
    [...document.querySelectorAll('#bar .chip')][0].click();
    for (const k of ['5', '0', 'OK']) [...document.querySelectorAll('#numpad .np-keys button')].find(b => b.textContent === k).click();
    tap(...scr(80, -40 + 10, 0));
    document.getElementById('help').hidden = true; vp.view.target.set(80, -40, 0); vp.view.dist = 170; vp.render(); out.remove(); throw 0;
  }
  [...document.querySelectorAll('#bar .chip')][0].click();
  for (const k of ['5', '0', 'OK']) [...document.querySelectorAll('#numpad .np-keys button')].find(b => b.textContent === k).click();
  const l0 = skNow().entities[0], w0 = Math.abs(l0.b[0] - l0.a[0]);
  log(Math.abs(w0 - 50) < 1e-6 && skNow().entities.every(e => e.type !== 'line' || e.a[0] === e.b[0] || e.a[1] === e.b[1]), 'Maß 50 gesetzt, Rechteck bleibt rechtwinklig: Breite ' + w0);
  document.getElementById('btn-undo').click();

  // Löser direkt
  const mk = (ents, cons) => ({ entities: ents.map((e, i) => ({ id: i + 1, ...e })), constraints: cons.map((c, i) => ({ id: 100 + i, ...c })) });
  const Ln = (a, b) => ({ type: 'line', a, b });
  let t1 = mk([Ln([0, 0], [30, 5]), Ln([0, 10], [20, 30])], [{ type: 'perp', a: 1, b: 2 }, { type: 'eq', a: 1, b: 2 }]);
  let okS = solveSketch(t1);
  const dv = e => [e.b[0] - e.a[0], e.b[1] - e.a[1]], [u, w] = t1.entities.map(dv);
  log(okS && Math.abs(u[0] * w[0] + u[1] * w[1]) < 1e-4 && Math.abs(Math.hypot(...u) - Math.hypot(...w)) < 1e-4, 'Senkrecht + gleich lang');
  t1 = mk([Ln([0, 0], [40, 3]), { type: 'circle', c: [20, 14], r: 8 }], [{ type: 'tan', a: 1, b: 2 }, { type: 'fix', a: 1 }]);
  okS = solveSketch(t1);
  const [tl, tc] = t1.entities, dd = dv(tl), distL = Math.abs((tc.c[0] - tl.a[0]) * dd[1] - (tc.c[1] - tl.a[1]) * dd[0]) / Math.hypot(...dd);
  log(okS && Math.abs(distL - tc.r) < 1e-4 && tl.b[0] === 40 && tl.b[1] === 3, `Tangential an fixierter Linie: Abstand ${distL.toFixed(4)} = r ${tc.r.toFixed(4)}`);
  t1 = mk([Ln([0, 0], [40, 0])], [{ type: 'h', a: 1 }, { type: 'dim', a: 1, value: 40 }, { type: 'fix', a: 1 }]);
  okS = solveSketch(t1, { drags: [{ id: 1, key: 'b', target: [60, 20] }] });
  log(okS && t1.entities[0].b[0] === 40 && t1.entities[0].b[1] === 0, 'Ziehen an fixierter Linie bewegt nichts');
  t1 = mk([Ln([0, 0], [40, 0]), Ln([40, 0], [40, 30])], [{ type: 'dim', a: 1, value: 40 }]);
  okS = solveSketch(t1, { drags: [{ id: 2, key: 'a', target: [0, 40] }] });
  const [m1, m2] = t1.entities;
  log(okS && Math.abs(Math.hypot(...dv(m1)) - 40) < 1e-4 && m1.b[0] === m2.a[0] && m1.b[1] === m2.a[1], 'Verbundener Punkt gezogen, Länge 40 bleibt: ' + JSON.stringify(m1.b));

  tap(...scr(64, -56, 0));
  log(sel.regions.length === 1 && st.op?.type === 'extrude', 'Skizzenfläche gewählt: ' + JSON.stringify(sel.regions));
  st.op.dist = 12;
  applyOp();
  const b2 = doc.bodies[doc.bodies.length - 1], v3 = K.props(b2.mesh).volume, want = (1600 - Math.PI * 100) * 12;
  log(doc.bodies.length === 2 && Math.abs(v3 - want) < 40, `Extrusion mit Loch: V ${v3.toFixed(0)} (Soll ~${want.toFixed(0)})`);

  // Touch: Zwei-Finger-Zoom darf nichts auswählen
  const d0 = vp.view.dist;
  fire('pointerdown', 500, 400, { id: 1, pt: 'touch' }); fire('pointerdown', 600, 400, { id: 2, pt: 'touch' });
  fire('pointermove', 650, 400, { id: 2, pt: 'touch' }); fire('pointerup', 650, 400, { id: 2, pt: 'touch' }); fire('pointerup', 500, 400, { id: 1, pt: 'touch' });
  log(vp.view.dist < d0 && !sel.face && !sel.bodies.length, `Pinch-Zoom ${d0.toFixed(0)} → ${vp.view.dist.toFixed(0)}`);

  // Körper wählen (Doppeltipp), vereinigen, rückgängig
  vp.setView('iso'); await wait(500);
  const p = scr(80, -60, 6); tap(...p); tap(...p);
  log(sel.bodies.length === 1 && sel.bodies[0] === b2.id, 'Doppeltipp wählt Körper');
  document.querySelector('[data-tool=move]').click();
  log(!!st.xf && vp.gizmo.object != null, 'Bewegen-Gizmo aktiv');
  [...document.querySelectorAll('#bar .chip')][0].click();
  for (const k of ['2', '5', 'OK']) [...document.querySelectorAll('#numpad .np-keys button')].find(b => b.textContent === k).click();
  const bb = doc.bodies.find(b => b.id === b2.id).mesh.v; let minx = 1e9; for (let i = 0; i < bb.length; i += 3) minx = Math.min(minx, bb[i]);
  log(Math.abs(minx - 85) < 1e-3, 'ΔX 25 per Ziffernblock: min x = ' + minx);
  document.getElementById('btn-undo').click();
  await wait(50);
  let minx2 = 1e9; const bb2 = doc.bodies[1].mesh.v; for (let i = 0; i < bb2.length; i += 3) minx2 = Math.min(minx2, bb2[i]);
  log(Math.abs(minx2 - 60) < 1e-3, 'Rückgängig: min x = ' + minx2);

  // Kante antippen → Fase 3 mm über die Oberfläche
  dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  const vE = K.props(doc.bodies[1].mesh).volume;
  tap(...scr(80, -60, 12));
  log(sel.edges.length === 1 && sel.edges[0].bodyId === b2.id, 'Kante gewählt: ' + JSON.stringify(sel.edges.map(x => x.idx)));
  [...document.querySelectorAll('#bar .btn')].find(b => b.title === 'Fase').click();
  st.op.size = 3;
  if (stopAt === 'edge' || stopAt === 'edge2') {
    st.op.kind = 'fillet'; st.op.size = 5; window.form3d.refresh();
    if (stopAt === 'edge2') { applyOp(); tap(...scr(60, -40, 12)); tap(...scr(100, -60, 6)); document.querySelector('#bar .btn[title=Verrunden]').click(); st.op.size = 4; applyOp(); }
    vp.view.target.set(70, -40, 6); vp.view.dist = 190; vp.render(); out.remove(); throw 0;
  }
  applyOp();
  const dE = vE - K.props(doc.bodies[1].mesh).volume;
  log(Math.abs(dE - 180) < 2, `Fase 3 mm an 40-mm-Kante: -${dE.toFixed(1)} (Soll 180)`);

  // Verrundung/Fase am Kern prüfen
  const volOf = m => K.props(m).volume;
  const blendV = (m, pick, kind, size) => volOf(K.blend(m, edgeChains(m).filter(pick).map(ch => buildEdgeTool(m, ch, kind, size))));
  const bx = K.primitive('box', { l: 50, b: 50, h: 30 }), chB = edgeChains(bx);
  const vertical = ch => Math.abs(ch.pts[0][2] - ch.pts[1][2]) > 1;
  log(chB.length === 12 && chB.every(c => !c.closed && c.segs.length === 1), 'Quader: ' + chB.length + ' Kanten');
  const f1 = 75000 - blendV(bx, (ch, i, a) => a.filter(vertical)[0] === ch, 'fillet', 5), wantF = (25 - Math.PI * 25 / 4) * 30;
  log(Math.abs(f1 - wantF) < 3, `Verrundung R5 an einer Kante: -${f1.toFixed(1)} (Soll ${wantF.toFixed(1)})`);
  const f4 = 75000 - blendV(bx, vertical, 'fillet', 5);
  log(Math.abs(f4 - 4 * wantF) < 10, `Verrundung R5 an vier Kanten: -${f4.toFixed(1)} (Soll ${(4 * wantF).toFixed(1)})`);
  const cAll = blendV(bx, () => true, 'chamfer', 3);
  log(cAll < 75000 - 2100 && cAll > 75000 - 2340, `Fase 3 an allen 12 Kanten: -${(75000 - cAll).toFixed(0)} (520 mm Kante x 4,5 mm² = 2340 abzüglich Ecken)`);
  const cy = K.primitive('cyl', { d: 40, h: 50 }), chC = edgeChains(cy), topRim = ch => ch.pts[0][2] > 49;
  log(chC.length === 2 && chC.every(c => c.closed && c.segs.length === 64), 'Zylinder: ' + chC.length + ' Ringkanten');
  const c1 = volOf(cy) - blendV(cy, topRim, 'chamfer', 2);
  log(Math.abs(c1 - 242.9) < 8, `Fase 2 am Zylinderrand: -${c1.toFixed(1)} (Soll ~243)`);
  const c2 = volOf(cy) - blendV(cy, topRim, 'fillet', 5);
  log(Math.abs(c2 - 636.6) < 20, `Verrundung R5 am Zylinderrand: -${c2.toFixed(1)} (Soll ~637)`);
  const ell = K.extrude([{ outer: [[0, 0], [40, 0], [40, 20], [20, 20], [20, 40], [0, 40]], holes: [] }], S.BASE_PLANES.xy, 10);
  const inner = ch => vertical(ch) && Math.abs(ch.pts[0][0] - 20) < 1e-3 && Math.abs(ch.pts[0][1] - 20) < 1e-3;
  const c3 = blendV(ell, inner, 'fillet', 5) - volOf(ell);
  log(Math.abs(c3 - 53.65) < 1.5, `Verrundung R5 an Innenkante: +${c3.toFixed(1)} (Soll ~53.7)`);

  // Rotation: Rechteck x 10..20, y 0..10 um die Y-Achse
  const ring = K.revolve([{ outer: [[10, 0], [20, 0], [20, 10], [10, 10]], holes: [] }], S.BASE_PLANES.xz, { p: [0, 0], d: [0, 1] }, 360);
  const vr = K.props(ring).volume, zs = ring.v.filter((_, i) => i % 3 === 2);
  log(Math.abs(vr - Math.PI * 300 * 10) < 60 && Math.min(...zs) > -1e-3 && Math.max(...zs) < 10.001, `Rotation: V ${vr.toFixed(0)} (Soll ~9425), z ${Math.min(...zs)}..${Math.max(...zs)}`);

  // Grundkörper + Boolesche Operation über die Oberfläche
  const click = q => document.querySelector(q).click();
  const n0 = doc.bodies.length;
  click('[data-tool=box]'); applyOp(); click('[data-tool=cyl]'); applyOp();
  log(doc.bodies.length === n0 + 2, 'Quader und Zylinder angelegt');
  document.querySelectorAll('#panel .row-name')[n0].click();
  document.querySelectorAll('#panel .row-name')[n0 + 1].click();
  [...document.querySelectorAll('#bar .btn')].find(b => b.title === 'Abziehen').click();
  const vb = K.props(doc.bodies[n0].mesh).volume, wantB = 75000 - Math.PI * 400 * 30;
  log(doc.bodies.length === n0 + 1 && Math.abs(vb - wantB) < 120, `Abziehen: V ${vb.toFixed(0)} (Soll ~${wantB.toFixed(0)})`);

  // Datei speichern/öffnen und STL
  const before = doc.bodies.map(b => K.props(b.mesh).volume.toFixed(1)).join();
  const stl = exportSTL(doc.bodies), tris = doc.bodies.reduce((a, b) => a + b.mesh.t.length / 3, 0);
  log(stl.byteLength === 84 + 50 * tris, 'STL: ' + tris + ' Dreiecke, ' + stl.byteLength + ' Bytes');
  fromFile(toFile());
  const after = doc.bodies.map(b => K.props(b.mesh).volume.toFixed(1)).join();
  log(before === after && doc.sketches.length === 2, 'Projektdatei-Rundlauf: ' + after);

  // Zeichnen per Finger (ohne Pencil): Linienzug aus Tipps, geschlossen
  click('[data-tool=line]');
  vp.setView('top'); await wait(500);
  const T = { pt: 'touch' };
  tap(...scr(-100, 100, 0), T);
  await wait(600);
  for (const q of [[-100, 100], [-60, 100], [-60, 130], [-100, 100]]) tap(...scr(q[0], q[1], 0), T);
  const tri = doc.sketches.find(s => s.id === st.sketchId);
  log(tri?.entities.length === 3 && S.computeRegions(tri.entities).length === 1, 'Finger-Linienzug: ' + tri?.entities.length + ' Linien, Fläche ' + S.computeRegions(tri?.entities || [])[0]?.area);
  out.textContent += 'DONE\n';
} catch (e) {
  if (e !== 0) log(false, 'Ausnahme: ' + (e.stack || e));
}
vp.render();
