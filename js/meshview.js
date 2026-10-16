// Mesh-Analyse für Darstellung und Auswahl: Flächengruppen, Kanten, geglättete Normalen.
import { planeFromNormal, to2D } from './sketch.js';

const COS_EDGE = Math.cos(25 * Math.PI / 180);
const STEP = 0.01; // mm: niedrigere Dreiecke gelten als Splitter (siehe analyze)
const COS_CREASE = Math.cos(40 * Math.PI / 180);
const cacheMap = new WeakMap();
// Übergänge zwischen zwei Rundungen je Netz ({ tag, links: [a, b] }): Ihre Ränder sind tangential und werden
// nicht als Linie gezeichnet (sie verliefen auf den facettierten Rundungsflächen unruhig), ebenso die flache
// Restkante zwischen a und b, wo der Übergang ausläuft. Vor analyze setzen.
const seamless = new WeakMap();
export function hideSeams(mesh, transitions) {
  if (!transitions.length || cacheMap.has(mesh)) return;
  seamless.set(mesh, { tags: new Set(transitions.map(x => x.tag)), pairs: new Set(transitions.map(x => Math.min(...x.links) + ',' + Math.max(...x.links))) });
}

export function analyze(mesh) {
  let an = cacheMap.get(mesh);
  if (an) return an;
  const { v, t } = mesh, nT = t.length / 3, nV = v.length / 3;
  const fn = new Float32Array(nT * 3), fa = new Float32Array(nT);
  for (let i = 0; i < nT; i++) {
    const a = t[3 * i] * 3, b = t[3 * i + 1] * 3, c = t[3 * i + 2] * 3;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz);
    fa[i] = l / 2;
    if (l > 1e-20) { fn[3 * i] = nx / l; fn[3 * i + 1] = ny / l; fn[3 * i + 2] = nz / l; }
  }
  const fdot = (i, j) => fn[3 * i] * fn[3 * j] + fn[3 * i + 1] * fn[3 * j + 1] + fn[3 * i + 2] * fn[3 * j + 2];

  // Ecken an gleicher Position zusammenfassen: Boolesche Ergebnisse enthalten entartete Dreiecke
  // mit doppelten Punkten, die sonst die Nachbarschaft der echten Dreiecke unterbrechen
  const weld = new Int32Array(nV), at = new Map();
  for (let i = 0; i < nV; i++) {
    const k = v[3 * i] + ',' + v[3 * i + 1] + ',' + v[3 * i + 2], w = at.get(k);
    if (w === undefined) at.set(k, i);
    weld[i] = w ?? i;
  }

  // Nachbarn über gemeinsame Kanten (Paare in Reihenfolge des Auftretens)
  const open = new Map(), pairs = [], nb = new Int32Array(nT * 3).fill(-1);
  for (let i = 0; i < nT; i++) for (let e = 0; e < 3; e++) {
    if (!fa[i]) break;
    const a = weld[t[3 * i + e]], b = weld[t[3 * i + (e + 1) % 3]];
    const key = a < b ? a * nV + b : b * nV + a;
    const j = open.get(key);
    if (j === undefined) { open.set(key, 3 * i + e); continue; }
    open.delete(key);
    nb[3 * i + e] = (j / 3) | 0; nb[j] = i;
    pairs.push(i, (j / 3) | 0, a, b);
  }

  // Kennung je Dreieck (Rundung/Fase, obere 12 Bit von mesh.f)
  const tg = new Int32Array(nT);
  if (mesh.f) for (let i = 0; i < nT; i++) tg[i] = Math.floor(mesh.f[i] / 1048576);

  // Splitter aus Booleschen Operationen (fast ohne Höhe) haben eine zufällige Normale und oft keine
  // Kennung. Sie übernehmen beides vom nächsten echten Dreieck an ihren langen Kanten (auch über
  // gestapelte Splitter hinweg), sonst erzeugen sie Kanten mitten in Rundungen und verbinden Flächen,
  // die nicht zusammengehören. Ebenso alle Dreiecke unter STEP Höhe: Wo zwei Rundungen fast flach
  // ineinanderlaufen, bleiben Stufen von wenigen Tausendstel Millimetern stehen – unsichtbar und für den
  // Druck bedeutungslos, aber als Kante gezeichnet eine ausgefranste Linie.
  const P = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]], longEdges = new Map();
  for (let i = 0; i < nT; i++) {
    if (!fa[i]) continue;
    const p = [0, 1, 2].map(k => P(t[3 * i + k]));
    const L = [0, 1, 2].map(k => Math.hypot(p[(k + 1) % 3][0] - p[k][0], p[(k + 1) % 3][1] - p[k][1], p[(k + 1) % 3][2] - p[k][2]));
    const Lm = Math.max(...L), h = 2 * fa[i] / Lm;
    if (h < STEP || h < 1e-4 * Lm) longEdges.set(i, [0, 1, 2].filter(e => L[e] >= 0.5 * Lm).sort((a, b) => L[b] - L[a]).map(e => nb[3 * i + e]).filter(j => j >= 0));
  }
  const donor = new Map();
  for (const i of longEdges.keys()) {
    const seen = new Set([i]);
    let ring = [i], j = -1;
    for (let k = 0; k < 8 && j < 0 && ring.length; k++) {
      const next = [];
      for (const s of ring) for (const n of longEdges.get(s)) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (!longEdges.has(n)) { if (j < 0) j = n; } else next.push(n);
      }
      ring = next;
    }
    if (j >= 0) donor.set(i, j);
  }
  for (const [i, j] of donor) {
    fn[3 * i] = fn[3 * j]; fn[3 * i + 1] = fn[3 * j + 1]; fn[3 * i + 2] = fn[3 * j + 2];
    tg[i] = tg[j];
  }

  // koplanare Nachbardreiecke zu Flächen zusammenfassen, scharfe Kanten sammeln. Innerhalb einer
  // Rundung/Fase (gleiche Kennung) gibt es keine scharfen Kanten.
  const par = new Int32Array(nT);
  for (let i = 0; i < nT; i++) par[i] = i;
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const sharp = [], sharpTri = [], smooth = [], smoothV = [];
  for (let k = 0; k < pairs.length; k += 4) {
    const i = pairs[k], j = pairs[k + 1], d = fdot(i, j);
    if (d > 0.99999 && tg[i] === tg[j]) par[find(i)] = find(j);
    else if (d < COS_EDGE && !(tg[i] && tg[i] === tg[j])) { sharp.push(pairs[k + 2], pairs[k + 3]); sharpTri.push(i, j); } // Dreieck i enthält die Halbkante a→b
    else { smooth.push(i, j); smoothV.push(pairs[k + 2], pairs[k + 3]); }
  }

  const triFace = new Int32Array(nT), faces = [], rootIdx = new Map();
  for (let i = 0; i < nT; i++) {
    const r = find(i);
    let fi = rootIdx.get(r);
    if (fi === undefined) { fi = faces.length; rootIdx.set(r, fi); faces.push({ tris: [], n: [0, 0, 1], big: -1, tag: 0 }); }
    const f = faces[fi];
    f.tris.push(i);
    if (fa[i] > f.big) { f.big = fa[i]; f.n = [fn[3 * i], fn[3 * i + 1], fn[3 * i + 2]]; f.tag = tg[i]; }
    triFace[i] = fi;
  }

  // Nachbarflächen über glatte Kanten. Ohne Kennung gelten große ebene Flächen, die nur tangential an
  // Facetten anschließen (Rundung neben Fase oder Deckfläche), als eben: Facetten einer Krümmung sind
  // ähnlich groß wie ihre Nachbarn. Verglichen wird mit den Nachbarn ohne Kennung, falls es welche gibt:
  // Eine Zylinderfacette unter einer Rundung grenzt an viele kleine Rundungsfacetten, bleibt aber gekrümmt.
  const nbr = faces.map(() => []);
  for (let k = 0; k < smooth.length; k += 2) {
    const a = triFace[smooth[k]], b = triFace[smooth[k + 1]];
    if (a !== b && !nbr[a].includes(b)) { nbr[a].push(b); nbr[b].push(a); }
  }
  const area = faces.map(f => f.tris.reduce((s, ti) => s + fa[ti], 0));
  const flat = faces.map((f, i) => {
    const plain = nbr[i].filter(g => !faces[g].tag);
    const ns = (plain.length ? plain : nbr[i]).map(g => area[g]).sort((a, b) => a - b);
    return !f.tag && ns.length > 0 && area[i] > 8 * ns[ns.length >> 1];
  });

  // Übergangskanten: wo Rundung/Fase oder eine Krümmung tangential in eine andere Fläche übergeht, gibt
  // es keinen Knick; als dünne Linie zeigen sie trotzdem, wo die Fläche anfängt und aufhört
  const soft = [], hide = seamless.get(mesh);
  for (let k = 0; k < smooth.length; k += 2) {
    const i = smooth[k], j = smooth[k + 1], a = triFace[i], b = triFace[j];
    if (hide && (hide.tags.has(tg[i]) || hide.tags.has(tg[j]) || hide.pairs.has(Math.min(tg[i], tg[j]) + ',' + Math.max(tg[i], tg[j])))) continue;
    if (a !== b && (tg[i] !== tg[j] || flat[a] || flat[b])) soft.push(smoothV[k], smoothV[k + 1]);
  }

  // Normalen je Ecke über angrenzende Dreiecke innerhalb des Knickwinkels mitteln
  const start = new Uint32Array(nV + 1);
  for (let k = 0; k < t.length; k++) start[t[k] + 1]++;
  for (let i = 0; i < nV; i++) start[i + 1] += start[i];
  const fill = start.slice(0, nV), inc = new Uint32Array(t.length);
  for (let k = 0; k < t.length; k++) inc[fill[t[k]]++] = (k / 3) | 0;

  const pos = new Float32Array(nT * 9), nor = new Float32Array(nT * 9);
  for (let i = 0; i < nT; i++) for (let c = 0; c < 3; c++) {
    const vi = t[3 * i + c], o = i * 9 + c * 3;
    pos[o] = v[vi * 3]; pos[o + 1] = v[vi * 3 + 1]; pos[o + 2] = v[vi * 3 + 2];
    let nx = 0, ny = 0, nz = 0;
    for (let k = start[vi]; k < start[vi + 1]; k++) {
      const j = inc[k];
      if (j === i || fdot(i, j) > COS_CREASE || (tg[i] && tg[i] === tg[j])) { nx += fn[3 * j] * fa[j]; ny += fn[3 * j + 1] * fa[j]; nz += fn[3 * j + 2] * fa[j]; }
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nor[o] = nx / l; nor[o + 1] = ny / l; nor[o + 2] = nz / l;
  }

  const edges = new Float32Array((sharp.length + soft.length) * 3);
  const cornerSet = new Set(sharp);
  [...sharp, ...soft].forEach((vi, k) => edges.set(v.subarray(vi * 3, vi * 3 + 3), k * 3));
  const corners = [...cornerSet].map(i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]]);

  an = { pos, nor, edges, triFace, faces, corners, fa, fn, tg, sharp, sharpTri, weld, smooth, nbr, flat, pairs };
  cacheMap.set(mesh, an);
  return an;
}

