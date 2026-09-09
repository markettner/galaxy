(function (global) {
"use strict";
const THREE = global.THREE;

// Star-field generation.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Per-arm descriptors. These are the fallback used when
// an arm set does not supply its own; window.GALAXY_ARM_SETS normally does.
const ARMS = [
  { depth: 0.62, phase: 0.16, speed: 0.025, strong: true },
  { depth: -0.46, phase: 0.72, speed: -0.018, strong: false },
  { depth: 0.78, phase: 0.38, speed: 0.021, strong: true },
  { depth: -0.7, phase: 0.58, speed: -0.016, strong: false },
  { depth: 0.42, phase: 0.08, speed: 0.03, strong: true },
];

// The star palette and the hero-star seeds picked per arm.
const GALAXY_PALETTE = ['#6DCBF4', '#7AB1FE', '#F87915', '#FA994C', '#F5F6FB'];
const SECONDARY_COLOR_SEEDS = [0.08, 0.58, 0.22, 0.68, 0.44];

// Geometry of the viewBox the default five arms were drawn in. An arm set
// overrides these with its own `scale` / `cx` / `cy`.
const DEFAULT_GEOMETRY = { scale: 9.7 / 325, cx: 114.973, cy: 211.36 };

// Defaults for the hero field.
const DEFAULTS = {
  densityFalloff: 0.22,
  flowInward: true,
  flowSpeed: 0.8,
  intensity: 1.35,
  rotationDepth: 1.4, // `pathDepth`
  scatter: 0.4,
  size: 2.05, // `starSize`
  sizeFalloff: 0.45,
  density: 4, // `starDensity`
  stars: 1, // extra star-budget multiplier on top of the arm set's own
  widthScale: 1, // multiplier on an arm's authored half-width profile
  twinkleSpeed: 0.62,
  showCenterCluster: true,
  backgroundStars: true,
  convergeDuration: 8,
};

// ---------------------------------------------------------------------------
// Helpers: mulberry32 PRNG plus the easing/density curves.
// ---------------------------------------------------------------------------

// `x(t)` — mulberry32.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

const wrap = (t, e) => ((t % e) + e) % e; // `L`
const arch = (t) => Math.sin(THREE.MathUtils.clamp(t, 0, 1) * Math.PI); // `T`

// `F` — pushes samples toward the arm's midsection.
function densityProgress(t, falloff) {
  const r = wrap(t, 1);
  return r + THREE.MathUtils.clamp(falloff, 0, 0.98) * Math.sin(r * Math.PI * 2) / (2 * Math.PI);
}

// `writeStarColor` — bucketed palette lookup.
const paletteColors = GALAXY_PALETTE.map((hex) => new THREE.Color(hex));
function writeStarColor(target, offset, value) {
  const c =
    value < 0.36 ? paletteColors[0]
    : value < 0.52 ? paletteColors[1]
    : value < 0.64 ? paletteColors[2]
    : value < 0.74 ? paletteColors[3]
    : paletteColors[4];
  target[offset] = c.r;
  target[offset + 1] = c.g;
  target[offset + 2] = c.b;
}


// `b` — the same 2D hash the star shader uses for scatter seeds.
function hash2(x, y, a, b) {
  const v = 43758.5453 * Math.sin(x * a + y * b);
  return v - Math.floor(v);
}

// `C` — fades stars out at the two ends of an arm. A closed loop has no ends
// (progress 0 and 1 are the same point), so fading there would cut a gap at the
// seam. Mirrors the uPathLoop branch in the vertex shader.
function tipFade(t, loop = false) {
  if (loop) return 1;
  return THREE.MathUtils.smoothstep(t, 0, 0.055) * (1 - THREE.MathUtils.smoothstep(t, 0.945, 1));
}

// `D` — shrinks stars toward the arm tips.
function sizeFalloff(t, amount) {
  return THREE.MathUtils.lerp(1, 0.14 + 0.86 * arch(t) ** 0.68, THREE.MathUtils.clamp(amount, 0, 1));
}

// `samplePath` — linear interpolation into an RGBA path-sample buffer.
function samplePath(samples, t, target) {
  const n = Math.max(Math.floor(samples.length / 4), 1);
  const f = THREE.MathUtils.clamp(t, 0, 1) * (n - 1);
  const i = Math.floor(f);
  const j = Math.min(i + 1, n - 1);
  const k = f - i;
  const a = 4 * i;
  const b = 4 * j;
  return target.set(
    THREE.MathUtils.lerp(samples[a] ?? 0, samples[b] ?? 0, k),
    THREE.MathUtils.lerp(samples[a + 1] ?? 0, samples[b + 1] ?? 0, k),
    THREE.MathUtils.lerp(samples[a + 2] ?? 0, samples[b + 2] ?? 0, k),
  );
}

// The `.w` channel of the same buffer: the arm's half-width in world units.
// Mirrors `samplePath(progress).w` in the vertex shader.
function samplePathWidth(samples, t) {
  const n = Math.max(Math.floor(samples.length / 4), 1);
  const f = THREE.MathUtils.clamp(t, 0, 1) * (n - 1);
  const i = Math.floor(f);
  const j = Math.min(i + 1, n - 1);
  return THREE.MathUtils.lerp(samples[4 * i + 3] ?? 1, samples[4 * j + 3] ?? 1, f - i);
}

// `applyGalaxyIntroMotion` — the CPU mirror of the shader's galaxyIntroMotion,
// so tracked objects follow the same converge path the stars take.
function applyGalaxyIntroMotion(target, scattered, progress, seed, travelSeed) {
  if (progress >= 1) return;
  const start = 0.14 + 0.18 * seed;
  const pull0 = THREE.MathUtils.smootherstep(progress, start, start + (0.58 + 0.1 * travelSeed));
  const pull = THREE.MathUtils.lerp(pull0, Math.sin(pull0 * Math.PI * 0.5), 0.5);
  const angle = Math.sin(pull * Math.PI) * (0.44 + 0.22 * seed);
  const c = Math.cos(angle);
  const s2 = Math.sin(angle);
  target.set(
    THREE.MathUtils.lerp(scattered.x * c - scattered.y * s2, target.x, pull),
    THREE.MathUtils.lerp(scattered.x * s2 + scattered.y * c, target.y, pull),
    THREE.MathUtils.lerp(scattered.z, target.z, pull),
  );
}

// `getGalaxyParticleRevealProgress`
function particleRevealProgress(progress, seed) {
  const p = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0;
  const delay = 0.015 * (Number.isFinite(seed) ? THREE.MathUtils.clamp(seed, 0, 1) : 0);
  return THREE.MathUtils.smoothstep(p, delay, 0.14 + delay)
    * THREE.MathUtils.lerp(0.2, 1, THREE.MathUtils.smoothstep(p, 0.2, 1));
}

// `particleMotionMass`
function particleMotionMass(t) {
  return THREE.MathUtils.lerp(0.65, 2.4, THREE.MathUtils.smoothstep(t, 1, 14));
}

// `R` — signs the flow so every arm travels toward the core, whichever way its
// SVG path happens to be drawn. Without this the arms drift in both directions.
function flowSign(curve, speed, flowInward, loop = false, flow = 0) {
  // An explicit `flow` means the path was authored pointing the way its stars
  // should travel — the only option when "inward" is not what you want, e.g.
  // three arms circulating counterclockwise about a centre none of them
  // enclose. Positive progress runs t=0 -> t=1.
  if (flow) return Math.abs(speed) * Math.sign(flow);
  // On a closed loop the start and end are the same point, so there is nothing
  // to compare and no "inward": the descriptor's own sign picks the direction
  // of travel around the ring.
  if (loop) return speed;
  const p = new THREE.Vector3();
  const startSq = curve.getPointAt(0, p).lengthSq();
  const endSq = curve.getPointAt(1, p).lengthSq();
  const endsInward = endSq < startSq;
  return Math.abs(speed) * ((flowInward ? endsInward : !endsInward) ? 1 : -1);
}

// ---------------------------------------------------------------------------
// Arm curve: SVG path -> 3D curve (`class v extends THREE.Curve`)
// ---------------------------------------------------------------------------

// An SVGLoader-based build would feed subpaths to THREE.Path. We sample the browser's
// own SVGPathElement instead, which is arc-length parameterised the same way.
// How many points of each path are read off the SVG element up front. Field
// generation then interpolates this table instead of calling back into the DOM.
//
// `getPointAtLength` costs ~70us on the galaxy's arms — they are long chains of
// cubics — and generation wants three samples per star (position plus the two
// that make the tangent) on top of the curve's own arc-length table. That is
// ~34k calls and about 2.4s of blank screen for the six-arm set alone. Sampling
// once and interpolating cuts it to 6k calls.
//
// 1024 samples spans a galaxy arm at roughly 1.6 screen pixels per step, so the
// interpolation error is well under a pixel — and the GPU already walks a
// coarser 512-sample copy of the same path (createPathTexture).
const PATH_SAMPLES = 1024;

const PATH_CACHE = new Map();

/**
 * A sampled path, shared by every consumer of the same `d`. The backdrop walks
 * exactly the paths the field does, so sampling them twice would double the
 * only expensive part of generation. Instances are immutable once built.
 */
function pathSource(d) {
  let src = PATH_CACHE.get(d);
  if (!src) { src = new SvgPathSource(d); PATH_CACHE.set(d, src); }
  return src;
}

class SvgPathSource {
  constructor(d) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('d', d);
    this.total = el.getTotalLength();
    this.samples = new Float64Array(PATH_SAMPLES * 2);
    for (let i = 0; i < PATH_SAMPLES; i += 1) {
      const p = el.getPointAtLength((i / (PATH_SAMPLES - 1)) * this.total);
      this.samples[2 * i] = p.x;
      this.samples[2 * i + 1] = p.y;
    }
  }
  getPointAt(u) {
    const f = THREE.MathUtils.clamp(u, 0, 1) * (PATH_SAMPLES - 1);
    const i = Math.floor(f);
    const j = Math.min(i + 1, PATH_SAMPLES - 1);
    const w = f - i;
    const s = this.samples;
    return {
      x: s[2 * i] + (s[2 * j] - s[2 * i]) * w,
      y: s[2 * i + 1] + (s[2 * j + 1] - s[2 * i + 1]) * w,
    };
  }
}

class GalaxyArmCurve extends THREE.Curve {
  constructor(source, depth, rotationDepth, depthPhase, geometry = DEFAULT_GEOMETRY, loop = false, widths = null) {
    super();
    this.source = source;
    this.depth = depth;
    this.rotationDepth = rotationDepth;
    this.depthPhase = depthPhase;
    this.geometry = geometry;
    this.loop = loop;
    // Half-widths in viewBox units, evenly spaced along the path. Absent for a
    // plain stroked arm, where 1 makes every width scaling a no-op and
    // starAcrossOffset keeps its usual meaning of a world distance.
    this.widths = widths && widths.length > 1 ? widths : null;
    this.widthScale = 1;
    this.arcLengthDivisions = 640;
  }

  /** Half-width in world units at raw curve parameter `t`. */
  getWidthAtT(t) {
    if (!this.widths) return 1;
    const n = this.widths.length;
    const f = THREE.MathUtils.clamp(t, 0, 1) * (n - 1);
    const i = Math.floor(f);
    const j = Math.min(i + 1, n - 1);
    return THREE.MathUtils.lerp(this.widths[i], this.widths[j], f - i)
      * this.geometry.scale * this.widthScale;
  }

  /**
   * Half-width at arc-length fraction `s`. getPointAt(s) reparameterises by arc
   * length before calling getPoint, so the width has to make the same hop or it
   * would be read at the wrong place on the curve.
   */
  getWidthAt(s) {
    if (!this.widths) return 1;
    return this.getWidthAtT(this.getUtoTmapping(THREE.MathUtils.clamp(s, 0, 1)));
  }
  getPoint(t, target = new THREE.Vector3()) {
    const r = THREE.MathUtils.clamp(t, 0, 1);
    const o = this.source.getPointAt(r);
    // An arm bows out of plane and flattens to z=0 at each tip. A loop instead
    // bows over exactly one full period, so z matches on both sides of the
    // seam: half the ring leans toward the camera, half away, which is what
    // gives it a readable tilt when you drag it.
    const s = this.loop
      ? Math.sin(r * Math.PI * 2 + this.depthPhase) * this.depth * this.rotationDepth
      : Math.sin(r * Math.PI * 1.35 + this.depthPhase) * this.depth * this.rotationDepth
        * Math.sin(r * Math.PI);
    const { scale, cx, cy } = this.geometry;
    return target.set((o.x - cx) * scale, (cy - o.y) * scale, s);
  }
}

// ---------------------------------------------------------------------------
// Field generation
// ---------------------------------------------------------------------------

const ATTRS = [
  ['position', 3], ['starAcrossOffset', 1], ['starBrightness', 1], ['starColor', 3],
  ['starDepthOffset', 1], ['starHero', 1], ['starBackground', 1], ['starOpacity', 1],
  ['orbitProgress', 1], ['starScale', 1], ['twinklePhase', 1], ['twinkleRate', 1],
];

function makeBuffers(count) {
  const b = {};
  for (const [name, size] of ATTRS) b[name] = new Float32Array(count * size);
  return b;
}

// One arm's worth of stars.
function generateArm(curve, arm, armIndex, count, backgroundCount, cfg, colorSeed, loop,
                     promoteHero = true) {
  // Background stars are generated by the same loop along the same curve and
  // simply flagged; the shader relocates them to `introScattered`.
  const total = count + backgroundCount;
  const buf = makeBuffers(total);
  const rng = mulberry32(0x243f6a88 ^ ((armIndex + 1) * 0x9e3779b9));
  const colorRng = mulberry32(0xa4093822 ^ ((armIndex + 1) * 0x299f31d0));

  const falloff = THREE.MathUtils.clamp(cfg.densityFalloff, 0, 1);
  // With a width profile, `scatter` is a fraction of the arm's own half-width
  // (1 fills it to the edge) rather than a distance in world units, so it gets
  // the wider range.
  const profiled = Boolean(curve.widths);
  const scatter = profiled
    ? THREE.MathUtils.clamp(cfg.scatter, 0, 1)
    : THREE.MathUtils.clamp(cfg.scatter, 0, 0.45);
  const size = THREE.MathUtils.clamp(cfg.size, 0.25, 3);

  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();

  let bestScale = -Infinity;
  let heroIndex = 0;

  for (let i = 0; i < total; i += 1) {
    const orbit = rng();
    const s = densityProgress(orbit, falloff);
    // `arch` peaks mid-arm and vanishes at both tips, which drives the scatter
    // width and the bright-star chance. On a loop that would pinch and dim the
    // seam, so the ring is weighted evenly the whole way round.
    const l = loop ? 1 : arch(s);

    curve.getPointAt(THREE.MathUtils.clamp(s, 0, 1), P);
    curve.getTangentAt(THREE.MathUtils.clamp(s, 0, 1), T).normalize();
    N.set(-T.y, T.x, 0).normalize();

    // Without a profile the arm is a stroke of roughly even width, tapered by
    // `arch` toward its tips. With one, the profile already carries that taper
    // — and the real, asymmetric version of it — so `arch` must not apply a
    // second time.
    const spread = profiled
      ? scatter * (0.22 + 0.78 * rng())
      : scatter * THREE.MathUtils.lerp(0.3, 1, l) * (0.22 + 0.78 * rng());
    const across = (rng() + rng() - 1) * spread;
    const depth = (rng() + rng() - 1) * spread * 0.65;
    // `across`/`depth` are stored as they are and re-scaled by the shader
    // against the half-width where the star currently is, so they have to be
    // baked into the birth position the same way.
    const halfWidth = profiled ? curve.getWidthAt(THREE.MathUtils.clamp(s, 0, 1)) : 1;
    P.addScaledVector(N, across * halfWidth);
    P.z += depth * halfWidth;

    const brightChance = THREE.MathUtils.lerp(
      (arm.strong ? 0.085 : 0.055) * 0.22,
      arm.strong ? 0.085 : 0.055,
      l,
    );
    const isBright = rng() < brightChance;
    const scale = (isBright ? 0.85 + 1.25 * rng() : 0.12 + rng() ** 2.4 * 0.68) * size;
    const brightness = (isBright ? 2 + 1.5 * rng() : 0.56 + 0.78 * rng()) * (arm.strong ? 1 : 0.82);

    const o3 = i * 3;
    buf.position[o3] = P.x;
    buf.position[o3 + 1] = P.y;
    buf.position[o3 + 2] = P.z;
    buf.starAcrossOffset[i] = across;
    buf.starBrightness[i] = brightness;
    writeStarColor(buf.starColor, o3, colorRng());
    buf.starDepthOffset[i] = depth;
    buf.starOpacity[i] = 0.82 + 0.16 * rng();
    buf.orbitProgress[i] = orbit;
    buf.starScale[i] = scale;
    buf.twinklePhase[i] = rng() * Math.PI * 2;
    buf.twinkleRate[i] = 0.65 + 0.7 * rng();

    if (i >= count) buf.starBackground[i] = 1;
    // Only foreground stars can become the arm's optical source.
    else if (scale > bestScale) {
      bestScale = scale;
      heroIndex = i;
    }
  }

  // Promote the brightest star of the arm to a hero (optical source). The
  // backdrop opts out: it has no foreground star to promote, and a hero there
  // would put a lens flare on a piece of sky.
  if (!promoteHero) {
    buf.heroIndex = undefined;
    return buf;
  }
  const heroScale = (arm.strong ? 2.2 : 2.05) * size;
  buf.starScale[heroIndex] = Math.max(buf.starScale[heroIndex], heroScale);
  buf.starBrightness[heroIndex] = Math.max(buf.starBrightness[heroIndex], arm.strong ? 3.35 : 2.85);
  buf.starHero[heroIndex] = 1;
  writeStarColor(buf.starColor, heroIndex * 3, colorSeed);

  buf.heroIndex = heroIndex;
  return buf;
}

// The galactic core cluster.
function generateCenterCluster(count, cfg) {
  const buf = makeBuffers(count);
  const rng = mulberry32(0xb7e15162);
  const colorRng = mulberry32(0xc0ac29b7);
  const size = THREE.MathUtils.clamp(cfg.size, 0.25, 3);

  let heroIndex = 0;
  let bestEnergy = -Infinity;

  for (let i = 0; i < count; i += 1) {
    const radius = rng() ** 2.4 * 0.42;
    const angle = rng() * Math.PI * 2;
    const o3 = i * 3;
    buf.position[o3] = Math.cos(angle) * radius;
    buf.position[o3 + 1] = Math.sin(angle) * radius * 0.72;
    buf.position[o3 + 2] = (rng() - 0.5) * 0.16;

    const centrality = 1 - radius / 0.42;
    buf.starBrightness[i] = 1.2 + 2.8 * centrality + 0.6 * rng();
    // The innermost stars are forced to the palette's white.
    writeStarColor(buf.starColor, o3, centrality > 0.74 ? 0.99 : colorRng());
    buf.starOpacity[i] = 0.62 + 0.38 * centrality;
    buf.starScale[i] = (0.28 + 1.45 * centrality + 0.45 * rng()) * size * 0.8;

    const energy = buf.starBrightness[i] * buf.starScale[i];
    if (energy > bestEnergy) {
      bestEnergy = energy;
      heroIndex = i;
    }
    buf.twinklePhase[i] = rng() * Math.PI * 2;
    buf.twinkleRate[i] = 0.55 + 0.45 * rng();
  }

  buf.starHero[heroIndex] = 1;
  buf.heroIndex = heroIndex;
  return buf;
}


// The optical source the lens flare tracks for a layer: which star, where it
// sits on the path, and the scatter seeds the shader derives for it.
function flareDescriptor(buf, heroIndex, onPath) {
  const F = Math.fround;
  const orbit = onPath ? (buf.orbitProgress[heroIndex] ?? 0) : 0;
  const twinkle = buf.twinklePhase[heroIndex] ?? 0;
  const scale = buf.starScale[heroIndex] ?? 0;
  const brightness = buf.starBrightness[heroIndex] ?? 0;
  const opacity = buf.starOpacity[heroIndex] ?? 0;
  const rate = buf.twinkleRate[heroIndex] ?? 0;
  const o3 = heroIndex * 3;
  const sx = F(hash2(orbit, twinkle, 127.1, 311.7));
  const sy = F(hash2(twinkle, scale, 269.5, 183.3));
  const sz = F(hash2(orbit, brightness, 419.2, 371.9));
  return {
    flareProgress: orbit,
    flareAcrossOffset: onPath ? (buf.starAcrossOffset[heroIndex] ?? 0) : 0,
    flareDepthOffset: onPath ? (buf.starDepthOffset[heroIndex] ?? 0) : 0,
    flareBasePosition: new THREE.Vector3(
      buf.position[o3], buf.position[o3 + 1], buf.position[o3 + 2],
    ),
    flareScatter: new THREE.Vector3(sx, sy, sz),
    flareClearanceSeed: F(hash2(opacity, rate, 157.3, 283.9)),
    flareShapeSeed: F(wrap(orbit * 0.754877666 + twinkle * 0.159154943 + scale * 0.117, 1)),
    flareShapeAcrossScatter: F((sx + sy - 1) * 0.12),
    flareShapeDepthScatter: F((sz - 0.5) * 0.22),
  };
}

function toGeometry(buf) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, size] of ATTRS) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(buf[name], size));
  }
  // Declared by the shader's pointer-interaction path.
  const n = buf.starScale.length;
  geometry.setAttribute('particleMotionUv', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 24);
  return geometry;
}

