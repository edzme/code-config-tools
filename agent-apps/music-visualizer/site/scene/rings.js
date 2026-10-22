// Rings: a radial spectrum drawn on a 2D canvas. 192 spokes mirror the spectrum around a circle that breathes with
// the bass, the waveform runs around the inside, each beat sends a ripple outward, and the last frames linger as
// motion trails that drift and turn. With reduced motion, or with no WebGL, the trails are off and the spokes
// fall back more gently.
const SPOKES = 192;

let canvas;
let ctx;
let w = 1;
let h = 1;
let ratio = 1;
let trails = true;
let gentle = false;
let tokens;
let spokeColors = [];
let spin = 0;
let time = 0;
let ripples = [];
let levels = new Float32Array(SPOKES);
let additive = true;

function mix(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

function css({ r, g, b }, alpha = 1) {
  const to = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgba(${to(r)}, ${to(g)}, ${to(b)}, ${alpha})`;
}

function srgb(color) {
  // Three's colors are linear; the canvas wants sRGB.
  return { r: toSrgb(color.r), g: toSrgb(color.g), b: toSrgb(color.b) };
}

function toSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function init({ canvas: target, tokens: t, reduced, webgl }) {
  canvas = target;
  ctx = canvas.getContext("2d");
  tokens = t;
  gentle = reduced || !webgl;
  trails = !gentle;
  additive = t.additive;
  const stops = [srgb(t.c1), srgb(t.c2), srgb(t.c3), srgb(t.c1)];
  spokeColors = [];
  for (let i = 0; i < SPOKES / 2; i++) {
    const x = (i / (SPOKES / 2)) * 3;
    const k = Math.min(2, Math.floor(x));
    spokeColors.push(mix(stops[k], stops[k + 1], x - k));
  }
  ripples = [];
  levels = new Float32Array(SPOKES);
  ctx.fillStyle = tokens.css.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas };
}

export function update(bands, beat, dt) {
  time += dt;
  const rate = gentle ? 0.35 : 0.06;
  const steps = bands.spectrum.length;
  for (let j = 0; j < SPOKES / 2; j++) {
    const v = bands.spectrum[Math.min(steps - 1, Math.floor((j / (SPOKES / 2)) * steps))];
    const prev = levels[j];
    levels[j] = v > prev ? prev + (v - prev) * Math.min(1, dt / (gentle ? 0.12 : 0.02)) : prev + (v - prev) * Math.min(1, dt / rate);
  }
  if (!gentle) spin += dt * (0.05 + bands.mid * 0.2);
  if (beat.hit && !gentle) ripples.push({ r: 0, a: 1 });
  for (const r of ripples) {
    r.r += dt * (0.55 + bands.energy * 0.4);
    r.a *= Math.exp(-dt * 2.2);
  }
  ripples = ripples.filter((r) => r.a > 0.03);
}

export function render(bands, beat) {
  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2;
  const cy = H * (h > w ? 0.42 : 0.5);
  const unit = Math.min(W, H);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  if (trails) {
    // Feedback: the last frame, a hair larger and turned, then a veil of the background over it.
    ctx.translate(cx, cy);
    ctx.rotate(0.004 + bands.mid * 0.004);
    ctx.scale(1.012 + bands.bass * 0.01, 1.012 + bands.bass * 0.01);
    ctx.translate(-cx, -cy);
    ctx.drawImage(canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = tokens.css.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = tokens.css.bg;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = additive ? "lighter" : "source-over";
  const base = unit * 0.17 * (1 + bands.bass * 0.12 + beat.pulse * 0.05);
  const reach = unit * 0.2;

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 1.6);
  const core = srgb(tokens.c3);
  glow.addColorStop(0, css(core, (additive ? 0.32 : 0.16) * (0.4 + bands.bass)));
  glow.addColorStop(1, css(core, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, base * 1.6, 0, Math.PI * 2);
  ctx.fill();

  const width = ((Math.PI * 2 * base) / SPOKES) * 0.58;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, width);
  for (let i = 0; i < SPOKES; i++) {
    const j = i < SPOKES / 2 ? i : SPOKES - 1 - i;
    const v = levels[j];
    const angle = (i / SPOKES) * Math.PI * 2 - Math.PI / 2 + spin;
    const len = v * reach * (0.6 + 0.4 * (1 - j / (SPOKES / 2))) + unit * 0.004;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    ctx.strokeStyle = css(spokeColors[j], additive ? 0.55 + v * 0.45 : 0.85);
    ctx.beginPath();
    ctx.moveTo(cx + c * base, cy + s * base);
    ctx.lineTo(cx + c * (base + len), cy + s * (base + len));
    ctx.stroke();
  }

  const wave = bands.wave;
  ctx.lineWidth = Math.max(1, unit * 0.0025);
  ctx.strokeStyle = css(srgb(tokens.c2), additive ? 0.85 : 0.9);
  ctx.beginPath();
  const inner = base * 0.8;
  for (let i = 0; i <= wave.length; i++) {
    const k = i % wave.length;
    const angle = (i / wave.length) * Math.PI * 2 - Math.PI / 2 - spin * 0.5;
    const r = inner + wave[k] * base * 0.22;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  for (const r of ripples) {
    ctx.lineWidth = Math.max(1, unit * 0.003 * r.a);
    ctx.strokeStyle = css(srgb(tokens.c1), r.a * 0.7);
    ctx.beginPath();
    ctx.arc(cx, cy, base + reach * 0.2 + r.r * unit * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function resize(width, height, pixelRatio) {
  w = width;
  h = height;
  ratio = Math.min(pixelRatio, 2);
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  ctx.fillStyle = tokens.css.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

export function dispose() {
  ripples = [];
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
}
