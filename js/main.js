// Form3D – Anwendungslogik: Szene, Auswahl, Werkzeuge und Operationen.
import * as THREE from 'three';
import { Viewport } from './viewport.js';
import * as K from './kernel.js';
import * as S from './sketch.js';
import { analyze, faceTriangles, faceCentroid, faceLoops, smoothSurface } from './meshview.js';
import { edgeChains, buildEdgeTool, cornerTools, joinChains, tangentChains, restoredChains } from './edges.js';
import { solveSketch, CON } from './solver.js';
import { doc, commit, undo, redo, canUndo, canRedo, newId, resetHistory, loadLocal, toFile, fromFile, onChange } from './doc.js';
import * as UI from './ui.js';
import { exportSTL, exportOBJ, export3MF, download, share } from './exporters.js';
import * as Bug from './bugrec.js';
import { checkPrint, bestOrientation, OVER, THIN, GAP, LIMITS } from './printcheck.js';

const $ = id => document.getElementById(id);
const V3 = a => new THREE.Vector3(a[0], a[1], a[2]);
const Z = new THREE.Vector3(0, 0, 1);
const COLORS = ['#a9b4c4', '#e5484d', '#f59e0b', '#30a46c', '#3b82f6', '#8b5cf6', '#f4f4f5', '#3f4753'];
const DRAW = ['line', 'rect', 'circle', 'arc'];
const isDraw = t => DRAW.includes(t);

const vp = new Viewport($('gl'), $('overlay'));
const sel = { bodies: [], face: null, regions: [], ents: [], edges: [], con: null };
const st = { tool: 'select', sketchId: null, pickPlane: false, pendingTool: null, xf: null, last: null, refs: [], check: false };
// Aktiver Vorgang. Wird ein Vorgang mit restore (Rundung/Fase bearbeiten) anders als über Fertig verlassen,
// stellt restore den vorherigen Körper wieder her.
let curOp = null;
Object.defineProperty(st, 'op', {
  enumerable: true,
  get: () => curOp,
  set(o) { const prev = curOp; curOp = o; if (prev !== o && prev?.restore) prev.restore(); },
});

const body = id => doc.bodies.find(b => b.id === id);
const sketch = id => doc.sketches.find(s => s.id === id);
const visibleSketch = id => { const s = sketch(id); return s?.visible ? s : null; };

// ---------------------------------------------------------------- Szene
const gBodies = new THREE.Group(), gRegions = new THREE.Group(), gPlanes = new THREE.Group(), gAux = new THREE.Group();
vp.scene.add(gBodies, gRegions, gPlanes, gAux);

const overlayMat = (color, opacity, extra = {}) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...extra,
});
const regMat = overlayMat(0x3b82f6, 0.13), regMatSel = overlayMat(0x2563eb, 0.45), faceMat = overlayMat(0x2563eb, 0.42);
const prevMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.5, depthWrite: false });
const prevCutMat = new THREE.MeshStandardMaterial({ color: 0xe5484d, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false });

for (const [key, color] of [['xy', 0x3b82f6], ['xz', 0x30a46c], ['yz', 0xe5484d]]) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), overlayMat(color, 0.17, { polygonOffset: false }));
  m.matrixAutoUpdate = false;
  m.matrix.fromArray(S.planeMatrix(S.BASE_PLANES[key]));
  m.userData.plane = key;
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color })));
  gPlanes.add(m);
}
gPlanes.visible = false;

function geometryOf(an) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(an.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(an.nor, 3));
  return g;
}

const views = new Map(); // bodyId → { meshRef, an, mesh, edges, group }
function dropView(bv) {
  gBodies.remove(bv.group);
  for (const o of [bv.mesh, bv.edges, bv.check]) if (o) { o.geometry.dispose(); o.material.dispose(); }
}
// Druckprüfung: betroffene Dreiecke farbig über den Körper legen
const CHECK_COLORS = [[OVER, [0.9, 0.2, 0.2]], [THIN, [0.97, 0.56, 0.1]], [GAP, [0.55, 0.3, 0.85]]];
function checkOverlay(b, bv) {
  const r = checkPrint(b.mesh), pos = [], col = [];
  r.flags.forEach((f, n) => {
    const c = CHECK_COLORS.find(([bit]) => f & bit);
    if (!c) return;
    for (let k = 0; k < 9; k++) pos.push(bv.an.pos[n * 9 + k]);
    for (let k = 0; k < 3; k++) col.push(...c[1]);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
}
function syncBodies() {
  const seen = new Set();
  for (const b of doc.bodies) {
    seen.add(b.id);
    let bv = views.get(b.id);
    if (!bv || bv.meshRef !== b.mesh) {
      if (bv) dropView(bv);
      const an = analyze(b.mesh);
      const mesh = new THREE.Mesh(geometryOf(an), new THREE.MeshStandardMaterial({
        roughness: 0.62, metalness: 0.04, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      }));
      mesh.userData.bodyId = b.id;
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.BufferAttribute(an.edges, 3));
      const edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x1f2630 }));
      const group = new THREE.Group();
      group.add(mesh, edges);
      group.matrixAutoUpdate = false;
      gBodies.add(group);
      bv = { meshRef: b.mesh, an, mesh, edges, group };
      views.set(b.id, bv);
    }
    if (st.check && !bv.check) { bv.check = checkOverlay(b, bv); bv.group.add(bv.check); }
    if (!st.check && bv.check) { bv.group.remove(bv.check); bv.check.geometry.dispose(); bv.check.material.dispose(); bv.check = null; }
    const on = sel.bodies.includes(b.id);
    bv.group.visible = b.visible;
    bv.mesh.material.color.set(b.color);
    bv.mesh.material.emissive.set(on ? 0x2563eb : 0x000000);
    bv.mesh.material.emissiveIntensity = on ? 0.4 : 0;
    bv.edges.material.color.set(on ? 0x1d4ed8 : 0x1f2630);
  }
  for (const [id, bv] of views) if (!seen.has(id)) { dropView(bv); views.delete(id); }
}
const bodyMeshes = () => doc.bodies.filter(b => b.visible).map(b => views.get(b.id)?.mesh).filter(Boolean);

const rt = new Map(); // sketchId → abgeleitete Daten
function sketchRt(s) {
  const key = JSON.stringify([s.plane, s.entities]);
  let r = rt.get(s.id);
  if (!r || r.key !== key) {
    r = {
      key,
      regions: S.computeRegions(s.entities),
      polys: s.entities.map(e => ({ id: e.id, dots: e.type === 'line', pts: S.tessellate(e).map(p => V3(S.to3D(s.plane, p))) })),
      snaps: S.snapCandidates(s.entities),
    };
    rt.set(s.id, r);
  }
  return r;
}

let regionMeshes = [];
function syncSketches() {
  for (const m of regionMeshes) m.geometry.dispose();
  gRegions.clear();
  regionMeshes = [];
  for (const s of doc.sketches) {
    if (!s.visible) continue;
    sketchRt(s).regions.forEach((reg, idx) => {
      const shape = new THREE.Shape(reg.outer.map(p => new THREE.Vector2(p[0], p[1])));
      shape.holes = reg.holes.map(hole => new THREE.Path(hole.map(p => new THREE.Vector2(p[0], p[1]))));
      const on = sel.regions.some(x => x.sketchId === s.id && x.idx === idx);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), on ? regMatSel : regMat);
      m.matrixAutoUpdate = false;
      m.matrix.fromArray(S.planeMatrix(s.plane));
      m.userData = { sketchId: s.id, idx };
      gRegions.add(m);
      regionMeshes.push(m);
    });
  }
}

let faceHL = null, preview = null;
function syncHighlights() {
  if (faceHL) { gAux.remove(faceHL); faceHL.geometry.dispose(); faceHL = null; }
  const bv = sel.face && views.get(sel.face.bodyId);
  if (!bv) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(faceTriangles(bv.an, sel.face.faces), 3));
  faceHL = new THREE.Mesh(g, faceMat);
  gAux.add(faceHL);
}
function setPreview(mesh, cut) {
  if (preview) { gAux.remove(preview); preview.geometry.dispose(); preview = null; }
  if (!mesh) return;
  preview = new THREE.Mesh(geometryOf(analyze(mesh)), cut ? prevCutMat : prevMat);
  preview.renderOrder = 5;
  gAux.add(preview);
}

// Zieh-Pfeil für Extrusion, Größe in Bildschirmpixeln
const handle = (() => {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x2563eb, depthTest: false, transparent: true });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 44, 12), mat);
  shaft.rotation.x = Math.PI / 2; shaft.position.z = 22;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(7.5, 19, 20), mat);
  cone.rotation.x = Math.PI / 2; cone.position.z = 53;
  const hit = new THREE.Mesh(new THREE.SphereGeometry(30, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.z = 42;
  shaft.renderOrder = cone.renderOrder = 999;
  g.add(shaft, cone, hit);
  g.userData.hit = hit;
  g.visible = false;
  gAux.add(g);
  return g;
})();

vp.onBeforeRender = () => {
  const o = st.op;
  handle.visible = !!(o && o.handle);
  if (!handle.visible) return;
  const n = V3(o.plane.n), p = V3(o.origin).addScaledVector(n, o.dist);
  handle.position.copy(p);
  handle.quaternion.setFromUnitVectors(Z, n);
  handle.scale.setScalar(vp.pxSize(p));
  handle.updateMatrixWorld(true);
};

function sync() {
  if (st.sketchId && !sketch(st.sketchId)) {
    st.sketchId = null;
    vp.setWorkPlane(null);
    if (isDraw(st.tool)) { st.tool = 'select'; vp.tool = selectTool; }
  }
  sel.bodies = sel.bodies.filter(body);
  if (sel.face && body(sel.face.bodyId)?.mesh !== sel.face.mesh) sel.face = null;
  sel.edges = sel.edges.filter(x => body(x.bodyId)?.mesh === x.mesh);
  if (sel.con && !visibleSketch(sel.con.sketchId)?.constraints?.some(c => c.id === sel.con.id)) sel.con = null;
  sel.regions = sel.regions.filter(r => sketch(r.sketchId)?.visible);
  sel.ents = sel.ents.filter(x => sketch(x.sketchId)?.entities.some(e => e.id === x.id));
  if (st.last && !sketch(st.last.sketchId)?.entities.some(e => e.id === st.last.ids[0])) st.last = null;
  syncBodies();
  syncSketches();
  syncHighlights();
  renderCheck();
  st.refs = st.sketchId ? refsOnPlane(sketch(st.sketchId).plane) : [];
  if (st.xf) sel.bodies.length ? resetPivot() : stopTransform();
  vp.scene.updateMatrixWorld(true);
  renderBar();
  renderPanel();
  renderTop();
  UI.setRailActive($('rail'), st.xf ? 'move' : st.op?.type === 'revolve' ? 'revolve' : st.op?.type === 'prim' || st.op?.type === 'edge' ? st.op.kind : st.pickPlane ? st.pendingTool : st.tool);
  vp.requestRender();
}
onChange(sync);

