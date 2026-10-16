// Worker für den Fuzz-Test: bekommt Fallnummern, antwortet mit dem Ergebnis von runCase (siehe fuzzlib.js)
import { K, runCase } from './fuzzlib.js';

const ready = K.initKernel();
self.onmessage = async e => {
  await ready;
  let r;
  try { r = runCase(e.data); } catch (err) { r = { id: e.data, fail: true, steps: [{ codes: { GENERATOR: 1 }, sig: { GENERATOR: String(err.message).slice(0, 60) } }] }; }
  self.postMessage(r);
};
