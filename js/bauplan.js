// Bauplan: ein Modell als Text (JSON) beschreiben und bauen lassen – gedacht für KI-Systeme, die nach der Anleitung
// in bauplan.md Teile entwerfen. Jeder Schritt erzeugt einen Körper oder verändert einen (vereinigen, abziehen,
// schneiden, runden, fasen, Schraubenloch …). Ohne Oberfläche: runBauplan liefert Körper und einen Bericht, die App
// (main.js) übernimmt sie ins Projekt.
import * as K from './kernel.js';
import * as Parts from './parts.js';
import { analyze } from './meshview.js';
import { edgeChains, isConvex } from './edges.js';
import { applyEdges } from './blendop.js';
import { bestOrientation, LIMITS } from './printcheck.js';

export const FORMAT = 'form3d-bauplan/1';
const SEGS = 64; // Kreisteilung wie in Skizzen

const rad = d => d * Math.PI / 180;
const num = (v, name, step) => {
  if (typeof v !== 'number' || !isFinite(v)) throw new Error(`${step}: „${name}“ muss eine Zahl sein`);
  return v;
};
const pos = (v, name, step) => { if (num(v, name, step) <= 0) throw new Error(`${step}: „${name}“ muss größer als 0 sein`); return v; };
const vec = (v, n, name, step) => {
  if (!Array.isArray(v) || v.length !== n || v.some(x => typeof x !== 'number' || !isFinite(x))) throw new Error(`${step}: „${name}“ muss eine Liste aus ${n} Zahlen sein`);
  return v;
};

// ---------------------------------------------------------------- 4×4-Matrizen (spaltenweise wie three.js)
const mul = (A, B) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += A[k * 4 + r] * B[c * 4 + k]; return o; };
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const rotZ = a => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
const trans = ([x, y, z]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
// erst drehen (um x, dann y, dann z, Grad) um den Ursprung des Teils, dann an pos schieben
function placement(s, step, offset = [0, 0, 0]) {
  const p = s.pos ? vec(s.pos, 3, 'pos', step) : [0, 0, 0], r = s.drehen ? vec(s.drehen, 3, 'drehen', step) : [0, 0, 0];
  return mul(trans([p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]), mul(rotZ(rad(r[2])), mul(rotY(rad(r[1])), rotX(rad(r[0])))));
}
const isIdent = m => m.every((x, i) => Math.abs(x - ident()[i]) < 1e-12);

// ---------------------------------------------------------------- 2D-Formen
const turn = ([x, y], a, [cx, cy]) => { const c = Math.cos(a), s = Math.sin(a); return [cx + c * x - s * y, cy + s * x + c * y]; };
function arcPts(cx, cy, r, a0, a1, n) { return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }); }
function shape(f, step) {
  if (!f || typeof f !== 'object') throw new Error(`${step}: Form fehlt (rechteck, kreis, langloch oder polygon)`);
  const m = f.mitte ? vec(f.mitte, 2, 'mitte', step) : [0, 0], w = rad(f.winkel ? num(f.winkel, 'winkel', step) : 0);
  if (f.rechteck) {
    const [bx, by] = vec(f.rechteck, 2, 'rechteck', step).map(v => pos(v, 'rechteck', step)), r = Math.min(f.r ? num(f.r, 'r', step) : 0, bx / 2, by / 2);
    let p;
    if (r > 0) {
      const q = Math.max(4, Math.round(SEGS / 4)), x = bx / 2 - r, y = by / 2 - r;
      p = [...arcPts(x, -y, r, -Math.PI / 2, 0, q), ...arcPts(x, y, r, 0, Math.PI / 2, q), ...arcPts(-x, y, r, Math.PI / 2, Math.PI, q), ...arcPts(-x, -y, r, Math.PI, 1.5 * Math.PI, q)];
    } else p = [[-bx / 2, -by / 2], [bx / 2, -by / 2], [bx / 2, by / 2], [-bx / 2, by / 2]];
    return p.map(q => turn(q, w, m));
  }
  if (f.kreis !== undefined) {
    const r = pos(f.kreis, 'kreis (Durchmesser)', step) / 2;
    return Array.from({ length: SEGS }, (_, i) => [m[0] + r * Math.cos(2 * Math.PI * i / SEGS), m[1] + r * Math.sin(2 * Math.PI * i / SEGS)]);
  }
  if (f.langloch) {
    const [l, b] = vec(f.langloch, 2, 'langloch', step).map(v => pos(v, 'langloch', step)), r = b / 2, x = Math.max(0, l / 2 - r), q = SEGS / 2;
    return [...arcPts(x, 0, r, -Math.PI / 2, Math.PI / 2, q), ...arcPts(-x, 0, r, Math.PI / 2, 1.5 * Math.PI, q)].map(p => turn(p, w, m));
  }
  if (f.polygon) {
    if (!Array.isArray(f.polygon) || f.polygon.length < 3) throw new Error(`${step}: „polygon“ braucht mindestens 3 Punkte [x, y]`);
    return f.polygon.map(p => turn(vec(p, 2, 'polygon-Punkt', step), w, m));
  }
  throw new Error(`${step}: unbekannte Form ${JSON.stringify(Object.keys(f))} – erlaubt: rechteck, kreis, langloch, polygon`);
}
const PLANES = {
  xy: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] },
  xz: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], n: [0, -1, 0] },
  yz: { o: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], n: [1, 0, 0] },
};

