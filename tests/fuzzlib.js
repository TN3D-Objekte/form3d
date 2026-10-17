// Fuzz-Test für Rundung/Fase: erzeugt zufällige, aber realistische Körper (Grundform mit Taschen, Löchern,
// Aufsätzen, Schrägen, Stufen), wählt Kanten wie ein Benutzer (eine Kante, alle Kanten einer Fläche, Kanten an
// einer Ecke, alles) und rundet/fast sie mit demselben Ablauf wie die App (blendop.js). Jedes Ergebnis wird gegen
// feste Regeln geprüft (check). Ein Fall ist durch seine Nummer vollständig bestimmt. Ohne DOM, läuft auch im
// Worker (fuzz-worker.js); Seite und Aufrufe siehe fuzz.js.
import * as K from '../js/kernel.js';
export { K };
import { analyze } from '../js/meshview.js';
import { edgeChains, tangentChains, isConvex } from '../js/edges.js';
import { applyEdges } from '../js/blendop.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------------------------------------------------------------- Zufall
function rng(seed) {
  let s = (seed * 2654435761 + 0x9e3779b9) >>> 0;
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const R = {
    f: (a = 0, b = 1) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    chance: p => next() < p,
    // gewichtete Auswahl: [[Gewicht, Wert], …]
    w: list => { let x = next() * list.reduce((s, e) => s + e[0], 0); for (const [g, v] of list) if ((x -= g) < 0) return v; return list[list.length - 1][1]; },
    sample: (arr, n) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); },
  };
  return R;
}

// ---------------------------------------------------------------- Körper
const plane = (z, o = [0, 0]) => ({ o: [o[0], o[1], z], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] });
const rectPoly = (cx, cy, w, h, rot = 0) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(p => turn(p, rot, cx, cy));
const ngon = (cx, cy, r, n, rot = 0) => Array.from({ length: n }, (_, i) => turn([r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)], rot, cx, cy));
const circle = (cx, cy, r) => ngon(cx, cy, r, 64);
const slot = (cx, cy, l, r, rot) => {
  const pts = [];
  for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + Math.PI * i / 16; pts.push([l / 2 + r * Math.cos(a), r * Math.sin(a)]); }
  for (let i = 0; i <= 16; i++) { const a = Math.PI / 2 + Math.PI * i / 16; pts.push([-l / 2 + r * Math.cos(a), r * Math.sin(a)]); }
  return pts.map(p => turn(p, rot, cx, cy));
};
function turn([x, y], a, cx, cy) { const c = Math.cos(a), s = Math.sin(a); return [cx + c * x - s * y, cy + s * x + c * y]; }
const region = outer => [{ outer, holes: [] }];
const ROT = [0, 0, 0, Math.PI / 6, Math.PI / 4, Math.PI / 12];

// kleine Kontur mit Ausdehnung ≈ s um (cx, cy)
function smallShape(R, cx, cy, s) {
  return R.w([
    [4, () => ({ k: 'Rechteck', p: rectPoly(cx, cy, s, s * R.pick([0.5, 0.7, 1]), R.pick(ROT)) })],
    [3, () => ({ k: 'Kreis', p: circle(cx, cy, s / 2) })],
    [2, () => ({ k: 'Dreieck', p: R.chance(0.5) ? ngon(cx, cy, s / 2, 3, R.f(0, 2)) : [[cx - s / 2, cy - s / 3], [cx + s / 2, cy - s / 2], [cx + R.f(-0.2, 0.3) * s, cy + s / 2]] })],
    [2, () => { const n = R.int(5, 8); return { k: n + '-Eck', p: ngon(cx, cy, s / 2, n, R.f(0, 1)) }; }],
    [2, () => ({ k: 'Langloch', p: slot(cx, cy, s * 0.6, s / 4, R.pick(ROT)) })],
  ])();
}

