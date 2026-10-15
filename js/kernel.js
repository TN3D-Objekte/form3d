// Geometriekern: dünne Schicht über Manifold (WASM). Nach außen nur Meshes { v: Float32Array, t: Uint32Array }.
import Module from '../vendor/manifold.js';
import { planeMatrix, to3D } from './sketch.js';

let Manifold, CrossSection, Mesh;
const cache = new WeakMap(); // mesh → Manifold

export async function initKernel() {
  const wasm = await Module({ locateFile: () => new URL('../vendor/manifold.wasm', import.meta.url).href });
  wasm.setup();
  ({ Manifold, CrossSection, Mesh } = wasm);
}

function toManifold(mesh) {
  let m = cache.get(mesh);
  if (!m) {
    const mm = new Mesh({ numProp: 3, vertProperties: mesh.v, triVerts: mesh.t });
    mm.merge();
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

// Kantenwerkzeug an seinen Ebenen abschneiden (behalten wird n·x ≥ o). Die Schnittfläche soll genau
// in der Körperfläche liegen; das gilt erst nach dem Runden auf Float32, daher ohne Cache weiterrechnen.
export function toolMesh(t) {
  if (!t.trim?.length) return t.mesh;
  const m = toMesh(t.trim.reduce((a, p) => a.trimByPlane(p.n, p.o), toManifold(t.mesh)));
  if (m) cache.delete(m);
  return m;
}

// Verrundung/Fase: Werkzeuge an konvexen Kanten abziehen, an konkaven anfügen
export function blend(mesh, tools) {
  const cut = tools.filter(t => t.convex).map(toolMesh), fill = tools.filter(t => !t.convex).map(toolMesh);
  for (const m of [...cut, ...fill]) if (toManifold(m).isEmpty()) throw new Error('Werkzeugkörper ungültig');
  let r = mesh;
  if (cut.length) r = boolean('subtract', r, unionAll(cut));
  if (r && fill.length) r = boolean('union', r, unionAll(fill));
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
