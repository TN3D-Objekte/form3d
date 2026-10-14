// Körperkanten: scharfe Netzkanten zu durchgehenden Kanten verketten und Werkzeugkörper
// für Verrundung/Fase erzeugen (Profil wird entlang der Kante gezogen, dann abgezogen bzw. angefügt).
import { analyze } from './meshview.js';

const COS_BEND = Math.cos(30 * Math.PI / 180);
const EPS = 0.02; // Überstand des Werkzeugs über die Körperflächen hinaus

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Kette: { segs: [{ u, v, t1, t2 }], closed, pts }. t1 ist das Dreieck mit der Halbkante u→v, t2 das gegenüberliegende.
export function edgeChains(mesh) {
  const an = analyze(mesh);
  if (an.chains) return an.chains;
  const { sharp, sharpTri } = an, v = mesh.v, nS = sharp.length / 2;
  const P = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  const dir = (a, b) => norm(sub(P(b), P(a)));
  const inc = new Map();
  for (let s = 0; s < nS; s++) for (const i of [sharp[2 * s], sharp[2 * s + 1]]) {
    if (!inc.has(i)) inc.set(i, []);
    inc.get(i).push(s);
  }
  const orient = (s, from) => (sharp[2 * s] === from
    ? { s, u: sharp[2 * s], v: sharp[2 * s + 1], t1: sharpTri[2 * s], t2: sharpTri[2 * s + 1] }
    : { s, u: sharp[2 * s + 1], v: sharp[2 * s], t1: sharpTri[2 * s + 1], t2: sharpTri[2 * s] });
  const far = (s, at) => (sharp[2 * s] === at ? sharp[2 * s + 1] : sharp[2 * s]);
  const used = new Uint8Array(nS);
  // Fortsetzung über einen Punkt nur, wenn dort genau zwei Kanten zusammentreffen und kein Knick vorliegt
  const next = (s, at, d) => {
    const l = inc.get(at);
    if (l.length !== 2) return -1;
    const o = l[0] === s ? l[1] : l[0];
    return !used[o] && dot(d, dir(at, far(o, at))) > COS_BEND ? o : -1;
  };

  const chains = [];
  for (let s0 = 0; s0 < nS; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const segs = [orient(s0, sharp[2 * s0])];
    for (;;) {
      const l = segs[segs.length - 1], o = next(l.s, l.v, dir(l.u, l.v));
      if (o < 0) break;
      used[o] = 1;
      segs.push(orient(o, l.v));
    }
    const f = segs[0], l = segs[segs.length - 1];
    const closed = segs.length > 2 && l.v === f.u && inc.get(f.u).length === 2 && dot(dir(l.u, l.v), dir(f.u, f.v)) > COS_BEND;
    if (!closed) for (;;) {
      const h = segs[0], o = next(h.s, h.u, dir(h.v, h.u));
      if (o < 0) break;
      used[o] = 1;
      segs.unshift(orient(o, far(o, h.u)));
    }
    chains.push({ segs, closed, pts: [P(segs[0].u), ...segs.map(s => P(s.v))] });
  }
  an.chains = chains;
  return chains;
}

// Werkzeugkörper für eine Kante. Konvexe Kanten: Werkzeug wird abgezogen, konkave: angefügt.
export function buildEdgeTool(mesh, chain, kind, size) {
  const { fn } = analyze(mesh), { v, t } = mesh, segs = chain.segs, m = segs.length;
  const P = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  const nrm = ti => [fn[3 * ti], fn[3 * ti + 1], fn[3 * ti + 2]];
  const dirs = segs.map(s => norm(sub(P(s.v), P(s.u))));

  const s0 = segs[0];
  const c2 = [t[3 * s0.t2], t[3 * s0.t2 + 1], t[3 * s0.t2 + 2]].find(i => i !== s0.u && i !== s0.v);
  const convex = dot(nrm(s0.t1), sub(P(c2), P(s0.u))) < 0;
  const sgn = convex ? 1 : -1;

  const M = chain.closed ? m : m + 1;
  let nArc = 0;
  const rings = [];
  for (let i = 0; i < M; i++) {
    const near = [chain.closed ? (i - 1 + m) % m : i - 1, i < m ? i : -1].filter(k => k >= 0);
    const sum = f => norm(near.map(f).reduce((a, b) => add(a, b)));
    const tau = sum(k => dirs[k]), N1 = sum(k => nrm(segs[k].t1)), N2 = sum(k => nrm(segs[k].t2));
    const t1 = norm(cross(N1, tau)), t2 = norm(cross(tau, N2)); // in den Flächen, von der Kante weg
    const p = i < m ? P(segs[i].u) : P(segs[m - 1].v);
    const alpha = Math.acos(Math.max(-1, Math.min(1, dot(t1, t2))));
    const d = kind === 'fillet' ? size / Math.tan(alpha / 2) : size;
    const A = add(p, t1, d), B = add(p, t2, d);
    const Q = add(p, add(N1, N2), sgn * EPS / Math.max(0.2, 1 + dot(N1, N2)));
    const ring = [A, add(A, N1, sgn * EPS), Q, add(B, N2, sgn * EPS), B];
    if (kind === 'fillet') {
      const C = add(p, norm(add(t1, t2)), size / Math.sin(alpha / 2));
      const eA = norm(sub(A, C)), eB = norm(sub(B, C)), phi = Math.acos(Math.max(-1, Math.min(1, dot(eA, eB))));
      nArc ||= Math.max(3, Math.round(phi / (Math.PI / 24)));
      for (let j = 1; j < nArc; j++) {
        const s = j / nArc, wa = Math.sin(s * phi) / Math.sin(phi), wb = Math.sin((1 - s) * phi) / Math.sin(phi);
        ring.push(add(C, add([eA[0] * wa, eA[1] * wa, eA[2] * wa], eB, wb), size));
      }
    }
    rings.push(ring);
  }

  const N = rings[0].length, verts = new Float32Array(M * N * 3), tris = [];
  rings.forEach((r, k) => r.forEach((q, j) => verts.set(q, (k * N + j) * 3)));
  const spans = chain.closed ? M : M - 1;
  for (let k = 0; k < spans; k++) {
    const a = k * N, b = ((k + 1) % M) * N;
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      tris.push(a + j, b + j, b + j2, a + j, b + j2, a + j2);
    }
  }
  if (!chain.closed) {
    const e = (M - 1) * N;
    for (let i = 1; i < N - 1; i++) { // Deckel als Fächer von der Außenecke Q (Index 2)
      const j = (2 + i) % N, j2 = (3 + i) % N;
      tris.push(2, j, j2, e + 2, e + j2, e + j);
    }
  }
  let vol = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3;
    vol += verts[a] * (verts[b + 1] * verts[c + 2] - verts[b + 2] * verts[c + 1])
         + verts[a + 1] * (verts[b + 2] * verts[c] - verts[b] * verts[c + 2])
         + verts[a + 2] * (verts[b] * verts[c + 1] - verts[b + 1] * verts[c]);
  }
  if (vol < 0) for (let i = 0; i < tris.length; i += 3) { const x = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = x; }
  return { convex, mesh: { v: verts, t: new Uint32Array(tris) } };
}
