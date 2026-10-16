// Seite zum Fuzz-Test (tests/fuzz.html), Prüfregeln und Fälle in fuzzlib.js:
//   fuzz.html?from=0&n=500[&workers=6][&post=<key>]   Fälle in Workern prüfen; Ergebnis als JSON in <pre id="out">,
//                                                     mit post zusätzlich stückweise an fuzz_run.py
//   fuzz.html?case=17&view[&clean][&at=x,y,z&dist=..&az=..&el=..]   einen Fall ansehen: vorher | nachher, Verstöße rot
//   fuzz.html?case=17&cut=x,0[&at=..&span=..]   Querschnitt vorher/nachher
//   fuzz.html?file=<bug.json>&edges=19,10&kind=fillet&size=2[&view]  Körper aus einer Fehleraufzeichnung
import { K, runCase, fileCase, check } from './fuzzlib.js';
import { analyze } from '../js/meshview.js';
import { edgeChains } from '../js/edges.js';
import { applyEdges } from '../js/blendop.js';

// ---------------------------------------------------------------- Ansicht eines Falls
// Vorher (links) und nachher (rechts) mit derselben Kamera. Blick auf den ersten Verstoß (oder at=x,y,z) von
// außen, entlang der mittleren Flächennormale dort; dist/az/el (Grad) überschreiben die Kamera.
async function show(M, Rm, bad, size = 1) {
  const THREE = await import('../vendor/three.module.js');
  const q = new URLSearchParams(location.search), w = 600, h = 600;
  const pts = Object.values(bad).flat();
  const focus = q.get('at') ? q.get('at').split(',').map(Number) : pts[0] || null;
  const scene = mesh => {
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0xf4f5f8);
    const an = analyze(mesh), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(an.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(an.nor, 3));
    const col = new Float32Array(an.pos.length);
    for (let i = 0; i < an.pos.length / 9; i++) { const c = an.tg[i] ? [0.55, 0.7, 0.95] : [0.78, 0.8, 0.83]; for (let k = 0; k < 3; k++) col.set(c, i * 9 + k * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sc.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(an.edges, 3));
    sc.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x112 })));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x556677, 1.6), sun);
    return { sc, an, g, sun };
  };
  const A = scene(M), B = scene(Rm);
  if (pts.length && !q.has('clean')) {
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.flat()), 3));
    B.sc.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xff0000, size: 5, sizeAttenuation: false, depthTest: false })));
  }
  const box = new THREE.Box3().setFromBufferAttribute(B.g.attributes.position);
  const f = focus ? new THREE.Vector3(...focus) : box.getCenter(new THREE.Vector3());
  // Blickrichtung: gemittelte Normale der Dreiecke von M nahe am Fokus (von außen auf die Stelle)
  let dir = new THREE.Vector3(0.5, -0.7, 0.6);
  if (focus) {
    const d = new THREE.Vector3(), an = A.an, rad = 3 * size + 1;
    for (let i = 0; i < an.pos.length / 9; i++) {
      const cx = (an.pos[9 * i] + an.pos[9 * i + 3] + an.pos[9 * i + 6]) / 3 - f.x, cy = (an.pos[9 * i + 1] + an.pos[9 * i + 4] + an.pos[9 * i + 7]) / 3 - f.y, cz = (an.pos[9 * i + 2] + an.pos[9 * i + 5] + an.pos[9 * i + 8]) / 3 - f.z;
      if (Math.hypot(cx, cy, cz) < rad) d.add(new THREE.Vector3(an.fn[3 * i], an.fn[3 * i + 1], an.fn[3 * i + 2]).multiplyScalar(an.fa[i]));
    }
    if (d.length() > 1e-9) dir = d.normalize().add(new THREE.Vector3(0.25, -0.2, 0.3)).normalize();
  }
  if (q.get('az')) { const az = +q.get('az') * Math.PI / 180, el = +(q.get('el') || 30) * Math.PI / 180; dir.set(Math.cos(el) * Math.cos(az), -Math.cos(el) * Math.sin(az), Math.sin(el)); }
  const dist = +(q.get('dist') || (focus ? 14 * size + 4 : box.getSize(new THREE.Vector3()).length() * 1.4));
  const cam = new THREE.PerspectiveCamera(35, w / h, 0.01, 5000);
  cam.up.set(0, 0, 1);
  if (Math.abs(dir.z) > 0.97) cam.up.set(0, 1, 0);
  cam.position.copy(f).addScaledVector(dir, dist);
  cam.lookAt(f);
  const ren = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  ren.setSize(2 * w, h);
  ren.setScissorTest(true);
  for (const [k, S] of [[0, A], [1, B]]) {
    S.sun.position.copy(cam.position).add(new THREE.Vector3(5, 5, 10));
    ren.setViewport(k * w, 0, w, h); ren.setScissor(k * w, 0, w, h);
    ren.render(S.sc, cam);
  }
  document.body.append(ren.domElement);
  const img = document.createElement('img');
  img.id = 'shot';
  img.src = ren.domElement.toDataURL('image/png');
  document.body.append(img);
}

