// 3D-Ansicht: Renderer, Kamera (Z oben), Raster, Gesten-Navigation und Eingabeverteilung an das aktive Werkzeug.
import * as THREE from 'three';
import { TransformControls } from '../vendor/TransformControls.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Viewport {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 20000);
    this.camera.up.set(0, 0, 1);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d95a3, 1.6));
    const head = new THREE.DirectionalLight(0xffffff, 1.7);
    head.position.set(-0.4, 0.7, 1);
    this.camera.add(head);

    this.view = { target: new THREE.Vector3(0, 0, 0), dist: 420, theta: -Math.PI / 4, phi: 1.05 };
    this.raycaster = new THREE.Raycaster();
    this.tool = null;
    this.penSeen = false;
    // Gerät: 'tablet' (1 Finger dreht, 2 verschieben/zoomen), 'phone' (1 Finger nur Werkzeug/Tippen,
    // 2 Finger drehen + zoomen, 3 Finger verschieben), 'pc' (Maus; Touch wie Tablet)
    this.device = 'tablet';
    this._anim = 0;
    this.onOverlay = null;
    this.onBeforeRender = null;

    this._buildGrid();
    this.gizmo = new TransformControls(this.camera, canvas); // vor den eigenen Listenern, damit der Gizmo Vorrang hat
    this.gizmo.setSize(1.25);
    this.gizmo.setTranslationSnap(1);
    this.gizmo.setRotationSnap(THREE.MathUtils.degToRad(5));
    this.gizmo.setScaleSnap(0.05);
    this.gizmo.addEventListener('change', () => this.requestRender());
    this.scene.add(this.gizmo);

    this._bindInput();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  get twoFinger() { return this.device === 'phone'; }
  set twoFinger(on) { this.device = on ? 'phone' : 'tablet'; }

  _buildGrid() {
    const mat = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    this.grid = new THREE.Group();
    this.gridMinor = new THREE.LineSegments(new THREE.BufferGeometry(), mat(0x7f8a9c, 0.2));
    this.gridMajor = new THREE.LineSegments(new THREE.BufferGeometry(), mat(0x5f6b7c, 0.45));
    this.grid.add(this.gridMinor, this.gridMajor);
    this.grid.matrixAutoUpdate = false;
    this.scene.add(this.grid);
    this.gridKey = '';
    this.gridStep = () => 10; // von außen gesetzt: Rasterweite zur Pixelgröße
    this.onGrid = null;

    const axes = new THREE.BufferGeometry();
    axes.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 500, 0, 0, 0, 0, 0, 0, 500, 0, 0, 0, 0, 0, 0, 120], 3));
    axes.setAttribute('color', new THREE.Float32BufferAttribute([0.9, 0.28, 0.3, 0.9, 0.28, 0.3, 0.19, 0.64, 0.42, 0.19, 0.64, 0.42, 0.23, 0.51, 0.96, 0.23, 0.51, 0.96], 3));
    this.scene.add(new THREE.LineSegments(axes, new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false })));
  }

  // Raster auf eine Skizzenebene legen (null = XY-Grundebene)
  setWorkPlane(m16) {
    if (m16) this.grid.matrix.fromArray(m16); else this.grid.matrix.identity();
    this.gridKey = '';
    this.requestRender();
  }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1, dpr = Math.min(devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.overlay.width = w * dpr;
    this.overlay.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    this.requestRender();
  }

  applyView() {
    const { target, dist, theta, phi } = this.view, s = Math.sin(phi);
    this.camera.position.set(target.x + dist * s * Math.cos(theta), target.y + dist * s * Math.sin(theta), target.z + dist * Math.cos(phi));
    this.camera.lookAt(target);
    this.camera.near = dist / 200;
    this.camera.far = dist * 50 + 5000;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
  }

  // Raster passend zur Zoomstufe: feine Linien im Rasterabstand, kräftige alle 10, um die Blickmitte
  _updateGrid() {
    const step = this.gridStep(this.pxSize(this.view.target)), major = step * 10;
    const inv = this.grid.matrix.clone().invert(), c = this.view.target.clone().applyMatrix4(inv);
    const cx = Math.round(c.x / major) * major, cy = Math.round(c.y / major) * major, n = 150;
    const key = [step, cx, cy].join();
    if (key === this.gridKey) return;
    if (this.gridKey.split(',')[0] !== String(step)) this.onGrid?.(step);
    this.gridKey = key;
    const minor = [], maj = [], h = n * step;
    for (let k = -n; k <= n; k++) {
      const x = cx + k * step, y = cy + k * step, out = k % 10 ? minor : maj;
      out.push(x, cy - h, 0, x, cy + h, 0, cx - h, y, 0, cx + h, y, 0);
    }
    for (const [obj, arr] of [[this.gridMinor, minor], [this.gridMajor, maj]]) {
      obj.geometry.dispose();
      obj.geometry = new THREE.BufferGeometry();
      obj.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    }
  }

  render() {
    this.applyView();
    this._updateGrid();
    this.onBeforeRender?.();
    this.renderer.render(this.scene, this.camera);
    this.ctx.clearRect(0, 0, this.w, this.h);
    this.onOverlay?.(this.ctx);
  }

  // ---- Hilfen für Werkzeuge ----
  ray(x, y) {
    const r = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera);
    return this.raycaster;
  }

  // Schnitt des Zeigerstrahls mit einer Ebene, Ergebnis in Ebenenkoordinaten
  planePoint(x, y, pl) {
    const { origin: o, direction: d } = this.ray(x, y).ray;
    const den = d.x * pl.n[0] + d.y * pl.n[1] + d.z * pl.n[2];
    if (Math.abs(den) < 1e-6) return null;
    const t = ((pl.o[0] - o.x) * pl.n[0] + (pl.o[1] - o.y) * pl.n[1] + (pl.o[2] - o.z) * pl.n[2]) / den;
    if (t <= 0) return null;
    const q = [o.x + d.x * t - pl.o[0], o.y + d.y * t - pl.o[1], o.z + d.z * t - pl.o[2]];
    return [q[0] * pl.x[0] + q[1] * pl.x[1] + q[2] * pl.x[2], q[0] * pl.y[0] + q[1] * pl.y[1] + q[2] * pl.y[2]];
  }

  viewPlanePoint(x, y) {
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, this.view.target);
    return this.ray(x, y).ray.intersectPlane(plane, new THREE.Vector3()) || this.view.target.clone();
  }

  // Weltgröße eines CSS-Pixels in der Tiefe des Punktes
  pxSize(p) {
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const depth = Math.max(1e-3, dir.dot(new THREE.Vector3(p.x - this.camera.position.x, p.y - this.camera.position.y, p.z - this.camera.position.z)));
    return 2 * depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / this.h;
  }

  project(v, out) {
    out.copy(v).project(this.camera);
    if (out.z > 1 || out.z < -1) return false;
    out.x = (out.x + 1) / 2 * this.w;
    out.y = (1 - out.y) / 2 * this.h;
    return true;
  }

  // ---- Kamerasteuerung ----
  animateTo(to, ms = 380) {
    const v = this.view, from = { target: v.target.clone(), dist: v.dist, theta: v.theta, phi: v.phi };
    const tgt = to.target || from.target, dist = to.dist ?? from.dist, phi = to.phi ?? from.phi;
    let dth = (to.theta ?? from.theta) - from.theta;
    dth = ((dth + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const t0 = performance.now(), id = ++this._anim;
    const step = () => {
      if (this._anim !== id) return;
      const k = clamp((performance.now() - t0) / ms, 0, 1), e = k * k * (3 - 2 * k);
      v.target.lerpVectors(from.target, tgt, e);
      v.dist = from.dist + (dist - from.dist) * e;
      v.theta = from.theta + dth * e;
      v.phi = from.phi + (phi - from.phi) * e;
      this.render();
      if (k < 1) requestAnimationFrame(step);
    };
    step();
  }

  setView(name) {
    const views = { iso: [-Math.PI / 4, 1.05], top: [-Math.PI / 2, 0.001], front: [-Math.PI / 2, Math.PI / 2], right: [0, Math.PI / 2] };
    const [theta, phi] = views[name];
    this.animateTo({ theta, phi });
  }

  lookAtPlane(pl, center) {
    const phi = clamp(Math.acos(clamp(pl.n[2], -1, 1)), 0.001, Math.PI - 0.001);
    const theta = Math.abs(pl.n[2]) > 0.9999 ? -Math.PI / 2 : Math.atan2(pl.n[1], pl.n[0]);
    this.animateTo({ theta, phi, target: center });
  }

  fit(box) {
    if (box.isEmpty()) return this.animateTo({ target: new THREE.Vector3(), dist: 420 });
    const s = box.getBoundingSphere(new THREE.Sphere());
    const half = THREE.MathUtils.degToRad(this.camera.fov / 2) * Math.min(1, this.camera.aspect);
    this.animateTo({ target: s.center, dist: clamp(s.radius / Math.sin(half) * 1.25, 20, 8000) });
  }

  _bindInput() {
    const el = this.canvas, pts = new Map(), v = this.view;
    let mode = null, down = null, grab = null, pinch = null, lastTap = { t: 0, x: 0, y: 0 };
    const ev = e => ({ x: e.clientX, y: e.clientY, type: e.pointerType, shift: e.shiftKey });
    const touches = () => [...pts.values()].filter(p => p.type === 'touch');
    const zoomAt = (x, y, dist) => {
      const g = grab || this.viewPlanePoint(x, y);
      v.dist = clamp(dist, 5, 12000);
      this.applyView();
      v.target.add(g).sub(this.viewPlanePoint(x, y));
      this.requestRender();
    };
    const mid = () => { const [a, b] = touches(); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x) }; };
    // Zwei Finger umeinander drehen = Ansicht um die senkrechte Achse drehen (Drehteller). Erst ab TWIST
    // Gesamtwinkel, damit Spreizen und Verschieben nicht nebenbei drehen; danach ohne Sprung.
    const TWIST = 0.15;
    const twist = m => {
      let da = m.a - pinch.a;
      da = ((da + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      pinch.a = m.a;
      const before = pinch.tw;
      pinch.tw += da;
      const eff = x => Math.sign(x) * Math.max(0, Math.abs(x) - TWIST);
      const d = eff(pinch.tw) - eff(before);
      if (d) v.theta += d * (Math.cos(v.phi) >= 0 ? 1 : -1);
    };
    const centroid = () => { const t = touches(); return { x: t.reduce((s, p) => s + p.x, 0) / t.length, y: t.reduce((s, p) => s + p.y, 0) / t.length }; };
    // Mehrfinger-Geste (neu) beginnen – auch wenn Finger dazukommen oder abheben, damit nichts springt
    const startGesture = () => {
      if (this.twoFinger && touches().length >= 3) { mode = 'pan'; const c = centroid(); grab = this.viewPlanePoint(c.x, c.y); return; }
      mode = 'pinch';
      const m = mid();
      pinch = { d: m.d, dist: v.dist, x: m.x, y: m.y, a: m.a, tw: 0 };
      grab = this.twoFinger ? null : this.viewPlanePoint(m.x, m.y);
    };

    el.addEventListener('pointerdown', e => {
      if (this.gizmo.dragging) return;
      this._anim++;
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetische Ereignisse */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      if (e.pointerType === 'pen' && !this.penSeen) { this.penSeen = true; this.onPen?.(); }
      if (e.pointerType === 'touch') {
        if (touches().length >= 2) {
          if (mode === 'tool') this.tool?.onCancel?.();
          down = null;
          startGesture();
          return;
        }
      }
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, button: e.button };
      if (e.pointerType === 'mouse' && e.button === 2) { mode = 'orbit'; down.moved = true; return; }
      if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 0 && e.shiftKey)) { mode = 'pan'; grab = this.viewPlanePoint(e.clientX, e.clientY); return; }
      mode = this.tool?.onDown?.(ev(e)) ? 'tool' : this.twoFinger && e.pointerType === 'touch' ? 'tap' : 'orbit';
    });

    el.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId);
      if (!p) { if (e.pointerType !== 'touch' && !this.gizmo.dragging) this.tool?.onHover?.(ev(e)); return; }
      p.x = e.clientX; p.y = e.clientY;
      if (mode === 'pan') { if (p.type === 'touch') { const c = centroid(); zoomAt(c.x, c.y, v.dist); } return; }
      if (mode === 'pinch') {
        if (p.type !== 'touch' || touches().length < 2) return;
        const m = mid();
        twist(m);
        if (!this.twoFinger) { this.applyView(); return zoomAt(m.x, m.y, pinch.dist * pinch.d / m.d); }
        // zwei Finger gemeinsam ziehen = drehen, spreizen = zoomen zur Fingermitte
        v.theta -= (m.x - pinch.x) * 0.008;
        v.phi = clamp(v.phi - (m.y - pinch.y) * 0.008, 0.001, Math.PI - 0.001);
        this.applyView();
        const g = this.viewPlanePoint(m.x, m.y);
        v.dist = clamp(v.dist * pinch.d / m.d, 5, 12000);
        this.applyView();
        v.target.add(g).sub(this.viewPlanePoint(m.x, m.y));
        Object.assign(pinch, { x: m.x, y: m.y, d: m.d });
        this.requestRender();
        return;
      }
      if (!down || e.pointerId !== down.id) return;
      if (mode === 'tool') this.tool?.onMove?.(ev(e));
      else if (mode === 'tap') { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 7) down.moved = true; }
      else if (mode === 'orbit') {
        if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 7) return;
        if (!down.moved) { down.moved = true; down.lx = e.clientX; down.ly = e.clientY; }
        v.theta -= (e.clientX - down.lx) * 0.008;
        v.phi = clamp(v.phi - (e.clientY - down.ly) * 0.008, 0.001, Math.PI - 0.001);
        down.lx = e.clientX; down.ly = e.clientY;
        this.requestRender();
      } else if (mode === 'pan') zoomAt(e.clientX, e.clientY, v.dist);
    });

    const end = (e, cancelled) => {
      if (!pts.delete(e.pointerId)) return;
      if (mode === 'pinch' || mode === 'pan') {
        if (touches().length >= 2) startGesture(); else { mode = null; down = null; grab = null; }
        return;
      }
      if (!down || e.pointerId !== down.id) return;
      if (mode === 'tool') cancelled ? this.tool?.onCancel?.() : this.tool?.onUp?.(ev(e));
      else if ((mode === 'orbit' || mode === 'tap') && !down.moved && !cancelled) {
        const now = performance.now();
        const dbl = now - lastTap.t < 380 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24;
        lastTap = { t: dbl ? 0 : now, x: e.clientX, y: e.clientY };
        if (dbl && this.tool?.onDoubleTap) this.tool.onDoubleTap(ev(e)); else this.tool?.onTap?.(ev(e));
      }
      mode = null; down = null; grab = null;
    };
    el.addEventListener('pointerup', e => end(e, false));
    el.addEventListener('pointercancel', e => end(e, true));

    el.addEventListener('wheel', e => {
      e.preventDefault();
      grab = null;
      zoomAt(e.clientX, e.clientY, v.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)));
    }, { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());
    for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, e => e.preventDefault());
  }
}
