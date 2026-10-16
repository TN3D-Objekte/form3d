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

// Nach dem Löschen einer Rundung/Fase: Kanten von mesh, die im Bereich box ({ min, max }) liegen und in
// before noch nicht scharf waren – also die wieder scharf gewordenen Kanten. Liefert ihre Nummern.
export function restoredChains(mesh, before, box) {
  const old = analyze(before).sharp, ov = before.v, v = mesh.v;
  const OP = i => [ov[i * 3], ov[i * 3 + 1], ov[i * 3 + 2]], P = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  const inBox = q => q.every((x, k) => x >= box.min[k] && x <= box.max[k]);
  const onOld = q => {
    for (let s = 0; s < old.length; s += 2) {
      const a = OP(old[s]), ab = sub(OP(old[s + 1]), a), l2 = dot(ab, ab);
      const u = l2 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
      if (Math.hypot(...sub(q, add(a, ab, u))) < 1e-3) return true;
    }
    return false;
  };
  const out = [];
  edgeChains(mesh).forEach((c, i) => {
    const mids = c.segs.map(g => add(P(g.u), sub(P(g.v), P(g.u)), 0.5));
    if (mids.filter(q => inBox(q) && !onOld(q)).length * 2 > mids.length) out.push(i);
  });
  return out;
}

export function isConvex(mesh, chain) {
  const { fn, weld } = analyze(mesh), { v, t } = mesh, s0 = chain.segs[0];
  const c2 = [t[3 * s0.t2], t[3 * s0.t2 + 1], t[3 * s0.t2 + 2]].find(i => weld[i] !== s0.u && weld[i] !== s0.v);
  const e = [0, 1, 2].map(k => v[c2 * 3 + k] - v[s0.u * 3 + k]);
  return dot([fn[3 * s0.t1], fn[3 * s0.t1 + 1], fn[3 * s0.t1 + 2]], e) < 0;
}

// Werkzeugkörper für eine Kante. Konvexe Kanten: Werkzeug wird abgezogen, konkave: angefügt.
// trim: Ebenen { n, o }, an denen der Kern das Werkzeug abschneidet (behalten wird n·x ≥ o).
// chains: alle Kanten, die im selben Schritt verrundet werden (für die Enden an gemeinsamen Ecken).
export function buildEdgeTool(mesh, chain, kind, size, chains = []) {
  return { ...edgeTool(mesh, chain, kind, size, 0, chains), heal: edgeTool(mesh, chain, kind, size, GROW, chains).mesh };
}

