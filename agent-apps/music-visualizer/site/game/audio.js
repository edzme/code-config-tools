// Listening: turns a song, the microphone, or a tab's sound into three smoothed bands, a 96-step spectrum, a
// waveform, and a beat. The analyser is FFT 2048. Before the first tap no sound can play, so the first song is
// decoded silently and analyzed at a moving playhead with the same window, smoothing, and decibel range the
// browser's AnalyserNode uses; the scene moves to the real music from the first frame and the Play tap continues
// from that exact moment, now audible.
const FFT_SIZE = 2048;
const BINS = FFT_SIZE / 2;
const MIN_DB = -100;
const MAX_DB = -30;
const SMOOTHING = 0.8;
const SPECTRUM_STEPS = 96;
const WAVE_POINTS = 512;
const BANDS = { bass: [30, 140], mid: [140, 2000], treble: [2000, 10000] };
const PREVIEW_DECODE_LIMIT = 60 * 1024 * 1024;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const approach = (from, to, dt, seconds) => from + (to - from) * (1 - Math.exp(-dt / seconds));

// An in-place radix-2 FFT for the silent preview; one 2048-point transform per frame.
class Transform {
  constructor(n) {
    this.n = n;
    this.re = new Float32Array(n);
    this.im = new Float32Array(n);
    this.window = new Float32Array(n);
    this.reverse = new Uint32Array(n);
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      // Blackman, the window the AnalyserNode applies.
      const x = i / n;
      this.window[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x);
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.reverse[i] = r;
    }
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
  }

  magnitudes(samples, start, out) {
    const { n, re, im, window, reverse } = this;
    const len = samples.length;
    for (let i = 0; i < n; i++) {
      let j = start + i;
      j = ((j % len) + len) % len;
      re[reverse[i]] = samples[j] * window[i];
      im[reverse[i]] = 0;
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const stride = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const c = this.cos[k * stride];
          const s = this.sin[k * stride];
          const a = i + k;
          const b = a + half;
          const tr = re[b] * c - im[b] * s;
          const ti = re[b] * s + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i]) / n;
  }
}

// Follows a band's recent floor and ceiling so a quiet song and a loud one both fill the range.
class Range {
  constructor() {
    this.lo = 0.4;
    this.hi = 0.6;
    this.primed = false;
  }

  map(v, dt) {
    if (!this.primed) {
      this.lo = v - 0.05;
      this.hi = v + 0.1;
      this.primed = true;
    }
    this.lo = v < this.lo ? approach(this.lo, v, dt, 0.4) : approach(this.lo, v, dt, 5);
    this.hi = v > this.hi ? approach(this.hi, v, dt, 0.05) : approach(this.hi, v, dt, 4);
    return clamp((v - this.lo) / Math.max(this.hi - this.lo, 0.12), 0, 1);
  }
}

export class Listener {
  constructor({ tracks, sensitivity = 1, onChange }) {
    this.tracks = tracks;
    this.index = 0;
    this.sensitivity = sensitivity;
    this.onChange = onChange || (() => {});

    this.source = "songs";
    this.mode = "preview"; // preview, playing, paused, live
    this.bytes = new Uint8Array(BINS);
    this.timeBytes = new Uint8Array(FFT_SIZE);
    this.sampleRate = 44100;

    this.bands = {
      bass: 0,
      mid: 0,
      treble: 0,
      energy: 0,
      spectrum: new Float32Array(SPECTRUM_STEPS),
      wave: new Float32Array(WAVE_POINTS),
    };
    this.beat = { hit: false, pulse: 0, drop: 0, count: 0, sinceLast: 9 };
    this.lift = 0;
    this.ranges = { bass: new Range(), mid: new Range(), treble: new Range() };
    this.history = new Float32Array(48);
    this.historyAt = 0;
    this.historyFilled = 0;

    this.preview = null;
    this.previewTime = 0;
    this.transform = new Transform(FFT_SIZE);
    this.mags = new Float32Array(BINS);
    this.smoothMags = new Float32Array(BINS);
    this.synthTime = 0;

    this.ctx = null;
    this.analyser = null;
    this.element = null;
    this.elementNode = null;
    this.liveNode = null;
    this.liveStream = null;
  }

