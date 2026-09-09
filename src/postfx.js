/* Galaxy postprocessing chain.
 *
 * The pipeline:
 *
 *   scene -> HalfFloat buffer
 *     -> custom luminance prefilter   (replaces pmndrs' default)
 *     -> MipmapBlurPass, 5 levels, radius 0.72   (pmndrs)
 *     -> separable "reconstruction" blur at half res   (custom)
 *   composite: base + ADD(bloom * 0.7) -> GalaxyLensFlare -> ACES filmic
 *
 * The fragment shaders live in shaders_post.js; this file is only the plumbing
 * around them -- render targets, pass order and uniform wiring.
 */
(function (global) {
  'use strict';
  const THREE = global.THREE;
  const S = global.GALAXY_POST_SHADERS;

  const LEVELS = 5;
  const RADIUS = 0.72; // overrides pmndrs' 0.85 default

  // pmndrs blend function for BlendFunction.ADD, verbatim.
  const ADD_BLEND = `
    vec4 galaxyBlendAdd(const in vec4 x, const in vec4 y, const in float opacity) {
      return mix(x, vec4(x.rgb + y.rgb, y.a), y.a * opacity);
    }
  `;

  // three.js ACESFilmicToneMapping, matching ToneMappingEffect(ACES_FILMIC).
  const ACES = `
    vec3 galaxyRRTAndODTFit(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 galaxyACESFilmic(vec3 color) {
      const mat3 ACESInputMat = mat3(
        0.59719, 0.07600, 0.02840,
        0.35458, 0.90834, 0.13383,
        0.04823, 0.01566, 0.83777
      );
      const mat3 ACESOutputMat = mat3(
         1.60475, -0.10208, -0.00327,
        -0.53108,  1.10813, -0.07276,
        -0.07367, -0.00605,  1.07602
      );
      color *= toneMappingExposure / 0.6;
      color = ACESInputMat * color;
      color = galaxyRRTAndODTFit(color);
      color = ACESOutputMat * color;
      return clamp(color, 0.0, 1.0);
    }
  `;

  // The flare offsets each optical source by the same pointer simulation that
  // smears the stars, so a hovered star and its flare move together. In the
  // a pmndrs effect these would arrive as varyings from `mainSupport`; here it is a
  // fullscreen pass, and the value is constant across the quad, so we evaluate
  // the identical expression at the top of mainImage instead.
  const MOTION_SUPPORT = `
    uniform sampler2D uParticleMotionTexture;
    uniform float uParticleMotionAge;
    uniform vec3 uPrimaryMotionUv;
    uniform vec3 uSecondaryMotionUvs[5];
    vec2 vPrimaryMotion;
    vec2 vSecondaryMotion[5];

    vec4 galaxyCoast(vec4 state, float mass, float age) {
      float drag = 2.3 / sqrt(mass);
      float velocityDecay = exp(-drag * age);
      float returnDecay = exp(-age);
      state.xy = state.xy * returnDecay
        + state.zw * (returnDecay - velocityDecay) / (drag - 1.0);
      state.zw *= velocityDecay;
      return state;
    }

    vec2 particleOffset(vec3 particleUv) {
      if (particleUv.x < 0.0 || uParticleMotionAge >= 6.0) return vec2(0.0);
      return galaxyCoast(
        texture2D(uParticleMotionTexture, particleUv.xy),
        particleUv.z,
        uParticleMotionAge
      ).xy * 0.5;
    }
  `;

  function prepareFlare(src) {
    return src
      // the varyings are declared by MOTION_SUPPORT instead
      .replace(/varying vec2 vPrimaryMotion;\s*/, '')
      .replace(/varying vec2 vSecondaryMotion\[5\];\s*/, '')
      .replace(/uniform sampler2D uDirtTexture;/, 'uniform sampler2D uDirtTexture;\nuniform sampler2D inputBuffer;')
      // evaluate what mainSupport would have written into the varyings
      .replace(
        'vec3 base = inputColor.rgb;',
        'vPrimaryMotion = particleOffset(uPrimaryMotionUv);\n'
        + '    for (int i = 0; i < 5; i++) vSecondaryMotion[i] = particleOffset(uSecondaryMotionUvs[i]);\n'
        + '    vec3 base = inputColor.rgb;',
      );
  }

  const makeTarget = (w, h) =>
    new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

  class GalaxyPostFX {
    constructor(renderer, config = {}) {
      this.renderer = renderer;
      this.config = config;

      const {
        bloomIntensity = 0.7,
        bloomThreshold = 0.08,
        luminanceSmoothing = 0.18,
        lensFlare = {},
        dirtyGlass = {},
        dirtTexture = null,
      } = config;

      this.bloomIntensity = bloomIntensity;

      this.quadScene = new THREE.Scene();
      this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
      this.quad.frustumCulled = false;
      this.quadScene.add(this.quad);

      const base = { depthTest: false, depthWrite: false, toneMapped: false };

      this.luminanceMaterial = new THREE.ShaderMaterial({
        ...base,
        vertexShader: S.fullscreen_vert,
        fragmentShader: S.luminance_frag,
        uniforms: {
          inputBuffer: { value: null },
          sourceTexelSize: { value: new THREE.Vector2() },
          threshold: { value: bloomThreshold },
          smoothing: { value: luminanceSmoothing },
        },
      });

      this.downsampleMaterial = new THREE.ShaderMaterial({
        ...base,
        vertexShader: S.downsample_vert,
        fragmentShader: S.downsample_frag,
        uniforms: { inputBuffer: { value: null }, texelSize: { value: new THREE.Vector2() } },
      });

      this.upsampleMaterial = new THREE.ShaderMaterial({
        ...base,
        vertexShader: S.upsample_vert,
        fragmentShader: S.upsample_frag,
        uniforms: {
          inputBuffer: { value: null },
          supportBuffer: { value: null },
          texelSize: { value: new THREE.Vector2() },
          radius: { value: RADIUS },
        },
      });

      this.reconstructMaterial = new THREE.ShaderMaterial({
        ...base,
        vertexShader: S.fullscreen_vert,
        fragmentShader: S.reconstruct_frag,
        uniforms: { source: { value: null }, stepSize: { value: new THREE.Vector2() } },
      });

      // ---- final composite: bloom (ADD) -> flare -> ACES -------------------
      this.flareUniforms = {
        uParticleMotionAge: { value: 6 },
        uAnimated: { value: Number(lensFlare.animated ?? true) },
        uAspect: { value: 1 },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uDirtTexture: { value: dirtTexture },
        uDirtTextureAspect: { value: 256 / 192 },
        uDirtTextureOffset: { value: new THREE.Vector2() },
        uDirtTextureRotation: { value: 0 },
        uDirtyGlassEnabled: { value: Number(dirtyGlass.enabled ?? true) },
        uDistortion: { value: dirtyGlass.distortion ?? 0.68 },
        uFlareEnabled: { value: Number(lensFlare.enabled ?? true) },
        uGhosts: { value: lensFlare.ghosts ?? 0.1 },
        uGrain: { value: dirtyGlass.grain ?? 0.031 },
        uHalo: { value: lensFlare.halo ?? 0.12 },
        uIntensity: { value: lensFlare.intensity ?? 0.28 },
        uProceduralDirt: { value: dirtyGlass.procedural ?? 0 },
        uSecondaryCenters: { value: Array.from({ length: 5 }, () => new THREE.Vector2(-2, -2)) },
        uSecondaryIntensity: { value: lensFlare.secondary ?? 0.55 },
        uSecondaryVisibility: { value: new Array(5).fill(0) },
        uStreakLength: { value: lensFlare.streakLength ?? 0.03485 },
        uStreaks: { value: lensFlare.streaks ?? 0.18 },
        uTime: { value: 0 },
        uTextureDirt: { value: dirtyGlass.texture ?? 0 },
        uVerticalStreaks: { value: lensFlare.verticalStreaks ?? 1 },
        uVisibility: { value: 1 },
        uParticleMotionTexture: { value: null },
        uPrimaryMotionUv: { value: new THREE.Vector3(-1, -1, 1) },
        uSecondaryMotionUvs: {
          value: Array.from({ length: 5 }, () => new THREE.Vector3(-1, -1, 1)),
        },
      };

      const compositeFrag = `
        #define GALAXY_SECONDARY_SOURCES 5
        #define GALAXY_DISTORTION ${dirtTexture ? 1 : 0}
        #include <common>
        uniform sampler2D tBase;
        uniform sampler2D tBloom;
        uniform float uBloomIntensity;
        uniform float toneMappingExposure;
        varying vec2 vUv;
        ${ADD_BLEND}
        ${ACES}
        ${MOTION_SUPPORT}
        ${prepareFlare(S.flare_glass_frag)}
        void main() {
          vec4 base = texture2D(tBase, vUv);
          vec4 texel = texture2D(tBloom, vUv);
          // BloomEffect: outputColor = texel.rgb * intensity, blended ADD.
          vec4 bloom = vec4(texel.rgb * uBloomIntensity, max(base.a, texel.a));
          vec4 withBloom = galaxyBlendAdd(base, bloom, 1.0);
          vec4 flared;
          mainImage(withBloom, vUv, flared);
          vec3 mapped = galaxyACESFilmic(flared.rgb);
          // Final pass writes to the canvas, so encode exactly the way three's
          // <colorspace_fragment> does — the real sRGB transfer, including its
          // linear toe. A plain 1/2.2 gamma crushes the faint end of the bloom.
          vec3 encoded = mix(
            pow(mapped, vec3(0.41666)) * 1.055 - vec3(0.055),
            mapped * 12.92,
            vec3(lessThanEqual(mapped, vec3(0.0031308)))
          );
          gl_FragColor = vec4(encoded, 1.0);
        }
      `;

      this.compositeMaterial = new THREE.ShaderMaterial({
        ...base,
        vertexShader: S.fullscreen_vert,
        fragmentShader: compositeFrag,
        uniforms: Object.assign(
          {
            tBase: { value: null },
            tBloom: { value: null },
            inputBuffer: { value: null }, // the flare's distortion tap
            uBloomIntensity: { value: bloomIntensity },
            toneMappingExposure: { value: 1 },
          },
          this.flareUniforms,
        ),
      });

      this.sceneTarget = makeTarget(1, 1);
      this.luminanceTarget = makeTarget(1, 1);
      this.downMips = Array.from({ length: LEVELS }, () => makeTarget(1, 1));
      // pmndrs allocates levels-1 upsampling targets; index 0 is the output.
      this.upMips = Array.from({ length: LEVELS - 1 }, () => makeTarget(1, 1));
      this.horizontalTarget = makeTarget(1, 1);
      this.verticalTarget = makeTarget(1, 1);
    }

    setSize(width, height) {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      this.sceneTarget.setSize(w, h);

      // The site drives the effect at half the drawing buffer:
      //   `bloom.setSize(round(w * dpr * 0.5), ...)`  ->  (be, bt)
      //
      // BloomEffect.update calls `luminancePass.render(renderer, inputBuffer)`
      // with NO output buffer, so the prefilter writes into the LuminancePass's
      // own target, which setSize leaves at scale 1 — i.e. (be, bt), a half.
      // `BloomEffect.renderTarget` (a quarter, via resolutionScale 0.5) is only
      // the fallback for the non-mipmap path and is never allocated here.
      //
      // Running the prefilter at a quarter instead flickers: its kernel is only
      // 4 taps at +/- half a *source* texel, which is about right for a 2x
      // reduction but leaves most texels unsampled at 4x, so sub-pixel star
      // movement pops samples in and out.
      //
      // The mipmap chain and the reconstruction blur do run at a quarter.
      const be = Math.max(1, Math.round(w * 0.5));
      const bt = Math.max(1, Math.round(h * 0.5));
      const qw = Math.max(1, Math.round(be * 0.5));
      const qh = Math.max(1, Math.round(bt * 0.5));

      this.luminanceTarget.setSize(be, bt);

      // MipmapBlurPass.setSize: each level halves the previous, from (be, bt).
      let mw = be;
      let mh = bt;
      for (let i = 0; i < LEVELS; i += 1) {
        mw = Math.max(1, Math.round(0.5 * mw));
        mh = Math.max(1, Math.round(0.5 * mh));
        this.downMips[i].setSize(mw, mh);
        if (i < this.upMips.length) this.upMips[i].setSize(mw, mh);
      }

      // Their BloomEffect subclass: reconstruction targets at half of (be, bt).
      this.horizontalTarget.setSize(qw, qh);
      this.verticalTarget.setSize(qw, qh);
      this.flareUniforms.uAspect.value = w / h;
    }

    _blit(material, target) {
      this.quad.material = material;
      this.renderer.setRenderTarget(target);
      this.renderer.clear();
      this.renderer.render(this.quadScene, this.quadCamera);
    }

    render(scene, camera) {
      const r = this.renderer;

      // 1. Scene into the HDR buffer.
      r.setRenderTarget(this.sceneTarget);
      r.clear();
      r.render(scene, camera);

      // 2. Luminance prefilter (4-tap box + smoothstep threshold).
      this.luminanceMaterial.uniforms.inputBuffer.value = this.sceneTarget.texture;
      this.luminanceMaterial.uniforms.sourceTexelSize.value.set(
        1 / this.sceneTarget.width, 1 / this.sceneTarget.height,
      );
      this._blit(this.luminanceMaterial, this.luminanceTarget);

      // 3. Mipmap blur: downsample chain, then tent upsample back up.
      let src = this.luminanceTarget;
      for (let i = 0; i < LEVELS; i += 1) {
        this.downsampleMaterial.uniforms.inputBuffer.value = src.texture;
        this.downsampleMaterial.uniforms.texelSize.value.set(1 / src.width, 1 / src.height);
        this._blit(this.downsampleMaterial, this.downMips[i]);
        src = this.downMips[i];
      }
      for (let i = this.upMips.length - 1; i >= 0; i -= 1) {
        this.upsampleMaterial.uniforms.inputBuffer.value = src.texture;
        this.upsampleMaterial.uniforms.supportBuffer.value = this.downMips[i].texture;
        this.upsampleMaterial.uniforms.texelSize.value.set(1 / src.width, 1 / src.height);
        this._blit(this.upsampleMaterial, this.upMips[i]);
        src = this.upMips[i];
      }

      // 4. Reconstruction blur (separable, half res).
      this.reconstructMaterial.uniforms.source.value = src.texture;
      this.reconstructMaterial.uniforms.stepSize.value.set(1 / this.horizontalTarget.width, 0);
      this._blit(this.reconstructMaterial, this.horizontalTarget);
      this.reconstructMaterial.uniforms.source.value = this.horizontalTarget.texture;
      this.reconstructMaterial.uniforms.stepSize.value.set(0, 1 / this.verticalTarget.height);
      this._blit(this.reconstructMaterial, this.verticalTarget);

      // 5. Composite to the canvas.
      const u = this.compositeMaterial.uniforms;
      u.tBase.value = this.sceneTarget.texture;
      u.inputBuffer.value = this.sceneTarget.texture;
      u.tBloom.value = this.verticalTarget.texture;
      u.uBloomIntensity.value = this.bloomIntensity;
      this._blit(this.compositeMaterial, null);
    }
  }

  global.GalaxyPostFX = GalaxyPostFX;
})(window);
