// 2D-Skizzengeometrie: Ebenen, Tessellierung, Fangpunkte und Erkennung geschlossener Flächen.
export const CIRCLE_SEGS = 64;
const TAU = Math.PI * 2;

export const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const same2 = (a, b) => dist2(a, b) < 1e-6;
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Ebene: { o, x, y, n } als Arrays, x × y = n
export const BASE_PLANES = {
  xy: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] },
  xz: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], n: [0, -1, 0] },
  yz: { o: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], n: [1, 0, 0] },
};

export function planeFromNormal(normal, point) {
  // Float32-Rauschen entfernen, damit achsparallele Flächen exakt am Raster liegen
  const n = norm3(normal.map(c => (Math.abs(c) < 1e-5 ? 0 : c)));
  const d = Math.round(dot3(n, point) * 1e4) / 1e4;
  const x = Math.abs(n[2]) > 0.9999 ? [1, 0, 0] : norm3(cross3([0, 0, 1], n));
  return { o: [n[0] * d, n[1] * d, n[2] * d], x, y: cross3(n, x), n };
}

export const to3D = (pl, p) => [0, 1, 2].map(k => pl.o[k] + pl.x[k] * p[0] + pl.y[k] * p[1]);
export const to2D = (pl, q) => {
  const r = [q[0] - pl.o[0], q[1] - pl.o[1], q[2] - pl.o[2]];
  return [dot3(r, pl.x), dot3(r, pl.y)];
};
export const planeDist = (pl, q) => dot3([q[0] - pl.o[0], q[1] - pl.o[1], q[2] - pl.o[2]], pl.n);
export const planeMatrix = pl => [...pl.x, 0, ...pl.y, 0, ...pl.n, 0, ...pl.o, 1];

// Elemente: line {a,b} | circle {c,r} | arc {c,r,a0,a1} (gegen den Uhrzeigersinn, a1 > a0)
export function tessellate(e) {
  if (e.type === 'line') return [e.a, e.b];
  const a0 = e.type === 'arc' ? e.a0 : 0, sweep = e.type === 'arc' ? e.a1 - e.a0 : TAU;
  const n = Math.max(2, Math.ceil(CIRCLE_SEGS * sweep / TAU));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + sweep * (i === n && e.type === 'circle' ? 0 : i / n);
    pts.push([e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]);
  }
  return pts;
}

export function arcFrom3(a, b, m) {
  const d = 2 * (a[0] * (b[1] - m[1]) + b[0] * (m[1] - a[1]) + m[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, m2 = m[0] ** 2 + m[1] ** 2;
  const c = [(a2 * (b[1] - m[1]) + b2 * (m[1] - a[1]) + m2 * (a[1] - b[1])) / d,
             (a2 * (m[0] - b[0]) + b2 * (a[0] - m[0]) + m2 * (b[0] - a[0])) / d];
  const ang = p => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const wrap = x => ((x % TAU) + TAU) % TAU;
  const as = ang(a), ae = ang(b), am = ang(m);
  const a0 = wrap(am - as) < wrap(ae - as) ? as : ae, a1 = a0 === as ? ae : as;
  return { c, r: dist2(a, c), a0, a1: a0 + wrap(a1 - a0) };
}

export function entityDistance(e, p) {
  if (e.type === 'line') {
    const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / l2));
    return dist2(p, [e.a[0] + t * dx, e.a[1] + t * dy]);
  }
  const radial = Math.abs(dist2(p, e.c) - e.r);
  if (e.type === 'circle') return radial;
  const a = (((Math.atan2(p[1] - e.c[1], p[0] - e.c[0]) - e.a0) % TAU) + TAU) % TAU;
  if (a <= e.a1 - e.a0) return radial;
  const end = t => [e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)];
  return Math.min(dist2(p, end(e.a0)), dist2(p, end(e.a1)));
}

export function snapCandidates(entities) {
  const out = [{ p: [0, 0], kind: 'origin' }];
  for (const e of entities) {
    const n0 = out.length;
    if (e.type === 'line') {
      out.push({ p: e.a, kind: 'end' }, { p: e.b, kind: 'end' },
               { p: [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], kind: 'mid' });
    } else {
      out.push({ p: e.c, kind: 'center' });
      const angs = e.type === 'arc' ? [e.a0, e.a1] : [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
      for (const a of angs) out.push({ p: [e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)], kind: 'end' });
    }
    for (let i = n0; i < out.length; i++) out[i].e = e.id;
  }
  return out;
}

// Ziehbare Punkte eines Elements: [Schlüssel, Koordinaten]
export function entityPoints(e) {
  if (e.type === 'line') return [['a', e.a], ['b', e.b]];
  if (e.type === 'circle') return [['c', e.c]];
  const end = t => [e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)];
  return [['c', e.c], ['s', end(e.a0)], ['e', end(e.a1)]];
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

const signedArea = pts => {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return s / 2;
};

export function regionCenter(r) {
  let x = 0, y = 0;
  for (const p of r.outer) { x += p[0]; y += p[1]; }
  return [x / r.outer.length, y / r.outer.length];
}

