// src/lib/ambientEngine.js — upbeat casino / poker-room lounge music.
//
// Synthesized live with the Web Audio API (no recording, no sample, no
// external asset → zero copyright/licensing question, zero file weight, loops
// forever). Style: bright swinging lounge jazz you'd hear in a card room — a
// walking upright bass, comped chord stabs on the offbeats, a soft ride-cymbal
// pulse, and a light noodling melody, over a I–vi–ii–V turnaround in C major.
//
// The music-theory core (noteToFreq / nextChordIndex / walkBassSemitone /
// pickCompSemitones / pickMelodySemitone) is pure and deterministic under a
// supplied rng, so it is unit-tested with no AudioContext. createAmbientEngine()
// wraps it in an AudioContext and is only constructed in the browser.

// Semitone → frequency. Reference: semitone 0 = A3 = 220 Hz, so the C-major
// tonic C4 is semitone 3 (220 * 2^(3/12) ≈ 261.6 Hz).
export function noteToFreq(semitone) {
  return 220 * Math.pow(2, semitone / 12);
}

// C-major scale as semitone offsets from A3: C D E F G A B (+ octave).
export const SCALE = [3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 20, 22, 24, 27];

// A bright I–vi–ii–V turnaround (Cmaj9 – Am9 – Dm9 – G13), one bar each.
// `root` is the bass root (semitone), `voicing` is the comped chord tones,
// `bassTones` are the notes the walking bass steps through over the bar.
export const CHORDS = [
  { name: 'Cmaj9', root: 3,  voicing: [7, 10, 14, 17], bassTones: [3, 7, 10, 8] },   // C  (C E G B / walk C-E-G-F)
  { name: 'Am9',   root: 0,  voicing: [7, 12, 15, 19], bassTones: [0, 3, 7, 5] },    // A  (walk A-C-E-D)
  { name: 'Dm9',   root: 5,  voicing: [8, 12, 17, 19], bassTones: [5, 8, 12, 10] },  // D  (walk D-F-A-G)
  { name: 'G13',   root: 10, voicing: [12, 17, 21, 22], bassTones: [10, 14, 17, 15] },// G (walk G-B-D-C)
];

// Progression walks in order (a turnaround is meant to cycle) with a rare
// two-bar linger on the tonic for a touch of variation.
export function nextChordIndex(current, rng = Math.random) {
  if (current === 0 && rng() < 0.12) return 0; // occasionally sit on the I
  return (current + 1) % CHORDS.length;
}

// Walking bass note for a given beat (0-3) of the current chord's bar.
export function walkBassSemitone(chordIdx, beat) {
  const c = CHORDS[chordIdx];
  return c.bassTones[beat % c.bassTones.length] - 12; // an octave down, upright range
}

// Comp voicing (short chord stab) for the current chord — the mid-register pad.
export function pickCompSemitones(chordIdx) {
  return CHORDS[chordIdx].voicing;
}

// A light melody note drawn from the scale, biased to the bright upper register.
export function pickMelodySemitone(rng = Math.random) {
  const idx = Math.floor((0.45 + rng() * 0.55) * SCALE.length);
  return SCALE[Math.min(idx, SCALE.length - 1)] + 12;
}

// ─── Audio engine (browser only) ─────────────────────────────────────────────
export function createAmbientEngine() {
  if (typeof window === 'undefined' || !(window.AudioContext || window.webkitAudioContext)) {
    return null;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();

  // Master → gentle lowpass (kept fairly open for brightness) → light delay
  const master = ctx.createGain();
  master.gain.value = 0.0001;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 3200; lp.Q.value = 0.3;

  const delay = ctx.createDelay(0.6);
  delay.delayTime.value = 0.28;
  const fb = ctx.createGain(); fb.gain.value = 0.18;
  const wet = ctx.createGain(); wet.gain.value = 0.14;

  master.connect(lp);
  lp.connect(ctx.destination);
  lp.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(ctx.destination);

  // Shared noise buffer for the ride/hi-hat ticks
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  let chordIdx = 0;
  let running = false;
  let timer = null;

  const BEAT = 0.5;      // 120 bpm feel
  const SWING = 0.09;    // offbeat delay for a swung, lounge groove

  // Plucked upright-bass note: triangle with a quick body and short decay.
  function bassNote(freq, when, dur) {
    const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.34, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur * 0.9);
    osc.connect(g); g.connect(master);
    osc.start(when); osc.stop(when + dur);
  }

  // Comp stab: a small stack of sine partials, soft attack, medium release.
  function compStab(freqs, when, gain) {
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator(); osc.type = i === 0 ? 'sine' : 'triangle'; osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(gain, when + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.55);
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (p) { p.pan.value = (i % 2 ? 0.3 : -0.3); osc.connect(g); g.connect(p); p.connect(master); }
      else   { osc.connect(g); g.connect(master); }
      osc.start(when); osc.stop(when + 0.6);
    });
  }

  // Ride/hi-hat tick: short filtered-noise burst.
  function tick(when, gain) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start(when); src.stop(when + 0.1);
  }

  // Melody note: a bright, quick bell-ish blip.
  function melody(freq, when, gain) {
    const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
    osc.connect(g); g.connect(master);
    osc.start(when); osc.stop(when + 1.0);
  }

  function scheduleBar() {
    if (!running) return;
    const now = (ctx.getCurrentTime ? ctx.getCurrentTime() : ctx.currentTime) + 0.06;
    const comp = pickCompSemitones(chordIdx);

    for (let beat = 0; beat < 4; beat++) {
      const t = now + beat * BEAT;
      // Walking bass on every beat
      bassNote(noteToFreq(walkBassSemitone(chordIdx, beat)), t, BEAT * 0.95);
      // Ride pulse on the beat, swung ghost tick on the "and"
      tick(t, 0.05);
      tick(t + BEAT / 2 + SWING, 0.03);
      // Comp stabs on the "and" of 2 and 4 (offbeat push)
      if (beat === 1 || beat === 3) compStab(comp.map(s => noteToFreq(s)), t + BEAT / 2 + SWING, 0.06);
      // Occasional melody blip
      if (Math.random() < 0.28) melody(noteToFreq(pickMelodySemitone()), t + (Math.random() < 0.5 ? 0 : BEAT / 2 + SWING), 0.07);
    }

    chordIdx = nextChordIndex(chordIdx);
    timer = setTimeout(scheduleBar, BEAT * 4 * 1000);
  }

  return {
    async start(targetGain = 0.5) {
      if (running) return;
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
      running = true;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
      master.gain.exponentialRampToValueAtTime(Math.max(0.0002, targetGain), now + 1.5);
      scheduleBar();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    },
    setVolume(v) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
      master.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), now + 0.3);
    },
    get running() { return running; },
    _ctx: ctx,
  };
}
