// Entwickler-Selbsttest: index.html?demo&selftest – spielt Bedienabläufe mit synthetischen Zeigerereignissen durch.
import * as K from '../js/kernel.js';
import * as S from '../js/sketch.js';
import { toFile, fromFile } from '../js/doc.js';
import { exportSTL } from '../js/exporters.js';
import { edgeChains, buildEdgeTool, cornerTools } from '../js/edges.js';
import { analyze, faceLoops, smoothSurface } from '../js/meshview.js';
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

  // Fasenfläche antippen → als Fase erkannt, Löschen macht die Kante wieder scharf, Rückgängig stellt sie her
  const view0 = { t: vp.view.target.clone(), d: vp.view.dist };
  vp.view.target.set(80, -58.5, 10.5); vp.view.dist = 70; vp.render();
  tap(...scr(80, -58.5, 10.5));
  vp.view.target.copy(view0.t); vp.view.dist = view0.d; vp.render();
  log(sel.face?.feature?.kind === 'chamfer', 'Fasenfläche gewählt: ' + sel.face?.feature?.kind);
  [...document.querySelectorAll('#bar .btn')].find(b => b.title === 'Löschen')?.click();
  const vDel = K.props(doc.bodies[1].mesh).volume;
  log(Math.abs(vDel - vE) < 0.5 && !doc.bodies[1].features?.length, `Fase gelöscht: V ${vDel.toFixed(1)} (Soll ${vE.toFixed(1)})`);
  document.getElementById('btn-undo').click();
  await wait(50);
  log(doc.bodies[1].features?.length === 1 && Math.abs(vE - K.props(doc.bodies[1].mesh).volume - 180) < 2, 'Rückgängig: Fase wieder da');

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

  // Verschobene Körper: Werkzeugenden/Schnittkörper liegen nicht exakt in den Körperflächen –
  // es dürfen keine hauchdünnen Reste (Faltkanten, zusätzliche Flächen, Häute) stehen bleiben
  const shift = m => K.transform(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.123456, 0.654321, 0.333333, 1]);
  const realFaces = m => { const an = analyze(m); return an.faces.filter(f => f.tris.some(t => an.fa[t] > 1e-9)).length; };
  const bxs = shift(bx), chamf = K.blend(bxs, edgeChains(bxs).filter(vertical).slice(0, 1).map(ch => buildEdgeTool(bxs, ch, 'chamfer', 4)));
  log(realFaces(chamf) === 7 && edgeChains(chamf).length === 15, `Fase an verschobenem Quader: ${realFaces(chamf)} Flächen (Soll 7), ${edgeChains(chamf).length} Kanten (Soll 15)`);
  const ells = shift(ell), ellIn = edgeChains(ells).filter(ch => vertical(ch) && Math.abs(ch.pts[0][0] - 20.123456) < 1e-3 && Math.abs(ch.pts[0][1] - 20.654321) < 1e-3);
  const ellF = K.blend(ells, ellIn.map(ch => buildEdgeTool(ells, ch, 'chamfer', 5)));
  log(ellIn.length === 1 && realFaces(ellF) <= realFaces(ell) + 1 + 4, `Fase an Innenkante, verschoben: ${realFaces(ellF)} Flächen (Soll ≤ ${realFaces(ell) + 5})`);
  // Eckübergänge: alle Kanten verrundet → keine scharfen Kanten, Volumen wie gerundeter Quader
  const rbox = (l, b, h, r) => (l - 2 * r) * (b - 2 * r) * (h - 2 * r) + 2 * r * ((l - 2 * r) * (b - 2 * r) + (l - 2 * r) * (h - 2 * r) + (b - 2 * r) * (h - 2 * r)) + Math.PI * r * r * (l + b + h - 6 * r) + 4 / 3 * Math.PI * r ** 3;
  const filletAll = (m, pick, r) => { const ch = edgeChains(m).filter(pick); return K.blend(m, [...ch.map(c => buildEdgeTool(m, c, 'fillet', r)), ...cornerTools(m, ch, 'fillet', r)]); };
  const rb = filletAll(shift(bx), () => true, 5), vRb = volOf(rb);
  log(analyze(rb).sharp.length === 0 && Math.abs(vRb - rbox(50, 50, 30, 5)) < 0.002 * vRb, `Alle 12 Kanten R5 mit Kugelecken: ${analyze(rb).sharp.length / 2} scharfe Kanten, V ${vRb.toFixed(0)} (Soll ${rbox(50, 50, 30, 5).toFixed(0)})`);
  const pocket = K.boolean('subtract', K.primitive('box', { l: 60, b: 50, h: 30 }), K.extrude([{ outer: [[-20, -15], [20, -15], [20, 15], [-20, 15]], holes: [] }], { ...S.BASE_PLANES.xy, o: [0, 0, 10] }, 25));
  const pIn = ch => ch.pts.every(p => Math.abs(p[0]) < 20.01 && Math.abs(p[1]) < 15.01 && p[2] > 9.99) && !ch.pts.every(p => p[2] > 29.99);
  const vPk = volOf(filletAll(pocket, pIn, 4)), wantPk = 90000 - rbox(40, 30, 40, 4) / 2;
  log(Math.abs(vPk - wantPk) < 0.002 * wantPk, `Tasche, Innenecken R4: V ${vPk.toFixed(0)} (Soll ${wantPk.toFixed(0)})`);
  // Nach Verrundung der Oberkante wählt Antippen der senkrechten Kante nur diese (nicht den Bogen dahinter)
  const tf = K.blend(bx, edgeChains(bx).filter(ch => !vertical(ch) && ch.pts.every(p => p[2] > 29.9 && p[1] < -24.9)).map(ch => buildEdgeTool(bx, ch, 'fillet', 2)));
  const vc = edgeChains(tf).filter(ch => vertical(ch) && ch.pts.some(p => Math.abs(p[0] - 25) < 1e-3 && Math.abs(p[1] + 25) < 1e-3 && p[2] < 1));
  log(vc.length === 1 && vc[0].segs.length === 1, `Senkrechte Kante nach oberer Rundung einzeln: ${vc.map(c => c.segs.length)} Segment(e)`);
  const genus = m => (2 - new Set(m.t).size + m.t.length / 6) / 2;
  const cub = shift(K.primitive('box', { l: 50, b: 50, h: 50 })), topF = analyze(cub).faces.findIndex(f => f.n[2] > 0.999);
  const { plane: tp, loops: tLoops } = faceLoops(cub, analyze(cub), topF);
  const hole = K.boolean('subtract', cub, K.extrude(S.computeRegions([{ type: 'circle', c: S.regionCenter({ outer: tLoops[0], holes: [] }), r: 10 }]), tp, -50, 1e-3));
  log(genus(hole) === 1, `Durchgangsloch in verschobenem Würfel: Geschlecht ${genus(hole)} (Soll 1, keine Haut)`);

  // Rundung an Bohrungskante: Splitter-Dreiecke aus der Booleschen Operation dürfen keine Linien in der
  // Rundung erzeugen und die Deckfläche nicht mit Nachbarflächen verbinden
  const plateH = K.boolean('subtract', K.primitive('box', { l: 50, b: 50, h: 20 }), K.transform(K.primitive('cyl', { h: 30, d: 16 }), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -5, 1]));
  const holeEdge = edgeChains(plateH).find(ch => ch.closed && ch.pts.every(p => p[2] > 19.9));
  const filH = K.blend(plateH, [Object.assign(buildEdgeTool(plateH, holeEdge, 'fillet', 2), { tag: 1 })]), anH = analyze(filH);
  let innerSharp = 0;
  for (let k = 0; k < anH.sharpTri.length; k += 2) if (anH.tg[anH.sharpTri[k]] && anH.tg[anH.sharpTri[k]] === anH.tg[anH.sharpTri[k + 1]]) innerSharp++;
  const topH = anH.faces.reduce((best, f, i) => f.n[2] > 0.999 && f.tris.length > (anH.faces[best]?.tris.length || 0) ? i : best, -1);
  const filF = anH.faces.findIndex(f => f.tag === 1), filS = smoothSurface(filH, anH, filF);
  log(innerSharp === 0 && smoothSurface(filH, anH, topH).length === 1 && filS.every(g => anH.faces[g].tag === 1),
    `Bohrungsrundung: ${innerSharp} Linien in der Rundung, Deckfläche einzeln wählbar (${smoothSurface(filH, anH, topH).length}), Rundung ${filS.length} Teilflächen`);

  // Zwei Rundungen treffen sich an einer Ecke, die erste wird gelöscht: die zweite muss danach bis zur
  // Ecke durchlaufen (wie direkt am scharfen Quader angelegt), ohne stehengebliebenen Klotz
  const q0 = K.primitive('box', { l: 50, b: 50, h: 50 });
  const topEdge = (m, test) => edgeChains(m).find(ch => !ch.closed && ch.pts.every(p => p[2] > 49.9 && test(p)));
  const fA = K.blendFeatures(q0, [Object.assign(buildEdgeTool(q0, topEdge(q0, p => p[1] < -24.9), 'fillet', 5), { tag: 1 })]);
  const fB = K.blendFeatures(fA.mesh, [Object.assign(buildEdgeTool(fA.mesh, topEdge(fA.mesh, p => p[0] > 24.9), 'fillet', 5), { tag: 2 })]);
  const onlyB = K.props(K.blend(q0, [Object.assign(buildEdgeTool(q0, topEdge(q0, p => p[0] > 24.9), 'fillet', 5), { tag: 2 })])).volume;
  const delA = K.unblendFeatures(fB.mesh, fA.features, fB.features), vCorner = K.props(delA.mesh).volume;
  const vBack = K.props(K.unblend(delA.mesh, delA.keep, [])).volume;
  const vOld = K.props(K.unblend(fB.mesh, fA.features, fB.features.map(f => ({ ...f, tool: undefined })))).volume; // Verhalten ohne Werkzeug
  log(Math.abs(vCorner - onlyB) < 1 && Math.abs(vBack - 125000) < 1 && vOld - onlyB > 1, `Erste von zwei Eckrundungen gelöscht: V ${vCorner.toFixed(1)} (Soll ${onlyB.toFixed(1)}, ohne Nachschneiden ${vOld.toFixed(1)}), danach zweite gelöscht: ${vBack.toFixed(1)} (Soll 125000)`);

  // Auto-Modus ohne zugehörigen Körper (Skizze auf Grundebene): in Material hinein = Loch, vom Körper
  // weg aber berührend = anfügen, frei im Raum = neuer Körper
  {
    const { makeExtrude, resolveMode } = window.form3d, saved = doc.bodies;
    doc.bodies = [{ id: -1, visible: true, mesh: K.primitive('box', { l: 50, b: 50, h: 50 }) }];
    const disc = c => [{ outer: S.tessellate({ type: 'circle', c, r: 8 }).slice(0, -1), holes: [] }];
    const mode = (c, dist) => resolveMode(makeExtrude({ regions: disc(c), plane: S.BASE_PLANES.xy, parentId: null, dist }));
    const got = [mode([0, 0], 20), mode([0, 0], -20), mode([100, 0], 20)].join();
    doc.bodies = saved;
    log(got === 'cut,add,new', 'Auto ohne Bezugskörper: hinein/heraus/frei = ' + got + ' (Soll cut,add,new)');
  }

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
  const before = doc.bodies.map(b => K.props(b.mesh).volume.toFixed(1)).join(), featsBefore = doc.bodies.map(b => b.features?.length || 0).join();
  const stl = exportSTL(doc.bodies), tris = doc.bodies.reduce((a, b) => a + b.mesh.t.length / 3, 0);
  log(stl.byteLength === 84 + 50 * tris, 'STL: ' + tris + ' Dreiecke, ' + stl.byteLength + ' Bytes');
  fromFile(toFile());
  const after = doc.bodies.map(b => K.props(b.mesh).volume.toFixed(1)).join();
  log(before === after && doc.sketches.length === 2, 'Projektdatei-Rundlauf: ' + after);
  const fb = doc.bodies[1], vUn = K.props(K.unblend(fb.mesh, fb.features)).volume;
  log(doc.bodies.map(b => b.features?.length || 0).join() === featsBefore && K.maxTag(fb.mesh) > 0 && Math.abs(vUn - vE) < 0.5, `Rundlauf erhält Fase (löschbar): ${featsBefore}, V ohne Fase ${vUn.toFixed(1)}`);

  // Zeichnen per Finger (ohne Pencil): Linienzug aus Tipps, geschlossen
  click('[data-tool=line]');
  vp.setView('top'); await wait(500);
  const T = { pt: 'touch' };
  tap(...scr(-100, 100, 0), T);
  await wait(600);
  for (const q of [[-100, 100], [-60, 100], [-60, 130], [-100, 100]]) tap(...scr(q[0], q[1], 0), T);
  const tri = doc.sketches.find(s => s.id === st.sketchId);
  log(tri?.entities.length === 3 && S.computeRegions(tri.entities).length === 1, 'Finger-Linienzug: ' + tri?.entities.length + ' Linien, Fläche ' + S.computeRegions(tri?.entities || [])[0]?.area);

  // Zwei-Finger-Modus (Handy): 1 Finger zeichnet, 2 Finger drehen/zoomen, 3 Finger verschieben
  vp.twoFinger = true;
  const nLines = tri.entities.length, T2 = id => ({ pt: 'touch', id });
  dragTo(...scr(-140, 60, 0), ...scr(-100, 60, 0), T);
  log(tri.entities.length === nLines + 1, 'Zwei-Finger-Modus: 1 Finger zieht Linie (' + tri.entities.length + ' Linien)');
  const v0 = { ...vp.view };
  fire('pointerdown', 300, 300, T2(901)); fire('pointerdown', 400, 300, T2(902));
  for (let i = 1; i <= 5; i++) { fire('pointermove', 300 + 12 * i, 300, T2(901)); fire('pointermove', 400 + 12 * i, 300, T2(902)); }
  const dTheta = vp.view.theta - v0.theta;
  for (let i = 1; i <= 5; i++) { fire('pointermove', 360 - 10 * i, 300, T2(901)); fire('pointermove', 460 + 10 * i, 300, T2(902)); }
  fire('pointerup', 310, 300, T2(901)); fire('pointerup', 510, 300, T2(902));
  log(tri.entities.length === nLines + 1 && dTheta < -0.3 && vp.view.dist < v0.dist * 0.7, `2 Finger: gedreht ${dTheta.toFixed(2)}, Zoom ${(v0.dist / vp.view.dist).toFixed(2)}x, nichts gezeichnet`);
  const t0 = vp.view.target.clone(), th0 = vp.view.theta;
  [911, 912, 913].forEach((id, k) => fire('pointerdown', 300 + 40 * k, 300, T2(id)));
  for (let i = 1; i <= 5; i++) [911, 912, 913].forEach((id, k) => fire('pointermove', 300 + 40 * k + 15 * i, 300, T2(id)));
  [911, 912, 913].forEach((id, k) => fire('pointerup', 375 + 40 * k, 300, T2(id)));
  log(vp.view.target.distanceTo(t0) > 1 && vp.view.theta === th0 && tri.entities.length === nLines + 1, `3 Finger: verschoben um ${vp.view.target.distanceTo(t0).toFixed(1)} mm, nicht gedreht`);
  railPick('select');
  const th1 = vp.view.theta;
  dragTo(200, 500, 320, 520, T);
  log(vp.view.theta === th1, '1 Finger im Auswahlmodus dreht nicht');
  vp.twoFinger = false;
  out.textContent += 'DONE\n';
} catch (e) {
  if (e !== 0) log(false, 'Ausnahme: ' + (e.stack || e));
}
vp.render();
