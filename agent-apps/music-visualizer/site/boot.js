// Runs before first paint: applies the remembered light or dark choice and colors, so the page never flashes the
// wrong look. Every key is prefixed with the app's slug because several apps can share one address.
(function () {
  var config = window.__APP_CONFIG__ || {};
  var root = document.documentElement;
  try {
    var scheme = localStorage.getItem("music-visualizer:scheme");
    if (scheme === "light" || scheme === "dark") root.setAttribute("data-theme", scheme);
    var palette = localStorage.getItem("music-visualizer:palette");
    if (palette && /^[a-z]+$/.test(palette) && palette !== config.theme) {
      document.getElementById("theme-link").href = "./themes/" + palette + ".css";
    }
  } catch (e) {
    // Storage is off in this browser; the page uses the inputs' choices.
  }
  if (config.title) document.title = config.title;
})();
