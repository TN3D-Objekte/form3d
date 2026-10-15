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

// ---- 3MF: ZIP (ungepackt) mit XML-Modell, Einheit mm, je Körper ein Objekt mit Name und Farbe ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// files: [{ name, data: Uint8Array }] → ZIP-Archiv (Methode „gespeichert“)
export function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [8, 0, 2], [14, crc, 4], [18, n, 4], [22, n, 4], [26, name.length, 2]].forEach(([o, x, s]) => (s === 4 ? h.setUint32(o, x, true) : h.setUint16(o, x, true)));
    parts.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [16, crc, 4], [20, n, 4], [24, n, 4], [28, name.length, 2], [42, off, 4]].forEach(([o, x, s]) => (s === 4 ? c.setUint32(o, x, true) : c.setUint16(o, x, true)));
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + n;
  }
  const size = central.reduce((s, p) => s + p.length, 0), e = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, off, 4]].forEach(([o, x, s]) => (s === 4 ? e.setUint32(o, x, true) : e.setUint16(o, x, true)));
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

const xmlEsc = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

export function export3MF(bodies) {
  const num = x => +x.toFixed(4);
  const mats = bodies.map(b => `<base name="${xmlEsc(b.name)}" displaycolor="${(b.color || '#a9b4c4').toUpperCase()}FF"/>`).join('');
  const objs = bodies.map((b, i) => {
    const { v, t } = b.mesh, vs = [], ts = [];
    for (let k = 0; k < v.length; k += 3) vs.push(`<vertex x="${num(v[k])}" y="${num(v[k + 1])}" z="${num(v[k + 2])}"/>`);
    for (let k = 0; k < t.length; k += 3) ts.push(`<triangle v1="${t[k]}" v2="${t[k + 1]}" v3="${t[k + 2]}"/>`);
    return `<object id="${i + 2}" name="${xmlEsc(b.name)}" type="model" pid="1" pindex="${i}"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>`;
  }).join('');
  const items = bodies.map((_, i) => `<item objectid="${i + 2}"/>`).join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Form3D</metadata><resources><basematerials id="1">${mats}</basematerials>${objs}</resources><build>${items}</build></model>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  const enc = new TextEncoder();
  return zip([{ name: '[Content_Types].xml', data: enc.encode(types) }, { name: '_rels/.rels', data: enc.encode(rels) }, { name: '3D/3dmodel.model', data: enc.encode(model) }]);
}

// Datei über das Teilen-Menü des Geräts weitergeben (z. B. an eine Slicer-App), sonst herunterladen
export async function share(name, data, type) {
  const file = new File([data], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return true; }
  }
  download(name, data, type);
  return false;
}
