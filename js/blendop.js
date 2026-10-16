// Ablauf von Rundung/Fase an einem Körper { mesh, features }: Werkzeuge bauen, anwenden, Übergänge zu
// vorhandenen Rundungen ausrunden. Ohne Oberfläche, damit ihn auch der Fuzz-Test (tests/fuzz.html) nutzt.
import * as K from './kernel.js';
import { buildEdgeTool, cornerTools, joinChains, tangentChains, transitionTools } from './edges.js';

// Neue Kennungen für Rundungs-/Fasenflächen eines Körpers (12 Bit, siehe kernel.js)
export function nextTag(b) {
  const used = Math.max(K.maxTag(b.mesh), ...(b.features || []).map(f => f.tag));
  return used + 64 < 4096 ? used + 1 : 1;
}

// Werkzeuge für Rundung/Fase: tangential anschließende Kanten laufen mit, außer der Radius ist dafür
// zu groß (dann nur die angetippten Kanten)
export function edgeTools(b, picked, kind, size) {
  const make = list => {
    const chains = joinChains(b.mesh, list), base = nextTag(b);
    const ts = [...chains.map(ch => buildEdgeTool(b.mesh, ch, kind, size, chains)), ...cornerTools(b.mesh, chains, kind, size)];
    ts.forEach((t, i) => Object.assign(t, { tag: base + i, kind, size, links: t.chains?.map(ci => base + ci) }));
    return ts;
  };
  const ext = tangentChains(b.mesh, picked);
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

// Ganzer Schritt wie beim Tippen auf „Fertig“: neues Netz und alle Rundungen/Fasen des Körpers
export function applyEdges(b, picked, kind, size) {
  let r = K.blendFeatures(b.mesh, edgeTools(b, picked, kind, size));
  if (!r.mesh) throw new Error('leeres Ergebnis');
  r = withTransitions(b.features || [], r);
  return { mesh: r.mesh, features: [...(b.features || []), ...r.features] };
}