// grow: Profil um diesen Betrag ins Material (bzw. bei Innenkanten in den Hohlraum) versetzt. Daraus wird
// das Volumen gemerkt, mit dem sich die Rundung wieder löschen lässt; so liegen beim Löschen keine
// Flächen genau aufeinander.
function edgeTool(mesh, chain, kind, size, grow, chains) {
  const { fn, weld } = analyze(mesh), { v, t } = mesh, segs = chain.segs, m = segs.length;
  const P = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  const nrm = ti => [fn[3 * ti], fn[3 * ti + 1], fn[3 * ti + 2]];
  const dirs = segs.map(s => norm(sub(P(s.v), P(s.u))));

  const convex = isConvex(mesh, chain), sgn = convex ? 1 : -1;

  const M = chain.closed ? m : m + 1;
  const surf = nearTriangles(mesh, chain, 12 * size + 1);
  const frames = Array.from({ length: M }, (_, i) => {
    const near = [chain.closed ? (i - 1 + m) % m : i - 1, i < m ? i : -1].filter(k => k >= 0);
    const sum = f => norm(near.map(f).reduce((a, b) => add(a, b)));
    return { near, tau: sum(k => dirs[k]), N1: sum(k => nrm(segs[k].t1)), N2: sum(k => nrm(segs[k].t2)), p: i < m ? P(segs[i].u) : P(segs[m - 1].v) };
  });
  // Feinheit des Bogens nach dem stärksten Bogen der ganzen Kante – nicht nach dem ersten Profil, sonst hinge das
  // Werkzeug davon ab, wo die Kette im Netz beginnt
  const nArc = Math.max(...frames.map(f => profile(f.p, f.tau, f.N1, f.N2, kind, size, sgn, 0).nArc));
  const rings = [];
  for (let i = 0; i < M; i++) {
    const { near, tau, N1, N2, p } = frames[i];
    const pr = profile(p, tau, N1, N2, kind, size, sgn, grow, nArc, surf), { t1, t2, d } = pr;
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
    rings.push(pr.ring);
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
      if (c >= 0.05) {
        // Die Verlängerung bleibt nur hinter (beim Abziehen: vor) der Endfläche, wenn das Profil nicht seitlich
        // über sie hinausragt. An stumpfen Ecken tut es das. Wird die Nachbarkante (zwischen dieser Fläche und
        // der Endfläche) mitverrundet, endet das Werkzeug an der Gehrung zwischen der anderen Fläche der Kante
        // und der Endfläche (knapp darüber hinaus, damit sich die Werkzeuge überlappen). Sonst läuft die Rundung
        // bis in die Endfläche durch (knapp über sie hinaus) – an der Gehrung bliebe ein spitzer Zipfel stehen.
        if (ends.length === 1) {
          const ne = ends[0];
          const has = (g, n) => [nrm(g.t1), nrm(g.t2)].some(m => dot(m, n) > 0.999);
          const filleted = nk => chains.some(o => o !== chain && !o.closed && [o.segs[0].u === vi && o.segs[0], o.segs[o.segs.length - 1].v === vi && o.segs[o.segs.length - 1]]
            .some(g => g && has(g, nk) && has(g, ne)));
          for (const [nk, nj] of [[n1, n2], [n2, n1]]) {
            let tk = norm(cross(nk, out));
            if (dot(tk, nj) * sgn > 0) tk = tk.map(x => -x); // in der Fläche von der Kante weg
            if (-sgn * dot(ne, tk) <= 0.05 || dot(ne, nj) > 0.98) continue; // tangential anschließend: keine Ecke
            const keep = filleted(nk) ? norm(sub(ne, nj).map(x => -sgn * x)) : ne.map(x => -sgn * x), o = dot(keep, p) - 0.01;
            if (chain.pts.some(q => dot(keep, q) < o - 1e-6)) break;
            trim.push({ n: keep, o });
            break;
          }
        }
        return len(c);
      }
      // genau eine Endfläche: Seite der Kante behalten
      const ne = ends[0], ce = ends.length === 1 ? dot(ne, out) : 0;
      if (Math.abs(ce) < 0.1) return -GAP;
      // Steht die Endfläche schräg (z. B. spitze Zunge), bliebe zwischen ihrer Ebene und der Ecke ein dünner
      // Keil des Werkzeugs stehen – beim Anfügen frei in der Luft, beim Abziehen als Schlitz im Material.
      // Dann endet das Werkzeug genau im Querschnitt an der Ecke.
      const flat = Math.abs(ce) > 0.99, keep = flat ? (ce > 0 ? ne.map(x => -x) : ne) : out.map(x => -x), o = dot(keep, p);
      if (chain.pts.some(q => dot(keep, q) < o - 1e-6)) return -GAP;
      trim.push({ n: keep, o });
      return len(flat ? Math.abs(ce) : 1);
    };
    const e0 = endExt(segs[0].u, dirs[0].map(x => -x), segs[0]), e1 = endExt(segs[m - 1].v, dirs[m - 1], segs[m - 1]);
    if (e0 > 0) rings.unshift(rings[0].map(q => add(q, dirs[0], -e0)));
    else rings[0] = rings[0].map(q => add(q, dirs[0], GAP));
    if (e1 > 0) rings.push(rings[rings.length - 1].map(q => add(q, dirs[m - 1], e1)));
    else rings[rings.length - 1] = rings[rings.length - 1].map(q => add(q, dirs[m - 1], -GAP));
  }

  return { convex, mesh: tube(rings, chain.closed), trim };
}

