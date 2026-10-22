// The world: one renderer and one post chain shared by the WebGL scenes, the 2D canvas for Rings, and the swap
// between them. A scene is built when it is first shown and rebuilt when the colors change.
import * as terrain from "./terrain.js";
import * as orb from "./orb.js";
import * as tunnel from "./tunnel.js";
import * as rings from "./rings.js";
import { createRenderer, webglAvailable } from "./renderer.js";
import { createPost } from "./post.js";
import { createGovernor } from "./quality.js";

const SCENES = { terrain, orb, tunnel, rings };
export const SCENE_NAMES = Object.keys(SCENES);

export function createWorld({ tier, tokens, glCanvas, flatCanvas, reduced }) {
  const webgl = webglAvailable();
  const renderer = webgl ? createRenderer(glCanvas, tier) : null;
  let post = renderer && tier.post ? createPost(renderer, tier) : null;
  let current = null;
  let currentName = null;
  let view = null;
  let theme = tokens;
  let time = 0;

  const governor = createGovernor(tier, (t) => {
    if (renderer) renderer.setPixelRatio(t.ratio);
    if (!t.post && post) {
      post.dispose();
      post = null;
    }
    resize();
  });

  if (post) post.setTheme(theme);

  function sizeOf() {
    return { w: Math.max(1, innerWidth), h: Math.max(1, innerHeight) };
  }

  function resize() {
    const { w, h } = sizeOf();
    if (renderer) {
      renderer.setSize(w, h, false);
      if (post) post.resize(w, h, tier.ratio);
    }
    if (current) current.resize(w, h, tier.ratio);
  }

  function show(name) {
    if (!SCENES[name]) name = "orb";
    if (!renderer && name !== "rings") name = "rings";
    if (current) current.dispose();
    current = SCENES[name];
    currentName = name;
    const flat = current === rings;
    glCanvas.hidden = flat;
    flatCanvas.hidden = !flat;
    view = current.init({ renderer, tokens: theme, tier, reduced, canvas: flatCanvas, webgl: !!renderer });
    if (!flat && post) post.setScene(view.scene, view.camera, view.bloom, view.threshold);
    resize();
    return name;
  }

  function setTokens(next) {
    theme = next;
    if (post) post.setTheme(theme);
    if (currentName) show(currentName);
  }

  function step(bands, beat, dt) {
    current.update(bands, beat, dt);
  }

  function render(dt, bands, beat) {
    time += dt;
    governor(dt);
    if (current === rings) rings.render(bands, beat);
    else if (post) post.render(dt, bands, beat, time);
    else renderer.render(view.scene, view.camera);
  }

  addEventListener("resize", resize);

  return {
    show,
    setTokens,
    step,
    render,
    resize,
    get name() {
      return currentName;
    },
    webgl: !!renderer,
  };
}
