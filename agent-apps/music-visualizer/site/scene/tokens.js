// Reads the theme's scene colors from the CSS custom properties, so a theme file recolors the world.
import * as THREE from "three";

function readColor(style, name, fallback) {
  const raw = style.getPropertyValue(name).trim();
  const color = new THREE.Color(fallback);
  if (!raw) return color;
  const hex = raw.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    // Only the color part; an alpha suffix is ignored for scene colors.
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
    color.setStyle("#" + h.slice(0, 6));
  } else {
    color.setStyle(raw);
  }
  return color;
}

function readNumber(style, name, fallback) {
  const v = parseFloat(style.getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

export function readTokens() {
  const style = getComputedStyle(document.documentElement);
  const tokens = {
    bg: readColor(style, "--scene-bg", 0x06051a),
    bg2: readColor(style, "--scene-bg-2", 0x1d0b3f),
    c1: readColor(style, "--scene-1", 0x3ef2ff),
    c2: readColor(style, "--scene-2", 0xff3fb4),
    c3: readColor(style, "--scene-3", 0x8b5bff),
    text: readColor(style, "--color-text", 0xffffff),
    glow: readNumber(style, "--scene-glow", 1),
    additive: readNumber(style, "--scene-additive", 1) > 0.5,
    grain: readNumber(style, "--scene-grain", 0.06),
  };
  tokens.dark = tokens.bg.getHSL({ h: 0, s: 0, l: 0 }).l < 0.5;
  tokens.css = {
    bg: "#" + tokens.bg.getHexString(),
    bg2: "#" + tokens.bg2.getHexString(),
    c1: "#" + tokens.c1.getHexString(),
    c2: "#" + tokens.c2.getHexString(),
    c3: "#" + tokens.c3.getHexString(),
  };
  return tokens;
}