// Dreiecke in der Nähe der Kette (Abstand bis reach), um Profilendpunkte genau auf die Fläche zu legen;
// blend: Dreieck einer vorhandenen Rundung/Fase
function nearTriangles(mesh, chain, reach) {
  const { fn, tg, weld } = analyze(mesh), { v, t } = mesh, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const q of chain.pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k] - reach); hi[k] = Math.max(hi[k], q[k] + reach); }
  const out = [];
  for (let ti = 0; ti < t.length / 3; ti++) {
    const c = [0, 1, 2].map(k => { const i = t[3 * ti + k] * 3; return [v[i], v[i + 1], v[i + 2]]; });
    if ([0, 1, 2].some(k => Math.max(c[0][k], c[1][k], c[2][k]) < lo[k] || Math.min(c[0][k], c[1][k], c[2][k]) > hi[k])) continue;
    out.push({ c, n: [fn[3 * ti], fn[3 * ti + 1], fn[3 * ti + 2]], tag: tg[ti], blend: tg[ti] > 0, w: [0, 1, 2].map(k => weld[t[3 * ti + k]]), area: Math.hypot(...cross(sub(c[1], c[0]), sub(c[2], c[0]))) / 2 });
  }
  return out;
}

// nächster Punkt auf dem Dreieck abc zu p (Ericson, Real-Time Collision Detection 5.1.5)
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

// Profil des Werkzeugs an Kantenpunkt p (Richtung tau, Flächennormalen N1, N2): A und B in den Flächen im
// Abstand d von der Kante, dazwischen außen die Ecke Q, innen der Rundungsbogen von B nach A (nArc Stücke;
// 0 = selbst wählen). grow: siehe edgeTool.
function profile(p, tau, N1, N2, kind, size, sgn, grow, nArc = 0, surf) {
  const t1 = norm(cross(N1, tau)), t2 = norm(cross(tau, N2)); // in den Flächen, von der Kante weg
  const alpha = Math.acos(Math.max(-1, Math.min(1, dot(t1, t2))));
  const d = kind === 'fillet' ? size / Math.tan(alpha / 2) : size;
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
  // Steht die Kante schräg zu einer gekrümmten, facettierten Fläche (z. B. Loch in einer schrägen Fläche),
  // reicht der Endpunkt A bzw. B im Profilschnitt seitlich über seine Facette hinaus und liegt minimal im
  // Material – das Werkzeug kerbt dann je Facette die Fläche ein. Ist die Fläche extrudiert (alle Facetten in
  // der Nähe senkrecht zu einer Achse, z. B. Lochwand), wird der Endpunkt auf die Linie parallel zur Achse
  // durch p gelegt; sie liegt genau auf der Fläche, und benachbarte Profile enden in derselben Facette.
  // Vorhandene Rundungen in der Nähe zählen dabei nicht mit, sonst wechselte das Verfahren von Profil zu Profil.
  // Sonst kommt er auf den nächsten Punkt der Fläche. Der Bogen wird anteilig mitgeführt (erst nach grow, das
  // sich auf den Mittelpunkt C des unverschobenen Bogens bezieht). Ebene Flächen bleiben unberührt.
  const nArcPts = ring.length - 5, sides = [[N1, N2, t1, 0, 1, j => (j - 4) / (nArcPts + 1)], [N2, N1, t2, 4, 3, j => 1 - (j - 4) / (nArcPts + 1)]];
  const shifts = [null, null];
  if (surf) {
    for (const [si, [N, No, tt, end]] of sides.entries()) {
      const reach = 2 * d + 1, ns = [];
      for (const f of surf) {
        const c = dot(f.n, N);
        // winzige Dreiecke (Splitter aus Booleschen Operationen) haben ungenaue Normalen
        if (f.blend || f.area < 1e-3 || c < 0.9 || c <= dot(f.n, No) || f.c.every(q => Math.hypot(...sub(q, p)) > reach)) continue;
        if (!ns.some(n => dot(n, f.n) > 1 - 1e-9)) ns.push(f.n);
      }
      let lo = 1, ax = null;
      for (let a = 0; a < ns.length; a++) for (let b = a + 1; b < ns.length; b++) { const c = dot(ns[a], ns[b]); if (c < lo) { lo = c; ax = norm(cross(ns[a], ns[b])); } }
      if (lo > 0.99996) continue; // eben (Facetten weniger als 0,5° gegeneinander geneigt)
      let to = null;
      if (ns.every(n => Math.abs(dot(n, ax)) < 2e-3)) {
        const c = dot(ax, tt);
        if (Math.abs(c) > 0.2) to = add(p, ax, d / c);
      }
      if (!to) {
        let bd = 0.3 * d;
        for (const f of surf) {
          const c = dot(f.n, N);
          if (c < 0.9 || c <= dot(f.n, No)) continue;
          const q = closestOnTri(ring[end], f.c), dd = Math.hypot(...sub(q, ring[end]));
          if (dd < bd) { bd = dd; to = q; }
        }
      }
      if (to) shifts[si] = { shift: sub(to, ring[end]), out: norm(sub(to, p)) };
    }
  }
  if (grow) {
    for (const j of [0, 4, ...ring.keys()].filter((j, k, a) => (j === 0 || j >= 4) && a.indexOf(j) === k)) ring[j] = add(ring[j], toward(ring[j]), grow);
    // auch seitlich über A und B hinaus: sonst endet das gemerkte Volumen auf der Fläche genau an derselben Linie
    // wie die Rundung, und beim Zurückfügen bleiben dort hauchdünne Splitter stehen
    for (const [si, [, , tt, end, eps]] of sides.entries()) for (const j of [end, eps]) ring[j] = add(ring[j], shifts[si]?.out || tt, grow);
  }
  for (const [si, [, , , end, eps, w]] of sides.entries()) {
    const sh = shifts[si]?.shift;
    if (!sh) continue;
    ring[end] = add(ring[end], sh);
    ring[eps] = add(ring[eps], sh);
    for (let j = 5; j < ring.length; j++) ring[j] = add(ring[j], sh, w(j));
  }
  return { ring, nArc, t1, t2, d };
}

