// Skizzen-Löser: hält geometrische Bedingungen ein und bewegt dabei so wenig wie möglich.
// Punkte mit gleichen Koordinaten gelten als verbunden (teilen sich eine Variable).
// Bedingung: { id, type, a: Element-ID, b?: Element-ID, value? }

export const CON = {
  h: { name: 'Horizontal', sym: 'H' },
  v: { name: 'Vertikal', sym: 'V' },
  par: { name: 'Parallel', sym: '∥' },
  perp: { name: 'Senkrecht', sym: '⊥' },
  eq: { name: 'Gleich', sym: '=' },
  tan: { name: 'Tangential', sym: 'T' },
  fix: { name: 'Fixiert', sym: 'Fix' },
  dim: { name: 'Maß', sym: '' },
};

const H = 1e-6, TOL = 1e-6;

// opt.drags: [{ id, key: 'a'|'b'|'c'|'s'|'e', target: [x, y] }], opt.radius: { id, value }
// Schreibt bei Erfolg die neuen Koordinaten in s.entities und gibt true zurück.
export function solveSketch(s, opt = {}) {
  const x = [], locked = [], keyVar = new Map(), ref = new Map(), byId = new Map();
  const pointVar = p => {
    const k = Math.round(p[0] * 1e5) + ',' + Math.round(p[1] * 1e5);
    let i = keyVar.get(k);
    if (i === undefined) { i = x.length; x.push(p[0], p[1]); keyVar.set(k, i); }
    return i;
  };
  for (const e of s.entities) {
    const r = {};
    if (e.type === 'line') { r.a = pointVar(e.a); r.b = pointVar(e.b); }
    else {
      r.c = pointVar(e.c);
      if (e.type === 'circle') { r.r = x.length; x.push(e.r); }
      else for (const [k, a] of [['s', e.a0], ['e', e.a1]]) r[k] = pointVar([e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]);
    }
    ref.set(e.id, r);
    byId.set(e.id, e);
  }

  const len = (i, j) => Math.hypot(x[i] - x[j], x[i + 1] - x[j + 1]);
  const pv = (...is) => is.flatMap(i => [i, i + 1]);
  const radius = r => (r.r !== undefined ? x[r.r] : len(r.c, r.s));
  const radVars = r => (r.r !== undefined ? [r.r] : pv(r.c, r.s));
  const res = [];
  const R = (vars, f, soft) => res.push({ vars, f, soft });

  for (const [id, r] of ref) if (byId.get(id).type === 'arc') R(pv(r.c, r.s, r.e), () => len(r.c, r.s) - len(r.c, r.e));

  for (const c of s.constraints || []) {
    const A = ref.get(c.a), B = c.b != null ? ref.get(c.b) : null;
    if (!A || (c.b != null && !B)) continue;
    const ta = byId.get(c.a).type, tb = B && byId.get(c.b).type;
    if (c.type === 'h' && ta === 'line') R([A.a + 1, A.b + 1], () => x[A.a + 1] - x[A.b + 1]);
    else if (c.type === 'v' && ta === 'line') R([A.a, A.b], () => x[A.a] - x[A.b]);
    else if ((c.type === 'par' || c.type === 'perp') && ta === 'line' && tb === 'line') {
      R(pv(A.a, A.b, B.a, B.b), () => {
        const ux = x[A.b] - x[A.a], uy = x[A.b + 1] - x[A.a + 1], wx = x[B.b] - x[B.a], wy = x[B.b + 1] - x[B.a + 1];
        const l = (Math.hypot(ux, uy) * Math.hypot(wx, wy)) || 1;
        return (c.type === 'par' ? ux * wy - uy * wx : ux * wx + uy * wy) / l;
      });
    } else if (c.type === 'eq' && B) {
      if (ta === 'line' && tb === 'line') R(pv(A.a, A.b, B.a, B.b), () => len(A.a, A.b) - len(B.a, B.b));
      else if (ta !== 'line' && tb !== 'line') R([...pv(A.c, B.c), ...radVars(A), ...radVars(B)], () => radius(A) - radius(B));
    } else if (c.type === 'dim') {
      if (ta === 'line') R(pv(A.a, A.b), () => len(A.a, A.b) - c.value);
      else R(radVars(A), () => radius(A) * (ta === 'circle' ? 2 : 1) - c.value);
    } else if (c.type === 'tan' && B) {
      const [L, K] = ta === 'line' ? [A, B] : [B, A];
      if (ta === 'line' || tb === 'line') {
        if (ta === tb) continue;
        R([...pv(L.a, L.b, K.c), ...radVars(K)], () => {
          const dx = x[L.b] - x[L.a], dy = x[L.b + 1] - x[L.a + 1];
          return Math.abs((x[K.c] - x[L.a]) * dy - (x[K.c + 1] - x[L.a + 1]) * dx) / (Math.hypot(dx, dy) || 1) - radius(K);
        });
      } else {
        R([...pv(A.c, B.c), ...radVars(A), ...radVars(B)], () => {
          const d = len(A.c, B.c), ra = radius(A), rb = radius(B), ext = d - (ra + rb), int = d - Math.abs(ra - rb);
          return Math.abs(ext) < Math.abs(int) ? ext : int;
        });
      }
    } else if (c.type === 'fix') for (const i of Object.values(A)) { locked[i] = true; if (i !== A.r) locked[i + 1] = true; }
  }

  for (const d of opt.drags || []) {
    const i = ref.get(d.id)?.[d.key];
    if (i === undefined) continue;
    R([i], () => x[i] - d.target[0], true);
    R([i + 1], () => x[i + 1] - d.target[1], true);
  }
  if (opt.radius) { const r = ref.get(opt.radius.id); if (r) R(radVars(r), () => radius(r) - opt.radius.value, true); }

  // Gauß-Newton mit kleinster Änderung: dx = Jᵀ (J Jᵀ + λ)⁻¹ (−r)
  const n = x.length;
  const errOf = list => list.reduce((m, c) => Math.max(m, Math.abs(c.f())), 0);
  function run(list, iters) {
    const m = list.length;
    if (!m) return;
    let best = { err: errOf(list), x: x.slice() };
    for (let it = 0; it < iters && best.err > 1e-10; it++) {
      const r = list.map(c => c.f()), J = list.map(() => new Float64Array(n));
      list.forEach((c, k) => {
        for (const v of new Set(c.vars)) {
          if (locked[v]) continue;
          const old = x[v];
          x[v] = old + H;
          J[k][v] = (c.f() - r[k]) / H;
          x[v] = old;
        }
      });
      const A = J.map(a => J.map(b => { let sum = 0; for (let i = 0; i < n; i++) sum += a[i] * b[i]; return sum; }));
      let tr = 0;
      for (let k = 0; k < m; k++) tr = Math.max(tr, A[k][k]);
      const y = r.map(v => -v);
      for (let k = 0; k < m; k++) A[k][k] += 1e-9 * tr + 1e-14;
      for (let k = 0; k < m; k++) { // Gauß-Elimination mit Pivotsuche
        let p = k;
        for (let i = k + 1; i < m; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
        [A[k], A[p]] = [A[p], A[k]]; [y[k], y[p]] = [y[p], y[k]];
        for (let i = k + 1; i < m; i++) {
          const f = A[i][k] / A[k][k];
          if (!f) continue;
          for (let j = k; j < m; j++) A[i][j] -= f * A[k][j];
          y[i] -= f * y[k];
        }
      }
      for (let k = m - 1; k >= 0; k--) {
        for (let j = k + 1; j < m; j++) y[k] -= A[k][j] * y[j];
        y[k] /= A[k][k];
      }
      for (let i = 0; i < n; i++) { let d = 0; for (let k = 0; k < m; k++) d += J[k][i] * y[k]; x[i] += d; }
      const err = errOf(list);
      if (!(err < best.err)) continue;
      best = { err, x: x.slice() };
    }
    for (let i = 0; i < n; i++) x[i] = best.x[i];
  }

  const hard = res.filter(c => !c.soft);
  if (hard.length < res.length) {
    run(res, 25);
    if (errOf(res) > TOL) run(hard, 40); // Ziehen widerspricht den Bedingungen: so nah wie möglich
  } else run(hard, 40);
  if (errOf(hard) > TOL || x.some(v => !isFinite(v))) return false;

  // Ergebnis prüfen und zurückschreiben
  const q = i => [+x[i].toFixed(6), +x[i + 1].toFixed(6)];
  const out = [];
  for (const e of s.entities) {
    const r = ref.get(e.id);
    if (e.type === 'line') {
      if (len(r.a, r.b) < 1e-4) return false;
      out.push({ ...e, a: q(r.a), b: q(r.b) });
    } else if (e.type === 'circle') {
      if (!(x[r.r] > 1e-4)) return false;
      out.push({ ...e, c: q(r.c), r: +x[r.r].toFixed(6) });
    } else {
      const rad = len(r.c, r.s);
      if (rad < 1e-4) return false;
      const a0 = Math.atan2(x[r.s + 1] - x[r.c + 1], x[r.s] - x[r.c]);
      let a1 = Math.atan2(x[r.e + 1] - x[r.c + 1], x[r.e] - x[r.c]);
      while (a1 <= a0 + 1e-9) a1 += Math.PI * 2;
      out.push({ ...e, c: q(r.c), r: rad, a0, a1 });
    }
  }
  s.entities = out;
  return true;
}
