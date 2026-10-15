// Druckprüfung: Überhänge, dünne Wände, enge Spalte/Löcher und die beste Lage auf der Druckplatte.
// Je Dreieck ein Merkmal (Bitmaske), Flächen in mm². Die Druckplatte liegt bei der kleinsten Höhe des Körpers.
export const OVER = 1, THIN = 2, GAP = 4;
export const LIMITS = { overhang: 45, wall: 0.8, gap: 1.0 }; // Grad gegen die Senkrechte, mm, mm

let cache = new WeakMap(), orient = new WeakMap();
// Überhanggrenze: 45° ist fast immer sicher, bis 60° geht es mit guter Lüfterkühlung meist auch
export function setOverhang(deg) {
  LIMITS.overhang = deg;
  cache = new WeakMap(); orient = new WeakMap();
}

// Raster über die Dreiecke für kurze Strahlen (Wand-/Spaltdicke)
function triGrid(v, t, cell) {
  const cells = new Map(), key = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  for (let n = 0; n < t.length / 3; n++) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) {
      const x = v[t[3 * n + c] * 3 + k];
      lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x);
    }
    for (let i = Math.floor(lo[0] / cell); i <= Math.floor(hi[0] / cell); i++)
      for (let j = Math.floor(lo[1] / cell); j <= Math.floor(hi[1] / cell); j++)
        for (let k = Math.floor(lo[2] / cell); k <= Math.floor(hi[2] / cell); k++) {
          const h = key(i, j, k);
          if (!cells.has(h)) cells.set(h, []);
          cells.get(h).push(n);
        }
  }
  // Dreiecke in den Zellen um eine Strecke p → p + d·len
  return (p, d, len) => {
    const out = new Set();
    const a = p.map(x => Math.floor(x / cell)), b = p.map((x, k) => Math.floor((x + d[k] * len) / cell));
    for (let i = Math.min(a[0], b[0]); i <= Math.max(a[0], b[0]); i++)
      for (let j = Math.min(a[1], b[1]); j <= Math.max(a[1], b[1]); j++)
        for (let k = Math.min(a[2], b[2]); k <= Math.max(a[2], b[2]); k++) for (const n of cells.get(key(i, j, k)) || []) out.add(n);
    return out;
  };
}

// Abstand entlang d bis Dreieck n (Möller–Trumbore), sonst Infinity
function hit(v, t, n, p, d) {
  const P = c => [v[t[3 * n + c] * 3], v[t[3 * n + c] * 3 + 1], v[t[3 * n + c] * 3 + 2]];
  const a = P(0), b = P(1), c = P(2);
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const q = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * q[0] + e1[1] * q[1] + e1[2] * q[2];
  if (Math.abs(det) < 1e-12) return Infinity;
  const s = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], u = (s[0] * q[0] + s[1] * q[1] + s[2] * q[2]) / det;
  if (u < -1e-9 || u > 1 + 1e-9) return Infinity;
  const r = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const w = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / det;
  if (w < -1e-9 || u + w > 1 + 1e-9) return Infinity;
  const dist = (e2[0] * r[0] + e2[1] * r[1] + e2[2] * r[2]) / det;
  return dist > 0 ? dist : Infinity;
}

function normals(v, t) {
  const nT = t.length / 3, fn = new Float32Array(nT * 3), fa = new Float32Array(nT);
  for (let n = 0; n < nT; n++) {
    const a = t[3 * n] * 3, b = t[3 * n + 1] * 3, c = t[3 * n + 2] * 3;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    const x = uy * wz - uz * wy, y = uz * wx - ux * wz, z = ux * wy - uy * wx, l = Math.hypot(x, y, z);
    fa[n] = l / 2;
    if (l > 1e-20) { fn[3 * n] = x / l; fn[3 * n + 1] = y / l; fn[3 * n + 2] = z / l; }
  }
  return { fn, fa };
}