export function genModel(R) {
  const W = R.pick([20, 30, 40, 50, 60]), D = R.pick([20, 30, 40, 50]), H = R.pick([6, 8, 10, 15, 20, 30]);
  const base = R.w([
    [6, () => ({ k: `Quader ${W}×${D}×${H}`, p: rectPoly(0, 0, W, D) })],
    [2, () => ({ k: `Zylinder Ø${W}×${H}`, p: circle(0, 0, W / 2) })],
    [2, () => { const n = R.int(3, 8); return { k: `${n}-Eck-Prisma ${W}×${H}`, p: ngon(0, 0, W / 2, n, R.f(0, 1)) }; }],
    [2, () => ({ k: `L-Profil ${W}×${D}×${H}`, p: [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, 0], [0, 0], [0, D / 2], [-W / 2, D / 2]] })],
  ])();
  let m = K.extrude(region(base.p), plane(0), H);
  const desc = [base.k];
  let minDim = Math.min(W, D, H), top = H;
  // Punkte im Inneren der Grundfläche (für Taschen/Löcher): einfache Stichprobe
  const inside = (x, y) => { let c = false; const p = base.p; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
  const spot = s => { for (let k = 0; k < 40; k++) { const x = R.f(-W / 2, W / 2), y = R.f(-D / 2, D / 2); if ([[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]].every(([a, b]) => inside(x + a * 0.7, y + b * 0.7))) return [Math.round(x), Math.round(y)]; } return null; };
  const nOps = R.w([[2, 0], [4, 1], [3, 2], [1, 3]]);
  for (let i = 0; i < nOps; i++) {
    const op = R.w([[4, 'Tasche'], [3, 'Loch'], [3, 'Aufsatz'], [2, 'Schräge'], [2, 'Stufe'], [1, 'Querloch']]);
    let next = null;
    if (op === 'Tasche' || op === 'Loch' || op === 'Aufsatz') {
      const s = R.pick([4, 6, 8, 10, 12, 16]), at = spot(s);
      if (!at) continue;
      const sh = smallShape(R, at[0], at[1], s);
      if (op === 'Aufsatz') {
        const h = R.pick([3, 5, 8]);
        next = K.boolean('union', m, K.extrude(region(sh.p), plane(top), h));
        minDim = Math.min(minDim, h, s * 0.5);
        desc.push(`${op} ${sh.k} ${s}, h${h}`);
      } else {
        const d = op === 'Loch' ? top + 2 : Math.min(R.pick([2, 3, 5, 8]), top - 2);
        if (d <= 0) continue;
        next = K.boolean('subtract', m, K.extrude(region(sh.p), plane(top), -d, 1e-3));
        minDim = Math.min(minDim, op === 'Tasche' ? d : top, s * 0.5);
        desc.push(`${op} ${sh.k} ${s}${op === 'Tasche' ? ', t' + d : ''}`);
      }
    } else if (op === 'Schräge') {
      // großer Keil, um eine Achse gedreht: schneidet eine Kante/Ecke schräg ab
      const ang = R.pick([15, 20, 30, 45, 60]) * Math.PI / 180, az = R.pick([0, 90, 180, 270, 45]) * Math.PI / 180;
      const cut = R.f(0.25, 0.6) * Math.min(W, D);
      const box = K.extrude(region(rectPoly(0, 0, 400, 400)), plane(0), 200);
      const c = Math.cos(ang), s = Math.sin(ang), ca = Math.cos(az), sa = Math.sin(az);
      // Drehung um die y-Achse (Neigung), dann um z (Richtung), dann an die Kante schieben
      const Ry = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1], Rz = [ca, sa, 0, 0, -sa, ca, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      const mul = (A, B) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) for (let k = 0; k < 4; k++) o[q * 4 + r] += A[k * 4 + r] * B[q * 4 + k]; return o; };
      const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, (W / 2 - cut) * ca, (W / 2 - cut) * sa, top - R.f(0.2, 0.6) * top, 1];
      const tool = K.transform(K.transform(box, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].map((x, i) => (i === 12 ? 200 : x))), mul(T, mul(Rz, Ry)));
      next = K.boolean('subtract', m, tool);
      desc.push(`Schräge ${Math.round(ang * 180 / Math.PI)}° Richtung ${Math.round(az * 180 / Math.PI)}°`);
    } else if (op === 'Stufe') {
      const d = Math.min(R.pick([2, 3, 5, 8]), top - 2), w = R.pick([5, 8, 10, 15]);
      if (d <= 0) continue;
      const side = R.int(0, 3), sx = [1, 0, -1, 0][side], sy = [0, 1, 0, -1][side];
      const cx = sx * (W / 2), cy = sy * (D / 2);
      const p = sx ? rectPoly(cx, R.chance(0.5) ? 0 : R.f(-D / 4, D / 4), 2 * w, R.chance(0.5) ? D + 2 : R.pick([8, 12, 16])) : rectPoly(R.chance(0.5) ? 0 : R.f(-W / 4, W / 4), cy, R.chance(0.5) ? W + 2 : R.pick([8, 12, 16]), 2 * w);
      next = K.boolean('subtract', m, K.extrude(region(p), plane(top), -d, 1e-3));
      minDim = Math.min(minDim, d, w);
      desc.push(`Stufe ${w}×t${d}`);
    } else {
      const r = R.pick([2, 3, 4]), z = R.f(r + 1, top - r - 1);
      if (z <= r) continue;
      const cyl = K.extrude(region(circle(Math.round(R.f(-W / 4, W / 4)), Math.round(z), r)), { o: [0, D / 2 + 1, 0], x: [1, 0, 0], y: [0, 0, 1], n: [0, -1, 0] }, D + 2);
      next = K.boolean('subtract', m, cyl);
      minDim = Math.min(minDim, z - r, top - z - r);
      desc.push(`Querloch Ø${2 * r}`);
    }
    if (next && K.topology(next).parts === 1) m = next;
    else desc.pop();
  }
  return { mesh: m, desc: desc.join(' + '), minDim };
}

