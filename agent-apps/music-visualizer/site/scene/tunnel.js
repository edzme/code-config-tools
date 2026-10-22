// Tunnel: the camera flies down a winding path through hexagonal rings. Each kick swells the rings beside the
// camera first and the swell races ahead down the tunnel; ring brightness follows the spectrum, low notes close,
// high notes far. Sparks stream past along the walls.
import * as THREE from "three";

const SPACING = 1.7;
const WAVE_SPEED = 42;
const HISTORY = 180;

let scene;
let camera;
let rings;
let sparks;
let ringCount;
let travel = 0;
let time = 0;
let roll = 0;
let reduced = false;
let palette;
let dark = true;
const history = new Float32Array(HISTORY);
let historyAt = 0;
const dummy = new THREE.Object3D();
const color = new THREE.Color();
const here = new THREE.Vector3();
const ahead = new THREE.Vector3();

function path(z, out) {
  return out.set(Math.sin(z * 0.045) * 5 + Math.sin(z * 0.013) * 3, Math.cos(z * 0.035) * 3, z);
}

const pathGlsl = /* glsl */ `
  vec3 pathAt(float z) {
    return vec3(sin(z * 0.045) * 5.0 + sin(z * 0.013) * 3.0, cos(z * 0.035) * 3.0, z);
  }
`;

export function init({ tokens, tier, reduced: reduce }) {
  reduced = reduce;
  dark = tokens.dark;
  palette = [tokens.c1, tokens.c2, tokens.c3];
  ringCount = tier.name === "desktop" ? 72 : 56;
  const depth = ringCount * SPACING;
  scene = new THREE.Scene();
  scene.background = tokens.bg.clone();
  scene.fog = new THREE.Fog(tokens.bg.clone(), 8, depth * 0.95);
  camera = new THREE.PerspectiveCamera(70, 1, 0.1, 300);

  const geometry = new THREE.TorusGeometry(1, 0.035, 4, 6);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    fog: true,
    transparent: tokens.additive,
    blending: tokens.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !tokens.additive,
  });
  rings = new THREE.InstancedMesh(geometry, material, ringCount);
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < ringCount; i++) rings.setColorAt(i, color.setRGB(1, 1, 1));
  rings.instanceColor.setUsage(THREE.DynamicDrawUsage);
  rings.frustumCulled = false;
  scene.add(rings);

  const count = Math.round(2400 * tier.particles);
  const seeds = new Float32Array(count * 3);
  const sparkColors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    seeds[i * 3] = Math.random() * Math.PI * 2;
    seeds[i * 3 + 1] = 2.1 + Math.random() * 2.2;
    seeds[i * 3 + 2] = Math.random() * depth;
    const c = palette[i % 3];
    sparkColors[i * 3] = c.r;
    sparkColors[i * 3 + 1] = c.g;
    sparkColors[i * 3 + 2] = c.b;
  }
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute("position", new THREE.BufferAttribute(seeds, 3));
  sparkGeometry.setAttribute("color", new THREE.BufferAttribute(sparkColors, 3));
  sparks = new THREE.Points(
    sparkGeometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: tokens.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTravel: { value: 0 },
        uDepth: { value: depth },
        uTreble: { value: 0 },
        uSize: { value: 1 },
        uFog: { value: tokens.bg.clone() },
        uAlpha: { value: dark ? 0.9 : 0.7 },
      },
      vertexShader: /* glsl */ `
        uniform float uTravel;
        uniform float uDepth;
        uniform float uTreble;
        uniform float uSize;
        varying vec3 vColor;
        varying float vFar;
        ${pathGlsl}
        void main() {
          float d = mod(position.z - uTravel, uDepth);
          float z = -(uTravel + d);
          vec3 center = pathAt(z);
          vec3 p = center + vec3(cos(position.x), sin(position.x), 0.0) * position.y;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vColor = color;
          vFar = d / uDepth;
          gl_PointSize = uSize * (1.0 + uTreble * 1.5) * (14.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uFog;
        uniform float uAlpha;
        varying vec3 vColor;
        varying float vFar;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          if (d > 0.25) discard;
          float a = smoothstep(0.25, 0.0, d) * uAlpha * (1.0 - smoothstep(0.45, 1.0, vFar));
          gl_FragColor = vec4(vColor * 1.3, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  sparks.frustumCulled = false;
  scene.add(sparks);
  return { scene, camera, bloom: 0.65 };
}

export function update(bands, beat, dt) {
  time += dt;
  const pace = reduced ? 0.35 : 1;
  travel += dt * (11 + bands.energy * 9 + beat.pulse * 6) * pace;

  history[historyAt] = Math.min(1.4, bands.bass * 0.55 + beat.pulse * 0.85);
  historyAt = (historyAt + 1) % HISTORY;

  const first = Math.floor(travel / SPACING) + 1;
  const spectrum = bands.spectrum;
  for (let i = 0; i < ringCount; i++) {
    const k = first + i;
    const z = -k * SPACING;
    const d = k * SPACING - travel;
    const age = Math.min(HISTORY - 1, Math.round((d / WAVE_SPEED) * 60));
    const swell = history[(historyAt - 1 - age + HISTORY * 2) % HISTORY] * (reduced ? 0.4 : 1);
    path(z, here);
    path(z - 1, ahead);
    dummy.position.copy(here);
    dummy.lookAt(ahead);
    dummy.rotateZ(k * 0.11 + time * 0.15);
    dummy.scale.setScalar(2.7 * (1 + swell * 0.42));
    dummy.updateMatrix();
    rings.setMatrixAt(i, dummy.matrix);

    const s = spectrum[Math.min(spectrum.length - 1, Math.floor((d / (ringCount * SPACING)) * spectrum.length))];
    const c = palette[k % 3];
    const level = dark ? 0.22 + s * 0.8 + swell * 1.1 : 0.55 + s * 0.3 + swell * 0.2;
    color.copy(c).multiplyScalar(level);
    rings.setColorAt(i, color);
  }
  rings.instanceMatrix.needsUpdate = true;
  rings.instanceColor.needsUpdate = true;

  const u = sparks.material.uniforms;
  u.uTravel.value = travel;
  u.uTreble.value = bands.treble;

  path(-travel, here);
  path(-travel - 7, ahead);
  camera.position.copy(here);
  camera.lookAt(ahead);
  roll += ((Math.sin(time * 0.21) * 0.35 + (bands.mid - 0.4) * 0.3) * pace - roll) * Math.min(1, dt * 1.2);
  camera.rotateZ(roll);
}

export function resize(w, h, ratio) {
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 84 : 70;
  camera.updateProjectionMatrix();
  sparks.material.uniforms.uSize.value = ratio * (h / 900) * 2.2;
}

export function dispose() {
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  rings.dispose();
  scene = camera = null;
}
