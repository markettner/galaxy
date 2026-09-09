// Star vertex + fragment GLSL. Template constants are resolved to their
// shipped values rather than injected at build time.
window.GALAXY_SHADERS = {
  vertex: `
  attribute float orbitProgress;
  attribute float starAcrossOffset;
  attribute float starBrightness;
  attribute vec3 starColor;
  attribute float starDepthOffset;
  attribute float starHero;
  attribute float starBackground;
  attribute float starOpacity;
  attribute float starScale;
  attribute float twinklePhase;
  attribute float twinkleRate;

  uniform float uIntensity;
  uniform float uIntroProgress;
  uniform float uBackgroundStarsEnabled;
  uniform mat4 uBackgroundModelMatrix;
  uniform float uAccretionRatio;
  uniform float uAmbientPulse;
  uniform float uCoreIntensity;
  uniform float uDensityFalloff;
  uniform float uDispersedMotion;
  uniform float uFlowSpeed;
  uniform float uExhaleStrength;
  uniform float uFormationEnabled;
  uniform float uFormationProgress;
  uniform float uGrowthEnabled;
  uniform float uGrowthDirection;
  uniform float uGrowthProgress;
  uniform float uGrowthRadius;
  uniform float uGrowthSoftness;
  uniform float uInwardStrength;
  uniform float uLensActive;
  uniform float uLensDepth;
  uniform float uLensIllumination;
  uniform float uLensMagnification;
  uniform vec2 uLensPointer;
  uniform float uLensRadius;
  uniform float uPointerRepelRadius;
  uniform vec2 uPathShapeCenter;
  uniform float uPathShapeBrightRetention;
  uniform float uPathShapeDepth;
  uniform float uPathShapeDepthPhase;
  uniform float uPathShapeMotion;
  uniform float uPathShapeProgress;
  uniform float uPathShapePositionProgress;
  uniform vec2 uPathShapeRotation;
  uniform float uPathShapeScatter;
  uniform float uPathShapeSampleCount;
  uniform vec2 uPathShapeSize;
  uniform vec2 uPathShapeTrackedScatter;
  uniform float uPathShapeTrackedSeed;
  uniform float uPathShapeTrackingEnabled;
  uniform float uTrackedClearanceSeed;
  uniform vec3 uTrackedScatter;
  uniform sampler2D uPathShapeTexture;
  uniform vec2 uScatterSize;
  uniform float uScrollDrift;
  uniform float uScrollScatter;
  uniform float uScrollPositionProgress;
  uniform float uScrollSizeScale;
  uniform float uSpiralTilt;
  uniform vec2 uTextBounds;
  uniform float uPathMotion;
  uniform float uPathOffset;
  uniform float uPathSampleCount;
  uniform float uPathSpeed;
  uniform float uPixelRatio;
  uniform float uSizeFalloff;
  // 1 when the path is a closed loop. See endpointVisibility below.
  uniform float uPathLoop;
  uniform float uPropagationSoftness;
  uniform float uSettleRatio;
  uniform float uTime;
  uniform float uTwinkleSpeed;
  uniform sampler2D uPathTexture;
  uniform float uViewportAspect;

  varying float vBrightness;
  varying vec3 vColor;
  varying float vLens;
  varying float vOpacity;
  varying float vRayStrength;
  varying float vParticleDiameter;

  
  attribute vec3 particleMotionUv;
  uniform sampler2D uParticleMotionTexture;
  uniform float uParticleMotionEnabled;
  uniform float uParticleMotionAge;
  uniform vec2 uParticleMotionPointer;
  uniform vec2 uParticleMotionPrevious;
  uniform vec2 uParticleMotionImpulse;
  varying vec4 vParticleMotionState;

  
  vec4 galaxyCoast(vec4 state, float mass, float age) {
    float drag = 2.3 / sqrt(mass);
    float velocityDecay = exp(-drag * age);
    float returnDecay = exp(-age);
    state.xy = state.xy * returnDecay
      + state.zw * (returnDecay - velocityDecay) / (drag - 1.0);
    state.zw *= velocityDecay;
    return state;
  }

  void galaxyParticleMotion(inout vec4 clipPosition) {
    if (uParticleMotionEnabled < 0.5 || uParticleMotionAge >= 6.0) return;
    float mass = particleMotionUv.z;
    vec4 state = galaxyCoast(texture2D(uParticleMotionTexture, particleMotionUv.xy), mass, uParticleMotionAge);
    #ifdef GALAXY_PARTICLE_SIMULATION
      float aspect = max(uViewportAspect, 0.0001);
      vec2 scale = vec2(aspect, 1.0);
      vec2 current = (clipPosition.xy / clipPosition.w + state.xy) * scale;
      vec2 start = uParticleMotionPrevious * scale;
      vec2 segment = (uParticleMotionPointer - uParticleMotionPrevious) * scale;
      float t = clamp(dot(current - start, segment) / max(dot(segment, segment), 0.000001), 0.0, 1.0);
      float radius = max(uPointerRepelRadius * 0.5, 0.025);
      float weight = pow(1.0 - smoothstep(0.0, radius, length(current - start - segment * t)), 2.0);
      vec2 impulse = uParticleMotionImpulse * scale;
      impulse *= min(1.0, 0.18 / max(length(impulse), 0.00001));
      // Individual momentum, with no positional spring pulling toward a cursor.
      state.zw += impulse / scale * weight * 5.4 / mass;
      float speed = length(state.zw * scale);
      state.zw *= min(1.0, 0.5 / max(speed, 0.00001));
      vParticleMotionState = state;
      gl_PointSize = 1.0;
      clipPosition = vec4(particleMotionUv.xy * 2.0 - 1.0, 0.0, 1.0);
    #else
      clipPosition.xy += state.xy * clipPosition.w;
    #endif
  }


  
  float galaxyParticleRevealProgress(float progress, float seed) {
    float delay = seed * 0.015;
    return smoothstep(delay, 0.14 + delay, progress)
      * mix(0.2, 1.0, smoothstep(0.2, 1.0, progress));
  }

  
  vec2 galaxyDispersedMotion(
    float time,
    float scatterX,
    float scatterY,
    float scatterZ,
    float scrollDrift,
    float strength
  ) {
    float depth = clamp(scatterZ, 0.0, 1.0);
    float motion = clamp(strength, 0.0, 1.0);
    float speed = mix(
      .4,
      .8,
      depth
    );
    float amount = mix(
      .035,
      .12,
      depth
    ) * motion;
    float phaseX = scatterX * 6.28318530718 + scatterY * 2.7;
    float phaseY = scatterY * 6.28318530718 + scatterZ * 3.1;
    float parallax = scrollDrift * mix(
      .08,
      .28,
      depth * depth
    ) * motion;

    return vec2(
      (sin(phaseX + time * speed) - sin(phaseX)) * amount,
      (cos(phaseY + time * speed * 0.73) - cos(phaseY)) * amount
        + parallax
    );
  }

  
  vec3 galaxyIntroMotion(
    vec3 position, vec3 scattered, float progress,
    float seed, float travelSeed
  ) {
    if (progress >= 1.0) return position;
    float start = 0.14 + seed * 0.18;
    float duration = 0.58 + travelSeed * 0.1;
    float local = clamp((progress - start) / duration, 0.0, 1.0);
    float smoothPull = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
    float pull = mix(smoothPull, sin(smoothPull * 3.14159265359 * 0.5), 0.5);
    float angle = sin(pull * 3.14159265359) * (0.44 + seed * 0.22);
    float c = cos(angle);
    float s = sin(angle);
    vec3 orbiting = vec3(
      scattered.x * c - scattered.y * s,
      scattered.x * s + scattered.y * c,
      scattered.z
    );
    return mix(orbiting, position, pull);
  }

  
  vec3 galaxyTiltSpiral(vec3 position, float angle) {
    float cosine = cos(angle);
    float sine = sin(angle);
    return vec3(
      position.x,
      position.y * cosine - position.z * sine,
      position.y * sine + position.z * cosine
    );
  }


  // xyz is the point on the path; w is the arm's half-width there, in world
  // units, so a star can hold its position *across* the arm as a fraction of
  // the local width rather than as a fixed distance. The galaxy build writes
  // w = 1 throughout, which makes the scaling below a no-op.
  vec4 samplePath(float progress) {
    float scaledProgress = clamp(progress, 0.0, 1.0)
      * (uPathSampleCount - 1.0);
    float lowerIndex = floor(scaledProgress);
    float upperIndex = min(lowerIndex + 1.0, uPathSampleCount - 1.0);
    float blend = fract(scaledProgress);
    vec4 lowerPoint = texture2D(
      uPathTexture,
      vec2((lowerIndex + 0.5) / uPathSampleCount, 0.5)
    );
    vec4 upperPoint = texture2D(
      uPathTexture,
      vec2((upperIndex + 0.5) / uPathSampleCount, 0.5)
    );
    return mix(lowerPoint, upperPoint, blend);
  }

  vec4 samplePathShape(float progress) {
    float scaledProgress = clamp(progress, 0.0, 1.0)
      * (uPathShapeSampleCount - 1.0);
    float lowerIndex = floor(scaledProgress);
    float upperIndex = min(lowerIndex + 1.0, uPathShapeSampleCount - 1.0);
    float blend = fract(scaledProgress);
    vec4 lowerPoint = texture2D(
      uPathShapeTexture,
      vec2((lowerIndex + 0.5) / uPathShapeSampleCount, 0.5)
    );
    vec4 upperPoint = texture2D(
      uPathShapeTexture,
      vec2((upperIndex + 0.5) / uPathShapeSampleCount, 0.5)
    );
    return mix(lowerPoint, upperPoint, blend);
  }

  vec2 samplePathShapeRange(float progress) {
    float sampleIndex = min(
      floor(clamp(progress, 0.0, 0.999999) * uPathShapeSampleCount),
      uPathShapeSampleCount - 1.0
    );
    return texture2D(
      uPathShapeTexture,
      vec2((sampleIndex + 0.5) / uPathShapeSampleCount, 0.5)
    ).zw;
  }

  void main() {
    float pathPhase = fract(orbitProgress + uPathOffset);
    float targetProgress = pathPhase + uDensityFalloff
      * sin(pathPhase * 6.28318530718)
      / 6.28318530718;
    float outwardTarget = uGrowthDirection > 0.0
      ? targetProgress
      : 1.0 - targetProgress;
    float growthBirth = outwardTarget * 0.24;
    float growthLocal = clamp(
      (uGrowthProgress - growthBirth) / max(1.0 - growthBirth, 0.0001),
      0.0,
      1.0
    );
    float growthTravel = growthLocal * growthLocal * (3.0 - 2.0 * growthLocal);
    float growthStart = uGrowthDirection > 0.0 ? 0.0 : 1.0;
    float emittedProgress = mix(growthStart, targetProgress, growthTravel);
    float progress = mix(targetProgress, emittedProgress, uGrowthEnabled);
    float growthVisibility = smoothstep(
      growthBirth,
      growthBirth + 0.025,
      uGrowthProgress
    );
    float middleWeight = sin(clamp(progress, 0.0, 1.0) * 3.14159265359);
    float sizeEnvelope = mix(
      1.0,
      0.14 + 0.86 * pow(max(middleWeight, 0.0), 0.68),
      uSizeFalloff
    );
    // An open arm fades its two tips out. A closed loop has no tips: progress
    // 0 and 1 are the same point, so fading there cuts a visible gap at the
    // seam. uPathLoop holds both ends fully lit.
    float endpointVisibility = mix(
      smoothstep(0.0, 0.055, progress) * (1.0 - smoothstep(0.945, 1.0, progress)),
      1.0,
      uPathLoop
    );
    vec3 animatedPosition = position;

    if (uPathMotion > 0.5) {
      // Fully dispersed stars no longer use the spiral position. Preserve its
      // size/opacity envelopes, but avoid six texture reads per star throughout
      // the article. Other authored entrance presets still need radial distance.
      if (uScrollPositionProgress < 1.0 || uFormationEnabled > 0.5 || uGrowthEnabled > 0.5) {
        float tangentStep = 1.0 / max(uPathSampleCount - 1.0, 1.0);
        vec4 pathSample = samplePath(progress);
        vec3 pathPosition = pathSample.xyz;
        vec3 before = samplePath(max(progress - tangentStep, 0.0)).xyz;
        vec3 after = samplePath(min(progress + tangentStep, 1.0)).xyz;
        vec3 tangent = normalize(after - before);
        vec3 across = normalize(vec3(-tangent.y, tangent.x, 0.0));
        // Stars flow along the path, so a fixed offset across it would carry a
        // star born in the fat middle of an arm straight out through the side
        // of the shape as it reaches a tip. Scaling by the local half-width
        // keeps it inside: the arm narrows and its stars converge with it.
        float halfWidth = pathSample.w;
        animatedPosition = pathPosition
          + across * starAcrossOffset * halfWidth
            * mix(1.0, growthTravel, uGrowthEnabled)
          + vec3(
            0.0,
            0.0,
            starDepthOffset * halfWidth * mix(1.0, growthTravel, uGrowthEnabled)
          );
      }
    } else {
      sizeEnvelope = 1.0;
      endpointVisibility = 1.0;
    }

    float radialDistance = length(animatedPosition.xy);
    float localProgress = clamp(
      uFormationProgress
        - radialDistance * uPropagationSoftness * 0.018,
      0.0,
      1.0
    );
    float accretionEnd = clamp(uAccretionRatio, 0.12, 0.72);
    float settleStart = max(accretionEnd + 0.08, 1.0 - uSettleRatio);
    float inward = smoothstep(0.0, accretionEnd, localProgress);
    float exhale = smoothstep(accretionEnd, settleStart, localProgress);
    vec2 radialDirection = animatedPosition.xy / max(radialDistance, 0.0001);
    vec3 farPosition = animatedPosition;
    farPosition.xy += radialDirection * uInwardStrength * (2.0 + radialDistance * 0.28);
    farPosition.z += uInwardStrength * 0.8;
    vec3 condensedPosition = vec3(
      animatedPosition.xy * 0.045,
      animatedPosition.z * 0.12
    );
    vec3 formedPosition = mix(farPosition, condensedPosition, inward);
    formedPosition = mix(formedPosition, animatedPosition, exhale);
    formedPosition.xy += radialDirection
      * sin(exhale * 3.14159265359)
      * (1.0 - exhale)
      * uExhaleStrength;
    float formationVisibility = mix(0.06, 0.58, inward);
    formationVisibility = mix(formationVisibility, 1.0, exhale);
    float coreBurst = exp(-pow((localProgress - accretionEnd) * 11.0, 2.0));
    animatedPosition = mix(animatedPosition, formedPosition, uFormationEnabled);
    float scatterX = fract(sin(
      dot(vec2(orbitProgress, twinklePhase), vec2(127.1, 311.7))
    ) * 43758.5453);
    float scatterY = fract(sin(
      dot(vec2(twinklePhase, starScale), vec2(269.5, 183.3))
    ) * 43758.5453);
    float scatterZ = fract(sin(
      dot(vec2(orbitProgress, starBrightness), vec2(419.2, 371.9))
    ) * 43758.5453);
    float clearanceSeed = fract(sin(
      dot(vec2(starOpacity, twinkleRate), vec2(157.3, 283.9))
    ) * 43758.5453);
    float trackedStarWeight = starHero * uPathShapeTrackingEnabled;
    scatterX = mix(scatterX, uTrackedScatter.x, trackedStarWeight);
    scatterY = mix(scatterY, uTrackedScatter.y, trackedStarWeight);
    scatterZ = mix(scatterZ, uTrackedScatter.z, trackedStarWeight);
    clearanceSeed = mix(
      clearanceSeed,
      uTrackedClearanceSeed,
      trackedStarWeight
    );
    float keepInCenter = step(0.72, clearanceSeed);
    float scatterSide = scatterX < 0.5 ? -1.0 : 1.0;
    // Thin the inner edge so the rails read as a loose field rather than a wall.
    float outerProgress = sqrt(fract(scatterX * 2.0));
    float outerX = scatterSide * mix(
      scatterSide < 0.0 ? -uTextBounds.x : uTextBounds.y,
      uScatterSize.x * 0.5,
      outerProgress
    );
    vec3 scatteredPosition = vec3(
      mix(outerX, (scatterX - 0.5) * uScatterSize.x, keepInCenter),
      (scatterY - 0.5) * uScatterSize.y,
      (scatterZ - 0.5) * 0.5
    );
    vec2 dispersedOffset = galaxyDispersedMotion(
      uTime,
      scatterX,
      scatterY,
      scatterZ,
      uScrollDrift,
      uDispersedMotion
    );
    scatteredPosition.x += dispersedOffset.x;
    scatteredPosition.y = mod(
      scatteredPosition.y + dispersedOffset.y + uScatterSize.y * 0.5,
      uScatterSize.y
    ) - uScatterSize.y * 0.5;
    scatteredPosition.y -= sin(uScrollPositionProgress * 3.14159265359)
      * (0.15 + scatterZ * 0.25);
    // The opening field fills the viewport; text clearance belongs to scrolling.
    vec3 introScattered = vec3(
      (scatterX - 0.5) * uScatterSize.x,
      (fract(scatterY) - 0.5) * uScatterSize.y,
      (scatterZ - 0.5) * 0.5
    );
    // Extra stars stay in the sky while the full authored set forms the galaxy.
    float backgroundStar = starBackground * uBackgroundStarsEnabled;
    animatedPosition = galaxyTiltSpiral(animatedPosition, uSpiralTilt);
    animatedPosition = mix(
      animatedPosition,
      introScattered,
      backgroundStar
    );
    animatedPosition = mix(
      animatedPosition,
      scatteredPosition,
      uScrollPositionProgress
    );
    float pathShapeProgress = uPathShapeProgress * (1.0 - backgroundStar);
    float pathShapePositionProgress = uPathShapePositionProgress * (1.0 - backgroundStar);
    float pathShapeDepthCue = 1.0;
    float pathShapeOpacityCue = 1.0;
    float pathShapeBrightKeep = 1.0;
    float shapeBaseSeed = fract(
      orbitProgress * 0.754877666
      + twinklePhase * 0.159154943
      + starScale * 0.117
    );
    float pathShapeTrackingWeight = trackedStarWeight;
    shapeBaseSeed = mix(
      shapeBaseSeed,
      uPathShapeTrackedSeed,
      pathShapeTrackingWeight
    );
    if (pathShapeProgress > 0.0 || pathShapePositionProgress > 0.0) {
    vec2 shapeRange = samplePathShapeRange(shapeBaseSeed);
    float shapeRangeSpan = max(
      shapeRange.y - shapeRange.x,
      1.0 / uPathShapeSampleCount
    );
    float shapeLocalSeed = clamp(
      (shapeBaseSeed - shapeRange.x) / shapeRangeSpan,
      0.0,
      1.0
    );
    float shapeLocalPhase = fract(
      shapeLocalSeed + uPathShapeMotion / shapeRangeSpan
    );
    float shapeLocalProgress = shapeLocalPhase + uDensityFalloff
      * sin(shapeLocalPhase * 6.28318530718)
      / 6.28318530718;
    float shapeSeed = mix(
      shapeRange.x,
      shapeRange.y,
      shapeLocalProgress
    );
    float shapeStep = 1.0 / max(uPathShapeSampleCount - 1.0, 1.0);
    vec3 pathShapePosition = samplePathShape(shapeSeed).xyz;
    vec2 pathShapeBefore = samplePathShape(
      max(shapeSeed - shapeStep, shapeRange.x)
    ).xy * uPathShapeSize;
    vec2 pathShapeAfter = samplePathShape(
      min(shapeSeed + shapeStep, shapeRange.y)
    ).xy * uPathShapeSize;
    vec2 pathShapeTangent = normalize(
      pathShapeAfter - pathShapeBefore + vec2(0.0001, 0.0)
    );
    vec2 pathShapeAcross = vec2(
      -pathShapeTangent.y,
      pathShapeTangent.x
    );
    float pathShapeRandomAcrossScatter = mix(
      (scatterX + scatterY - 1.0) * 0.12,
      uPathShapeTrackedScatter.x,
      pathShapeTrackingWeight
    );
    float pathShapeScatter = (
      starAcrossOffset * 1.1
      + pathShapeRandomAcrossScatter
    ) * uPathShapeScatter;
    float pathShapeDepthEnvelope = sin(
      shapeLocalProgress * 3.14159265359
    );
    float pathShapeContourDepth = sin(
      shapeLocalProgress * 3.14159265359 * 1.35
        + uPathShapeDepthPhase
    ) * uPathShapeDepth * pathShapeDepthEnvelope;
    float pathShapeRandomDepthScatter = mix(
      (scatterZ - 0.5) * 0.22,
      uPathShapeTrackedScatter.y,
      pathShapeTrackingWeight
    );
    vec3 pathShapeOffset = vec3(
      pathShapePosition.xy * uPathShapeSize
        + pathShapeAcross * pathShapeScatter,
      pathShapeContourDepth
      + starDepthOffset * 0.75
      + pathShapeRandomDepthScatter
    );
    pathShapeOffset.z *= uPathShapeScatter;
    float pathShapeCosX = cos(uPathShapeRotation.x);
    float pathShapeSinX = sin(uPathShapeRotation.x);
    pathShapeOffset = vec3(
      pathShapeOffset.x,
      pathShapeOffset.y * pathShapeCosX
        - pathShapeOffset.z * pathShapeSinX,
      pathShapeOffset.y * pathShapeSinX
        + pathShapeOffset.z * pathShapeCosX
    );
    float pathShapeCosY = cos(uPathShapeRotation.y);
    float pathShapeSinY = sin(uPathShapeRotation.y);
    pathShapeOffset = vec3(
      pathShapeOffset.x * pathShapeCosY
        + pathShapeOffset.z * pathShapeSinY,
      pathShapeOffset.y,
      -pathShapeOffset.x * pathShapeSinY
        + pathShapeOffset.z * pathShapeCosY
    );
    pathShapePosition = vec3(uPathShapeCenter, 0.0) + pathShapeOffset;
    float pathShapeFrontness = smoothstep(-1.15, 1.15, pathShapeOffset.z);
    pathShapeDepthCue = mix(0.78, 1.18, pathShapeFrontness);
    pathShapeOpacityCue = mix(0.72, 1.0, pathShapeFrontness);
    float pathShapeMiddleWeight = sin(
      clamp(shapeLocalProgress, 0.0, 1.0) * 3.14159265359
    );
    float pathShapeSizeEnvelope = mix(
      1.0,
      0.14 + 0.86 * pow(max(pathShapeMiddleWeight, 0.0), 0.68),
      uSizeFalloff
    );
    float pathShapeEndpointVisibility = smoothstep(
      0.0,
      0.055,
      shapeLocalProgress
    ) * (1.0 - smoothstep(0.945, 1.0, shapeLocalProgress));
    float pathShapeBrightSeed = fract(sin(
      dot(vec2(orbitProgress, twinklePhase), vec2(193.7, 417.2))
    ) * 43758.5453);
    pathShapeBrightKeep = max(
      starHero,
      step(1.0 - uPathShapeBrightRetention, pathShapeBrightSeed)
    );
    animatedPosition = mix(
      animatedPosition,
      pathShapePosition,
      pathShapePositionProgress
    );
    endpointVisibility = mix(endpointVisibility, 1.0, uScrollScatter);
    sizeEnvelope = mix(sizeEnvelope, 1.0, uScrollScatter);
    endpointVisibility = mix(
      endpointVisibility,
      pathShapeEndpointVisibility,
      pathShapeProgress
    );
    sizeEnvelope = mix(
      sizeEnvelope,
      pathShapeSizeEnvelope,
      pathShapeProgress
    );
    }

    // Scroll and cue morphs move the destination without ending the intro pull.
    animatedPosition = galaxyIntroMotion(
      animatedPosition, introScattered, mix(uIntroProgress, 1.0, backgroundStar),
      scatterZ, scatterY
    );
    float twinkle = 0.86 + 0.14 * sin(
      twinklePhase + uTime * uTwinkleSpeed * twinkleRate
    );
    float brightStarWeight = smoothstep(1.35, 1.65, starBrightness);
    float pathShapeSuppressedBright = pathShapeProgress
      * brightStarWeight
      * (1.0 - pathShapeBrightKeep);
    vBrightness = uIntensity * starBrightness * twinkle
      * mix(
        1.0,
        uAmbientPulse + coreBurst * (uCoreIntensity - 1.0),
        uFormationEnabled
      )
      * mix(1.0, pathShapeDepthCue, pathShapeProgress)
      * mix(1.0, 0.42, pathShapeSuppressedBright);
    vColor = starColor;
    vOpacity = starOpacity
      * endpointVisibility
      * (0.92 + twinkle * 0.08)
      * mix(1.0, formationVisibility, uFormationEnabled);
    vOpacity *= mix(1.0, growthVisibility, uGrowthEnabled);
    vOpacity *= mix(1.0, pathShapeOpacityCue, pathShapeProgress);
    vRayStrength = smoothstep(1.45, 2.8, starBrightness)
      * mix(1.0, pathShapeBrightKeep, pathShapeProgress);
    float scrollSizeScale = mix(
      uScrollSizeScale,
      1.0,
      pathShapeProgress * brightStarWeight * pathShapeBrightKeep
    );
    // Reveal the dispersed field before pulling its stars into place.
    float introLocalProgress = galaxyParticleRevealProgress(
      uIntroProgress,
      scatterZ
    );
    float backgroundPresence = backgroundStar
      * max(1.0 - uScrollScatter, uPathShapeProgress);
    scrollSizeScale = mix(scrollSizeScale, 1.0, backgroundPresence);
    vOpacity *= mix(1.0, uBackgroundStarsEnabled, starBackground);
    introLocalProgress = mix(
      introLocalProgress, min(introLocalProgress, 0.2), backgroundPresence
    );
    float introParticleScale = sqrt(introLocalProgress);
    vOpacity *= smoothstep(
      0.0,
      .2,
      introLocalProgress
    );
    gl_PointSize = uPixelRatio
      * (0.35 + starScale * sizeEnvelope * endpointVisibility * 3.8)
      * (0.97 + twinkle * 0.03)
      * mix(1.0, 1.0 + coreBurst * 0.42, uFormationEnabled)
      * mix(1.0, 0.3 + growthVisibility * 0.7, uGrowthEnabled)
      * scrollSizeScale
      * mix(1.0, pathShapeDepthCue, pathShapeProgress)
      * introParticleScale;
    vec4 viewPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
    if (backgroundStar > 0.5) {
      viewPosition = viewMatrix * (uBackgroundModelMatrix * vec4(animatedPosition, 1.0));
    }
    vec4 clipPosition = projectionMatrix * viewPosition;
    vec2 ndc = clipPosition.xy / max(clipPosition.w, 0.0001);
    vLens = 0.0;
    if (uLensActive > 0.0) {
      float lensDistance = length(ndc - uLensPointer);
      vLens = (1.0 - smoothstep(0.0, uLensRadius, lensDistance))
        * uLensActive;
      viewPosition.z += vLens * uLensDepth;
      clipPosition = projectionMatrix * viewPosition;
      clipPosition.xy = uLensPointer * clipPosition.w
        + (clipPosition.xy - uLensPointer * clipPosition.w)
        * (1.0 + vLens * uLensMagnification);
    }
    vBrightness *= 1.0 + vLens * uLensIllumination;
    gl_PointSize *= 1.0 + vLens * uLensMagnification * 0.7;
    vParticleDiameter = gl_PointSize;
    gl_PointSize = max(gl_PointSize, 4.0);
    galaxyParticleMotion(clipPosition);
    gl_Position = clipPosition;
  }
`,
  fragment: `
  varying float vBrightness;
  varying vec3 vColor;
  varying float vLens;
  varying float vOpacity;
  varying float vRayStrength;
  
  varying float vParticleDiameter;
  float galaxyCubicCoverage(float coordinate) {
    float x = abs(coordinate);
    if (x < 1.0) return (4.0 - 6.0 * x * x + 3.0 * x * x * x) / 6.0;
    float tail = max(2.0 - x, 0.0);
    return tail * tail * tail / 6.0;
  }
  float galaxyFilteredCore(vec2 pixel, float area) {
    return galaxyCubicCoverage(pixel.x) * galaxyCubicCoverage(pixel.y)
      * area * vParticleDiameter * vParticleDiameter;
  }


  void main() {
    vec2 pixel = (gl_PointCoord - vec2(0.5)) * max(vParticleDiameter, 4.0);
    vec2 point = pixel * 2.0 / max(vParticleDiameter, 0.0001);
    float distanceToCenter = length(point);
    float disc = 1.0 - smoothstep(0.08, 1.0, distanceToCenter);
    float core = pow(disc, 2.2);
    float horizontalRay = exp(-abs(point.y) * 28.0)
      * (1.0 - smoothstep(0.18, 1.0, abs(point.x)));
    float verticalRay = exp(-abs(point.x) * 28.0)
      * (1.0 - smoothstep(0.18, 1.0, abs(point.y)));
    float rays = max(horizontalRay, verticalRay) * 0.28 * vRayStrength;
    float resolved = smoothstep(2.0, 4.0, vParticleDiameter);
    float alpha = mix(galaxyFilteredCore(pixel, 0.150904), max(core, rays), resolved)
      * vOpacity;

    if (alpha <= 0.0) {
      discard;
    }

    float whiteCore = mix(0.59228, core, resolved)
      * smoothstep(0.9, 2.8, vBrightness)
      * 0.82;
    float colorEnergy = 1.0
      - min(vColor.r, min(vColor.g, vColor.b));
    vec3 emission = mix(vColor, vec3(1.0), whiteCore)
      * vBrightness
      * (1.0 + colorEnergy * 0.42);
    gl_FragColor = vec4(emission, alpha);
  }
`,
};