// Findet alle geschlossenen Flächen einer Skizze: Segmente an Schnittpunkten teilen,
// planaren Graphen aufbauen, Flächen umlaufen, Inseln als Löcher zuordnen.
export function computeRegions(entities) {
  const segs = [];
  for (const e of entities) {
    const pl = tessellate(e);
    for (let i = 0; i + 1 < pl.length; i++) segs.push([pl[i][0], pl[i][1], pl[i + 1][0], pl[i + 1][1]]);
  }
  const n = segs.length;
  if (!n) return [];

  const cuts = segs.map(() => [0, 1]);
  const E = 1e-9;
  for (let i = 0; i < n; i++) {
    const [ax, ay, bx, by] = segs[i], rx = bx - ax, ry = by - ay;
    const minx = Math.min(ax, bx) - 1e-6, maxx = Math.max(ax, bx) + 1e-6, miny = Math.min(ay, by) - 1e-6, maxy = Math.max(ay, by) + 1e-6;
    for (let j = i + 1; j < n; j++) {
      const [cx, cy, dx, dy] = segs[j];
      if (Math.max(cx, dx) < minx || Math.min(cx, dx) > maxx || Math.max(cy, dy) < miny || Math.min(cy, dy) > maxy) continue;
      const sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
      const rl = Math.hypot(rx, ry), sl = Math.hypot(sx, sy);
      if (Math.abs(den) > 1e-10 * rl * sl) {
        const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
        if (t > -E && t < 1 + E && u > -E && u < 1 + E) { cuts[i].push(t); cuts[j].push(u); }
      } else if (Math.abs((cx - ax) * ry - (cy - ay) * rx) < 1e-7 * rl) {
        // kollinear: Endpunkte gegenseitig als Teilungspunkte eintragen
        for (const [px, py] of [[cx, cy], [dx, dy]]) {
          const t = ((px - ax) * rx + (py - ay) * ry) / (rl * rl);
          if (t > E && t < 1 - E) cuts[i].push(t);
        }
        for (const [px, py] of [[ax, ay], [bx, by]]) {
          const u = ((px - cx) * sx + (py - cy) * sy) / (sl * sl);
          if (u > E && u < 1 - E) cuts[j].push(u);
        }
      }
    }
  }

  const vid = new Map(), V = [];
  const vert = (x, y) => {
    const k = Math.round(x * 1e4) + ',' + Math.round(y * 1e4);
    let i = vid.get(k);
    if (i === undefined) { i = V.length; V.push([x, y]); vid.set(k, i); }
    return i;
  };
  const edgeSet = new Set(), adj = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay, bx, by] = segs[i];
    const ts = cuts[i].map(t => Math.max(0, Math.min(1, t))).sort((a, b) => a - b);
    let prev = vert(ax, ay);
    for (let k = 1; k < ts.length; k++) {
      const cur = vert(ax + (bx - ax) * ts[k], ay + (by - ay) * ts[k]);
      if (cur !== prev) {
        const key = prev < cur ? prev + ',' + cur : cur + ',' + prev;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          (adj[prev] ||= []).push(cur);
          (adj[cur] ||= []).push(prev);
        }
      }
      prev = cur;
    }
  }
  const nV = V.length;
  for (let i = 0; i < nV; i++) adj[i] ||= [];

  // offene Enden entfernen
  const queue = [];
  for (let i = 0; i < nV; i++) if (adj[i].length === 1) queue.push(i);
  while (queue.length) {
    const i = queue.pop();
    if (adj[i].length !== 1) continue;
    const j = adj[i][0];
    adj[i] = [];
    adj[j].splice(adj[j].indexOf(i), 1);
    if (adj[j].length === 1) queue.push(j);
  }

  const comp = new Int32Array(nV).fill(-1);
  let nComp = 0;
  for (let i = 0; i < nV; i++) {
    if (comp[i] >= 0 || !adj[i].length) continue;
    const stack = [i];
    comp[i] = nComp;
    while (stack.length) for (const w of adj[stack.pop()]) if (comp[w] < 0) { comp[w] = nComp; stack.push(w); }
    nComp++;
  }
  for (let i = 0; i < nV; i++) {
    adj[i].sort((a, b) => Math.atan2(V[a][1] - V[i][1], V[a][0] - V[i][0]) - Math.atan2(V[b][1] - V[i][1], V[b][0] - V[i][0]));
  }

  const visited = new Set(), faces = [], outers = [];
  for (let u0 = 0; u0 < nV; u0++) for (const v0 of adj[u0]) {
    if (visited.has(u0 * nV + v0)) continue;
    const pts = [];
    let u = u0, v = v0, guard = 0;
    do {
      visited.add(u * nV + v);
      pts.push(V[u]);
      const list = adj[v], k = list.indexOf(u);
      const w = list[(k - 1 + list.length) % list.length];
      u = v; v = w;
    } while ((u !== u0 || v !== v0) && ++guard < 1e6);
    const area = signedArea(pts);
    if (area > 1e-7) faces.push({ pts, area, comp: comp[u0], holes: [], holeArea: 0 });
    else if (area < -1e-7) outers.push({ pts, area: -area, comp: comp[u0] });
  }

  for (const o of outers) {
    let best = null;
    for (const f of faces) {
      if (f.comp !== o.comp && f.area > o.area && (!best || f.area < best.area) && pointInPoly(o.pts[0], f.pts)) best = f;
    }
    if (best) { best.holes.push(o.pts); best.holeArea += o.area; }
  }
  return faces.map(f => ({ outer: f.pts, holes: f.holes, area: f.area - f.holeArea }));
}