// ---------------------------------------------------------------- Dokument-Helfer
function addBody(mesh) {
  const b = { id: newId(), name: 'Körper ' + (doc.bodies.length + 1), color: COLORS[0], visible: true, mesh };
  doc.bodies.push(b);
  return b;
}
const patchBody = (id, patch) => { doc.bodies = doc.bodies.map(b => (b.id === id ? { ...b, ...patch } : b)); };
const removeBodies = ids => { doc.bodies = doc.bodies.filter(b => !ids.includes(b.id)); };

function bboxOf(mesh, box = new THREE.Box3()) {
  const p = new THREE.Vector3();
  for (let i = 0; i < mesh.v.length; i += 3) box.expandByPoint(p.set(mesh.v[i], mesh.v[i + 1], mesh.v[i + 2]));
  return box;
}
function sceneBox() {
  const box = new THREE.Box3();
  for (const b of doc.bodies) if (b.visible) bboxOf(b.mesh, box);
  for (const s of doc.sketches) if (s.visible) for (const pl of sketchRt(s).polys) for (const p of pl.pts) box.expandByPoint(p);
  return box;
}
// Bezugspunkte der Körper in einer Skizzenebene: Ecken, Kantenmitten, Kreismittelpunkte, Flächenmitten
function refsOnPlane(pl) {
  const out = [], on = q => Math.abs(S.planeDist(pl, q)) < 1e-3;
  for (const b of doc.bodies) {
    if (!b.visible) continue;
    const an = analyze(b.mesh);
    for (const c of an.corners) if (on(c)) out.push({ p: S.to2D(pl, c), kind: 'end' });
    for (const ch of edgeChains(b.mesh)) {
      if (!ch.pts.every(on)) continue;
      const pts = ch.pts.map(q => S.to2D(pl, q)), a = pts[0], z = pts[pts.length - 1];
      const len = Math.hypot(z[0] - a[0], z[1] - a[1]);
      const straight = len > 1e-6 && pts.every(q => Math.abs((q[0] - a[0]) * (z[1] - a[1]) - (q[1] - a[1]) * (z[0] - a[0])) / len < 1e-3);
      if (straight) out.push({ p: [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2], kind: 'mid' });
      else if (ch.closed) {
        const ring = pts.slice(0, -1), c = ring.reduce((s, q) => [s[0] + q[0] / ring.length, s[1] + q[1] / ring.length], [0, 0]);
        const r = ring.map(q => S.dist2(q, c));
        if (Math.max(...r) - Math.min(...r) < 0.02 * Math.max(...r)) out.push({ p: c, kind: 'center' });
      }
    }
    an.faces.forEach((f, fi) => {
      if (Math.abs(f.n[0] * pl.n[0] + f.n[1] * pl.n[1] + f.n[2] * pl.n[2]) < 0.9999 || f.tris.length < 2) return;
      const c = faceCentroid(an, fi);
      if (on(c)) out.push({ p: S.to2D(pl, c), kind: 'center' });
    });
  }
  return out;
}

// Volumenkörper je nach Modus als neuen Körper anlegen, anfügen oder abziehen
function applySolid(tool, mode, parentId, auto) {
  const parent = parentId != null ? body(parentId) : null;
  if (mode === 'add') {
    const targets = doc.bodies.filter(b => b === parent || (!auto && b.visible && K.intersects(b.mesh, tool)));
    if (targets.length) {
      let m = tool;
      for (const t of targets) m = K.boolean('union', t.mesh, m);
      patchBody(targets[0].id, { mesh: m, features: targets.flatMap(t => t.features || []) });
      removeBodies(targets.slice(1).map(t => t.id));
      return;
    }
  } else if (mode === 'cut') {
    const targets = auto && parent ? [parent] : doc.bodies.filter(b => b.visible);
    let hit = false;
    for (const t of targets) {
      if (!K.intersects(t.mesh, tool)) continue;
      hit = true;
      const m = K.boolean('subtract', t.mesh, tool);
      if (m) patchBody(t.id, { mesh: m }); else removeBodies([t.id]);
    }
    if (!hit) UI.toast('Kein Körper im Schnittbereich');
    return;
  }
  addBody(tool);
}

// ---------------------------------------------------------------- Operationen (mit Vorschau, bestätigt über „Fertig“)
// Skizzenebenen auf Körperflächen sind gerundet und weichen um Bruchteile eines µm von der Fläche ab;
// ohne Überstand bleiben beim Durchschneiden hauchdünne Häute stehen
const CUT_OVER = 1e-3;
const resolveMode = o => (o.type === 'edge' ? (o.convex ? 'cut' : 'add') : o.mode !== 'auto' ? o.mode : o.parentId != null && body(o.parentId) ? (o.type === 'extrude' && o.dist < 0 ? 'cut' : 'add') : o.type === 'extrude' ? freeMode(o) : 'new');

// Auto ohne zugehörigen Körper (Skizze auf einer Grundebene oder frei im Raum): beginnt die Extrusion
// in Material, wird ein Loch geschnitten; berührt sie einen Körper, wird angefügt; sonst neuer Körper.
// Geprüft wird eine dünne Scheibe direkt an der Skizzenebene in Zugrichtung (je Richtung gemerkt).
function freeMode(o) {
  if (Math.abs(o.dist) < 1e-6) return 'new';
  const side = o.dist < 0 ? -1 : 1, bodies = doc.bodies.filter(b => b.visible);
  o.free ||= {};
  if (!o.free[side]) {
    let inside = false;
    try {
      const slab = K.extrude(o.regions, o.plane, side * 0.5), v = K.props(slab).volume;
      inside = bodies.some(b => { const x = K.boolean('intersect', b.mesh, slab); return x && K.props(x).volume > 0.5 * v; });
    } catch (e) { console.warn(e); }
    o.free[side] = inside ? 'cut' : 'add';
  }
  if (o.free[side] === 'cut') return 'cut';
  if (o.free.dist !== o.dist) { // beim Ziehen am Pfeil nur einmal je Abstand rechnen
    const tool = K.extrude(o.regions, o.plane, o.dist, 0.01); // minimal verlängert: Skizze genau auf einer Körperfläche berührt sonst nur
    o.free.dist = o.dist;
    o.free.touch = bodies.some(b => K.intersects(b.mesh, tool));
  }
  return o.free.touch ? 'add' : 'new';
}

function makeExtrude(p) {
  return {
    type: 'extrude', mode: 'auto', dist: 0, handle: true, ...p,
    build() { return Math.abs(this.dist) < 1e-6 ? null : K.extrude(this.regions, this.plane, this.dist, resolveMode(this) === 'cut' ? CUT_OVER : 0); },
  };
}
function makeRevolve(p) {
  return {
    type: 'revolve', title: 'Rotation', mode: 'auto', axis: null, angle: 360, ...p,
    build() { return this.axis ? K.revolve(this.regions, this.plane, this.axis, this.angle) : null; },
  };
}
function makePrim(kind) {
  const defs = { box: ['Quader', { l: 50, b: 50, h: 30 }], cyl: ['Zylinder', { d: 40, h: 50 }], sphere: ['Kugel', { d: 50 }] };
  return {
    type: 'prim', kind, title: defs[kind][0], mode: 'new', vals: defs[kind][1],
    build() { return K.primitive(kind, this.vals); },
  };
}

function opFromSelection() {
  if (sel.regions.length) {
    const s = sketch(sel.regions[0].sketchId), all = sketchRt(s).regions;
    const regions = sel.regions.map(x => all[x.idx]).filter(Boolean);
    if (!regions.length) return null;
    return makeExtrude({ title: 'Extrudieren', regions, plane: s.plane, parentId: s.parent, sketchId: s.id, origin: S.to3D(s.plane, S.regionCenter(regions[0])) });
  }
  if (sel.face && sel.face.faces.length === 1) {
    const b = body(sel.face.bodyId), bv = views.get(b.id);
    const { plane, loops } = faceLoops(b.mesh, bv.an, sel.face.faceIdx);
    if (!loops.length) return null;
    return makeExtrude({ title: 'Drücken/Ziehen', face: true, regions: [{ outer: loops[0], holes: loops.slice(1) }], plane, parentId: b.id, origin: faceCentroid(bv.an, sel.face.faceIdx) });
  }
  return null;
}

function refreshOp() {
  const o = st.op;
  let mesh = null;
  if (o) { try { mesh = o.build(); } catch (e) { console.warn(e); } }
  setPreview(mesh, o && resolveMode(o) === 'cut');
  renderBar();
  vp.requestRender();
}

function applyOp() {
  const o = st.op;
  if (!o) return;
  if (o.type === 'edge') {
    try {
      const r = o.result();
      if (!r.mesh) throw new Error('leeres Ergebnis');
      patchBody(o.bodyId, { mesh: r.mesh, features: [...(body(o.bodyId).features || []), ...r.features] });
      o.restore = null;
    } catch (e) {
      console.error(e);
      return UI.toast(/Radius zu groß/.test(e.message) ? 'Radius zu groß für diese Kante – kleineren Wert versuchen' : 'Mit diesem Maß nicht möglich – kleineren Wert versuchen');
    }
    st.op = null;
    setPreview(null);
    clearSel();
    return commit();
  }
  let tool = null;
  try { tool = o.build(); } catch (e) { console.error(e); }
  if (!tool) {
    return UI.toast(o.type === 'revolve' && !o.axis ? 'Zuerst eine Achse wählen' : o.type === 'extrude' ? 'Am Pfeil ziehen oder Abstand eingeben' : 'Operation ergibt keinen Körper');
  }
  try {
    applySolid(tool, resolveMode(o), o.parentId, o.mode === 'auto' && o.parentId != null);
  } catch (e) {
    console.error(e);
    return UI.toast('Operation fehlgeschlagen');
  }
  if (o.sketchId) {
    const s = sketch(o.sketchId);
    if (s) s.visible = false;
    if (st.sketchId === o.sketchId) endSketch();
  }
  st.op = null;
  setPreview(null);
  clearSel();
  commit();
}

function cancelOp() {
  st.op = null;
  setPreview(null);
  clearSel();
  sync();
}

