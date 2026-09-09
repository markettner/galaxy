// Path data for every shape the page can show, consumed by GalaxyField.
//
// One registry, keyed by shape. `?arms=<key>` picks the shape the page opens
// on; scrolling walks the ring defined by ORDER in main.js. Each set carries
// the geometry its paths were drawn in, because the viewBoxes and centres all
// differ:
//
//   scale  — world units the viewBox height maps to. 9.7 is the value the
//            reference value, and the camera framing (scatterHeight 10.9)
//            is tuned around it, so every set stays close to it.
//   cx,cy  — the point that lands on the world origin, i.e. screen centre.
//   config — per-set overrides layered over field.js DEFAULTS. A set that is
//            not a spiral turns off the envelopes that assume one.
//   loop   — the path is closed (delta); suppresses tip fade and taper.
//   flow   — the paths are authored pointing the way stars should travel
//            (beyond), rather than letting flowSign infer "inward".
//
// Per-arm descriptors:
//   depth      z amplitude of the out-of-plane bow (sign flips the bow)
//   phase      starting offset of the arm's flow along its own path
//   depthPhase phase of the z bow; different values de-synchronise the arms
//   speed      flow rate; sign is recomputed from the curve by flowSign()
//   strong     brighter arm, ~30% more stars, larger hero star
//   lag        how far this arm trails the pointer rotation
//   colorSeed  palette lookup for the arm's hero star (the flare source)
//   widths     optional half-width profile in viewBox units (beyond only)

