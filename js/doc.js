// Dokumentmodell mit Verlauf (Undo/Redo), Autosave in IndexedDB und Dateiformat.
// Körper sind unveränderlich: bei Änderungen wird das Objekt ersetzt, nie mutiert.
export const doc = { name: 'Unbenannt', bodies: [], sketches: [], nextId: 1 };

const hist = [];
let hi = -1, saveTimer = 0;
const listeners = [];

export const onChange = fn => listeners.push(fn);
const emit = () => listeners.forEach(fn => fn());
export const newId = () => doc.nextId++;

const snapshot = () => ({ name: doc.name, bodies: doc.bodies.slice(), sketches: structuredClone(doc.sketches), nextId: doc.nextId });
function restore(s) {
  doc.name = s.name;
  doc.bodies = s.bodies.slice();
  doc.sketches = structuredClone(s.sketches);
  doc.nextId = s.nextId;
}

export function commit() {
  hist.length = hi + 1;
  hist.push(snapshot());
  if (hist.length > 80) hist.shift();
  hi = hist.length - 1;
  scheduleSave();
  emit();
}
export const canUndo = () => hi > 0;
export const canRedo = () => hi < hist.length - 1;
export function undo() { if (canUndo()) { restore(hist[--hi]); scheduleSave(); emit(); } }
export function redo() { if (canRedo()) { restore(hist[++hi]); scheduleSave(); emit(); } }
export function resetHistory() { hist.length = 0; hi = -1; commit(); }

// ---- Autosave ----
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('form3d', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const plain = () => ({
  name: doc.name, nextId: doc.nextId, sketches: doc.sketches,
  bodies: doc.bodies.map(b => ({ id: b.id, name: b.name, color: b.color, visible: b.visible, v: b.mesh.v, t: b.mesh.t })),
});
function adopt(d) {
  doc.name = d.name || 'Unbenannt';
  doc.nextId = d.nextId || 1;
  doc.sketches = d.sketches || [];
  doc.bodies = (d.bodies || []).map(b => ({ id: b.id, name: b.name, color: b.color, visible: b.visible !== false, mesh: { v: b.v, t: b.t } }));
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const db = await idb();
      db.transaction('kv', 'readwrite').objectStore('kv').put(plain(), 'autosave');
    } catch (e) { console.warn('Autosave fehlgeschlagen', e); }
  }, 600);
}
export async function loadLocal(stillWanted = () => true) {
  try {
    const db = await idb();
    const d = await new Promise((res, rej) => {
      const r = db.transaction('kv').objectStore('kv').get('autosave');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (d && stillWanted()) adopt(d);
  } catch (e) { console.warn('Laden fehlgeschlagen', e); }
}

// ---- Projektdatei (JSON, Arrays als Base64) ----
const b64 = arr => {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s, Type) => {
  const bin = atob(s), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Type(u8.buffer);
};
export function toFile() {
  const d = plain();
  d.format = 'form3d/1';
  d.bodies = d.bodies.map(b => ({ ...b, v: b64(b.v), t: b64(b.t) }));
  return JSON.stringify(d);
}
export function fromFile(text) {
  const d = JSON.parse(text);
  if (d.format !== 'form3d/1') throw new Error('Unbekanntes Dateiformat');
  d.bodies = d.bodies.map(b => ({ ...b, v: unb64(b.v, Float32Array), t: unb64(b.t, Uint32Array) }));
  adopt(d);
  resetHistory();
}
