// Keyboard and pointer: one pointer-event path for touch and mouse. A tap on the scene toggles the controls; a
// drag is never a tap. Keys: space plays and pauses, left and right change the song, 1 to 4 pick a scene, F fills
// the screen, Escape brings the controls back.
const TAP_SLOP = 10;
const TAP_TIME = 400;

export function bindInput({ stages, onTap, onActivity, onKey }) {
  let down = null;
  for (const stage of stages) {
    stage.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    });
    stage.addEventListener("pointerup", (e) => {
      if (!down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < TAP_TIME;
      down = null;
      if (moved < TAP_SLOP && quick) onTap(e);
    });
    stage.addEventListener("pointercancel", () => {
      down = null;
    });
  }

  addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") onActivity();
  });

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    const typing = target instanceof HTMLInputElement;
    const onButton = target instanceof HTMLButtonElement;
    const key = e.key;
    if (key === " " && (onButton || typing)) return;
    if ((key === "ArrowLeft" || key === "ArrowRight") && typing) return;
    if (onKey(key)) e.preventDefault();
  });
}