// ---------------------------------------------------------------- Auswahl
// Flächenauswahl: ganze glatte Fläche (Rundung, Zylinder) statt einzelner Facetten
function faceSel(bodyId, faceIdx) {
  const b = body(bodyId), an = views.get(bodyId).an, faces = smoothSurface(b.mesh, an, faceIdx);
  const tag = an.faces[faceIdx].tag, feature = tag ? b.features?.find(f => f.tag === tag) : null;
  return { bodyId, faceIdx, faces, mesh: b.mesh, feature };
}

function clearSel() { sel.bodies = []; sel.face = null; sel.regions = []; sel.ents = []; sel.edges = []; sel.con = null; }

function selectionChanged() {
  stopTransform();
  st.op = opFromSelection();
  setPreview(null);
  sync();
}

function pickEntity(e, onlySketch) {
  let best = null;
  for (const s of doc.sketches) {
    if (!s.visible || (onlySketch != null && s.id !== onlySketch)) continue;
    const p = vp.planePoint(e.x, e.y, s.plane);
    if (!p) continue;
    const tol = (e.type === 'touch' ? 14 : 8) * vp.pxSize(V3(S.to3D(s.plane, p)));
    for (const ent of s.entities) {
      const d = S.entityDistance(ent, p);
      if (d < tol && (!best || d < best.d)) best = { d, ent, sketchId: s.id };
    }
  }
  return best;
}

// Körperkante unter dem Zeiger (Bildschirmabstand), verdeckte Kanten werden übersprungen
function pickEdge(e) {
  const tol = e.type === 'touch' ? 11 : 6, r = vp.canvas.getBoundingClientRect(), x = e.x - r.left, y = e.y - r.top;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), cands = [];
  for (const bd of doc.bodies) {
    if (!bd.visible) continue;
    edgeChains(bd.mesh).forEach((ch, idx) => {
      for (let i = 0; i + 1 < ch.pts.length; i++) {
        if (!vp.project(V3(ch.pts[i]), a) || !vp.project(V3(ch.pts[i + 1]), b)) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const k = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(x - a.x - k * dx, y - a.y - k * dy);
        if (d < tol) cands.push({ d, bodyId: bd.id, idx, mesh: bd.mesh, p: V3(ch.pts[i]).lerp(V3(ch.pts[i + 1]), k) });
      }
    });
  }
  cands.sort((p, q) => p.d - q.d);
  const eye = vp.camera.position, meshes = bodyMeshes();
  for (const c of cands.slice(0, 12)) {
    const dist = c.p.distanceTo(eye);
    vp.raycaster.set(eye, c.p.clone().sub(eye).normalize());
    const hit = vp.raycaster.intersectObjects(meshes, false)[0];
    if (!hit || hit.distance > dist - Math.max(0.05, dist * 0.003)) return { bodyId: c.bodyId, idx: c.idx, mesh: c.mesh };
  }
  return null;
}

function pickSurface(e) {
  const rc = vp.ray(e.x, e.y);
  const hb = rc.intersectObjects(bodyMeshes(), false)[0];
  const hr = rc.intersectObjects(regionMeshes, false)[0];
  if (hr && (!hb || hr.distance <= hb.distance * 1.001 + 1e-3)) return { type: 'region', ...hr.object.userData };
  if (hb) {
    const bodyId = hb.object.userData.bodyId;
    return { type: 'face', bodyId, faceIdx: views.get(bodyId).an.triFace[hb.faceIndex] };
  }
  return null;
}

function pick(e, dbl) {
  const o = st.op;
  if (o?.type === 'revolve') {
    const hit = pickEntity(e, o.sketchId);
    if (hit?.ent.type === 'line') {
      o.axis = { p: hit.ent.a, d: [hit.ent.b[0] - hit.ent.a[0], hit.ent.b[1] - hit.ent.a[1]] };
      refreshOp();
    } else UI.toast('Als Achse eine Linie der Skizze antippen');
    return;
  }
  if (o?.type === 'prim') return;
  const badge = badgeAt(e);
  if (badge) { clearSel(); sel.con = badge; return selectionChanged(); }
  const ent = pickEntity(e), edge = ent || dbl ? null : pickEdge(e), hit = ent || edge ? null : pickSurface(e);
  if (ent) {
    const i = sel.ents.filter(x => x.sketchId === ent.sketchId).findIndex(x => x.id === ent.ent.id);
    const ents = sel.ents.filter(x => x.sketchId === ent.sketchId);
    clearSel();
    sel.ents = ents;
    if (i >= 0) sel.ents.splice(i, 1); else sel.ents.push({ sketchId: ent.sketchId, id: ent.ent.id });
  } else if (edge) {
    const edges = sel.edges.filter(x => x.bodyId === edge.bodyId), i = edges.findIndex(x => x.idx === edge.idx);
    clearSel();
    if (i >= 0) edges.splice(i, 1); else edges.push(edge);
    sel.edges = edges;
  } else if (!hit) clearSel();
  else if (hit.type === 'region') {
    const regs = sel.regions.filter(r => r.sketchId === hit.sketchId);
    clearSel();
    const i = regs.findIndex(r => r.idx === hit.idx);
    if (i >= 0) regs.splice(i, 1); else regs.push({ sketchId: hit.sketchId, idx: hit.idx });
    sel.regions = regs;
  } else {
    const sameFace = sel.face && sel.face.bodyId === hit.bodyId && sel.face.faces.includes(hit.faceIdx);
    if (sel.bodies.length || sameFace || dbl) {
      const bodies = sel.bodies.slice(), i = bodies.indexOf(hit.bodyId);
      clearSel();
      if (i < 0) bodies.push(hit.bodyId); else if (!sameFace && !dbl) bodies.splice(i, 1);
      sel.bodies = bodies;
      // Körper per Doppeltipp (oder zweitem Tipp auf die gewählte Fläche) gewählt: gleich bewegen
      if (sameFace || dbl) { selectionChanged(); return startTransform(); }
    } else {
      clearSel();
      sel.face = faceSel(hit.bodyId, hit.faceIdx);
    }
  }
  selectionChanged();
}

function deleteSelection() {
  if (sel.face?.feature) return deleteFeature(sel.face.bodyId, sel.face.feature.tag);
  if (sel.con) {
    const s = sketch(sel.con.sketchId);
    s.constraints = s.constraints.filter(c => c.id !== sel.con.id);
  } else if (sel.ents.length) {
    for (const s of doc.sketches) {
      s.entities = s.entities.filter(e => !sel.ents.some(x => x.sketchId === s.id && x.id === e.id));
      const has = id => id == null || s.entities.some(e => e.id === id);
      s.constraints = (s.constraints || []).filter(c => has(c.a) && has(c.b));
    }
  } else if (sel.bodies.length) removeBodies(sel.bodies);
  else return;
  stopTransform();
  clearSel();
  commit();
}

// Rundung/Fase löschen: Kante wird wieder scharf. Kugelecken, die an der Rundung hängen, gehen mit.
function unblendTag(b, tag) {
  const del = (b.features || []).filter(f => f.tag === tag || f.links?.includes(tag));
  try { return { del, ...K.unblendFeatures(b.mesh, del, b.features.filter(f => !del.includes(f))) }; } catch (e) { console.error(e); }
  return { del };
}
function deleteFeature(bodyId, tag) {
  const { mesh: m, keep } = unblendTag(body(bodyId), tag);
  if (!m) return UI.toast('Löschen nicht möglich');
  patchBody(bodyId, { mesh: m, features: keep });
  st.op = null;
  setPreview(null);
  clearSel();
  commit();
}

// Rundung/Fase bearbeiten: wie Löschen, dann die wieder scharfen Kanten mit Art und Maß der Rundung neu
// verrunden. Erst Fertig übernimmt das; Abbrechen (oder jedes andere Verlassen) stellt den Körper wieder her.
function editFeature(bodyId, tag) {
  const b = body(bodyId), f = b.features.find(x => x.tag === tag), { del, mesh: m, keep } = unblendTag(b, tag);
  if (!m) return UI.toast('Bearbeiten nicht möglich');
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const x of del) for (const g of [x.tool, x.region]) if (g) for (let i = 0; i < g.v.length; i++) {
    box.min[i % 3] = Math.min(box.min[i % 3], g.v[i] - 0.05);
    box.max[i % 3] = Math.max(box.max[i % 3], g.v[i] + 0.05);
  }
  const idx = restoredChains(m, b.mesh, box);
  if (!idx.length) return UI.toast('Bearbeiten nicht möglich – Rundung löschen und neu anlegen');
  stopTransform();
  st.op = null;
  setPreview(null);
  patchBody(bodyId, { mesh: m, features: keep });
  clearSel();
  sel.edges = idx.map(i => ({ bodyId, idx: i, mesh: m }));
  startEdgeOp(f.kind === 'chamfer' ? 'chamfer' : 'fillet', {
    size: f.size || 2,
    restore() { if (body(bodyId)) { doc.bodies = doc.bodies.map(x => (x.id === bodyId ? b : x)); clearSel(); } },
  });
}

// ---------------------------------------------------------------- Auswahl-Werkzeug (inkl. Zieh-Pfeil)
const gridStep = px => [0.1, 0.5, 1, 5, 10, 50, 100].find(s => s >= px * 9) ?? 100;
vp.gridStep = gridStep;
vp.onGrid = step => { $('gridchip').innerHTML = `Raster <b>${UI.fmt(step)} mm</b>`; };

// Parameter des Punktes auf der Achse (origin + s·n), der dem Zeigerstrahl am nächsten liegt
function axisParam(e, origin, n) {
  const { origin: o, direction: d } = vp.ray(e.x, e.y).ray;
  const w = origin.clone().sub(o), dn = d.dot(n), den = 1 - dn * dn;
  return den < 1e-6 ? null : (dn * d.dot(w) - n.dot(w)) / den;
}

// Skizzenpunkt (bevorzugt) oder Linie/Kreis unter dem Zeiger, der sich ziehen lässt
function sketchGrab(e) {
  let best = null;
  for (const s of doc.sketches) {
    if (!s.visible) continue;
    const p = vp.planePoint(e.x, e.y, s.plane);
    if (!p) continue;
    const tol = (e.type === 'touch' ? 16 : 9) * vp.pxSize(V3(S.to3D(s.plane, p)));
    for (const ent of s.entities) {
      for (const [key, q] of S.entityPoints(ent)) {
        const d = S.dist2(p, q);
        if (d < tol && (!best || !best.key || d < best.d)) best = { d, s, id: ent.id, key, p, q };
      }
      if (!best && ent.type !== 'arc' && S.entityDistance(ent, p) < tol * 0.7) best = { d: 0, s, id: ent.id, key: null, p };
    }
  }
  if (!best) return null;
  // nicht am eigenen Element oder an mitbewegten Nachbarn fangen
  const skip = new Set([best.id]);
  if (best.key) for (const ent of best.s.entities) if (S.entityPoints(ent).some(([, q]) => S.same2(q, best.q))) skip.add(ent.id);
  return { ...best, skip, x: e.x, y: e.y, moved: false, orig: structuredClone(best.s.entities) };
}

