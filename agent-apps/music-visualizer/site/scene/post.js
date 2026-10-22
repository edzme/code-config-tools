// The post chain: the scene, bloom on the brightest light only (the orb's rim, sparks, and veins) so forms keep
// their shape, then one pass for the beat's chromatic aberration kick, a vignette that opens on the hit, a lift of
// light on a drop, and film grain on dark themes, then the output transform. Built or skipped by tier.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAberration: { value: 0 },
    uGrain: { value: 0.06 },
    uVignette: { value: 0.35 },
    uFlash: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uFlash;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 fromCenter = vUv - 0.5;
      float edge = dot(fromCenter, fromCenter);
      vec2 shift = fromCenter * uAberration * (0.6 + edge * 2.0);
      vec4 base = texture2D(tDiffuse, vUv);
      float r = texture2D(tDiffuse, vUv + shift).r;
      float b = texture2D(tDiffuse, vUv - shift).b;
      vec3 color = vec3(r, base.g, b);
      color *= 1.0 + uFlash;
      color *= 1.0 - uVignette * smoothstep(0.08, 0.6, edge);
      float n = hash(vUv * uResolution + fract(uTime * 7.31) * 100.0) - 0.5;
      color += n * uGrain * (0.35 + 0.65 * (1.0 - dot(color, vec3(0.333))));
      gl_FragColor = vec4(max(color, 0.0), base.a);
    }
  `,
};

export function createPost(renderer, tier) {
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(tier.ratio);
  composer.setSize(size.x, size.y);
  const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  const bloomScale = tier.name === "desktop" ? 1 : 0.5;
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x * bloomScale, size.y * bloomScale), 1, 0.6, 0.1);
  const finish = new ShaderPass(FinishShader);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(finish);
  composer.addPass(output);

  let glow = 1;
  let grain = 0.06;
  let vignette = 0.35;
  let dark = true;

  return {
    setTheme(tokens) {
      glow = tokens.glow;
      grain = tokens.grain;
      dark = tokens.dark;
      vignette = dark ? 0.5 : 0.16;
      bloom.enabled = glow >= 0.3;
      bloom.threshold = this.threshold ?? (dark ? 0.08 : 0.85);
      bloom.radius = this.threshold === undefined ? 0.55 : 0.42;
    },
    // A scene may name its own bloom threshold; without one, everything that glows on dark blooms.
    setScene(scene, camera, bloomBase = 1, threshold = undefined) {
      renderPass.scene = scene;
      renderPass.camera = camera;
      this.bloomBase = bloomBase;
      this.threshold = threshold;
      bloom.threshold = threshold ?? (dark ? 0.08 : 0.85);
      bloom.radius = threshold === undefined ? 0.55 : 0.42;
    },
    threshold: undefined,
    bloomBase: 1,
    render(dt, bands, beat, time, extraAberration = 0) {
      const drop = beat.drop || 0;
      bloom.strength = glow * this.bloomBase * (0.6 + bands.energy * 0.3 + beat.pulse * 0.3 + drop * 0.25);
      finish.uniforms.uTime.value = time;
      finish.uniforms.uAberration.value = beat.pulse * 0.022 + drop * 0.03 + extraAberration;
      finish.uniforms.uGrain.value = grain;
      finish.uniforms.uVignette.value = vignette * (1 - beat.pulse * 0.35 - drop * 0.25);
      finish.uniforms.uFlash.value = dark ? beat.pulse * 0.03 + drop * 0.06 : 0;
      composer.render(dt);
    },
    resize(w, h, ratio) {
      composer.setPixelRatio(ratio);
      composer.setSize(w, h);
      bloom.setSize(w * ratio * bloomScale, h * ratio * bloomScale);
      finish.uniforms.uResolution.value.set(w * ratio, h * ratio);
    },
    dispose() {
      composer.dispose();
      bloom.dispose();
    },
  };
}