// Zusammenhängende glatte Fläche (z. B. Zylindermantel, Rundung) um die ebene Teilfläche fi: über
// nicht scharfe Kanten verbunden, mit gleicher Rundungs-/Fasenkennung (mesh.f, obere 12 Bit) und ohne
// große ebene Flächen (an.flat).
export function smoothSurface(mesh, an, fi) {
  const t0 = an.faces[fi].tag;
  if (an.flat[fi]) return [fi];
  const seen = new Set([fi]), todo = [fi];
  while (todo.length) for (const g of an.nbr[todo.pop()]) {
    if (seen.has(g) || an.faces[g].tag !== t0 || an.flat[g]) continue;
    seen.add(g); todo.push(g);
  }
  return [...seen];
}

export function faceTriangles(an, fi) {
  if (Array.isArray(fi)) {
    const parts = fi.map(f => faceTriangles(an, f)), out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const tris = an.faces[fi].tris, out = new Float32Array(tris.length * 9);
  tris.forEach((ti, k) => out.set(an.pos.subarray(ti * 9, ti * 9 + 9), k * 9));
  return out;
}

export function faceCentroid(an, fi) {
  let x = 0, y = 0, z = 0, w = 0;
  for (const ti of an.faces[fi].tris) {
    const a = an.fa[ti], p = an.pos, o = ti * 9;
    x += a * (p[o] + p[o + 3] + p[o + 6]) / 3;
    y += a * (p[o + 1] + p[o + 4] + p[o + 7]) / 3;
    z += a * (p[o + 2] + p[o + 5] + p[o + 8]) / 3;
    w += a;
  }
  return [x / w, y / w, z / w];
}

// Randschleifen einer ebenen Fläche in Ebenenkoordinaten
export function faceLoops(mesh, an, fi) {
  const { v, t } = mesh, nV = v.length / 3, f = an.faces[fi];
  const set = new Set();
  const w = an.weld;
  for (const ti of f.tris) for (let e = 0; e < 3; e++) set.add(w[t[3 * ti + e]] * nV + w[t[3 * ti + (e + 1) % 3]]);
  const next = new Map();
  for (const key of set) {
    const a = Math.floor(key / nV), b = key % nV;
    if (set.has(b * nV + a)) continue;
    if (!next.has(a)) next.set(a, []);
    next.get(a).push(b);
  }
  const p3 = i => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  const plane = planeFromNormal(f.n, p3(t[3 * f.tris[0]]));
  const loops = [];
  for (const [a0, outs0] of next) {
    while (outs0.length) {
      const loop = [];
      let a = a0;
      do {
        const outs = next.get(a);
        if (!outs || !outs.length) break;
        loop.push(to2D(plane, p3(a)));
        a = outs.pop();
      } while (a !== a0);
      const clean = loop.filter((p, i) => {
        const q = loop[(i + loop.length - 1) % loop.length], r = loop[(i + 1) % loop.length];
        const cr = (p[0] - q[0]) * (r[1] - p[1]) - (p[1] - q[1]) * (r[0] - p[0]);
        return Math.abs(cr) > 1e-6 * Math.hypot(p[0] - q[0], p[1] - q[1]) * Math.hypot(r[0] - p[0], r[1] - p[1]);
      });
      if (clean.length >= 3) loops.push(clean);
    }
  }
  return { plane, loops };
}
