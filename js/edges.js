// Körperkanten: scharfe Netzkanten zu durchgehenden Kanten verketten und Werkzeugkörper
// für Verrundung/Fase erzeugen (Profil wird entlang der Kante gezogen, dann abgezogen bzw. angefügt).
import { analyze } from './meshview.js';

const COS_BEND = Math.cos(30 * Math.PI / 180);
const COS_STRAIGHT = Math.cos(1 * Math.PI / 180);
const EPS = 0.02; // Überstand des Werkzeugs über die Körperflächen hinaus
const GAP = 1e-3; // Abstand der Werkzeugenden von Endflächen, an denen nicht verlängert werden kann
const GROW = 0.01; // Versatz des Löschvolumens, siehe edgeTool

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
  const len = s => Math.hypot(...sub(P(sharp[2 * s + 1]), P(sharp[2 * s])));
  // Fortsetzung über einen Punkt nur, wenn dort genau zwei Kanten zusammentreffen und kein Knick vorliegt.
  // Gerade Stücke und Bögen bleiben getrennt (tangentialer Übergang: Richtung ändert sich, Längen
  // sehr verschieden), damit ein Antippen nur die gemeinte Kante wählt.
  const next = (s, at, d) => {
    const l = inc.get(at);
    if (l.length !== 2) return -1;
    const o = l[0] === s ? l[1] : l[0], c = dot(d, dir(at, far(o, at)));
    if (used[o] || c <= COS_BEND) return -1;
    const r = len(s) / len(o);
    return c > COS_STRAIGHT || (r < 4 && r > 0.25) ? o : -1;
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

const flip = c => ({ ...c, segs: c.segs.slice().reverse().map(g => ({ s: g.s, u: g.v, v: g.u, t1: g.t2, t2: g.t1 })), pts: c.pts.slice().reverse() });

// Gewählte Kanten, die tangential aneinander anschließen, zu einer Kette verbinden (z. B. gerade
// Kante + Bogen + gerade Kante rund um eine verrundete Ecke), damit das Werkzeug durchläuft.
export function joinChains(mesh, chains) {
  const v = mesh.v, P = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  const d = (g) => norm(sub(P(g.v), P(g.u)));
  let list = chains.filter(c => !c.closed);
  const done = chains.filter(c => c.closed);
  for (let joined = true; joined;) {
    joined = false;
    outer: for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      for (const a of [list[i], flip(list[i])]) {
        let b = list[j];
        const ae = a.segs[a.segs.length - 1].v;
        if (b.segs[b.segs.length - 1].v === ae) b = flip(b);
        if (b.segs[0].u !== ae || dot(d(a.segs[a.segs.length - 1]), d(b.segs[0])) <= COS_BEND) continue;
        const segs = [...a.segs, ...b.segs], f = segs[0], l = segs[segs.length - 1];
        const c = { segs, pts: [...a.pts, ...b.pts.slice(1)], closed: l.v === f.u && dot(d(l), d(f)) > COS_BEND };
        list = list.filter((_, k) => k !== i && k !== j);
        (c.closed ? done : list).push(c);
        joined = true;
        break outer;
      }
    }
  }
  return [...done, ...list];
}

// Gewählte Kanten um tangential anschließende Kanten erweitern (Tangentialkette)
export function tangentChains(mesh, picked) {
  const all = edgeChains(mesh), { sharp } = analyze(mesh), v = mesh.v, P = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  const deg = new Map();
  for (const i of sharp) deg.set(i, (deg.get(i) || 0) + 1);
  const ends = c => [[c.segs[0].u, norm(sub(P(c.segs[0].u), P(c.segs[0].v)))], [c.segs[c.segs.length - 1].v, norm(sub(P(c.segs[c.segs.length - 1].v), P(c.segs[c.segs.length - 1].u)))]];
  const out = new Set(picked), todo = [...picked];
  while (todo.length) {
    const c = todo.pop();
    if (c.closed) continue;
    for (const [vi, d] of ends(c)) {
      if (deg.get(vi) !== 2) continue;
      for (const o of all) {
        if (out.has(o) || o.closed) continue;
        const e = ends(o).find(x => x[0] === vi);
        if (e && dot(d, e[1]) < -COS_BEND) { out.add(o); todo.push(o); }
      }
    }
  }
  return [...out];
}

