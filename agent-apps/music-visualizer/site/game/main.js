// The page: reads the config, builds the world and the listener, and wires the controls to them.
import { Listener } from "./audio.js";
import { startLoop } from "./loop.js";
import { createHud } from "./hud.js";
import { bindInput } from "./input.js";
import * as state from "./state.js";
import { createWorld, SCENE_NAMES } from "../scene/world.js";
import { pickTier } from "../scene/quality.js";
import { readTokens } from "../scene/tokens.js";

const DEMO = { file: "media/demo-afterglow.wav", title: "Afterglow", artist: "120 BPM in A minor" };
const config = Object.assign(
  { title: "Music Visualizer", tracks: [DEMO], scene: "orb", theme: "neon", sensitivity: 1, themes: ["neon"] },
  window.__APP_CONFIG__ || {},
);
if (!config.tracks.length) config.tracks = [DEMO];

const root = document.documentElement;
const themeLink = document.getElementById("theme-link");
const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const reduced = reducedQuery.matches;

function currentScheme() {
  const set = root.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return darkQuery.matches ? "dark" : "light";
}

function stylesheetReady(link) {
  if (link.sheet) return Promise.resolve();
  return new Promise((resolve) => {
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", resolve, { once: true });
  });
}

async function start() {
  await stylesheetReady(themeLink);
  const hud = createHud({ config, sceneNames: SCENE_NAMES });
  const tier = pickTier();
  const world = createWorld({
    tier,
    tokens: readTokens(),
    glCanvas: document.getElementById("stage-gl"),
    flatCanvas: document.getElementById("stage-flat"),
    reduced,
  });
  if (!world.webgl) hud.disableScenes(["terrain", "orb", "tunnel"]);

  const savedPalette = state.loadRaw("palette");
  let palette = config.themes.includes(savedPalette) ? savedPalette : config.theme;
  hud.setScheme(currentScheme());

  const sensitivity = clampSensitivity(state.load("sensitivity", config.sensitivity));
  hud.setSensitivity(sensitivity);

  const listener = new Listener({
    tracks: config.tracks,
    sensitivity,
    onChange(event) {
      if (event.kind === "error") hud.say(event.message, true);
      if (event.kind === "track") hud.showTrack(listener.track, true);
      if (event.kind === "source") {
        hud.setSource(event.source);
        if (event.source === "songs") hud.showTrack(listener.track, true);
        else hud.showLive(event.source);
      }
      hud.setPlaying(listener.playing, listener.mode === "live");
      wakeChrome();
    },
  });
  hud.showTrack(listener.track, false);
  hud.setPlaying(false, false);
  listener.preparePreview();

  // The scene: the saved one, else the inputs' choice; reduced motion or no WebGL opens on Rings.
  const savedScene = state.loadRaw("scene");
  let sceneName = SCENE_NAMES.includes(savedScene) ? savedScene : reduced ? "rings" : config.scene;
  sceneName = world.show(sceneName);
  hud.setScene(sceneName);

  function pickScene(name) {
    if (!SCENE_NAMES.includes(name)) return;
    if (!world.webgl && name !== "rings") return;
    sceneName = world.show(name);
    hud.setScene(sceneName);
    state.saveRaw("scene", sceneName);
  }

  let restyling = false;
  async function restyle(change) {
    if (restyling) return;
    restyling = true;
    hud.veil(true);
    await new Promise((r) => setTimeout(r, reduced ? 0 : 140));
    await change();
    world.setTokens(readTokens());
    hud.setScheme(currentScheme());
    requestAnimationFrame(() => hud.veil(false));
    restyling = false;
  }

  function cyclePalette() {
    const list = config.themes;
    const next = list[(list.indexOf(palette) + 1) % list.length];
    restyle(async () => {
      themeLink.href = `./themes/${next}.css`;
      await new Promise((resolve) => {
        themeLink.addEventListener("load", resolve, { once: true });
        themeLink.addEventListener("error", resolve, { once: true });
      });
      palette = next;
      state.saveRaw("palette", next);
      hud.say(`Colors: ${next[0].toUpperCase()}${next.slice(1)}`);
    });
  }

  function toggleScheme() {
    const next = currentScheme() === "dark" ? "light" : "dark";
    restyle(async () => {
      root.setAttribute("data-theme", next);
      state.saveRaw("scheme", next);
    });
  }

  darkQuery.addEventListener("change", () => {
    if (!root.hasAttribute("data-theme")) restyle(async () => {});
  });

  // Controls that hide themselves while the music plays: a tap on the scene toggles them, a mouse move wakes them.
  let idleTimer = 0;
  function wakeChrome() {
    hud.showChrome(true);
    clearTimeout(idleTimer);
    const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (fine && listener.playing) {
      idleTimer = setTimeout(() => {
        if (listener.playing && !hud.panelOpen) hud.showChrome(false);
      }, 3500);
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen().catch(() => {});
  }

  const el = hud.el;
  el.play.addEventListener("click", () => listener.toggle());
  el.prev.addEventListener("click", () => listener.previous());
  el.next.addEventListener("click", () => listener.next());
  el.palette.addEventListener("click", cyclePalette);
  el.scheme.addEventListener("click", toggleScheme);
  el.full.addEventListener("click", toggleFullscreen);
  for (const b of el.sceneButtons) b.addEventListener("click", () => pickScene(b.dataset.scene));
  el.sourceBtn.addEventListener("click", () => hud.openPanel(!hud.panelOpen));
  el.sens.addEventListener("input", () => {
    const v = clampSensitivity(parseFloat(el.sens.value));
    listener.sensitivity = v;
    hud.setSensitivity(v);
    state.save("sensitivity", v);
  });
  el.panel.addEventListener("change", async (e) => {
    const input = e.target;
    if (input.name !== "source") return;
    const kind = input.value;
    if (kind === "songs") {
      if (listener.mode === "live") listener.pause();
      listener.play();
      hud.openPanel(false);
      return;
    }
    const ok = await listener.listenTo(kind);
    if (!ok) hud.setSource(listener.source);
    else hud.openPanel(false);
  });
  document.addEventListener("pointerdown", (e) => {
    if (hud.panelOpen && !el.panel.contains(e.target) && !el.sourceBtn.contains(e.target)) hud.openPanel(false);
  });

  bindInput({
    stages: [document.getElementById("stage-gl"), document.getElementById("stage-flat")],
    onTap() {
      if (hud.panelOpen) return hud.openPanel(false);
      if (hud.chromeShown) {
        clearTimeout(idleTimer);
        hud.showChrome(false);
      } else {
        wakeChrome();
      }
    },
    onActivity() {
      if (!hud.chromeShown || listener.playing) wakeChrome();
    },
    onKey(key) {
      if (key === " ") return listener.toggle(), true;
      if (key === "ArrowRight") return listener.mode !== "live" && listener.next(), true;
      if (key === "ArrowLeft") return listener.mode !== "live" && listener.previous(), true;
      if (key >= "1" && key <= "4") return pickScene(SCENE_NAMES[Number(key) - 1]), true;
      if (key === "f" || key === "F") return toggleFullscreen(), true;
      if (key === "Escape") {
        hud.openPanel(false);
        wakeChrome();
        return true;
      }
      return false;
    },
  });

  let bands = listener.bands;
  startLoop({
    frame() {},
    step(dt) {
      bands = listener.update(dt);
      world.step(bands, listener.beat, dt);
    },
    render(dt) {
      world.render(dt, bands, listener.beat);
      if (!reduced) hud.drive(bands, listener.beat);
    },
  });
}

function clampSensitivity(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(2, Math.max(0.5, n)) : 1;
}

start();