// Röhre durch die Profile rings (offen: mit Deckeln), nach außen orientiert. mesh.f markiert die
// Dreiecke der Rundungs-/Fasenfläche.
function tube(rings, closed) {
  const R = rings.length, N = rings[0].length, verts = new Float32Array(R * N * 3), tris = [];
  rings.forEach((r, k) => r.forEach((q, j) => verts.set(q, (k * N + j) * 3)));
  const spans = closed ? R : R - 1;
  const surf = []; // 1 = Dreieck der Rundungs-/Fasenfläche (Profil von B über den Bogen nach A)
  for (let k = 0; k < spans; k++) {
    const a = k * N, b = ((k + 1) % R) * N;
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      tris.push(a + j, b + j, b + j2, a + j, b + j2, a + j2);
      surf.push(+(j >= 4), +(j >= 4));
    }
  }
  if (!closed) {
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
  return { v: verts, t: new Uint32Array(tris), f: new Uint32Array(surf) };
}

// Eckübergang: Laufen drei verrundete Kanten in einer Ecke zusammen, schneiden sich die Kantenwerkzeuge
// sonst zu einer Spitze. Wie bei einer rollenden Kugel wird die Ecke durch ein Kugelstück ersetzt:
// Werkzeug = Kegel vom Kugelmittelpunkt zur Ecke abzüglich Kugel. Die Kugel ist um GAP größer, damit
// sie die Zylinderflächen der Kantenwerkzeuge schneidet statt sie nur zu berühren.
export function cornerTools(mesh, chains, kind, size) {
  const { fn } = analyze(mesh), v = mesh.v;
  const P = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  const nrm = ti => [fn[3 * ti], fn[3 * ti + 1], fn[3 * ti + 2]];
  const ends = new Map();
  chains.forEach((ch, ci) => {
    if (ch.closed) return;
    const convex = isConvex(mesh, ch), f = ch.segs[0], l = ch.segs[ch.segs.length - 1];
    for (const [vi, s, out] of [[f.u, f, norm(sub(P(f.u), P(f.v)))], [l.v, l, norm(sub(P(l.v), P(l.u)))]]) {
      if (!ends.has(vi)) ends.set(vi, []);
      ends.get(vi).push({ convex, ci, out, normals: [nrm(s.t1), nrm(s.t2)] });
    }
  });
  const tools = [];
  for (const [vi, list] of ends) {
    if (list.length === 2 && !list[0].convex && !list[1].convex) {
      const w = wrapTool(P(vi), list, kind, size);
      if (w) tools.push(w);
    }
    if (kind !== 'fillet' || list.length !== 3 || list.some(e => e.convex !== list[0].convex)) continue;
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

// Zwei Innenrundungen (gemeinsame Bodenfläche) enden an einer nach außen stehenden, nicht verrundeten Kante,
// z. B. an der Spitze einer Zunge in einer Tasche. Wie eine rollende Kugel läuft die Rundung um diese Kante
// herum: Das Profil am Ende der einen Rundung wird um die Kante zum Profil der anderen gedreht.
function wrapTool(p, [ea, eb], kind, size) {
  const floor = ea.normals.find(n => eb.normals.some(m => dot(m, n) > 0.999));
  if (!floor) return null;
  const side = e => {
    const wall = e.normals.find(n => dot(n, floor) <= 0.999);
    let u = norm(cross(floor, e.out));
    if (dot(u, wall) < 0) u = u.map(x => -x); // auf dem Boden von der Kante weg
    return { wall, u, tau: dot(cross(floor, e.out), u) > 0 ? e.out : e.out.map(x => -x) };
  };
  const A = side(ea), B = side(eb);
  if (!A.wall || !B.wall || dot(B.u, ea.out) < 0.05 || dot(A.u, eb.out) < 0.05) return null;
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(A.u, B.u))));
  const ax = norm(cross(A.u, ea.out)), rot = (q, th) => {
    const r = sub(q, p), c = Math.cos(th), s = Math.sin(th);
    return add(p, add(add(r.map(x => x * c), cross(ax, r), s), ax, dot(ax, r) * (1 - c)));
  };
  // etwas über beide Enden hinaus, damit sich das Stück mit den Kantenwerkzeugen überlappt
  const delta = 0.05, K = Math.max(2, Math.ceil((phi + 2 * delta) / (Math.PI / 24)));
  const rings = grow => {
    const pa = profile(p, A.tau, floor, A.wall, kind, size, -1, grow), pb = profile(p, B.tau, floor, B.wall, kind, size, -1, grow, pa.nArc);
    return Array.from({ length: K + 1 }, (_, k) => {
      const th = -delta + (phi + 2 * delta) * k / K, s = Math.max(0, Math.min(1, th / phi));
      return pa.ring.map((q, j) => { const qa = rot(q, th), qb = rot(pb.ring[j], th - phi); return add(qa.map(x => x * (1 - s)), qb, s); });
    });
  };
  return { convex: false, mesh: tube(rings(0), false), heal: tube(rings(GROW), false), chains: [ea.ci, eb.ci] };
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

