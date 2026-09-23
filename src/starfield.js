/* Starfield — the far sky behind Sol & Luna, on its own page.
 *
 * On openai.com, once the intro has settled, this layer (X in sol.js) drifts
 * sideways forever: a fixed pool of sprite stars that wraps at the edges, each
 * moving in proportion to its depth, which is where the parallax comes from.
 * Here it is laid out turned 90 degrees clockwise and drifts *up* the screen,
 * at twice the original's pace. Scrolling, swiping or dragging adds speed on
 * top, which then eases back to the drift.
 *
 * Only the layers behind the sun and moon: the sprite field and the faint
 * nebula plane under it. Not the bodies, and not the ambient star field that
 * surrounds them (some of which renders in front of them).
 */
(function () {
  'use strict';

  const THREE = window.THREE;

  // Speeds are in the sky's own units — see SolSky.step. The original drifts
  // at 0.06 per second; a star's on-screen speed is that times 0.18 * (4 + z)
  // world units, with z in -2..0, so the farthest layer moves at half the pace
  // of the nearest. Negative is up the screen: twice the original, reversed.
  const DRIFT = -2 * 0.06;
  const MID_LAYER = 0.18 * 3;  // world units per sky unit at z = -1
  const MOTION = {
    GAIN: 3,          // a push travels this many times its own length...
    DECAY: 1.4,       // ...spread over this many seconds (1/e) — the coast
    MAX_PX: 4000,     // cap on added speed, mid-layer px per second
    KEY_PX: 240,      // one arrow / page key press
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({
    canvas, alpha: false, antialias: false, depth: false, powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  // The Sol & Luna chain: its bloom, no lens flare.
  const postfx = new window.GalaxyPostFX(renderer, {
    bloomIntensity: 0.5, bloomThreshold: 0.62, luminanceSmoothing: 0.18, flare: false,
  });

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 0, 20);
  const sky = window.SolSky.create();
  scene.add(sky.group);

  // Same area-budgeted pixel ratio as the other pages (and the original).
  function computePixelRatio(cssW, cssH) {
    let cap = 1.5;
    if (cssW > 0 && cssH > 0) cap = Math.min(cap, Math.max(0.5, Math.sqrt(2400000 / (cssW * cssH))));
    const requested = window.devicePixelRatio || 1;
    const v = Math.min(cap, Math.max(Math.min(cap, 1), Number.isFinite(requested) ? requested : 1));
    return Math.min(cap, Math.max(0.1, Math.floor(100 * v) / 100));
  }

  const view = { w: 0, h: 0, dpr: 1, pxToSky: 0 };

  function resize() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight);
    const dpr = computePixelRatio(w, h);
    if (w === view.w && h === view.h && dpr === view.dpr) return;
    Object.assign(view, { w, h, dpr });
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    postfx.setSize(Math.floor(w * dpr), Math.floor(h * dpr));

    const worldPerPx = (w / h < 0.72 ? 12.7 : 10.9) / h;
    const viewW = w * worldPerPx;
    const viewH = h * worldPerPx;
    camera.left = -viewW / 2;
    camera.right = viewW / 2;
    camera.top = viewH / 2;
    camera.bottom = -viewH / 2;
    camera.updateProjectionMatrix();
    sky.resizeRotated(viewW, viewH, 10, h);
    view.pxToSky = worldPerPx / MID_LAYER;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------------------
  // Motion. Positive is down the screen; the drift runs up. Input follows
  // content, as scrolling does: a swipe or natural-scroll gesture upward speeds
  // the drift up, one downward slows it or briefly reverses it.
  // ---------------------------------------------------------------------------

  let offset = 0;
  let boost = 0; // sky units per second on top of the drift

  const maxBoost = () => MOTION.MAX_PX * view.pxToSky;
  const clampBoost = (v) => Math.max(-maxBoost(), Math.min(maxBoost(), v));

  /** Add a push of `px` (mid-layer pixels) that coasts out over DECAY. */
  function push(px) {
    boost = clampBoost(boost + (px * view.pxToSky * MOTION.GAIN) / MOTION.DECAY);
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 16;
    else if (e.deltaMode === 2) d *= window.innerHeight;
    push(-d);
  }, { passive: false });

  // A drag moves the sky with the pointer, then lets go at the speed it was
  // travelling — a fling.
  let drag = null;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    drag = { id: e.pointerId, y: e.clientY, at: performance.now(), velocity: 0 };
    boost = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now();
    const dy = e.clientY - drag.y;
    const dt = Math.max((now - drag.at) / 1000, 1 / 240);
    offset += dy * view.pxToSky;
    // Smoothed pointer speed, in sky units per second.
    drag.velocity = drag.velocity * 0.7 + ((dy * view.pxToSky) / dt) * 0.3;
    drag.y = e.clientY;
    drag.at = now;
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // A pointer held still before letting go should not fling.
    const idle = (performance.now() - drag.at) / 1000;
    boost = clampBoost(drag.velocity * MOTION.GAIN * Math.exp(-idle / 0.08));
    drag = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  window.addEventListener('keydown', (e) => {
    // Arrows move the stars their way; Space always pushes along the drift.
    const dir = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1, ' ': Math.sign(DRIFT) }[e.key];
    if (!dir) return;
    e.preventDefault();
    push(dir * MOTION.KEY_PX);
  });

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  const start = performance.now();
  let last = start;

  function frame(now) {
    if ((canvas.clientWidth || 0) !== view.w || (canvas.clientHeight || 0) !== view.h) resize();
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
    last = now;
    const elapsed = (now - start) / 1000;

    if (!drag) {
      offset += ((reduceMotion ? 0 : DRIFT) + boost) * dt;
      boost *= Math.exp(-dt / MOTION.DECAY);
      if (Math.abs(boost) < 1e-5) boost = 0;
    }

    sky.step({
      // The original's hero stars only start their slow pulse once its intro
      // has settled, 8.3–9.5 s in; this page has no intro, so start settled.
      time: reduceMotion ? 9.5 : elapsed + 9.5,
      pixelRatio: view.dpr,
      buildIn: reduceMotion ? 1 : Math.min(elapsed / 0.55, 1),
      offset,
    });
    postfx.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.starfield = {
    sky, renderer, postfx, scene, camera, motion: MOTION, push,
    get speed() { return (reduceMotion ? 0 : DRIFT) + boost; },
    get offset() { return offset; },
  };
})();