// ---------------------------------------------------------------- Grundkörper (im eigenen System, Boden in z = 0)
function solidOf(s, step) {
  switch (s.op) {
    case 'quader': return K.primitive('box', { l: pos(s.l, 'l', step), b: pos(s.b, 'b', step), h: pos(s.h, 'h', step) });
    case 'zylinder': return K.primitive('cyl', { d: pos(s.d, 'd', step), h: pos(s.h, 'h', step) });
    case 'kugel': return K.transform(K.primitive('sphere', { d: pos(s.d, 'd', step) }), trans([0, 0, -s.d / 2]));
    case 'kegel': {
      const r1 = num(s.d1, 'd1', step) / 2, r2 = num(s.d2, 'd2', step) / 2, h = pos(s.h, 'h', step);
      if (r1 < 0 || r2 < 0 || r1 + r2 <= 0) throw new Error(`${step}: d1 und d2 dürfen nicht negativ und nicht beide 0 sein`);
      return K.lathe([[0, 0], ...(r1 > 0 ? [[r1, 0]] : []), ...(r2 > 0 ? [[r2, h]] : []), [0, h]]);
    }
    case 'profil': {
      const pl = PLANES[s.ebene || 'xy'];
      if (!pl) throw new Error(`${step}: „ebene“ muss xy, xz oder yz sein`);
      const outer = (Array.isArray(s.form) ? s.form : [s.form]).map(f => shape(f, step)), holes = (s.loecher || []).map(f => shape(f, step));
      return K.extrude([{ outer: outer[0], holes }, ...outer.slice(1).map(o => ({ outer: o, holes: [] }))], pl, pos(s.hoehe, 'hoehe', step));
    }
    case 'drehkoerper': {
      if (!Array.isArray(s.profil) || s.profil.length < 3) throw new Error(`${step}: „profil“ braucht mindestens 3 Punkte [r, z]`);
      let p = s.profil.map(q => vec(q, 2, 'profil-Punkt', step));
      if (p.some(q => q[0] < 0)) throw new Error(`${step}: Radien im Profil dürfen nicht negativ sein`);
      let a = 0;
      for (let i = 0; i < p.length; i++) { const u = p[i], v = p[(i + 1) % p.length]; a += u[0] * v[1] - v[0] * u[1]; }
      if (a < 0) p = p.slice().reverse();
      return K.lathe(p);
    }
  }
  return null;
}