// Querschnitt durch vorher (grau) und nachher (blau, Rundungsflächen dunkler) in der Ebene cut=x|y|z,Wert
// um den Fokus herum (Fenster ±span mm)
function section(M, Rm, bad, size) {
  const q = new URLSearchParams(location.search), [ax, val] = q.get('cut').split(','), k = 'xyz'.indexOf(ax), c = +val;
  const [u, v] = [0, 1, 2].filter(i => i !== k), W = 800, span = +(q.get('span') || 4 * size + 2);
  const pts = Object.values(bad).flat(), at = q.get('at') ? q.get('at').split(',').map(Number) : pts.find(p => Math.abs(p[k] - c) < 2 * size) || pts[0] || [0, 0, 0];
  const cv = document.createElement('canvas');
  cv.width = cv.height = W;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, W);
  const X = p => (p[u] - at[u] + span) / (2 * span) * W, Y = p => W - (p[v] - at[v] + span) / (2 * span) * W;
  const cutMesh = (mesh, style, width) => {
    const an = analyze(mesh);
    for (let i = 0; i < mesh.t.length / 3; i++) {
      const P = [0, 1, 2].map(j => { const o = mesh.t[3 * i + j] * 3; return [mesh.v[o], mesh.v[o + 1], mesh.v[o + 2]]; });
      const hit = [];
      for (let j = 0; j < 3; j++) {
        const a = P[j], b = P[(j + 1) % 3], da = a[k] - c, db = b[k] - c;
        if ((da < 0) !== (db < 0)) { const t = da / (da - db); hit.push(a.map((x, m) => x + (b[m] - x) * t)); }
      }
      if (hit.length < 2) continue;
      g.strokeStyle = typeof style === 'function' ? style(an.tg[i]) : style;
      g.lineWidth = width;
      g.beginPath(); g.moveTo(X(hit[0]), Y(hit[0])); g.lineTo(X(hit[1]), Y(hit[1])); g.stroke();
    }
  };
  cutMesh(M, '#bbb', 7);
  cutMesh(Rm, tg => (tg ? '#1d4ed8' : '#60a5fa'), 2);
  g.fillStyle = '#e00';
  for (const p of pts) if (Math.abs(p[k] - c) < 0.2 * size + 0.05) g.fillRect(X(p) - 3, Y(p) - 3, 6, 6);
  g.fillStyle = '#000'; g.font = '14px monospace';
  g.fillText(`Schnitt ${ax}=${c}, Mitte ${at.map(x => x.toFixed(2)).join(',')}, Breite ${(2 * span).toFixed(1)} mm  (grau vorher, blau nachher)`, 8, 18);
  const img = document.createElement('img');
  img.id = 'shot';
  img.src = cv.toDataURL('image/png');
  document.body.append(img);
}

