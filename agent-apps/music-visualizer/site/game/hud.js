// The controls: HTML styled by the theme's tokens. This file reads and writes the page; main.js decides.
const $ = (id) => document.getElementById(id);

export function createHud({ config, sceneNames }) {
  const el = {
    body: document.body,
    brand: $("brand"),
    now: document.querySelector(".now"),
    title: $("now-title"),
    artist: $("now-artist"),
    play: $("play-btn"),
    playLabel: document.querySelector(".play-label"),
    prev: $("prev-btn"),
    next: $("next-btn"),
    sourceBtn: $("source-btn"),
    sourceLabel: $("source-label"),
    panel: $("source-panel"),
    songsNote: $("songs-note"),
    micOption: $("mic-option"),
    tabOption: $("tab-option"),
    sens: $("sens"),
    sensOut: $("sens-out"),
    status: $("status"),
    palette: $("palette-btn"),
    scheme: $("scheme-btn"),
    full: $("full-btn"),
    veil: document.querySelector(".veil"),
    sceneButtons: [...document.querySelectorAll("[data-scene]")],
  };

  el.brand.textContent = config.title;
  $("now-list").textContent = config.title;
  const count = config.tracks.length;
  const demo = count === 1 && config.tracks[0].file.startsWith("media/demo-");
  el.songsNote.textContent = demo ? "The demo track" : count === 1 ? "The song on this page" : `The ${count} songs on this page`;

  const devices = navigator.mediaDevices;
  if (!devices || !devices.getUserMedia) el.micOption.hidden = true;
  const coarse = matchMedia("(pointer: coarse)").matches;
  if (!devices || !devices.getDisplayMedia || coarse) el.tabOption.hidden = true;
  if (!document.fullscreenEnabled) el.full.hidden = true;
  if (count < 2) {
    el.prev.title = "Back to the start";
    el.next.title = "Back to the start";
  }

  let statusTimer = 0;
  let swapTimer = 0;
  let last = { bass: -1, mid: -1, pulse: -1, drop: -1 };

  return {
    el,
    showTrack(track, animate) {
      const apply = () => {
        el.title.textContent = track.title;
        el.artist.textContent = track.artist || "";
        el.now.classList.remove("swap");
      };
      clearTimeout(swapTimer);
      if (!animate) return apply();
      el.now.classList.add("swap");
      swapTimer = setTimeout(apply, 220);
    },
    showLive(source) {
      el.title.textContent = source === "mic" ? "Microphone" : "Tab audio";
      el.artist.textContent = source === "mic" ? "Listening to the room" : "Listening to the shared tab";
    },
    setPlaying(playing, live) {
      el.body.classList.toggle("is-playing", playing);
      const label = live ? "Stop" : playing ? "Pause" : "Play";
      el.playLabel.textContent = label;
      el.play.setAttribute("aria-label", label);
      el.prev.disabled = live;
      el.next.disabled = live;
    },
    setSource(source) {
      el.sourceLabel.textContent = source === "mic" ? "Microphone" : source === "tab" ? "Tab audio" : "Songs";
      const radio = el.panel.querySelector(`input[value="${source}"]`);
      if (radio) radio.checked = true;
    },
    setScene(name) {
      for (const b of el.sceneButtons) b.setAttribute("aria-pressed", String(b.dataset.scene === name));
    },
    disableScenes(names) {
      for (const b of el.sceneButtons) if (names.includes(b.dataset.scene)) b.disabled = true;
    },
    setScheme(scheme) {
      el.body.classList.toggle("scheme-light", scheme === "light");
      el.body.classList.toggle("scheme-dark", scheme === "dark");
      el.scheme.setAttribute("aria-label", scheme === "light" ? "Switch to dark" : "Switch to light");
    },
    setSensitivity(v) {
      el.sens.value = String(v);
      el.sensOut.textContent = Number(v).toFixed(1);
    },
    say(message, error = false) {
      clearTimeout(statusTimer);
      el.status.textContent = message;
      el.status.classList.toggle("error", error);
      if (message) statusTimer = setTimeout(() => (el.status.textContent = ""), 6000);
    },
    openPanel(open) {
      el.panel.hidden = !open;
      el.sourceBtn.setAttribute("aria-expanded", String(open));
    },
    get panelOpen() {
      return !el.panel.hidden;
    },
    showChrome(show) {
      el.body.classList.toggle("chrome-off", !show);
    },
    get chromeShown() {
      return !el.body.classList.contains("chrome-off");
    },
    veil(on) {
      el.veil.classList.toggle("on", on);
    },
    // The kinetic title: weight and width follow the music, and it kicks in scale and glow on each beat and drop.
    drive(bands, beat) {
      const bass = Math.round(Math.min(1, bands.bass) * 100) / 100;
      const mid = Math.round(Math.min(1, bands.mid) * 100) / 100;
      const pulse = Math.round(beat.pulse * 100) / 100;
      const drop = Math.round((beat.drop || 0) * 100) / 100;
      if (bass !== last.bass) el.now.style.setProperty("--bass", bass);
      if (mid !== last.mid) el.now.style.setProperty("--mid", mid);
      if (pulse !== last.pulse) el.now.style.setProperty("--pulse", pulse);
      if (drop !== last.drop) el.now.style.setProperty("--drop", drop);
      last = { bass, mid, pulse, drop };
    },
    sceneNames,
  };
}
