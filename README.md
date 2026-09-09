# Galaxy

A star-field animation rendered in WebGL. One canvas holds three shapes — a
six-arm spiral galaxy, a set of crescents, and a delta outline — and scrolling
walks an endless ring through all three and back.

Live: https://markettner.github.io/galaxy/

## Running it

Everything is static; there is no build step. Serve the directory over HTTP and
open it:

```bash
python3 -m http.server 8000
```

Opening `index.html` from the filesystem will not work — the shaders and modules
are loaded as separate scripts.

## How it fits together

| File | Role |
|---|---|
| `src/shaders.js` | Star vertex + fragment GLSL |
| `src/shaders_post.js` | Postprocessing GLSL (bloom, lens flare) |
| `src/arms.js` | Path data for each shape |
| `src/field.js` | Star-field generation from an arm set |
| `src/shape.js` | One shape: field, materials, framing, flare sources |
| `src/postfx.js` | Bloom + lens-flare + ACES tone-map chain |
| `src/motion.js` | Pointer distortion (a second compile of the star shader) |
| `src/dirt.js` | Procedural lens-dirt texture |
| `src/scroll.js` | Gesture handling; the page itself never scrolls |
| `src/main.js` | Scene, camera, transitions, frame loop |

`?arms=<key>` picks the shape the page opens on.

## Debugging

`window.galaxy` exposes the running player — `next()`, `prev()`, `goTo(key)`,
`seek(t)`, `setPaused()` and the live scene objects.

## Credits

Bloom downsample/upsample passes are from
[pmndrs/postprocessing](https://github.com/pmndrs/postprocessing).
Rendering by [three.js](https://threejs.org).
