// The frame loop: a fixed 60 Hz update with an accumulator, one render per animation frame, paused while the tab
// is hidden so a background tab costs nothing.
const STEP = 1 / 60;
const MAX_STEPS = 5;

export function startLoop({ frame, step, render }) {
  let last = performance.now();
  let acc = 0;
  let raf = 0;
  let running = false;

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frame(dt, now / 1000);
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < MAX_STEPS) {
      step(STEP);
      acc -= STEP;
      n += 1;
    }
    if (n === MAX_STEPS) acc = 0;
    render(dt);
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    acc = 0;
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  start();
  return { start, stop };
}
