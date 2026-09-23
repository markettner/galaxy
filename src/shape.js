/* One shape — a star field built from a single arm set.
 *
 * This is everything in the earlier standalone players that was *per shape*:
 * the field, its materials and groups, its own effective config, its framing
 * measurement, its lens-flare sources, and the per-layer half of the frame
 * loop. Lifted out so the page can hold three at once and cross-fade between
 * them.
 *
 * The renderer, camera, post chain, spinRoot, pointer input and the master
 * clock stay global in main.js and arrive here each frame as `ctx`.
 *
 * The one substantive change from the standalone builds: `introProgress` is no
 * longer this module's own `elapsed / convergeDuration`. It is a plain scalar
 * the driver writes, because a transition has to rewind it. Every consumer of
 * it — galaxyIntroMotion in the shader, applyGalaxyIntroMotion and
 * particleRevealProgress on the CPU — is a pure function of that scalar with no
 * integrated state, so running it backwards is exact and needs no separate
 * outro path.
 */
(function (global) {
  'use strict';

  const THREE = global.THREE;
  const {
    generateGalaxyField, generateBackdrop, DEFAULTS, samplePath, samplePathWidth,
    applyGalaxyIntroMotion, particleRevealProgress, tipFade, sizeFalloff,
    densityProgress,
  } = global.GalaxyField;

  const clamp = THREE.MathUtils.clamp;
  const lerp = THREE.MathUtils.lerp;
  const positiveModulo = (v, m) => ((v % m) + m) % m;

  // interaction defaults
  const INTERACTION = {
    followDamping: 6,
    repelRadius: 176,
    rotationLag: 0.68,
    radius: 156,
    depthDisplacement: 0,
    illumination: 0,
    magnification: 0,
  };

  const dummyTexture = () => {
    const t = new THREE.DataTexture(
      new Float32Array([0, 0, 0, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType,
    );
    t.needsUpdate = true;
    return t;
  };
  // Shared by every shape: both are placeholders for features this preset
  // leaves off, so they hold no per-shape state.
  const emptyPath = dummyTexture();
  const emptyShape = dummyTexture();

  const blend = {
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  };

  const SECONDARY_SOURCE_BUDGET = 5; // must match GALAXY_SECONDARY_SOURCES

  // Scratch shared across shapes — only ever live inside one synchronous call.
  const scratch = {
    position: new THREE.Vector3(),
    previous: new THREE.Vector3(),
    next: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    scattered: new THREE.Vector3(),
    projected: new THREE.Vector3(),
  };

  // `T` — fade a source out as it approaches the edge of the frame.
  function edgeFade(v) {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || v.z < -1 || v.z > 1) return 0;
    const t = Math.max(Math.abs(v.x), Math.abs(v.y));
    return 1 - THREE.MathUtils.smoothstep(t, 0.88, 1.08);
  }

  // Uniform defaults for the star material.
  function makeUniforms(layer, cfg, pixelRatio) {
    return {
      uAccretionRatio: { value: 0.42 },
      uAmbientPulse: { value: 1 },
      uCoreIntensity: { value: 1.45 },
      uDensityFalloff: { value: clamp(cfg.densityFalloff, 0, 0.98) },
      uDispersedMotion: { value: 0 },
      uFlowSpeed: { value: 0 },
      uExhaleStrength: { value: 0.42 },
      uFormationEnabled: { value: 0 },
      uFormationProgress: { value: 1 },
      uBackgroundStarsEnabled: { value: 1 }, // converge-tilt
      uBackgroundModelMatrix: { value: new THREE.Matrix4() },
      uIntroProgress: { value: 0 },
      uGrowthEnabled: { value: 0 },
      uGrowthDirection: { value: layer.speed < 0 ? -1 : 1 },
      uGrowthProgress: { value: 1 },
      uGrowthRadius: { value: 8.2 },
      uGrowthSoftness: { value: 0.075 },
      uInwardStrength: { value: 1.2 },
      uIntensity: { value: clamp(cfg.intensity, 0.1, 3) },
      // Arms walk their own 512-sample path texture; the core cluster does not.
      uPathMotion: { value: layer.pathTexture ? 1 : 0 },
      // Closed path: suppresses the tip fade, which would otherwise cut a gap
      // where progress wraps from 1 back to 0.
      uPathLoop: { value: layer.loop ? 1 : 0 },
      uPathOffset: { value: 0 },
      uPathSampleCount: { value: 512 },
      uPathSpeed: { value: layer.speed },
      uPathTexture: { value: layer.pathTexture || emptyPath },
      uPathShapeCenter: { value: new THREE.Vector2() },
      uPathShapeBrightRetention: { value: 0.5 },
      uPathShapeDepth: { value: 0.18 },
      uPathShapeDepthPhase: { value: 0 },
      uPathShapeMotion: { value: 0 },
      uPathShapeProgress: { value: 0 },
      uPathShapePositionProgress: { value: 0 },
      uPathShapeRotation: { value: new THREE.Vector2() },
      uPathShapeScatter: { value: 1 },
      uPathShapeSampleCount: { value: 1024 },
      uPathShapeSize: { value: new THREE.Vector2() },
      // `fract(sin(x) * 43758.5453)` resolves differently in GPU float32 than
      // in JS float64, so the hero star's own scatter seeds would not match
      // the ones the flare tracker computes on the CPU — and the two would
      // take different converge paths. The shader overrides the tracked
      // star's seeds with these for exactly that reason; without it the flare
      // detaches mid-intro.
      uPathShapeTrackedScatter: {
        value: new THREE.Vector2(
          layer.flareShapeAcrossScatter ?? 0, layer.flareShapeDepthScatter ?? 0,
        ),
      },
      uTrackedClearanceSeed: { value: layer.flareClearanceSeed ?? 0 },
      uTrackedScatter: {
        value: layer.flareScatter ? layer.flareScatter.clone() : new THREE.Vector3(),
      },
      uPathShapeTrackedSeed: { value: layer.flareShapeSeed ?? 0 },
      uPathShapeTrackingEnabled: { value: 1 },
      uPathShapeTexture: { value: emptyShape },
      uParticleMotionTexture: { value: emptyShape },
      uParticleMotionEnabled: { value: 1 },
      uParticleMotionAge: { value: 6 },
      uParticleMotionPointer: { value: new THREE.Vector2() },
      uParticleMotionPrevious: { value: new THREE.Vector2() },
      uParticleMotionImpulse: { value: new THREE.Vector2() },
      uLensActive: { value: 0 },
      uLensDepth: { value: INTERACTION.depthDisplacement },
      uLensIllumination: { value: INTERACTION.illumination },
      uLensMagnification: { value: INTERACTION.magnification },
      uLensPointer: { value: new THREE.Vector2() },
      uLensRadius: { value: 0.2 },
      uPointerRepelRadius: { value: 0.2 },
      uPixelRatio: { value: pixelRatio },
      uSizeFalloff: { value: clamp(cfg.sizeFalloff, 0, 1) },
      uPropagationSoftness: { value: 0.16 },
      uScatterSize: { value: new THREE.Vector2(12, 12) },
      uScrollDrift: { value: 0 },
      uScrollScatter: { value: 0 },
      uScrollPositionProgress: { value: 0 },
      uScrollSizeScale: { value: 1 },
      uSpiralTilt: { value: 0 },
      uSettleRatio: { value: 0.15 },
      uTextBounds: { value: new THREE.Vector2(-3, 3) },
      uTime: { value: 0 },
      uTwinkleSpeed: { value: 0 },
      uViewportAspect: { value: 1 },
    };
  }

  class GalaxyShape {
    /**
     * @param {object} opts
     * @param {string} opts.key           registry key, also the public name
     * @param {object} opts.armSet        an entry of window.GALAXY_ARM_SETS
     * @param {object} opts.shaders       window.GALAXY_SHADERS
     * @param {number} opts.pixelRatio    initial value; refreshed each frame
     * @param {object} [opts.overrides]   fieldConfig overrides from the URL
     */
    constructor({ key, armSet, shaders, pixelRatio, overrides = {} }) {
      this.key = key;
      this.armSet = armSet;

      // DEFAULTS stays untouched as the base config. A set layers its own
      // `config` over it, and everything downstream reads `fieldConfig`, not
      // DEFAULTS, so the flare and the uniforms cannot drift from the field.
      this.fieldConfig = { ...DEFAULTS, ...(armSet.config ?? {}), ...overrides };

      const { layers, core } = generateGalaxyField(armSet, this.fieldConfig);
      this.layers = core ? layers.concat([core]) : layers;
      this.coreLayer = core ?? null;

      // 0..1, written by the driver. 1 is settled, 0 is fully dispersed and
      // invisible (particleRevealProgress(0) === 0).
      this.intro = 0;
      // 0..1 brightness multiplier, independent of `intro`: fades the shape
      // out in place, without dispersing it. The Sol & Luna dive uses it.
      this.fade = 1;

      this.contentHalfWidth = this._measureContent(layers);
      this._buildMaterials(shaders, pixelRatio);
      this._pickFlareSources();

      this.coreRotation = 0;
      this.coreTargetRotation = 0;
      // Groups are created visible; force them down so a shape that has not
      // been introduced yet is not submitted to the renderer at all.
      this.visible = true;
      this.setVisible(false);
    }

    // -------------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------------

    /**
     * How much of the world the paths actually occupy, plus the room their
     * scatter and glow need. The responsive framing uses this to guarantee the
     * shape fits a narrow viewport instead of being cropped.
     */
    _measureContent(layers) {
      const cfg = this.fieldConfig;
      const p = new THREE.Vector3();
      let halfWidth = 0;
      for (const layer of layers) {
        if (!layer.curve) continue;
        for (let i = 0; i <= 256; i += 1) {
          const t = i / 256;
          layer.curve.getPointAt(t, p);
          // How far stars sit off the centreline. With a width profile that is
          // a fraction of the arm's own half-width there; without one,
          // `scatter` is itself a world distance.
          const off = layer.curve.widths
            ? layer.curve.getWidthAt(t) * clamp(cfg.scatter, 0, 1)
            : clamp(cfg.scatter, 0, 0.45);
          halfWidth = Math.max(halfWidth, Math.abs(p.x) + off);
        }
      }
      // Bloom carries a little past the stars again, and the 1.08 is margin so
      // a fitted shape does not sit flush against the bezel.
      return (halfWidth + 0.35) * 1.08;
    }

    _buildMaterials(shaders, pixelRatio) {
      for (const layer of this.layers) {
        layer.uniforms = makeUniforms(layer, this.fieldConfig, pixelRatio);
        layer.material = new THREE.ShaderMaterial({
          ...blend,
          vertexShader: shaders.vertex,
          fragmentShader: shaders.fragment,
          uniforms: layer.uniforms,
          transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
        });
        layer.points = new THREE.Points(layer.geometry, layer.material);
        layer.points.frustumCulled = false;
        layer.group = new THREE.Group();
        layer.group.add(layer.points);
        layer.spin = new THREE.Vector2();
        layer.motionOffset = 0;
        layer.travel = layer.phase;
      }
    }

    /**
     * The flare shader has a fixed budget of five secondary sources
     * (GALAXY_SECONDARY_SOURCES in postfx.js). The six-arm set therefore leaves
     * one arm without a flare; the arms are spread evenly over the budget
     * rather than taking the first five, so a mirrored pair does not end up as
     * the one that loses out.
     *
     * The core cluster is normally the primary (brightest) source. A shape with
     * no cluster — delta is a bare outline, beyond has nothing in the middle —
     * would leave the primary flare dark, so the first path's own hero star
     * takes the role and drops out of the secondaries rather than being flared
     * twice.
     */
    _pickFlareSources() {
      this.primaryLayer = this.coreLayer ?? this.layers.find((l) => !l.isCore) ?? null;
      const arms = this.layers.filter((l) => !l.isCore && l !== this.primaryLayer);
      if (arms.length <= SECONDARY_SOURCE_BUDGET) {
        this.secondaryLayers = arms;
      } else {
        const step = arms.length / SECONDARY_SOURCE_BUDGET;
        this.secondaryLayers = Array.from(
          { length: SECONDARY_SOURCE_BUDGET },
          (_, i) => arms[Math.floor(i * step)],
        );
      }
    }

    // -------------------------------------------------------------------------
    // Scene membership
    // -------------------------------------------------------------------------

    attach(parent) {
      for (const layer of this.layers) parent.add(layer.group);
    }

    setVisible(v) {
      if (v === this.visible) return;
      this.visible = v;
      for (const layer of this.layers) layer.group.visible = v;
    }

    // -------------------------------------------------------------------------
    // Framing
    // -------------------------------------------------------------------------

    /**
     * The scatter volume this shape wants at the given aspect. The two
     * constants were tuned for the "6", a tall shape that is *meant* to bleed
     * off the sides of a phone. An outline is not: cropping it reads as a
     * mistake rather than a composition. So on any viewport too narrow to hold
     * the shape, widen the frame until it fits. On desktop aspects the constant
     * already wins and this changes nothing.
     */
    scatterHeight(aspect) {
      return Math.max(
        aspect < 0.72 ? 12.7 : 10.9,
        (this.contentHalfWidth * 2) / Math.max(aspect, 0.0001),
      );
    }

    // -------------------------------------------------------------------------
    // Per-frame
    // -------------------------------------------------------------------------

    /**
     * Advance this shape's own motion and push its uniforms.
     * `ctx` carries everything global: elapsed, dt, aspect, scatterX/scatterY,
     * pixelRatio, reduceMotion, input, spinRotation, lens state, and the
     * animationRoot world matrix.
     */
    update(ctx) {
      const cfg = this.fieldConfig;
      const { dt, elapsed, reduceMotion, input } = ctx;
      const intro = this.intro;

      // `$` — gates motion and interaction until the field has mostly
      // converged. It rides `intro`, so an outgoing shape sheds its drift,
      // spin and twinkle as it disperses without any extra bookkeeping.
      const motionGate = THREE.MathUtils.smoothstep(intro, 0.55, 1);

      // Core cluster: slow inward spin plus a gentle wobble.
      if (this.coreLayer) {
        const rate = 0.36 * clamp(cfg.flowSpeed, 0, 3);
        const dir = cfg.flowInward ? 1 : -1;
        this.coreTargetRotation = positiveModulo(
          this.coreTargetRotation + dt * rate * dir + Math.PI, 2 * Math.PI,
        ) - Math.PI;
        const k = 1 - Math.exp(-14 * dt);
        const delta = Math.atan2(
          Math.sin(this.coreTargetRotation - this.coreRotation),
          Math.cos(this.coreTargetRotation - this.coreRotation),
        );
        this.coreRotation = positiveModulo(
          this.coreRotation + delta * k + Math.PI, 2 * Math.PI,
        ) - Math.PI;
        this.coreLayer.group.rotation.set(
          0.08 * Math.sin(0.22 * elapsed) * motionGate,
          0.14 * Math.cos(0.28 * elapsed) * motionGate,
          this.coreRotation * motionGate,
        );
      }

      const rotationLag = clamp(INTERACTION.rotationLag, 0, 1);
      const baseDamping = input.returning ? 5.5 : 14;

      for (const layer of this.layers) {
        if (layer !== this.coreLayer && !reduceMotion) {
          // Each arm chases the pointer at its own rate, then counter-rotates
          // against spinRoot — that difference is the visible lag.
          const k = 1 - Math.exp(-(baseDamping / (1 + layer.lag * rotationLag * 2.5)) * dt);
          layer.spin.x = lerp(layer.spin.x, input.rotation.x, k);
          layer.spin.y = lerp(layer.spin.y, input.rotation.y, k);
          layer.group.rotation.set(
            layer.spin.x * motionGate - ctx.spinRotation.x,
            layer.spin.y * motionGate - ctx.spinRotation.y,
            0,
          );
        }

        // Stars drift along their arm.
        const speed = layer.speed;
        const travelRate = layer.isCore ? 0.022 : Math.abs(speed);
        if (!reduceMotion) {
          layer.motionOffset = positiveModulo(
            layer.motionOffset + dt * speed * clamp(cfg.flowSpeed, 0, 3) * motionGate, 1,
          );
          layer.travel = positiveModulo(layer.travel + dt * travelRate * motionGate, 1);
        }

        const u = layer.uniforms;
        u.uTime.value = elapsed;
        u.uIntroProgress.value = intro;
        u.uPathOffset.value = layer.motionOffset;
        u.uPathSpeed.value = speed;
        u.uFlowSpeed.value = clamp(cfg.flowSpeed, 0, 3) * motionGate;
        u.uTwinkleSpeed.value = reduceMotion ? 0 : clamp(cfg.twinkleSpeed, 0, 2) * motionGate;
        u.uIntensity.value = clamp(cfg.intensity * (layer.isCore ? 1.22 : 1), 0.1, 3) * this.fade;
        u.uScatterSize.value.set(ctx.scatterX, ctx.scatterY);
        u.uViewportAspect.value = ctx.aspect;
        u.uLensActive.value = ctx.lensStrength;
        u.uLensPointer.value.copy(ctx.lensPointer);
        u.uLensRadius.value = ctx.lensRadius;
        u.uPointerRepelRadius.value = ctx.repelRadius;
        u.uPixelRatio.value = ctx.pixelRatio;
        // Background stars render through this matrix instead of the layer's,
        // so they sit above spinRoot and the drag rotation never reaches them.
        u.uBackgroundModelMatrix.value.copy(ctx.animationRootMatrix);
      }
    }

    // -------------------------------------------------------------------------
    // Optical sources for the lens flare
    //
    // Each arm's hero star is followed along its own path as the field flows
    // inward, then pushed through the same intro motion the shader applies — so
    // the flare sits on the star rather than hanging in space.
    // -------------------------------------------------------------------------

    /** Where the layer's tracked star actually is this frame, in world space. */
    flarePosition(layer, scatterX, scatterY) {
      const cfg = this.fieldConfig;
      const intro = this.intro;
      const onPath = layer.pathSamples !== null;
      let progress = 0;
      if (onPath) {
        const travel = positiveModulo(layer.flareProgress + layer.motionOffset, 1);
        progress = densityProgress(travel, cfg.densityFalloff);
        const step = 1 / Math.max(Math.floor(layer.pathSamples.length / 4) - 1, 1);
        samplePath(layer.pathSamples, progress, scratch.position);
        samplePath(layer.pathSamples, Math.max(progress - step, 0), scratch.previous);
        samplePath(layer.pathSamples, Math.min(progress + step, 1), scratch.next);
        scratch.tangent.subVectors(scratch.next, scratch.previous).normalize();
        scratch.normal.set(-scratch.tangent.y, scratch.tangent.x, 0).normalize();
        // Same scaling the vertex shader applies: the tracked star's offsets
        // are fractions of the arm's half-width where it currently sits, so the
        // flare has to read the width from the same alpha channel or it drifts
        // off its star as the arm narrows.
        const halfWidth = samplePathWidth(layer.pathSamples, progress);
        scratch.position.addScaledVector(scratch.normal, layer.flareAcrossOffset * halfWidth);
        scratch.position.z += layer.flareDepthOffset * halfWidth;
      } else {
        scratch.position.copy(layer.flareBasePosition);
      }

      const sc = layer.flareScatter;
      scratch.scattered.set(
        (sc.x - 0.5) * scatterX,
        (positiveModulo(sc.y, 1) - 0.5) * scatterY,
        (sc.z - 0.5) * 0.5,
      );
      applyGalaxyIntroMotion(scratch.position, scratch.scattered, intro, sc.z, sc.y);

      const reveal = particleRevealProgress(intro, sc.z);
      const fade = onPath ? tipFade(progress, layer.loop) : 1;
      const size = onPath ? sizeFalloff(progress, cfg.sizeFalloff) : 1;
      const visibility = fade * size * Math.sqrt(reveal)
        * THREE.MathUtils.smoothstep(reveal, 0, 0.2) * this.fade;
      return clamp(visibility, 0, 1);
    }

    projectSource(layer, visibility, camera, target) {
      layer.group.updateMatrixWorld();
      scratch.projected.copy(scratch.position)
        .applyMatrix4(layer.group.matrixWorld).project(camera);
      target.set(scratch.projected.x * 0.5 + 0.5, scratch.projected.y * 0.5 + 0.5);
      return visibility * edgeFade(scratch.projected);
    }

    /**
     * Write this shape's stars into the flare uniforms. Only ever called for
     * one shape per frame — the flare budget is global. `flarePosition` already
     * scales visibility by particleRevealProgress(intro), so both shapes'
     * flares are dark through a transition's crossover and the handoff happens
     * while there is nothing to see.
     */
    updateFlareSources(flareU, camera, scatterX, scatterY) {
      if (this.primaryLayer) {
        const v = this.flarePosition(this.primaryLayer, scatterX, scatterY);
        flareU.uVisibility.value =
          this.projectSource(this.primaryLayer, v, camera, flareU.uCenter.value);
      } else {
        flareU.uVisibility.value = 0;
      }

      for (let i = 0; i < SECONDARY_SOURCE_BUDGET; i += 1) {
        const layer = this.secondaryLayers[i];
        if (!layer) {
          flareU.uSecondaryCenters.value[i].set(-2, -2);
          flareU.uSecondaryVisibility.value[i] = 0;
          continue;
        }
        const v = this.flarePosition(layer, scatterX, scatterY);
        flareU.uSecondaryVisibility.value[i] =
          this.projectSource(layer, v, camera, flareU.uSecondaryCenters.value[i]);
      }
    }

    /** Couple this shape's flares to the same hover smear its stars get. */
    updateFlareMotion(flareU) {
      const p = this.primaryLayer;
      if (p && p.motionUv) flareU.uPrimaryMotionUv.value.copy(p.motionUv);
      for (let i = 0; i < SECONDARY_SOURCE_BUDGET; i += 1) {
        const uv = this.secondaryLayers[i] && this.secondaryLayers[i].motionUv;
        if (uv) flareU.uSecondaryMotionUvs.value[i].copy(uv);
        else flareU.uSecondaryMotionUvs.value[i].set(-1, -1, 1);
      }
    }
  }

  /**
   * The star backdrop — one field of scattered stars, shared by every shape.
   *
   * Each shape used to carry its own, generated from its own arms with its own
   * seeds, and swapping shapes swapped the sky underneath them: two unrelated
   * starfields cross-dissolving, which reads as a cut rather than a transition.
   * There was never a reason for them to differ, so there is now one, built
   * from the galaxy's arms and never touched again.
   *
   * It is deliberately outside the transition. Its intro runs once, on load (or
   * on R), and then stays at 1 — a shape can disperse and re-form in front of a
   * sky that does not move.
   */
  class GalaxyBackdrop {
    constructor({ armSet, shaders, pixelRatio, config = {} }) {
      // Background stars are the one thing this must generate, whatever the
      // set's own config says.
      this.fieldConfig = {
        ...DEFAULTS, ...(armSet.config ?? {}), ...config, backgroundStars: true,
      };
      const { geometry, count } = generateBackdrop(armSet, this.fieldConfig);
      this.count = count;

      // Enough of a layer for makeUniforms and ParticleMotion. No path texture,
      // so uPathMotion is 0 and the shader leaves `position` alone — which it
      // then discards anyway in favour of introScattered.
      const layer = {
        geometry, speed: 0, pathTexture: null, loop: false, isCore: false,
      };
      layer.uniforms = makeUniforms(layer, this.fieldConfig, pixelRatio);
      layer.material = new THREE.ShaderMaterial({
        ...blend,
        vertexShader: shaders.vertex,
        fragmentShader: shaders.fragment,
        uniforms: layer.uniforms,
        transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      });
      layer.points = new THREE.Points(geometry, layer.material);
      layer.points.frustumCulled = false;
      this.layer = layer;
      this.intro = 0;
    }

    /**
     * Parented above spinRoot: the shader routes background stars through
     * uBackgroundModelMatrix regardless, but keeping it out of the spin subtree
     * makes that visible in the scene graph rather than only in GLSL.
     */
    attach(parent) { parent.add(this.layer.points); }

    update(ctx) {
      const cfg = this.fieldConfig;
      const u = this.layer.uniforms;
      u.uTime.value = ctx.elapsed;
      u.uIntroProgress.value = this.intro;
      u.uTwinkleSpeed.value = ctx.reduceMotion
        ? 0 : clamp(cfg.twinkleSpeed, 0, 2) * THREE.MathUtils.smoothstep(this.intro, 0.55, 1);
      u.uIntensity.value = clamp(cfg.intensity, 0.1, 3);
      u.uScatterSize.value.set(ctx.scatterX, ctx.scatterY);
      u.uViewportAspect.value = ctx.aspect;
      u.uLensActive.value = ctx.lensStrength;
      u.uLensPointer.value.copy(ctx.lensPointer);
      u.uLensRadius.value = ctx.lensRadius;
      u.uPointerRepelRadius.value = ctx.repelRadius;
      u.uPixelRatio.value = ctx.pixelRatio;
      u.uBackgroundModelMatrix.value.copy(ctx.animationRootMatrix);
    }
  }

  global.GalaxyShape = GalaxyShape;
  global.GalaxyShape.INTERACTION = INTERACTION;
  global.GalaxyShape.SECONDARY_SOURCE_BUDGET = SECONDARY_SOURCE_BUDGET;
  global.GalaxyBackdrop = GalaxyBackdrop;
})(window);
