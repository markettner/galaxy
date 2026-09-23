/* Sol & Luna — the hero of openai.com/index/introducing-gpt-6-sol-and-luna/.
 *
 * A transcription of `createUpdatesRenderer` (chunk 1m721ga1vu-xc.js, module
 * 914469): a flight through a five-armed galaxy into its core, where a white-hot
 * star cools into an orange sun and a moon splits away from it. Both bodies are
 * real spheres; dragging sideways swings the pair around each other, and when
 * the moon passes in front of the sun the corona and a diamond ring appear.
 *
 * The GLSL is in sol_shaders.js, generated verbatim from the bundle. This file
 * keeps the original's structure and constants — the minified binding each
 * piece came from is noted where it helps to cross-reference the source.
 *
 *   scene
 *   ├── field.group            (K) galaxy stars, dust, core, flyby, transit
 *   │   └── intro-galaxy           the same stars re-drawn as the fly-through
 *   ├── background.group       (X) the far sky + faint nebula plane
 *   └── dragRoot               (Y) damped horizontal drag
 *       └── splitRoot          ($) the swing that separates sun and moon
 *           └── bodies.group   (Z) sun (surface + corona), moon (+ atmosphere)
 *
 * Differences from the original, all deliberate:
 * - Postprocessing is GalaxyPostFX, which is already a port of the same bloom
 *   subclass (custom prefilter + reconstruction blur) and ACES. The site
 *   antialiases with an SMAA pass after it; we render the scene with 4x MSAA
 *   instead, which resolves the moon's silhouette against the sun properly —
 *   SMAA only guesses edges from the final image, and loses the thin sunlit
 *   sliver at the limb.
 * - Only the "full" postprocessing tier is ported. The tone-map-in-shader
 *   fallback for weak GPUs is not.
 * - The arm paths are sampled by field.js's SVG sampler instead of SVGLoader.
 * - It renders through the host's renderer and composites over the host's
 *   frame, and by default leaves out its own far sky (X) so the host's shows
 *   through. `render()` takes an explicit clock so the host can start, seek and
 *   replay.
 */
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const SH = global.SOL_SHADERS;
  const { mulberry32, pathSource } = global.GalaxyField;
  const MU = THREE.MathUtils;
  const TAU = Math.PI * 2;
  const GALAXY_TILT = (63 * Math.PI) / 180;

  // The fly-through fades stars below the artwork slot, which on openai.com has
  // copy under it. With `centeredIntro` the camera starts lower, so the slot
  // moves with it; this is the one edit to the extracted GLSL.
  const FIELD_VERT = SH.fieldVert
    .replace('uniform float uViewHeight;', 'uniform float uViewHeight;\n  uniform float uIntroDrop;')
    .replace('float artworkBottom = 1.2 - uViewHeight * 0.5;',
      'float artworkBottom = 1.2 - uViewHeight * 0.5 - uIntroDrop;');
  if (FIELD_VERT === SH.fieldVert) throw new Error('sol: fieldVert patch did not apply');

  // ---------------------------------------------------------------------------
  // Palette (c, u, p) — the Astra palette, bucketed by a 0..1 colour seed.
  // ---------------------------------------------------------------------------
  const PALETTE = ['#6DCBF4', '#7AB1FE', '#F87915', '#FA994C', '#F5F6FB']
    .map((c) => new THREE.Color(c));
  const HERO_COLOR_SEEDS = [0.08, 0.58, 0.22, 0.68, 0.44];
  function paletteColor(v) {
    return v < 0.36 ? PALETTE[0] : v < 0.52 ? PALETTE[1] : v < 0.64 ? PALETTE[2]
      : v < 0.74 ? PALETTE[3] : PALETTE[4];
  }

  // The five arms of the intro galaxy (I). Their paths are the `legacy` set.
  const ARMS = [
    { depth: 0.62, phase: 0.16, speed: 0.025, strong: true },
    { depth: -0.46, phase: 0.72, speed: 0.018, strong: false },
    { depth: 0.78, phase: 0.38, speed: 0.021, strong: true },
    { depth: -0.7, phase: 0.58, speed: 0.016, strong: false },
    { depth: 0.42, phase: 0.08, speed: 0.03, strong: true },
  ];

  // Nine hand-placed bright stars in the background sky (_), as 0..1 x/y.
  const BACKGROUND_HEROES = [
    [0.097, 0.05], [0.688, 0.274], [0.908, 0.3], [0.083, 0.45], [0.308, 0.58],
    [0.254, 0.762], [0.797, 0.758], [0.889, 0.866], [0.126, 0.998],
  ];

  // ---------------------------------------------------------------------------
  // Layout (M) — sizes the bodies from the CSS viewport. Returns world units.
  //   width, height: CSS px of the artwork slot; frameViewHeight: world units.
  // ---------------------------------------------------------------------------
  function bodyLayout(width, height, frameViewHeight) {
    const worldPerPx = frameViewHeight / Math.max(height, 1);
    const narrow = 1 - MU.smoothstep(width, 480, 900);
    const maxRadius = Math.min(68, 0.13 * width);
    let radius = Math.min(maxRadius, height * MU.lerp(0.15, 0.12, narrow));
    const heightScale = radius / maxRadius;
    const reach = Math.max(0.32 * Math.min(width, 1440) * 0.7, 3.4 * radius);
    const compression = MU.smoothstep(1 - (width / 2 - 18) / (reach + 1.15 * radius), 0, 0.25);
    radius *= (1 - 0.07 * compression) * MU.lerp(0.9, 1, narrow);
    const separation = Math.min(reach, Math.max(0, width / 2 - 18 - 1.15 * radius));
    return {
      compression,
      heightScale,
      radius: radius * worldPerPx,
      centerOffset: 6 * narrow * worldPerPx,
      separation: (separation * worldPerPx) / 0.7,
    };
  }

  // ---------------------------------------------------------------------------
  // Timeline (F, z). `seconds` is the reveal clock; the original passes it
  // through as z(t / 8.27) and immediately multiplies back.
  // ---------------------------------------------------------------------------
  function quintic(x, a, b) {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * t * (t * (6 * t - 15) + 10);
  }

  function timeline(seconds) {
    const t = Math.max(seconds, 0);
    // A short hesitation after 0.45 s, then an overshoot-free settle from 3 s:
    // `local` runs 0..~4.8 and eases into 4.8 exponentially.
    const hold = Math.min(Math.max((t - 0.45) / 3.02, 0), 1);
    const warped = t - 0.47 * hold * hold * (3 - 2 * hold);
    const tail = Math.min(Math.max(warped - 3, 0), 4.8);
    const settle = Math.exp(-tail / 1.8) * (1 - (tail / 4.8) ** 3) ** 2;
    const local = warped <= 3 ? warped : 4.8 - 1.8 * settle;

    const expansion = (1 - Math.cos(quintic(local, 0.45, 4.8) * Math.PI)) / 2;
    const rotation = (1 - quintic(local, 2.3, 4.7)) ** 1.1;
    return {
      expansion,
      camera: {
        x: (0.42 * Math.sin(Math.PI * expansion) - 0.12) * (1 - expansion),
        y: 0.12 * Math.sin(2 * Math.PI * expansion) * (1 - expansion),
      },
      scatter: quintic(local, 1.45, 4.8),
      bodies: {
        brightness: 0.35 + 0.65 * expansion,
        sunWhiteHeat: 1 - quintic(local, 0.45, 3.6),
        scale: 0.035 + 0.965 * expansion,
        separation: 0.7,
        rotation,
        center: expansion,
      },
    };
  }

  // The original runs the first 7.5 s ten percent fast; reduced motion jumps
  // straight to the settled frame.
  function warpClock(seconds, continuous) {
    return continuous ? seconds + Math.min(seconds, 7.499999999999999) * 0.1 : 8.25;
  }

  // ---------------------------------------------------------------------------
  // Hashes (U, N) — a seeded point inside the unit ball.
  // ---------------------------------------------------------------------------
  function hash(a, b, ka, kb) {
    const v = 43758.5453 * Math.sin(a * ka + b * kb);
    return v - Math.floor(v);
  }
  function ballPoint(a, b, c, d) {
    const theta = hash(a, b, 127.1, 311.7) * TAU;
    const y = 2 * hash(b, c, 269.5, 183.3) - 1;
    const r = Math.cbrt(hash(a, d, 419.2, 371.9));
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    return [Math.cos(theta) * ring * r, y * r, Math.sin(theta) * ring * r];
  }

  // ---------------------------------------------------------------------------
  // Arm geometry (P) — an SVG path mapped into world space with a depth bow.
  // ---------------------------------------------------------------------------
  class SolArmCurve extends THREE.Curve {
    constructor(source, depth, rotationDepth, depthPhase) {
      super();
      this.source = source;
      this.depth = depth;
      this.rotationDepth = rotationDepth;
      this.depthPhase = depthPhase;
      this.arcLengthDivisions = 640;
    }
    getPoint(u, target = new THREE.Vector3()) {
      const a = MU.clamp(u, 0, 1);
      const p = this.source.getPointAt(a);
      const bow = Math.sin(a * Math.PI);
      const z = Math.sin(a * Math.PI * 1.35 + this.depthPhase) * this.depth * this.rotationDepth * bow;
      return target.set((p.x - 114.973) * (9.7 / 325), (211.36 - p.y) * (9.7 / 325), z);
    }
  }

  // (W) Every arm flows inward, whichever way its path was drawn.
  function flowSpeed(curve, arm) {
    const inward = curve.getPointAt(1).lengthSq() < curve.getPointAt(0).lengthSq();
    return 0.8 * ARMS[arm].speed * (inward ? 1 : -1);
  }

  // ---------------------------------------------------------------------------
  // Particles
  // ---------------------------------------------------------------------------

  /** (G) The core cluster. Same seeds as Astra's. */
  function coreParticles(count) {
    const rng = mulberry32(0xb7e15162);
    const colorRng = mulberry32(0xc0ac29b7);
    return Array.from({ length: count }, () => {
      const radius = rng() ** 2.4 * 0.42;
      const angle = rng() * TAU;
      const position = [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.72, (rng() - 0.5) * 0.16];
      const centrality = 1 - radius / 0.42;
      const brightness = 1.2 + 2.8 * centrality + 0.6 * rng();
      const color = centrality > 0.74 ? 0.99 : colorRng();
      const scale = (0.28 + 1.45 * centrality + 0.45 * rng()) * 1.64;
      const phase = rng() * TAU;
      const rate = 0.55 + 0.45 * rng();
      return {
        position, sphere: ballPoint(0, phase, scale, brightness), brightness, color,
        opacity: 0.62 + 0.38 * centrality, scale, envelope: 1, visibility: 1,
        phase, rate, path: [0, 0, 0, 0], offset: [0, 0],
      };
    });
  }

  /** (H) `count` stars resampled from `source`, re-seeded into the ball. */
  function resample(source, count) {
    return Array.from({ length: count }, (_, i) => {
      const s = source[Math.floor((i * source.length) / count)];
      const p = ballPoint(i + 1, s.phase, s.scale, s.brightness);
      return { ...s, position: p, sphere: p, envelope: 1, visibility: 1, path: [0, 0, 0, 0], offset: [0, 0] };
    });
  }

  function armStars(curve, arm, count) {
    const desc = ARMS[arm];
    const rng = mulberry32(0x243f6a88 ^ ((arm + 1) * 0x9e3779b9));
    const colorRng = mulberry32(0xa4093822 ^ ((arm + 1) * 0x299f31d0));
    const point = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const flow = flowSpeed(curve, arm);
    const out = [];
    let hero = null;
    for (let i = 0; i < count; i += 1) {
      const phase = rng();
      const progress = phase + (0.57 * Math.sin(phase * TAU)) / TAU;
      const bow = Math.sin(progress * Math.PI);
      curve.getPointAt(progress, point);
      curve.getTangentAt(progress, tangent).normalize();
      normal.set(-tangent.y, tangent.x, 0).normalize();
      const spread = 0.4 * MU.lerp(0.3, 1, bow) * (0.22 + 0.78 * rng());
      const across = (rng() + rng() - 1) * spread;
      const depth = (rng() + rng() - 1) * spread * 0.65;
      point.addScaledVector(normal, across);
      point.z += depth;
      const brightChance = desc.strong ? 0.085 : 0.055;
      const bright = rng() < MU.lerp(0.22 * brightChance, brightChance, bow);
      const scale = (bright ? 0.85 + 1.25 * rng() : 0.12 + rng() ** 2.4 * 0.68) * 2.05;
      const brightness = (bright ? 2 + 1.5 * rng() : 0.56 + 0.78 * rng()) * (desc.strong ? 1 : 0.82);
      const color = colorRng();
      const opacity = 0.82 + 0.16 * rng();
      const twinklePhase = rng() * TAU;
      const rate = 0.65 + 0.7 * rng();
      const star = {
        position: point.toArray(),
        sphere: ballPoint(phase, twinklePhase, scale, brightness),
        brightness, color, opacity, scale,
        envelope: MU.lerp(1, 0.14 + 0.86 * bow ** 0.68, 0.45),
        visibility: MU.smoothstep(progress, 0, 0.055) * (1 - MU.smoothstep(progress, 0.945, 1)),
        phase: twinklePhase, rate,
        path: [phase, (arm + 0.5) / ARMS.length, flow, 0.57],
        offset: [across, depth],
      };
      out.push(star);
      if (!hero || scale > hero.scale) hero = star;
    }
    if (hero) {
      hero.scale = Math.max(hero.scale, (desc.strong ? 2.2 : 2.05) * 2.05);
      hero.brightness = Math.max(hero.brightness, desc.strong ? 3.35 : 2.85);
      hero.color = HERO_COLOR_SEEDS[arm];
    }
    return out;
  }

  function armDust(curve, arm, count) {
    const desc = ARMS[arm];
    const rng = mulberry32(0x9e3779b9 ^ ((arm + 1) * 0x85ebca6b));
    const point = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const flow = flowSpeed(curve, arm);
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const even = (i + 0.92 * rng()) / count;
      const centred = (rng() + rng() + rng()) / 3;
      const f = rng() < 0.57 ? centred : even;
      const bow = Math.sin(f * Math.PI);
      const envelope = MU.lerp(1, 0.18 + 0.82 * bow ** 0.68, 0.45);
      curve.getPointAt(f, point);
      curve.getTangentAt(f, tangent).normalize();
      normal.set(-tangent.y, tangent.x, 0).normalize();
      const tight = rng() < 0.68;
      const spread = (tight ? 0.03 : 0.4) * envelope;
      const across = (rng() + rng() - 1) * spread;
      const depth = (rng() + rng() - 1) * spread * 0.7;
      point.addScaledVector(normal, across);
      point.z += depth;
      const seed = rng();
      const size = rng() * (tight ? 1 : 0.72) * envelope;
      const opacity = MU.smoothstep(f, 0, 0.07) * (1 - MU.smoothstep(f, 0.84, 1))
        * (tight ? 1 : 0.72) * (0.38 + 0.58 * rng()) * MU.lerp(1, 0.3 + 0.7 * bow, 0.45);
      // Dust brightens around the arm's own phase and just downstream of it.
      const reach = 0.17 * (desc.strong ? 1.15 : 1);
      const near = 1 - MU.smoothstep(Math.abs(f - desc.phase), 0.08 * reach, reach);
      const behind = (desc.phase - f + 1) % 1;
      const glow = Math.max(near ** 2, (1 - MU.smoothstep(behind, 0, 0.18)) ** 2 * 0.68);
      out.push({
        position: point.toArray(),
        sphere: ballPoint(f, seed, size, opacity),
        brightness: 2 * (0.16 + glow * (desc.strong ? 1 : 0.62) * 3.6),
        color: 0.99,
        opacity: opacity * (0.22 + 0.78 * glow),
        scale: 1 + 1.35 * size + 1.25 * glow,
        envelope: 1, visibility: 1, phase: 0, rate: 0,
        path: [f, (arm + 0.5) / ARMS.length, flow, 0],
        offset: [across, depth],
      });
    }
    return out;
  }

  /** Where a star settles inside the ball of radius `r` around the focus. */
  function settleInBall(position, sphere, r) {
    const x = position[0];
    const y = position[1] - 1.2;
    const radial = Math.hypot(x, y);
    const angle = radial > 1e-4 ? Math.atan2(y, x) : 0;
    const sx = sphere[0] * r;
    const sy = sphere[1] * r;
    const sr = Math.hypot(sx, sy);
    const turn = (sr > 1e-4 ? Math.atan2(sy, sx) : angle) - angle;
    const nudge = 0.1 * Math.atan2(Math.sin(turn), Math.cos(turn));
    const dist = Math.max(radial / Math.cos(nudge), sr);
    const zMax = Math.sqrt(Math.max(r * r - dist * dist, 0));
    return [
      Math.cos(angle + nudge) * dist,
      1.2 + Math.sin(angle + nudge) * dist,
      Math.max(-zMax, Math.min(zMax, sphere[2] * r)),
    ];
  }

  const ADDITIVE = {
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  };

  // ---------------------------------------------------------------------------
  // (K) The star field: galaxy, dust, core, the intro fly-through, and the two
  // volumes the camera travels through.
  // ---------------------------------------------------------------------------
  function createField(own, particleScale) {
    const group = new THREE.Group();
    const budgets = ARMS.map(({ strong }) => ({
      stars: Math.round((strong ? 220 : 170) * 3.4),
      ambientStars: Math.round((strong ? 220 : 170) * 1.05),
      dust: Math.round((strong ? 150 : 90) * 0.55),
    }));
    const k = particleScale;

    const stars = [];
    const dust = [];
    const pathData = new Float32Array(256 * ARMS.length * 4);
    const v = new THREE.Vector3();
    global.GALAXY_ARM_SETS.legacy.paths.forEach((d, arm) => {
      const curve = new SolArmCurve(pathSource(d), ARMS[arm].depth, 1.4, 0.82 * arm);
      for (let i = 0; i < 256; i += 1) {
        curve.getPointAt(i / 255, v);
        v.toArray(pathData, (256 * arm + i) * 4);
      }
      stars.push(...armStars(curve, arm, Math.floor(budgets[arm].stars * k)));
      dust.push(...armDust(curve, arm, Math.floor(budgets[arm].dust * k)));
    });

    const paths = own(new THREE.DataTexture(pathData, 256, ARMS.length, THREE.RGBAFormat, THREE.FloatType));
    paths.minFilter = paths.magFilter = THREE.NearestFilter;
    paths.generateMipmaps = false;
    paths.needsUpdate = true;

    const uniforms = {
      uTime: { value: 0 }, uFlowTime: { value: 0 }, uGalaxyDensity: { value: 1 },
      uViewportWidth: { value: 1 }, uViewportHeight: { value: 1 }, uRush: { value: 0 },
      uTravelSpeed: { value: 0 }, uWrapOpacity: { value: 0 }, uFieldSpread: { value: 1 },
      uViewHeight: { value: 1 }, uPaths: { value: paths }, uBuildIn: { value: 0 },
      uPixelRatio: { value: 1 }, uExpansion: { value: 0 }, uScatter: { value: 0 },
      uIntroDrop: { value: 0 },
    };

    function layer(particles, {
      isDust = false, intensity = 1.35, isFlyby = false, isIntro = false, isTransit = false,
    } = {}) {
      const n = particles.length;
      const geometry = own(new THREE.BufferGeometry());
      const colors = new Float32Array(3 * n);
      particles.forEach((p, i) => {
        const c = paletteColor(p.color);
        colors[3 * i] = c.r; colors[3 * i + 1] = c.g; colors[3 * i + 2] = c.b;
      });
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(particles.flatMap((p) => p.position)), 3));
      const destination = new THREE.BufferAttribute(new Float32Array(3 * n), 3);
      geometry.setAttribute('destination', destination);
      const ambientVisibility = new THREE.BufferAttribute(new Float32Array(n).fill(1), 1);
      geometry.setAttribute('ambientVisibility', ambientVisibility);
      if (particles === stars) {
        // A shuffled rank lets uGalaxyDensity thin the galaxy evenly.
        const rank = Float32Array.from(particles, (_, i) => i / n);
        const rng = mulberry32(5370206);
        for (let i = rank.length - 1; i > 0; i -= 1) {
          const j = Math.floor(rng() * (i + 1));
          [rank[i], rank[j]] = [rank[j], rank[i]];
        }
        geometry.setAttribute('galaxyRank', new THREE.BufferAttribute(rank, 1));
      }
      geometry.setAttribute('starColor', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('path', new THREE.BufferAttribute(new Float32Array(particles.flatMap((p) => p.path)), 4));
      geometry.setAttribute('pathOffset', new THREE.BufferAttribute(new Float32Array(particles.flatMap((p) => p.offset)), 2));
      for (const [attr, key] of [
        ['starBrightness', 'brightness'], ['starOpacity', 'opacity'], ['starScale', 'scale'],
        ['starEnvelope', 'envelope'], ['starVisibility', 'visibility'],
        ['twinklePhase', 'phase'], ['twinkleRate', 'rate'],
      ]) {
        geometry.setAttribute(attr, new THREE.BufferAttribute(new Float32Array(particles.map((p) => p[key])), 1));
      }
      const material = own(new THREE.ShaderMaterial({
        vertexShader: FIELD_VERT,
        fragmentShader: isDust ? SH.dustFrag : isIntro ? SH.coreFrag : SH.starFrag,
        defines: {
          ZOOM_RUSH: 1, RUSH_LENGTH: 12, TRANSIT_TRAIL_LIMIT: 44, RUSH_GLOW_EXTENT: 2.4,
          ...(isFlyby ? { FLYBY_STARS: 1 } : {}),
          ...(isTransit ? { TRANSIT_STARS: 1 } : {}),
          ...(isDust ? { DUST: 1 } : {}),
          ...(isIntro ? { INTRO_STAR: 1 } : {}),
        },
        uniforms: { ...uniforms, uIntensity: { value: intensity } },
        ...ADDITIVE,
        transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
      }));
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      group.add(points);
      return { points, particles, destination, ambientVisibility };
    }

    const layers = [
      layer(stars),
      layer(dust, { isDust: true }),
      layer(coreParticles(Math.floor(30 * k)), { intensity: 1.647 }),
    ];

    // The fly-through re-draws the galaxy and its dust from the same buffers
    // with INTRO_GALAXY, seen from 63 degrees round.
    const introGalaxy = new THREE.Group();
    introGalaxy.name = 'intro-galaxy';
    introGalaxy.rotation.y = GALAXY_TILT;
    group.add(introGalaxy);
    for (const { points } of layers.slice(0, 2)) {
      const material = own(points.material.clone());
      material.defines = { ...material.defines, INTRO_GALAXY: 1 };
      material.uniforms = points.material.uniforms;
      const p = new THREE.Points(points.geometry, material);
      p.frustumCulled = false;
      introGalaxy.add(p);
    }

    // The bright core the camera dives into: it becomes the white-hot star.
    const core = layer(coreParticles(Math.max(1, Math.floor(17 * k))).map((p, i) => {
      const r = 0.105 * (i !== 0);
      return { ...p, position: [p.sphere[0] * r, p.sphere[1] * r * 1.15, p.sphere[2] * r], color: 0.99, opacity: 1 };
    }), { isIntro: true });
    core.points.name = 'intro-galactic-core';
    core.points.rotation.y = GALAXY_TILT;
    layers.push(core);

    const flyby = layer(resample(stars, Math.floor(380 * k)), { isFlyby: true });
    flyby.points.name = 'flyby-stars';
    layers.push(flyby);

    // Stars streaking past during the approach, laid on a jittered grid.
    const gridRng = mulberry32(0x6a09e667);
    const slabs = Math.ceil(Math.floor(180 * k) / 60);
    const transit = layer(resample(stars, Math.floor(180 * k)).map((p, i) => ({
      ...p,
      sphere: [
        ((i % 10) + gridRng()) / 5 - 1,
        ((Math.floor(i / 10) % 6) + gridRng()) / 3 - 1,
        (Math.floor(i / 60) + gridRng()) / slabs,
      ],
      scale: 0.65 * p.scale,
    })), { isTransit: true, intensity: 1 });
    transit.points.name = 'transit-stars';
    layers.push(transit);

    const ambientTotal = budgets.reduce((sum, b) => sum + Math.floor(b.ambientStars * k), 0);
    const ambientShare = ambientTotal / (ambientTotal + flyby.particles.length);

    return {
      group,
      count: layers.reduce((sum, l) => sum + l.particles.length, stars.length + dust.length),

      /** Returns the half-extent of the settled field, which sizes the camera. */
      resize(width, height, viewHeight) {
        const ball = 3.5 * Math.min(((viewHeight * width) / height) * 1.12 * 0.34, 1.12 * viewHeight * 0.4);
        uniforms.uViewportWidth.value = width;
        uniforms.uViewportHeight.value = height;
        uniforms.uViewHeight.value = viewHeight;
        const { compression, heightScale } = bodyLayout(width, height, viewHeight);
        uniforms.uGalaxyDensity.value = Math.max(0.8, (1 - 0.2 * compression) * heightScale);
        const extent = Math.max(ball, ((viewHeight * width) / height) * 0.7);
        uniforms.uFieldSpread.value = extent / ball;
        const fill = Math.min(1, (width * ball * height) / (842956.8 * viewHeight));
        for (const { particles, destination, ambientVisibility } of layers) {
          const isFlyby = particles === flyby.particles;
          let share = 1;
          if (particles === stars) share = ambientShare * (ambientTotal / stars.length);
          else if (isFlyby) share = ambientShare;
          particles.forEach((p, i) => {
            const g = ((i + 0.5) * 0.61803398875) % 1;
            ambientVisibility.setX(i, +(g < fill * share));
            const d = particles === transit.particles ? p.sphere
              : isFlyby ? [p.sphere[0] * ball, 1.2 + p.sphere[1] * ball, p.sphere[2] * ball]
                : settleInBall(p.position, p.sphere, ball);
            destination.setXYZ(i, ...d);
          });
          destination.needsUpdate = true;
          ambientVisibility.needsUpdate = true;
        }
        return extent;
      },

      update(reveal, expansion, pixelRatio, buildIn, time, dragRotation, continuous, drop = 0) {
        uniforms.uIntroDrop.value = drop;
        uniforms.uFlowTime.value = continuous ? time : 0;
        uniforms.uTime.value = continuous ? time : 0;
        uniforms.uPixelRatio.value = pixelRatio;
        uniforms.uBuildIn.value = buildIn;
        uniforms.uExpansion.value = expansion;
        introGalaxy.visible = expansion < 0.55 && continuous;
        core.points.visible = expansion < 0.4;
        transit.points.visible = expansion < 1 && continuous;
        uniforms.uWrapOpacity.value = continuous ? MU.smoothstep(reveal, 8.27, 9.07) : 1;
        uniforms.uRush.value = continuous
          ? MU.smoothstep(expansion, 0.03, 0.22) * (1 - MU.smoothstep(expansion, 0.65, 0.98)) : 0;
        const now = timeline(reveal);
        const next = timeline(reveal + 0.01);
        uniforms.uTravelSpeed.value = continuous
          ? 490 * Math.max(0, (next.expansion - now.expansion) / 0.01) : 0;
        uniforms.uScatter.value = now.scatter;
        // After 1.8 s the field eases into a slow drift.
        const drift = continuous ? Math.max(0, reveal - 1.8) : 0;
        const m = Math.min(drift / 1.2, 1);
        const turned = drift < 1.2 ? 1.2 * (m ** 6 - 3 * m ** 5 + 2.5 * m ** 4) : drift - 0.6;
        group.rotation.y = -GALAXY_TILT - 0.018 * turned + (continuous ? 0.314 * dragRotation : 0);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // (X) The far sky: a fixed pool of sprites that wraps sideways, plus a faint
  // nebula plane behind it.
  // ---------------------------------------------------------------------------
  function createBackground(own, tierLow, available) {
    const base = tierLow ? 1700 : 2720;
    const count = Math.max(0, Math.min(base + Math.round(2 * base * 0.06), Math.floor(available)));
    const rng = mulberry32(0x5a91f04c);
    const pos = new Float32Array(3 * count);
    const star = new Float32Array(4 * count);
    const tint = new Float32Array(4 * count);
    for (let i = 0; i < count; i += 1) {
      const hero = BACKGROUND_HEROES[i];
      let x = hero ? hero[0] : rng();
      // The extra 12% sit just past either edge, so wrapping never shows a gap.
      if (i >= base) x = i % 2 === 0 ? -(0.06 * x) : 1 + 0.06 * x;
      const y = hero ? hero[1] : rng();
      const bright = !hero && rng() < 0.045;
      let size = 0.8 + rng() ** 2 * 1.8;
      if (hero) size = 4 + 2 * rng();
      else if (bright) size = 2.5 + 3.5 * rng();
      pos.set([x - 0.5, 0.5 - y, -(2 * rng())], 3 * i);
      star.set([size, hero || bright ? 0.65 + 0.3 * rng() : 0.25 + 0.6 * rng(), rng() * TAU, 0.35 + 0.3 * rng()], 4 * i);
      const hue = rng();
      let rgb = [0.82, 0.9, 1];
      if (!hero && hue < 0.12) rgb = [1, 0.58, 0.3];
      else if (!hero && hue < 0.3) rgb = [0.35, 0.65, 1];
      tint.set([...rgb, hero ? 55 + 30 * rng() : 0], 4 * i);
    }
    const geometry = own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('star', new THREE.BufferAttribute(star, 4));
    geometry.setAttribute('tint', new THREE.BufferAttribute(tint, 4));
    const uniforms = {
      uTime: { value: 0 }, uBuildIn: { value: 0 }, uPixelRatio: { value: 1 },
      uImageScale: { value: 1 }, uTravel: { value: 0 }, uHalfView: { value: 0.5 },
      uPixelToField: { value: 5.208333333333333e-4 },
    };
    const material = own(new THREE.ShaderMaterial({
      vertexShader: SH.backgroundVert, fragmentShader: SH.backgroundFrag, uniforms,
      ...ADDITIVE, transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
    }));
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;

    const plane = own(new THREE.PlaneGeometry(1.12, 1, 48, 28));
    const vp = plane.getAttribute('position');
    const colors = new Float32Array(3 * vp.count);
    for (let i = 0; i < vp.count; i += 1) {
      const x = vp.getX(i);
      const y = vp.getY(i);
      const g = Math.min(1, Math.hypot(1.6 * x, 1.2 * y)) ** 1.8
        * (0.65 + 0.2 * Math.sin(27 * x + 2 * Math.sin(13 * y)) + 0.15 * Math.sin(39 * y - 19 * x));
      colors.set([3e-4 + 0.012 * g, 6e-4 + 0.023 * g, 9e-4 + 0.032 * g], 3 * i);
    }
    plane.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const nebula = new THREE.Mesh(plane, own(new THREE.MeshBasicMaterial({
      vertexColors: true, depthWrite: false, transparent: true, opacity: 0,
    })));
    nebula.position.z = -3;

    const group = new THREE.Group();
    group.add(nebula, points);
    return {
      group, points,
      /** Keep the sky filling the view while the intro camera is lowered. */
      setDrop(centerY, drop) { group.position.y = centerY - drop; },
      resize(viewWidth, viewHeight, centerY, depth, cssHeight) {
        const s = Math.max(viewWidth / 1920, viewHeight / 1080);
        group.scale.set(1920 * s, 1080 * s, 1);
        group.position.set(0, centerY, -depth);
        uniforms.uImageScale.value = (s * cssHeight) / viewHeight;
        uniforms.uHalfView.value = viewWidth / (2 * group.scale.x);
        uniforms.uPixelToField.value = viewHeight / (cssHeight * group.scale.x);
      },
      update(reveal, pixelRatio, dragRotation, buildIn, time, continuous) {
        uniforms.uTime.value = continuous ? reveal : 0;
        uniforms.uPixelRatio.value = pixelRatio;
        uniforms.uBuildIn.value = buildIn;
        nebula.material.opacity = buildIn * buildIn * (3 - 2 * buildIn);
        uniforms.uTravel.value = continuous ? ((dragRotation + 0.06 * time) * 0.18) / group.scale.x : 0;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // (f) The moon's MeshStandardMaterial patch: a crescent-friendly light model,
  // terminator softening and subpixel coverage at the limb.
  // ---------------------------------------------------------------------------
  function patchMoonMaterial(shader) {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SH.moonCrescent}\nfloat moonPixelCoverage;`)
      .replace('#include <normal_fragment_maps>', `
        vec3 moonSmoothNormal = normal;
        #include <normal_fragment_maps>
        vec3 moonViewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
        float moonFacing = max(dot(moonSmoothNormal, moonViewDir), 0.0);
        // Squared facing stays smooth in screen space at the sphere silhouette.
        float moonLimbDistance = moonFacing * moonFacing;
        moonPixelCoverage = smoothstep(0.0, max(0.0025, fwidth(moonLimbDistance) * 3.0), moonLimbDistance);
        float moonDetail = smoothstep(0.02, 0.24, moonFacing);
        #if NUM_DIR_LIGHTS > 0
          float moonLightFacing = moonCrescentLight(moonSmoothNormal, directionalLights[0].direction, moonViewDir);
          // Let an unresolved crescent fade away instead of flickering between raster samples.
          float moonPixelSize = max(max(fwidth(moonSmoothNormal.x), fwidth(moonSmoothNormal.y)), 0.0001);
          float moonCrescentPixels = (1.0 + dot(directionalLights[0].direction, moonViewDir)) / moonPixelSize;
          moonPixelCoverage *= smoothstep(0.0, 2.0, moonCrescentPixels);
          moonDetail *= smoothstep(0.0, 0.2, abs(moonLightFacing));
        #endif
        // Preserve crater relief on the face, but not at the grazing limb or terminator.
        normal = normalize(mix(moonSmoothNormal, normal, moonDetail));
      `)
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'vec3 irradiance = dotNL * directLight.color;', `
          float moonLight = moonCrescentLight(geometryNormal, directLight.direction, geometryViewDir);
          float moonSoftness = max(0.06, fwidth(moonLight) * 1.5);
          // Integrate lighting over a small source / pixel footprint at the terminator.
          float moonLitFraction = clamp((moonLight + moonSoftness) / (2.0 * moonSoftness), 0.0, 1.0);
          float moonDiffuse = moonLight >= moonSoftness ? moonLight
            : moonSoftness * moonLitFraction * moonLitFraction;
          // Keep the crescent's tips visible as the surface turns toward the poles.
          moonDiffuse /= max(length(geometryNormal.xz), 0.5);
          float moonLimb = max(dot(geometryNormal, geometryViewDir), 0.0);
          float moonCoverage = smoothstep(0.0, max(0.05, fwidth(moonLimb) * 1.5), moonLimb);
          vec3 irradiance = moonDiffuse * moonCoverage * directLight.color;
        `))
      .replace('#include <colorspace_fragment>', `
        #include <colorspace_fragment>
        // On the direct path, apply coverage after tone mapping to keep subpixel light dim.
        gl_FragColor.rgb *= moonPixelCoverage;
      `);
  }

  /** (inline) 256x128 procedural moon albedo: two octaves of ripple + 44 craters. */
  function moonTexture() {
    const data = new Uint8Array(256 * 128 * 4);
    let state = 1729;
    const rand = () => (state = (Math.imul(state, 1664525) + 0x3c6ef35f) >>> 0) / 0x100000000;
    const craters = Array.from({ length: 44 }, () => {
      const y = 2 * rand() - 1;
      const a = rand() * TAU;
      const ring = Math.sqrt(1 - y * y);
      return { x: ring * Math.cos(a), y, z: ring * Math.sin(a), radius: 0.025 + 0.13 * rand() };
    });
    for (let row = 0; row < 128; row += 1) {
      const polar = (row / 127) * Math.PI;
      for (let col = 0; col < 256; col += 1) {
        const az = (col / 255) * TAU;
        const x = Math.sin(polar) * Math.cos(az);
        const y = Math.cos(polar);
        const z = Math.sin(polar) * Math.sin(az);
        let v = 0.65 + Math.sin(13 * x + 7 * z) * Math.sin(17 * y - 5 * x) * 0.12
          + Math.sin(137 * x + 91 * y) * Math.sin(113 * z - 67 * y) * 0.07;
        for (const c of craters) {
          const d = Math.hypot(x - c.x, y - c.y, z - c.z) / c.radius;
          if (d < 1.25) v += -0.18 * Math.max(0, 1 - d * d) + 0.14 * Math.exp(-(((d - 0.95) / 0.14) ** 2));
        }
        const g = Math.round(255 * MU.clamp(v, 0.2, 0.95));
        const o = (256 * row + col) * 4;
        data[o] = data[o + 1] = data[o + 2] = g;
        data[o + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, 256, 128, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  /** How much of the sun the moon hides, as the eclipse terms the shaders use. */
  function eclipse(distance, sunRadius, moonRadius, moonInFront) {
    if (!moonInFront || !Number.isFinite(distance) || !Number.isFinite(sunRadius)
      || !Number.isFinite(moonRadius) || distance < 0 || sunRadius <= 0 || moonRadius <= 0) {
      return { moonScale: 1, darkening: 0, corona: 0, diamond: 0 };
    }
    const r = distance / sunRadius;
    const darkening = 1 - MU.smoothstep(r, 0.3, 2);
    // Near totality the moon swells just enough to cover the whole disc.
    const cover = Math.max(moonRadius, 1.02 * sunRadius);
    const moonScale = MU.lerp(1, cover / moonRadius, darkening);
    const gap = r + 1 - (moonRadius * moonScale) / sunRadius;
    return {
      moonScale,
      darkening,
      corona: 1 - MU.smoothstep(gap, 0.02, 0.38),
      diamond: MU.smoothstep(gap, 0, 0.025) * (1 - MU.smoothstep(gap, 0.08, 0.22)),
    };
  }

  // ---------------------------------------------------------------------------
  // (Z) The sun and the moon.
  // ---------------------------------------------------------------------------
  function createBodies(own) {
    const group = new THREE.Group();
    group.name = 'celestial-bodies';
    const sun = new THREE.Group();
    sun.name = 'sun';
    const moon = new THREE.Group();
    moon.name = 'moon';
    group.add(sun, moon);

    const colors = { sun: paletteColor(0.58).clone(), moon: paletteColor(0.08).clone() };
    const moonAlbedo = new THREE.Color('#eef3f8');
    const lightDir = new THREE.Vector3(-6, 0, -4.5).normalize();

    const sunUniforms = {
      uRevealBrightness: { value: 1 }, uWhiteHeat: { value: 0 }, uColor: { value: colors.sun },
      uSurfaceTime: { value: 0 }, uBloomScale: { value: 0.5 }, uEclipse: { value: 0 },
      uDiamond: { value: 0 }, uMoon: { value: new THREE.Vector3() },
    };
    const atmosphereUniforms = {
      uRevealBrightness: { value: 1 }, uSurfaceRadius: { value: 0.8474576271186441 },
      uColor: { value: colors.moon }, uDirectional: { value: 1 },
      uLightDirection: { value: lightDir.clone() },
    };

    // The corona is additive; turning its light back into (colour, coverage)
    // lets it occlude the sky behind it the way the original's does.
    const withCoverage = (src) => `${src.replace('void main()', 'void celestialLinearMain()')}
        void main() {
          celestialLinearMain();
          float coverage = clamp(max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)), 0.0, 1.0);
          gl_FragColor = vec4(gl_FragColor.rgb / max(coverage, 0.00001), coverage);
        }`;

    const sunSurface = new THREE.Mesh(
      own(new THREE.SphereGeometry(1, 64, 48)),
      own(new THREE.ShaderMaterial({
        vertexShader: SH.bodyVert, fragmentShader: SH.sunSurfaceFrag, uniforms: sunUniforms, toneMapped: false,
      })),
    );
    sunSurface.name = 'sun-surface';
    const corona = new THREE.Mesh(
      own(new THREE.PlaneGeometry(14, 14)),
      own(new THREE.ShaderMaterial({
        vertexShader: SH.coronaVert, fragmentShader: withCoverage(SH.coronaFrag), uniforms: sunUniforms,
        ...ADDITIVE, transparent: true, depthWrite: false, toneMapped: false,
      })),
    );
    corona.name = 'sun-corona';
    corona.renderOrder = 110;
    corona.frustumCulled = false;
    sun.add(sunSurface, corona);

    const albedo = own(moonTexture());
    const moonMaterial = own(new THREE.MeshStandardMaterial({
      color: moonAlbedo, map: albedo, bumpMap: albedo, roughness: 1, metalness: 0, toneMapped: false,
    }));
    moonMaterial.onBeforeCompile = patchMoonMaterial;
    const moonSurface = new THREE.Mesh(own(new THREE.SphereGeometry(1, 96, 64)), moonMaterial);
    moonSurface.name = 'moon-surface';
    const atmosphere = new THREE.Mesh(
      own(new THREE.SphereGeometry(1, 64, 48)),
      own(new THREE.ShaderMaterial({
        vertexShader: SH.bodyVert, fragmentShader: SH.moonAtmosphereFrag, uniforms: atmosphereUniforms,
        ...ADDITIVE, transparent: true, depthWrite: false, toneMapped: false,
      })),
    );
    atmosphere.name = 'moon-atmosphere';
    atmosphere.renderOrder = 111;
    const lightTarget = new THREE.Object3D();
    const rimLight = new THREE.DirectionalLight(colors.moon, 24);
    rimLight.name = 'moon-rim-light';
    rimLight.position.copy(atmosphereUniforms.uLightDirection.value);
    rimLight.target = lightTarget;
    moon.add(moonSurface, atmosphere, lightTarget, rimLight);
    group.add(new THREE.AmbientLight(colors.moon, 0.025));

    let separation = 0;
    let sunRadius = 1;
    let moonRadius = 1;
    let centerOffset = 0;
    const sunView = new THREE.Vector3();
    const moonView = new THREE.Vector3();
    const toSun = new THREE.Vector3();

    return {
      group, sun, moon,
      resize(width, height, frameViewHeight) {
        const l = bodyLayout(width, height, frameViewHeight);
        sunRadius = 1.15 * l.radius;
        moonRadius = 1.1 * l.radius;
        separation = l.separation;
        centerOffset = l.centerOffset;
        sunSurface.scale.setScalar(sunRadius);
        corona.scale.setScalar(sunRadius);
        moonSurface.scale.setScalar(moonRadius);
        atmosphere.scale.setScalar(1.18 * moonRadius);
        moonMaterial.bumpScale = 0.09 * moonRadius;
      },
      update(time, t, camera) {
        group.position.y = 1.2 * t.center;
        const shift = centerOffset * (1 - t.rotation);
        sun.position.set(shift - separation * t.separation, 0, -0.8);
        moon.position.set(shift + separation * t.separation, 0, 1.2);
        const dx = moon.position.x - sun.position.x;
        const dz = moon.position.z - sun.position.z;
        const lightTilt = (dx * (lightDir.z / lightDir.x) - dz) / Math.hypot(dx, dz);
        sun.scale.setScalar(t.scale);
        moon.scale.setScalar(t.scale);
        sunUniforms.uSurfaceTime.value = 4 * time;
        sunUniforms.uWhiteHeat.value = t.sunWhiteHeat;

        camera.updateMatrixWorld();
        sun.getWorldPosition(sunView).applyMatrix4(camera.matrixWorldInverse);
        moon.getWorldPosition(moonView).applyMatrix4(camera.matrixWorldInverse);
        const moonInFront = moonView.z > sunView.z;
        const sunOnScreen = sunRadius * t.scale;
        const e = eclipse(
          Math.hypot(moonView.x - sunView.x, moonView.y - sunView.y),
          sunOnScreen, moonRadius * t.scale, moonInFront,
        );
        moon.scale.setScalar(t.scale * e.moonScale);
        moon.updateWorldMatrix(true, false);

        // Light the moon from wherever the sun actually is on screen.
        toSun.subVectors(sunView, moonView).normalize();
        toSun.z -= lightTilt;
        rimLight.position.copy(toSun).add(moonView).applyMatrix4(camera.matrixWorld);
        moon.worldToLocal(rimLight.position);
        atmosphereUniforms.uLightDirection.value.copy(rimLight.position).normalize();

        sunUniforms.uEclipse.value = e.corona;
        sunUniforms.uDiamond.value = e.diamond;
        sunUniforms.uMoon.value.set(
          (moonView.x - sunView.x) / sunOnScreen,
          (moonView.y - sunView.y) / sunOnScreen,
          moonInFront ? (moonRadius * e.moonScale) / sunRadius : 0,
        );
        const lit = 1 - e.darkening;
        atmosphereUniforms.uRevealBrightness.value = t.brightness ** 2 * lit;
        moonMaterial.color.copy(moonAlbedo).multiplyScalar(t.brightness * lit);
        rimLight.intensity = 24 * lit;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // The player
  //
  // It draws through the host page's renderer rather than a canvas of its own,
  // and composites *over* whatever the host has already drawn this frame —
  // exactly as openai.com composites its transparent canvas over the page. So
  // the host's own sky stays put underneath, there is one WebGL context, and
  // the programs and render targets it shares with the host are shared for
  // real (three caches programs by source).
  // ---------------------------------------------------------------------------

  const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

  // Auto-orbit — ours, not the original's. A tap sets the pair swinging round
  // each other; another tap eases them to a stop wherever they are. At a
  // constant pace the eclipse (about 0.1 rad wide) would be over in a fifth of
  // a second, so the orbit slows as the moon closes on the sun's disc.
  const ORBIT = {
    SPEED: (2 * Math.PI) / 28, // rad/s away from the eclipse: 28 s a turn at full pace
    DIRECTION: -1,             // the way that reaches the eclipse first
    SLOW: 0.24,                // pace at alignment, as a fraction of SPEED
    SLOW_NEAR: 0.02,           // rad from alignment: full slowdown inside this
    SLOW_FAR: 0.5,             // rad from alignment: full pace outside this
    START: 2.5,                // 1/s: how fast the pace ramps up...
    STOP: 4,                   // ...and down
  };
  const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  class SolPlayer {
    /**
     * @param {THREE.WebGLRenderer} renderer  the host's
     * @param {object} [opts]
     * @param {boolean} [opts.continuous=true]  false = reduced motion: static, settled
     * @param {boolean} [opts.centeredIntro=false]
     *   On openai.com the galaxy's core starts 1.2 units below the view centre
     *   and rises to it as the bodies form. true starts the camera that much
     *   lower instead, so the dive heads straight into the centre of the frame.
     *   The settled framing is identical either way.
     * @param {boolean} [opts.sky=false]
     *   Build the original's own far sky (X). Off when the host brings one.
     */
    constructor(renderer, { continuous = true, centeredIntro = false, sky = false } = {}) {
      this.renderer = renderer;
      this.continuous = continuous;
      this.centeredIntro = centeredIntro;
      this.sky = sky;
      this.ready = false;
      this._owned = new Set();

      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
      this.dragRoot = new THREE.Group();
      this.splitRoot = new THREE.Group();
      this.scene.add(this.dragRoot);
      this.dragRoot.add(this.splitRoot);

      this.size = { w: 1, h: 1, dpr: 1 };
      this.layoutSize = null;
      this.cameraY = 1.2;
      this.splitAngle = Math.PI;
      this.eclipseAngle = 0;
      this.dragTarget = 0;
      this.dragOffset = 0;
      this.returning = true;
      this.orbiting = false;
      this.orbitAngle = 0;
      this.orbitPace = 0;
      this.lastClock = null;
    }

    /**
     * Build everything, a stage per task so no single frame of the host's
     * animation carries it all, then compile in parallel where the driver
     * supports it (KHR_parallel_shader_compile). Resolves when the first
     * visible frame can be drawn without a stall.
     */
    async build(pause = nextTask) {
      const own = (o) => (this._owned.add(o), o);

      this.field = createField(own, 1);
      this.scene.add(this.field.group);
      await pause();
      if (this.sky) {
        this.background = createBackground(own, false, Infinity);
        this.scene.add(this.background.group);
        await pause();
      }
      this.bodies = createBodies(own);
      this.splitRoot.add(this.bodies.group);
      await pause();

      this.postfx = new global.GalaxyPostFX(this.renderer, {
        bloomIntensity: 0.5, bloomThreshold: 0.62, luminanceSmoothing: 0.18,
        flare: false, depth: true, overlay: true, samples: 4,
      });
      this.layoutSize = null;
      this.resize(this.size.w, this.size.h, this.size.dpr);

      // three compiles every material in the scene but only counts *visible*
      // lights, and the moon's program depends on its rim light. No moment of
      // the intro shows everything at once, so show it all while compiling.
      const hidden = [];
      this.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      const r = this.renderer;
      if (r.compileAsync) await r.compileAsync(this.scene, this.camera);
      else r.compile(this.scene, this.camera);
      await this.postfx.compile();

      // Upload the geometry and textures into a scratch target, off screen.
      await pause();
      const scratch = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
      const previous = r.getRenderTarget();
      r.setRenderTarget(scratch);
      r.render(this.scene, this.camera);
      r.setRenderTarget(previous);
      scratch.dispose();
      for (const o of hidden) o.visible = false;

      this.ready = true;
    }

    /** CSS size and the host's pixel ratio. */
    resize(w, h, dpr) {
      this.size = { w, h, dpr };
      if (!this.postfx) return;
      this.postfx.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
      if (this.layoutSize && this.layoutSize.w === w && this.layoutSize.h === h) return;
      this.layoutSize = { w, h };

      const frameViewHeight = w / h < 0.72 ? 12.7 : 10.9;
      const worldPerPx = frameViewHeight / h;
      const viewHeight = h * worldPerPx;
      const viewWidth = w * worldPerPx;
      const centerY = 1.2;
      const extent = this.field.resize(w, h, frameViewHeight);
      const distance = Math.max(12, extent + 2, 0.4 * viewWidth + 0.3 * viewHeight);
      const cam = this.camera;
      cam.left = -viewWidth / 2;
      cam.right = viewWidth / 2;
      cam.top = viewHeight / 2;
      cam.bottom = -viewHeight / 2;
      cam.far = Math.max(40, 2 * distance + viewHeight);
      cam.position.set(0, centerY, distance);
      this.cameraY = centerY;
      cam.lookAt(0, centerY, 0);
      cam.updateProjectionMatrix();
      this.background?.resize(viewWidth, viewHeight, centerY, extent + 4, h);
      this.bodies.resize(w, h, frameViewHeight);
      // The pair starts turned so they overlap, and swings out to face us.
      const sep = bodyLayout(w, h, frameViewHeight).separation;
      this.splitAngle = Math.PI - Math.atan2(2 * sep * 0.7, 2);
      // The drag angle that puts the moon straight in front of the sun: the
      // pair's separation (2 * sep * 0.7 across, 2 in depth) turned edge-on.
      this.eclipseAngle = this.splitAngle - Math.PI;
    }

    /** Drag: radians to add to the swing (the original uses 0.005 per px). */
    rotate(delta) { this.returning = false; this.dragTarget += delta; }
    resetRotation() { this.returning = true; this.dragTarget = 0; }

    /** Start or pause the automatic orbit. Returns whether it is now orbiting. */
    toggleOrbit() {
      if (!this.continuous) return false;
      this.orbiting = !this.orbiting;
      return this.orbiting;
    }

    /** Back to the authored rest pose: no orbit, no drag. */
    resetOrbit() {
      this.orbiting = false;
      this.orbitAngle = 0;
      this.orbitPace = 0;
      this.dragOffset = 0;
      this.dragRoot.rotation.y = 0;
      this.resetRotation();
    }

    /**
     * Advance to `seconds` since the intro started and composite over the
     * current framebuffer at `opacity`.
     */
    render(seconds, opacity = 1) {
      if (!this.ready) return null;
      const continuous = this.continuous;
      const dt = continuous && this.lastClock !== null
        ? Math.min(Math.max(0, seconds - this.lastClock), 0.05) : 0;
      this.lastClock = seconds;

      const t = warpClock(seconds, continuous);
      const starfield = Math.min(Math.max(t / 0.55, 0), 1);
      const foreground = Math.min(Math.max((t - 0.1) / 0.33, 0), 1);
      const reveal = Math.max(0, t + 0.02);
      const tl = timeline(reveal);

      const drop = this.centeredIntro ? 1.2 * (1 - tl.expansion) : 0;
      this.camera.position.x = tl.camera.x;
      this.camera.position.y = this.cameraY + tl.camera.y - drop;
      const swing = this.splitAngle * tl.bodies.rotation;
      this.splitRoot.rotation.y = swing;
      this.splitRoot.position.set(-0.2 * Math.sin(swing), 0, 0.2 * (1 - Math.cos(swing)));
      const drag = this.dragRoot.rotation;
      this.dragOffset += (this.dragTarget - this.dragOffset)
        * (1 - Math.exp(-(this.returning ? 5.5 : 14) * dt));
      // The orbit carries the pair round; a drag still swings them on top of
      // it and springs back to wherever the orbit has got to.
      this.orbitPace += ((this.orbiting ? 1 : 0) - this.orbitPace)
        * (1 - Math.exp(-(this.orbiting ? ORBIT.START : ORBIT.STOP) * dt));
      const fromEclipse = Math.abs(wrapAngle(this.orbitAngle + this.dragOffset - this.eclipseAngle));
      const pace = MU.lerp(ORBIT.SLOW, 1, MU.smoothstep(fromEclipse, ORBIT.SLOW_NEAR, ORBIT.SLOW_FAR));
      this.orbitAngle += ORBIT.DIRECTION * ORBIT.SPEED * pace * this.orbitPace * dt;
      drag.y = this.orbitAngle + this.dragOffset;

      const dpr = this.size.dpr;
      this.field.update(reveal, tl.expansion, dpr, foreground, t, drag.y, continuous, drop);
      if (this.background) {
        this.background.setDrop(this.cameraY, drop);
        this.background.update(reveal, dpr, drag.y, starfield, t, continuous);
      }
      this.bodies.group.visible = tl.expansion > 0;
      this.bodies.update(continuous ? reveal : 0, tl.bodies, this.camera);
      if (opacity > 0) this.postfx.render(this.scene, this.camera, opacity);
      return tl;
    }

    dispose() {
      this.postfx?.dispose?.();
      for (const o of [...this._owned].reverse()) {
        try { o.dispose(); } catch { /* already gone */ }
      }
      this._owned.clear();
      this.ready = false;
    }
  }

  SolPlayer.timeline = timeline;
  SolPlayer.warpClock = warpClock;
  global.SolPlayer = SolPlayer;
})(window);