// ---------------------------------------------------------------- Übergang zwischen zwei Rundungen
// Schneiden sich zwei Rundungen (z. B. obere und untere Lochkante, die sich an der flachen Stelle eines Lochs
// in einer schrägen Fläche fast berühren), bleibt zwischen ihren Flächen eine Kante. creaseChains findet sie:
// Kanten zwischen Dreiecken einer neuen (isNew) und einer schon vorhandenen Kennung, mit deutlichem Knick.
// Rundungen aus demselben Schritt treffen sich an Ecken bewusst auf Gehrung (siehe cornerTools). Ergebnis: Ketten wie bei edgeChains (t1 auf der Seite tags[0]).
const COS_CREASE = Math.cos(12 * Math.PI / 180);
export function creaseChains(mesh, isNew) {
  const { tg, fn, pairs } = analyze(mesh), byPair = new Map();
  for (let k = 0; k < pairs.length; k += 4) {
    const i = pairs[k], j = pairs[k + 1], a = tg[i], b = tg[j];
    if (!a || !b || a === b || isNew(a) === isNew(b)) continue;
    const key = Math.min(a, b) + ',' + Math.max(a, b);
    if (!byPair.has(key)) byPair.set(key, []);
    const g = { u: pairs[k + 2], v: pairs[k + 3], t1: i, t2: j };
    byPair.get(key).push(a < b ? g : { u: g.v, v: g.u, t1: j, t2: i });
  }
  const v = mesh.v, P = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]], out = [];
  for (const [key, segs] of byPair) {
    const from = new Map(segs.map(g => [g.u, g])), into = new Set(segs.map(g => g.v)), used = new Set();
    for (const g0 of segs) {
      if (used.has(g0) || (into.has(g0.u) && segs.some(g => !used.has(g) && !into.has(g.u)))) continue;
      const list = [];
      for (let g = g0; g && !used.has(g); g = from.get(g.v)) { used.add(g); list.push(g); }
      const closed = list.length > 2 && list[list.length - 1].v === list[0].u;
      const bend = Math.min(...list.map(g => fn[3 * g.t1] * fn[3 * g.t2] + fn[3 * g.t1 + 1] * fn[3 * g.t2 + 1] + fn[3 * g.t1 + 2] * fn[3 * g.t2 + 2]));
      if (list.length < 2 || bend > COS_CREASE) continue;
      out.push({ segs: list, closed, pts: [P(list[0].u), ...list.map(g => P(g.v))], tags: key.split(',').map(Number) });
    }
  }
  return out;
}

