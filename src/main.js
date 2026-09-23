/* Galaxy — the consolidated player.
 *
 * One canvas, three shapes: the six-arm galaxy, the "beyond" crescents and the
 * delta outline. The page opens on the galaxy; scrolling walks an endless ring
 * through all three and back.
 *
 * The scene graph, camera, responsive framing, per-frame uniform updates and
 * interaction model all live here, restricted to the `converge-tilt` preset.
 *
 *   scene
 *   └── animationRoot   position.y = 1.2
 *       └── spinRoot    pointer rotation * $
 *           └── layer group per arm, for all three shapes at once
 *
 * ---------------------------------------------------------------------------
 * How a transition works
 *
 * The intro is a single scalar. Everything downstream of it — galaxyIntroMotion
 * in the vertex shader, applyGalaxyIntroMotion and particleRevealProgress on the
 * CPU for the flares — is a pure function of that scalar with no integrated
 * state. So driving it backwards is exact, and "outro" needs no code of its
 * own: it is the intro at a negative rate.
 *
 * At progress 0 a field is fully dispersed *and invisible*
 * (particleRevealProgress(0) === 0), fading in over the first ~14%. The two
 * ramps are therefore overlapped rather than run back to back: while the
 * outgoing shape finishes dispersing, the incoming one is already fading up out
 * of the same scatter volume. Both are dim, formless clouds at the crossover,
 * which is what makes the seam disappear — and it halves how long the swap
 * takes. Retune with TIMING below.
 * ---------------------------------------------------------------------------
 * Sol & Luna
 *
 * Tapping the galaxy dives into its core and hands over to the Sol & Luna
 * player (sol.js). It draws through this renderer, composited over this
 * frame, so the shared sky stays exactly where it is throughout — only the
 * galaxy shape zooms and fades. The handover is timed so our galaxy is already
 * rushing toward the viewer when Sol's own fly-through takes over. Scrolling
 * carries on round the ring from the galaxy; Esc goes back to it. See DIVE.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const THREE = window.THREE;
  const SHADERS = window.GALAXY_SHADERS;
  const ARM_SETS = window.GALAXY_ARM_SETS;
  const GalaxyShape = window.GalaxyShape;
  const INTERACTION = GalaxyShape.INTERACTION;

  const clamp = THREE.MathUtils.clamp;
  const lerp = THREE.MathUtils.lerp;
  const smootherstep = THREE.MathUtils.smootherstep;

  // ---------------------------------------------------------------------------
  // The ring
  //
  // Scrolling down advances through this order and wraps; scrolling up runs it
  // backwards. `?arms=<key>` picks which one the page opens on, and also lets
  // `legacy` (the earlier stylised "6") be reached even though it is not on
  // the ring.
  // ---------------------------------------------------------------------------
  const ORDER = ['galaxy', 'beyond', 'delta'];

  const query = new URLSearchParams(window.location.search);
  const requested = query.get('arms');
  const startKey = ARM_SETS[requested] ? requested : ORDER[0];

  // Field-config overrides from the URL, applied to every shape so a tweak can
  // be compared across the ring without editing the sets.
  const overrides = {};
  const numeric = { stars: 'stars', size: 'size', width: 'widthScale' };
  for (const [param, field] of Object.entries(numeric)) {
    const v = Number.parseFloat(query.get(param));
    if (Number.isFinite(v) && v > 0) overrides[field] = v;
  }

  const ROTATION_LIMIT = 4 * Math.PI;
  const FACE_FORWARD = true;

  // ---------------------------------------------------------------------------
  // Renderer, camera, scene graph
  // ---------------------------------------------------------------------------

  const canvas = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({
    canvas, alpha: false, antialias: true, depth: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const dirtTexture = window.GalaxyDirt.createTexture();
  const postfx = new window.GalaxyPostFX(renderer, {
    bloomIntensity: 0.7,
    bloomThreshold: 0.08,
    luminanceSmoothing: 0.18,
    lensFlare: { animated: true, enabled: true, ghosts: 0.1, halo: 0.12,
                 intensity: 0.28, secondary: 0.55, streakLength: 0.03485,
                 streaks: 0.18, verticalStreaks: 1 },
    dirtyGlass: { enabled: true, distortion: 0.68, grain: 0.031,
                  procedural: 0, texture: 0 },
    dirtTexture,
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0);
  // Frustum is in pixels; `zoom` does the world->screen mapping.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
  camera.position.set(0, 1.2, 12);

  const animationRoot = new THREE.Group();
  const spinRoot = new THREE.Group();
  animationRoot.add(spinRoot);
  scene.add(animationRoot);

  // The effective pixel ratio is capped at 1.5 — the configured `maxDpr: 2`
  // never actually applies — and reduced further on large
  // viewports by an area budget. This also sets how far the bloom spreads,
  // since its kernel is a fixed tap count at a quarter of the drawing buffer.
  const MAX_DPR = 2; // renderer.maxDpr
  function computePixelRatio(cssW, cssH) {
    let cap = Math.min(1.5, Math.max(0.1, MAX_DPR));
    if (cssW > 0 && cssH > 0) {
      cap = Math.min(cap, Math.max(0.5, Math.sqrt(2400000 / (cssW * cssH))));
    }
    const lo = Math.min(cap, 1);
    const requestedDpr = window.devicePixelRatio || 1;
    const v = Math.min(cap, Math.max(lo, Number.isFinite(requestedDpr) ? requestedDpr : 1));
    return Math.min(cap, Math.max(0.1, Math.floor(100 * v) / 100));
  }
  let pixelRatio = computePixelRatio(
    canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight,
  );

  // ---------------------------------------------------------------------------
  // Shapes
  //
  // All three are built up front — around 14k points in total, which is small
  // enough that the alternative (building on demand) would only buy a stutter
  // at the first transition. Only the shapes with a non-zero intro are drawn.
  // ---------------------------------------------------------------------------

  const shapes = {};
  const shapeKeys = ORDER.includes(startKey) ? ORDER : ORDER.concat([startKey]);
  for (const key of shapeKeys) {
    const shape = new GalaxyShape({
      key,
      armSet: ARM_SETS[key],
      shaders: SHADERS,
      pixelRatio,
      // No shape generates its own background stars any more — the sky is one
      // shared layer that outlives every transition. See BACKDROP_SET below.
      overrides: { ...overrides, backgroundStars: false },
    });
    shape.attach(spinRoot);
    shapes[key] = shape;
  }

  // Whose arms the shared sky is generated from. The galaxy's, because it has
  // the most of them and it is what the page opens on; any set would do, since
  // a background star's position depends only on its own seeds.
  const BACKDROP_SET = 'galaxy';
  const backdrop = new window.GalaxyBackdrop({
    armSet: ARM_SETS[BACKDROP_SET], shaders: SHADERS, pixelRatio, config: overrides,
  });
  backdrop.attach(animationRoot);

  const allLayers = shapeKeys
    .reduce((acc, k) => acc.concat(shapes[k].layers), [backdrop.layer]);

  // Hover distortion: the star vertex shader recompiled as a GPGPU pass.
  //
  // One simulation covers every layer of every shape. It sizes its own 128-wide
  // ping-pong buffer from the total, so this needs no change. Hidden layers are
  // deliberately left in the simulation scene: culling them would let their
  // pixels go stale in whichever buffer was not written, and the pass only runs
  // on frames with a pointer impulse anyway.
  const particleMotion = new window.GalaxyParticleMotion(allLayers, SHADERS.vertex);
  const flareU = postfx.flareUniforms;

  // ---------------------------------------------------------------------------
  // Input — drag or arrow keys to rotate (releases spring back), hover to
  // distort. Scroll, swipe or PageUp/PageDown move between shapes. R replays
  // the intro, Space pauses. There is no on-screen UI.
  // ---------------------------------------------------------------------------

  const input = {
    rotation: { x: 0, y: 0 },
    returning: false,
    pointer: { active: false, pressed: false, reset: false, x: 0, y: 0 },
  };
  const clampRotation = (v) =>
    (Number.isFinite(v) ? Math.min(ROTATION_LIMIT, Math.max(-ROTATION_LIMIT, v)) : 0);
  const clampUnit = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(-1, v)) : 0);

  function rotateBy(delta) {
    input.rotation.x = clampRotation(input.rotation.x + delta.y);
    input.rotation.y = clampRotation(input.rotation.y + delta.x);
    input.returning = false;
  }
  function faceForward() {
    if (!FACE_FORWARD) return;
    input.rotation.x = 0;
    input.rotation.y = 0;
    input.returning = true;
  }

  let drag = null;
  canvas.style.touchAction = 'none';

  // A tap is a press that neither travels nor lingers — anything more is a
  // drag, and keeps rotating exactly as before.
  const TAP_SLOP_PX = 6;
  const TAP_MAX_MS = 400;
  let tap = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { return; }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    tap = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() };
    input.pointer.pressed = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!e.isPrimary) return;
    if (tap && e.pointerId === tap.id
      && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP_PX) tap = null;
    const rect = canvas.getBoundingClientRect();
    // Hover only smears the galaxy; Sol & Luna has no hover interaction.
    input.pointer.active = mode === 'galaxy';
    input.pointer.x = clampUnit(((e.clientX - rect.left) / rect.width) * 2 - 1);
    input.pointer.y = clampUnit(-(((e.clientY - rect.top) / rect.height) * 2 - 1));
    if (drag && e.pointerId === drag.id) {
      // On touch a vertical drag is a scroll, not a rotation, and the two would
      // otherwise both fire — the shape would spin while it navigated. The
      // scroll driver locks an axis on the first few pixels; while it owns the
      // gesture the drag stands down. Horizontal drags, and every mouse drag,
      // are untouched.
      if (!(e.pointerType === 'touch' && scroll.suppressDrag())) {
        // Drag surface: 0.005 rad per pixel. Sol only swings sideways.
        if (mode === 'sol' || mode === 'diving') sol?.rotate((e.clientX - drag.x) * 0.005);
        else rotateBy({ x: (e.clientX - drag.x) * 0.005, y: (e.clientY - drag.y) * 0.005 });
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
    }
  });
  const endDrag = (e) => {
    if (drag && e.pointerId === drag.id) {
      drag = null;
      input.pointer.pressed = false;
      faceForward();
      sol?.resetRotation();
    }
  };
  canvas.addEventListener('pointerup', (e) => {
    const wasTap = tap && e.pointerId === tap.id && performance.now() - tap.at <= TAP_MAX_MS
      && !(e.pointerType === 'touch' && scroll.suppressDrag());
    tap = null;
    endDrag(e);
    if (wasTap) onTap();
  });
  canvas.addEventListener('pointercancel', (e) => { tap = null; endDrag(e); });
  // Leaving the canvas ends the hover, but it is *not* a discontinuity: the
  // smear has to keep coasting home over its remaining settle time, exactly as
  // it does when the pointer stops moving but stays inside. Raising
  // `pointer.reset` here would bump the motion epoch and slam
  // uParticleMotionAge to SETTLE_SECONDS, where galaxyCoast's returnDecay is
  // e^-6 and the shader early-outs — the stars snap back in a single frame.
  // Clearing `active` is enough on its own to stop new impulses, and it also
  // guards re-entry: step() only differences pointer against previous when it
  // was already active, so the first frame back generates no impulse.
  canvas.addEventListener('pointerleave', () => {
    input.pointer.active = false;
    input.pointer.pressed = false;
  });

  // ---------------------------------------------------------------------------
  // Timeline
  //
  // The clock is split. `uTime` stays on a plain monotonic wall clock —
  // twinkle, flow and the animated flare must not stutter when a transition
  // runs. Only the intro scalar is driven, and it is driven per shape.
  // ---------------------------------------------------------------------------

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let originMs = performance.now();
  let paused = false;
  let pausedAtMs = 0;
  let lastMs = performance.now();

  const elapsedSeconds = (now) => ((paused ? pausedAtMs : now) - originMs) / 1000;

  function setPaused(next) {
    if (next === paused) return;
    const now = performance.now();
    if (next) pausedAtMs = now;
    else originMs += now - pausedAtMs;
    paused = next;
  }

  // Seconds. OUT and IN are the two ramps; IN_DELAY is how long the incoming
  // shape waits before it starts, so `OUT - IN_DELAY` is the overlap that hides
  // the seam. COMMIT is when the scroll driver may accept another step.
  // converge-tilt runs the intro on a *linear* ramp — all the easing lives in
  // galaxyIntroMotion, and shaping the scalar as well double-eases it. The
  // opening therefore uses `linear`.
  //
  // A transition is a different animation: two ramps crossing, where easing the
  // scalar is what softens the handover. It gets `smootherstep`.
  const linear = (x) => clamp(x, 0, 1);
  const eased = (x) => smootherstep(clamp(x, 0, 1), 0, 1);
  // The outgoing ramp gets no ease-in. A shape that is dispersing has just been
  // let go of — it should move on the first frame. smootherstep's flat start
  // costs over a second of apparent nothing at these durations, which reads as
  // the scroll not having registered.
  const easeOut = (x) => { const u = 1 - clamp(x, 0, 1); return 1 - u * u; };

  // The incoming shape starts while the outgoing one still has a third of its
  // dispersal left. Less overlap and the crossover thins out to almost nothing,
  // because reveal is only ~0.2 across the whole middle of the ramp
  // (particleRevealProgress) — two clouds at 0.2 read as a starfield, one reads
  // as a fade to black.
  const TIMING = reduceMotion
    ? { OUT: 0.30, IN_DELAY: 0.10, IN: 0.40, COMMIT: 0.40, easeIn: eased, easeOut }
    : { OUT: 2.80, IN_DELAY: 0.80, IN: 3.80, COMMIT: 3.00, easeIn: eased, easeOut };

  // How far a below-threshold scroll un-converges the settled shape. Kept well
  // under 0.3: motionGate is smoothstep(intro, 0.55, 1), so at 1 - 0.12 it is
  // still ~0.97 and the drift, spin and twinkle do not visibly stutter.
  const TUG_MAX = 0.12;

  let active = shapes[startKey];
  let fromShape = null;
  let toShape = active;
  let timing = TIMING;
  // Transitions are timed off the same pause-aware wall clock
  // for its intro, not off accumulated dt. A throttled tab — backgrounded, or
  // just slow — must drop frames rather than stretch the animation: integrating
  // dt would leave a shape frozen half-dispersed until the tab came back.
  let transitionStart = 0;
  let fromIntro = 1;
  let transitioning = false;
  let tug = 0;

  function beginTransition(from, to, t) {
    // Any shape that is not one of the two ends of the new transition stops
    // being driven, so retire it here. Without this, interrupting a transition
    // — R, or goTo — would abandon the shape that was mid-dispersal and leave
    // it frozen on screen at whatever intro it had reached.
    for (const key of shapeKeys) {
      const shape = shapes[key];
      if (shape !== from && shape !== to) shape.intro = 0;
    }
    fromShape = from;
    // Where the outgoing shape actually is, not where a settled one would be.
    // A scroll tugs `intro` down before it commits, so starting the ramp at 1
    // would snap the shape back together on the very frame the gesture takes
    // effect — the opposite of the feedback the tug exists to give.
    fromIntro = from ? from.intro : 0;
    toShape = to;
    active = to;
    timing = t;
    transitionStart = elapsedSeconds(performance.now());
    transitioning = true;
    tug = 0;
  }

  function step(dir) {
    if (mode === 'sol') { leaveSol(dir); return; }
    if (mode !== 'galaxy') {
      // Mid-handover a scroll is ignored, but the scroll driver still needs
      // its commit or it would stay disarmed.
      scroll.commit();
      return;
    }
    const i = ORDER.indexOf(active.key);
    // A shape reached by ?arms= but not on the ring (legacy) joins it here
    // rather than being a dead end.
    const from = i === -1 ? 0 : i;
    const next = ORDER[(from + (dir > 0 ? 1 : -1) + ORDER.length) % ORDER.length];
    if (shapes[next] === active) return;
    beginTransition(active, shapes[next], TIMING);
  }

  /** Replay the current shape's own intro, at its authored converge duration. */
  function replay() {
    paused = false;
    faceForward();
    // A genuine discontinuity — every star teleports back to the scatter
    // volume — so drop any smear in flight rather than coasting it through the
    // replayed intro. This is what `pointer.reset` is for.
    input.pointer.reset = true;
    const seconds = clamp(active.fieldConfig.convergeDuration, 1, 10);
    active.intro = 0;
    backdrop.intro = 0;
    beginTransition(null, active, {
      OUT: 0, IN_DELAY: 0, IN: reduceMotion ? 0 : seconds, COMMIT: 0.4,
      easeIn: linear, easeOut: linear,
    });
  }

  const scroll = new window.GalaxyScroll({
    target: canvas,
    onStep: step,
    onTug: (v) => { tug = mode === 'galaxy' ? Math.min(Math.abs(v), 1) : 0; },
  });

  window.addEventListener('keydown', (e) => {
    const arrow = {
      ArrowDown: { x: 0, y: 0.08 }, ArrowLeft: { x: -0.08, y: 0 },
      ArrowRight: { x: 0.08, y: 0 }, ArrowUp: { x: 0, y: -0.08 },
    }[e.key];
    if (arrow && mode === 'sol') { e.preventDefault(); sol.rotate(arrow.x); return; }
    if (arrow) { e.preventDefault(); rotateBy(arrow); return; }
    if (e.key === 'Escape' && mode === 'sol') { leaveSol(0); return; }
    if (e.key === 'Enter' && (mode === 'galaxy' || mode === 'sol')) { onTap(); return; }
    if ((e.key === 'r' || e.key === 'R') && mode === 'sol') { replaySol(); return; }
    if (e.key === 'r' || e.key === 'R') replay();
    if (e.key === ' ') { e.preventDefault(); setPaused(!paused); }
  });

  // ---------------------------------------------------------------------------
  // Sol & Luna — tap the galaxy to dive into its core.
  //
  //   galaxy ──tap──> diving ──> sol ──scroll──> leaving ──> next shape
  //                                  └──Esc────> leaving ──> galaxy
  //
  // The player is built at startup, in slices. Compiling its programs costs a
  // few hundred ms on a cold cache, and WebKit does much of that synchronously
  // even with KHR_parallel_shader_compile — built after the galaxy had
  // assembled, that stalled its rotation. At startup it lands in the opening's
  // first second, while the field is still dispersed and invisible
  // (particleRevealProgress(0) === 0), so there is nothing on screen to stall.
  // ---------------------------------------------------------------------------

  let sol = null;
  let solBuild = null;
  let solPending = false; // tapped before the player was ready

  function ensureSol() {
    if (!sol) {
      sol = new window.SolPlayer(renderer, { continuous: !reduceMotion, centeredIntro: true });
      sol.resize(viewport.width, viewport.height, pixelRatio);
      solBuild = sol.build();
    }
    return solBuild;
  }

  // All on Sol's own clock. Sol opens on a face-on five-arm galaxy framed
  // exactly like ours, which sits still for about a second (build-in and hold)
  // before its fly-through starts. So a tap starts Sol's clock at SOL_START,
  // just before the flight, and our galaxy flies in *with* it: its zoom is the
  // approach factor Sol's INTRO_GALAXY gives a star at mid depth,
  // startDepth / max(1.5, startDepth - 38 * expansion). The crossfade sits
  // inside the rush, FADE_FROM..FADE_TO, where both galaxies are streaking off
  // the edges and their different arm shapes can't be compared.
  const DIVE = reduceMotion
    ? { SOL_START: 8, FADE_FROM: 8, FADE_TO: 8.3, LEAVE: 0.3 }
    : { SOL_START: 1.2, FADE_FROM: 1.8, FADE_TO: 2.35, LEAVE: 0.9 };
  const DIVE_DEPTH = 12;

  function diveZoomAt(solSeconds) {
    if (reduceMotion) return 1;
    const { expansion } = window.SolPlayer.timeline(window.SolPlayer.warpClock(solSeconds, true) + 0.02);
    return DIVE_DEPTH / Math.max(1.5, DIVE_DEPTH - 38 * expansion);
  }

  let mode = 'galaxy'; // 'galaxy' | 'diving' | 'sol' | 'leaving'
  let modeStart = 0;
  let solOrigin = 0;   // elapsedSeconds at which Sol's clock reads 0
  let solSeek = null;  // debug: pin Sol's clock (window.galaxy.sol.seek)
  let solOpacity = 0;

  const solClock = (elapsed) => solSeek ?? elapsed - solOrigin;

  function setMode(next) {
    mode = next;
    modeStart = elapsedSeconds(performance.now());
  }

  function canDive() {
    // Only on the galaxy, and not while it is being swapped for another shape.
    // Its own opening converge doesn't count, once it has mostly formed.
    return mode === 'galaxy' && active.key === 'galaxy' && !fromShape && active.intro >= 0.85;
  }

  function onTap() {
    // In the finished scene a tap sets the pair orbiting, or pauses them.
    if (mode === 'sol') { sol.toggleOrbit(); return; }
    if (!canDive()) return;
    if (!sol?.ready) {
      ensureSol();
      solPending = true;
      return;
    }
    startDive();
  }

  function startDive() {
    faceForward();
    sol.resetOrbit();
    input.pointer.active = false;
    setMode('diving');
    solOrigin = modeStart - DIVE.SOL_START;
  }

  function replaySol() {
    sol.resetOrbit();
    solOrigin = elapsedSeconds(performance.now()) - (reduceMotion ? DIVE.SOL_START : 0);
  }

  /**
   * dir 0 goes back to the galaxy, which re-converges while Sol fades off it.
   * dir ±1 carries on round the ring as a scroll from the galaxy would: the
   * galaxy is already out of sight, so the next shape simply converges in.
   */
  function leaveSol(dir) {
    if (mode !== 'sol') return;
    setMode('leaving');
    const galaxy = shapes.galaxy;
    galaxy.intro = 0;
    galaxy.fade = 1;
    spinRoot.scale.setScalar(1);
    if (dir === 0) {
      // A genuine discontinuity for the hover smear, as with a replay.
      input.pointer.reset = true;
      beginTransition(null, galaxy, {
        OUT: 0, IN_DELAY: 0.15, IN: reduceMotion ? 0.3 : 4.5, COMMIT: 1.0,
        easeIn: linear, easeOut: linear,
      });
      return;
    }
    const next = ORDER[(ORDER.indexOf('galaxy') + (dir > 0 ? 1 : -1) + ORDER.length) % ORDER.length];
    beginTransition(null, shapes[next], { ...TIMING, OUT: 0 });
  }

  /** Per-frame bookkeeping for the handover: galaxy zoom and fade, Sol opacity. */
  function advanceSol(elapsed) {
    if (solPending && sol?.ready) {
      solPending = false;
      if (canDive()) startDive();
    }
    const galaxy = shapes.galaxy;
    let zoom = 1;
    solOpacity = 0;
    if (mode === 'diving') {
      const solT = solClock(elapsed);
      zoom = diveZoomAt(solT);
      solOpacity = eased((solT - DIVE.FADE_FROM) / (DIVE.FADE_TO - DIVE.FADE_FROM));
      galaxy.fade = 1 - solOpacity;
      if (solT >= DIVE.FADE_TO) setMode('sol');
    } else if (mode === 'sol') {
      solOpacity = 1;
      galaxy.fade = 0;
    } else if (mode === 'leaving') {
      const t = elapsed - modeStart;
      solOpacity = 1 - eased(t / DIVE.LEAVE);
      if (t >= DIVE.LEAVE) setMode('galaxy');
    }
    // Zoom the shape, not the camera: the sky above spinRoot stays put.
    spinRoot.scale.setScalar(zoom);
  }

  // The opening intro is just a transition with nothing to disperse first.
  replay();

  // ---------------------------------------------------------------------------
  // Responsive sizing — ortho frustum in pixels, zoom = height / scatterHeight
  // ---------------------------------------------------------------------------

  const viewport = { width: 1, height: 1 };

  function resize() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    viewport.width = w;
    viewport.height = h;
    pixelRatio = computePixelRatio(w, h);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    postfx.setSize(Math.floor(w * pixelRatio), Math.floor(h * pixelRatio));
    sol?.resize(w, h, pixelRatio);
  }
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  const spinRotation = new THREE.Vector2();
  const lensPointer = new THREE.Vector2();
  let lensStrength = 0;

  const ctx = {
    elapsed: 0, dt: 0, aspect: 1, scatterX: 12, scatterY: 12,
    pixelRatio, reduceMotion, input, spinRotation, lensPointer,
    lensStrength: 0, lensRadius: 0.2, repelRadius: 0.2,
    animationRootMatrix: animationRoot.matrixWorld,
  };

  /** Advance the intro scalars. Returns the 0..1 blend from `from` to `to`. */
  function advanceTransition(elapsed) {
    if (!transitioning) {
      // Settled: the only thing moving the intro is an unspent scroll push.
      active.intro = 1 - TUG_MAX * eased(tug);
      return 1;
    }

    const t = elapsed - transitionStart;

    if (fromShape) fromShape.intro = fromIntro * (1 - timing.easeOut(t / timing.OUT));
    toShape.intro = timing.easeIn((t - timing.IN_DELAY) / timing.IN);

    if (t >= timing.COMMIT) scroll.commit();

    if (t >= Math.max(timing.OUT, timing.IN_DELAY + timing.IN)) {
      if (fromShape) fromShape.intro = 0;
      toShape.intro = 1;
      fromShape = null;
      transitioning = false;
      scroll.commit();
    }
    return timing.easeIn((t - timing.IN_DELAY) / timing.IN);
  }

  function frame(now) {
    // We re-sync whenever the measured size changes rather than
    // trusting resize events alone.
    if ((canvas.clientWidth || 0) !== viewport.width
      || (canvas.clientHeight || 0) !== viewport.height) resize();

    const elapsed = elapsedSeconds(now);
    const dt = paused ? 0 : clamp((now - lastMs) / 1000, 0, 0.05);
    lastMs = now;

    scroll.tick();
    const blend = advanceTransition(elapsed);
    advanceSol(elapsed);


    // Viewport-derived scatter volume and camera zoom. The three shapes do not
    // all want the same frame on a narrow viewport, so it is interpolated
    // across a transition — and both shapes are then given the *same* scatter
    // volume, since one camera zoom means one volume. Two dispersed clouds that
    // disagreed about it would not overlap.
    const aspect = viewport.width / Math.max(viewport.height, 1);
    const outgoing = fromShape ?? toShape;
    const scatterHeight = lerp(
      outgoing.scatterHeight(aspect), toShape.scatterHeight(aspect), blend,
    );
    const scatterX = scatterHeight * aspect * 1.12;
    const scatterY = scatterHeight * 1.12;

    const cameraY = 1.2;
    camera.position.set(0, cameraY, 12);
    camera.lookAt(0, cameraY, 0);
    camera.zoom = viewport.height / scatterHeight;
    camera.updateProjectionMatrix();
    animationRoot.position.y = cameraY; // centerCore

    animationRoot.updateMatrixWorld(true);

    // `$` for the shared spin root. Each layer subtracts spinRoot's rotation
    // and re-applies its own gate, so a shape's world rotation is gated by its
    // own intro regardless of which gate lands here; this only sets what the
    // core cluster, which does not counter-rotate, inherits.
    const dominant = fromShape && fromShape.intro > toShape.intro ? fromShape : toShape;
    const motionGate = THREE.MathUtils.smoothstep(dominant.intro, 0.55, 1);

    // Pointer rotation, damped; releases return more slowly.
    const rotate = 1 - Math.exp(-(input.returning ? 5.5 : 14) * dt);
    if (!reduceMotion) {
      spinRotation.x = lerp(spinRotation.x, input.rotation.x, rotate);
      spinRotation.y = lerp(spinRotation.y, input.rotation.y, rotate);
      spinRoot.rotation.set(spinRotation.x * motionGate, spinRotation.y * motionGate, 0);
    }

    // Pointer follow (mode is `rotate`, so the lens itself stays inactive).
    const follow = 1 - Math.exp(-clamp(INTERACTION.followDamping, 1, 30) * dt);
    lensPointer.x = lerp(lensPointer.x, input.pointer.x, follow);
    lensPointer.y = lerp(lensPointer.y, input.pointer.y, follow);
    lensStrength = lerp(lensStrength, 0, follow);

    ctx.elapsed = elapsed;
    ctx.dt = dt;
    ctx.aspect = aspect;
    ctx.scatterX = scatterX;
    ctx.scatterY = scatterY;
    ctx.pixelRatio = pixelRatio;
    ctx.lensStrength = lensStrength;
    ctx.lensRadius = (2 * clamp(INTERACTION.radius, 32, 360)) / Math.max(viewport.height, 1);
    ctx.repelRadius = (2 * clamp(INTERACTION.repelRadius, 16, 360)) / Math.max(viewport.height, 1);
    // spinRoot.rotation is what the layers counter-rotate against; it is the
    // damped value, not the target.
    ctx.spinRotation = spinRoot.rotation;

    // The sky rides the opening intro itself rather than a ramp of its own.
    // Two ramps meant two schedules: the backdrop was linear and the shape was
    // eased, so the sky arrived fully lit a second before the first star of the
    // field showed up and the opening read as two separate events.
    //
    // It ratchets. A transition rewinds a shape's intro to disperse it, but the
    // sky that shape re-forms in front of never goes back out.
    backdrop.intro = Math.max(backdrop.intro, toShape.intro);
    backdrop.update(ctx);

    for (const key of shapeKeys) {
      const shape = shapes[key];
      shape.setVisible(shape.intro > 0.001 && shape.fade > 0.001);
      if (!shape.visible) continue;
      shape.update(ctx);
    }

    // The flare budget is global: one primary and five secondaries for the
    // whole frame. Bind it to whichever shape is more converged. Visibility is
    // already scaled by particleRevealProgress(intro), so through a crossover
    // both shapes' flares are dark and the handoff is invisible.
    dominant.updateFlareSources(flareU, camera, scatterX, scatterY);
    flareU.uTime.value = elapsed;

    // Hover distortion: advance the pointer state, then integrate.
    particleMotion.step(input.pointer, !reduceMotion, dt);
    input.pointer.reset = false;
    particleMotion.update(renderer, camera);

    // Couple the flares to the same smear the stars get.
    flareU.uParticleMotionTexture.value = particleMotion.texture.value;
    flareU.uParticleMotionAge.value = particleMotion.age.value;
    dominant.updateFlareMotion(flareU);

    postfx.render(scene, camera);
    // Sol & Luna composites over the frame just drawn.
    if (mode !== 'galaxy') sol?.render(solClock(elapsed), solOpacity);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  ensureSol();

  window.galaxy = {
    shapes, backdrop, order: ORDER, scene, camera, renderer, postfx, particleMotion,
    animationRoot, spinRoot, input, scroll, replay, setPaused,
    get current() { return active.key; },
    get transitioning() { return transitioning; },
    next() { step(1); },
    prev() { step(-1); },
    goTo(key) {
      if (!shapes[key] || shapes[key] === active) return;
      beginTransition(active, shapes[key], TIMING);
    },
    seek(t) { active.intro = clamp(t, 0, 1); },
    sol: {
      get player() { return sol; },
      get mode() { return mode; },
      get build() { return solBuild; },
      prewarm: ensureSol,
      enter: onTap,
      leave: leaveSol,
      /** Pin Sol's clock to `t` seconds (null to resume). */
      seek(t) { solSeek = t === null ? null : Math.max(0, t); },
      dive: DIVE,
    },
  };
})();
