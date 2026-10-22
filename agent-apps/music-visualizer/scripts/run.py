"""Builds the Music Visualizer page from music-visualizer.inputs.json in the current folder.

Run it from the project folder:
    cd <project> && python3 <agent-apps root>/music-visualizer/scripts/run.py

It reads the inputs, copies the page into out/music-visualizer/, copies every song the inputs name into
out/music-visualizer/media/, and writes config.js and theme.css. With no songs named, it writes a
24-second demo track so the page plays and reacts with nothing else present. Two runs on the same inputs
give the same files, byte for byte.
"""

import argparse
import json
import math
import shutil
import sys
import wave
from array import array
from operator import add
from pathlib import Path

SLUG = "music-visualizer"
INPUTS = f"{SLUG}.inputs.json"
SCENES = ("terrain", "orb", "tunnel", "rings")
KEYS = {
    "title": "the page's name, a short line of text",
    "tracks": "a list of songs, each {\"file\": ..., \"title\": ..., \"artist\": ...}",
    "scene": "one of terrain, orb, tunnel, or rings",
    "theme": "the name of a theme file",
    "sensitivity": "a number from 0.5 to 2",
}
REQUIRED = ("title", "tracks")
DEFAULTS = {"scene": "orb", "theme": "neon", "sensitivity": 1.0}
DEMO = {"file": "media/demo-afterglow.wav", "title": "Afterglow", "artist": "120 BPM in A minor"}


def fail(problems):
    for line in problems:
        print(line)
    sys.exit(2)


def validate(inputs, themes):
    problems = []
    if not isinstance(inputs, dict):
        return [f"{INPUTS} must hold one object with the keys {', '.join(KEYS)}."]
    for key in REQUIRED:
        if key not in inputs:
            problems.append(f'{INPUTS} is missing the key "{key}".')
    for key in inputs:
        if key not in KEYS and key != "_notes":
            problems.append(f'{INPUTS} has a key this page does not use: "{key}".')
    title = inputs.get("title")
    if "title" in inputs and (not isinstance(title, str) or not title.strip()):
        problems.append(f'"title" must be {KEYS["title"]}.')
    tracks = inputs.get("tracks")
    if "tracks" in inputs:
        if not isinstance(tracks, list):
            problems.append(f'"tracks" must be {KEYS["tracks"]}.')
        else:
            for i, t in enumerate(tracks, 1):
                if not isinstance(t, dict) or not isinstance(t.get("file"), str) or not t["file"].strip():
                    problems.append(f'Song {i} in "tracks" needs a "file" naming a song on this computer.')
                    continue
                for field in ("title", "artist"):
                    if field in t and not isinstance(t[field], str):
                        problems.append(f'Song {i} in "tracks" has a "{field}" that is not text.')
                extra = [k for k in t if k not in ("file", "title", "artist")]
                for k in extra:
                    problems.append(f'Song {i} in "tracks" has a key this page does not use: "{k}".')
    scene = inputs.get("scene", DEFAULTS["scene"])
    if scene not in SCENES:
        problems.append(f'"scene" must be one of {", ".join(SCENES)}; it is "{scene}".')
    theme = inputs.get("theme", DEFAULTS["theme"])
    if not isinstance(theme, str) or theme not in themes:
        problems.append(f'"theme" must name a theme file; the themes are {", ".join(themes)}.')
    sens = inputs.get("sensitivity", DEFAULTS["sensitivity"])
    if isinstance(sens, bool) or not isinstance(sens, (int, float)) or not 0.5 <= sens <= 2:
        problems.append(f'"sensitivity" must be {KEYS["sensitivity"]}.')
    return problems


# The demo track: 120 BPM in A minor, Am F C G one bar each. Bar 1 is the intro (pads, a muffled kick, a
# riser), bars 9 and 10 break down, and bars 11 and 12 build back to the top. The file starts on the intro's second
# half, so the drop lands at 1 s; the intro's first half closes the file, and a loop hears the whole intro.
RATE = 32000
BPM = 120
BEAT = 60 / BPM
BARS = 12
LENGTH = int(RATE * BEAT * 4 * BARS)
CHORDS = ((57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62))  # Am, F, C, G as MIDI notes


def hz(note):
    return 440.0 * 2 ** ((note - 69) / 12)