function dragSketch(g, e) {
  const sn = snap(e, g.s, g.skip), ent = g.orig.find(x => x.id === g.id), opt = {};
  if (!sn) return;
  if (g.key) opt.drags = [{ id: g.id, key: g.key, target: sn.p }];
  else if (ent.type === 'circle') opt.radius = { id: g.id, value: Math.max(0.1, S.dist2(sn.p, ent.c)) };
  else {
    const raw = vp.planePoint(e.x, e.y, g.s.plane), step = gridStep(vp.pxSize(V3(S.to3D(g.s.plane, raw))));
    const d = [0, 1].map(k => Math.round((raw[k] - g.p[k]) / step) * step);
    opt.drags = ['a', 'b'].map(key => ({ id: g.id, key, target: [ent[key][0] + d[0], ent[key][1] + d[1]] }));
  }
  const keep = g.s.entities;
  g.s.entities = structuredClone(g.orig); // immer vom Ausgangszustand lösen, damit nichts wegdriftet
  if (!solveSketch(g.s, opt)) g.s.entities = keep;
  syncSketches();
  vp.requestRender();
}

// mit Pencil navigieren Finger nur – außer im Zwei-Finger-Modus, da zeichnet ein Finger immer
const fingersNavOnly = e => e.type === 'touch' && vp.penSeen && !vp.twoFinger;

let drag = null, skDrag = null;
const selectTool = {
  onDown(e) {
    const o = st.op;
    if (!o && !st.xf && !fingersNavOnly(e)) {
      skDrag = sketchGrab(e);
      if (skDrag) return true;
    }
    if (!o?.handle || !vp.ray(e.x, e.y).intersectObject(handle.userData.hit, false).length) return false;
    const origin = V3(o.origin), n = V3(o.plane.n), s0 = axisParam(e, origin, n);
    if (s0 == null) return false;
    drag = { origin, n, s0, d0: o.dist };
    return true;
  },
  onMove(e) {
    if (skDrag) {
      if (!skDrag.moved && Math.hypot(e.x - skDrag.x, e.y - skDrag.y) < 6) return;
      skDrag.moved = true;
      return dragSketch(skDrag, e);
    }
    const o = st.op, s = drag && axisParam(e, drag.origin, drag.n);
    if (!o || s == null) return;
    const step = gridStep(vp.pxSize(handle.position));
    o.dist = +(Math.round((drag.d0 + s - drag.s0) / step) * step).toFixed(4);
    refreshOp();
  },
  onUp(e) {
    const g = skDrag;
    drag = skDrag = null;
    if (g) g.moved ? commit() : pick(e, false);
  },
  onCancel() {
    if (skDrag?.moved) { skDrag.s.entities = skDrag.orig; sync(); }
    drag = skDrag = null;
  },
  onTap(e) { pick(e, false); },
  onDoubleTap(e) { pick(e, true); },
};

// ---------------------------------------------------------------- Skizzen
function createSketch(plane, parent, center) {
  const s = { id: newId(), name: 'Skizze ' + (doc.sketches.length + 1), plane, entities: [], visible: true, parent: parent ?? null };
  doc.sketches.push(s);
  activateSketch(s, center);
  return s;
}

function activateSketch(s, center) {
  st.sketchId = s.id;
  vp.setWorkPlane(S.planeMatrix(s.plane));
  if (!center) {
    const t = vp.view.target, d = S.planeDist(s.plane, [t.x, t.y, t.z]);
    center = t.clone().addScaledVector(V3(s.plane.n), -d);
  }
  vp.lookAtPlane(s.plane, center);
}

function endSketch() {
  if (!st.sketchId) return;
  const s = sketch(st.sketchId);
  st.sketchId = null;
  st.last = null;
  vp.setWorkPlane(null);
  if (s && !s.entities.length) doc.sketches = doc.sketches.filter(x => x !== s);
}

function sketchOnFace() {
  const f = sel.face, b = f && body(f.bodyId);
  if (!b) return false;
  const an = views.get(b.id).an;
  createSketch(faceLoops(b.mesh, an, f.faceIdx).plane, b.id, V3(faceCentroid(an, f.faceIdx)));
  return true;
}

const pickTool = {
  onTap(e) {
    const rc = vp.ray(e.x, e.y);
    const hp = rc.intersectObjects(gPlanes.children, false)[0];
    const hb = rc.intersectObjects(bodyMeshes(), false)[0];
    if (hb && (!hp || hb.distance < hp.distance)) {
      const id = hb.object.userData.bodyId;
      sel.face = faceSel(id, views.get(id).an.triFace[hb.faceIndex]);
      if (sel.face.faces.length > 1) { sel.face = null; return UI.toast('Skizzen nur auf ebenen Flächen – bitte eine ebene Fläche antippen'); }
      sketchOnFace();
    } else createSketch(S.BASE_PLANES[hp ? hp.object.userData.plane : 'xy'], null); // daneben getippt: Grundebene
    startDraw(st.pendingTool);
  },
};

function snap(e, s = sketch(st.sketchId), skip) {
  const raw = s && vp.planePoint(e.x, e.y, s.plane);
  if (!raw) return null;
  const px = vp.pxSize(V3(S.to3D(s.plane, raw)));
  let best = null, bd = (e.type === 'touch' ? 18 : 11) * px;
  for (const list of [sketchRt(s).snaps, s.id === st.sketchId ? st.refs : []]) for (const c of list) {
    if (skip?.has(c.e)) continue;
    const d = S.dist2(c.p, raw);
    if (d < bd) { bd = d; best = c; }
  }
  if (best) return { p: [best.p[0], best.p[1]], kind: best.kind };
  const step = gridStep(px), r = x => +(Math.round(x / step) * step).toFixed(4);
  return { p: [r(raw[0]), r(raw[1])], kind: 'grid' };
}

const rectLines = (a, b) => [[a, [b[0], a[1]]], [[b[0], a[1]], b], [b, [a[0], b[1]]], [[a[0], b[1]], a]];

// Zeichenwerkzeug: Punkte per Tippen setzen oder in einem Zug ziehen
function makeDrawTool(kind) {
  const need = kind === 'arc' ? 3 : 2;
  let pts = [], downP = null, downXY = null, dragging = false, hover = null, chainStart = null;

  function finalize() {
    const s = sketch(st.sketchId), [a, b, c] = pts;
    const add = ent => {
      ent.id = newId();
      s.entities.push(ent);
      // achsparallel gezeichnete Linien bleiben horizontal bzw. vertikal
      const auto = ent.type !== 'line' ? null : ent.a[1] === ent.b[1] ? 'h' : ent.a[0] === ent.b[0] ? 'v' : null;
      if (auto) (s.constraints ||= []).push({ id: newId(), type: auto, a: ent.id });
      return ent.id;
    };
    st.last = null;
    if (kind === 'line') {
      st.last = { kind, sketchId: s.id, ids: [add({ type: 'line', a, b })] };
      pts = S.same2(b, chainStart) ? [] : [b];
      if (!pts.length) chainStart = null;
    } else if (kind === 'rect') {
      pts = [];
      if (Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6) return;
      st.last = { kind, sketchId: s.id, p0: a, sx: Math.sign(b[0] - a[0]), sy: Math.sign(b[1] - a[1]), ids: rectLines(a, b).map(([p, q]) => add({ type: 'line', a: p, b: q })) };
    } else if (kind === 'circle') {
      pts = [];
      st.last = { kind, sketchId: s.id, ids: [add({ type: 'circle', c: a, r: S.dist2(a, b) })] };
    } else {
      pts = [];
      const arc = S.arcFrom3(a, b, c);
      add(arc ? { type: 'arc', ...arc } : { type: 'line', a, b });
    }
    commit();
  }

  function addPoint(p) {
    if (pts.length && S.same2(p, pts[pts.length - 1])) {
      if (kind === 'line') { pts = []; chainStart = null; } // Doppeltipp beendet den Linienzug
      return;
    }
    pts.push(p);
    if (pts.length === 1) chainStart = p;
    if (pts.length === need) finalize();
  }

  return {
    kind,
    reset() { pts = []; downP = null; dragging = false; hover = null; chainStart = null; vp.requestRender(); },
    busy: () => pts.length > 0,
    onDown(e) {
      if (fingersNavOnly(e)) return false;
      const s = snap(e);
      if (!s) return false;
      downP = s.p; downXY = [e.x, e.y]; dragging = false; hover = s;
      vp.requestRender();
      return true;
    },
    onMove(e) {
      if (!dragging && Math.hypot(e.x - downXY[0], e.y - downXY[1]) > 10) dragging = true;
      hover = snap(e) || hover;
      vp.requestRender();
    },
    onUp(e) {
      const up = snap(e)?.p || downP;
      if (!dragging) addPoint(downP);
      else if (kind === 'arc' && pts.length === 2) addPoint(up);
      else { pts = []; chainStart = null; addPoint(downP); addPoint(up); }
      downP = null; dragging = false;
      if (e.type === 'touch') hover = null;
      sync();
    },
    onCancel() { downP = null; dragging = false; hover = null; vp.requestRender(); },
    onHover(e) { hover = snap(e); vp.requestRender(); },
    // temporäre Elemente für die Vorschau
    preview() {
      if (!hover) return null;
      const base = dragging && !(kind === 'arc' && pts.length === 2) ? [downP] : pts, h = hover.p;
      const out = { snap: hover, ents: [], label: '' };
      if (!base.length) return out;
      const a = base[0];
      if (kind === 'line') { out.ents = [{ type: 'line', a, b: h }]; out.label = UI.fmt(S.dist2(a, h)) + ' mm'; }
      else if (kind === 'rect') {
        out.ents = rectLines(a, h).map(([p, q]) => ({ type: 'line', a: p, b: q }));
        out.label = UI.fmt(Math.abs(h[0] - a[0])) + ' × ' + UI.fmt(Math.abs(h[1] - a[1]));
      } else if (kind === 'circle') { out.ents = [{ type: 'circle', c: a, r: S.dist2(a, h) }]; out.label = '⌀ ' + UI.fmt(2 * S.dist2(a, h)); }
      else if (base.length === 1) out.ents = [{ type: 'line', a, b: h }];
      else {
        const arc = S.arcFrom3(a, base[1], h);
        out.ents = [arc ? { type: 'arc', ...arc } : { type: 'line', a, b: base[1] }];
        if (arc) out.label = 'R ' + UI.fmt(arc.r);
      }
      return out;
    },
    // Linienzug nach Maßänderung am neuen Endpunkt fortsetzen
    moveAnchor(from, to) { if (pts.length === 1 && S.same2(pts[0], from)) pts = [to]; },
  };
}

