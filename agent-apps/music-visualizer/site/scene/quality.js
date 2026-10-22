// The quality tier, picked once and stepped down when frames run long: after a short warmup, each window of 20
// frames (or 0.6 seconds, whichever ends first) whose mean is over 20 ms drops one step (pixel ratio 1.5, then 1,
// then post-processing off), and a mean over 45 ms drops straight to the last step, so a slow device reaches a
// smooth picture within about a second.
export function pickTier() {
  const coarse = matchMedia("(pointer: coarse)").matches;
  const narrow = Math.min(innerWidth, innerHeight) < 768 || innerWidth < 768;
  const phone = coarse || narrow;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const weak = phone && (cores <= 4 || memory <= 2);
  const dpr = window.devicePixelRatio || 1;
  if (weak) return { name: "weak", ratio: 1, post: false, particles: 0.5, detail: 0.5, antialias: false };
  if (phone) return { name: "phone", ratio: Math.min(dpr, 2), post: true, particles: 0.5, detail: 0.7, antialias: dpr < 2 };
  return { name: "desktop", ratio: Math.min(dpr, 2), post: true, particles: 1, detail: 1, antialias: true };
}

export function createGovernor(tier, apply) {
  const steps = [
    (t) => (t.ratio > 1.5 ? ((t.ratio = 1.5), true) : false),
    (t) => (t.ratio > 1 ? ((t.ratio = 1), true) : false),
    (t) => (t.post ? ((t.post = false), true) : false),
  ];
  let warm = 0;
  let sum = 0;
  let count = 0;
  return function sample(dt) {
    if (warm < 0.4) {
      warm += dt;
      return;
    }
    sum += dt;
    count += 1;
    if (count < 20 && !(sum >= 0.6 && count >= 4)) return;
    const mean = (sum / count) * 1000;
    sum = 0;
    count = 0;
    if (mean <= 20) return;
    let changed = false;
    for (const step of steps) {
      if (step(tier)) {
        changed = true;
        if (mean <= 45) break;
      }
    }
    if (changed) apply(tier);
  };
}