// Überhang- und Auflagefläche bei Blickrichtung „unten“ = −down (Einheitsvektor, Standard −Z)
function overhangOf(v, t, fn, fa, down = [0, 0, -1]) {
  const cosO = Math.cos(LIMITS.overhang * Math.PI / 180);
  let lo = Infinity;
  for (let i = 0; i < v.length; i += 3) lo = Math.min(lo, -(v[i] * down[0] + v[i + 1] * down[1] + v[i + 2] * down[2]));
  let over = 0, bed = 0;
  const flags = new Uint8Array(t.length / 3);
  for (let n = 0; n < t.length / 3; n++) {
    const dn = fn[3 * n] * down[0] + fn[3 * n + 1] * down[1] + fn[3 * n + 2] * down[2]; // 1 = zeigt nach unten
    if (dn <= cosO + 1e-3) continue; // genau 45° (z. B. Fase) gilt noch als druckbar
    let onBed = true;
    for (let c = 0; c < 3; c++) {
      const i = t[3 * n + c] * 3;
      if (-(v[i] * down[0] + v[i + 1] * down[1] + v[i + 2] * down[2]) > lo + 0.05) { onBed = false; break; }
    }
    if (onBed) bed += fa[n];
    else { over += fa[n]; flags[n] = OVER; }
  }
  return { over, bed, flags };
}

export function checkPrint(mesh) {
  let r = cache.get(mesh);
  if (r) return r;
  const { v, t } = mesh, { fn, fa } = normals(v, t), nT = t.length / 3;
  const { over, bed, flags } = overhangOf(v, t, fn, fa);
  const near = triGrid(v, t, 2);
  let thin = 0, gap = 0, thinArea = 0, gapArea = 0;
  for (let n = 0; n < nT; n++) {
    if (fa[n] < 1e-4) continue;
    const nn = [fn[3 * n], fn[3 * n + 1], fn[3 * n + 2]], c = [0, 1, 2].map(k => (v[t[3 * n] * 3 + k] + v[t[3 * n + 1] * 3 + k] + v[t[3 * n + 2] * 3 + k]) / 3);
    // ins Material (Wand) und ins Freie (Spalt); zählt nur eine gegenüberliegende Fläche
    for (const [sgn, lim, bit] of [[-1, LIMITS.wall, THIN], [1, LIMITS.gap, GAP]]) {
      const d = nn.map(x => x * sgn), p = c.map((x, k) => x + d[k] * 1e-4);
      let best = Infinity;
      for (const m of near(p, d, lim)) {
        if (m === n || fn[3 * m] * nn[0] + fn[3 * m + 1] * nn[1] + fn[3 * m + 2] * nn[2] > -0.5) continue;
        best = Math.min(best, hit(v, t, m, p, d));
      }
      if (best < lim) {
        flags[n] |= bit;
        if (bit === THIN) { thin++; thinArea += fa[n]; } else { gap++; gapArea += fa[n]; }
      }
    }
  }
  r = { flags, over, bed, thin, thinArea, gap, gapArea, fn, fa };
  cache.set(mesh, r);
  return r;
}

// Beste Lage: Achsenrichtungen und die größten ebenen Flächen als Auflage ausprobieren. Bewertung:
// Überhangfläche, dazu ein Malus für kleine Auflage (kippelt, haftet schlecht). Liefert die Richtung,
// die nach unten zeigen soll, und die Werte – current: dieselben Werte für die jetzige Lage.
export function bestOrientation(mesh) {
  if (orient.has(mesh)) return orient.get(mesh);
  const { v, t } = mesh, { fn, fa } = normals(v, t);
  const score = r => r.over + Math.max(0, 100 - r.bed) * 2;
  const cand = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  // große ebene Flächen: Normalen gleicher Richtung zusammenfassen
  const groups = [];
  for (let n = 0; n < t.length / 3; n++) {
    const nn = [fn[3 * n], fn[3 * n + 1], fn[3 * n + 2]], g = groups.find(x => x.n[0] * nn[0] + x.n[1] * nn[1] + x.n[2] * nn[2] > 0.9999);
    if (g) g.a += fa[n]; else groups.push({ n: nn, a: fa[n] });
  }
  groups.sort((a, b) => b.a - a.a);
  for (const g of groups.slice(0, 8)) if (!cand.some(c => c[0] * g.n[0] + c[1] * g.n[1] + c[2] * g.n[2] > 0.9999)) cand.push(g.n);
  const res = cand.map(down => { const r = overhangOf(v, t, fn, fa, down); return { down, over: r.over, bed: r.bed, score: score(r) }; });
  const current = res[0];
  const best = res.reduce((a, b) => (b.score < a.score - 1e-6 ? b : a));
  orient.set(mesh, { best, current });
  return { best, current };
}
