// Geometriekern: dünne Schicht über Manifold (WASM). Nach außen nur Meshes { v: Float32Array, t: Uint32Array, f? }.
// f: Kennung je Dreieck; die oberen 12 Bit markieren Flächen einer Rundung/Fase (0 = keine). Manifold
// reicht sie als faceID durch alle Booleschen Operationen weiter.
import Module from '../vendor/manifold.js';
import { planeMatrix, to3D } from './sketch.js';

let Manifold, CrossSection, Mesh;
const cache = new WeakMap(); // mesh → Manifold

export async function initKernel() {
  const wasm = await Module({ locateFile: () => new URL('../vendor/manifold.wasm', import.meta.url).href });
  wasm.setup();
  ({ Manifold, CrossSection, Mesh } = wasm);
}

const TAG = 1 << 20;
export const tagOf = (mesh, tri) => (mesh.f ? Math.floor(mesh.f[tri] / TAG) : 0);
export const maxTag = mesh => { let m = 0; if (mesh.f) for (const x of mesh.f) m = Math.max(m, Math.floor(x / TAG)); return m; };

function toManifold(mesh) {
  let m = cache.get(mesh);
  if (!m) {
    const mm = new Mesh({ numProp: 3, vertProperties: mesh.v, triVerts: mesh.t });
    mm.merge();
    const nT = mesh.t.length / 3, f = new Uint32Array(nT);
    for (let i = 0; i < nT; i++) f[i] = tagOf(mesh, i) * TAG + (i & (TAG - 1));
    Object.assign(mm, { faceID: f, runIndex: new Uint32Array([0, mesh.t.length]), runOriginalID: new Uint32Array([Manifold.reserveIDs(1)]) });
    m = new Manifold(mm);
    cache.set(mesh, m);
  }
  return m;
}

function toMesh(man) {
  if (man.isEmpty()) return null;
  const g = man.getMesh();
  let v = g.vertProperties;
  if (g.numProp !== 3) {
    const n = v.length / g.numProp, out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = v[i * g.numProp + k];
    v = out;
  }
  const mesh = { v: new Float32Array(v), t: new Uint32Array(g.triVerts) };
  if (g.faceID?.length === mesh.t.length / 3 && g.faceID.some(x => x >= TAG)) mesh.f = new Uint32Array(g.faceID);
  cache.set(mesh, man);
  return mesh;
}

function crossSection(regions) {
  let cs = null;
  for (const r of regions) {
    const c = new CrossSection([r.outer, ...r.holes], 'EvenOdd');
    cs = cs ? cs.add(c) : c;
  }
  return cs;
}

// over: Überstand an beiden Enden, damit Schnittkörper nicht genau in Körperflächen enden
export function extrude(regions, plane, d, over = 0) {
  let m = Manifold.extrude(crossSection(regions), Math.abs(d) + 2 * over);
  m = m.translate([0, 0, Math.min(d, 0) - over]);
  return toMesh(m.transform(planeMatrix(plane)));
}

// axis: { p: [x, y], d: [dx, dy] } in Skizzenkoordinaten
export function revolve(regions, plane, axis, degrees) {
  const len = Math.hypot(axis.d[0], axis.d[1]);
  const d = [axis.d[0] / len, axis.d[1] / len];
  let u = [d[1], -d[0]];
  const side = q => (q[0] - axis.p[0]) * u[0] + (q[1] - axis.p[1]) * u[1];
  let sum = 0;
  for (const q of regions[0].outer) sum += side(q);
  if (sum < 0) u = [-u[0], -u[1]];
  const map = q => [(q[0] - axis.p[0]) * u[0] + (q[1] - axis.p[1]) * u[1], (q[0] - axis.p[0]) * d[0] + (q[1] - axis.p[1]) * d[1]];
  const mapped = regions.map(r => ({ outer: r.outer.map(map), holes: r.holes.map(h => h.map(map)) }));
  const m = Manifold.revolve(crossSection(mapped), 64, Math.max(1, Math.min(360, Math.abs(degrees))));
  const lift = a => [0, 1, 2].map(k => plane.x[k] * a[0] + plane.y[k] * a[1]);
  const U = lift(u), D = lift(d);
  const W = [D[1] * U[2] - D[2] * U[1], D[2] * U[0] - D[0] * U[2], D[0] * U[1] - D[1] * U[0]];
  const P = to3D(plane, axis.p);
  return toMesh(m.transform([...U, 0, ...W, 0, ...D, 0, ...P, 1]));
}