window.GALAXY_ARM_SETS = {

  // Spiral-arm path data, authored as SVG and consumed by GalaxyField.
  //
  // Two sets are available; `?arms=<key>` on the URL picks one (default: six).
  // Each set carries the geometry its paths were drawn in, because the two
  // viewBoxes and galactic centres differ:
  //
  //   scale  — world units the viewBox height maps to. 9.7 is the value the
  //            reference value, and the camera framing (scatterHeight
  //            10.9) is tuned around it, so both sets keep it.
  //   cx,cy  — the galactic nucleus in viewBox coordinates. This lands at the
  //            world origin, where the core cluster sits, so it must be the
  //            centre of the spiral rather than the centre of the bounding box.
  //
  // Per-arm descriptors:
  //   depth      z amplitude of the out-of-plane bow (sign flips the bow)
  //   phase      starting offset of the arm's flow along its own path
  //   depthPhase phase of the z bow; different values de-synchronise the arms
  //   speed      flow rate; sign is recomputed from the curve by flowSign()
  //   strong     brighter arm, ~30% more stars, larger hero star
  //   lag        how far this arm trails the pointer rotation
  //   colorSeed  palette lookup for the arm's hero star (the flare source)


  // ---------------------------------------------------------------------------
  // Six-arm symmetric galaxy — galaxy_arms_new.svg, viewBox 0 0 970 970.
  //
  // Three arm shapes, each drawn twice at 180 degrees, so arms 0/3, 1/4 and 2/5
  // are point-mirrored pairs about (485, 483.8). The descriptors are paired the
  // same way — both members of a pair share depth, depthPhase, lag and colour —
  // so the 3D bow and the pointer parallax stay symmetric too. Break a pair's
  // values apart if you want the symmetry loosened.
  // ---------------------------------------------------------------------------
  galaxy: {
    label: 'six-arm symmetric',
    scale: 9.7 / 970,
    cx: 485.0,
    cy: 483.8,
    // These arms cover ~1.9x as much curve length as the "6" does at the same
    // on-screen size, and the star budget is per-arm rather than per-length, so
    // without this multiplier each arm reads noticeably thinner than the
    // baseline. 1.6 restores the baseline stars-per-unit-of-arm. `?stars=n`
    // scales this again at runtime, so ?stars=0.625 lands back on the plain
    // per-arm budget the legacy set uses.
    stars: 1.6,
    paths: [
      "M514.98,482.982c-7.642,30.555 -39.167,90.834 -104.167,87.5c-51.177,-2.625 -105.894,-68.183 -104.169,-168.75c0,-125 100.003,-220.833 233.336,-220.833c164.583,0 337.5,118.754 337.5,368.754c-0,187.5 -179.167,404.167 -531.251,356.25",
      "M578.51,517.61c0,268.419 -405.454,250.212 -405.454,-97.942c0,-184.164 107.146,-314.049 377.202,-319.254c168.719,-3.251 397.917,141.378 397.917,455.961c-0,258.333 -247.917,404.167 -443.75,404.167c-283.335,-0 -460.418,-239.584 -495.835,-475",
      "M484.697,483.371c0,60.417 -93.751,64.584 -93.751,-25c-0,-89.583 72.772,-125 147.918,-125c75.146,0 193.75,85.417 193.75,231.25c-0,139.584 -108.333,212.5 -168.75,235.417c-60.417,22.917 -217.918,38.333 -331.251,-75",
      "M455.934,483.46c7.642,-30.555 39.167,-90.834 104.167,-87.5c51.177,2.625 105.894,68.183 104.169,168.75c0,125 -100.002,220.833 -233.336,220.833c-164.583,-0 -337.5,-118.754 -337.5,-368.754c0,-187.5 179.167,-404.167 531.251,-356.25",
      "M391.09,451.522c-0,-268.419 405.454,-250.212 405.454,97.941c0,184.164 -107.146,314.05 -377.202,319.254c-168.718,3.252 -397.916,-141.377 -397.916,-455.961c-0,-258.333 247.916,-404.166 443.75,-404.166c283.334,-0 460.418,239.583 495.834,475",
      "M484.957,483.461c-0,-60.416 93.751,-64.583 93.751,25c-0,89.584 -72.772,125 -147.918,125c-75.146,0 -193.75,-85.416 -193.75,-231.25c-0,-139.583 108.333,-212.5 168.75,-235.416c60.417,-22.917 217.918,-38.334 331.251,75",
    ],
    arms: [
      // pair A — the mid-length sweep
      { depth: 0.62, phase: 0.16, depthPhase: 0.0, speed: 0.025, strong: true, lag: 0.18, colorSeed: 0.08 },
      // pair B — the long outer arm
      { depth: -0.70, phase: 0.72, depthPhase: 0.82, speed: 0.018, strong: false, lag: 0.35, colorSeed: 0.58 },
      // pair C — the short inner hook
      { depth: 0.42, phase: 0.38, depthPhase: 1.64, speed: 0.030, strong: true, lag: 0.52, colorSeed: 0.44 },
      // pair A mirrored
      { depth: 0.62, phase: 0.66, depthPhase: 0.0, speed: 0.025, strong: true, lag: 0.18, colorSeed: 0.08 },
      // pair B mirrored
      { depth: -0.70, phase: 0.22, depthPhase: 0.82, speed: 0.018, strong: false, lag: 0.35, colorSeed: 0.58 },
      // pair C mirrored
      { depth: 0.42, phase: 0.88, depthPhase: 1.64, speed: 0.030, strong: true, lag: 0.52, colorSeed: 0.44 },
    ],
  },

  // ---------------------------------------------------------------------------
  // The legacy five arms, which together draw a stylised "6".
  // viewBox 0 0 231 325.
  // ---------------------------------------------------------------------------
  legacy: {
    label: 'stylised "6"',
    scale: 9.7 / 325,
    cx: 114.973,
    cy: 211.36,
    paths: [
      "M128.472 2.36011C65.4727 24.3601 10.7725 93.1601 9.97246 162.36C8.97246 248.86 79.4138 262.86 87.9725 262.86C116.973 262.86 135.973 244.36 135.973 221.36C135.973 189.86 102.973 193.86 102.973 209.36",
      "M224.973 31.8602C132.473 3.86011 29.9727 75.8601 29.9727 159.86C29.9727 247.86 98.4726 259.86 126.473 247.86",
      "M126.473 215.359C124.639 222.692 117.073 237.159 101.473 236.359C89.1905 235.729 76.0585 219.995 76.4724 195.859C76.4724 165.859 100.473 142.859 132.473 142.859C171.973 142.859 213.473 171.36 213.473 231.36C213.473 276.36 170.473 328.36 85.9727 316.86",
      "M106.973 237.36C81.9727 240.36 61.4727 222.86 61.4727 184.86C61.4727 153.36 91.9727 123.36 132.473 123.36C172.973 123.36 227.973 149.86 227.973 225.36C227.973 287.36 168.473 322.36 121.473 322.36C53.4727 322.36 10.9727 264.86 2.47266 208.36",
      "M114.973 211.36C114.973 225.86 92.4727 226.86 92.4727 205.36C92.4727 183.86 109.938 175.36 127.973 175.36C146.008 175.36 174.473 195.86 174.473 230.86C174.473 264.36 148.473 281.86 133.973 287.36C119.473 292.86 81.6727 296.56 54.4727 269.36",
    ],
    arms: [
      { depth: 0.62, phase: 0.16, depthPhase: 0.00, speed: 0.025, strong: true, lag: 0.18, colorSeed: 0.08 },
      { depth: -0.46, phase: 0.72, depthPhase: 0.82, speed: -0.018, strong: false, lag: 0.35, colorSeed: 0.58 },
      { depth: 0.78, phase: 0.38, depthPhase: 1.64, speed: 0.021, strong: true, lag: 0.52, colorSeed: 0.22 },
      { depth: -0.70, phase: 0.58, depthPhase: 2.46, speed: -0.016, strong: false, lag: 0.69, colorSeed: 0.68 },
      { depth: 0.42, phase: 0.08, depthPhase: 3.28, speed: 0.030, strong: true, lag: 0.86, colorSeed: 0.44 },
    ],
  },

  // Path data for the delta outline, consumed by GalaxyField.
  //
  // One closed path — the outline of `delta_round.svg` — carrying a single loop
  // of stars. The source SVG wraps its path in a `translate(2.74356, 1.51912)`
  // group; that transform is baked into the coordinates here, so the `d` below
  // is the shape as it actually sits in the `0 0 60 92` viewBox. It starts and
  // ends at exactly the same point (2.7436, 89.8111), the bottom-left tip.
  //
  // Set geometry:
  //   scale  — world units the viewBox height maps to. 9.7 matches what the
  //            camera framing (scatterHeight 10.9) is tuned around.
  //   cx,cy  — the point that lands on the world origin, i.e. screen centre.
  //            The bounding-box centre, not the area centroid: the notch at the
  //            base pulls the centroid down and left of where the shape reads as
  //            centred.
  //   loop   — closed path. Suppresses everything the field does to an arm's two
  //            ends, since a loop has none: the tip fade, the size taper, and the
  //            midsection density bunching would all show up as a seam at the
  //            start/end point. See `loop` handling in field.js and main.js.
  //
  // Per-arm descriptors are as in the galaxy build; on a loop `depth` bows the
  // ring on a full period so it stays continuous across the seam, and `speed`
  // keeps its sign (a closed path gives flowSign nothing to infer from).


  delta: {
    label: 'delta outline',
    scale: 8.9 / 92,
    cx: 29.634,
    cy: 45.580,
    loop: true,
    // The outline is 273.96 viewBox units around, i.e. 28.9 world units. The
    // star budget is per-arm, so this multiplier brings a single loop up to the
    // same stars-per-unit-of-path the galaxy arms carry. `?stars=n` scales it.
    stars: 1.85,
    // Layered over the DEFAULTS in main.js. The first three all
    // assume a path has two ends:
    //   densityFalloff  bunches stars toward the middle of an arm — on a ring
    //                   that is just an arbitrary dense side
    //   sizeFalloff     shrinks stars to 14% at each tip, i.e. at the seam
    //   showCenterCluster  a galactic nucleus makes no sense inside an outline
    // `scatter` is tightened from the galaxy's 0.4 because the loop has to read
    // as a drawn edge, not a cloud — with no `arch` taper the full width would
    // otherwise apply the whole way round.
    config: {
      densityFalloff: 0,
      sizeFalloff: 0,
      showCenterCluster: false,
      scatter: 0.24,
    },
    paths: [
      "M2.7436,89.8111C1.0106,91.9601 -0.2114,91.4981 0.0306,88.7471C4.2836,40.2311 20.1436,11.6751 26.7366,1.6751C28.2566,-0.6299 30.8876,-0.5349 32.3146,1.8291C38.8496,12.6451 55.3686,43.1741 59.2126,81.0001C59.4916,83.7481 58.7016,83.9491 57.4656,81.4801C53.3886,73.3331 44.4906,56.9811 38.7646,56.9811C30.0946,56.9811 10.3816,80.3391 2.7436,89.8111",
    ],
    arms: [
      // `speed` is a *progress* rate — laps per second before flowSpeed — not a
      // linear one, so the same number moves stars faster the longer the path.
      // This loop is 26.8 world units around, against 5.4-7.8 for a beyond arm,
      // which is why the 0.022 they share had the delta's stars crossing the
      // screen 3-5x faster. 0.006 puts it at 0.13 world units/sec, inside
      // beyond's 0.086-0.148 range, so the two builds flow at the same pace.
      //
      // Negative because the path is drawn clockwise — up the left edge, over
      // the apex, down the right — and the flow should run counterclockwise.
      // On a closed loop flowSign has no "inward" to infer from, so this sign
      // is what picks the direction.
      { depth: 0.62, phase: 0, depthPhase: 0, speed: -0.006, strong: true, lag: 0.18, colorSeed: 0.08 },
    ],
  },

  // Path data for the "beyond" delta, consumed by GalaxyField.
  //
  // Three arms, one per crescent in `delta_beyond.svg`. The source draws each
  // crescent as a closed *filled* shape — two cubics running between the same
  // two needle tips, an outer edge and an inner edge — rather than as a stroke.
  // Both are recovered here:
  //
  //   path    the centreline, as a 110-point polyline. Built by walking the two
  //           boundary curves in step by arc length and taking the midpoint of
  //           each pair. Emitted in the direction the arm flows, so t=0 is where
  //           stars enter and t=1 is where they leave.
  //   widths  half the distance between those same two boundary points, at the
  //           matching positions along the centreline, in viewBox units. This is
  //           the arm's real cross-section: zero at both needle tips, widest a
  //           little past the middle. field.js scales it to world units and bakes
  //           it into the path texture's unused alpha channel; the vertex shader
  //           multiplies each star's across-offset by it, so stars stay inside
  //           the shape as they travel instead of sliding out through the tips.
  //
  // Flow direction is counterclockwise about the centre of the mark, matching the
  // reference: the right crescent runs up toward the apex, the bottom one runs up
  // and right, the left one runs down and left. `flowSign` cannot infer that — it
  // only knows which end of a path sits nearer the origin — so the paths are
  // authored pointing the right way and `flow: 1` tells field.js to trust them.
  //
  // Geometry (`scale`, `cx`, `cy`) as in the other builds: world units per
  // viewBox height, and the point that lands on screen centre.


  beyond: {
    label: 'delta beyond',
    scale: 9.2 / 100,
    cx: 30.019,
    cy: 49.823,
    flow: 1,
    // The three centrelines total 214 viewBox units, i.e. 19.7 world units, and
    // the star budget is per-arm. `?stars=n` scales this at runtime.
    stars: 1.4,
    config: {
      // No nucleus — this mark is three strokes, nothing in the middle.
      showCenterCluster: false,
      // `scatter` is a fraction of the local half-width here, not a world
      // distance: 1 fills the crescent right out to its edge.
      scatter: 1,
      // An honest exaggeration, and the only number here not measured from the
      // file. At the SVG's true proportions — roughly 22:1, long to wide — a
      // crescent is thinner than one star's glow is wide, so the whole width
      // profile collapses into a uniform needle; compare `?width=1`. What sets
      // that floor is the *ratio* of star size to arm width, so the fix is to
      // widen the arm rather than shrink the stars. 2.6 is where several stars
      // fit across the belly and the silhouette reads as the authored shape —
      // pointed tips, belly past the middle, slight curve. `?width=n` sweeps it.
      widthScale: 2.6,
      // `size` is deliberately NOT overridden: the arms keep the 2.05 the
      // galaxy and delta builds use, so stars read the same across all three.
    },
    arms: [
      {
        // Arm 0 — the right crescent; flows up toward the apex.
        // Half-width peaks at 1.792 viewBox units near the middle
        // and reaches 0 at both tips, which is where the shape comes to a point.
        depth: 0.62, phase: 0.16, depthPhase: 0.0,
        speed: 0.024, strong: true, lag: 0.18, colorSeed: 0.08,
        path: "M60.038,74.591L59.866,73.877L59.693,73.164L59.519,72.45L59.343,71.737L59.167,71.025L58.989,70.312L58.81,69.6L58.63,68.888L58.449,68.177L58.266,67.465L58.083,66.755L57.898,66.044L57.712,65.334L57.524,64.624L57.335,63.914L57.145,63.205L56.954,62.496L56.761,61.788L56.568,61.079L56.372,60.372L56.176,59.664L55.978,58.957L55.779,58.25L55.579,57.544L55.377,56.838L55.174,56.132L54.969,55.427L54.763,54.722L54.556,54.018L54.347,53.314L54.137,52.61L53.926,51.907L53.713,51.205L53.498,50.502L53.283,49.8L53.065,49.099L52.847,48.398L52.626,47.698L52.405,46.998L52.182,46.298L51.957,45.599L51.731,44.901L51.503,44.203L51.274,43.505L51.043,42.808L50.81,42.112L50.576,41.416L50.34,40.72L50.103,40.025L49.864,39.331L49.624,38.637L49.381,37.944L49.137,37.252L48.892,36.56L48.644,35.868L48.395,35.178L48.145,34.488L47.892,33.798L47.638,33.109L47.382,32.421L47.124,31.734L46.864,31.047L46.602,30.361L46.339,29.676L46.073,28.991L45.806,28.307L45.537,27.624L45.266,26.942L44.992,26.26L44.717,25.579L44.44,24.9L44.161,24.221L43.879,23.542L43.596,22.865L43.31,22.189L43.022,21.513L42.732,20.839L42.44,20.165L42.146,19.492L41.849,18.821L41.55,18.15L41.248,17.481L40.945,16.812L40.638,16.145L40.329,15.479L40.018,14.814L39.704,14.15L39.387,13.488L39.068,12.826L38.746,12.167L38.421,11.508L38.093,10.851L37.762,10.196L37.428,9.542L37.091,8.889L36.751,8.239L36.407,7.59L36.06,6.943L35.709,6.298L35.355,5.655L34.997,5.014L34.634,4.376L34.267,3.74L33.895,3.107L33.518,2.476L33.135,1.85L32.746,1.227L32.349,0.61L31.94,0",
        widths: [
          0, 0.053, 0.106, 0.157, 0.209, 0.259, 0.309, 0.358, 0.406, 0.454, 0.501, 0.547,
          0.593, 0.637, 0.681, 0.725, 0.767, 0.809, 0.85, 0.89, 0.93, 0.969, 1.007, 1.044,
          1.08, 1.116, 1.15, 1.184, 1.217, 1.25, 1.281, 1.312, 1.341, 1.37, 1.398, 1.425,
          1.451, 1.477, 1.501, 1.525, 1.547, 1.569, 1.59, 1.609, 1.628, 1.646, 1.663, 1.679,
          1.694, 1.708, 1.72, 1.732, 1.743, 1.753, 1.761, 1.769, 1.776, 1.781, 1.785, 1.789,
          1.791, 1.792, 1.791, 1.79, 1.787, 1.784, 1.779, 1.772, 1.765, 1.756, 1.746, 1.734,
          1.722, 1.708, 1.692, 1.675, 1.657, 1.638, 1.616, 1.594, 1.57, 1.544, 1.517, 1.488,
          1.458, 1.426, 1.392, 1.357, 1.32, 1.281, 1.24, 1.197, 1.152, 1.106, 1.057, 1.006,
          0.953, 0.898, 0.84, 0.78, 0.718, 0.652, 0.584, 0.513, 0.439, 0.361, 0.279, 0.192,
          0.1, 0,
        ],
      },
      {
        // Arm 1 — the bottom crescent; flows up and to the right, back toward the middle.
        // Half-width peaks at 2.241 viewBox units near the middle
        // and reaches 0 at both tips, which is where the shape comes to a point.
        depth: -0.46, phase: 0.72, depthPhase: 0.82,
        speed: 0.020, strong: false, lag: 0.35, colorSeed: 0.58,
        path: "M0,99.645L0.245,99.202L0.493,98.76L0.742,98.319L0.992,97.879L1.244,97.44L1.498,97.001L1.754,96.564L2.011,96.128L2.27,95.693L2.531,95.258L2.793,94.825L3.057,94.393L3.323,93.962L3.591,93.532L3.861,93.103L4.132,92.676L4.405,92.249L4.68,91.824L4.957,91.4L5.236,90.977L5.516,90.555L5.799,90.135L6.083,89.716L6.37,89.298L6.658,88.882L6.948,88.467L7.24,88.053L7.534,87.641L7.831,87.23L8.129,86.82L8.429,86.413L8.731,86.006L9.036,85.601L9.342,85.198L9.65,84.796L9.961,84.396L10.274,83.998L10.589,83.601L10.906,83.206L11.225,82.813L11.546,82.421L11.87,82.032L12.195,81.644L12.523,81.258L12.854,80.874L13.186,80.492L13.521,80.112L13.858,79.734L14.197,79.358L14.539,78.984L14.883,78.612L15.229,78.243L15.578,77.875L15.929,77.51L16.282,77.147L16.638,76.787L16.996,76.429L17.357,76.074L17.72,75.721L18.086,75.37L18.454,75.022L18.825,74.677L19.198,74.334L19.573,73.994L19.951,73.657L20.332,73.323L20.715,72.992L21.1,72.663L21.488,72.338L21.879,72.016L22.272,71.697L22.668,71.381L23.067,71.068L23.468,70.759L23.871,70.453L24.277,70.15L24.686,69.851L25.098,69.556L25.511,69.264L25.928,68.976L26.347,68.691L26.769,68.411L27.193,68.134L27.62,67.862L28.05,67.594L28.482,67.33L28.917,67.07L29.354,66.814L29.794,66.563L30.237,66.317L30.682,66.076L31.129,65.839L31.58,65.607L32.032,65.38L32.488,65.158L32.946,64.942L33.406,64.731L33.869,64.526L34.335,64.327L34.803,64.134L35.274,63.947L35.748,63.767L36.224,63.594L36.702,63.429L37.184,63.271L37.668,63.123L38.155,62.984L38.645,62.857L39.14,62.748",
        widths: [
          0, 0.061, 0.121, 0.181, 0.241, 0.299, 0.357, 0.415, 0.472, 0.528, 0.584, 0.639,
          0.694, 0.747, 0.801, 0.853, 0.905, 0.956, 1.006, 1.056, 1.104, 1.152, 1.2, 1.246,
          1.292, 1.336, 1.38, 1.423, 1.466, 1.507, 1.547, 1.587, 1.625, 1.663, 1.699, 1.735,
          1.769, 1.803, 1.835, 1.867, 1.897, 1.926, 1.954, 1.981, 2.006, 2.031, 2.054, 2.076,
          2.097, 2.116, 2.134, 2.151, 2.166, 2.181, 2.193, 2.204, 2.214, 2.222, 2.229, 2.235,
          2.238, 2.24, 2.241, 2.24, 2.237, 2.233, 2.227, 2.219, 2.21, 2.198, 2.185, 2.17,
          2.154, 2.135, 2.115, 2.092, 2.068, 2.041, 2.013, 1.983, 1.95, 1.916, 1.879, 1.841,
          1.8, 1.757, 1.712, 1.664, 1.615, 1.563, 1.509, 1.452, 1.394, 1.333, 1.269, 1.203,
          1.135, 1.064, 0.991, 0.915, 0.836, 0.755, 0.672, 0.585, 0.496, 0.404, 0.308, 0.21,
          0.107, 0,
        ],
      },
      {
        // Arm 2 — the left crescent; flows down and to the left.
        // Half-width peaks at 1.906 viewBox units near the middle
        // and reaches 0 at both tips, which is where the shape comes to a point.
        depth: 0.78, phase: 0.38, depthPhase: 1.64,
        speed: 0.022, strong: true, lag: 0.52, colorSeed: 0.44,
        path: "M22.874,14.539L22.576,15.202L22.283,15.867L21.994,16.534L21.707,17.203L21.424,17.872L21.143,18.542L20.864,19.214L20.587,19.886L20.312,20.559L20.04,21.233L19.769,21.908L19.5,22.583L19.233,23.259L18.968,23.936L18.704,24.613L18.442,25.291L18.182,25.97L17.923,26.65L17.666,27.33L17.411,28.01L17.157,28.691L16.904,29.373L16.654,30.055L16.404,30.738L16.157,31.422L15.91,32.106L15.666,32.79L15.422,33.475L15.181,34.161L14.94,34.847L14.701,35.534L14.464,36.221L14.228,36.908L13.993,37.596L13.76,38.285L13.529,38.974L13.298,39.663L13.069,40.353L12.842,41.044L12.616,41.735L12.391,42.426L12.168,43.118L11.946,43.81L11.726,44.503L11.506,45.196L11.289,45.89L11.072,46.584L10.857,47.278L10.644,47.973L10.432,48.668L10.221,49.364L10.012,50.06L9.803,50.757L9.597,51.454L9.392,52.151L9.188,52.849L8.985,53.547L8.784,54.246L8.584,54.945L8.386,55.644L8.189,56.344L7.993,57.044L7.799,57.744L7.606,58.445L7.415,59.147L7.225,59.848L7.036,60.55L6.849,61.253L6.663,61.955L6.478,62.659L6.295,63.362L6.113,64.066L5.933,64.77L5.754,65.475L5.576,66.18L5.4,66.885L5.225,67.591L5.052,68.297L4.88,69.003L4.709,69.71L4.54,70.417L4.372,71.124L4.206,71.832L4.041,72.539L3.877,73.248L3.715,73.956L3.554,74.665L3.395,75.375L3.237,76.084L3.081,76.794L2.926,77.504L2.772,78.215L2.62,78.926L2.469,79.637L2.32,80.348L2.172,81.06L2.025,81.772L1.88,82.485L1.737,83.197L1.595,83.91L1.454,84.623L1.315,85.337L1.177,86.051L1.041,86.765L0.906,87.479L0.772,88.194L0.64,88.908L0.51,89.624L0.381,90.339",
        widths: [
          0, 0.083, 0.162, 0.237, 0.31, 0.379, 0.447, 0.513, 0.576, 0.638, 0.698, 0.756,
          0.812, 0.866, 0.919, 0.971, 1.021, 1.069, 1.116, 1.161, 1.205, 1.247, 1.288, 1.328,
          1.366, 1.403, 1.439, 1.473, 1.505, 1.537, 1.567, 1.596, 1.623, 1.649, 1.674, 1.698,
          1.72, 1.741, 1.761, 1.779, 1.797, 1.812, 1.827, 1.841, 1.853, 1.864, 1.873, 1.882,
          1.889, 1.895, 1.9, 1.903, 1.905, 1.906, 1.906, 1.905, 1.902, 1.898, 1.893, 1.887,
          1.879, 1.87, 1.86, 1.849, 1.836, 1.823, 1.808, 1.792, 1.774, 1.756, 1.736, 1.715,
          1.692, 1.669, 1.644, 1.618, 1.591, 1.563, 1.533, 1.502, 1.47, 1.437, 1.402, 1.366,
          1.329, 1.291, 1.252, 1.211, 1.169, 1.126, 1.081, 1.036, 0.989, 0.94, 0.891, 0.84,
          0.789, 0.735, 0.681, 0.625, 0.568, 0.51, 0.451, 0.39, 0.328, 0.265, 0.201, 0.135,
          0.068, 0,
        ],
      },
    ],
  },
};