// 512 samples of the arm curve, as the RGBA float texture the shader walks
// when uPathMotion is on.
function createPathTexture(curve) {
  const samples = new Float32Array(2048);
  const p = new THREE.Vector3();
  for (let i = 0; i < 512; i += 1) {
    curve.getPointAt(i / 511, p);
    const o = 4 * i;
    samples[o] = p.x;
    samples[o + 1] = p.y;
    samples[o + 2] = p.z;
    // Alpha was unused by the earlier shader (it wrote a constant 1). It now
    // carries the arm's half-width in world units; 1 where there is no profile.
    samples[o + 3] = curve.getWidthAt ? curve.getWidthAt(i / 511) : 1;
  }
  const texture = new THREE.DataTexture(samples, 512, 1, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return { samples, texture };
}

/**
 * Build the field as separate per-arm layers plus the core cluster, mirroring
 * the scene graph. Each arm is its own Points object in its own
 * group so it can lag behind the pointer independently.
 *
 * `armSet` is an entry of window.GALAXY_ARM_SETS: `paths` plus the viewBox
 * geometry they were drawn in and a descriptor per arm. A bare array of path
 * strings is still accepted and falls back to the default five descriptors.
 */
/**
 * Everything both the field and the backdrop need out of an arm set, read once
 * so the two cannot disagree about star budgets or geometry.
 */
function readArmSet(armSet, cfg) {
  const set = Array.isArray(armSet) ? { paths: armSet } : armSet;
  const descriptors = set.arms ?? ARMS;
  const density = THREE.MathUtils.clamp(cfg.density, 0.25, 4);
  // Per-set star budget. Arms that cover more of the frame need proportionally
  // more stars to read at the same thickness — see `stars` in the set.
  const starScale = Math.max(0.1, set.stars ?? 1) * Math.max(0.1, cfg.stars ?? 1);
  return {
    set,
    loop: set.loop === true,
    flow: set.flow ?? 0,
    descriptors,
    // A set either lists its paths centrally, or hangs each one off its own
    // descriptor alongside that arm's width profile.
    paths: set.paths ?? descriptors.map((a) => a && a.path).filter(Boolean),
    geometry: {
      scale: set.scale ?? DEFAULT_GEOMETRY.scale,
      cx: set.cx ?? DEFAULT_GEOMETRY.cx,
      cy: set.cy ?? DEFAULT_GEOMETRY.cy,
    },
    density,
    armStars: (arm) => Math.max(8, Math.round((arm.strong ? 220 : 170) * density * starScale)),
    // converge-tilt reserves ~12% extra particles per arm as background stars.
    backgroundStars: (stars) => Math.ceil((0.12 * stars) / 0.88),
    armCurve: (d, arm, index) => {
      const curve = new GalaxyArmCurve(
        pathSource(d),
        arm.depth,
        THREE.MathUtils.clamp(cfg.rotationDepth, 0, 2),
        arm.depthPhase ?? 0.82 * index,
        {
          scale: set.scale ?? DEFAULT_GEOMETRY.scale,
          cx: set.cx ?? DEFAULT_GEOMETRY.cx,
          cy: set.cy ?? DEFAULT_GEOMETRY.cy,
        },
        set.loop === true,
        arm.widths ?? null,
      );
      curve.widthScale = Math.max(0.01, cfg.widthScale ?? 1);
      return curve;
    },
  };
}

function generateGalaxyField(armSet, cfg = DEFAULTS) {
  const A = readArmSet(armSet, cfg);
  const { loop, flow, descriptors, paths } = A;
  const density = A.density;
  const layers = [];
  let count = 0;

  paths.forEach((d, index) => {
    // Wrap rather than drop, so a set with more paths than descriptors still
    // renders every arm.
    const arm = descriptors[index] ?? descriptors[index % descriptors.length];
    if (!arm) return;
    const stars = A.armStars(arm);
    const backgroundCount = cfg.backgroundStars ? A.backgroundStars(stars) : 0;
    const curve = A.armCurve(d, arm, index);
    const colorSeed = arm.colorSeed ?? SECONDARY_COLOR_SEEDS[index] ?? 0.08;
    const buf = generateArm(curve, arm, index, stars, backgroundCount, cfg, colorSeed, loop);
    const { samples, texture } = createPathTexture(curve);
    // Flow direction comes from the curve, not the raw sign on the descriptor.
    const speed = flowSign(curve, arm.speed, cfg.flowInward, loop, arm.flow ?? flow);
    count += buf.starScale.length;
    layers.push({
      arm,
      index,
      curve,
      geometry: toGeometry(buf),
      heroIndex: buf.heroIndex,
      pathSamples: samples,
      pathTexture: texture,
      speed,
      outwardSpeed: flowSign(curve, arm.speed, false, loop, arm.flow ?? flow),
      phase: arm.phase,
      strong: arm.strong,
      isCore: false,
      loop,
      ...flareDescriptor(buf, buf.heroIndex, true),
      // Per-layer pointer lag.
      lag: arm.lag ?? 0.18 + 0.17 * index,
    });
  });

  let core = null;
  if (cfg.showCenterCluster) {
    const buf = generateCenterCluster(Math.max(18, Math.round(24 * density)), cfg);
    count += buf.starScale.length;
    core = {
      arm: { strong: true, speed: 0.022, depth: 0, phase: 0 },
      index: layers.length,
      geometry: toGeometry(buf),
      heroIndex: buf.heroIndex,
      pathSamples: null,
      pathTexture: null,
      speed: 0.022,
      outwardSpeed: 0.022,
      phase: 0,
      strong: true,
      isCore: true,
      loop: false,
      lag: 0,
      ...flareDescriptor(buf, buf.heroIndex, false),
    };
  }

  return { layers, core, count };
}

/**
 * The shared star backdrop.
 *
 * Background stars never touch the arm they were generated along: the vertex
 * shader replaces their position with `introScattered` outright, and hands
 * galaxyIntroMotion a progress of 1 so nothing pulls them back in. Their final
 * position is a function of their own seeds and uScatterSize alone — a backdrop
 * is a scattered starfield, and the curve is only the RNG stream that produced
 * it.
 *
 * So this generates one, through the ordinary arm generator with the entire
 * budget flagged as background. Every distribution — scale, brightness, colour,
 * twinkle, opacity — is therefore exactly the one the arms use, and the count
 * matches what `armSet` would have carried as its own background stars.
 *
 * Merged into a single geometry, because unlike the arms it never needs to be
 * spun, lagged or flared per path.
 */
function generateBackdrop(armSet, cfg = DEFAULTS) {
  const A = readArmSet(armSet, cfg);
  const bufs = [];
  let total = 0;

  A.paths.forEach((d, index) => {
    const arm = A.descriptors[index] ?? A.descriptors[index % A.descriptors.length];
    if (!arm) return;
    const count = A.backgroundStars(A.armStars(arm));
    const buf = generateArm(
      A.armCurve(d, arm, index), arm, index, 0, count, cfg, 0, A.loop, false,
    );
    bufs.push(buf);
    total += buf.starScale.length;
  });

  const merged = makeBuffers(total);
  let offset = 0;
  for (const buf of bufs) {
    for (const [name, size] of ATTRS) merged[name].set(buf[name], offset * size);
    offset += buf.starScale.length;
  }
  return { geometry: toGeometry(merged), count: total };
}

global.GalaxyField = {
  generateGalaxyField, generateBackdrop, GalaxyArmCurve, mulberry32, createPathTexture,
  samplePath, samplePathWidth, applyGalaxyIntroMotion, particleRevealProgress, particleMotionMass,
  tipFade, sizeFalloff, densityProgress, flowSign,
  ARMS, GALAXY_PALETTE, SECONDARY_COLOR_SEEDS, DEFAULTS,
};
})(window);
