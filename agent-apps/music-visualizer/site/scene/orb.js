// Orb: an icosphere displaced by simplex noise that the bass scales, with a fresnel rim, a halo of particles that
// hugs it, sparks and a shock ring thrown off its surface on each beat, a pool of light (dark) or a soft contact
// shadow (light) beneath it, and a slow orbiting camera that pushes in on the hit, framed for the screen's shape.
import * as THREE from "three";
import { simplex3 } from "./noise.js";

const SPARK_SETS = 3;
const FLOOR_Y = -2.45;

let scene;
let camera;
let orb;
let halo;
let backdrop;
let floor;
let sparks = [];
let rings = [];
let nextBurst = 0;
let time = 0;
let burst = 0;
let spin = 0;
let reduced = false;
let aspect = 1;
let tall = false;
let push = 0;

const white = new THREE.Color(1, 1, 1);

export function init({ tokens, tier, reduced: reduce }) {
  reduced = reduce;
  const dark = tokens.dark;
  scene = new THREE.Scene();
  scene.background = tokens.bg.clone();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  sparks = [];
  rings = [];
  nextBurst = 0;
  burst = 0;
  push = 0;

  // The backdrop: dark is a deep field with a glow behind the orb that swells on the beat; light is a studio sweep,
  // pale above and deeper toward the floor, with a tinted aura behind the orb so its rim light reads.
  backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(60, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uBg: { value: tokens.bg.clone() },
        uBg2: { value: tokens.bg2.clone() },
        uTint: { value: dark ? tokens.bg2.clone().lerp(tokens.c2, 0.45).lerp(tokens.c3, 0.15) : tokens.c3.clone().lerp(tokens.c1, 0.4) },
        uHot: { value: tokens.c2.clone() },
        uEnergy: { value: 0 },
        uPulse: { value: 0 },
        uDrop: { value: 0 },
        uDark: { value: dark ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uBg;
        uniform vec3 uBg2;
        uniform vec3 uTint;
        uniform vec3 uHot;
        uniform float uEnergy;
        uniform float uPulse;
        uniform float uDrop;
        uniform float uDark;
        varying vec3 vDir;
        void main() {
          vec3 toCamera = normalize(cameraPosition);
          float facing = max(dot(vDir, -toCamera), 0.0);
          float wide = pow(facing, 3.0);
          float glow = pow(facing, 7.0 - uDrop * 2.0);
          vec3 color;
          if (uDark > 0.5) {
            color = mix(uBg, uBg2, wide * 0.9);
            color = mix(color, uTint, glow * (0.1 + uEnergy * 0.12 + uPulse * 0.18));
            color += uHot * glow * uDrop * 0.12;
          } else {
            float fall = smoothstep(0.55, -0.6, vDir.y);
            color = mix(uBg * 1.04, uBg2, fall * 0.75);
            color = mix(color, uTint * 0.9 + uBg2 * 0.1, glow * (0.3 + uPulse * 0.15 + uDrop * 0.2));
          }
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  scene.add(backdrop);

  // Beneath the orb: a pool of its light on a dark floor, or a soft contact shadow on a light one.
  floor = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uColor: { value: dark ? tokens.c2.clone().lerp(tokens.c3, 0.35) : tokens.bg2.clone().multiplyScalar(0.28) },
        uStrength: { value: 0.5 },
        uSpread: { value: 1 },
        uDark: { value: dark ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uStrength;
        uniform float uSpread;
        uniform float uDark;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0 / uSpread;
          float core = exp(-d * d * 14.0);
          float wide = exp(-d * d * 3.2);
          float a = (core * 0.75 + wide * 0.35) * uStrength;
          if (uDark > 0.5) gl_FragColor = vec4(uColor * a, 1.0);
          else gl_FragColor = vec4(uColor, min(a, 0.85));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  scene.add(floor);

  const detail = tier.name === "desktop" ? 56 : tier.name === "phone" ? 40 : 24;
  const geometry = shareVertices(new THREE.IcosahedronGeometry(1.5, detail));
  orb = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uPulse: { value: 0 },
        uDrop: { value: 0 },
        uCore: { value: dark ? tokens.bg.clone().lerp(tokens.bg2, 0.85).lerp(tokens.c2, 0.08).lerp(tokens.c3, 0.08) : tokens.c3.clone() },
        uA: { value: tokens.c1.clone() },
        uB: { value: tokens.c2.clone() },
        uRim: { value: dark ? tokens.c1.clone().lerp(white, 0.15) : tokens.c3.clone().lerp(white, 0.6) },
        uLight: { value: dark ? 0 : 1 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uBass;
        uniform float uMid;
        uniform float uTreble;
        uniform float uPulse;
        uniform float uDrop;
        varying vec3 vNormal;
        varying vec3 vView;
        varying float vNoise;
        ${simplex3}
        // The broad swell, sampled three times for the shading normal; the fine ripple once, for the surface.
        float swell(vec3 p) {
          return snoise(p * 0.9 + vec3(0.0, uTime * 0.22, uTime * 0.11)) * (0.1 + uBass * 0.3 + uPulse * 0.12 + uDrop * 0.1);
        }
        void main() {
          vec3 n = normalize(position);
          vec3 t = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec3 b = cross(n, t);
          float e = 0.02;
          vec3 n1 = normalize(n + t * e);
          vec3 n2 = normalize(n + b * e);
          float ripple = snoise(n * 3.9 + vec3(uTime * 0.5, 0.0, -uTime * 0.3)) * (0.03 + uMid * 0.1 + uTreble * 0.03);
          float s0 = swell(n * 1.5);
          vec3 p0 = n * (1.5 + s0 + ripple);
          vec3 p1 = n1 * (1.5 + swell(n1 * 1.5) + ripple);
          vec3 p2 = n2 * (1.5 + swell(n2 * 1.5) + ripple);
          vec3 shaded = normalize(cross(p1 - p0, p2 - p0));
          vNoise = s0 + ripple;
          vec4 mv = modelViewMatrix * vec4(p0, 1.0);
          vView = normalize(-mv.xyz);
          vNormal = normalize(normalMatrix * shaded);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCore;
        uniform vec3 uA;
        uniform vec3 uB;
        uniform vec3 uRim;
        uniform float uPulse;
        uniform float uDrop;
        uniform float uBass;
        uniform float uLight;
        varying vec3 vNormal;
        varying vec3 vView;
        varying float vNoise;
        void main() {
          vec3 n = normalize(vNormal);
          float facing = clamp(dot(n, vView), 0.0, 1.0);
          float band = smoothstep(-0.25, 0.35, vNoise);
          vec3 body = mix(uA, uB, band);
          vec3 key = normalize(vec3(-0.45, 0.75, 0.55));
          float lambert = dot(n, key);
          float wrap = clamp((lambert + 0.3) / 1.3, 0.0, 1.0);
          float valley = smoothstep(-0.35, 0.3, vNoise);
          float spec = pow(clamp(dot(reflect(-key, n), vView), 0.0, 1.0), 48.0);
          vec3 color;
          if (uLight > 0.5) {
            // A lit object in a bright room: key light from the upper left, darker valleys, a glossy highlight,
            // a cool bounce from below, and a pale rim light from behind that cuts the silhouette out.
            float fresnel = pow(1.0 - facing, 3.0);
            vec3 base = body * (0.32 + 0.78 * wrap) * mix(0.55, 1.0, valley);
            float bounce = clamp(dot(n, normalize(vec3(0.2, -1.0, 0.3))), 0.0, 1.0);
            color = base + uCore * bounce * 0.22;
            color += uRim * fresnel * (0.75 + uPulse * 0.5 + uDrop * 0.4);
            color += spec * 0.85 + pow(clamp(dot(reflect(-key, n), vView), 0.0, 1.0), 6.0) * 0.08;
          } else {
            // A dark glossy body that the light lives inside: deep core, color only where the key light lands,
            // veins that ignite on the beat, and a hot fresnel rim that the bloom picks up and the body does not.
            float fresnel = pow(1.0 - facing, 2.9);
            vec3 base = uCore * (0.35 + 0.65 * wrap) + body * band * 0.42 * wrap;
            float vein = smoothstep(0.32, 0.7, vNoise);
            color = base + body * vein * (0.3 + uPulse * 0.55 + uDrop * 0.5);
            color += uRim * fresnel * (1.05 + uBass * 0.3 + uPulse * 0.55 + uDrop * 0.45);
            color += spec * 0.6;
          }
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  scene.add(orb);

  const palette = [tokens.c1, tokens.c2, tokens.c3];
  const pointBlend = tokens.additive ? THREE.AdditiveBlending : THREE.NormalBlending;

  // The halo: particles on close shells that hug the orb; each beat flings them outward and they settle back.
  const count = Math.round((dark ? 2600 : 1700) * tier.particles);
  const haloDirs = new Float32Array(count * 3);
  const haloSeeds = new Float32Array(count);
  const haloColors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    randomDirection(haloDirs, i);
    haloSeeds[i] = Math.random();
    const c = palette[i % 3];
    haloColors.set([c.r, c.g, c.b], i * 3);
  }
  const haloGeometry = new THREE.BufferGeometry();
  haloGeometry.setAttribute("position", new THREE.BufferAttribute(haloDirs, 3));
  haloGeometry.setAttribute("seed", new THREE.BufferAttribute(haloSeeds, 1));
  haloGeometry.setAttribute("color", new THREE.BufferAttribute(haloColors, 3));
  halo = new THREE.Points(
    haloGeometry,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: pointBlend,
      vertexColors: true,
      uniforms: {
        uTime: { value: 0 },
        uBurst: { value: 0 },
        uTreble: { value: 0 },
        uSize: { value: 1 },
        uAlpha: { value: dark ? 0.85 : 0.95 },
        uLight: { value: dark ? 0 : 1 },
      },
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime;
        uniform float uBurst;
        uniform float uTreble;
        uniform float uSize;
        uniform float uLight;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vec3 dir = normalize(position);
          float shell = 1.78 + seed * seed * 1.1;
          float swirl = uTime * (0.1 + seed * 0.14);
          float c = cos(swirl), s = sin(swirl);
          dir.xz = mat2(c, -s, s, c) * dir.xz;
          float fling = uBurst * (0.4 + seed * 1.6);
          vec3 p = dir * (shell + fling);
          p.y += sin(uTime * 0.7 + seed * 40.0) * 0.05;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vColor = color;
          vFade = 1.0 - seed * 0.6;
          float size = (0.8 + seed * seed * 2.2) * (1.0 + uTreble * 0.5 + uBurst * 0.6) * mix(1.0, 1.35, uLight);
          gl_PointSize = size * uSize * (10.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: beadFragment,
    }),
  );
  scene.add(halo);

  // The sparks: a few sets that take turns; each beat throws one off the orb's surface along a fresh rotation, and
  // its strength (the beat's drop) decides how far they fly, so the first drop sprays the whole frame.
  const sparkCount = Math.round(1500 * tier.particles);
  for (let k = 0; k < SPARK_SETS; k++) {
    const dirs = new Float32Array(sparkCount * 3);
    const seeds = new Float32Array(sparkCount * 2);
    const colors = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      randomDirection(dirs, i);
      seeds[i * 2] = Math.pow(Math.random(), 1.6);
      seeds[i * 2 + 1] = Math.random();
      const c = palette[(i + k) % 3].clone().lerp(white, dark ? 0.15 : 0);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(dirs, 3));
    g.setAttribute("seed", new THREE.BufferAttribute(seeds, 2));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: pointBlend,
        vertexColors: true,
        uniforms: {
          uAge: { value: 9 },
          uPower: { value: 0 },
          uRot: { value: new THREE.Matrix3() },
          uRadius: { value: 1.5 },
          uSize: { value: 1 },
          uAlpha: { value: 1 },
          uLight: { value: dark ? 0 : 1 },
        },
        vertexShader: /* glsl */ `
          attribute vec2 seed;
          uniform float uAge;
          uniform float uPower;
          uniform mat3 uRot;
          uniform float uRadius;
          uniform float uSize;
          uniform float uLight;
          varying vec3 vColor;
          varying float vFade;
          void main() {
            vec3 dir = uRot * normalize(position);
            float speed = (1.6 + seed.x * 9.0) * uPower;
            float k = 2.1;
            float travel = speed * (1.0 - exp(-k * uAge)) / k;
            vec3 p = dir * (uRadius + 0.05 + travel);
            p.y -= 0.35 * uAge * uAge;
            float life = 0.55 + seed.y * 0.85;
            float fade = clamp(1.0 - uAge / life, 0.0, 1.0);
            vFade = fade * fade * step(0.001, uPower);
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            float size = (0.9 + seed.y * seed.y * 2.6) * (0.5 + 0.7 * fade) * mix(1.0, 1.3, uLight);
            gl_PointSize = vFade > 0.0 ? size * uSize * (10.0 / -mv.z) : 0.0;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: beadFragment,
      }),
    );
    points.frustumCulled = false;
    scene.add(points);
    sparks.push(points);
  }

  // The shock rings: a thin ring that leaves the orb's equator on the beat, facing the camera, two taking turns.
  for (let k = 0; k < 2; k++) {
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: {
          uAge: { value: 9 },
          uPower: { value: 0 },
          uColor: { value: (dark ? tokens.c1 : tokens.c2).clone() },
          uDark: { value: dark ? 1 : 0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uAge;
          uniform float uPower;
          uniform vec3 uColor;
          uniform float uDark;
          varying vec2 vUv;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float width = 0.018 + uAge * 0.05;
            float band = exp(-pow((d - 0.8) / width, 2.0));
            float fade = clamp(1.0 - uAge / 0.75, 0.0, 1.0);
            float a = band * fade * fade * uPower;
            if (uDark > 0.5) gl_FragColor = vec4(uColor * a * 1.6, 1.0);
            else gl_FragColor = vec4(uColor, a * 0.7);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    );
    ring.visible = false;
    scene.add(ring);
    rings.push(ring);
  }
  return { scene, camera, bloom: 0.5, threshold: 0.72 };
}

// Shared by the halo and the sparks: a glowing dot on dark, and on light a small glossy bead lit like the orb.
const beadFragment = /* glsl */ `
  uniform float uAlpha;
  uniform float uLight;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    vec3 color;
    float a;
    if (uLight > 0.5) {
      vec3 nn = vec3(c.x, -c.y, sqrt(1.0 - r2));
      float l = clamp(dot(nn, normalize(vec3(-0.45, 0.7, 0.6))), 0.0, 1.0);
      color = vColor * (0.45 + 0.7 * l) + pow(l, 20.0) * 0.55;
      a = smoothstep(1.0, 0.8, r2);
    } else {
      float g = 1.0 - r2;
      color = vColor * (0.8 + g * 0.8);
      a = g * g;
    }
    gl_FragColor = vec4(color, a * uAlpha * vFade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function randomDirection(out, i) {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  out[i * 3] = r * Math.cos(a);
  out[i * 3 + 1] = u;
  out[i * 3 + 2] = r * Math.sin(a);
}

// The icosphere arrives with three vertices per triangle; sharing them cuts the vertex shader's work about sixfold.
function shareVertices(source) {
  const pos = source.getAttribute("position");
  const keys = new Map();
  const unique = [];
  const index = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let at = keys.get(key);
    if (at === undefined) {
      at = unique.length / 3;
      keys.set(key, at);
      unique.push(x, y, z);
    }
    index[i] = at;
  }
  source.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(unique, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

const turn = new THREE.Matrix4();
const euler = new THREE.Euler();

export function update(bands, beat, dt) {
  time += dt;
  const k = reduced ? 0.4 : 1;
  const drop = (beat.drop || 0) * k;
  if (beat.hit) {
    burst = Math.min(1.4, burst + 0.6 + drop * 0.5);
    const strength = (0.35 + drop * 0.9) * k;
    const set = sparks[nextBurst % SPARK_SETS];
    euler.set(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3);
    set.material.uniforms.uRot.value.setFromMatrix4(turn.makeRotationFromEuler(euler));
    set.material.uniforms.uAge.value = 0;
    set.material.uniforms.uPower.value = strength;
    const ring = rings[nextBurst % rings.length];
    ring.material.uniforms.uAge.value = 0;
    ring.material.uniforms.uPower.value = Math.min(1, 0.45 + drop * 0.8) * k;
    ring.visible = true;
    nextBurst += 1;
  }
  burst *= Math.exp(-dt * 2.6);
  const u = orb.material.uniforms;
  u.uTime.value = time;
  u.uBass.value = bands.bass * k;
  u.uMid.value = bands.mid * k;
  u.uTreble.value = bands.treble * k;
  u.uPulse.value = beat.pulse * k;
  u.uDrop.value = drop;
  const breathe = 1 + bands.bass * 0.05 * k + beat.pulse * 0.05 * k + drop * 0.06;
  orb.scale.setScalar(breathe);
  spin += dt * (0.08 + bands.mid * 0.25 + drop * 0.6) * k;
  orb.rotation.y = spin;
  orb.rotation.x = Math.sin(time * 0.13) * 0.25;

  const h = halo.material.uniforms;
  h.uTime.value = time;
  h.uBurst.value = burst * k;
  h.uTreble.value = bands.treble * k;

  for (const set of sparks) {
    const s = set.material.uniforms;
    s.uAge.value += dt;
    s.uRadius.value = 1.5 * breathe;
  }
  for (const ring of rings) {
    const r = ring.material.uniforms;
    r.uAge.value += dt;
    if (r.uAge.value > 0.8) ring.visible = false;
    const radius = 1.5 * breathe + (1 - Math.exp(-r.uAge.value * 3.2)) * (2.2 + r.uPower.value * 3.2);
    ring.scale.setScalar(radius / 0.8);
    ring.quaternion.copy(camera.quaternion);
  }

  const b = backdrop.material.uniforms;
  b.uEnergy.value = bands.energy;
  b.uPulse.value = beat.pulse * k;
  b.uDrop.value = drop;

  const f = floor.material.uniforms;
  f.uStrength.value = 0.42 + bands.bass * 0.25 + beat.pulse * 0.3 * k + drop * 0.35;
  f.uSpread.value = 0.62 * breathe;

  // The camera orbits slowly, leans in with the music, and pushes in on each hit; a drop pushes hardest.
  push += (beat.pulse * 0.035 * k + drop * 0.06 - push) * Math.min(1, dt * 14);
  const orbit = time * 0.06 * (reduced ? 0.4 : 1);
  const distance = fitDistance() * (1 - bands.energy * 0.03 * k - push);
  camera.position.set(Math.sin(orbit) * distance, Math.sin(time * 0.09) * 0.7 + 0.5, Math.cos(orbit) * distance);
  camera.lookAt(0, tall ? -0.3 : -0.1, 0);
}

function fitDistance() {
  // The orb fills most of the narrow side of the screen; the halo and the sparks run past its edges.
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const radius = tall ? 2.5 : 3.1;
  const vertical = radius / Math.tan(halfFov);
  const horizontal = radius / (Math.tan(halfFov) * aspect);
  return Math.max(vertical, horizontal);
}

export function resize(w, h, ratio) {
  aspect = w / h;
  tall = aspect < 0.9;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const size = ratio * (h / 900) * 1.6;
  halo.material.uniforms.uSize.value = size;
  for (const set of sparks) set.material.uniforms.uSize.value = size;
}

export function dispose() {
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  scene = camera = null;
  sparks = [];
  rings = [];
}
