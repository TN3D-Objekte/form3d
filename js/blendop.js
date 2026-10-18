// Ablauf von Rundung/Fase an einem Körper { mesh, features }: Werkzeuge bauen, anwenden, Übergänge zu
// vorhandenen Rundungen ausrunden. Ohne Oberfläche, damit ihn auch der Fuzz-Test (tests/fuzz.html) nutzt.
import * as K from './kernel.js';
import { buildEdgeTool, cornerTools, joinChains, tangentChains, transitionTools, edgeChains, isConvex } from './edges.js';
import { analyze } from './meshview.js';

// Neue Kennungen für Rundungs-/Fasenflächen eines Körpers (12 Bit, siehe kernel.js)
export function nextTag(b) {
  const used = Math.max(K.maxTag(b.mesh), ...(b.features || []).map(f => f.tag));
  return used + 64 < 4096 ? used + 1 : 1;
}

// Werkzeuge für Rundung/Fase: tangential anschließende Kanten laufen mit (extend), außer der Radius ist dafür
// zu groß (dann nur die angetippten Kanten). also: siehe edges.buildEdgeTool
export function edgeTools(b, picked, kind, size, extend = true, also = []) {
  const make = list => {
    const chains = joinChains(b.mesh, list), base = nextTag(b);
    const ts = [...chains.map(ch => buildEdgeTool(b.mesh, ch, kind, size, chains, also)), ...cornerTools(b.mesh, chains, kind, size)];
    ts.forEach((t, i) => Object.assign(t, { tag: base + i, kind, size, links: t.chains?.map(ci => base + ci) }));
    return ts;
  };
  const ext = extend ? tangentChains(b.mesh, picked) : picked;
  if (ext.length > picked.length) try { return make(ext); } catch (e) { if (!/Radius zu groß/.test(e.message)) throw e; }
  return make(picked);
}

// Schneidet eine neue Rundung eine vorhandene, wird die Schnittkante weich ausgerundet (Übergang, siehe edges.js).
// Gelingt das nicht, bleibt die Kante – die Rundung selbst ist ja angelegt.
export function withTransitions(old, r) {
  const all = [...old, ...r.features];
  try {
    const ts = transitionTools(r.mesh, all, r.features.map(f => f.tag), nextTag({ mesh: r.mesh, features: all }));
    if (!ts.length) return r;
    const t = K.blendFeatures(r.mesh, ts);
    return t.mesh ? { mesh: t.mesh, features: [...r.features, ...t.features] } : r;
  } catch (e) { console.warn('Übergang nicht möglich', e); return r; }
}

// Ergebnis von Rundung/Fase ohne Übergänge: { mesh, features } (nur die neuen Rundungen/Fasen).
// Treffen gewählte Außen- und Innenkanten in einer Ecke zusammen (z. B. alle Kanten einer Taschenwand: Rand außen,
// senkrechte Ecken und Boden innen), entstehen erst die Innenrundungen. Ihre Füllung reicht in der Ecke bis an die
// Oberfläche; dort entsteht eine neue Bogenkante. Die Außenrundung läuft dann über den Rand und diese Bögen – sonst
// stünde die Füllung als Ohr über dem gerundeten Rand.
// Umgekehrt an Ecken mit einer Außen- und zwei Innenkanten (z. B. Ecke eines Aufsatzes: senkrechte Kante und beide
// Fußkanten; bei Rundungen darf die zweite Innenkante auch ungewählt sein, die Rundung läuft dann an ihr aus): erst
// die Außenrundung. Ihr Fuß ist ein Innenbogen, der tangential an beide Fußkanten anschließt; die
// Innenrundung läuft dann in einem Zug um die Ecke, statt um die scharfe Kante gedreht zu werden.
export function edgeResult(b, picked, kind, size) {
  const conv = picked.filter(c => isConvex(b.mesh, c)), conc = picked.filter(c => !isConvex(b.mesh, c));
  if (conv.length && conc.length && touching(b.mesh, conv, conc)) {
    const other = edgeChains(b.mesh).filter(c => !picked.includes(c) && !isConvex(b.mesh, c));
    if (cornerKinds(b.mesh, conv, conc, other).every(([nx, nc, no]) => nx === 1 && nc + no === 2 && (nc === 2 || kind === 'fillet'))) {
      try {
        const r1 = K.blendFeatures(b.mesh, edgeTools(b, conv, kind, size, true, conc));
        if (r1.mesh) {
          const b1 = { mesh: r1.mesh, features: [...(b.features || []), ...r1.features] }, next = followChains(b.mesh, r1.mesh, conc, kind, size, false);
          if (next.length) {
            const r2 = K.blendFeatures(b1.mesh, edgeTools(b1, next, kind, size, false));
            if (r2.mesh) return { mesh: r2.mesh, features: [...r1.features, ...r2.features] };
          }
        }
      } catch (e) { if (/Radius zu groß/.test(e.message)) throw e; console.warn('Rundung in zwei Phasen nicht möglich', e); }
    }
    try {
      const r1 = K.blendFeatures(b.mesh, edgeTools(b, conc, kind, size, true, conv));
      if (r1.mesh) {
        const b1 = { mesh: r1.mesh, features: [...(b.features || []), ...r1.features] }, next = followChains(b.mesh, r1.mesh, conv, kind, size);
        if (next.length) {
          const r2 = K.blendFeatures(b1.mesh, edgeTools(b1, next, kind, size, false)); // nicht um die ganze Tasche weiterlaufen
          if (r2.mesh) return { mesh: r2.mesh, features: [...r1.features, ...r2.features] };
        }
      }
    } catch (e) { if (/Radius zu groß/.test(e.message)) throw e; console.warn('Rundung in zwei Phasen nicht möglich', e); }
  }
  return K.blendFeatures(b.mesh, edgeTools(b, picked, kind, size));
}

