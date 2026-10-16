// Ansichtswürfel: zeigt die Lage der Ansicht. Tippen auf Fläche, Kante oder Ecke springt in die passende
// Ansicht, Ziehen am Würfel dreht die Ansicht.
import * as THREE from 'three';

const M = 0.2; // Randbreite der Kanten- und Eckzonen (Würfel hat Kantenlänge 1)
const FACES = [ // Normale, Bildschirm-oben auf der Fläche, Beschriftung
  [[1, 0, 0], [0, 0, 1], 'Rechts'], [[-1, 0, 0], [0, 0, 1], 'Links'],
  [[0, 1, 0], [0, 0, 1], 'Hinten'], [[0, -1, 0], [0, 0, 1], 'Vorne'],
  [[0, 0, 1], [0, 1, 0], 'Oben'], [[0, 0, -1], [0, -1, 0], 'Unten'],
];

function faceTexture(label) {
  const c = document.createElement('canvas'), S = 256;
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#f8fafc'; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#cbd5e1'; g.lineWidth = 6; g.strokeRect(S * M, S * M, S * (1 - 2 * M), S * (1 - 2 * M));
  g.fillStyle = '#344054'; g.font = '650 62px -apple-system, "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, S / 2, S / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Zone unter einem Punkt der Würfeloberfläche: Richtung mit 1 (Fläche), 2 (Kante) oder 3 (Ecke) Anteilen
const zoneOf = p => p.toArray().map(c => (Math.abs(c) > 0.5 - M ? Math.sign(c) : 0));

export class ViewCube {
  constructor(canvas, vp) {
    this.canvas = canvas;
    this.vp = vp;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-0.9, 0.9, 0.9, -0.9, 0.1, 10);
    this.scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 0.9);
    light.position.set(0.3, 0.6, 1);
    this.camera.add(light);
    this.scene.add(this.camera);

    this.cube = new THREE.Group();
    for (const [n, up, label] of FACES) {
      const N = new THREE.Vector3(...n), U = new THREE.Vector3(...up), R = U.clone().cross(N);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map: faceTexture(label) }));
      face.matrixAutoUpdate = false;
      face.matrix.makeBasis(R, U, N).setPosition(N.multiplyScalar(0.5));
      this.cube.add(face);
    }
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x94a3b8 })));
    this.hitBox = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ visible: false }));
    this.cube.add(this.hitBox);
    this.mark = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.45 }));
    this.mark.visible = false;
    this.cube.add(this.mark);
    this.scene.add(this.cube);

    this.raycaster = new THREE.Raycaster();
    this._bindInput();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.render();
  }

  // gleiche Blickrichtung wie die Hauptansicht, nur ohne Perspektive
  render() {
    const q = this.vp.camera.quaternion;
    this.camera.quaternion.copy(q);
    this.camera.position.set(0, 0, 3).applyQuaternion(q);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }

  // Bildschirmpunkt eines Würfelpunkts (für Tests)
  screenOf(p) {
    const v = new THREE.Vector3(...p).project(this.camera), r = this.canvas.getBoundingClientRect();
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
  }

  zoneAt(x, y) {
    const r = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObject(this.hitBox, false)[0];
    return hit ? zoneOf(hit.point) : null;
  }

  // Zone hervorheben: flache Kachel knapp über der Oberfläche
  highlight(z) {
    const was = this.mark.visible;
    this.mark.visible = !!z;
    if (z) {
      const lo = z.map(c => (c ? 0.5 - M : -(0.5 - M))), hi = z.map(c => (c ? 0.505 : 0.5 - M));
      this.mark.scale.set(...lo.map((l, i) => hi[i] - l));
      this.mark.position.set(...lo.map((l, i) => z[i] * ((l + hi[i]) / 2) || 0));
    }
    if (z || was) this.render();
  }

  // in die Ansicht aus Richtung z springen
  snapTo(z) {
    const vp = this.vp, d = new THREE.Vector3(...z).normalize();
    const phi = Math.acos(d.z);
    let theta;
    if (Math.abs(d.z) < 0.999) theta = Math.atan2(d.y, d.x);
    else { // von oben/unten: die jetzige Drehung auf die nächste Vierteldrehung runden
      const th = vp.view.theta + (Math.sin(vp.view.phi) < 0 ? Math.PI : 0);
      theta = Math.round((th + Math.PI / 2) / (Math.PI / 2)) * (Math.PI / 2) - Math.PI / 2;
    }
    vp.animateTo({ theta, phi });
  }

  _bindInput() {
    const el = this.canvas;
    let down = null;
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetische Ereignisse */ }
      this.vp._anim++;
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
      this.highlight(this.zoneAt(e.clientX, e.clientY));
    });
    el.addEventListener('pointermove', e => {
      if (!down) { if (e.pointerType === 'mouse') this.highlight(this.zoneAt(e.clientX, e.clientY)); return; }
      if (e.pointerId !== down.id) return;
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return;
      if (!down.moved) {
        down.moved = true;
        this.highlight(null);
        down.pivot = this.vp.pivotMark = this.vp.pivotAt(this.vp.w / 2, this.vp.h / 2);
      }
      this.vp.orbit((e.clientX - down.lx) * 1.6, (e.clientY - down.ly) * 1.6, down.pivot);
      down.lx = e.clientX; down.ly = e.clientY;
    });
    const end = (e, cancelled) => {
      if (!down || e.pointerId !== down.id) return;
      const z = !down.moved && !cancelled && this.zoneAt(e.clientX, e.clientY);
      if (z) this.snapTo(z);
      if (down.moved) { this.vp.pivotMark = null; this.vp.requestRender(); }
      down = null;
      this.highlight(e.pointerType === 'mouse' && !cancelled ? this.zoneAt(e.clientX, e.clientY) : null);
    };
    el.addEventListener('pointerup', e => end(e, false));
    el.addEventListener('pointercancel', e => end(e, true));
    el.addEventListener('pointerleave', e => { if (!down) this.highlight(null); });
  }
}
