/* Pointer particle motion — the hover distortion.
 *
 * The simulation itself is not a separate shader: it is the *star vertex
 * shader* compiled a second time with GALAXY_PARTICLE_SIMULATION defined. In
 * that mode each star writes its velocity/offset state to a pixel of a
 * 128-wide ping-pong buffer instead of drawing; on the normal pass the same
 * shader reads that buffer back and displaces the star. `galaxyCoast` then
 * integrates drag so the field springs back after the cursor leaves.
 */
(function (global) {
  'use strict';
  const THREE = global.THREE;
  const { particleMotionMass } = global.GalaxyField;

  const SETTLE_SECONDS = 6; // PARTICLE_MOTION_SETTLE_SECONDS
  const WIDTH = 128;

  const SIM_FRAGMENT = `
    varying vec4 vParticleMotionState;
    void main() { gl_FragColor = vParticleMotionState; }
  `;

  class ParticleMotion {
    constructor(layers, vertexShader) {
      this.layers = layers;
      this.scene = new THREE.Scene();
      this.particles = [];
      this.materials = [];

      const total = layers.reduce(
        (n, l) => n + l.geometry.getAttribute('position').count, 0,
      );
      const rows = Math.max(1, Math.ceil(total / WIDTH));
      this.rows = rows;

      const targetOpts = {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
      };
      this.front = new THREE.WebGLRenderTarget(WIDTH, rows, targetOpts);
      this.back = new THREE.WebGLRenderTarget(WIDTH, rows, targetOpts);

      // Shared uniform objects, so writing them updates every layer at once.
      this.texture = { value: this.front.texture };
      this.age = { value: SETTLE_SECONDS };
      this.pointer = { value: new THREE.Vector2() };
      this.previous = { value: new THREE.Vector2() };
      this.impulse = { value: new THREE.Vector2() };
      this.enabled = { value: 1 };

      let offset = 0;
      for (const layer of layers) {
        const geometry = layer.geometry;
        const n = geometry.getAttribute('position').count;
        const uv = new Float32Array(n * 3);
        const starScale = geometry.getAttribute('starScale');
        for (let i = 0; i < n; i += 1) {
          uv[3 * i] = (((offset + i) % WIDTH) + 0.5) / WIDTH;
          uv[3 * i + 1] = (Math.floor((offset + i) / WIDTH) + 0.5) / rows;
          uv[3 * i + 2] = particleMotionMass(0.35 + 3.8 * starScale.getX(i));
        }
        // The flare needs its tracked star's slot so it can read the same
        // simulation state and move with it.
        if (layer.heroIndex !== undefined) {
          layer.motionUv = new THREE.Vector3(
            uv[3 * layer.heroIndex], uv[3 * layer.heroIndex + 1], uv[3 * layer.heroIndex + 2],
          );
        }
        offset += n;
        geometry.setAttribute('particleMotionUv', new THREE.Float32BufferAttribute(uv, 3));

        Object.assign(layer.uniforms, {
          uParticleMotionEnabled: this.enabled,
          uParticleMotionTexture: this.texture,
          uParticleMotionAge: this.age,
          uParticleMotionPointer: this.pointer,
          uParticleMotionPrevious: this.previous,
          uParticleMotionImpulse: this.impulse,
        });
        layer.material.needsUpdate = true;

        const simMaterial = new THREE.ShaderMaterial({
          uniforms: layer.uniforms, // literally the same object
          defines: { GALAXY_PARTICLE_SIMULATION: 1 },
          vertexShader,
          fragmentShader: SIM_FRAGMENT,
          blending: THREE.NoBlending,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        });
        this.materials.push(simMaterial);

        const sim = new THREE.Points(geometry, simMaterial);
        sim.matrixAutoUpdate = false;
        sim.frustumCulled = false;
        this.scene.add(sim);
        this.particles.push({ source: layer.points, simulation: sim });
      }

      this.clearColor = new THREE.Color();
      this.initialized = false;
      this.frame = -1;
      this.epoch = -1;

      // Pointer state machine (`ts` in the driver).
      this.state = {
        frame: 0, delta: 0, epoch: 0, remaining: 0,
        active: false, pressed: false, scrollCooldown: 0,
        pointer: new THREE.Vector2(),
        previous: new THREE.Vector2(),
        impulse: new THREE.Vector2(),
      };
    }

    /** Advance the pointer state; returns true while motion is still settling. */
    step(pointer, enabled, dt) {
      const s = this.state;
      s.frame += 1;
      s.delta = dt;
      s.impulse.set(0, 0);
      s.scrollCooldown = Math.max(0, s.scrollCooldown - dt);

      if (pointer.reset || (!enabled && (s.active || s.remaining > 0))) {
        s.epoch += 1;
        s.remaining = 0;
        s.active = false;
      }

      // Hover drives the distortion; a held button is a drag, not a smear.
      const active = enabled && pointer.active && !pointer.pressed && s.scrollCooldown === 0;
      if (active) {
        s.previous.copy(s.pointer);
        s.pointer.set(pointer.x, pointer.y);
        if (s.active) {
          s.impulse.subVectors(s.pointer, s.previous);
          if (s.impulse.lengthSq() > 1e-8) s.remaining = SETTLE_SECONDS;
        } else {
          s.previous.copy(s.pointer);
        }
      }
      s.active = active;
      s.pressed = pointer.pressed;
      s.remaining = Math.max(0, s.remaining - dt);
      return s.remaining > 0;
    }

    reset() {
      this.initialized = false;
      this.age.value = SETTLE_SECONDS;
    }

    /** Integrate one simulation step into the ping-pong buffer. */
    update(renderer, camera) {
      const s = this.state;
      if (s.frame === this.frame) return;
      this.frame = s.frame;

      if (s.epoch !== this.epoch || s.remaining <= 0) this.reset();
      this.epoch = s.epoch;
      this.age.value = Math.min(SETTLE_SECONDS, this.age.value + Math.max(s.delta, 0));

      if (s.scrollCooldown > 0 || s.impulse.lengthSq() <= 1e-8) return;

      const prevTarget = renderer.getRenderTarget();
      const prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(this.clearColor);
      renderer.setClearColor(0x000000, 0);
      try {
        if (!this.initialized) {
          renderer.setRenderTarget(this.front);
          renderer.clear();
          this.age.value = 0;
          this.initialized = true;
        }
        this.pointer.value.copy(s.pointer);
        this.previous.value.copy(s.previous);
        this.impulse.value.copy(s.impulse);

        for (const { source, simulation } of this.particles) {
          source.updateWorldMatrix(true, false);
          simulation.matrix.copy(source.matrixWorld);
          simulation.matrixWorldNeedsUpdate = true;
        }

        renderer.setRenderTarget(this.back);
        renderer.render(this.scene, camera);
        const swap = this.front;
        this.front = this.back;
        this.back = swap;
        this.texture.value = this.front.texture;
        this.age.value = 0;
      } finally {
        renderer.setRenderTarget(prevTarget);
        renderer.setClearColor(this.clearColor, prevAlpha);
      }
    }
  }

  global.GalaxyParticleMotion = ParticleMotion;
  global.GalaxyParticleMotion.SETTLE_SECONDS = SETTLE_SECONDS;
})(window);
