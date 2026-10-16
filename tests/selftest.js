// Entwickler-Selbsttest: index.html?demo&selftest – spielt Bedienabläufe mit synthetischen Zeigerereignissen durch.
import * as K from '../js/kernel.js';
import * as S from '../js/sketch.js';
import { toFile, fromFile } from '../js/doc.js';
import { exportSTL, export3MF } from '../js/exporters.js';
import { edgeChains, buildEdgeTool, cornerTools, joinChains, tangentChains, transitionTools, creaseChains } from '../js/edges.js';
import { analyze, faceLoops, smoothSurface } from '../js/meshview.js';
import { solveSketch } from '../js/solver.js';
import { checkPrint, bestOrientation } from '../js/printcheck.js';
import * as Parts from '../js/parts.js';
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

  // Mikrostufe (5 µm), wie sie zwischen fast flach ineinanderlaufenden Rundungen stehen bleibt: keine Kante
  {
    const H = 0.005, v = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, H, 1, 1, H, 2, 0, H, 2, 1, H]);
    const t = new Uint32Array([0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2, 4, 6, 7, 4, 7, 5]);
    log(analyze({ v, t }).sharp.length === 0, 'Mikrostufe von 5 µm erzeugt keine Kante');
  }

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
  log(sel.bodies.length === 1 && sel.bodies[0] === b2.id && !!st.xf && vp.gizmo.object != null, 'Doppeltipp wählt Körper und startet Bewegen');
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

  // Fase bearbeiten: Kante wird scharf, Werkzeug mit Art und Maß der Fase; Abbrechen stellt sie wieder her,
  // Fertig mit 2 mm ersetzt sie, Rückgängig holt die 3-mm-Fase zurück
  const editChamfer = async () => {
    await wait(600); // kein Doppeltipp (der startet Bewegen)
    vp.view.target.set(80, -58.5, 10.5); vp.view.dist = 70; vp.render();
    tap(...scr(80, -58.5, 10.5));
    vp.view.target.copy(view0.t); vp.view.dist = view0.d; vp.render();
    [...document.querySelectorAll('#bar .btn')].find(b => b.title === 'Bearbeiten')?.click();
  };
  await editChamfer();
  const vEd = K.props(doc.bodies[1].mesh).volume;
  log(st.op?.type === 'edge' && st.op.kind === 'chamfer' && st.op.size === 3 && sel.edges.length === 1 && Math.abs(vEd - vE) < 0.5,
    `Fase bearbeiten: ${st.op?.kind} ${st.op?.size} mm, ${sel.edges.length} Kante, V ${vEd.toFixed(1)} (Soll ${vE.toFixed(1)})`);
  [...document.querySelectorAll('#bar .btn')].find(b => b.title === 'Abbrechen')?.click();
  log(!st.op && doc.bodies[1].features?.length === 1 && Math.abs(vE - K.props(doc.bodies[1].mesh).volume - 180) < 2, 'Bearbeiten abgebrochen: Fase unverändert');
  await editChamfer();
  st.op.size = 2;
  applyOp();
  const dEd = vE - K.props(doc.bodies[1].mesh).volume;
  log(doc.bodies[1].features?.length === 1 && doc.bodies[1].features[0].size === 2 && Math.abs(dEd - 80) < 2, `Fase auf 2 mm geändert: -${dEd.toFixed(1)} (Soll 80)`);
  document.getElementById('btn-undo').click();
  await wait(50);
  log(doc.bodies[1].features?.length === 1 && Math.abs(vE - K.props(doc.bodies[1].mesh).volume - 180) < 2, 'Rückgängig: 3-mm-Fase wieder da');

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
  const filletAll = (m, pick, r) => { const ch = edgeChains(m).filter(pick); return K.blend(m, [...ch.map(c => buildEdgeTool(m, c, 'fillet', r, ch)), ...cornerTools(m, ch, 'fillet', r)]); };
  const rb = filletAll(shift(bx), () => true, 5), vRb = volOf(rb);
  log(analyze(rb).sharp.length === 0 && Math.abs(vRb - rbox(50, 50, 30, 5)) < 0.002 * vRb, `Alle 12 Kanten R5 mit Kugelecken: ${analyze(rb).sharp.length / 2} scharfe Kanten, V ${vRb.toFixed(0)} (Soll ${rbox(50, 50, 30, 5).toFixed(0)})`);
  const pocket = K.boolean('subtract', K.primitive('box', { l: 60, b: 50, h: 30 }), K.extrude([{ outer: [[-20, -15], [20, -15], [20, 15], [-20, 15]], holes: [] }], { ...S.BASE_PLANES.xy, o: [0, 0, 10] }, 25));
  const pIn = ch => ch.pts.every(p => Math.abs(p[0]) < 20.01 && Math.abs(p[1]) < 15.01 && p[2] > 9.99) && !ch.pts.every(p => p[2] > 29.99);
  const vPk = volOf(filletAll(pocket, pIn, 4)), wantPk = 90000 - rbox(40, 30, 40, 4) / 2;
  log(Math.abs(vPk - wantPk) < 0.002 * wantPk, `Tasche, Innenecken R4: V ${vPk.toFixed(0)} (Soll ${wantPk.toFixed(0)})`);
  // Bodenrundungen einer Tasche in einem Schritt, die zuletzt angelegte wird gelöscht: Die übrigen
  // behalten ihr Volumen an den gemeinsamen Ecken (Ergebnis wie nur die übrigen drei angelegt)
  {
    const fl = edgeChains(pocket).filter(ch => ch.pts.every(p => Math.abs(p[2] - 10) < 1e-3));
    const tools = fl.map((c, i) => Object.assign(buildEdgeTool(pocket, c, 'fillet', 3), { tag: i + 1 }));
    const all4 = K.blendFeatures(pocket, tools), last = all4.features[all4.features.length - 1];
    const vDel = volOf(K.unblend(all4.mesh, [last], all4.features.slice(0, -1))), want3 = volOf(K.blend(pocket, tools.slice(0, -1)));
    log(fl.length === 4 && Math.abs(vDel - want3) < 0.5, `Letzte von vier Bodenrundungen gelöscht: V ${vDel.toFixed(1)} (Soll ${want3.toFixed(1)})`);
  }
  // Tasche mit spitzer Zunge (16°) und stumpfer Innenecke: Bodenrundungen R2 dürfen nirgends weiter als R
  // von einer Wand in die Tasche ragen (keine Finnen); an der Zungenspitze läuft die Rundung herum
  {
    const poly = [[-1, 1], [10, -5], [20, 10], [-10, 20], [-20, -20], [5, -30], [0, 0]];
    const tz = K.boolean('subtract', K.primitive('box', { l: 70, b: 70, h: 30 }), K.extrude([{ outer: poly, holes: [] }], { ...S.BASE_PLANES.xy, o: [0, 0, 10] }, 25));
    const fl = filletAll(tz, ch => ch.pts.every(p => Math.abs(p[2] - 10) < 1e-3), 2);
    const segD = (q, a, b) => { const ab = [b[0] - a[0], b[1] - a[1]], u = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2))); return Math.hypot(q[0] - a[0] - u * ab[0], q[1] - a[1] - u * ab[1]); };
    let far = 0, tip = 0;
    for (let i = 0; i < fl.v.length; i += 3) {
      const q = [fl.v[i], fl.v[i + 1]], z = fl.v[i + 2];
      if (z < 10.01 || z > 12.5 || Math.abs(q[0]) > 34 || Math.abs(q[1]) > 34) continue;
      const dist = Math.min(...poly.map((a, k) => segD(q, a, poly[(k + 1) % poly.length])));
      far = Math.max(far, dist);
      if (Math.hypot(q[0] + 1, q[1] - 1) < 2.1 && -0.8 * (q[0] + 1) + 0.6 * (q[1] - 1) > 0.8) tip++; // vor der Spitze bei (-1, 1)
    }
    log(far < 2.05 && tip > 0, `Spitze Zunge, Bodenrundung R2: max. Abstand zur Wand ${far.toFixed(2)} mm (Soll ≤ 2), Rundung um die Spitze: ${tip} Punkte`);
  }
  // Außenkante allein verrundet, endet an einer stumpfen Ecke (103°), deren Nachbarkante scharf bleibt: Die
  // Rundung läuft bis in die Nachbarwand durch, an der Ecke bleibt kein spitzer Zipfel stehen
  {
    const pent = K.extrude([{ outer: [[0, 0], [30, -25], [50, -10], [50, 50], [0, 50]], holes: [] }], S.BASE_PLANES.xy, 55);
    const e = edgeChains(pent).filter(ch => ch.pts.every(p => p[2] > 54.99 && Math.abs((p[0] - 30) * 0.6 - (p[1] + 25) * 0.8) < 1e-3));
    const r = K.blend(pent, e.map(ch => buildEdgeTool(pent, ch, 'fillet', 2, e)));
    let tip = Infinity;
    for (let i = 0; i < r.v.length; i += 3) tip = Math.min(tip, Math.hypot(r.v[i] - 30, r.v[i + 1] + 25, r.v[i + 2] - 55));
    log(e.length === 1 && tip > 0.5, `Rundung an stumpfer Ecke ohne Nachbarrundung: Ecke ${tip.toFixed(2)} mm abgetragen (Soll > 0,5)`);
  }
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

  // Kette um eine vorhandene 2-mm-Rundung herum mit gleichem Radius 2 mm (Grenzfall: Kugelecke)
  {
    const c0 = K.primitive('box', { l: 50, b: 50, h: 50 }), sideTop = edgeChains(c0).find(ch => !ch.closed && ch.pts.every(p => p[0] > 24.9 && p[2] > 49.9));
    const c1 = K.blend(c0, [Object.assign(buildEdgeTool(c0, sideTop, 'fillet', 2), { tag: 1 })]);
    const front = edgeChains(c1).find(ch => !ch.closed && ch.pts.every(p => p[1] < -24.9 && p[2] > 49.9));
    let ok = false, msg = '';
    try {
      const chains = joinChains(c1, tangentChains(c1, [front]));
      const c2 = K.blend(c1, chains.map(ch => Object.assign(buildEdgeTool(c1, ch, 'fillet', 2, chains), { tag: 2 })));
      const dv = K.props(c1).volume - K.props(c2).volume;
      ok = chains.length === 1 && dv > 80 && dv < 110; msg = `${chains[0].segs.length} Segmente, ΔV ${dv.toFixed(1)}`;
    } catch (e) { msg = e.message; }
    log(ok, 'Rundung R2 um vorhandene R2-Ecke herum: ' + msg);
  }

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
  log(st.op?.type === 'bool' && !!st.op.ready(), 'Abziehen-Vorgang mit Vorschau aus der Mehrfachauswahl');
  applyOp();
  const vb = K.props(doc.bodies[n0].mesh).volume, wantB = 75000 - Math.PI * 400 * 30;
  log(doc.bodies.length === n0 + 1 && Math.abs(vb - wantB) < 120, `Abziehen: V ${vb.toFixed(0)} (Soll ~${wantB.toFixed(0)})`);

  // Datei speichern/öffnen und STL
  const before = doc.bodies.map(b => K.props(b.mesh).volume.toFixed(1)).join(), featsBefore = doc.bodies.map(b => b.features?.length || 0).join();
  const stl = exportSTL(doc.bodies), tris = doc.bodies.reduce((a, b) => a + b.mesh.t.length / 3, 0);
  log(stl.byteLength === 84 + 50 * tris, 'STL: ' + tris + ' Dreiecke, ' + stl.byteLength + ' Bytes');
  fromFile(toFile());
  const after = doc.bodies.map(b => K.props(b.mesh).volume.toFixed(1)).join();
  log(before === after && doc.sketches.length === 2, 'Projektdatei-Rundlauf: ' + after);
  // Druckprüfung: Überhang, dünne Wand, enger Spalt, beste Lage
  {
    const at = (m, x, y, z) => K.transform(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
    const cube = K.primitive('box', { l: 20, b: 20, h: 10 }), c0 = checkPrint(cube);
    const T = K.boolean('union', K.primitive('box', { l: 10, b: 10, h: 20 }), at(K.primitive('box', { l: 30, b: 10, h: 2 }), 0, 0, 20)), cT = checkPrint(T);
    const wall = checkPrint(K.primitive('box', { l: 20, b: 0.5, h: 10 }));
    const slot = checkPrint(K.boolean('union', at(K.primitive('box', { l: 20, b: 5, h: 10 }), 0, -2.75, 0), at(K.primitive('box', { l: 20, b: 5, h: 10 }), 0, 2.75, 0)));
    const o = bestOrientation(T);
    log(c0.over === 0 && !c0.thin && !c0.gap && Math.abs(c0.bed - 400) < 0.01 && Math.abs(cT.over - 200) < 0.5 && !cT.thin && wall.thin > 0 && slot.gap > 0 && !slot.thin && o.best.down[2] > 0.99 && o.best.over < 1,
      `Druckprüfung: Würfel ${c0.over}/${c0.thin}/${c0.gap}, Auflage ${c0.bed.toFixed(0)} mm²; T-Stück Überhang ${cT.over.toFixed(1)} mm² (Soll 200), beste Lage ${JSON.stringify(o.best.down)} mit ${o.best.over.toFixed(1)} mm²; 0,5-mm-Wand ${wall.thin} dünn; 0,5-mm-Spalt ${slot.gap}`);
    click('#btn-check');
    const shown = !document.getElementById('check').hidden && [...vp.scene.children].some(g => g.children?.some(x => x.children?.some(m => m.material?.vertexColors)));
    click('#btn-check');
    log(shown && document.getElementById('check').hidden, 'Druckprüfung ein/aus: Leiste und Markierung ' + (shown ? 'sichtbar' : 'fehlen'));
  }
  // Druckkanten: Würfel wählen → unten Fase 0,6, oben Rundung 1 an je vier Kanten, ein Schritt, ohne Überhang
  {
    const box = K.primitive('box', { l: 20, b: 20, h: 10 }), id = 9001;
    doc.bodies.push({ id, name: 'Druckwürfel', color: '#a9b4c4', visible: true, mesh: box });
    window.form3d.sync();
    sel.bodies = [id]; window.form3d.sync();
    [...document.querySelectorAll('#bar .btn')].find(b => b.title === 'Druckkanten')?.click();
    const op = st.op?.print ? { b: st.op.bottom, t: st.op.top } : null;
    applyOp();
    const nb = doc.bodies.find(b => b.id === id), dv = 4000 - K.props(nb.mesh).volume, c = checkPrint(nb.mesh);
    const kinds = (nb.features || []).map(f => f.kind).sort().join();
    log(op?.b === 0.6 && op?.t === 1 && dv > 25 && dv < 33 && c.over < 0.01 && kinds === 'chamfer,chamfer,chamfer,chamfer,fillet,fillet,fillet,fillet',
      `Druckkanten: ${JSON.stringify(op)}, −${dv.toFixed(1)} mm³ (Soll ~31), Überhang ${c.over.toFixed(2)} mm², ${kinds}`);
    doc.bodies = doc.bodies.filter(b => b.id !== id); window.form3d.sync();
  }
  // Löschen direkt in der Leiste: Körper beim Bewegen, Skizze beim Extrudieren einer Skizzenfläche
  {
    const btn = t => [...document.querySelectorAll('#bar .btn')].find(b => b.title === t);
    const id = 9002;
    doc.bodies.push({ id, name: 'Löschwürfel', color: '#a9b4c4', visible: true, mesh: K.primitive('box', { l: 10, b: 10, h: 10 }) });
    sel.bodies = [id]; window.form3d.sync();
    btn('Bewegen')?.click();
    const moving = !!st.xf;
    btn('Löschen')?.click();
    const bodyGone = !doc.bodies.some(b => b.id === id) && !st.xf;
    const sid = 9003, rect = [[0, 0], [10, 0], [10, 10], [0, 10]];
    doc.sketches.push({ id: sid, name: 'Löschskizze', plane: S.BASE_PLANES.xy, visible: true, parent: null, constraints: [],
      entities: rect.map((a, i) => ({ type: 'line', a, b: rect[(i + 1) % 4], id: sid * 10 + i })) });
    sel.regions = [{ sketchId: sid, idx: 0 }];
    st.op = window.form3d.makeExtrude({ title: 'Extrudieren', regions: [{ outer: rect, holes: [] }], plane: S.BASE_PLANES.xy, parentId: null, sketchId: sid, origin: [5, 5, 0] });
    window.form3d.refresh();
    btn('Skizze löschen')?.click();
    const sketchGone = !doc.sketches.some(s => s.id === sid) && !st.op;
    log(moving && bodyGone && sketchGone, `Löschen in der Leiste: Körper beim Bewegen ${bodyGone ? 'gelöscht' : 'bleibt'}, Skizze aus Flächenauswahl ${sketchGone ? 'gelöscht' : 'bleibt'}`);
  }
  // Passungen: Spiel 0,3 mm je Seite – Loch (Abzug) größer, Zapfen kleiner; Ecken bleiben spitz
  {
    const sq = [{ outer: [[-5, -5], [5, -5], [5, 5], [-5, 5]], holes: [] }];
    const vHole = K.props(K.extrude(sq, S.BASE_PLANES.xy, 5, 0, 0.3)).volume, vPin = K.props(K.extrude(sq, S.BASE_PLANES.xy, 5, 0, -0.3)).volume;
    const mk = mode => window.form3d.makeExtrude({ regions: sq, plane: S.BASE_PLANES.xy, dist: 5, mode, fit: 'loose', parentId: null });
    const vCut = K.props(mk('cut').build()).volume, vNew = K.props(mk('new').build()).volume;
    log(Math.abs(vHole - 10.6 * 10.6 * 5) < 0.01 && Math.abs(vPin - 9.4 * 9.4 * 5) < 0.01 && vCut > 112 * 5 && Math.abs(vNew - vPin) < 0.01,
      `Passung Spiel: Loch ${(vHole / 5).toFixed(2)} mm² (Soll 112,36), Zapfen ${(vPin / 5).toFixed(2)} mm² (Soll 88,36), Abzug größer / Neu kleiner`);
  }
  // Druckteile: Geometrie gültig und plausibel; per Tipp auf die Deckfläche eines Würfels platziert
  {
    const vol = m => (m ? K.props(m).volume : NaN), PI = Math.PI;
    const csk = vol(Parts.screwHole('M3', 'csk', 10)), thr = vol(Parts.thread('M6', 0, 10, false)), nut = vol(Parts.nutTrap('M3', 10));
    const geomOk = csk > PI * 1.7 ** 2 * 10 && csk < PI * 3.45 ** 2 * 10 && thr > PI * 2.2 ** 2 * 10 && thr < PI * 2.85 ** 2 * 10 && nut > PI * 1.7 ** 2 * 10;
    const id = 9002, cube = K.primitive('box', { l: 30, b: 30, h: 20 });
    const res = {};
    for (const [tool, variant] of [['screw', 'csk'], ['nut', null], ['thread', 'inner'], ['thread', 'bolt']]) {
      doc.bodies = doc.bodies.filter(b => b.id !== id);
      doc.bodies.push({ id, name: 'Teilwürfel', color: '#a9b4c4', visible: true, mesh: cube });
      Object.assign(vp.view, { theta: -PI / 2, phi: 0.001, dist: 120 }); vp.view.target.set(0, 0, 20); vp.render();
      railPick(tool);
      if (variant) st.op.variant = variant;
      await wait(450);
      tap(...scr(0, 0, 20));
      const placed = st.op?.place?.p.map(x => +x.toFixed(2)).join();
      applyOp();
      const b = doc.bodies.find(x => x.id === id);
      res[tool + (variant ? '/' + variant : '')] = [placed, +(K.props(b.mesh).volume - 18000).toFixed(1), b.mesh === cube];
    }
    railPick('select');
    doc.bodies = doc.bodies.filter(b => b.id !== id); window.form3d.sync();
    const r = Object.values(res), on = r.every(x => x[0] === '0,0,20' && !x[2]);
    log(geomOk && on && res['screw/csk'][1] < -90 && res.nut[1] < -90 && res['thread/inner'][1] < -150 && res['thread/bolt'][1] > 150,
      `Druckteile: Senkloch M3 ${csk.toFixed(0)} mm³, Gewinde M6 ${thr.toFixed(0)} mm³, Mutternfalle ${nut.toFixed(0)} mm³; auf Würfel ${JSON.stringify(res)}`);
  }
  // Loch in schräger Fläche verrunden: Rand der Rundung auf der facettierten Lochwand ohne Zacken
  {
    const res = [];
    for (const [deg, r] of [[30, 2], [50, 3]]) {
      const a = deg * Math.PI / 180, rotX = m => K.transform(m, [1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 25, 1]);
      let m = K.boolean('subtract', K.primitive('box', { l: 60, b: 60, h: 40 }), rotX(K.primitive('box', { l: 200, b: 200, h: 100 })));
      m = K.boolean('subtract', m, K.transform(K.primitive('cyl', { d: 20, h: 100 }), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -10, 1]));
      const all = edgeChains(m), top = all.filter(c => c.closed).sort((p, q) => q.pts.reduce((s, x) => s + x[2], 0) / q.pts.length - p.pts.reduce((s, x) => s + x[2], 0) / p.pts.length)[0];
      const bf = K.blendFeatures(m, [Object.assign(buildEdgeTool(m, top, 'fillet', r), { tag: 1, kind: 'fillet', size: r })]);
      const back = K.unblend(bf.mesh, bf.features, []);
      res.push([deg, all.length, edgeChains(bf.mesh).length, edgeChains(back).length]);
    }
    { // wie in einer Fehlermeldung: 45°-Keil 10 × 8 × 10, Loch ⌀4,5 senkrecht von unten, Rundung R1
      let m = K.extrude([{ outer: [[0, 0], [10, 0], [10, 10]], holes: [] }], { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], n: [0, -1, 0] }, 8);
      m = K.boolean('subtract', m, K.transform(K.primitive('cyl', { d: 4.5, h: 30 }), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, -4, -5, 1]));
      const all = edgeChains(m), top = all.filter(c => c.closed && c.pts.some(p => p[2] > 1))[0];
      const bf = K.blendFeatures(m, [Object.assign(buildEdgeTool(m, top, 'fillet', 1), { tag: 1, kind: 'fillet', size: 1 })]);
      res.push(['Keil 45', all.length, edgeChains(bf.mesh).length, edgeChains(K.unblend(bf.mesh, bf.features, [])).length]);
    }
    log(res.every(([, n0, n1, n2]) => n1 <= n0 && n2 === n0), `Loch in schräger Fläche verrundet und wieder gelöscht: Kanten vorher/verrundet/gelöscht ${res.map(x => x[0] + '°: ' + x.slice(1).join('/')).join(', ')} (Zacken oder Splitter ergäben zusätzliche Kanten)`);
  }
  // Zwei Rundungen, die sich berühren (obere und untere Lochkante im 45°-Keil): unabhängig von der Reihenfolge,
  // und Löschen einer davon ergibt genau den Körper, als hätte es sie nie gegeben
  {
    const vol = m => (m ? K.props(m).volume : 0), sd = (a, b) => vol(K.boolean('subtract', a, b)) + vol(K.boolean('subtract', b, a));
    let m = K.extrude([{ outer: [[0, 0], [10, 0], [10, 10]], holes: [] }], { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], n: [0, -1, 0] }, 8);
    m = K.boolean('subtract', m, K.transform(K.primitive('cyl', { d: 4.5, h: 30 }), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, -4, -5, 1]));
    const edge = (mesh, top) => edgeChains(mesh).filter(c => c.closed).sort((p, q) => (top ? -1 : 1) * (p.pts.reduce((s, x) => s + x[2], 0) / p.pts.length - q.pts.reduce((s, x) => s + x[2], 0) / q.pts.length))[0];
    const fil = (r, top, tag) => { const x = K.blendFeatures(r.mesh, [Object.assign(buildEdgeTool(r.mesh, edge(r.mesh, top), 'fillet', 1), { tag, kind: 'fillet', size: 1 })]); return { mesh: x.mesh, feats: [...r.feats, ...x.features] }; };
    const p0 = { mesh: m, feats: [] }, onlyTop = fil(p0, true, 1), onlyBot = fil(p0, false, 1);
    const tb = fil(onlyTop, false, 2), bt = fil(onlyBot, true, 2);
    const del = (r, i) => K.unblend(r.mesh, [r.feats[i]], r.feats.filter((_, k) => k !== i));
    const devs = [sd(tb.mesh, bt.mesh), sd(del(tb, 0), onlyBot.mesh), sd(del(tb, 1), onlyTop.mesh), sd(del(bt, 0), onlyTop.mesh), sd(del(bt, 1), onlyBot.mesh)];
    const extra = [del(tb, 0), del(bt, 1)].map(x => edgeChains(x).length - edgeChains(onlyBot.mesh).length);
    // weicher Übergang: an der Schnittkante wird Material abgetragen, Löschen einer Rundung nimmt ihn mit
    const all = [...tb.feats], ts = transitionTools(tb.mesh, all, [2], 3), tr = ts.length ? K.blendFeatures(tb.mesh, ts) : null;
    const soft = tr && { mesh: tr.mesh, feats: [...all, ...tr.features] }, dl = (r, tag) => K.unblend(r.mesh, r.feats.filter(f => f.tag === tag || f.links?.includes(tag)), r.feats.filter(f => !(f.tag === tag || f.links?.includes(tag))));
    const cut = soft ? vol(tb.mesh) - vol(soft.mesh) : 0, sdel = soft ? [sd(dl(soft, 1), onlyBot.mesh), sd(dl(soft, 2), onlyTop.mesh), sd(dl(soft, 3), tb.mesh)] : [];
    log(soft && cut > 1e-3 && sdel.every(d => d < 1e-3) && creaseChains(soft.mesh, t => t === 3).every(c => c.tags.includes(3) || c.segs.length < 20),
      `Übergang zwischen den Rundungen: ${ts.length} Werkzeug, abgetragen ${cut.toFixed(4)} mm³, nach Löschen oben/unten/Übergang Abweichung ${sdel.map(d => d.toFixed(4)).join(', ')}`);
    log(devs.every(d => d < 1e-3) && extra.every(e => e === 0), `Zwei sich berührende Rundungen: Abweichungen ${devs.map(d => d.toFixed(4)).join(', ')} mm³ (Reihenfolge, Löschen), zusätzliche Kanten ${extra}`);
  }
  // Kombinieren über die Leiste: Ziel, dann Werkzeug antippen; Abziehen, Tauschen + Schnitt, Vereinigen mit
  // verrundeten Körpern (Kennungen bleiben eindeutig, Rundung lässt sich danach noch auswählen)
  {
    const PI = Math.PI, A = 9101, B = 9102, at = (m, x) => K.transform(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]);
    const vol = id => K.props(doc.bodies.find(b => b.id === id).mesh).volume;
    const put = (a, b) => {
      doc.bodies = doc.bodies.filter(x => x.id !== A && x.id !== B).map(x => ({ ...x, visible: false }));
      doc.bodies.push({ id: A, name: 'A', color: '#a9b4c4', visible: true, ...a }, { id: B, name: 'B', color: '#a9b4c4', visible: true, ...b });
      window.form3d.sync();
      Object.assign(vp.view, { theta: -PI / 2, phi: 0.001, dist: 160 }); vp.view.target.set(0, 0, 20); vp.render();
    };
    const shown = doc.bodies.map(b => b.visible), box = K.primitive('box', { l: 30, b: 30, h: 20 }), cyl = at(K.primitive('cyl', { d: 10, h: 30 }), 10);
    put({ mesh: box }, { mesh: cyl });
    railPick('subtract');
    await wait(300);
    tap(...scr(-10, 0, 20)); tap(...scr(10, 0, 30));
    const roles = st.op?.target === A && st.op.tools.join() === String(B);
    if (stopAt === 'bool') { document.getElementById('help').hidden = true; Object.assign(vp.view, { theta: -PI / 3, phi: 1, dist: 110 }); window.form3d.refresh(); out.remove(); throw 0; }
    applyOp();
    const vSub = vol(A), goneB = !doc.bodies.some(b => b.id === B);
    put({ mesh: box }, { mesh: cyl });
    railPick('select'); railPick('intersect');
    tap(...scr(10, 0, 30)); tap(...scr(-10, 0, 20));
    const swapped = st.op.target === B;
    st.op.keep = true;
    applyOp();
    const vInt = vol(B), keptA = doc.bodies.find(b => b.id === A)?.visible === false;
    const fil = m => K.blendFeatures(m, edgeChains(m).filter(ch => ch.pts.every(p => p[2] > 19.9)).slice(0, 1).map(ch => Object.assign(buildEdgeTool(m, ch, 'fillet', 2), { tag: 1, kind: 'fillet', size: 2 })));
    const fa = fil(box), fb = fil(at(box, 40));
    put({ mesh: fa.mesh, features: fa.features }, { mesh: fb.mesh, features: fb.features });
    railPick('select'); railPick('union');
    tap(...scr(0, 0, 20)); tap(...scr(40, 0, 20));
    applyOp();
    const u = doc.bodies.find(b => b.id === A), tags = u.features.map(f => f.tag), meshTags = new Set(Array.from(u.mesh.f || [], x => Math.floor(x / 2 ** 20)).filter(Boolean));
    railPick('select');
    doc.bodies = doc.bodies.filter(b => b.id !== A && b.id !== B).map((b, i) => ({ ...b, visible: shown[i] })); window.form3d.sync();
    log(roles && goneB && Math.abs(vSub - (18000 - PI * 25 * 20)) < 30 && swapped && keptA && Math.abs(vInt - PI * 25 * 20) < 30
      && tags.join() === '1,2' && meshTags.size === 2,
      `Kombinieren: Abziehen ${vSub.toFixed(0)} (Soll ~16429), Schnitt ${vInt.toFixed(0)} (Soll ~1571, Ziel getauscht ${swapped}, behalten+ausgeblendet ${keptA}), Vereinigen Rundungen ${tags} / im Netz ${[...meshTags]}`);
  }
  // Schraubenlöcher: Kernloch d − P, Länge ab Kopfunterkante (Zylinderkopf) bzw. mit Kopf (Senkkopf), auch wenn der Kopf höher als die Länge ist
  {
    const PI = Math.PI, vol = m => K.props(m).volume, box = m => { const v = m.v; let lo = Infinity, hi = -Infinity; for (let i = 2; i < v.length; i += 3) { lo = Math.min(lo, v[i]); hi = Math.max(hi, v[i]); } return [lo, hi]; };
    const core = vol(Parts.screwHole('M3', 'none', 10, 'core')), coreSoll = PI * 1.25 ** 2 * (10 + Parts.TIP + 0.05);
    const cap = Parts.screwHole('M12', 'cap', 6, 'clear'), capEnd = box(cap)[1], capSoll = 12.2 + 6 + Parts.TIP;
    const csk = box(Parts.screwHole('M3', 'csk', 12, 'core'))[1];
    log(Math.abs(core - coreSoll) / coreSoll < 0.01 && Math.abs(capEnd - capSoll) < 1e-3 && vol(cap) > PI * 9.2 ** 2 * 12 && Math.abs(csk - 12.5) < 1e-3,
      `Schraubenloch: Kernloch M3 ⌀${Parts.coreHole('M3')} ${core.toFixed(1)} mm³ (Soll ${coreSoll.toFixed(1)}), Zylinderkopf M12 × 6 bis ${capEnd.toFixed(2)} mm (Soll ${capSoll.toFixed(2)}), Senkkopf M3 × 12 bis ${csk.toFixed(2)} mm`);
  }
  // 3MF: ZIP-Verzeichnis lesen, Prüfsumme und Modell (Punkte/Dreiecke je Körper) wie ein Slicer prüfen
  {
    const z = export3MF(doc.bodies), dv = new DataView(z.buffer), dec = new TextDecoder(), files = {};
    const eocd = z.length - 22, n = dv.getUint16(eocd + 10, true);
    for (let i = 0, c = dv.getUint32(eocd + 16, true); i < n; i++) {
      const len = dv.getUint32(c + 20, true), nl = dv.getUint16(c + 28, true), lo = dv.getUint32(c + 42, true);
      const name = dec.decode(z.subarray(c + 46, c + 46 + nl)), start = lo + 30 + dv.getUint16(lo + 26, true);
      files[name] = { data: z.subarray(start, start + len), crc: dv.getUint32(c + 16, true) };
      c += 46 + nl;
    }
    const crcOk = Object.values(files).every(f => { let c = ~0; for (const b of f.data) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (~c >>> 0) === f.crc; });
    const xml = new DOMParser().parseFromString(dec.decode(files['3D/3dmodel.model']?.data || new Uint8Array()), 'application/xml');
    const objs = [...xml.getElementsByTagName('object')];
    const counts = objs.map(o => [o.getElementsByTagName('vertex').length, o.getElementsByTagName('triangle').length]);
    const ok = crcOk && files['[Content_Types].xml'] && files['_rels/.rels'] && !xml.getElementsByTagName('parsererror').length
      && xml.documentElement.getAttribute('unit') === 'millimeter' && objs.length === doc.bodies.length
      && counts.every(([nv, nt], i) => nv === doc.bodies[i].mesh.v.length / 3 && nt === doc.bodies[i].mesh.t.length / 3);
    log(ok, `3MF: ${Object.keys(files).length} Dateien, Prüfsummen ${crcOk ? 'ok' : 'falsch'}, ${objs.length} Körper ${JSON.stringify(counts)}`);
  }
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

  // Zwei-Finger-Modus (Handy): 1 Finger zeichnet, 2 Finger verschieben/zoomen, 3 Finger drehen
  vp.twoFinger = true;
  const nLines = tri.entities.length, T2 = id => ({ pt: 'touch', id });
  dragTo(...scr(-140, 60, 0), ...scr(-100, 60, 0), T);
  log(tri.entities.length === nLines + 1, 'Zwei-Finger-Modus: 1 Finger zieht Linie (' + tri.entities.length + ' Linien)');
  const v0 = { ...vp.view, target: vp.view.target.clone() };
  fire('pointerdown', 300, 300, T2(901)); fire('pointerdown', 400, 300, T2(902));
  for (let i = 1; i <= 5; i++) { fire('pointermove', 300 + 12 * i, 300, T2(901)); fire('pointermove', 400 + 12 * i, 300, T2(902)); }
  const dTheta = vp.view.theta - v0.theta, moved = vp.view.target.distanceTo(v0.target);
  for (let i = 1; i <= 5; i++) { fire('pointermove', 360 - 10 * i, 300, T2(901)); fire('pointermove', 460 + 10 * i, 300, T2(902)); }
  fire('pointerup', 310, 300, T2(901)); fire('pointerup', 510, 300, T2(902));
  log(tri.entities.length === nLines + 1 && dTheta === 0 && moved > 1 && vp.view.dist < v0.dist * 0.7, `2 Finger: verschoben um ${moved.toFixed(1)} mm, gedreht ${dTheta.toFixed(2)}, Zoom ${(v0.dist / vp.view.dist).toFixed(2)}x, nichts gezeichnet`);
  const t0 = vp.view.target.clone(), th0 = vp.view.theta;
  [911, 912, 913].forEach((id, k) => fire('pointerdown', 300 + 40 * k, 300, T2(id)));
  for (let i = 1; i <= 5; i++) [911, 912, 913].forEach((id, k) => fire('pointermove', 300 + 40 * k + 15 * i, 300, T2(id)));
  [911, 912, 913].forEach((id, k) => fire('pointerup', 375 + 40 * k, 300, T2(id)));
  log(vp.view.theta - th0 < -0.3 && tri.entities.length === nLines + 1, `3 Finger: gedreht ${(vp.view.theta - th0).toFixed(2)}, Ziel mit dem Drehpunkt mitgeführt ${vp.view.target.distanceTo(t0).toFixed(1)} mm`);
  railPick('select');
  const th1 = vp.view.theta;
  dragTo(200, 500, 320, 520, T);
  log(vp.view.theta !== th1, '1 Finger im Auswahlmodus dreht');

  // Freies Drehen: über den Pol hinweg ohne Anschlag, der angefasste Modellpunkt bleibt stehen
  {
    Object.assign(vp.view, { theta: -Math.PI / 2, phi: 0.3, dist: 300 }); vp.view.target.set(0, 0, 0); vp.render();
    const piv = vp.view.target.clone().set(30, 10, 5), s0 = piv.clone(), s1 = piv.clone();
    vp.project(piv, s0);
    vp.orbit(0, 100, piv); vp.render(); // 0,8 rad nach oben: über den Pol
    vp.project(piv, s1);
    const over = vp.view.phi < 0, still = Math.hypot(s1.x - s0.x, s1.y - s0.y) < 0.5;
    vp.orbit(0, -100, piv); vp.render();
    const back = Math.abs(vp.view.phi - 0.3) < 1e-6;
    log(over && still && back, `Freies Drehen: über den Pol ${over ? 'ja' : 'nein'} (phi ${(0.3 - 0.8).toFixed(1)}), Drehpunkt bleibt ${still ? 'stehen' : 'nicht stehen'}, zurück ${back ? 'ok' : 'falsch'}`);
  }

  // Ansichtswürfel: Fläche antippen = Ansicht von dort, Kante = dazwischen, ziehen = drehen.
  // Kamerafahrten sofort ans Ziel setzen (ohne Bildwechsel im Headless-Browser läuft keine Animation).
  {
    const cv = document.getElementById('viewcube'), cube = vp.cube, animate = vp.animateTo;
    vp.animateTo = to => { Object.assign(vp.view, { theta: to.theta ?? vp.view.theta, phi: to.phi ?? vp.view.phi }); vp.render(); };
    const cfire = (type, [x, y], id) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
    const ctap = (p, id) => { cfire('pointerdown', p, id); cfire('pointerup', p, id); };
    vp.setView('iso');
    ctap(cube.screenOf([0.05, 0, 0.5]), 960);
    const top = Math.abs(vp.view.phi) < 1e-3;
    vp.setView('iso');
    ctap(cube.screenOf([0.5, -0.5, 0]), 961);
    const edge = Math.abs(vp.view.phi - Math.PI / 2) < 1e-3 && Math.abs(vp.view.theta + Math.PI / 4) < 1e-3;
    const th2 = vp.view.theta, c0 = cube.screenOf([0, 0, 0]);
    cfire('pointerdown', c0, 962);
    for (let i = 1; i <= 5; i++) cfire('pointermove', [c0[0] + 8 * i, c0[1]], 962);
    cfire('pointerup', [c0[0] + 40, c0[1]], 962);
    const turned = Math.abs(vp.view.theta - th2) > 0.3;
    vp.animateTo = animate;
    log(top && edge && turned, `Ansichtswürfel: Oben ${top ? 'ok' : 'falsch'}, Kante vorne-rechts ${edge ? 'ok' : 'falsch'}, ziehen dreht ${turned ? 'ja' : 'nein'}`);
  }

  // Zwei Finger umeinander drehen: Modell dreht sich mit den Fingern (Drehteller), Abstand bleibt;
  // kleines Verdrehen beim Zoomen dreht nicht. Im Handy- und im Tablet-Modus.
  const twistBy = (ang, id0) => {
    const cx = vp.w / 2, cy = vp.h / 2, R = 90, at = (a, s) => [cx + s * R * Math.cos(a), cy + s * R * Math.sin(a)];
    fire('pointerdown', ...at(0, -1), T2(id0)); fire('pointerdown', ...at(0, 1), T2(id0 + 1));
    for (let i = 1; i <= 12; i++) { const a = ang * i / 12; fire('pointermove', ...at(a, -1), T2(id0)); fire('pointermove', ...at(a, 1), T2(id0 + 1)); }
    fire('pointerup', ...at(ang, -1), T2(id0)); fire('pointerup', ...at(ang, 1), T2(id0 + 1));
  };
  for (const phone of [true, false]) {
    vp.twoFinger = phone;
    Object.assign(vp.view, { theta: -Math.PI / 4, phi: 0.9, dist: 200 }); vp.view.target.set(0, 0, 0); vp.render();
    const scrAng = () => { const p = scr(40, 0, 0), o = scr(0, 0, 0); return Math.atan2(p[1] - o[1], p[0] - o[0]); };
    const a0 = scrAng(), d0 = vp.view.dist, th = vp.view.theta;
    twistBy(0.08, 920 + (phone ? 0 : 10));
    const still = vp.view.theta === th;
    twistBy(Math.PI / 3, 940 + (phone ? 0 : 10));
    let da = scrAng() - a0; da = Math.atan2(Math.sin(da), Math.cos(da));
    log(still && da > 0.4 && Math.abs(vp.view.dist - d0) < 0.05 * d0,
      `${phone ? 'Handy' : 'Tablet'}: 2 Finger 60° im Uhrzeigersinn gedreht → Modell ${(da * 180 / Math.PI).toFixed(0)}° mitgedreht, Abstand ${(vp.view.dist / d0).toFixed(2)}, kleines Verdrehen ${still ? 'ignoriert' : 'dreht!'}`);
  }
  vp.twoFinger = false;
  out.textContent += 'DONE\n';
} catch (e) {
  if (e !== 0) log(false, 'Ausnahme: ' + (e.stack || e));
}
vp.render();