class Noise:
    """A fixed linear congruential sequence, so the track is the same on every run."""

    def __init__(self, seed):
        self.s = seed

    def next(self):
        self.s = (self.s * 1103515245 + 12345) & 0x7FFFFFFF
        return self.s / 0x3FFFFFFF - 1.0


def kick(muffled):
    n = int(RATE * 0.42)
    out = [0.0] * n
    phase = 0.0
    for i in range(n):
        t = i / RATE
        f = 46 + 120 * math.exp(-t * 34)
        phase += 2 * math.pi * f / RATE
        env = math.exp(-t * (9 if not muffled else 14))
        click = math.exp(-t * 400) * 0.35 if not muffled else 0.0
        out[i] = (math.sin(phase) * env + click) * (0.8 if not muffled else 0.4)
    return out


def noise_hit(n_sec, decay, seed, hp, gain):
    n = int(RATE * n_sec)
    rnd = Noise(seed)
    out = [0.0] * n
    prev = 0.0
    low = 0.0
    for i in range(n):
        x = rnd.next()
        low += (x - low) * hp
        v = x - low if hp > 0 else x
        prev = v
        out[i] = prev * math.exp(-i / RATE * decay) * gain
    return out


def clap():
    a = noise_hit(0.22, 16, 7, 0.25, 0.42)
    b = noise_hit(0.22, 60, 11, 0.25, 0.25)
    off = int(RATE * 0.012)
    for i in range(len(b) - off):
        a[i + off] += b[i]
    return a


def pluck(note, length, gain, bright):
    n = int(RATE * length)
    out = [0.0] * n
    f = hz(note)
    w = 2 * math.pi * f / RATE
    for i in range(n):
        t = i / RATE
        p = w * i
        env = math.exp(-t * bright)
        out[i] = (math.sin(p) + 0.5 * math.sin(2 * p) * env + 0.25 * math.sin(3 * p) * env) * env * gain
    return out


def pad_bar(chord, gain):
    n = int(RATE * BEAT * 4)
    out = [0.0] * n
    voices = []
    for note in chord:
        for detune in (-0.08, 0.08):
            voices.append(2 * math.pi * hz(note + detune) / RATE)
    voices.append(2 * math.pi * hz(chord[0] - 12) / RATE)
    for i in range(n):
        x = 0.0
        for w in voices:
            p = w * i
            x += math.sin(p) + 0.33 * math.sin(2 * p) + 0.12 * math.sin(3 * p)
        swell = min(1.0, i / (RATE * 0.25)) * min(1.0, (n - i) / (RATE * 0.12))
        out[i] = x * swell * gain
    return out


def place(buf, start, sample):
    start = int(start)
    end = min(len(buf), start + len(sample))
    if end > start:
        buf[start:end] = list(map(add, buf[start:end], sample[: end - start]))