let drawTool = null;
function startDraw(kind) {
  stopTransform();
  st.op = null;
  setPreview(null);
  if (sel.face?.faces.length === 1) { endSketch(); sketchOnFace(); }
  if (!st.sketchId) {
    clearSel();
    st.pickPlane = true;
    st.pendingTool = kind;
    gPlanes.visible = true;
    vp.tool = pickTool;
    return sync();
  }
  clearSel();
  st.pickPlane = false;
  gPlanes.visible = false;
  st.tool = kind;
  st.last = null;
  vp.tool = drawTool = makeDrawTool(kind);
  sync();
}

function setSelectTool() {
  st.pickPlane = false;
  gPlanes.visible = false;
  st.tool = 'select';
  drawTool = null;
  vp.tool = selectTool;
}

// Maße der zuletzt gezeichneten Form ändern
function editLast(apply) {
  const s = sketch(st.last.sketchId), ents = st.last.ids.map(id => s.entities.find(e => e.id === id));
  apply(ents);
  solveSketch(s);
  commit();
}

function upsertDim(s, a, value) {
  const c = (s.constraints ||= []).find(c => c.type === 'dim' && c.a === a);
  if (c) c.value = value; else s.constraints.push({ id: newId(), type: 'dim', a, value });
}

// Bedingung setzen und Skizze neu lösen; bei Widerspruch alles zurücknehmen
function applyCon(s, type, a, b, value) {
  const cons = (s.constraints ||= []), same = t => cons.some(c => c.type === t && ((c.a === a && c.b == b) || (c.a === b && c.b === a)));
  if (type !== 'dim' && same(type)) return UI.toast('Diese Bedingung ist schon gesetzt');
  if ((type === 'h' && same('v')) || (type === 'v' && same('h'))) return UI.toast('Die Linie ist schon ' + (type === 'h' ? 'vertikal' : 'horizontal'));
  const backup = [structuredClone(s.entities), structuredClone(cons)];
  if (type === 'dim') upsertDim(s, a, value); else cons.push({ id: newId(), type, a, ...(b != null && { b }) });
  if (!solveSketch(s)) {
    [s.entities, s.constraints] = backup;
    return UI.toast('Nicht möglich – widerspricht anderen Bedingungen');
  }
  commit();
}
function lastFields() {
  const L = st.last, s = L && sketch(L.sketchId), e0 = s?.entities.find(e => e.id === L.ids[0]);
  if (!e0) return [];
  const F = (label, value, onSet) => ({ type: 'field', label, value, unit: 'mm', onSet: v => v > 0 && onSet(v) });
  if (L.kind === 'line') {
    const len = S.dist2(e0.a, e0.b);
    return [F('Länge', len, v => editLast(([e]) => {
      const old = e.b;
      e.b = [e.a[0] + (e.b[0] - e.a[0]) * v / len, e.a[1] + (e.b[1] - e.a[1]) * v / len];
      drawTool?.moveAnchor(old, e.b);
      upsertDim(s, e.id, v);
    }))];
  }
  if (L.kind === 'circle') return [F('Durchmesser', e0.r * 2, v => editLast(([e]) => { e.r = v / 2; upsertDim(s, e.id, v); }))];
  const e2 = s.entities.find(e => e.id === L.ids[2]);
  const w = Math.abs(e2.a[0] - L.p0[0]), hgt = Math.abs(e2.a[1] - L.p0[1]);
  const setRect = (nw, nh) => editLast(ents => {
    const far = [L.p0[0] + L.sx * nw, L.p0[1] + L.sy * nh];
    rectLines(L.p0, far).forEach(([p, q], i) => { ents[i].a = p; ents[i].b = q; });
    upsertDim(s, L.ids[0], nw);
    upsertDim(s, L.ids[1], nh);
  });
  return [F('Breite', w, v => setRect(v, hgt)), F('Höhe', hgt, v => setRect(w, v))];
}

// ---------------------------------------------------------------- Bewegen / Drehen / Skalieren
const pivot = new THREE.Object3D();
vp.scene.add(pivot);

function resetPivot() {
  const box = new THREE.Box3();
  for (const id of sel.bodies) bboxOf(body(id).mesh, box);
  box.getCenter(pivot.position);
  pivot.quaternion.identity();
  pivot.scale.set(1, 1, 1);
  pivot.updateMatrix();
  pivot.updateMatrixWorld(true);
  st.xf.start.copy(pivot.matrix);
}
const pivotDelta = () => { pivot.updateMatrix(); return pivot.matrix.clone().multiply(st.xf.start.clone().invert()); };

function startTransform(mode = 'translate') {
  if (!sel.bodies.length && sel.face) { sel.bodies = [sel.face.bodyId]; sel.face = null; }
  if (!sel.bodies.length) return UI.toast('Zuerst einen Körper wählen (Fläche zweimal antippen)');
  st.op = null;
  setPreview(null);
  setSelectTool();
  st.xf = { mode, start: new THREE.Matrix4() };
  vp.gizmo.setMode(mode);
  vp.gizmo.setSpace('world');
  vp.gizmo.attach(pivot);
  sync();
}
function stopTransform() {
  if (!st.xf) return;
  st.xf = null;
  vp.gizmo.detach();
}
const moveFeatures = (b, m16) => b.features?.map(f => ({ ...f, region: K.transform(f.region, m16), tool: f.tool && K.transform(f.tool, m16) }));
function bake(delta) {
  const ids = sel.bodies.slice();
  doc.bodies = doc.bodies.map(b => {
    const m = ids.includes(b.id) && K.transform(b.mesh, delta.elements);
    return m ? { ...b, mesh: m, features: moveFeatures(b, delta.elements) } : b;
  });
  commit();
}
// Transformation um den Mittelpunkt der Auswahl
function bakeAbout(m) {
  const c = pivot.position;
  bake(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(m).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)));
}
vp.gizmo.addEventListener('objectChange', () => {
  if (!st.xf) return;
  const d = pivotDelta();
  for (const id of sel.bodies) { const g = views.get(id)?.group; if (g) { g.matrix.copy(d); g.matrixWorldNeedsUpdate = true; } }
});
vp.gizmo.addEventListener('dragging-changed', e => {
  if (e.value || !st.xf) return;
  const d = pivotDelta();
  if (d.equals(new THREE.Matrix4())) return;
  bake(d);
});

function doBoolean(op) {
  const [first, ...rest] = sel.bodies.map(body);
  let m = first.mesh;
  for (const r of rest) m = m && K.boolean(op, m, r.mesh);
  if (!m) return UI.toast('Das Ergebnis wäre leer');
  removeBodies(rest.map(r => r.id));
  patchBody(first.id, { mesh: m, features: op === 'union' ? [first, ...rest].flatMap(b => b.features || []) : first.features });
  sel.bodies = [first.id];
  commit();
}

function duplicate() {
  sel.bodies = sel.bodies.map(id => {
    const b = body(id), m16 = new THREE.Matrix4().makeTranslation(10, 10, 0).elements, c = addBody(K.transform(b.mesh, m16));
    c.features = moveFeatures(b, m16);
    return c.id;
  });
  doc.bodies = doc.bodies.map(b => (sel.bodies.includes(b.id) ? { ...b, name: b.name + ' (Kopie)' } : b));
  commit();
}