const pt = (mesh, i) => [mesh.v[3 * i], mesh.v[3 * i + 1], mesh.v[3 * i + 2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function segDist(q, a, b) {
  const ab = [0, 1, 2].map(k => b[k] - a[k]), l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const u = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1] + (q[2] - a[2]) * ab[2]) / l2)) : 0;
  return dist(q, a.map((x, k) => x + ab[k] * u));
}
const ends = (mesh, c) => (c.closed ? [] : [pt(mesh, c.segs[0].u), pt(mesh, c.segs[c.segs.length - 1].v)]);
// je Ecke, an der Ketten aus a und b enden: [Zahl der Enden aus a, aus b, aus o]
function cornerKinds(mesh, a, b, o = []) {
  const at = [];
  for (const [list, k] of [[a, 0], [b, 1], [o, 2]]) for (const c of list) for (const p of ends(mesh, c)) {
    let e = at.find(x => dist(x.p, p) < 1e-4);
    if (!e) { if (k === 2) continue; at.push(e = { p, n: [0, 0, 0] }); }
    e.n[k]++;
  }
  return at.filter(e => e.n[0] && e.n[1]).map(e => e.n);
}
const touching = (mesh, a, b) => a.some(c => ends(mesh, c).some(p => b.some(d => ends(mesh, d).some(q => dist(p, q) < 1e-4))));

// Außenkanten nach den Innenrundungen wiederfinden: Stücke der gewählten Kanten (liegen auf ihnen) und neue Kanten,
// die an ein solches Stück anschließen und nicht auf einer alten Kante liegen (Bogen um die Eckfüllung). Splitterkanten
// mit ungenauen Flächennormalen (auch Stücke der gewählten Kanten, z. B. eine Messerschneide aus zwei entgegengesetzten
// Flächen) zählen nicht: Ihr Werkzeug ragte weit über die Kante hinaus.
// convex = false: ebenso für Innenkanten (Bogen am Fuß einer Außenrundung).
function followChains(M, M1, conv, kind, size, convex = true) {
  const segsOf = (mesh, list) => list.flatMap(c => c.segs.map(g => [pt(mesh, g.u), pt(mesh, g.v)]));
  const old = segsOf(M, conv), an = analyze(M), sharp = [];
  for (let s = 0; s < an.sharp.length; s += 2) sharp.push([pt(M, an.sharp[s]), pt(M, an.sharp[s + 1])]);
  const onSeg = (g, segs) => { const a = pt(M1, g.u), b = pt(M1, g.v), m = a.map((x, k) => (x + b[k]) / 2); return segs.some(([p, q]) => segDist(m, p, q) < 1e-3); };
  const on = (c, segs) => c.segs.every(g => onSeg(g, segs));
  // Stücke der gewählten Kanten; flach abknickend kann eine Kette über die neue Kante der Füllung hinweg weiterlaufen
  // (z. B. Rand eines Achtecks: Rand, Füllung, Rand je 22,5° geknickt) – dann zählt sie ganz, sofern ihre übrigen
  // Stücke auf keiner alten Kante liegen
  const cand = edgeChains(M1).filter(c => isConvex(M1, c) === convex);
  const rim = cand.filter(c => on(c, old) || (c.segs.some(g => onSeg(g, old)) && c.segs.every(g => onSeg(g, old) || !onSeg(g, sharp))));
  const tips = rim.flatMap(c => ends(M1, c));
  const sane = c => {
    try {
      const t = buildEdgeTool(M1, c, kind, size, [c]), lim = 20 * size + 5;
      for (let i = 0; i < t.mesh.v.length; i++) if (!c.pts.some(q => Math.abs(q[i % 3] - t.mesh.v[i]) < lim)) return false;
      return true;
    } catch (e) { return true; } // Radius zu groß o. Ä.: wie gewählt weiterreichen, der Schritt meldet es dann
  };
  const arcs = cand.filter(c => !rim.includes(c) && !on(c, sharp) && ends(M1, c).some(p => tips.some(q => dist(p, q) < 1e-4)) && sane(c));
  return [...rim.filter(sane), ...arcs];
}

// Ganzer Schritt wie beim Tippen auf „Fertig“: neues Netz und alle Rundungen/Fasen des Körpers
export function applyEdges(b, picked, kind, size) {
  let r = edgeResult(b, picked, kind, size);
  if (!r.mesh) throw new Error('leeres Ergebnis');
  r = withTransitions(b.features || [], r);
  return { mesh: r.mesh, features: [...(b.features || []), ...r.features] };
}