// Werkzeug für den Übergang: Eine Kugel mit Radius R rollt an der Kante entlang und berührt beide (gekrümmten)
// Rundungsflächen. Je Kantenpunkt wird ihr Mittelpunkt C in der Ebene quer zur Kante iterativ bestimmt
// (Abstand R zu den nächsten Punkten beider Flächen). Wo die Flächen tangential zusammenlaufen (an den Enden
// der Kante), wird das Profil beliebig klein; dort endet das Werkzeug.
export function creaseTool(mesh, chain, R) {
  return { ...creaseMesh(mesh, chain, R, 0), heal: creaseMesh(mesh, chain, R, GROW)?.mesh };
}
function creaseMesh(mesh, chain, R, grow) {
  const { fn } = analyze(mesh), segs = chain.segs, m = segs.length, v = mesh.v;
  const P = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]], nrm = ti => [fn[3 * ti], fn[3 * ti + 1], fn[3 * ti + 2]];
  const convex = isConvex(mesh, chain), sgn = convex ? 1 : -1;
  const near = nearTriangles(mesh, chain, 4 * R + 1);
  // je Seite die Dreiecke der Rundungsfläche und geglättete Eckennormalen (die Facettennormalen springen)
  const sides = chain.tags.map(tag => {
    const tris = near.filter(f => f.tag === tag), vn = new Map();
    for (const f of tris) for (const w of f.w) vn.set(w, add(vn.get(w) || [0, 0, 0], f.n, f.area));
    for (const [w, n] of vn) vn.set(w, norm(n));
    return { tris, vn };
  });
  // nächster Punkt der Fläche mit interpolierter Normale
  const foot = (q, { tris, vn }) => {
    let best = null, bd = Infinity;
    for (const f of tris) { const c = closestOnTri(q, f.c), d = Math.hypot(...sub(c, q)); if (d < bd) { bd = d; best = { q: c, f }; } }
    if (!best) return null;
    const [a, b, c] = best.f.c, n0 = cross(sub(b, a), sub(c, a)), l2 = dot(n0, n0) || 1;
    const wb = dot(cross(sub(best.q, a), sub(c, a)), n0) / l2, wc = dot(cross(sub(b, a), sub(best.q, a)), n0) / l2, wa = 1 - wb - wc;
    const n = norm([0, 1, 2].map(k => wa * vn.get(best.f.w[0])[k] + wb * vn.get(best.f.w[1])[k] + wc * vn.get(best.f.w[2])[k]));
    return { q: best.q, n };
  };
  // Die Kugel taucht unter dem Winkel DIP in die Flächen ein statt sie genau zu berühren: Tangential an einer
  // facettierten Fläche wäre die Schnittlinie instabil und ausgefranst. Der Knick bleibt unter der Kantenschwelle.
  const DIP = 6 * Math.PI / 180, Rs = R * Math.cos(DIP);
  const prof = [];
  const solve = (p, tau, C) => {
    for (let it = 0; it < 10; it++) {
      const A = foot(C, sides[0]), B = foot(C, sides[1]);
      if (!A || !B) return null;
      // nA·(C − A) = −sgn·Rs, nB·(C − B) = −sgn·Rs, tau·(C − p) = 0
      const rows = [A.n, B.n, tau], rhs = [dot(A.n, A.q) - sgn * Rs, dot(B.n, B.q) - sgn * Rs, dot(tau, p)];
      const det = dot(rows[0], cross(rows[1], rows[2]));
      if (Math.abs(det) < 1e-3) return null;
      const Cn = [cross(rows[1], rows[2]), cross(rows[2], rows[0]), cross(rows[0], rows[1])].reduce((acc, c, k) => add(acc, c, rhs[k] / det), [0, 0, 0]);
      const step = Math.hypot(...sub(Cn, C));
      C = Cn;
      if (step < 1e-7) break;
    }
    return C;
  };
  // Die Schnittkante zweier facettierter Flächen ist eine Zickzacklinie; die Querschnitte kämen sonst schief.
  // Daher gleichmäßig neu abtasten und glätten (Enden offener Kanten fest).
  let pts = chain.pts.slice(0, chain.closed ? -1 : undefined);
  const cum = [0];
  for (let i = 1; i <= pts.length - (chain.closed ? 0 : 1); i++) cum.push(cum[i - 1] + Math.hypot(...sub(pts[i % pts.length], pts[i - 1])));
  const len = cum[cum.length - 1], h = Math.max(0.03, Math.min(0.2, R / 3)), n = Math.max(2, Math.round(len / h));
  const at = s0 => {
    let k = 1;
    while (k < cum.length - 1 && cum[k] < s0) k++;
    const u = (s0 - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
    return add(pts[k - 1], sub(pts[k % pts.length], pts[k - 1]), u);
  };
  pts = Array.from({ length: chain.closed ? n : n + 1 }, (_, k) => at(len * k / n));
  const M = pts.length;
  for (let it = 0; it < 6; it++) pts = pts.map((q, k) => {
    const a = pts[k - 1] ?? (chain.closed ? pts[M - 1] : null), b = pts[k + 1] ?? (chain.closed ? pts[0] : null);
    return a && b ? add(q.map(x => x * 0.5), add(a, b), 0.25) : q;
  });
  for (let i = 0; i < M; i++) {
    const p = pts[i], a = pts[i - 1] ?? (chain.closed ? pts[M - 1] : p), b = pts[i + 1] ?? (chain.closed ? pts[0] : p);
    const tau = norm(sub(b, a)), fa = foot(p, sides[0]), fb = foot(p, sides[1]);
    if (!fa || !fb) { prof.push(null); continue; }
    const N1 = fa.n, N2 = fb.n, t1 = norm(cross(N1, tau)), t2 = norm(cross(tau, N2)), alpha = Math.acos(Math.max(-1, Math.min(1, dot(t1, t2))));
    const C = Math.PI - alpha < 0.02 ? null : solve(p, tau, add(p, norm(add(t1, t2)), R / Math.sin(alpha / 2)));
    prof.push(C && Math.hypot(...sub(C, p)) < 4 * R ? { p, tau, C, N1, N2 } : null);
  }
  // längster zusammenhängender Abschnitt mit gültigen Profilen
  let run = [], cur = [];
  for (let i = 0; i < M; i++) { if (prof[i]) { cur.push(i); if (cur.length > run.length) run = cur.slice(); } else cur = []; }
  const closedRun = chain.closed && run.length === M;
  if (run.length < 2) return null;
  // Bahn des Mittelpunkts glätten (Enden offener Abschnitte fest), in der Querebene halten
  for (let it = 0; it < 6; it++) {
    const next = run.map((i, k) => {
      const a = run[k - 1] ?? (closedRun ? run[run.length - 1] : null), b = run[k + 1] ?? (closedRun ? run[0] : null);
      if (a == null || b == null) return prof[i].C;
      const c = add(prof[i].C.map(x => x * 0.5), add(prof[a].C, prof[b].C), 0.25);
      return add(c, prof[i].tau, -dot(prof[i].tau, sub(c, prof[i].p)));
    });
    run.forEach((i, k) => { prof[i].C = next[k]; });
  }
  const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  // Richtung vom Mittelpunkt zum Berührpunkt = Flächennormale (bei Innenkanten umgekehrt), dann um DIP von der
  // Kante weg gekippt – fest aus Normale und Kantenrichtung, auch wo beide Flächen fast parallel laufen
  const ends = run.map(i => {
    const { C, tau } = prof[i], fa = foot(C, sides[0]), fb = foot(C, sides[1]);
    const tA = norm(cross(fa.n, tau)), tB = norm(cross(tau, fb.n));
    const eA = norm(add(fa.n.map(x => x * sgn * Math.cos(DIP)), tA, Math.sin(DIP))), eB = norm(add(fb.n.map(x => x * sgn * Math.cos(DIP)), tB, Math.sin(DIP)));
    return { eA, eB, nA: fa.n, nB: fb.n };
  });
  const nArc = Math.max(3, ...ends.map(e => Math.round(angle(e.eA, e.eB) / (Math.PI / 24))));
  // offene Enden auf der Länge R auf null verjüngen, statt abrupt mit einer Stufe zu enden
  const sAt = run.map((i, k) => (k ? Math.hypot(...sub(prof[i].p, prof[run[k - 1]].p)) : 0)).reduce((acc, x) => [...acc, (acc[acc.length - 1] ?? 0) + x], []);
  const taper = k => { if (closedRun) return 1; const e = Math.min(sAt[k], sAt[sAt.length - 1] - sAt[k]) / R; return e >= 1 ? 1 : Math.max(0.03, e * e * (3 - 2 * e)); };
  const rings = run.map((i, k) => {
    const { p, C, N1, N2 } = prof[i], { eA, eB, nA, nB } = ends[k];
    const A = add(C, eA, R), B = add(C, eB, R), phi = angle(eA, eB), sp = Math.sin(phi) || 1;
    const Q = add(p, add(N1, N2), sgn * EPS / Math.max(0.2, 1 + dot(N1, N2)));
    let ring = [A, add(A, nA, sgn * EPS), Q, add(B, nB, sgn * EPS), B], a = A, b = B, c = C;
    for (let j = 1; j < nArc; j++) {
      const s = j / nArc, wa = phi > 1e-6 ? Math.sin(s * phi) / sp : s, wb = phi > 1e-6 ? Math.sin((1 - s) * phi) / sp : 1 - s;
      ring.push(add(C, add(eA.map(x => x * wa), eB, wb), R));
    }
    const f = taper(k);
    if (f < 1) {
      // Querschnitt zum Kantenpunkt hin zusammenziehen. Die Randpunkte lägen dann auf Sehnen unter den
      // gekrümmten Flächen, und die Hilfspunkte darüber schnitten eine flache Tasche ins Material (eine Falte
      // am Ende des Übergangs). Daher die Randpunkte auf die Flächen legen und die Hilfspunkte darüber.
      ring = ring.map(q => add(p, sub(q, p), f));
      const fa = foot(ring[0], sides[0]), fb = foot(ring[4], sides[1]);
      if (fa && fb) ring.splice(0, 5, fa.q, add(fa.q, fa.n, sgn * EPS), Q, add(fb.q, fb.n, sgn * EPS), fb.q);
      a = ring[0]; b = ring[4]; c = add(p, sub(C, p), f);
    }
    if (grow) {
      for (const j of [0, ...ring.keys()].filter(j => j === 0 || j >= 4)) ring[j] = add(ring[j], norm(sub(c, ring[j])), grow);
      for (const [j, e] of [[0, a], [1, a], [3, b], [4, b]]) ring[j] = add(ring[j], norm(sub(e, p)), grow);
    }
    return ring;
  });
  return { convex, mesh: tube(rings, closedRun), trim: [] };
}

// Übergänge für frisch angelegte Rundungen (fresh: deren Kennungen) zu vorhandenen: je Schnittkante ein Werkzeug
// mit dem halben Radius der kleineren Rundung (konvexe Rundungsflächen lassen höchstens ihren eigenen Radius zu).
// Der Übergang hängt an beiden Rundungen (links) und verschwindet mit jeder von ihnen. tag: erste freie Kennung.
export function transitionTools(mesh, features, fresh, tag) {
  const byTag = new Map(features.map(f => [f.tag, f])), isNew = t => fresh.includes(t), out = [];
  for (const c of creaseChains(mesh, isNew)) {
    const [fa, fb] = c.tags.map(t => byTag.get(t));
    if (fa?.kind !== 'fillet' || fb?.kind !== 'fillet') continue;
    const R = 0.5 * Math.min(fa.size, fb.size), t = creaseTool(mesh, c, R);
    if (t.mesh && t.heal) out.push(Object.assign(t, { tag: tag++, kind: 'transition', size: R, links: c.tags }));
  }
  return out;
}
