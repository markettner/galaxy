// Postprocessing GLSL for the bloom + lens-flare chain.
//   luminance / reconstruct / flare_glass / fullscreen -> custom
//   downsample / upsample                              -> pmndrs postprocessing
window.GALAXY_POST_SHADERS = {
  downsample_frag: `#ifdef FRAMEBUFFER_PRECISION_HIGH
uniform mediump sampler2D inputBuffer;
#else
uniform lowp sampler2D inputBuffer;
#endif
#define WEIGHT_INNER 0.125
#define WEIGHT_OUTER 0.0555555
varying vec2 vUv;varying vec2 vUv00;varying vec2 vUv01;varying vec2 vUv02;varying vec2 vUv03;varying vec2 vUv04;varying vec2 vUv05;varying vec2 vUv06;varying vec2 vUv07;varying vec2 vUv08;varying vec2 vUv09;varying vec2 vUv10;varying vec2 vUv11;float clampToBorder(const in vec2 uv){return float(uv.s>=0.0&&uv.s<=1.0&&uv.t>=0.0&&uv.t<=1.0);}void main(){vec4 c=vec4(0.0);vec4 w=WEIGHT_INNER*vec4(clampToBorder(vUv00),clampToBorder(vUv01),clampToBorder(vUv02),clampToBorder(vUv03));c+=w.x*texture2D(inputBuffer,vUv00);c+=w.y*texture2D(inputBuffer,vUv01);c+=w.z*texture2D(inputBuffer,vUv02);c+=w.w*texture2D(inputBuffer,vUv03);w=WEIGHT_OUTER*vec4(clampToBorder(vUv04),clampToBorder(vUv05),clampToBorder(vUv06),clampToBorder(vUv07));c+=w.x*texture2D(inputBuffer,vUv04);c+=w.y*texture2D(inputBuffer,vUv05);c+=w.z*texture2D(inputBuffer,vUv06);c+=w.w*texture2D(inputBuffer,vUv07);w=WEIGHT_OUTER*vec4(clampToBorder(vUv08),clampToBorder(vUv09),clampToBorder(vUv10),clampToBorder(vUv11));c+=w.x*texture2D(inputBuffer,vUv08);c+=w.y*texture2D(inputBuffer,vUv09);c+=w.z*texture2D(inputBuffer,vUv10);c+=w.w*texture2D(inputBuffer,vUv11);c+=WEIGHT_OUTER*texture2D(inputBuffer,vUv);gl_FragColor=c;
#include <colorspace_fragment>
}
`,
  downsample_vert: `uniform vec2 texelSize;varying vec2 vUv;varying vec2 vUv00;varying vec2 vUv01;varying vec2 vUv02;varying vec2 vUv03;varying vec2 vUv04;varying vec2 vUv05;varying vec2 vUv06;varying vec2 vUv07;varying vec2 vUv08;varying vec2 vUv09;varying vec2 vUv10;varying vec2 vUv11;void main(){vUv=position.xy*0.5+0.5;vUv00=vUv+texelSize*vec2(-1.0,1.0);vUv01=vUv+texelSize*vec2(1.0,1.0);vUv02=vUv+texelSize*vec2(-1.0,-1.0);vUv03=vUv+texelSize*vec2(1.0,-1.0);vUv04=vUv+texelSize*vec2(-2.0,2.0);vUv05=vUv+texelSize*vec2(0.0,2.0);vUv06=vUv+texelSize*vec2(2.0,2.0);vUv07=vUv+texelSize*vec2(-2.0,0.0);vUv08=vUv+texelSize*vec2(2.0,0.0);vUv09=vUv+texelSize*vec2(-2.0,-2.0);vUv10=vUv+texelSize*vec2(0.0,-2.0);vUv11=vUv+texelSize*vec2(2.0,-2.0);gl_Position=vec4(position.xy,1.0,1.0);}
`,
  flare_glass_frag: `uniform sampler2D uDirtTexture;
  varying vec2 vPrimaryMotion;
  varying vec2 vSecondaryMotion[5];
  uniform vec2 uCenter;
  uniform float uAnimated;
  uniform float uAspect;
  uniform float uDirtyGlassEnabled;
  uniform float uDistortion;
  uniform float uDirtTextureAspect;
  uniform vec2 uDirtTextureOffset;
  uniform float uDirtTextureRotation;
  uniform float uFlareEnabled;
  uniform float uGhosts;
  uniform float uGrain;
  uniform float uHalo;
  uniform float uIntensity;
  uniform float uProceduralDirt;
  uniform vec2 uSecondaryCenters[5];
  uniform float uSecondaryIntensity;
  uniform float uSecondaryVisibility[5];
  uniform float uStreakLength;
  uniform float uStreaks;
  uniform float uTime;
  uniform float uTextureDirt;
  uniform float uVerticalStreaks;
  uniform float uVisibility;

  float galaxyHash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float softDisc(vec2 point, float radius, float softness) {
    return 1.0 - smoothstep(radius - softness, radius + softness, length(point));
  }

  float softRing(vec2 point, float radius, float width) {
    float distanceToRing = abs(length(point) - radius);
    return 1.0 - smoothstep(width, width * 2.0, distanceToRing);
  }

  vec2 aspectCorrect(vec2 point) {
    point.x *= uAspect;
    return point;
  }

  vec2 coverTextureUv(vec2 uv, float viewportAspect, float textureAspect) {
    vec2 centeredUv = uv - 0.5;

    if (viewportAspect > textureAspect) {
      centeredUv.y *= textureAspect / viewportAspect;
    } else {
      centeredUv.x *= viewportAspect / textureAspect;
    }

    return centeredUv + 0.5;
  }

  float secondaryFlare(vec2 center, vec2 uv) {
    vec2 point = aspectCorrect(uv - center);
    float distanceToSource = length(point);
    // The matched particle and bloom already provide the sharp stellar core.
    // Optics should add only a soft halo and restrained glass streaks so a
    // tiny tracking difference can never read as a second, detached star.
    float nearHalo = exp(-distanceToSource * distanceToSource * 520.0) * 0.1;
    float halo = exp(-distanceToSource * 17.0) * 0.055;
    float horizontalWindow = 1.0 - smoothstep(
      uStreakLength * 0.72,
      uStreakLength,
      abs(point.x)
    );
    float verticalWindow = 1.0 - smoothstep(
      uStreakLength * 0.72,
      uStreakLength,
      abs(point.y)
    );
    horizontalWindow = mix(horizontalWindow, 1.0, step(0.99, uStreakLength));
    verticalWindow = mix(verticalWindow, 1.0, step(0.99, uStreakLength));
    float horizontalStreak = exp(-abs(point.y) * 360.0)
      * exp(-abs(point.x) * 10.0) * horizontalWindow * 0.24;
    float verticalStreak = exp(-abs(point.x) * 360.0)
      * exp(-abs(point.y) * 10.0) * verticalWindow * 0.24 * uVerticalStreaks;

    return nearHalo + halo + horizontalStreak + verticalStreak;
  }

  void mainImage(
    const in vec4 inputColor,
    const in vec2 uv,
    out vec4 outputColor
  ) {
    vec3 base = inputColor.rgb;
    vec2 movingCenter = uCenter + vPrimaryMotion;
    vec2 source = aspectCorrect(uv - movingCenter);
    float sourceDistance = length(source);

    float core = exp(-sourceDistance * sourceDistance * 480.0) * 0.18;
    float halo = exp(-sourceDistance * 11.5) * uHalo;
    halo += softRing(source, 0.105, 0.006) * 0.05 * uHalo;

    float horizontalWindow = 1.0 - smoothstep(
      uStreakLength * 0.72,
      uStreakLength,
      abs(source.x)
    );
    float verticalWindow = 1.0 - smoothstep(
      uStreakLength * 0.72,
      uStreakLength,
      abs(source.y)
    );
    horizontalWindow = mix(horizontalWindow, 1.0, step(0.99, uStreakLength));
    verticalWindow = mix(verticalWindow, 1.0, step(0.99, uStreakLength));
    float horizontalStreak = exp(-abs(source.y) * 310.0)
      * exp(-abs(source.x) * 7.5) * horizontalWindow;
    float softHorizontalStreak = exp(-abs(source.y) * 78.0)
      * exp(-abs(source.x) * 5.2) * horizontalWindow * 0.16;
    float verticalStreak = exp(-abs(source.x) * 310.0)
      * exp(-abs(source.y) * 7.5) * verticalWindow;
    float softVerticalStreak = exp(-abs(source.x) * 78.0)
      * exp(-abs(source.y) * 5.2) * verticalWindow * 0.16;
    float streak = (
      horizontalStreak +
      softHorizontalStreak +
      (verticalStreak + softVerticalStreak) * uVerticalStreaks
    ) * uStreaks;

    vec2 opticalAxis = vec2(0.5) - movingCenter;
    vec2 ghostA = aspectCorrect(uv - (movingCenter + opticalAxis * 0.82));
    vec2 ghostB = aspectCorrect(uv - (movingCenter + opticalAxis * 1.38));
    vec2 ghostC = aspectCorrect(uv - (movingCenter + opticalAxis * 1.82));
    float ghosts = 0.0;
    ghosts += softDisc(ghostA, 0.016, 0.014) * 0.18;
    ghosts += softRing(ghostB, 0.046, 0.006) * 0.11;
    ghosts += softDisc(ghostC, 0.025, 0.02) * 0.08;
    ghosts *= uGhosts;

    // Source motion owns the animation. An independent optical pulse made the
    // flare breathe against its matched particle and exposed tiny offsets.
    float flare = (core + halo + streak + ghosts) * uIntensity;
    float secondary = 0.0;
    float secondaryDirtHalo = 0.0;
    for (int i = 0; i < GALAXY_SECONDARY_SOURCES; i++) {
      vec2 secondaryCenter = uSecondaryCenters[i] + vSecondaryMotion[i];
      secondary += secondaryFlare(secondaryCenter, uv)
        * uSecondaryVisibility[i];
      secondaryDirtHalo += exp(
        -length(aspectCorrect(uv - secondaryCenter)) * 10.0
      ) * uSecondaryVisibility[i];
    }
    secondary *= uIntensity * uSecondaryIntensity;
    vec3 flareColor = vec3(0.956, 0.956, 0.956)
      * (flare * uVisibility + secondary) * uFlareEnabled;

    vec3 opticalColor = base + flareColor;
    float baseLuminance = dot(base, vec3(0.2126, 0.7152, 0.0722));
    float reveal = smoothstep(0.025, 0.72, baseLuminance);
    vec2 driftingDirtUv = uv - 0.5;
    float dirtRotationCos = cos(uDirtTextureRotation);
    float dirtRotationSin = sin(uDirtTextureRotation);
    driftingDirtUv = mat2(
      dirtRotationCos,
      -dirtRotationSin,
      dirtRotationSin,
      dirtRotationCos
    ) * driftingDirtUv;
    driftingDirtUv += uDirtTextureOffset;
    vec2 dirtTextureUv = clamp(coverTextureUv(
      driftingDirtUv + 0.5,
      uAspect,
      uDirtTextureAspect
    ), vec2(0.001), vec2(0.999));
    vec3 dirtTextureColor = texture2D(uDirtTexture, dirtTextureUv).rgb;
    float dirtTextureLuminance = dot(
      dirtTextureColor,
      vec3(0.2126, 0.7152, 0.0722)
    );
    float photographicDirt = smoothstep(0.1, 0.72, dirtTextureLuminance);
    // The generated map already contains broad clouds, wipe marks, and fine
    // grit. A softer transfer of the same field replaces two four-octave FBM
    // evaluations that previously repeated that work for every screen pixel.
    float proceduralDirt = smoothstep(0.025, 0.32, dirtTextureLuminance);
    float textureDirtAmount = uTextureDirt * uDirtyGlassEnabled;
    float proceduralDirtAmount = uProceduralDirt * uDirtyGlassEnabled;
    float dirtMask = clamp(
      photographicDirt * textureDirtAmount +
      proceduralDirt * proceduralDirtAmount,
      0.0,
      1.0
    );
    float dirtVariation = clamp(
      (photographicDirt - 0.4) * textureDirtAmount +
      (proceduralDirt - 0.4) * proceduralDirtAmount,
      -0.7,
      0.9
    );
    // Dirt responds to the rendered scene, not to the flare it is currently
    // generating. This removes the feedback-like pop at transition peaks.
    float dirtReveal = smoothstep(0.008, 0.2, baseLuminance)
      * (1.0 - smoothstep(0.9, 3.0, baseLuminance) * 0.68);
    float primaryDirtHalo = exp(-sourceDistance * 6.5) * uVisibility;
    float dirtHalo = (
      primaryDirtHalo + secondaryDirtHalo * uSecondaryIntensity
    ) * uIntensity * uFlareEnabled;

    #if GALAXY_DISTORTION == 1
    vec2 warpUvX = dirtTextureUv * vec2(0.72, 0.78) + vec2(0.17, 0.08);
    vec2 warpUvY = vec2(1.0 - dirtTextureUv.y, dirtTextureUv.x)
      * vec2(0.74, 0.7) + vec2(0.12, 0.16);
    float warpSampleX = texture2D(
      uDirtTexture,
      warpUvX
    ).r;
    float warpSampleY = texture2D(
      uDirtTexture,
      warpUvY
    ).r;
    vec2 warpField = clamp(
      (vec2(warpSampleX, warpSampleY) - dirtTextureLuminance) * 6.0,
      vec2(-0.5),
      vec2(0.5)
    );
    vec2 warp = warpField
      * vec2(1.0 / max(uAspect, 0.001), 1.0)
      * uDistortion * 0.004;
    vec3 warpedBase = texture2D(
      inputBuffer,
      clamp(uv + warp, vec2(0.001), vec2(0.999))
    ).rgb;
    opticalColor += (warpedBase - base)
      * reveal * uDirtyGlassEnabled * 0.55;
    #endif
    opticalColor *= 1.0 + dirtVariation
      * dirtReveal * 0.82;
    opticalColor += vec3(max(dirtVariation, 0.0))
      * dirtReveal
      * (0.022 + min(baseLuminance, 0.8) * 0.055);
    opticalColor += vec3(0.956)
      * dirtHalo
      * dirtMask * 0.14;

    float grain = galaxyHash(floor(uv * vec2(1536.0, 1024.0)));
    opticalColor += vec3((grain - 0.5) * uGrain)
      * (0.18 + reveal * 0.82) * uDirtyGlassEnabled;

    outputColor = vec4(max(opticalColor, vec3(0.0)), inputColor.a);
  }
`,
  fullscreen_vert: `varying vec2 vUv;
        void main() {
          vUv = position.xy * 0.5 + 0.5;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }
`,
  luminance_frag: `#include <common>
  uniform sampler2D inputBuffer;
  uniform vec2 sourceTexelSize;
  uniform float threshold;
  uniform float smoothing;
  varying vec2 vUv;
  void main() {
    vec2 offset = sourceTexelSize * 0.5;
    vec4 color = (
      texture2D(inputBuffer, vUv + vec2(-offset.x, -offset.y)) +
      texture2D(inputBuffer, vUv + vec2( offset.x, -offset.y)) +
      texture2D(inputBuffer, vUv + vec2(-offset.x,  offset.y)) +
      texture2D(inputBuffer, vUv + vec2( offset.x,  offset.y))
    ) * 0.25;
    gl_FragColor = color * smoothstep(threshold, threshold + smoothing, luminance(color.rgb));
  }
`,
  reconstruct_frag: `uniform sampler2D source;
  uniform vec2 stepSize;
  varying vec2 vUv;
  void main() {
    vec4 color = texture2D(source, vUv) * 0.2270270270;
    color += (texture2D(source, vUv + stepSize * 1.3846153846)
      + texture2D(source, vUv - stepSize * 1.3846153846)) * 0.3162162162;
    color += (texture2D(source, vUv + stepSize * 3.2307692308)
      + texture2D(source, vUv - stepSize * 3.2307692308)) * 0.0702702703;
    gl_FragColor = color;
  }
`,
  upsample_frag: `#ifdef FRAMEBUFFER_PRECISION_HIGH
uniform mediump sampler2D inputBuffer;uniform mediump sampler2D supportBuffer;
#else
uniform lowp sampler2D inputBuffer;uniform lowp sampler2D supportBuffer;
#endif
uniform float radius;varying vec2 vUv;varying vec2 vUv0;varying vec2 vUv1;varying vec2 vUv2;varying vec2 vUv3;varying vec2 vUv4;varying vec2 vUv5;varying vec2 vUv6;varying vec2 vUv7;void main(){vec4 c=vec4(0.0);c+=texture2D(inputBuffer,vUv0)*0.0625;c+=texture2D(inputBuffer,vUv1)*0.125;c+=texture2D(inputBuffer,vUv2)*0.0625;c+=texture2D(inputBuffer,vUv3)*0.125;c+=texture2D(inputBuffer,vUv)*0.25;c+=texture2D(inputBuffer,vUv4)*0.125;c+=texture2D(inputBuffer,vUv5)*0.0625;c+=texture2D(inputBuffer,vUv6)*0.125;c+=texture2D(inputBuffer,vUv7)*0.0625;vec4 baseColor=texture2D(supportBuffer,vUv);gl_FragColor=mix(baseColor,c,radius);
#include <colorspace_fragment>
}
`,
  upsample_vert: `uniform vec2 texelSize;varying vec2 vUv;varying vec2 vUv0;varying vec2 vUv1;varying vec2 vUv2;varying vec2 vUv3;varying vec2 vUv4;varying vec2 vUv5;varying vec2 vUv6;varying vec2 vUv7;void main(){vUv=position.xy*0.5+0.5;vUv0=vUv+texelSize*vec2(-1.0,1.0);vUv1=vUv+texelSize*vec2(0.0,1.0);vUv2=vUv+texelSize*vec2(1.0,1.0);vUv3=vUv+texelSize*vec2(-1.0,0.0);vUv4=vUv+texelSize*vec2(1.0,0.0);vUv5=vUv+texelSize*vec2(-1.0,-1.0);vUv6=vUv+texelSize*vec2(0.0,-1.0);vUv7=vUv+texelSize*vec2(1.0,-1.0);gl_Position=vec4(position.xy,1.0,1.0);}
`,
};