// ---------------------------------------------------------------- Kantenwahl
const vkey = (mesh, i) => { const v = mesh.v; return v[3 * i] + ',' + v[3 * i + 1] + ',' + v[3 * i + 2]; };
function chainEnds(mesh, chains) {
  const at = new Map();
  chains.forEach((c, ci) => {
    if (c.closed) return;
    for (const vi of [c.segs[0].u, c.segs[c.segs.length - 1].v]) {
      const k = vkey(mesh, vi);
      if (!at.has(k)) at.set(k, []);
      if (!at.get(k).includes(ci)) at.get(k).push(ci);
    }
  });
  return at;
}

export function pickEdges(R, mesh) {
  const chains = edgeChains(mesh), an = analyze(mesh);
  if (!chains.length) return null;
  const all = chains.map((_, i) => i);
  const how = R.w([[3, 'Kante'], [3, 'Fläche'], [3, 'Ecke'], [1, 'alle']]);
  if (how === 'Fläche') {
    const byFace = new Map();
    chains.forEach((c, ci) => { for (const g of c.segs) for (const t of [g.t1, g.t2]) { const f = an.triFace[t]; if (!byFace.has(f)) byFace.set(f, new Set()); byFace.get(f).add(ci); } });
    const faces = [...byFace.values()].filter(s => s.size >= 2);
    if (faces.length) return { how, idx: [...R.pick(faces)].sort((a, b) => a - b) };
  }
  if (how === 'Ecke') {
    const corners = [...chainEnds(mesh, chains).values()].filter(l => l.length >= 2);
    if (corners.length) { const l = R.pick(corners); return { how, idx: R.sample(l, R.int(2, l.length)).sort((a, b) => a - b) }; }
  }
  if (how === 'alle' && chains.length <= 40) return { how, idx: all };
  return { how: 'Kante', idx: [R.int(0, chains.length - 1)] };
}

