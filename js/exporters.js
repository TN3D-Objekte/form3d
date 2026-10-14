// Export sichtbarer Körper als STL (binär) und OBJ. Einheit: mm.
export function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function exportSTL(bodies) {
  const nTri = bodies.reduce((s, b) => s + b.mesh.t.length / 3, 0);
  const buf = new ArrayBuffer(84 + nTri * 50), dv = new DataView(buf);
  dv.setUint32(80, nTri, true);
  let o = 84;
  for (const { mesh: { v, t } } of bodies) {
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
      const l = Math.hypot(...n) || 1;
      for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, n[k] / l, true);
      for (const [j, p] of [[1, a], [2, b], [3, c]]) for (let k = 0; k < 3; k++) dv.setFloat32(o + j * 12 + k * 4, v[p + k], true);
      o += 50;
    }
  }
  return buf;
}

export function exportOBJ(bodies) {
  const out = ['# Form3D, Einheit mm'];
  let base = 1;
  for (const b of bodies) {
    const { v, t } = b.mesh;
    out.push('o ' + b.name.replace(/\s+/g, '_'));
    for (let i = 0; i < v.length; i += 3) out.push(`v ${v[i]} ${v[i + 1]} ${v[i + 2]}`);
    for (let i = 0; i < t.length; i += 3) out.push(`f ${t[i] + base} ${t[i + 1] + base} ${t[i + 2] + base}`);
    base += v.length / 3;
  }
  return out.join('\n');
}
