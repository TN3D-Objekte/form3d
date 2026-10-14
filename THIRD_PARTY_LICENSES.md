# Drittanbieter-Software

Form3D enthält die folgenden Bibliotheken im Ordner `vendor/`. Die vollständigen
Lizenztexte liegen in `vendor/licenses/`.

| Datei | Projekt | Lizenz |
|---|---|---|
| `vendor/three.module.js` | [three.js](https://github.com/mrdoob/three.js) r160, © 2010-2023 three.js authors | MIT – [`three.js-LICENSE.txt`](vendor/licenses/three.js-LICENSE.txt) |
| `vendor/TransformControls.js` | aus three.js (`examples/jsm/controls`), © 2010-2023 three.js authors | MIT – [`three.js-LICENSE.txt`](vendor/licenses/three.js-LICENSE.txt) |
| `vendor/manifold.js`, `vendor/manifold.wasm` | [Manifold](https://github.com/elalish/manifold), © The Manifold Authors | Apache 2.0 – [`manifold-LICENSE.txt`](vendor/licenses/manifold-LICENSE.txt) |
| (in `manifold.wasm` enthalten) | [Clipper2](https://github.com/AngusJohnson/Clipper2), © Angus Johnson | Boost 1.0 – [`Clipper2-LICENSE.txt`](vendor/licenses/Clipper2-LICENSE.txt) |

`manifold.js`/`manifold.wasm` wurden mit [Emscripten](https://emscripten.org) erzeugt
(Laufzeitbibliotheken unter MIT/University of Illinois NCSA).

Die Bibliotheken werden unverändert weitergegeben; ergänzt wurden nur Lizenzkommentare am Dateianfang.
