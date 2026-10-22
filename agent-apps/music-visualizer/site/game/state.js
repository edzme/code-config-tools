// What the page remembers between visits: the last scene, colors, light or dark, and sensitivity.
// Keys carry the app's slug so several apps on one address never read each other's choices.
const PREFIX = "music-visualizer:";

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage is full or off; the choice lasts for this visit only.
  }
}

export function loadRaw(key) {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function saveRaw(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage is full or off; the choice lasts for this visit only.
  }
}
