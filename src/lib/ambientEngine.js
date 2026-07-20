// src/lib/ambientEngine.js — generative ambient music for the poker lounge.
//
// Everything here is synthesized live with the Web Audio API: there is no
// recording, no sample, no external asset — so it is entirely free of any
// copyright or licensing question, weighs nothing, and loops forever without
// a seam. The vibe: slow, smoky jazz-noir chord pads in A minor with a soft
// sub bass and the occasional distant bell note, sitting well under the UI.
//
// The note-selection core (noteToFreq / nextChordIndex / pickBellSemitone) is
// pure and deterministic under a supplied rng, so it can be unit-tested with
// no audio context. createAmbientEngine() wraps it in an AudioContext and is
// only constructed in the browser.

// Semitone → frequency, A4 (semitone 0 here) = 220 Hz (a warm, low register).
export function noteToFreq(semitone) {
  return 220 * Math.pow(2, semitone / 12);
}

// Chord voicings as semitone offsets from A. A jazzy i–iv–V–i-ish loop with
// 9ths for colour: Am9, Dm9, E7(b9), Am9. Kept in a low octave for the pads.
export const CHORDS = [
  { name: 'Am9',   notes: [0, 7, 12, 14] },  // A E A B
  { name: 'Dm9',   notes: [5, 12, 17, 19] }, // D A D E
  { name: 'E7b9',  notes: [7, 11, 16, 20] }, // E G# C# ... (dominant tension)
  { name: 'Am9',   notes: [0, 7, 12, 14] },
];

// The A-minor scale (semitone offsets) the bell notes are drawn from, so any
// sparkle always lands consonant with the current pad.
export const SCALE = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 19, 24];

// Progression walk: mostly advance in order, occasionally linger on the
// current chord for a more meandering, less mechanical feel.
export function nextChordIndex(current, rng = Math.random) {
  if (rng() < 0.15) return current;              // linger
  return (current + 1) % CHORDS.length;          // advance
}

// Pick a bell/melody semitone from the scale, biased toward the mid-high
// register so it shimmers above the pads.
export function pickBellSemitone(rng = Math.random) {
  const idx = Math.floor((0.4 + rng() * 0.6) * SCALE.length);
  return SCALE[Math.min(idx, SCALE.length - 1)] + 12; // up an octave
}

// ─── Audio engine (browser only) ─────────────────────────────────────────────
export function createAmbientEngine() {
  if (typeof window === 'undefined' || !(window.AudioContext || window.webkitAudioContext)) {
    return null;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();

  // Master chain: gain → gentle low-pass → soft feedback delay for space → out
  const master = ctx.createGain();
  master.gain.value = 0.0001; // start silent; caller ramps up

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  lp.Q.value = 0.4;

  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = 0.42;
  const fb = ctx.createGain();
  fb.gain.value = 0.28;
  const wet = ctx.createGain();
  wet.gain.value = 0.25;

  master.connect(lp);
  lp.connect(ctx.destination);
  lp.connect(delay);
  delay.connect(fb);
  fb.connect(delay);
  delay.connect(wet);
  wet.connect(ctx.destination);

  let chordIdx = 0;
  let timer = null;
  let running = false;

  // One soft pad voice: slow-attack sine with a long release, panned a touch.
  function padVoice(freq, when, dur, gain, pan) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = pan; osc.connect(g); g.connect(p); p.connect(master); }
    else   { osc.connect(g); g.connect(master); }
    osc.start(when);
    osc.stop(when + dur + 0.1);
  }

  // A distant bell: triangle with quick attack, long shimmering tail.
  function bell(freq, when, gain) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 2.5);
    osc.connect(g); g.connect(master);
    osc.start(when);
    osc.stop(when + 2.6);
  }

  const BAR = 7.5; // seconds per chord — slow and unhurried

  function scheduleBar() {
    if (!running) return;
    const now = ctx.getCurrentTime ? ctx.getCurrentTime() : ctx.currentTime;
    const chord = CHORDS[chordIdx];
    chord.notes.forEach((semi, i) => {
      padVoice(noteToFreq(semi - 12), now + 0.05, BAR, 0.12, (i % 2 ? 0.25 : -0.25));
    });
    // Sub bass on the root
    padVoice(noteToFreq(chord.notes[0] - 24), now + 0.05, BAR, 0.16, 0);
    // Sparse bells: ~60% of bars, one or two notes
    if (Math.random() < 0.6) {
      const n = Math.random() < 0.3 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        bell(noteToFreq(pickBellSemitone()), now + 1 + Math.random() * (BAR - 2), 0.08);
      }
    }
    chordIdx = nextChordIndex(chordIdx);
    timer = setTimeout(scheduleBar, BAR * 1000);
  }

  return {
    async start(targetGain = 0.5) {
      if (running) return;
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
      running = true;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
      master.gain.exponentialRampToValueAtTime(Math.max(0.0002, targetGain), now + 2.5);
      scheduleBar();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
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
