// Terrain: the spectrum's history as a heightfield the camera flies over. Each new row of the spectrum enters at
// the horizon and scrolls toward the camera; the low notes raise the ridges on either side and the highs ripple
// the valley floor. Grid lines glow under bloom; a sun on the horizon swells with the bass.
import * as THREE from "three";

const COLUMNS = 192;
const WIDTH = 64;
const DEPTH = 90;

let scene;
let camera;
let field;
let fieldData;
let fieldTexture;
let rowsTotal;
let head = 0;
let rowClock = 0;
let rowStep;
let terrain;
let sun;
let stars;
let time = 0;
let sway = 0;
let lift = 0;
let reduced = false;
let currentSpectrum;

export function init({ tokens, tier, reduced: reduce }) {
  reduced = reduce;
  rowsTotal = tier.name === "desktop" ? 200 : 140;
  rowStep = 1 / 36;
  scene = new THREE.Scene();
  scene.background = tokens.bg.clone();
  scene.fog = new THREE.Fog(tokens.bg.clone(), DEPTH * 0.35, DEPTH * 0.98);
  camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);

  fieldData = new Uint8Array(COLUMNS * rowsTotal);
  fieldTexture = new THREE.DataTexture(fieldData, COLUMNS, rowsTotal, THREE.RedFormat, THREE.UnsignedByteType);
  fieldTexture.wrapS = THREE.ClampToEdgeWrapping;
  fieldTexture.wrapT = THREE.RepeatWrapping;
  fieldTexture.magFilter = THREE.LinearFilter;
  fieldTexture.minFilter = THREE.LinearFilter;
  fieldTexture.needsUpdate = true;

  const geometry = new THREE.PlaneGeometry(WIDTH, DEPTH, COLUMNS - 1, rowsTotal - 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, -DEPTH / 2 + 6);

  const line = tokens.dark ? tokens.c1.clone() : tokens.c1.clone().multiplyScalar(0.8);
  const peak = tokens.c2.clone();
  const floor = tokens.dark ? tokens.bg.clone().lerp(tokens.bg2, 0.6) : tokens.bg2.clone().lerp(tokens.bg, 0.35);

  field = new THREE.ShaderMaterial({
    uniforms: {
      uField: { value: fieldTexture },
      uOffset: { value: 0 },
      uRows: { value: rowsTotal },
      uHeight: { value: 7.5 },
      uLine: { value: line },
      uPeak: { value: peak },
      uFloor: { value: floor },
      uFogColor: { value: tokens.bg.clone() },
      uFogNear: { value: DEPTH * 0.3 },
      uFogFar: { value: DEPTH * 0.95 },
      uGlow: { value: tokens.dark ? 1.6 : 1 },
      uPulse: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform sampler2D uField;
      uniform float uOffset;
      uniform float uRows;
      uniform float uHeight;
      varying float vHeight;
      varying vec2 vGrid;
      varying float vDepth;
      varying float vSide;
      void main() {
        // uv.y = 1 at the far edge; the newest row sits at the far edge and drifts toward the camera.
        float row = (1.0 - uv.y) * (uRows - 1.0);
        float v = (row + uOffset + 0.5) / uRows;
        float side = abs(uv.x - 0.5) * 2.0;
        float h = texture2D(uField, vec2(uv.x, v)).r;
        float ridge = 0.25 + 1.5 * smoothstep(0.08, 0.85, side);
        float height = pow(h, 1.6) * uHeight * ridge;
        vec3 p = position;
        p.y += height;
        vHeight = h;
        vSide = side;
        vGrid = vec2(uv.x * 48.0, row + uOffset);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uLine;
      uniform vec3 uPeak;
      uniform vec3 uFloor;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      uniform float uGlow;
      uniform float uPulse;
      uniform float uRows;
      varying float vHeight;
      varying vec2 vGrid;
      varying float vDepth;
      varying float vSide;
      float gridLine(float coord, float width) {
        float d = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
        return 1.0 - clamp(d - width, 0.0, 1.0);
      }
      void main() {
        float across = gridLine(vGrid.x, 0.35);
        float along = gridLine(vGrid.y / 4.0, 0.35);
        float lines = max(across, along);
        vec3 lineColor = mix(uLine, uPeak, smoothstep(0.35, 0.95, vHeight));
        float lit = uGlow * (0.55 + vHeight * 0.9 + uPulse * 0.5);
        vec3 color = mix(uFloor, lineColor * lit, lines);
        color += lineColor * smoothstep(0.55, 1.0, vHeight) * 0.18 * uGlow;
        float fog = smoothstep(uFogNear, uFogFar, vDepth);
        gl_FragColor = vec4(mix(color, uFogColor, fog), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  terrain = new THREE.Mesh(geometry, field);
  terrain.frustumCulled = false;
  scene.add(terrain);

  // The sun: a disc with a vertical gradient and bands cut out of its lower half.
  const sunMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: tokens.c2.clone() },
      uBottom: { value: tokens.c3.clone() },
      uBass: { value: 0 },
      uTime: { value: 0 },
      uStrength: { value: tokens.dark ? 1.35 : 1 },
    },
    transparent: true,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform float uBass;
      uniform float uTime;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float disc = 1.0 - smoothstep(0.98, 1.0, r);
        float y = vUv.y;
        float bands = step(0.5, fract((y + uTime * 0.04) * 14.0));
        float cut = mix(1.0, bands, smoothstep(0.55, 0.15, y));
        vec3 color = mix(uBottom, uTop, smoothstep(0.1, 0.9, y)) * uStrength * (1.0 + uBass * 0.6);
        float a = disc * cut;
        if (a < 0.01) discard;
        gl_FragColor = vec4(color, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  sun = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sunMaterial);
  sun.position.set(0, 9, -DEPTH + 2);
  sun.scale.setScalar(34);
  sun.renderOrder = -1;
  scene.add(sun);

  if (tokens.dark) {
    const count = Math.round(900 * tier.particles);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 260;
      positions[i * 3 + 1] = 8 + Math.random() * 90;
      positions[i * 3 + 2] = -DEPTH - 10 - Math.random() * 60;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({ color: tokens.text, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 }),
    );
    scene.add(stars);
  }

  return { scene, camera, bloom: 1 };
}

function writeRow(spectrum) {
  head = (head - 1 + rowsTotal) % rowsTotal;
  const base = head * COLUMNS;
  const half = COLUMNS / 2;
  const steps = spectrum.length;
  for (let c = 0; c < COLUMNS; c++) {
    // Outside edges carry the lowest notes, the middle of the valley the highest.
    const side = Math.abs(c + 0.5 - half) / half;
    const pos = (1 - side) * (steps - 1);
    const i = Math.floor(pos);
    const f = pos - i;
    const v = spectrum[i] * (1 - f) + spectrum[Math.min(steps - 1, i + 1)] * f;
    const wobble = 0.06 * Math.sin(c * 0.37 + time * 2.1) * Math.sin(c * 0.11 - time);
    fieldData[base + c] = Math.max(0, Math.min(255, Math.round((v + wobble * v) * 255)));
  }
}

export function update(bands, beat, dt) {
  time += dt;
  currentSpectrum = bands.spectrum;
  rowClock += dt;
  let wrote = false;
  while (rowClock >= rowStep) {
    rowClock -= rowStep;
    writeRow(currentSpectrum);
    wrote = true;
  }
  if (wrote) fieldTexture.needsUpdate = true;
  field.uniforms.uOffset.value = head + (1 - rowClock / rowStep) - 1;
  field.uniforms.uPulse.value = beat.pulse;
  field.uniforms.uHeight.value = 6.5 + bands.bass * 2.5;

  sun.material.uniforms.uBass.value = bands.bass;
  sun.material.uniforms.uTime.value = time;
  const sunScale = 34 * (1 + bands.bass * 0.06 + beat.pulse * 0.04);
  sun.scale.setScalar(sunScale);

  const motion = reduced ? 0.3 : 1;
  sway += (Math.sin(time * 0.23) * 1.6 + (bands.mid - 0.4) * 0.8 - sway) * Math.min(1, dt * 1.5);
  lift += (beat.pulse * 0.45 - lift) * Math.min(1, dt * 6);
  camera.position.set(sway * motion, 4.2 + lift * motion + Math.sin(time * 0.31) * 0.4 * motion, 9);
  camera.lookAt(sway * 0.4 * motion, 3.1, -40);
  camera.rotation.z += Math.sin(time * 0.17) * 0.035 * motion;
}

export function resize(w, h) {
  camera.aspect = w / h;
  // A tall phone screen widens the view so both ridges stay in frame.
  camera.fov = w / h < 1 ? 78 : 62;
  camera.updateProjectionMatrix();
  sun.position.y = w / h < 1 ? 11 : 9;
}

export function dispose() {
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  fieldTexture.dispose();
  scene = camera = null;
}
