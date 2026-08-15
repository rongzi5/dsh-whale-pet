/**
 * Material factories for the procedural whale scene.
 *
 * The body material carries the blue/white logo mask shader; the remaining
 * materials are simple flat-shaded surfaces. Keeping them here keeps
 * `scene.ts` focused on composition and resource lifetime.
 */

import * as THREE from 'three'

import { CFG } from './config.ts'

// @types/three@0.147 does not model Material.extensions although three r147
// initializes it to `{}`; augment so the shader's derivatives flag type-checks.
declare module 'three' {
  interface Material {
    extensions: {
      derivatives?: boolean | undefined
      fragDepth?: boolean | undefined
      drawBuffers?: boolean | undefined
      shaderTextureLOD?: boolean | undefined
    }
  }
}

/** Body material with the blue/white mask driven by the mid/radius texture. */
export function createBodyMaterial(mrTex: THREE.DataTexture, bb: THREE.Box3): THREE.MeshBasicMaterial {
  const bodyMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  bodyMat.extensions = { derivatives: true }
  bodyMat.onBeforeCompile = (sh) => {
    sh.uniforms.uMR = { value: mrTex }
    sh.uniforms.uMin = { value: bb.min.x }
    sh.uniforms.uMax = { value: bb.max.x }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPos = position;')
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vPos;\nuniform sampler2D uMR;\nuniform float uMin, uMax;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float u = clamp((vPos.x - uMin) / (uMax - uMin), 0.0, 1.0);
          float midY = texture2D(uMR, vec2(u, 0.5)).r;
          float ang = 3.14159265 - abs(atan(vPos.z, vPos.y - midY));
          float baseScale = 0.77 * 1.1;
          float uCenter = 0.28, uHalf = 0.245 * baseScale, angMax = 0.84 * baseScale;
          float headFactor = 1.0 - smoothstep(0.18, 0.52, u);
          float angMaxAdjusted = angMax * (1.0 + 0.7 * headFactor);
          float uu = (0.16 + 0.49 * u - uCenter) / uHalf;
          float nn = ang / angMaxAdjusted;
          float rr = uu * uu + nn * nn;
          float tailZone = smoothstep(0.40, 0.58, u) * (1.0 - smoothstep(0.80, 0.86, u));
          float peak = 0.78, bumpWidth = 0.11, bumpStrength = 1.0;
          float d = nn - peak;
          float bump = tailZone * bumpStrength * exp(-d*d / (bumpWidth*bumpWidth));
          float threshold = 1.0 + bump;
          float aa = fwidth(rr) * 1.2 + 2e-4;
          float a = 1.0 - smoothstep(threshold - aa, threshold + aa, rr);
          diffuseColor.rgb = mix(vec3(0.302, 0.420, 0.996), vec3(1.0), a);
        }`,
      )
  }
  return bodyMat
}

/** White brow patch material (double-sided, polygon-offset to avoid z-fight). */
export function createBrowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: CFG.COLOR_WHITE,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
}

/** White eye material; opacity is animated for blinking/sleep/error states. */
export function createEyeMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: CFG.COLOR_WHITE,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    transparent: true,
    opacity: 1.0,
  })
}

/** Simple flat material for fins and tail. */
export function createFinMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
}