export function boolean(op, a, b) {
  const A = toManifold(a), B = toManifold(b);
  return toMesh(op === 'union' ? A.add(B) : op === 'subtract' ? A.subtract(B) : A.intersect(B));
}

export const unionAll = meshes => meshes.reduce((a, b) => boolean('union', a, b));

// Kantenwerkzeug markieren (Rundungs-/Fasenfläche bekommt t.tag) und an seinen Ebenen abschneiden
// (behalten wird n·x ≥ o). Die Schnittfläche soll genau in der Körperfläche liegen; das gilt erst
// nach dem Runden auf Float32, daher ohne Cache weiterrechnen.
export function toolMesh(t) {
  const tagged = t.tag && t.mesh.f ? { ...t.mesh, f: t.mesh.f.map(x => (x ? t.tag * TAG : 0)) } : t.mesh;
  if (!t.trim?.length) return tagged;
  const m = toMesh(t.trim.reduce((a, p) => a.trimByPlane(p.n, p.o), toManifold(tagged)));
  if (m) cache.delete(m);
  return m;
}

// Verrundung/Fase: Werkzeuge an konvexen Kanten abziehen, an konkaven anfügen. Je Werkzeug wird das
// entfernte bzw. hinzugefügte Volumen gemerkt, damit sich die Rundung später wieder löschen lässt.
export function blendFeatures(mesh, tools) {
  const ms = tools.map(toolMesh);
  for (const m of ms) if (!m || toManifold(m).isEmpty()) throw new Error('Werkzeugkörper ungültig');
  const cut = ms.filter((_, i) => tools[i].convex), fill = ms.filter((_, i) => !tools[i].convex);
  let r = mesh;
  if (cut.length) r = boolean('subtract', r, unionAll(cut));
  if (r && fill.length) r = boolean('union', r, unionAll(fill));
  const features = tools.map((t, i) => ({
    tag: t.tag, kind: t.kind, convex: t.convex, links: t.links,
    region: boolean(t.convex ? 'intersect' : 'subtract', t.heal ? toolMesh({ ...t, tag: 0, mesh: t.heal }) : ms[i], mesh),
  })).filter(x => x.tag && x.region);
  return { mesh: r, features };
}
export const blend = (mesh, tools) => blendFeatures(mesh, tools).mesh;

// Rundung/Fase entfernen: gemerktes Volumen wieder anfügen bzw. abziehen – ohne den Teil, den
// verbleibende Rundungen/Fasen (keep) ebenfalls entfernt bzw. angefügt haben
export function unblend(mesh, features, keep = []) {
  let r = mesh;
  for (const x of features) {
    const others = keep.filter(k => k.convex === x.convex).map(k => k.region);
    const reg = others.length ? boolean('subtract', x.region, unionAll(others)) : x.region;
    if (reg) r = r && boolean(x.convex ? 'union' : 'subtract', r, reg);
  }
  return r;
}

export const intersects = (a, b) => !toManifold(a).intersect(toManifold(b)).isEmpty();

export const transform = (mesh, m16) => toMesh(toManifold(mesh).transform(Array.from(m16)));

export function primitive(kind, p) {
  if (kind === 'box') return toMesh(Manifold.cube([p.l, p.b, p.h]).translate([-p.l / 2, -p.b / 2, 0]));
  if (kind === 'cyl') return toMesh(Manifold.cylinder(p.h, p.d / 2, p.d / 2, 64));
  return toMesh(Manifold.sphere(p.d / 2, 64).translate([0, 0, p.d / 2]));
}

export function props(mesh) {
  const m = toManifold(mesh);
  return { volume: m.volume(), area: m.surfaceArea() };
}