// ---------------------------------------------------------------- Kontextleiste
function renderBar() {
  const items = [], o = st.op;
  const L = (text, dim) => items.push({ type: 'label', text, dim });
  const F = (label, value, unit, onSet) => items.push({ type: 'field', label, value, unit, onSet });
  const B = (label, icon, onClick, kind, iconOnly) => items.push({ type: 'btn', label, icon, onClick, kind, iconOnly });
  const sep = () => items.push({ type: 'sep' });

  if (st.pickPlane) {
    L('Ebene, Körperfläche oder Raster antippen');
    B('Abbrechen', 'x', () => { setSelectTool(); sync(); });
  } else if (o) {
    L(o.title);
    if (o.type === 'extrude') F('Abstand', o.dist, 'mm', v => { o.dist = v; refreshOp(); });
    if (o.type === 'revolve') {
      if (!o.axis) L('Achse: Linie antippen oder', true);
      B('X-Achse', null, () => { o.axis = { p: [0, 0], d: [1, 0] }; refreshOp(); });
      B('Y-Achse', null, () => { o.axis = { p: [0, 0], d: [0, 1] }; refreshOp(); });
      F('Winkel', o.angle, '°', v => { o.angle = Math.max(1, Math.min(360, Math.abs(v))); refreshOp(); });
    }
    if (o.type === 'prim') {
      const names = { l: 'Länge', b: 'Breite', h: 'Höhe', d: 'Durchmesser' };
      for (const k of Object.keys(o.vals)) F(names[k], o.vals[k], 'mm', v => { if (v > 0) { o.vals[k] = v; refreshOp(); } });
    }
    if (o.type === 'edge') {
      items.push({ type: 'seg', value: o.kind, options: [['fillet', 'Verrundung'], ['chamfer', 'Fase']], onChange: k => { o.kind = k; sync(); refreshOp(); } });
      F(o.kind === 'fillet' ? 'Radius' : 'Abstand', o.size, 'mm', v => { if (v > 0) { o.size = v; refreshOp(); } });
    }
    if ((o.type === 'extrude' || o.type === 'revolve') && !o.face) {
      items.push({ type: 'seg', value: o.mode, options: [['auto', 'Auto'], ['new', 'Neu'], ['add', 'Hinzu'], ['cut', 'Abzug']], onChange: m => { o.mode = m; refreshOp(); } });
    }
    if (o.face) {
      sep();
      if (sel.face?.feature) B('Bearbeiten', sel.face.feature.kind === 'chamfer' ? 'chamfer' : 'fillet', () => editFeature(sel.face.bodyId, sel.face.feature.tag));
      if (sel.face?.feature) B('Löschen', 'trash', deleteSelection, 'danger');
      B('Skizze', 'pencil', () => startDraw('line'));
      B('Körper', 'box', () => { const id = sel.face.bodyId; clearSel(); sel.bodies = [id]; selectionChanged(); });
    }
    if (o.type === 'extrude' && o.sketchId) B('Rotation', 'revolve', startRevolve);
    sep();
    B('Abbrechen', 'x', cancelOp, '', true);
    B('Fertig', 'check', applyOp, 'primary');
  } else if (st.xf) {
    const x = st.xf;
    items.push({ type: 'seg', value: x.mode, options: [['translate', 'Verschieben'], ['rotate', 'Drehen'], ['scale', 'Skalieren']], onChange: m => { x.mode = m; vp.gizmo.setMode(m); renderBar(); } });
    const T = new THREE.Matrix4();
    if (x.mode === 'translate') ['X', 'Y', 'Z'].forEach((a, i) => F('Δ' + a, 0, 'mm', v => v && bake(T.makeTranslation(...[0, 1, 2].map(k => (k === i ? v : 0))))));
    else if (x.mode === 'rotate') ['X', 'Y', 'Z'].forEach((a, i) => F(a, 0, '°', v => v && bakeAbout(T.makeRotationAxis(new THREE.Vector3().setComponent(i, 1), THREE.MathUtils.degToRad(v)))));
    else F('Faktor', 1, '', v => v > 0 && v !== 1 && bakeAbout(T.makeScale(v, v, v)));
    sep();
    B('Fertig', 'check', () => { stopTransform(); sync(); }, 'primary');
  } else if (isDraw(st.tool)) {
    L({ line: 'Linie', rect: 'Rechteck', circle: 'Kreis', arc: 'Bogen' }[st.tool]);
    const fields = lastFields();
    if (fields.length) items.push(...fields);
    else L(st.tool === 'arc' ? 'Start, Ende, dann Bogenpunkt setzen' : 'Ziehen oder Punkte antippen', true);
    if (drawTool?.busy()) B('Zug beenden', null, () => { drawTool.reset(); renderBar(); });
    sep();
    B('Skizze beenden', 'check', () => { endSketch(); setSelectTool(); sync(); }, 'primary');
  } else if (sel.bodies.length) {
    const box = new THREE.Box3();
    for (const id of sel.bodies) bboxOf(body(id).mesh, box);
    const sz = box.getSize(new THREE.Vector3());
    L(sel.bodies.length > 1 ? sel.bodies.length + ' Körper' : body(sel.bodies[0]).name);
    L(`${UI.fmt(sz.x)} × ${UI.fmt(sz.y)} × ${UI.fmt(sz.z)} mm`, true);
    sep();
    B('Bewegen', 'move', () => startTransform());
    B('Kopie', 'copy', duplicate);
    if (sel.bodies.length > 1) {
      B('Vereinigen', 'union', () => doBoolean('union'));
      B('Abziehen', 'subtract', () => doBoolean('subtract'));
      B('Schnitt', 'intersect', () => doBoolean('intersect'));
    }
    items.push({ type: 'colors', colors: COLORS, value: body(sel.bodies[0]).color, onChange: c => { for (const id of sel.bodies) patchBody(id, { color: c }); commit(); } });
    B('Löschen', 'trash', deleteSelection, 'danger', true);
  } else if (sel.face) {
    const f = sel.face.feature;
    L(f ? (f.kind === 'chamfer' ? 'Fase' : 'Rundung') : 'Gekrümmte Fläche');
    if (f) L('Löschen macht die Kante wieder scharf', true);
    sep();
    B('Körper', 'box', () => { const id = sel.face.bodyId; clearSel(); sel.bodies = [id]; selectionChanged(); });
    if (f) B('Bearbeiten', f.kind === 'chamfer' ? 'chamfer' : 'fillet', () => editFeature(sel.face.bodyId, f.tag));
    if (f) B('Löschen', 'trash', deleteSelection, 'danger');
  } else if (sel.edges.length) {
    L(sel.edges.length + (sel.edges.length > 1 ? ' Kanten' : ' Kante'));
    L('weitere Kanten dazutippen', true);
    sep();
    B('Verrunden', 'fillet', () => startEdgeOp('fillet'));
    B('Fase', 'chamfer', () => startEdgeOp('chamfer'));
  } else if (sel.con) {
    const s = sketch(sel.con.sketchId), c = s.constraints.find(c => c.id === sel.con.id);
    L('Bedingung: ' + CON[c.type].name);
    if (c.type === 'dim') F('Wert', c.value, 'mm', v => v > 0 && applyCon(s, 'dim', c.a, null, v));
    B('Löschen', 'trash', deleteSelection, 'danger');
  } else if (sel.ents.length) {
    const s = sketch(sel.ents[0].sketchId), es = sel.ents.map(x => s.entities.find(e => e.id === x.id));
    const lines = es.filter(e => e.type === 'line'), rounds = es.filter(e => e.type !== 'line'), n = es.length, e0 = es[0];
    const C = (type, a, b) => B(CON[type].name === 'Fixiert' ? 'Fixieren' : CON[type].name, null, () => applyCon(s, type, a.id, b?.id));
    if (n > 1) L(n + ' Skizzenelemente');
    else if (e0.type === 'line') F('Länge', S.dist2(e0.a, e0.b), 'mm', v => v > 0 && applyCon(s, 'dim', e0.id, null, v));
    else F(e0.type === 'circle' ? 'Durchmesser' : 'Radius', e0.r * (e0.type === 'circle' ? 2 : 1), 'mm', v => v > 0 && applyCon(s, 'dim', e0.id, null, v));
    if (n === 1 && lines.length) { C('h', e0); C('v', e0); }
    if (n === 2 && lines.length === 2) { C('par', ...lines); C('perp', ...lines); C('eq', ...lines); }
    if (n === 2 && rounds.length === 2) { C('eq', ...rounds); C('tan', ...rounds); }
    if (n === 2 && lines.length === 1 && rounds.length === 1) C('tan', lines[0], rounds[0]);
    if (n === 1) C('fix', e0);
    sep();
    B('Löschen', 'trash', deleteSelection, 'danger', true);
  } else if (st.sketchId) {
    L(sketch(st.sketchId).name + ' aktiv', true);
    B('Skizze beenden', 'check', () => { endSketch(); sync(); }, 'primary');
  }
  UI.renderBar($('bar'), items);
}

// Neue Kennungen für Rundungs-/Fasenflächen eines Körpers (12 Bit, siehe kernel.js)
function nextTag(b) {
  const used = Math.max(K.maxTag(b.mesh), ...(b.features || []).map(f => f.tag));
  return used + 64 < 4096 ? used + 1 : 1;
}

// Werkzeuge für Rundung/Fase: tangential anschließende Kanten laufen mit, außer der Radius ist dafür
// zu groß (dann nur die angetippten Kanten)
function edgeTools(b, picked, kind, size) {
  const make = list => {
    const chains = joinChains(b.mesh, list), base = nextTag(b);
    const ts = [...chains.map(ch => buildEdgeTool(b.mesh, ch, kind, size)), ...cornerTools(b.mesh, chains, kind, size)];
    ts.forEach((t, i) => Object.assign(t, { tag: base + i, kind, size, links: t.chains?.map(ci => base + ci) }));
    return ts;
  };
  const ext = tangentChains(b.mesh, picked);
  if (ext.length > picked.length) try { return make(ext); } catch (e) { if (!/Radius zu groß/.test(e.message)) throw e; }
  return make(picked);
}

function startEdgeOp(kind, opts = {}) {
  if (!sel.edges.length) {
    setSelectTool();
    sync();
    return UI.toast('Zuerst eine oder mehrere Körperkanten antippen');
  }
  const b = body(sel.edges[0].bodyId), all = edgeChains(b.mesh), picked = sel.edges.map(x => all[x.idx]);
  const o = {
    type: 'edge', title: opts.restore ? 'Bearbeiten' : 'Kanten', kind, size: opts.size || 2, bodyId: b.id, convex: true, restore: opts.restore,
    tools() { return edgeTools(b, picked, this.kind, this.size); },
    build() { const ts = this.tools(); this.convex = ts.some(t => t.convex); return K.unionAll(ts.map(K.toolMesh)); },
    result() { return K.blendFeatures(b.mesh, this.tools()); },
  };
  stopTransform();
  st.op = o;
  sync();
  refreshOp();
}

function startRevolve() {
  if (!sel.regions.length) return UI.toast('Zuerst eine Skizzenfläche antippen');
  const s = sketch(sel.regions[0].sketchId), all = sketchRt(s).regions;
  st.op = makeRevolve({ regions: sel.regions.map(x => all[x.idx]), plane: s.plane, sketchId: s.id, parentId: s.parent });
  setPreview(null);
  sync();
}

// ---------------------------------------------------------------- Leisten, Liste, Menü
const RAIL = [
  { title: 'Auswahl', tools: [{ id: 'select', label: 'Auswahl', icon: 'select' }] },
  { title: 'Skizze', tools: [{ id: 'line', label: 'Linie', icon: 'line' }, { id: 'rect', label: 'Rechteck', icon: 'rect' }, { id: 'circle', label: 'Kreis', icon: 'circle' }, { id: 'arc', label: 'Bogen', icon: 'arc' }] },
  { title: 'Formen', tools: [{ id: 'extrude', label: 'Extrusion', icon: 'extrude' }, { id: 'revolve', label: 'Rotation', icon: 'revolve' }, { id: 'fillet', label: 'Rundung', icon: 'fillet' }, { id: 'chamfer', label: 'Fase', icon: 'chamfer' }, { id: 'move', label: 'Bewegen', icon: 'move' }] },
  { title: 'Körper', tools: [{ id: 'box', label: 'Quader', icon: 'box' }, { id: 'cyl', label: 'Zylinder', icon: 'cyl' }, { id: 'sphere', label: 'Kugel', icon: 'sphere' }] },
];

function railPick(id) {
  UI.closeNumpad();
  if (isDraw(id)) return startDraw(id);
  if (id === 'move') return startTransform();
  if (id === 'revolve') { setSelectTool(); return startRevolve(); }
  if (id === 'fillet' || id === 'chamfer') return startEdgeOp(id);
  stopTransform();
  setSelectTool();
  if (id === 'extrude') {
    if (!st.op) UI.toast('Skizzenfläche oder Körperfläche antippen, dann am Pfeil ziehen');
    return sync();
  }
  if (id !== 'select') endSketch();
  clearSel();
  st.op = id === 'select' ? null : makePrim(id);
  sync();
  refreshOp();
}

