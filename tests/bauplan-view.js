// Bauplan ohne App bauen und ansehen (tests/bauplan.html?file=…): Bericht als JSON, Bild von vorne rechts oben und
// von hinten links unten. Für KI-Werkzeuge, die ihre Baupläne selbst prüfen wollen.
import * as THREE from '../vendor/three.module.js';
import * as K from '../js/kernel.js';
import { analyze } from '../js/meshview.js';
import { runBauplan } from '../js/bauplan.js';

const out = document.getElementById('out');
try {
  await K.initKernel();
  const res = runBauplan(await (await fetch(new URLSearchParams(location.search).get('file'))).text());
  out.textContent = JSON.stringify({ ok: res.ok, schritte: res.report, koerper: res.bodies.map(b => b.info) }, null, 1);
  if (res.bodies.length) {
    const w = 640, h = 520, scene = new THREE.Scene(), box = new THREE.Box3();
    scene.background = new THREE.Color(0xf4f5f8);
    for (const b of res.bodies) {
      const an = analyze(b.mesh), g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(an.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(an.nor, 3));
      scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xa9b4c4, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
      const eg = new THREE.BufferGeometry();
      eg.setAttribute('position', new THREE.BufferAttribute(an.edges, 3));
      scene.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x1f2937 })));
      box.expandByObject(scene.children.at(-2));
    }
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.6), sun);
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() * 1.15;
    const ren = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    ren.setSize(2 * w, h);
    ren.setScissorTest(true);
    [[1, -1.4, 1], [-1, 1.4, -0.8]].forEach((d, k) => {
      const cam = new THREE.PerspectiveCamera(35, w / h, 0.1, 10000);
      cam.up.set(0, 0, 1);
      cam.position.copy(c).add(new THREE.Vector3(...d).normalize().multiplyScalar(r * 1.3));
      cam.lookAt(c);
      sun.position.copy(cam.position).add(new THREE.Vector3(0, 0, r));
      ren.setViewport(k * w, 0, w, h); ren.setScissor(k * w, 0, w, h);
      ren.render(scene, cam);
    });
    document.body.append(Object.assign(document.createElement('img'), { id: 'shot', src: ren.domElement.toDataURL('image/png') }));
  }
} catch (e) { out.textContent = 'FEHLER ' + (e.stack || e); }
document.title = 'BAUPLAN DONE';