  get track() {
    return this.tracks[this.index];
  }

  get playing() {
    return this.mode === "playing" || this.mode === "live";
  }

  async preparePreview() {
    const track = this.track;
    try {
      const response = await fetch(track.file);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.arrayBuffer();
      if (data.byteLength > PREVIEW_DECODE_LIMIT) return;
      const offline = new OfflineAudioContext(1, 1, 32000);
      const buffer = await offline.decodeAudioData(data);
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const ch = buffer.getChannelData(c);
        for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buffer.numberOfChannels;
      }
      if (track === this.track) {
        this.preview = { samples: mono, rate: buffer.sampleRate, duration: buffer.duration };
      }
    } catch {
      // The song could not be decoded here; the preview runs on a generated groove until Play.
    }
  }

  // The first tap: builds the audio graph inside the gesture, which iOS requires.
  ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "interactive" });
    this.sampleRate = this.ctx.sampleRate;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = SMOOTHING;
    this.analyser.minDecibels = MIN_DB;
    this.analyser.maxDecibels = MAX_DB;
    // The analyser reaches the output through a muted gain so the browser keeps it running for every source,
    // and the microphone is never played back into the room.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.analyser.connect(mute).connect(this.ctx.destination);

    this.element = new Audio();
    this.element.preload = "auto";
    this.element.crossOrigin = "anonymous";
    this.element.addEventListener("ended", () => this.next());
    this.elementNode = this.ctx.createMediaElementSource(this.element);
    this.elementNode.connect(this.ctx.destination);
    this.elementNode.connect(this.analyser);
    return this.ctx;
  }

  async play() {
    this.stopLive();
    this.ensureContext();
    this.source = "songs";
    const track = this.track;
    const wantSrc = new URL(track.file, location.href).href;
    let start = 0;
    if (this.element.src !== wantSrc) {
      this.element.src = track.file;
      if (this.mode === "preview" && this.preview) start = this.previewTime % this.preview.duration;
      if (start > 0) {
        await new Promise((resolve) => {
          const done = () => resolve();
          this.element.addEventListener("loadedmetadata", done, { once: true });
          this.element.addEventListener("error", done, { once: true });
        });
        try {
          this.element.currentTime = start;
        } catch {
          // Seeking is not ready; the song starts from the top.
        }
      }
    }
    const resumed = this.ctx.resume();
    try {
      await Promise.all([resumed, this.element.play()]);
      this.mode = "playing";
      this.onChange({ kind: "playing" });
    } catch {
      this.mode = "paused";
      this.onChange({ kind: "error", message: `"${track.title}" would not play in this browser.` });
    }
  }

  pause() {
    if (this.mode === "live") {
      this.stopLive();
      this.mode = "paused";
      this.source = "songs";
      this.onChange({ kind: "source", source: "songs" });
      return;
    }
    if (this.element) this.element.pause();
    this.mode = "paused";
    this.onChange({ kind: "paused" });
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  skip(step) {
    if (this.tracks.length < 2 && this.mode !== "preview") {
      if (this.element) this.element.currentTime = 0;
      this.play();
      return;
    }
    this.index = (this.index + step + this.tracks.length) % this.tracks.length;
    this.previewTime = 0;
    this.preview = null;
    this.onChange({ kind: "track" });
    this.play();
  }

  next() {
    this.skip(1);
  }

  previous() {
    if (this.element && this.element.currentTime > 4) {
      this.element.currentTime = 0;
      return;
    }
    this.skip(-1);
  }

  async listenTo(kind) {
    this.ensureContext();
    const devices = navigator.mediaDevices;
    let stream;
    try {
      if (kind === "mic") {
        stream = await devices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } else {
        stream = await devices.getDisplayMedia({
          video: true,
          audio: { suppressLocalAudioPlayback: false },
          systemAudio: "include",
          selfBrowserSurface: "exclude",
        });
        stream.getVideoTracks().forEach((t) => t.stop());
        if (stream.getAudioTracks().length === 0) {
          this.onChange({
            kind: "error",
            message: 'That share carried no sound. Pick a tab and turn on "Also share tab audio".',
          });
          return false;
        }
      }
    } catch (error) {
      const denied = error && (error.name === "NotAllowedError" || error.name === "SecurityError");
      const what = kind === "mic" ? "The microphone" : "Tab audio";
      this.onChange({
        kind: "error",
        message: denied
          ? `${what} was not allowed. Allow it for this page in the browser and pick it again.`
          : `${what} is not available in this browser.`,
      });
      return false;
    }
    if (this.element) this.element.pause();
    this.stopLive();
    await this.ctx.resume();
    this.liveStream = stream;
    this.liveNode = this.ctx.createMediaStreamSource(stream);
    this.liveNode.connect(this.analyser);
    stream.getAudioTracks().forEach((t) =>
      t.addEventListener("ended", () => {
        if (this.liveStream === stream) this.pause();
      }),
    );
    this.source = kind;
    this.mode = "live";
    this.onChange({ kind: "source", source: kind });
    return true;
  }

  stopLive() {
    if (this.liveNode) this.liveNode.disconnect();
    if (this.liveStream) this.liveStream.getTracks().forEach((t) => t.stop());
    this.liveNode = null;
    this.liveStream = null;
  }

  readPreview(dt) {
    const p = this.preview;
    this.previewTime += dt;
    const center = Math.floor(this.previewTime * p.rate) % p.samples.length;
    this.transform.magnitudes(p.samples, center - FFT_SIZE, this.mags);
    const range = MAX_DB - MIN_DB;
    for (let i = 0; i < BINS; i++) {
      const m = (this.smoothMags[i] = SMOOTHING * this.smoothMags[i] + (1 - SMOOTHING) * this.mags[i]);
      const db = 20 * Math.log10(m + 1e-12);
      this.bytes[i] = clamp(Math.round((255 * (db - MIN_DB)) / range), 0, 255);
    }
    for (let i = 0; i < FFT_SIZE; i++) {
      const j = (center - FFT_SIZE + i + p.samples.length) % p.samples.length;
      this.timeBytes[i] = clamp(Math.round(128 + p.samples[j] * 127), 0, 255);
    }
    this.sampleRate = p.rate;
  }

  // A 120 BPM groove drawn straight into the spectrum, used only while a song is still decoding.
  readSynthetic(dt) {
    this.synthTime += dt;
    const t = this.synthTime;
    const beat = (t * 2) % 1;
    const kick = Math.exp(-beat * 9);
    const hat = Math.exp(-((t * 4) % 1) * 18);
    const hz = this.sampleRate / FFT_SIZE;
    for (let i = 0; i < BINS; i++) {
      const f = i * hz;
      let v = 70 - Math.log2(1 + f / 60) * 9;
      if (f < 150) v += 120 * kick + 30;
      else if (f < 2000) v += 55 + 25 * Math.sin(t * 1.3 + f * 0.004);
      else if (f < 12000) v += 30 + 60 * hat;
      this.bytes[i] = clamp(Math.round(v + 40), 0, 255);
    }
    for (let i = 0; i < FFT_SIZE; i++) {
      this.timeBytes[i] = 128 + Math.round(60 * kick * Math.sin(i * 0.02) + 12 * Math.sin(i * 0.31 + t * 9));
    }
  }

  bandMean(lo, hi) {
    const hz = this.sampleRate / FFT_SIZE;
    const a = Math.max(1, Math.floor(lo / hz));
    const b = Math.min(BINS - 1, Math.ceil(hi / hz));
    let sum = 0;
    for (let i = a; i <= b; i++) sum += this.bytes[i];
    return sum / ((b - a + 1) * 255);
  }

  update(dt) {
    if (this.mode === "playing" || this.mode === "live") {
      this.analyser.getByteFrequencyData(this.bytes);
      this.analyser.getByteTimeDomainData(this.timeBytes);
    } else if (this.mode === "preview") {
      if (this.preview) this.readPreview(dt);
      else this.readSynthetic(dt);
    } else {
      for (let i = 0; i < BINS; i++) this.bytes[i] = this.bytes[i] * 0.9;
      this.timeBytes.fill(128);
    }

    const sens = this.sensitivity;
    const bands = this.bands;
    const raw = {
      bass: this.bandMean(...BANDS.bass),
      mid: this.bandMean(...BANDS.mid),
      treble: this.bandMean(...BANDS.treble),
    };
    const silent = this.mode === "paused";
    for (const name of ["bass", "mid", "treble"]) {
      const target = silent ? 0 : clamp(this.ranges[name].map(raw[name], dt) * sens, 0, 1.5);
      const decay = name === "bass" ? 0.22 : name === "mid" ? 0.16 : 0.1;
      bands[name] = approach(bands[name], target, dt, target > bands[name] ? 0.025 : decay);
    }
    bands.energy = bands.bass * 0.5 + bands.mid * 0.3 + bands.treble * 0.2;

    const hz = this.sampleRate / FFT_SIZE;
    const lowLog = Math.log(30);
    const highLog = Math.log(14000);
    const lift = Math.sqrt(sens);
    for (let s = 0; s < SPECTRUM_STEPS; s++) {
      const fa = Math.exp(lowLog + ((highLog - lowLog) * s) / SPECTRUM_STEPS);
      const fb = Math.exp(lowLog + ((highLog - lowLog) * (s + 1)) / SPECTRUM_STEPS);
      const a = Math.max(1, Math.floor(fa / hz));
      const b = Math.max(a, Math.min(BINS - 1, Math.floor(fb / hz)));
      let peak = 0;
      for (let i = a; i <= b; i++) if (this.bytes[i] > peak) peak = this.bytes[i];
      const v = clamp(((peak / 255 - 0.3) / 0.62) * lift, 0, 1);
      bands.spectrum[s] = approach(bands.spectrum[s], v, dt, v > bands.spectrum[s] ? 0.02 : 0.12);
    }
    const stride = FFT_SIZE / WAVE_POINTS;
    for (let i = 0; i < WAVE_POINTS; i++) bands.wave[i] = (this.timeBytes[i * stride] - 128) / 128;

    // The beat: the bass level against its last 0.8 seconds, with at least a quarter second between beats. The drop
    // is how far a beat lands above the last two seconds of bass, so the first kick after a quiet stretch hits hardest
    // and fades over about a second; steady beats keep a smaller swell of it.
    const beat = this.beat;
    let avg = 0;
    const n = this.historyFilled;
    for (let i = 0; i < n; i++) avg += this.history[i];
    avg = n ? avg / n : 0;
    const level = silent ? 0 : this.ranges.bass.map(raw.bass, 0);
    beat.sinceLast += dt;
    beat.hit = false;
    if (n > 20 && level > 0.45 && level > avg + 0.22 / sens && beat.sinceLast > 0.25) {
      beat.hit = true;
      beat.count += 1;
      beat.sinceLast = 0;
      beat.pulse = 1;
      beat.drop = Math.max(beat.drop, clamp(0.3 + (level - this.lift) * 2.2, 0.3, 1));
    }
    beat.pulse *= Math.exp(-dt * 5.5);
    beat.drop *= Math.exp(-dt * 1.6);
    this.lift += (level - this.lift) * Math.min(1, dt / 2);
    this.history[this.historyAt] = level;
    this.historyAt = (this.historyAt + 1) % this.history.length;
    this.historyFilled = Math.min(this.history.length, this.historyFilled + 1);
    return bands;
  }
}