// ---------------------------------------------------------------- Viele Fälle in Workern
// Hängt ein Fall länger als LIMIT, wird sein Worker beendet und der Fall als ZEITLIMIT gemeldet.
const LIMIT = 90000;
async function runMany(from, n, workers, post) {
  const all = [], queue = Array.from({ length: n }, (_, i) => from + i), retried = new Set();
  let pending = [];
  const flush = last => {
    if (!post || (!last && pending.length < 25)) return null;
    const body = JSON.stringify({ results: pending, last });
    pending = [];
    return fetch('/fuzz-result?key=' + post, { method: 'POST', body });
  };
  const fail = (id, code, why) => ({ id, fail: true, steps: [{ codes: { [code]: 1 }, sig: { [code]: why } }] });
  // Manifold gibt seinen WASM-Speicher im Worker nie zurück: Worker nach RECYCLE Fällen ersetzen, sonst wächst
  // der Speicher mit jedem Fall, bis das System den Lauf abbricht. recycle=1: jeder Fall in einem frischen Worker –
  // langsamer, aber unabhängig von den vorher gelaufenen Fällen (fortlaufende Kennungen in Manifold verändern die
  // Dreiecke minimal), also für Vorher/Nachher-Vergleiche
  const RECYCLE = +(q.get('recycle') || 25);
  const slot = async () => {
    let w = null, used = 0;
    while (queue.length) {
      const id = queue.shift();
      if (w && used >= RECYCLE) { w.terminate(); w = null; }
      if (!w) { w = new Worker('fuzz-worker.js', { type: 'module' }); used = 0; }
      used++;
      const r = await new Promise(res => {
        const timer = setTimeout(() => { w.terminate(); w = null; res(fail(id, 'ZEITLIMIT', '-')); }, LIMIT);
        w.onmessage = e => { clearTimeout(timer); res(e.data); };
        w.onerror = e => { clearTimeout(timer); w.terminate(); w = null; res(fail(id, 'WORKER', String(e.message).slice(0, 60))); };
        w.postMessage(id);
      });
      // Worker, die gar nicht erst starten (unter Last gelegentlich), einmal wiederholen
      if (r.steps?.[0]?.codes?.WORKER && !retried.has(id)) { retried.add(id); queue.unshift(id); continue; }
      all.push(r);
      pending.push(r);
      flush(false);
      outEl.textContent = `${all.length}/${n}`;
    }
    w?.terminate();
  };
  await Promise.all(Array.from({ length: Math.min(workers, n) }, slot));
  await flush(true);
  return all;
}

// ---------------------------------------------------------------- Start
const outEl = document.getElementById('out');
const q = new URLSearchParams(location.search);
await K.initKernel();
try {
  if (q.has('file')) {
    const c = await fileCase(q.get('file'), q), chains = edgeChains(c.mesh);
    const r = applyEdges(c, c.edges.map(i => chains[i]), c.kind, c.size);
    const res = check(c.mesh, r.mesh, c.edges, c.kind, c.size, c.features.length > 0);
    const bb = [0, 1, 2].map(k => { let lo = Infinity, hi = -Infinity; for (let i = k; i < c.mesh.v.length; i += 3) { lo = Math.min(lo, c.mesh.v[i]); hi = Math.max(hi, c.mesh.v[i]); } return [+lo.toFixed(1), +hi.toFixed(1)]; });
    outEl.textContent = JSON.stringify({ box: bb, chains: c.edges.map(i => [chains[i].pts[0], chains[i].pts.at(-1)].map(p => p.map(x => +x.toFixed(2)))), codes: res.codes, sig: res.sig, bad: Object.fromEntries(Object.entries(res.bad).map(([k, v]) => [k, v.slice(0, 5).map(p => p.map(x => +x.toFixed(2)))])) });
    if (q.has('cut')) section(c.mesh, r.mesh, res.bad, c.size);
    else if (q.has('view')) await show(c.mesh, r.mesh, res.bad, c.size);
  } else if (q.has('case')) {
    const res = runCase(+q.get('case'), true), last = res.last;
    delete res.last;
    outEl.textContent = JSON.stringify(res);
    if (q.has('cut') && last) section(last.M, last.R, last.bad, res.steps.at(-1).size);
    else if (q.has('view') && last) await show(last.M, last.R, last.bad, res.steps.at(-1).size);
  } else {
    const all = await runMany(+(q.get('from') || 0), +(q.get('n') || 20), +(q.get('workers') || navigator.hardwareConcurrency - 2 || 2), q.get('post'));
    all.sort((a, b) => a.id - b.id);
    outEl.textContent = JSON.stringify(all);
  }
} catch (e) { outEl.textContent = 'FEHLER ' + (e.stack || e); }
outEl.dataset.done = '1';
document.title = 'FUZZ DONE';