// ---------------------------------------------------------------- Prüfung
// Abstand q zum Segment ab
function segDist(q, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab), u = l2 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
  return Math.hypot(...sub(q, add(a, ab, u)));
}
function closestOnTri(p, [a, b, c]) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
  const den = 1 / (va + vb + vc);
  return add(add(a, ab, vb * den), ac, vc * den);
}
// Abstandsabfrage zur Oberfläche eines Netzes über ein Raster (Zellen ~2 mm). near(q, r, n): liegt q näher als r
// an einem Dreieck (mit Normale n, falls angegeben)?
function surfaceIndex(mesh) {
  const an = analyze(mesh), cell = 2, grid = new Map(), tris = [];
  const key = (i, j, k) => i + ',' + j + ',' + k;
  for (let i = 0; i < mesh.t.length / 3; i++) {
    if (an.fa[i] < 1e-7) continue;
    const c = triPts(mesh, i), lo = [0, 1, 2].map(k => Math.floor(Math.min(c[0][k], c[1][k], c[2][k]) / cell)), hi = [0, 1, 2].map(k => Math.floor(Math.max(c[0][k], c[1][k], c[2][k]) / cell));
    const t = { c, n: [an.fn[3 * i], an.fn[3 * i + 1], an.fn[3 * i + 2]] };
    tris.push(t);
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = key(x, y, z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(t);
    }
  }
  return (q, r, n) => {
    const lo = q.map(x => Math.floor((x - r) / cell)), hi = q.map(x => Math.floor((x + r) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      for (const t of grid.get(key(x, y, z)) || []) {
        if (n && dot(t.n, n) < 0.995) continue;
        if (Math.hypot(...sub(closestOnTri(q, t.c), q)) < r) return true;
      }
    }
    return false;
  };
}
const triPts = (mesh, i) => [0, 1, 2].map(k => { const j = mesh.t[3 * i + k] * 3; return [mesh.v[j], mesh.v[j + 1], mesh.v[j + 2]]; });

// Prüft das Ergebnis R (Netz) von Rundung/Fase der Ketten sel (Indizes in edgeChains(M)) an M.
// Liefert { codes: { CODE: Wert }, bad: [Punkte] , sig }
export function check(M, Rm, selIdx, kind, size, hadFeatures) {
  const chains = edgeChains(M), picked = selIdx.map(i => chains[i]), used = tangentChains(M, picked);
  const anM = analyze(M), P = i => [M.v[3 * i], M.v[3 * i + 1], M.v[3 * i + 2]];
  const segs = [], codes = {}, bad = {};
  const flag = (code, val, pts = []) => { codes[code] = +(Math.abs(val) >= Math.abs(codes[code] || 0) ? val : codes[code]).toPrecision(3); (bad[code] ||= []).push(...pts); };
  // Rücksprung je Kette: Abstand der Rundungsränder von der Kante
  let reach = 0, expect = 0;
  for (const c of used) {
    const cx = isConvex(M, c);
    for (const g of c.segs) {
      const a = P(g.u), b = P(g.v), tau = norm(sub(b, a));
      const n1 = [anM.fn[3 * g.t1], anM.fn[3 * g.t1 + 1], anM.fn[3 * g.t1 + 2]], n2 = [anM.fn[3 * g.t2], anM.fn[3 * g.t2 + 1], anM.fn[3 * g.t2 + 2]];
      const t1 = norm(cross(n1, tau)), t2 = norm(cross(tau, n2));
      const alpha = Math.acos(Math.max(-1, Math.min(1, dot(t1, t2))));
      const d = kind === 'fillet' ? size / Math.tan(alpha / 2) : size;
      reach = Math.max(reach, d);
      const area = kind === 'fillet' ? size * size * (1 / Math.tan(alpha / 2) - (Math.PI - alpha) / 2) : 0.5 * size * size * Math.sin(alpha);
      expect += (cx ? -1 : 1) * area * Math.hypot(...sub(b, a));
      segs.push([a, b, cx]);
    }
  }
  // Wo zwei gewählte Ketten in einer Ecke enden, laufen ihre Werkzeuge bis zur Gehrung über das Kantenende hinaus
  // (an einer einspringenden Ecke liegt sie weit draußen): dort zählt die Verlängerung der Kante mit
  const shared = new Set([...chainEnds(M, used)].filter(([, l]) => l.length > 1).map(([k]) => k));
  const ends = used.filter(c => !c.closed).flatMap(c => [[c.segs[0].u, c.segs[0].v], [c.segs.at(-1).v, c.segs.at(-1).u]])
    .filter(([e]) => shared.has(vkey(M, e))).map(([e, f]) => { const a = P(e); return [a, add(a, norm(sub(a, P(f))), 4 * reach)]; });
  // Die Rundung läuft entlang einer nicht gewählten Kante aus (edges.js runout), wo eine gewählte Kante tangential in
  // sie übergeht, und an Ecken mit gewählten Außen- und Innenkanten (dort nach der Eckfüllung) entlang der nicht
  // gewählten Außenkanten: Diese Kanten zählen auf RUNOUT · Radius mit
  const usedSet = new Set(used), COS_TAN = Math.cos(20 * Math.PI / 180);
  let runouts = 0;
  const runSegs = [];
  for (const [k, list] of chainEnds(M, used)) {
    const cs = list.map(i => used[i]), mixed = cs.some(c => isConvex(M, c)) && cs.some(c => !isConvex(M, c));
    const outs = cs.flatMap(c => [vkey(M, c.segs[0].u) === k && [norm(sub(c.pts[0], c.pts[1])), isConvex(M, c)], vkey(M, c.segs.at(-1).v) === k && [norm(sub(c.pts.at(-1), c.pts.at(-2))), isConvex(M, c)]].filter(Boolean));
    for (const c of chains) {
      if (usedSet.has(c) || c.closed) continue;
      let pts = vkey(M, c.segs[0].u) === k ? c.pts : vkey(M, c.segs.at(-1).v) === k ? c.pts.slice().reverse() : null;
      if (pts && !(mixed && isConvex(M, c)) && !outs.some(([d, cx]) => cx === isConvex(M, c) && dot(d, norm(sub(pts[1], pts[0]))) > COS_TAN)) pts = null;
      if (pts) runouts++;
      for (let i = 1, l = 0; pts && i < pts.length && l < 3 * size + reach; i++) { ends.push([pts[i - 1], pts[i]]); runSegs.push([pts[i - 1], pts[i]]); l += Math.hypot(...sub(pts[i], pts[i - 1])); }
    }
  }
  const near = q => { let m = Infinity; for (const [a, b] of [...segs, ...ends]) m = Math.min(m, segDist(q, a, b)); return m; };
  const tol = 0.02 + 0.02 * size, lim = reach * (hadFeatures ? 2 : 1) + tol;

  // 1. Topologie
  const t0 = K.topology(M), t1 = K.topology(Rm);
  if (t0.parts !== t1.parts) flag('TEILE', t1.parts - t0.parts);
  const info = {};
  if (t0.parts !== t1.parts) info.teilvolumen = t1.volumes.slice(t0.parts).map(v => +v.toPrecision(2)).slice(0, 4).join('/');
  if (t0.genus !== t1.genus) flag('GESCHLECHT', t1.genus - t0.genus);

  // 2. Nur auf der richtigen Seite: Außenkanten nehmen nur weg, Innenkanten fügen nur an
  const out = K.volumeMinus(Rm, M), inn = K.volumeMinus(M, Rm), allCx = segs.every(s => s[2]), allCc = segs.every(s => !s[2]);
  const vtol = 1e-3 + 1e-3 * Math.abs(expect);
  if (allCx && out > vtol) flag('ANGEFÜGT', out);
  if (allCc && inn > vtol) flag('ABGETRAGEN', inn);

  // 3. Örtlich: alles Geänderte liegt nahe an den Kanten. Gezählt werden nur Punkte abseits der alten
  // Oberfläche – hauchdünne Splitter zwischen fast gleichen Netzen liegen ganz auf ihr.
  const onM = surfaceIndex(M);
  for (const [a, b] of [[Rm, M], [M, Rm]]) {
    const x = K.boolean('subtract', a, b);
    if (!x) continue;
    for (let i = 0; i < x.v.length; i += 3) {
      const q = [x.v[i], x.v[i + 1], x.v[i + 2]], d = near(q);
      if (d > lim && !onM(q, 2e-3)) flag('FERN', d - reach, [q]);
    }
  }

  // 4. Volumen grob wie erwartet (gerade Kantenstücke, ohne Ecken)
  const dv = K.props(Rm).volume - K.props(M).volume;
  const L = segs.reduce((s, [a, b]) => s + Math.hypot(...sub(b, a)), 0);
  // ein Auslauf trägt etwa 0,24 · Radius³ (Rundung) bzw. 0,56 · Maß³ (Fase) zusätzlich ab (bei 90°; Spielraum für andere Winkel)
  const runVol = runouts * (kind === 'fillet' ? 0.3 : 0.7) * size ** 3;
  if (!hadFeatures && L > 20 * size && Math.abs(expect) > 0.05 && Math.abs(dv - expect) > 0.25 * Math.abs(expect) + 0.05 + runVol) { flag('VOLUMEN', +((dv - expect) / Math.abs(expect)).toFixed(2)); info.volumen = [dv, expect, runVol].map(x => +x.toFixed(2)).join(' / '); }

  // 5. Flächen ohne Rundungskennung müssen auf der alten Oberfläche liegen (sonst: Werkzeugdeckel, Stufen, Lappen).
  // Ausnahme: Endet eine Rundung allein an einer Ecke, darf ihr Ende in der Ebene einer dort anstoßenden Fläche
  // liegen (z. B. Bodenkante eines L-Profils, die an der Innenecke endet: dort entsteht eine kleine ebene Endfläche).
  const endPlanes = [], usedEnds = chainEnds(M, used);
  for (const [k, list] of usedEnds) {
    if (list.length !== 1) continue;
    const p = k.split(',').map(Number), pl = [];
    for (let i = 0; i < M.t.length; i++) {
      if (vkey(M, M.t[i]) !== k) continue;
      const ti = (i / 3) | 0, n = [anM.fn[3 * ti], anM.fn[3 * ti + 1], anM.fn[3 * ti + 2]];
      if (anM.fa[ti] > 1e-6 && !pl.some(m => dot(m, n) > 0.9999)) pl.push(n);
    }
    endPlanes.push({ p, pl });
  }
  const inEndPlane = (g, n) => endPlanes.some(e => Math.hypot(...sub(g, e.p)) < reach + tol && e.pl.some(m => Math.abs(dot(m, n)) > 0.995 && Math.abs(dot(m, sub(g, e.p))) < 2e-3));
  const mKeys = new Set();
  for (let i = 0; i < M.v.length / 3; i++) mKeys.add(vkey(M, i));
  const anR = analyze(Rm);
  let offArea = 0;
  const offPts = [];
  for (let i = 0; i < Rm.t.length / 3; i++) {
    if (anR.tg[i] || anR.fa[i] < 1e-5) continue;
    if ([0, 1, 2].every(k => mKeys.has(vkey(Rm, Rm.t[3 * i + k])))) continue; // unverändertes Dreieck
    const c = triPts(Rm, i), g = [0, 1, 2].map(k => (c[0][k] + c[1][k] + c[2][k]) / 3);
    const L2 = Math.max(...[0, 1, 2].map(k => Math.hypot(...sub(c[(k + 1) % 3], c[k]))));
    if (2 * anR.fa[i] / L2 < 0.005) continue; // Splitter: siehe meshview STEP
    const n = norm(cross(sub(c[1], c[0]), sub(c[2], c[0]))); // eigene Normale: schmale Streifen erben in analyze die eines Nachbarn
    if (!onM(g, 2e-3, n) && !inEndPlane(g, n)) { offArea += anR.fa[i]; offPts.push(g); }
  }
  if (offArea > 2e-3) flag('FREMDFLÄCHE', offArea, offPts);

  // 6. Die gewählten Kanten müssen ganz verschwunden sein (keine scharfe Restkante auf der alten Kante)
  let left = 0;
  const leftPts = [];
  for (let s = 0; s < anR.sharp.length; s += 2) {
    const a = [Rm.v[3 * anR.sharp[s]], Rm.v[3 * anR.sharp[s] + 1], Rm.v[3 * anR.sharp[s] + 2]], b = [Rm.v[3 * anR.sharp[s + 1]], Rm.v[3 * anR.sharp[s + 1] + 1], Rm.v[3 * anR.sharp[s + 1] + 2]];
    const m = add(a, sub(b, a), 0.5);
    if (segs.some(([p, q]) => segDist(a, p, q) < 1e-3 && segDist(b, p, q) < 1e-3)) { left += Math.hypot(...sub(b, a)); leftPts.push(m); }
  }
  if (left > 0.01) flag('RESTKANTE', left, leftPts);

  // 7. Ausgefranste Linien: scharfe Kanten, die im neuen Bereich lose enden (in einem sauberen Körper endet jede
  // scharfe Kante an einer Ecke mit weiteren Kanten). Ausgenommen sind Gehrungen zwischen zwei Rundungen/Fasen: Sie
  // laufen dort aus, wo beide tangential in dieselbe Fläche übergehen.
  // Lose Enden, deren Kantenzug bis zur nächsten Verzweigung kürzer als 0,05 mm ist (Krümel an der Spitze eines
  // Auslaufs, unter der Druckauflösung), zählen nicht.
  const loose = (mesh, an) => {
    const deg = new Map(), miter = new Set(), adj = new Map();
    for (let s = 0; s < an.sharp.length; s += 2) {
      const m = an.tg[an.sharpTri[s]] && an.tg[an.sharpTri[s + 1]], [ka, kb] = [an.sharp[s], an.sharp[s + 1]].map(i => vkey(mesh, an.weld[i]));
      for (const k of [ka, kb]) { deg.set(k, (deg.get(k) || 0) + 1); if (m) miter.add(k); }
      if (!adj.has(ka)) adj.set(ka, []);
      if (!adj.has(kb)) adj.set(kb, []);
      adj.get(ka).push(kb); adj.get(kb).push(ka);
    }
    const P3 = k => k.split(',').map(Number), runLen = k0 => {
      let prev = null, k = k0, l = 0;
      for (let n = 0; n < 1000 && l < 0.05; n++) {
        const nx = adj.get(k).find(x => x !== prev);
        if (nx === undefined) break;
        l += Math.hypot(...sub(P3(nx), P3(k)));
        prev = k; k = nx;
        if (deg.get(k) !== 2) break;
      }
      return l;
    };
    return [...deg].filter(([k, d]) => d === 1 && !miter.has(k) && runLen(k) >= 0.05).map(([k]) => k);
  };
  const looseM = new Set(loose(M, anM)), frays = loose(Rm, anR).filter(k => !looseM.has(k)).map(k => k.split(',').map(Number)).filter(q => near(q) < lim)
    .filter(q => !runSegs.some(([a, b]) => segDist(q, a, b) < 0.02 + 0.01 * size)); // die Kante beginnt wieder, wo ein Auslauf endet
  if (frays.length) flag('FRANSEN', frays.length, frays);

  return { codes, bad, info, sig: signature(M, chains, selIdx, codes, bad, reach) };
}

// Ort eines Fehlers zur Gruppierung: an welcher Art Ecke (gewählte/nicht gewählte, konvex/konkav) er liegt
function signature(M, chains, selIdx, codes, bad, reach) {
  const ends = chainEnds(M, chains), sel = new Set(selIdx), out = {};
  for (const code of Object.keys(codes)) {
    const pts = bad[code];
    if (!pts?.length) { out[code] = '-'; continue; }
    const kinds = new Map();
    for (const q of pts) {
      let best = null, bd = Infinity;
      for (const [k, list] of ends) {
        if (!list.some(ci => sel.has(ci))) continue;
        const p = k.split(',').map(Number), d = Math.hypot(...sub(q, p));
        if (d < bd) { bd = d; best = list; }
      }
      const desc = best && bd < 3 * reach + 0.5
        ? 'Ecke ' + best.map(ci => (sel.has(ci) ? 'G' : 'n') + (isConvex(M, chains[ci]) ? '+' : '−')).sort().join('')
        : 'Kantenmitte';
      kinds.set(desc, (kinds.get(desc) || 0) + 1);
    }
    out[code] = [...kinds].sort((a, b) => b[1] - a[1])[0][0];
  }
  return out;
}

// ---------------------------------------------------------------- Fälle
export function runCase(id, keep = false) {
  const R = rng(id);
  const t0 = performance.now();
  const model = genModel(R);
  let b = { mesh: model.mesh, features: [] };
  const steps = R.w([[3, 1], [1, 2]]), res = { id, model: model.desc, steps: [] };
  for (let s = 0; s < steps; s++) {
    const pick = pickEdges(R, b.mesh);
    if (!pick) break;
    const kind = R.w([[7, 'fillet'], [3, 'chamfer']]);
    const size = Math.min(R.pick([0.5, 1, 1, 1.5, 2, 2, 3, 4, 5]), Math.max(0.5, Math.floor(model.minDim * 0.4 * 2) / 2));
    const chains = edgeChains(b.mesh), step = { how: pick.how, edges: pick.idx, kind, size };
    res.steps.push(step);
    let r;
    try { r = applyEdges(b, pick.idx.map(i => chains[i]), kind, size); } catch (e) {
      if (/Radius zu groß/.test(e.message)) { step.reject = true; break; }
      step.codes = { AUSNAHME: 1 }; step.sig = { AUSNAHME: String(e.message).slice(0, 60) };
      if (keep) res.last = { M: b.mesh, b, picked: pick.idx.map(i => chains[i]), error: e };
      break;
    }
    try {
      const c = check(b.mesh, r.mesh, pick.idx, kind, size, b.features.length > 0);
      step.codes = c.codes; step.sig = c.sig;
      if (Object.keys(c.info).length) step.info = c.info;
      if (keep) res.last = { M: b.mesh, R: r.mesh, bad: c.bad };
      if (Object.keys(c.codes).length) { step.bad = Object.fromEntries(Object.entries(c.bad).map(([k, v]) => [k, v.slice(0, 3).map(q => q.map(x => +x.toFixed(2)))])); break; }
    } catch (e) { step.codes = { PRÜFFEHLER: 1 }; step.sig = { PRÜFFEHLER: String(e.message).slice(0, 60) }; break; }
    b = r;
  }
  res.ms = Math.round(performance.now() - t0);
  res.fail = res.steps.some(s => s.codes && Object.keys(s.codes).length);
  return res;
}

// Körper aus einer Fehleraufzeichnung (form3d-fehler-*.json): Anfangsmodell, gewählte Kanten aus der URL
export async function fileCase(url, q) {
  const r = await (await fetch(url)).json(), d = JSON.parse(r.doc);
  const unb64 = (s, T) => { const bin = atob(s), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new T(u8.buffer); };
  const bd = q.get('body') ? d.bodies.find(x => x.id === +q.get('body')) : d.bodies[0];
  const mesh = { v: unb64(bd.v, Float32Array), t: unb64(bd.t, Uint32Array), ...(bd.f && { f: unb64(bd.f, Uint32Array) }) };
  const features = (bd.features || []).map(x => ({ tag: x.tag, kind: x.kind, size: x.size, convex: x.convex, links: x.links, region: { v: unb64(x.v, Float32Array), t: unb64(x.t, Uint32Array) }, tool: x.tool && { v: unb64(x.tool.v, Float32Array), t: unb64(x.tool.t, Uint32Array), ...(x.tool.f && { f: unb64(x.tool.f, Uint32Array) }) } }));
  return { mesh, features, edges: q.get('edges').split(',').map(Number), kind: q.get('kind') || 'fillet', size: +(q.get('size') || 2) };
}

