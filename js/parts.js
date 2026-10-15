// Bausteine für den 3D-Druck: Schraubenloch, Mutternfalle, Gewinde. Alle Maße in mm nach ISO, mit Spiel
// für den Druck. Die Geometrie entsteht in einem lokalen System: z = Achse in das Material hinein
// (beim Gewindebolzen aus der Fläche heraus), z = 0 auf der Fläche.
import * as K from './kernel.js';

export const SIZES = ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12'];
const ISO = { // d, Durchgangsloch (mittel), Senkkopf-Ø, Zylinderkopf-Ø und -Höhe, Mutter SW und Höhe, Steigung
  M2: { d: 2, hole: 2.4, csk: 4.4, cap: 3.8, capH: 2, nut: 4, nutH: 1.6, p: 0.4 },
  'M2.5': { d: 2.5, hole: 2.9, csk: 5.5, cap: 4.5, capH: 2.5, nut: 5, nutH: 2, p: 0.45 },
  M3: { d: 3, hole: 3.4, csk: 6.7, cap: 5.5, capH: 3, nut: 5.5, nutH: 2.4, p: 0.5 },
  M4: { d: 4, hole: 4.5, csk: 9, cap: 7, capH: 4, nut: 7, nutH: 3.2, p: 0.7 },
  M5: { d: 5, hole: 5.5, csk: 11.2, cap: 8.5, capH: 5, nut: 8, nutH: 4.7, p: 0.8 },
  M6: { d: 6, hole: 6.6, csk: 13.4, cap: 10, capH: 6, nut: 10, nutH: 5.2, p: 1 },
  M8: { d: 8, hole: 9, csk: 17.9, cap: 13, capH: 8, nut: 13, nutH: 6.8, p: 1.25 },
  M10: { d: 10, hole: 11, csk: 22.4, cap: 16, capH: 10, nut: 16, nutH: 8.4, p: 1.5 },
  M12: { d: 12, hole: 13.5, csk: 26.9, cap: 18, capH: 12, nut: 18, nutH: 10.8, p: 1.75 },
};
export const iso = m => ISO[m];
const PLAY = 0.2;   // zusätzliches Spiel für Kopf und Mutter (Ø bzw. Schlüsselweite)
const THREAD_PLAY = 0.15; // radiales Spiel zwischen gedrucktem Bolzen und gedrucktem Innengewinde
const OVER = 0.05;  // Überstand über die Fläche, damit nichts genau in der Fläche endet

const ccw = poly => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a < 0 ? poly.slice().reverse() : poly;
};

// Schraubenloch: head = 'csk' (Senkkopf 90°), 'cap' (Zylinderkopf, angesenkt) oder 'none'
export function screwHole(m, head, depth) {
  const s = ISO[m], rh = s.hole / 2;
  let prof;
  if (head === 'csk') { const rk = (s.csk + PLAY) / 2; prof = [[0, -OVER], [rk, -OVER], [rk, 0], [rh, rk - rh], [rh, depth], [0, depth]]; }
  else if (head === 'cap') { const rc = (s.cap + 2 * PLAY) / 2, kc = s.capH + PLAY; prof = [[0, -OVER], [rc, -OVER], [rc, kc], [rh, kc], [rh, depth], [0, depth]]; }
  else prof = [[0, -OVER], [rh, -OVER], [rh, depth], [0, depth]];
  return K.lathe(ccw(prof));
}

// Mutternfalle: Sechskant (Schlüsselweite + Spiel) in Mutternhöhe, darunter das Durchgangsloch bis depth
export function nutTrap(m, depth) {
  const s = ISO[m], r = (s.nut + PLAY) / 2 / Math.cos(Math.PI / 6), h = s.nutH + PLAY;
  const hex = Array.from({ length: 6 }, (_, i) => [r * Math.cos(i * Math.PI / 3), r * Math.sin(i * Math.PI / 3)]);
  const pocket = K.extrudeZ(hex, -OVER, h);
  return depth > h ? K.boolean('union', pocket, screwHole(m, 'none', depth)) : pocket;
}

// Gewinde (60°-Regelgewinde): inner = Werkzeug für ein Innengewinde (etwas größer), sonst Bolzen
// (etwas kleiner). Läuft von z0 bis z1; der Rand wird je Umdrehung schraubenförmig versetzt.
export function thread(m, z0, z1, inner) {
  const s = ISO[m], P = s.p, R = s.d / 2 + (inner ? THREAD_PLAY : -THREAD_PLAY), depth = 0.5413 * P, r0 = R - depth;
  // Profil über eine Steigung (0..1): Spitze 1/8, Flanke, Grund 1/4, Flanke
  const shape = u => (u < 0.125 ? 1 : u < 0.4375 ? 1 - (u - 0.125) / 0.3125 : u < 0.6875 ? 0 : (u - 0.6875) / 0.3125);
  const N = 48, nz = Math.max(2, Math.ceil((z1 - z0) / (P / 10))), v = [], t = [];
  for (let j = 0; j <= nz; j++) {
    const z = z0 + (z1 - z0) * j / nz;
    for (let i = 0; i < N; i++) {
      const th = 2 * Math.PI * i / N, u = (((z / P - i / N) % 1) + 1) % 1, r = r0 + depth * shape(u);
      v.push(r * Math.cos(th), r * Math.sin(th), z);
    }
  }
  const at = (i, j) => j * N + (i % N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < N; i++) t.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  const c0 = v.length / 3; v.push(0, 0, z0);
  const c1 = v.length / 3; v.push(0, 0, z1);
  for (let i = 0; i < N; i++) t.push(c0, at(i + 1, 0), at(i, 0), c1, at(i, nz), at(i + 1, nz));
  return K.solid(new Float32Array(v), new Uint32Array(t));
}
