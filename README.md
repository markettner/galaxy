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
| `src/main.js` | Scene, camera, transitions, frame loop, the Sol & Luna handover |
| `src/sol.js` | Sol & Luna player: fly-through, sun, moon, eclipse |
| `src/sol_shaders.js` | Its GLSL, generated from the extracted bundle — don't hand-edit |
| `src/starfield.js` | `starfield.html`: Sol & Luna's far sky on its own |

`?arms=<key>` picks the shape the page opens on.

## Sol & Luna

Tap or click the galaxy (or press Enter) to dive into its core: the galaxy flies
in, hands over mid-rush to the Sol & Luna scene, and its core cools into a sun
while a moon splits away. Drag sideways to swing the two around each other —
line them up for the eclipse. Tap (or Enter) again to set them orbiting on their
own, and once more to pause them wherever they are. The orbit is slow and
steady, a turn in about two minutes, so the corona and diamond ring get over a
second (`ORBIT` in `sol.js`). Scroll or swipe carries on round the ring as it
would from the galaxy; Esc goes back to the galaxy; R replays Sol's intro.

Sol draws through the same renderer and is composited over the galaxy's frame,
so the shared sky never changes — only the galaxy shape zooms and fades. It is
built at startup, while the opening field is still invisible, because compiling
its shaders stalls WebKit for a few hundred ms.

The dive is timed on Sol's own clock (`DIVE` in `main.js`): Sol starts 1.2 s in,
just before its flight, and our galaxy zooms by the same approach factor so the
crossfade (1.8–2.35 s) lands inside the rush.

## Starfield

`starfield.html` is the sky behind Sol & Luna on its own: the parallax sprite
field and the faint nebula under it, without the bodies or the ambient stars
around them. On openai.com it drifts sideways once the intro settles; here it
is turned 90° clockwise and drifts up, at twice the pace. Scroll, swipe, drag
or use the arrow keys to add speed — it coasts back to the drift (`MOTION` in
`src/starfield.js`). Scrolling against the drift slows or briefly reverses it.

## Debugging

`window.galaxy` exposes the running player — `next()`, `prev()`, `goTo(key)`,
`seek(t)`, `setPaused()` and the live scene objects. `galaxy.sol` has `enter()`,
`leave()`, `seek(seconds | null)` to pin Sol's clock, and the `player`.

`src/sol_shaders.js` is regenerated from the saved bundle with
`node assets/extracted/sol-luna/extract-shaders.js` (working material, not in
the repo).

## Credits

Bloom downsample/upsample passes are from
[pmndrs/postprocessing](https://github.com/pmndrs/postprocessing).
Rendering by [three.js](https://threejs.org).