// ---------------------------------------------------------------- Kantenauswahl
const DIRS = { oben: [0, 0, 1], unten: [0, 0, -1], vorne: [0, -1, 0], hinten: [0, 1, 0], links: [-1, 0, 0], rechts: [1, 0, 0] };
export function selectEdges(mesh, sel, step) {
  const chains = edgeChains(mesh), { fn } = analyze(mesh);
  const nrm = ti => [fn[3 * ti], fn[3 * ti + 1], fn[3 * ti + 2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 2; i < mesh.v.length; i += 3) { zmin = Math.min(zmin, mesh.v[i]); zmax = Math.max(zmax, mesh.v[i]); }
  const one = f => {
    if (f === 'alle' || f?.alle) return () => true;
    if (!f || typeof f !== 'object') throw new Error(`${step}: „kanten“ muss "alle", ein Filter-Objekt oder eine Liste von Filtern sein`);
    const known = ['flaeche', 'x', 'y', 'z', 'parallel', 'art', 'rund', 'nahe', 'abstand', 'bereich', 'ganz_oben', 'ganz_unten'];
    const bad = Object.keys(f).filter(k => !known.includes(k));
    if (bad.length) throw new Error(`${step}: unbekannter Kantenfilter ${bad.join(', ')} – erlaubt: ${known.join(', ')}`);
    return c => {
      const P = c.pts;
      if (f.flaeche) {
        const d = DIRS[f.flaeche];
        if (!d) throw new Error(`${step}: „flaeche“ muss oben, unten, vorne, hinten, links oder rechts sein`);
        if (!c.segs.some(s => dot(nrm(s.t1), d) > 0.999 || dot(nrm(s.t2), d) > 0.999)) return false;
      }
      for (const [k, ax] of [['x', 0], ['y', 1], ['z', 2]]) if (f[k] !== undefined && !P.every(p => Math.abs(p[ax] - f[k]) < 0.05)) return false;
      if (f.ganz_oben && !P.every(p => Math.abs(p[2] - zmax) < 0.05)) return false;
      if (f.ganz_unten && !P.every(p => Math.abs(p[2] - zmin) < 0.05)) return false;
      if (f.parallel) {
        const ax = { x: 0, y: 1, z: 2 }[f.parallel];
        if (ax === undefined) throw new Error(`${step}: „parallel“ muss x, y oder z sein`);
        if (!P.every(p => [0, 1, 2].every(k => k === ax || Math.abs(p[k] - P[0][k]) < 0.05))) return false;
      }
      if (f.art) {
        if (!['aussen', 'innen'].includes(f.art)) throw new Error(`${step}: „art“ muss aussen oder innen sein`);
        if (isConvex(mesh, c) !== (f.art === 'aussen')) return false;
      }
      if (f.rund !== undefined) {
        // gerade: alle Punkte auf der Linie vom ersten zum letzten
        const a = P[0], e = P[P.length - 1], ab = [0, 1, 2].map(k => e[k] - a[k]), l = Math.hypot(...ab);
        const straight = !c.closed && l > 0 && P.every(p => { const ap = [0, 1, 2].map(k => p[k] - a[k]), t = dot(ap, ab) / (l * l); return Math.hypot(...[0, 1, 2].map(k => ap[k] - ab[k] * t)) < 0.01; });
        if (straight === !!f.rund) return false;
      }
      if (f.nahe) {
        const q = vec(f.nahe, 3, 'nahe', step), r = f.abstand ?? 1;
        const segd = (a, b) => { const ab = [0, 1, 2].map(k => b[k] - a[k]), l2 = dot(ab, ab), u = l2 ? Math.max(0, Math.min(1, dot([0, 1, 2].map(k => q[k] - a[k]), ab) / l2)) : 0; return Math.hypot(...[0, 1, 2].map(k => q[k] - a[k] - ab[k] * u)); };
        if (!P.some((p, i) => i && segd(P[i - 1], p) <= r)) return false;
      }
      if (f.bereich) {
        const lo = vec(f.bereich.min, 3, 'bereich.min', step), hi = vec(f.bereich.max, 3, 'bereich.max', step);
        if (!P.every(p => p.every((x, k) => x >= lo[k] - 0.05 && x <= hi[k] + 0.05))) return false;
      }
      return true;
    };
  };
  const tests = (Array.isArray(sel) ? sel : [sel]).map(one);
  return chains.filter(c => tests.some(t => t(c)));
}

// Welche Kanten sind schuld an „Radius zu groß“? Jede einzeln versuchen (nur bei wenigen Kanten, sonst zu langsam)
// und die Mitten der gescheiterten nennen, damit die KI sie mit "bereich"/"nahe" ausnehmen kann.
function tooBig(b, picked, kind, size) {
  if (picked.length < 2 || picked.length > 40) return '';
  const bad = picked.filter(c => {
    try { applyEdges(b, [c], kind, size); return false; } catch (e) { return /Radius zu groß/.test(e.message); }
  });
  if (!bad.length) return ' (einzeln geht jede Kante – zusammen nicht)';
  const mid = c => c.pts[Math.floor(c.pts.length / 2)].map(x => +x.toFixed(1));
  return ` (an ${bad.length} von ${picked.length} Kanten, z. B. bei ${bad.slice(0, 3).map(c => JSON.stringify(mid(c))).join(', ')})`;
}

// ---------------------------------------------------------------- Druckteile
function partSolid(s, step) {
  const m = s.m || 'M3';
  if (!Parts.SIZES.includes(m)) throw new Error(`${step}: „m“ muss eine von ${Parts.SIZES.join(', ')} sein`);
  const p = vec(s.punkt, 3, 'punkt', step), n0 = s.richtung ? vec(s.richtung, 3, 'richtung', step) : [0, 0, 1];
  const ln = Math.hypot(...n0);
  if (!ln) throw new Error(`${step}: „richtung“ darf nicht 0 sein`);
  const n = n0.map(x => x / ln);
  let local, out = false;
  if (s.op === 'schraubenloch') {
    const head = { senk: 'csk', zylinder: 'cap', ohne: 'none' }[s.kopf || 'senk'];
    if (!head) throw new Error(`${step}: „kopf“ muss senk, zylinder oder ohne sein`);
    const grip = { kern: 'core', durch: 'clear' }[s.halt || 'kern'];
    if (!grip) throw new Error(`${step}: „halt“ muss kern oder durch sein`);
    local = Parts.screwHole(m, head, pos(s.laenge ?? 12, 'laenge', step), grip);
  } else if (s.op === 'mutternfalle') local = Parts.nutTrap(m, pos(s.tiefe ?? 10, 'tiefe', step));
  else {
    out = s.art === 'bolzen';
    if (s.art && !['innen', 'bolzen'].includes(s.art)) throw new Error(`${step}: „art“ muss innen oder bolzen sein`);
    const L = pos(s.laenge ?? 10, 'laenge', step);
    local = out ? Parts.thread(m, -0.3, L, false) : Parts.thread(m, -0.05, L, true);
  }
  // lokales System: z in das Material (Bolzen: aus der Fläche heraus), wie makePart in main.js
  const z = out ? n : n.map(x => -x);
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const xl = cr(z, [1, 0, 0]), lx = Math.hypot(...xl), x = lx > 1e-3 ? xl.map(c => c / lx) : [0, 1, 0], y = cr(z, x);
  return { mesh: K.transform(local, [...x, 0, ...y, 0, ...z, 0, ...p, 1]), add: out };
}

// ---------------------------------------------------------------- Ablauf
const SOLIDS = ['quader', 'zylinder', 'kugel', 'kegel', 'profil', 'drehkoerper'];
const PARTOPS = ['schraubenloch', 'mutternfalle', 'gewinde'];
const MODES = { neu: 'new', vereinigen: 'union', abziehen: 'subtract', schnitt: 'intersect' };

// Baut den Bauplan. Liefert { name, bodies: [{ name, color?, mesh, features }], report: [...], ok }.
export function runBauplan(plan) {
  if (typeof plan === 'string') {
    try { plan = JSON.parse(plan); } catch (e) { throw new Error('Kein gültiges JSON: ' + e.message); }
  }
  if (!plan || !Array.isArray(plan.schritte)) throw new Error('Bauplan braucht eine Liste „schritte“');
  const bodies = new Map(), report = [];
  const need = (name, step) => { const b = bodies.get(name); if (!b) throw new Error(`${step}: Körper „${name}“ gibt es nicht (vorhanden: ${[...bodies.keys()].join(', ') || 'keine'})`); return b; };
  plan.schritte.forEach((s, i) => {
    const step = `Schritt ${i + 1}${s?.op ? ' (' + s.op + ')' : ''}`, r = { schritt: i + 1, op: s?.op };
    report.push(r);
    try {
      if (!s || typeof s !== 'object' || !s.op) throw new Error(`${step}: „op“ fehlt`);
      if (SOLIDS.includes(s.op)) {
        const base = solidOf(s, step), copies = [];
        const n = s.raster?.anzahl ? vec(s.raster.anzahl, 2, 'raster.anzahl', step) : [1, 1], d = s.raster?.abstand ? vec(s.raster.abstand, 2, 'raster.abstand', step) : [0, 0];
        for (let ix = 0; ix < n[0]; ix++) for (let iy = 0; iy < n[1]; iy++) {
          const off = [(ix - (n[0] - 1) / 2) * d[0], (iy - (n[1] - 1) / 2) * d[1], 0], m = placement(s, step, off);
          copies.push(isIdent(m) ? base : K.transform(base, m));
        }
        const mesh = K.unionAll(copies), mode = MODES[s.modus || 'neu'];
        if (!mode) throw new Error(`${step}: „modus“ muss neu, vereinigen, abziehen oder schnitt sein`);
        if (mode === 'new') {
          const name = s.name || `Körper ${bodies.size + 1}`;
          if (bodies.has(name)) throw new Error(`${step}: Körper „${name}“ gibt es schon – anderen Namen wählen oder modus angeben`);
          bodies.set(name, { name, color: s.farbe, mesh, features: [] });
          r.koerper = name;
        } else {
          if (!s.ziel) throw new Error(`${step}: bei modus „${s.modus}“ fehlt „ziel“ (Name des Körpers)`);
          const b = need(s.ziel, step), res = K.boolean(mode, b.mesh, mesh);
          if (!res) throw new Error(`${step}: Ergebnis ist leer – liegt das Werkzeug außerhalb des Körpers?`);
          b.mesh = res; // Rundungen/Fasen bleiben bearbeitbar, wie beim Abziehen/Anfügen in der App
          r.koerper = b.name;
        }
      } else if (s.op === 'rundung' || s.op === 'fase') {
        const b = need(s.ziel, step), size = pos(s.op === 'rundung' ? s.r : s.groesse, s.op === 'rundung' ? 'r' : 'groesse', step);
        const picked = selectEdges(b.mesh, s.kanten ?? 'alle', step);
        r.kanten = picked.length;
        if (!picked.length) throw new Error(`${step}: Kein Kantenfilter hat eine Kante getroffen`);
        let res;
        const kind = s.op === 'rundung' ? 'fillet' : 'chamfer';
        try { res = applyEdges(b, picked, kind, size); } catch (e) {
          if (!/Radius zu groß/.test(e.message)) throw new Error(`${step}: mit diesem Maß nicht möglich (${e.message})`);
          throw new Error(`${step}: Radius zu groß für diese Kanten – kleineren Wert versuchen${tooBig(b, picked, kind, size)}`);
        }
        b.mesh = res.mesh;
        b.features = res.features;
        r.koerper = b.name;
      } else if (PARTOPS.includes(s.op)) {
        const b = need(s.ziel, step), at = s.punkte ?? [s.punkt];
        if (!Array.isArray(at) || !at.length) throw new Error(`${step}: „punkt“ oder „punkte“ fehlt`);
        for (const pt of at) {
          const p = partSolid({ ...s, punkt: pt }, step), res = K.boolean(p.add ? 'union' : 'subtract', b.mesh, p.mesh);
          if (!res) throw new Error(`${step}: Ergebnis ist leer`);
          b.mesh = res;
        }
        r.koerper = b.name;
      } else if (s.op === 'verschieben') {
        const b = need(s.ziel, step), m = placement(s, step);
        b.mesh = K.transform(b.mesh, m);
        b.features = b.features.map(f => ({ ...f, region: K.transform(f.region, m), tool: f.tool && K.transform(f.tool, m) }));
        r.koerper = b.name;
      } else if (s.op === 'loeschen') {
        need(s.ziel, step);
        bodies.delete(s.ziel);
      } else throw new Error(`${step}: unbekannte op „${s.op}“ – erlaubt: ${[...SOLIDS, 'rundung', 'fase', ...PARTOPS, 'verschieben', 'loeschen'].join(', ')}`);
      r.ok = true;
      if (r.koerper) {
        const b = bodies.get(r.koerper), p = K.props(b.mesh), t = K.topology(b.mesh);
        Object.assign(r, { volumen: +p.volume.toFixed(1), teile: t.parts });
      }
    } catch (e) { r.ok = false; r.fehler = e.message; }
  });
  const list = [...bodies.values()].map(b => {
    const bb = [0, 1, 2].map(k => { let lo = Infinity, hi = -Infinity; for (let i = k; i < b.mesh.v.length; i += 3) { lo = Math.min(lo, b.mesh.v[i]); hi = Math.max(hi, b.mesh.v[i]); } return [+lo.toFixed(2), +hi.toFixed(2)]; });
    return { ...b, info: { name: b.name, volumen: +K.props(b.mesh).volume.toFixed(1), box: bb, teile: K.topology(b.mesh).parts } };
  });
  return { name: plan.name || 'Bauplan', bodies: list, report, ok: report.every(r => r.ok), druck: printHints(list) };
}

// Druckprüfung der fertigen Körper: Jeder Körper wird so gedruckt, wie er liegt – getrennt auf der Druckplatte.
function printHints(list) {
  const out = [], f = x => +x.toFixed(1);
  for (const { name, mesh, features, info: { box, teile } } of list) {
    const z = box[2];
    if (z[0] > 0.05) out.push(`„${name}“ schwebt: Unterkante bei z = ${f(z[0])} – jeder Körper muss auf der Druckplatte (z = 0) liegen`);
    if (z[0] < -0.05) out.push(`„${name}“ ragt unter die Druckplatte (z = ${f(z[0])}) – auf z = 0 stellen`);
    if (teile > 1) out.push(`„${name}“ besteht aus ${teile} getrennten Stücken – Teile müssen sich überlappen (vereinigen), lose Stücke fallen beim Drucken um`);
    const { current, best } = bestOrientation(mesh);
    if (current.over > 60) { // kleine Querbohrungen und Langlöcher drucken noch ohne Stützen
      const dn = best.down.map(Math.round).join(','), better = best.score < current.score * 0.6 && Object.keys(DIRS).find(k => DIRS[k].join(',') === dn);
      out.push(`„${name}“ hat ${f(current.over)} mm² Überhang steiler als ${LIMITS.overhang}° (braucht Stützmaterial) – Fasen 45° statt Rundungen nach unten, Bohrungen quer zur Platte vermeiden` +
        (better && better !== 'unten' ? `; liegt besser mit der Seite „${better}“ nach unten` : ''));
    }
    if (!features.length) out.push(`„${name}“: keine Kante gebrochen – unten Fase 0,4–0,6 mm, oben und an Griffkanten Rundung oder Fase`);
  }
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i].info.box, b = list[j].info.box, gap = k => Math.max(a[k][0] - b[k][1], b[k][0] - a[k][1]);
    const gx = gap(0), gy = gap(1);
    if (gx < 0 && gy < 0) out.push(`„${list[i].name}“ und „${list[j].name}“ liegen über- oder ineinander – zum Drucken nebeneinander auf die Platte legen (≥ 5 mm Abstand)`);
    else if (Math.max(gx, gy) < 3) out.push(`„${list[i].name}“ und „${list[j].name}“ liegen nur ${f(Math.max(gx, gy))} mm auseinander – mindestens 5 mm Abstand lassen`);
  }
  return out;
}

// Bauplan in einen Link packen (#bauplan=…, Base64url) und wieder auslesen
export const toLink = (plan, base) => base + '#bauplan=' + btoa(unescape(encodeURIComponent(typeof plan === 'string' ? plan : JSON.stringify(plan)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromHash = h => decodeURIComponent(escape(atob(h.replace(/-/g, '+').replace(/_/g, '/'))));