def demo_wav(path):
    drums = [0.0] * LENGTH
    music = [0.0] * LENGTH
    bar = BEAT * 4 * RATE
    k_full, k_soft = kick(False), kick(True)
    hat = noise_hit(0.05, 90, 3, 0.85, 0.16)
    open_hat = noise_hit(0.22, 18, 5, 0.85, 0.12)
    cl = clap()
    pads = [pad_bar(c, 0.06) for c in CHORDS]
    bass = {c[0]: pluck(c[0] - 24, BEAT / 2 * 0.95, 0.55, 7) for c in CHORDS}
    arp = {}
    pump = [1.0] * LENGTH
    for b in range(BARS):
        chord = CHORDS[b % 4]
        start = b * bar
        full = 1 <= b <= 8
        breakdown = b in (9, 10)
        build = b == 11 or b == 0
        place(music, start, pads[b % 4])
        for beat in range(4):
            t = start + beat * BEAT * RATE
            if full:
                place(drums, t, k_full)
                place(drums, t + BEAT * RATE / 2, open_hat)
                d = int(RATE * 0.32)
                for i in range(d):
                    j = int(t) + i
                    if j < LENGTH:
                        pump[j] = 0.35 + 0.65 * (i / d) ** 0.6
            elif b == 0 or b == 11:
                place(drums, t, k_soft)
            if full and beat in (1, 3):
                place(drums, t, cl)
            if full or breakdown:
                for s in range(4):
                    place(drums, t + s * BEAT * RATE / 4, hat)
            if full:
                for e in range(2):
                    place(music, t + e * BEAT * RATE / 2, bass[chord[0]])
            if full or breakdown:
                for s in range(4):
                    note = chord[(beat * 4 + s) % 3] + 12 + (12 if s == 3 else 0)
                    if note not in arp:
                        arp[note] = pluck(note, BEAT / 4 * 1.6, 0.13, 22)
                    place(music, t + s * BEAT * RATE / 4, arp[note])
        if build:
            rnd = Noise(19 + b)
            n = int(bar)
            low = 0.0
            for i in range(n):
                low += (rnd.next() - low) * 0.5
                rise = (i / n) ** 2
                music[int(start) + i] += low * rise * 0.1
        if b == 11:
            for s in range(16):
                place(drums, start + s * BEAT * RATE / 4, [v * (0.3 + s / 22) for v in cl])
    mixed = [d + m * p for d, m, p in zip(drums, music, pump)]
    cue = int(RATE * BEAT * 2)
    mixed = mixed[cue:] + mixed[:cue]
    loud = sorted(abs(v) for v in mixed[:: 7])
    peak = loud[int(len(loud) * 0.995)] or 1.0
    scale = 0.9 / peak
    frames = array("h", (int(math.tanh(v * scale * 1.2) * 30000) for v in mixed))
    if sys.byteorder == "big":
        frames.byteswap()
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(frames.tobytes())


def size_words(n):
    if n >= 1024 * 1024:
        return f"{n / (1024 * 1024):.1f} MB"
    return f"{max(1, round(n / 1024))} KB"


def main():
    argparse.ArgumentParser(description="Build the Music Visualizer page from " + INPUTS).parse_args()
    app = Path(__file__).resolve().parents[1]
    project = Path.cwd()
    site = app / "site"
    themes = sorted(p.stem for p in (site / "themes").glob("*.css"))
    src = project / INPUTS
    if not src.is_file():
        fail([f"Make {INPUTS} in this folder first; inputs.example.json shows every key."])
    try:
        inputs = json.loads(src.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        fail([f"{INPUTS} is not valid JSON: {e}."])
    problems = validate(inputs, themes)
    if problems:
        fail(problems)

    tracks = inputs["tracks"]
    missing = []
    for i, t in enumerate(tracks, 1):
        if not (project / t["file"]).is_file():
            missing.append(f'Song {i} in "tracks" names a file that is not there: {t["file"]}')
    if missing:
        fail(missing)

    out = project / "out" / SLUG
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(site, out)
    shutil.copyfile(app / "assets" / "icon.svg", out / "icon.svg")
    media = out / "media"
    media.mkdir()

    written = []
    if tracks:
        for i, t in enumerate(tracks, 1):
            source = project / t["file"]
            name = f"{i:02d}-{source.name}"
            shutil.copyfile(source, media / name)
            written.append({
                "file": f"media/{name}",
                "title": t.get("title") or source.stem,
                "artist": t.get("artist", ""),
            })
    else:
        demo_wav(out / DEMO["file"])
        written.append(dict(DEMO))

    config = {
        "title": inputs["title"].strip(),
        "tracks": written,
        "scene": inputs.get("scene", DEFAULTS["scene"]),
        "theme": inputs.get("theme", DEFAULTS["theme"]),
        "sensitivity": inputs.get("sensitivity", DEFAULTS["sensitivity"]),
        "themes": themes,
    }
    shutil.copyfile(site / "themes" / f"{config['theme']}.css", out / "theme.css")
    (out / "config.js").write_text(f"window.__APP_CONFIG__ = {json.dumps(config)};\n", encoding="utf-8")

    media_bytes = sum(p.stat().st_size for p in media.iterdir())
    files = sum(1 for p in out.rglob("*") if p.is_file())
    label = "the demo track" if not tracks else f"{len(written)} song{'s' if len(written) != 1 else ''}"
    print(f"Songs: {label}, {size_words(media_bytes)} in out/{SLUG}/media/.")
    print(f"Wrote out/{SLUG}/ ({files} files). Serve it: python3 -m http.server 8000 --directory out/{SLUG}")


if __name__ == "__main__":
    main()