// Druckprüfung ein/aus und Ergebnis für die gewählten (sonst alle sichtbaren) Körper
function toggleCheck() {
  st.check = !st.check;
  sync();
}
function renderCheck() {
  const el = $('check');
  $('btn-check')?.classList.toggle('on', st.check);
  const list = (sel.bodies.length ? sel.bodies.map(body) : doc.bodies.filter(b => b.visible)).filter(Boolean);
  el.hidden = !st.check;
  if (!st.check) return;
  if (!list.length) { el.replaceChildren(UI.h('span', { class: 'ck' }, 'Keine Körper zum Prüfen')); return; }
  const sum = k => list.reduce((a, b) => a + checkPrint(b.mesh)[k], 0), cm2 = x => UI.fmt(Math.round(x) / 100) + ' cm²';
  const over = sum('over'), thin = sum('thin'), gap = sum('gap');
  const item = (color, text) => UI.h('span', { class: 'ck' }, UI.h('span', { class: 'dot', style: 'background:' + color }), text);
  const kids = [
    over > 1 ? item('#e53e3e', 'Überhang ' + cm2(over)) : UI.h('span', { class: 'ck ok' }, '✓ keine Überhänge'),
    thin ? item('#f78e1a', 'dünne Wand (< ' + UI.fmt(LIMITS.wall) + ' mm)') : UI.h('span', { class: 'ck ok' }, '✓ Wände'),
    gap ? item('#8c4dd9', 'enger Spalt/Loch (< ' + UI.fmt(LIMITS.gap) + ' mm)') : UI.h('span', { class: 'ck ok' }, '✓ Spalte'),
  ];
  if (list.length === 1) {
    const b = list[0], o = bestOrientation(b.mesh);
    kids.push(UI.h('span', { class: 'ck' }, 'Auflage ' + cm2(o.current.bed)));
    if (o.best.score < o.current.score * 0.8 - 20) kids.push(UI.h('button', { onclick: () => orientBody(b.id, o.best.down) }, 'Beste Lage: Überhang ' + cm2(o.best.over)));
  }
  kids.push(UI.h('button', { class: 'plain', title: 'Druckprüfung beenden', 'aria-label': 'Druckprüfung beenden', onclick: toggleCheck, html: UI.icon('x') }));
  el.replaceChildren(...kids);
}
// Körper so drehen, dass die Richtung down nach unten zeigt, und wieder auf dieselbe Höhe stellen
function orientBody(id, down) {
  const b = body(id), box = bboxOf(b.mesh), c = box.getCenter(new THREE.Vector3());
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...down), new THREE.Vector3(0, 0, -1));
  const rot = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  const m1 = K.transform(b.mesh, rot.elements), lift = box.min.z - bboxOf(m1).min.z;
  const all = new THREE.Matrix4().makeTranslation(0, 0, lift).multiply(rot);
  patchBody(id, { mesh: K.transform(b.mesh, all.elements), features: moveFeatures(b, all.elements) });
  commit();
}

function renderTop() {
  $('doc-name').textContent = doc.name;
  $('btn-undo').disabled = !canUndo();
  $('btn-redo').disabled = !canRedo();
}

function buildTop() {
  const B = (id, ic, label, onClick, text) => UI.h('button', { id, class: 'top-btn' + (text ? ' text' : ''), title: label, 'aria-label': label, onclick: onClick, html: text ? `<span>${text}</span>` : UI.icon(ic) });
  $('topbar').append(
    UI.h('div', { class: 'top-group' },
      B('btn-menu', 'menu', 'Menü', openMenu),
      UI.h('button', { id: 'doc-name', class: 'doc-name', title: 'Projekt umbenennen', onclick: () => { const n = prompt('Projektname', doc.name); if (n) { doc.name = n.trim() || doc.name; commit(); } } })),
    UI.h('div', { class: 'top-group' },
      B('btn-undo', 'undo', 'Rückgängig', doUndo),
      B('btn-redo', 'redo', 'Wiederholen', doRedo)),
    UI.h('div', { class: 'top-group' },
      B('', '', 'Isometrisch', () => vp.setView('iso'), 'Iso'),
      B('', '', 'Von oben', () => vp.setView('top'), 'Oben'),
      B('', '', 'Von vorne', () => vp.setView('front'), 'Vorne'),
      B('', '', 'Von rechts', () => vp.setView('right'), 'Rechts'),
      B('', 'fit', 'Alles einpassen', () => vp.fit(sceneBox())),
      B('btn-check', 'print', 'Druckprüfung', toggleCheck),
      B('btn-panel', 'layers', 'Elemente', () => { $('panel').classList.toggle('closed'); })));
}

function renderPanel() {
  UI.renderPanel($('panel'), { bodies: doc.bodies, sketches: doc.sketches, selBodies: sel.bodies, activeSketch: st.sketchId }, {
    toggle(kind, id) {
      if (kind === 'body') patchBody(id, { visible: !body(id).visible });
      else { const s = sketch(id); s.visible = !s.visible; }
      commit();
    },
    pick(kind, id) {
      if (kind === 'body') {
        const bodies = sel.bodies.slice(), i = bodies.indexOf(id);
        clearSel();
        if (i >= 0) bodies.splice(i, 1); else bodies.push(id);
        sel.bodies = bodies;
        setSelectTool();
        return selectionChanged();
      }
      const active = st.sketchId === id;
      endSketch();
      setSelectTool();
      clearSel();
      st.op = null;
      if (!active) { const s = sketch(id); s.visible = true; activateSketch(s); }
      sync();
    },
    rename(kind, id) {
      const item = kind === 'body' ? body(id) : sketch(id), n = prompt('Name', item.name);
      if (!n) return;
      if (kind === 'body') patchBody(id, { name: n }); else item.name = n;
      commit();
    },
    remove(kind, id) {
      if (kind === 'body') removeBodies([id]);
      else { if (st.sketchId === id) { st.sketchId = null; vp.setWorkPlane(null); } doc.sketches = doc.sketches.filter(s => s.id !== id); }
      st.op = null;
      setPreview(null);
      clearSel();
      commit();
    },
  });
}

function resetSession() {
  stopTransform();
  st.op = null;
  st.last = null;
  setPreview(null);
  clearSel();
  drawTool?.reset();
}
function doUndo() { resetSession(); undo(); }
function doRedo() { resetSession(); redo(); }

function newDoc(demo) {
  resetSession();
  endSketch();
  setSelectTool();
  Object.assign(doc, { name: demo ? 'Beispielteil' : 'Unbenannt', bodies: [], sketches: [], nextId: 1 });
  if (demo) buildDemo();
  resetHistory();
  vp.fit(sceneBox());
}

function openMenu() {
  const visible = () => {
    const list = doc.bodies.filter(b => b.visible);
    if (!list.length) UI.toast('Keine sichtbaren Körper zum Exportieren');
    return list;
  };
  UI.openMenu($('menu'), [
    { label: 'Neues Projekt', onClick: () => { if (!doc.bodies.length && !doc.sketches.length || confirm('Aktuelles Projekt verwerfen?')) newDoc(false); } },
    { label: 'Beispielteil laden', onClick: () => { if (!doc.bodies.length && !doc.sketches.length || confirm('Aktuelles Projekt durch das Beispiel ersetzen?')) newDoc(true); } },
    '-',
    { label: 'Projekt als Datei sichern', onClick: () => download(doc.name + '.form3d', toFile(), 'application/json') },
    { label: 'Projektdatei öffnen …', onClick: () => $('file').click() },
    '-',
    { label: 'An Slicer senden (3MF) …', onClick: () => { const l = visible(); if (l.length) share(doc.name + '.3mf', export3MF(l), 'model/3mf'); } },
    { label: 'Export 3MF (3D-Druck)', onClick: () => { const l = visible(); if (l.length) download(doc.name + '.3mf', export3MF(l), 'model/3mf'); } },
    { label: 'Export STL (3D-Druck)', onClick: () => { const l = visible(); if (l.length) download(doc.name + '.stl', exportSTL(l), 'model/stl'); } },
    { label: 'Export OBJ', onClick: () => { const l = visible(); if (l.length) download(doc.name + '.obj', exportOBJ(l), 'text/plain'); } },
    '-',
    { label: 'Gerät: ' + DEVICES[vp.device] + ' …', onClick: showHelp },
    { label: 'Kurzanleitung', onClick: showHelp },
    Bug.recording() ? null : { label: 'Fehler aufzeichnen …', onClick: () => Bug.start({ vp, state: appState, toFile }) },
    { label: 'Datenschutz & Lizenzen', onClick: () => { location.href = 'datenschutz.html'; } },
  ]);
}

$('file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    resetSession();
    endSketch();
    setSelectTool();
    fromFile(await f.text());
    vp.fit(sceneBox());
  } catch (err) {
    console.error(err);
    UI.toast('Datei konnte nicht geöffnet werden');
  }
});

// Beispiel: Grundplatte mit vier Bohrungen, Nabe und Durchgangsbohrung
function buildDemo() {
  const xy = S.BASE_PLANES.xy, ents = [];
  const add = e => ents.push({ id: newId(), ...e });
  rectLines([-40, -25], [40, 25]).forEach(([a, b]) => add({ type: 'line', a, b }));
  for (const x of [-30, 30]) for (const y of [-15, 15]) add({ type: 'circle', c: [x, y], r: 4 });
  doc.sketches.push({ id: newId(), name: 'Skizze 1', plane: xy, entities: ents, visible: false, parent: null });
  const plate = S.computeRegions(ents).sort((a, b) => b.area - a.area)[0];
  const top = { ...xy, o: [0, 0, 8] };
  const disc = r => [{ outer: S.tessellate({ type: 'circle', c: [0, 0], r }).slice(0, -1), holes: [] }];
  let m = K.boolean('union', K.extrude([plate], xy, 8), K.extrude(disc(15), top, 18));
  m = K.boolean('subtract', m, K.extrude(disc(8), { ...xy, o: [0, 0, 26] }, -26));
  addBody(m);
}