function isConvex(mesh, chain) {
  const { fn, weld } = analyze(mesh), { v, t } = mesh, s0 = chain.segs[0];
  const c2 = [t[3 * s0.t2], t[3 * s0.t2 + 1], t[3 * s0.t2 + 2]].find(i => weld[i] !== s0.u && weld[i] !== s0.v);
  const e = [0, 1, 2].map(k => v[c2 * 3 + k] - v[s0.u * 3 + k]);
  return dot([fn[3 * s0.t1], fn[3 * s0.t1 + 1], fn[3 * s0.t1 + 2]], e) < 0;
}

// Werkzeugkörper für eine Kante. Konvexe Kanten: Werkzeug wird abgezogen, konkave: angefügt.
// trim: Ebenen { n, o }, an denen der Kern das Werkzeug abschneidet (behalten wird n·x ≥ o).
export function buildEdgeTool(mesh, chain, kind, size) {
  return { ...edgeTool(mesh, chain, kind, size, 0), heal: edgeTool(mesh, chain, kind, size, GROW).mesh };
}

// grow: Profil um diesen Betrag ins Material (bzw. bei Innenkanten in den Hohlraum) versetzt. Daraus wird
// das Volumen gemerkt, mit dem sich die Rundung wieder löschen lässt; so liegen beim Löschen keine
// Flächen genau aufeinander.
function edgeTool(mesh, chain, kind, size, grow) {
  const { fn, weld } = analyze(mesh), { v, t } = mesh, segs = chain.segs, m = segs.length;
  const P = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  const nrm = ti => [fn[3 * ti], fn[3 * ti + 1], fn[3 * ti + 2]];
  const dirs = segs.map(s => norm(sub(P(s.v), P(s.u))));

  const convex = isConvex(mesh, chain), sgn = convex ? 1 : -1;

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
    if (near.length === 2) { // Krümmung der Kante: Werkzeug darf auf der Innenseite nicht überschlagen (Radius gleich dem Kantenradius geht: Kugelecke)
      // Boolesche Ergebnisse zerteilen Kanten oft in winzige Stücke (z. B. an einer Fase), auf die sich dann
      // der ganze Knick einer Polygonecke drängt. Solche Splitter werden mit dem nächsten langen Stück
      // zusammengefasst, sonst erscheint die Kante dort viel stärker gekrümmt, als sie ist.
      const sl = s => Math.hypot(...sub(P(segs[s].v), P(segs[s].u)));
      const step = (s, ds) => (chain.closed ? (s + ds + m) % m : s + ds);
      let a = near[0], b = near[1], la = sl(a), lb = sl(b);
      for (let n = 0; n < m; n++) {
        const a2 = step(a, -1);
        if (a2 < 0 || a2 === b || la >= sl(a2) / 2) break;
        a = a2; la += sl(a2);
      }
      for (let n = 0; n < m; n++) {
        const b2 = step(b, 1);
        if (b2 >= m || b2 === a || lb >= sl(b2) / 2) break;
        b = b2; lb += sl(b2);
      }
      const kv = sub(dirs[b], dirs[a]);
      const k = Math.hypot(...kv) / (la + lb - (sl(a) + sl(b)) / 2);
      if (k > 1e-9 && [t1, t2].some(tt => dot(tt, norm(kv)) > 0.5) && d > 1.001 / k) throw new Error('Radius zu groß für diese Kante');
    }
    const A = add(p, t1, d), B = add(p, t2, d);
    const Q = add(p, add(N1, N2), sgn * EPS / Math.max(0.2, 1 + dot(N1, N2)));
    const ring = [A, add(A, N1, sgn * EPS), Q, add(B, N2, sgn * EPS), B];
    let toward = () => norm(add(N1, N2)).map(c => -sgn * c);
    if (kind === 'fillet') {
      const C = add(p, norm(add(t1, t2)), size / Math.sin(alpha / 2));
      const eA = norm(sub(A, C)), eB = norm(sub(B, C)), phi = Math.acos(Math.max(-1, Math.min(1, dot(eA, eB))));
      nArc ||= Math.max(3, Math.round(phi / (Math.PI / 24)));
      for (let j = 1; j < nArc; j++) {
        const s = j / nArc, wa = Math.sin(s * phi) / Math.sin(phi), wb = Math.sin((1 - s) * phi) / Math.sin(phi);
        ring.push(add(C, add([eA[0] * wa, eA[1] * wa, eA[2] * wa], eB, wb), size));
      }
      toward = q => norm(sub(C, q));
    }
    if (grow) for (const j of [0, 4, ...ring.keys()].filter((j, k, a) => (j === 0 || j >= 4) && a.indexOf(j) === k)) ring[j] = add(ring[j], toward(ring[j]), grow);
    rings.push(ring);
  }

  // Offene Enden dürfen nicht genau in der Endfläche des Körpers liegen, sonst bleiben hauchdünne
  // Dreiecke stehen. Wo es das Ergebnis nicht ändert (beim Abziehen ins Freie, beim Anfügen ins
  // Material), wird das Werkzeug einfach verlängert. Sonst wird es verlängert und anschließend exakt
  // an der Ebene der Endfläche abgeschnitten (trim); geht auch das nicht, endet es knapp davor.
  const trim = [];
  if (!chain.closed) {
    const endExt = (vi, out, s) => {
      const n1 = nrm(s.t1), n2 = nrm(s.t2), ends = [];
      let lo = 1, hi = -1;
      for (let i = 0; i < t.length; i++) {
        if (weld[t[i]] !== vi) continue;
        const ti = (i / 3) | 0, n = nrm(ti);
        if (!fn[3 * ti] && !fn[3 * ti + 1] && !fn[3 * ti + 2]) continue;
        if (dot(n, n1) > 0.999 || dot(n, n2) > 0.999) continue;
        const c = dot(n, out);
        lo = Math.min(lo, c); hi = Math.max(hi, c);
        if (!ends.some(e => dot(e, n) > 0.999)) ends.push(n);
      }
      const ring = vi === s.u ? rings[0] : rings[rings.length - 1], p = P(vi);
      const R = Math.max(...ring.map(q => Math.hypot(...sub(q, p))));
      const len = c => { const cc = Math.max(c, 0.3); return R * (0.25 + Math.sqrt(1 - cc * cc) / cc); };
      const c = convex ? lo : -hi;
      if (c >= 0.05) return len(c);
      // genau eine Endfläche: Seite der Kante behalten
      const ne = ends[0], ce = ends.length === 1 ? dot(ne, out) : 0;
      if (Math.abs(ce) < 0.1) return -GAP;
      const keep = ce > 0 ? ne.map(x => -x) : ne, o = dot(keep, p);
      if (chain.pts.some(q => dot(keep, q) < o - 1e-6)) return -GAP;
      trim.push({ n: keep, o });
      return len(Math.abs(ce));
    };
    const e0 = endExt(segs[0].u, dirs[0].map(x => -x), segs[0]), e1 = endExt(segs[m - 1].v, dirs[m - 1], segs[m - 1]);
    if (e0 > 0) rings.unshift(rings[0].map(q => add(q, dirs[0], -e0)));
    else rings[0] = rings[0].map(q => add(q, dirs[0], GAP));
    if (e1 > 0) rings.push(rings[rings.length - 1].map(q => add(q, dirs[m - 1], e1)));
    else rings[rings.length - 1] = rings[rings.length - 1].map(q => add(q, dirs[m - 1], -GAP));
  }

  const R = rings.length, N = rings[0].length, verts = new Float32Array(R * N * 3), tris = [];
  rings.forEach((r, k) => r.forEach((q, j) => verts.set(q, (k * N + j) * 3)));
  const spans = chain.closed ? R : R - 1;
  const surf = []; // 1 = Dreieck der Rundungs-/Fasenfläche (Profil von B über den Bogen nach A)
  for (let k = 0; k < spans; k++) {
    const a = k * N, b = ((k + 1) % R) * N;
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      tris.push(a + j, b + j, b + j2, a + j, b + j2, a + j2);
      surf.push(+(j >= 4), +(j >= 4));
    }
  }
  if (!chain.closed) {
    const e = (R - 1) * N;
    for (let i = 1; i < N - 1; i++) { // Deckel als Fächer von der Außenecke Q (Index 2)
      const j = (2 + i) % N, j2 = (3 + i) % N;
      tris.push(2, j, j2, e + 2, e + j2, e + j);
      surf.push(0, 0);
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
  return { convex, mesh: { v: verts, t: new Uint32Array(tris), f: new Uint32Array(surf) }, trim };
}

// Eckübergang: Laufen drei verrundete Kanten in einer Ecke zusammen, schneiden sich die Kantenwerkzeuge
// sonst zu einer Spitze. Wie bei einer rollenden Kugel wird die Ecke durch ein Kugelstück ersetzt:
// Werkzeug = Kegel vom Kugelmittelpunkt zur Ecke abzüglich Kugel. Die Kugel ist um GAP größer, damit
// sie die Zylinderflächen der Kantenwerkzeuge schneidet statt sie nur zu berühren.
export function cornerTools(mesh, chains, kind, size) {
  if (kind !== 'fillet') return [];
  const { fn } = analyze(mesh), v = mesh.v;
  const P = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  const nrm = ti => [fn[3 * ti], fn[3 * ti + 1], fn[3 * ti + 2]];
  const ends = new Map();
  chains.forEach((ch, ci) => {
    if (ch.closed) return;
    const convex = isConvex(mesh, ch), f = ch.segs[0], l = ch.segs[ch.segs.length - 1];
    for (const [vi, s] of [[f.u, f], [l.v, l]]) {
      if (!ends.has(vi)) ends.set(vi, []);
      ends.get(vi).push({ convex, ci, normals: [nrm(s.t1), nrm(s.t2)] });
    }
  });
  const tools = [];
  for (const [vi, list] of ends) {
    if (list.length !== 3 || list.some(e => e.convex !== list[0].convex)) continue;
    const ns = [];
    for (const e of list) for (const n of e.normals) if (!ns.some(m => dot(m, n) > 0.999)) ns.push(n);
    if (ns.length !== 3) continue;
    const sgn = list[0].convex ? 1 : -1, d = ns.map(n => n.map(x => x * sgn));
    const det = dot(d[0], cross(d[1], d[2]));
    if (Math.abs(det) < 0.05) continue;
    // Mittelpunkt: Abstand size zu allen drei Flächen (d_i · (C − p) = −size)
    const p = P(vi), x = [cross(d[1], d[2]), cross(d[2], d[0]), cross(d[0], d[1])].reduce((a, b) => add(a, b)).map(c => -size * c / det);
    const C = add(p, x);
    const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
    const n = Math.max(3, Math.round(Math.max(angle(d[0], d[1]), angle(d[1], d[2]), angle(d[2], d[0])) / (Math.PI / 24)));
    // Ausdehnung des Werkzeugs: Ecke in Koordinaten der Richtungen d (p − C = Σ a_i d_i) plus Rand
    const y = x.map(c => -c), a = [cross(d[1], d[2]), cross(d[2], d[0]), cross(d[0], d[1])].map(c => dot(y, c) / det);
    const ext = a.map(ai => Math.max(ai + 0.25 * size, 1.5 * (size + GAP)));
    tools.push({ convex: sgn > 0, mesh: cornerMesh(C, d, size + GAP, n, ext), heal: cornerMesh(C, d, size + GAP - GROW, n, ext), chains: list.map(e => e.ci) });
  }
  return tools;
}

// Spat C + Σ a_i d_i (0 ≤ a_i ≤ ext_i) abzüglich Kugel um C
function cornerMesh(C, d, r, n, ext) {
  const slerp = (a, b, s) => {
    const w = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))), sw = Math.sin(w);
    return add(a.map(c => c * Math.sin((1 - s) * w) / sw), b, Math.sin(s * w) / sw);
  };
  // Kugeldreieck als Dreiecksraster (i, j, k = n − i − j) über den Richtungen d0, d1, d2
  const verts = [], idx = new Map(), at = (i, j) => idx.get(i * (n + 1) + j);
  for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) {
    const k = n - i - j;
    const dir = !k ? slerp(d[0], d[1], j / n) : !j ? slerp(d[0], d[2], k / n) : !i ? slerp(d[1], d[2], k / n)
      : norm(add(add(d[0].map(c => c * i), d[1], j), d[2], k));
    idx.set(i * (n + 1) + j, verts.length);
    verts.push(add(C, dir, r));
  }
  const faces = []; // [Dreieck, Bezugsrichtung für die Außenseite]
  const inward = tr => sub(C, verts[tr[0]]);
  for (let i = 0; i < n; i++) for (let j = 0; i + j < n; j++) {
    const tr = [at(i, j), at(i + 1, j), at(i, j + 1)];
    faces.push([tr, inward(tr)]);
    if (i + j < n - 1) { const t2 = [at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]; faces.push([t2, inward(t2)]); }
  }
  const patch = faces.length;
  // Ecken des Spats: Pi = C + ext_i d_i, Pij = Pi + ext_j d_j, Pall
  const pt = q => { verts.push(q); return verts.length - 1; };
  const Pv = d.map((q, i) => add(C, q, ext[i]));
  const Pi = Pv.map(pt), Pij = {}, pair = (i, j) => Pij[Math.min(i, j) * 3 + Math.max(i, j)];
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) Pij[i * 3 + j] = pt(add(Pv[i], d[j], ext[j]));
  const Pall = pt(add(add(Pv[0], d[1], ext[1]), d[2], ext[2]));
  // Seitenflächen in den Ebenen durch C: Randbogen von d_i nach d_j, dann Pj, Pij, Pi (Fächer von Pij)
  const arcs = [
    [0, 1, Array.from({ length: n + 1 }, (_, s) => at(n - s, s))],
    [0, 2, Array.from({ length: n + 1 }, (_, s) => at(n - s, 0))],
    [1, 2, Array.from({ length: n + 1 }, (_, s) => at(0, n - s))],
  ];
  for (const [i, j, arc] of arcs) {
    const M = pair(i, j), away = d[3 - i - j].map(c => -c);
    for (let s = 0; s < n; s++) faces.push([[M, arc[s], arc[s + 1]], away]);
    faces.push([[M, arc[n], Pi[j]], away], [[M, Pi[i], arc[0]], away]);
  }
  // Außenflächen a_i = ext_i
  for (let i = 0; i < 3; i++) {
    const [j, k] = [0, 1, 2].filter(x => x !== i), out = d[i];
    faces.push([[Pi[i], pair(i, j), Pall], out], [[Pi[i], Pall, pair(i, k)], out]);
  }
  const out = [];
  for (const [tr, ref] of faces) {
    const [a, b, c] = tr.map(i => verts[i]);
    out.push(...(dot(cross(sub(b, a), sub(c, a)), ref) >= 0 ? tr : [tr[0], tr[2], tr[1]]));
  }
  const vv = new Float32Array(verts.length * 3);
  verts.forEach((q, i) => vv.set(q, i * 3));
  return { v: vv, t: new Uint32Array(out), f: new Uint32Array(faces.length).map((_, i) => +(i < patch)) };
}
