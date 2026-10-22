# Music Visualizer

## What this makes

A full-screen page that plays the person's songs and turns them into a scene that moves with the music. Four
scenes: Terrain (a neon landscape built from the sound's recent history), Orb (a glowing shape that swells with the
bass and throws a halo of sparks on each beat), Tunnel (a flight through rings that pulse with every kick), and Rings
(a ring of light around the waveform). The page can also listen to the microphone, or on a computer to another
browser tab's sound. Three color themes, each with a light and a dark look. Works on phones and computers, with
the controls hidden by a single tap.

The output is a folder, `out/music-visualizer/`, holding the page, the songs, and everything the page needs. It
fetches nothing from the internet.

## Run

```sh
cd <project> && python3 <agent-apps root>/music-visualizer/scripts/run.py
```

It reads `music-visualizer.inputs.json` from the project folder (copy `inputs.example.json` there to start), checks
every key, copies the page and each song into `out/music-visualizer/`, and prints the size of the songs. A missing
or wrong key, or a song file that is not there, is named in one line and the run stops with exit code 2. Two runs
on the same inputs write the same files.

## Check

```sh
cd <project> && ls out/music-visualizer/index.html out/music-visualizer/config.js out/music-visualizer/media/
```

`media/` holds one file per song in `tracks` (or `demo-afterglow.wav` when the list is empty), and `config.js`
lists them. Serve the folder as below and open it: the scene moves to the first song right away with the sound off,
and Play starts the sound from the same moment.

## Host

```sh
cd <project> && python3 -m http.server 8000 --directory out/music-visualizer
```

Then open http://localhost:8000/. The page has to be served, never opened as a file. Any static host works for
putting it online: upload the whole `out/music-visualizer/` folder. The microphone and tab audio need an `https://`
address or `localhost`.

## Make it yours

Ask the person, in one message: which songs on this computer to put in (a folder or a few files), what the page
should be called, and which colors they want: neon, ember, or mono. No keys or accounts are needed.

Every key of `music-visualizer.inputs.json`:

| Key | What it does |
|---|---|
| `title` | The page's name, shown in the corner and the browser tab. Required. |
| `tracks` | The songs in play order, each `{"file": "music/song.mp3", "title": "Song", "artist": "Artist"}`. `file` is relative to the inputs file; `title` defaults to the file name. An empty list plays a 24-second demo track. Required. |
| `scene` | The scene the page opens on: `terrain`, `orb`, `tunnel`, or `rings`. Default `orb`. |
| `theme` | `neon`, `ember`, or `mono`; any file in `site/themes/` is a theme. Default `neon`. |
| `sensitivity` | How hard the scenes react, 0.5 to 2. Default 1. |

Changes beyond the inputs:

- **A new theme** is a copy of `site/themes/neon.css` with new values: the page's colors (`--color-*`) and the
  scene's (`--scene-bg`, `--scene-bg-2`, `--scene-1` to `--scene-3`, `--scene-glow` for how much the scene glows,
  `--scene-additive` 1 for light that adds up on dark backgrounds or 0 for solid color on light ones). The color
  button on the page cycles through every theme file.
- **A scene** is one file in `site/scene/` exporting `init`, `update(bands, beat, dt)`, `resize`, and `dispose`;
  `bands` carries `bass`, `mid`, `treble`, `energy`, a 96-step `spectrum`, and the `wave`, and `beat` carries `hit`,
  a decaying `pulse`, and `drop`, which is strongest on the first beat after a quiet stretch. Register it in `site/scene/world.js` and add its button in `site/index.html`.
- **The type** is Bricolage Grotesque in `site/fonts/`; swap the files and the `@font-face` rules in
  `site/styles/base.css`.

Large music folders make a large page: the run prints the size so it can be said before the page goes online.
Nothing here needs Node or a build step.