// ---------------------------------------------------------------- 2D-Overlay: Skizzenlinien, Vorschau, Fangmarken
const tv = new THREE.Vector3();
function tracePath(ctx, pts) {
  let pen = false;
  for (const p of pts) {
    if (vp.project(p, tv)) { pen ? ctx.lineTo(tv.x, tv.y) : ctx.moveTo(tv.x, tv.y); pen = true; } else pen = false;
  }
}
// Marken für Skizzenbedingungen (H, V, ∥, Maße …); antippbar zum Auswählen und Löschen
let badgeHits = [];
function drawBadges(ctx, s) {
  if (!s.constraints?.length) return;
  const offset = new Map();
  ctx.font = '600 11px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  for (const c of s.constraints) for (const id of [c.a, c.b]) {
    const e = id != null && s.entities.find(x => x.id === id);
    if (!e) continue;
    const ang = e.type === 'arc' ? (e.a0 + e.a1) / 2 : Math.PI / 4;
    const at = e.type === 'line' ? [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2] : [e.c[0] + e.r * Math.cos(ang), e.c[1] + e.r * Math.sin(ang)];
    if (!vp.project(V3(S.to3D(s.plane, at)), tv)) continue;
    const text = c.type === 'dim' ? (e.type === 'circle' ? '⌀ ' : e.type === 'arc' ? 'R ' : '') + UI.fmt(c.value) : CON[c.type].sym;
    const w = Math.max(18, ctx.measureText(text).width + 10), off = offset.get(id) || 0;
    offset.set(id, off + w + 3);
    const x = tv.x + 8 + off, y = tv.y - 26, on = sel.con?.id === c.id;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 18, 5);
    ctx.fillStyle = on ? '#2563eb' : c.type === 'dim' ? '#111827' : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = on ? '#2563eb' : '#94a3b8';
    ctx.stroke();
    ctx.fillStyle = on || c.type === 'dim' ? '#fff' : '#334155';
    ctx.fillText(text, x + w / 2, y + 9.5);
    badgeHits.push({ x, y, w, h: 18, sketchId: s.id, id: c.id });
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}
function badgeAt(e) {
  const r = vp.canvas.getBoundingClientRect(), x = e.x - r.left, y = e.y - r.top, pad = e.type === 'touch' ? 8 : 3;
  const hit = badgeHits.find(b => x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad);
  return hit && { sketchId: hit.sketchId, id: hit.id };
}

vp.onOverlay = ctx => {
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  badgeHits = [];
  for (const s of doc.sketches) {
    if (!s.visible) continue;
    const r = sketchRt(s), active = s.id === st.sketchId;
    ctx.beginPath();
    for (const pl of r.polys) tracePath(ctx, pl.pts);
    ctx.strokeStyle = active ? '#111827' : '#566170';
    ctx.lineWidth = active ? 2 : 1.4;
    ctx.stroke();
    const chosen = r.polys.filter(pl => sel.ents.some(x => x.sketchId === s.id && x.id === pl.id));
    if (chosen.length) {
      ctx.beginPath();
      for (const pl of chosen) tracePath(ctx, pl.pts);
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }
    drawBadges(ctx, s);
    if (active) {
      ctx.fillStyle = '#111827';
      for (const pl of r.polys) if (pl.dots) for (const p of pl.pts) if (vp.project(p, tv)) { ctx.beginPath(); ctx.arc(tv.x, tv.y, 2.6, 0, 7); ctx.fill(); }
    }
  }
  if (sel.edges.length) {
    ctx.beginPath();
    for (const x of sel.edges) { const ch = edgeChains(x.mesh)[x.idx]; if (ch) tracePath(ctx, ch.pts.map(V3)); }
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  const s = st.sketchId && sketch(st.sketchId);
  if (st.op?.type === 'revolve' && st.op.axis) {
    const sk = sketch(st.op.sketchId), { p, d } = st.op.axis, l = Math.hypot(d[0], d[1]) || 1;
    if (sk) {
      ctx.beginPath();
      tracePath(ctx, [-400, 400].map(t => V3(S.to3D(sk.plane, [p[0] + d[0] / l * t, p[1] + d[1] / l * t]))));
      ctx.setLineDash([10, 5, 2, 5]);
      ctx.strokeStyle = '#e5484d';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  if (s) { // Kantenmitten (Dreieck) und Mittelpunkte (Kreuz im Kreis) der Körper in der Skizzenebene
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const r of st.refs) {
      if (r.kind === 'end' || !vp.project(V3(S.to3D(s.plane, r.p)), tv)) continue;
      const { x, y } = tv;
      if (r.kind === 'mid') { ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4); ctx.closePath(); }
      else { ctx.moveTo(x + 5, y); ctx.arc(x, y, 5, 0, 7); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); }
    }
    ctx.stroke();
  }
  const pv = s && drawTool && isDraw(st.tool) && drawTool.preview();
  if (!pv) return;
  const to3 = p => V3(S.to3D(s.plane, p));
  ctx.beginPath();
  for (const e of pv.ents) tracePath(ctx, S.tessellate(e).map(to3));
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (!vp.project(to3(pv.snap.p), tv)) return;
  const { x, y } = tv, on = pv.snap.kind !== 'grid';
  ctx.strokeStyle = ctx.fillStyle = on ? '#e5484d' : '#2563eb';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  if (on) ctx.rect(x - 6, y - 6, 12, 12); else { ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); }
  ctx.stroke();
  if (pv.label) {
    ctx.font = '600 13px -apple-system, system-ui, sans-serif';
    const w = ctx.measureText(pv.label).width + 14;
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.roundRect(x + 14, y - 34, w, 24, 7);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(pv.label, x + 21, y - 17.5);
  }
};

// ---------------------------------------------------------------- Tastatur
addEventListener('keydown', e => {
  if (e.target.closest?.('input, textarea')) return;
  if (UI.numpadOpen()) { UI.numpadKey(e.key); e.preventDefault(); return; }
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.shiftKey ? doRedo() : doUndo(); e.preventDefault(); }
  else if (mod && k === 'y') { doRedo(); e.preventDefault(); }
  else if (mod) return;
  else if (k === 'enter') applyOp();
  else if (k === 'delete' || k === 'backspace') deleteSelection();
  else if (k === 'escape') {
    if (st.op) cancelOp();
    else if (st.xf) { stopTransform(); sync(); }
    else if (drawTool?.busy()) { drawTool.reset(); renderBar(); }
    else if (isDraw(st.tool) || st.pickPlane) { setSelectTool(); sync(); }
    else if (st.sketchId) { endSketch(); sync(); }
    else { clearSel(); selectionChanged(); }
  } else if ({ v: 'select', l: 'line', r: 'rect', c: 'circle', a: 'arc' }[k]) railPick({ v: 'select', l: 'line', r: 'rect', c: 'circle', a: 'arc' }[k]);
});

// ---------------------------------------------------------------- Gerät und Steuerung
// iPad: 1 Finger dreht, 2 verschieben/zoomen, Pencil zeichnet. Handy: 1 Finger zeichnet/tippt, 2 Finger
// drehen und zoomen, 3 Finger verschieben. Beide: 2 Finger umeinander drehen = Drehteller. PC: Maus und
// Tastatur (Touch wie iPad).
const DEVICES = { tablet: 'iPad', phone: 'Handy', pc: 'PC' };
function setDevice(device) {
  vp.device = device;
  try { localStorage.setItem('form3d-device', device); } catch { /* privater Modus */ }
}
function guessDevice() {
  if (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches) return Math.min(screen.width, screen.height) < 600 ? 'phone' : 'tablet';
  return matchMedia('(pointer: fine)').matches ? 'pc' : 'tablet';
}
function showHelp() {
  UI.showHelp(vp.device, d => { setDevice(d); showHelp(); });
}

// Zustand für die Fehleraufzeichnung (klein halten: wird nach jeder Eingabe gemerkt)
function appState() {
  const o = st.op;
  return {
    tool: st.tool, sketchId: st.sketchId, pickPlane: st.pickPlane || undefined, xf: !!st.xf || undefined,
    op: o ? { type: o.type, kind: o.kind, dist: o.dist, size: o.size } : null,
    sel: { bodies: sel.bodies, face: sel.face && { bodyId: sel.face.bodyId, faceIdx: sel.face.faceIdx, faces: sel.face.faces.length, feature: sel.face.feature?.tag ?? null }, regions: sel.regions, ents: sel.ents, edges: sel.edges.map(x => ({ bodyId: x.bodyId, idx: x.idx })), con: sel.con && sel.con.id },
    bodies: doc.bodies.map(b => ({ id: b.id, tris: b.mesh.t.length / 3, vol: +K.props(b.mesh).volume.toFixed(2), features: b.features?.length || 0 })),
    sketches: doc.sketches.map(s => ({ id: s.id, ents: s.entities.length, cons: s.constraints?.length || 0 })),
    view: { target: vp.view.target.toArray().map(x => +x.toFixed(3)), dist: +vp.view.dist.toFixed(3), theta: +vp.view.theta.toFixed(4), phi: +vp.view.phi.toFixed(4) },
    bar: $('bar').hidden ? null : $('bar').innerText.replace(/\s+/g, ' ').trim().slice(0, 200),
  };
}

// Aufzeichnung abspielen (tests/replay.js): Ausgangszustand herstellen
function replayStart(r) {
  $('help').hidden = true;
  resetSession();
  endSketch();
  setSelectTool();
  fromFile(r.doc);
  vp.device = r.device;
  vp.penSeen = !!r.penSeen;
  Object.assign(vp.view, { dist: r.view.dist, theta: r.view.theta, phi: r.view.phi });
  vp.view.target.fromArray(r.view.target);
  sync();
  vp.render();
}

// ---------------------------------------------------------------- Start
async function init() {
  UI.buildRail($('rail'), RAIL, railPick);
  buildTop();
  vp.tool = selectTool;
  let saved = null;
  try { saved = localStorage.getItem('form3d-device'); } catch { /* privater Modus */ }
  vp.device = DEVICES[saved] ? saved : guessDevice();
  if (innerWidth < 760) $('panel').classList.add('closed');
  vp.onPen = () => { if (vp.device === 'tablet') UI.toast('Apple Pencil erkannt – der Stift zeichnet, Finger navigieren'); };
  await K.initKernel();
  let waiting = true; // blockierte Datenbank darf den Start nicht aufhalten
  await Promise.race([loadLocal(() => waiting), new Promise(r => setTimeout(r, 4000))]);
  waiting = false;
  if (new URLSearchParams(location.search).has('demo')) { Object.assign(doc, { name: 'Beispielteil', bodies: [], sketches: [], nextId: 1 }); buildDemo(); }
  resetHistory();
  const box = sceneBox();
  if (!box.isEmpty()) vp.fit(box);
  $('loading').remove();
  try {
    if (!localStorage.getItem('form3d-help')) { showHelp(); localStorage.setItem('form3d-help', '1'); }
  } catch { /* privater Modus */ }
  if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
}

window.form3d = { doc, vp, st, sel, sketch, body, railPick, pick, applyOp, sync, refresh: () => { sync(); refreshOp(); }, appState, replayStart, makeExtrude, resolveMode };
init().then(() => {
  const q = new URLSearchParams(location.search);
  if (q.has('selftest')) import('../tests/selftest.js');
  if (q.has('replay')) import('../tests/replay.js');
}).catch(err => {
  console.error(err);
  $('loading').textContent = 'Start fehlgeschlagen: ' + (err?.message || err);
});
