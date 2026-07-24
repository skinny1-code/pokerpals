// src/lib/soundFx.js — synthesized poker-room sound effects.
//
// Like the music engine, every sound is generated live with the Web Audio API
// (no recordings, no asset files, no licensing) — card flicks, chip clinks,
// knuckle knocks, the winner's chip sweep, and a "your turn" chime. Each is a
// short one-shot. A single shared AudioContext is created lazily on the first
// play (which always follows a user gesture in normal play). Muting is
// persisted to localStorage under `pvp-sfx` (default on).

export const SFX = ['deal', 'flip', 'chip', 'check', 'fold', 'allin', 'yourTurn', 'win', 'lose', 'potSweep'];

let ctx = null;
let master = null;
let enabled = true;
let loaded = false;

function loadPref() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem('pvp-sfx');
    if (raw != null) enabled = raw === '1' || raw === 'true';
  } catch {}
}

export function isSfxEnabled() { loadPref(); return enabled; }
export function setSfxEnabled(on) {
  enabled = !!on;
  try { localStorage.setItem('pvp-sfx', enabled ? '1' : '0'); } catch {}
}

function ac() {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);
  return ctx;
}

// Shared white-noise buffer for card/chip textures.
let noiseBuf = null;
function noise() {
  if (noiseBuf) return noiseBuf;
  const c = ac(); if (!c) return null;
  noiseBuf = c.createBuffer(1, c.sampleRate * 0.4, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

// A filtered noise burst — the body of card/chip/knock sounds.
function burst(when, { type = 'bandpass', freq = 2000, q = 1, gain = 0.3, dur = 0.09 }) {
  const c = ac(); if (!c) return;
  const src = c.createBufferSource(); src.buffer = noise();
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(when); src.stop(when + dur + 0.02);
}

// A short tone — used for chimes, chip ring, win/lose notes.
function tone(when, { freq = 440, type = 'sine', gain = 0.2, attack = 0.005, dur = 0.18 }) {
  const c = ac(); if (!c) return;
  const osc = c.createOscillator(); osc.type = type; osc.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g); g.connect(master);
  osc.start(when); osc.stop(when + dur + 0.02);
}

// Metallic chip clink: two close high partials + a touch of noise.
function chipClink(when, gain = 0.18) {
  tone(when, { freq: 2400, type: 'square', gain: gain * 0.5, attack: 0.002, dur: 0.07 });
  tone(when + 0.005, { freq: 3200, type: 'square', gain: gain * 0.35, attack: 0.002, dur: 0.06 });
  burst(when, { type: 'highpass', freq: 5000, gain: gain * 0.4, dur: 0.05 });
}

const RENDER = {
  // Card sliding off the deck — soft airy flick.
  deal:  (t) => burst(t, { type: 'bandpass', freq: 1600, q: 0.8, gain: 0.28, dur: 0.11 }),
  // Community card turning over — a brighter, snappier flip.
  flip:  (t) => { burst(t, { type: 'bandpass', freq: 2600, q: 1.2, gain: 0.3, dur: 0.07 });
                  burst(t + 0.05, { type: 'highpass', freq: 4000, gain: 0.16, dur: 0.05 }); },
  // Chips pushed in for a bet/call/raise.
  chip:  (t) => { chipClink(t, 0.18); chipClink(t + 0.05, 0.12); },
  // Knuckles on the felt — a check.
  check: (t) => { burst(t, { type: 'lowpass', freq: 320, gain: 0.4, dur: 0.08 });
                  burst(t + 0.12, { type: 'lowpass', freq: 300, gain: 0.32, dur: 0.08 }); },
  // Cards mucked — a soft downward swish.
  fold:  (t) => { burst(t, { type: 'bandpass', freq: 1200, q: 0.6, gain: 0.24, dur: 0.16 }); },
  // All-in — rising whoosh into a chip splash.
  allin: (t) => {
    const c = ac(); if (!c) return;
    const osc = c.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t); osc.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    osc.connect(lp); lp.connect(g); g.connect(master); osc.start(t); osc.stop(t + 0.42);
    for (let i = 0; i < 4; i++) chipClink(t + 0.3 + i * 0.04, 0.12);
  },
  // Your turn — a gentle two-note major chime.
  yourTurn: (t) => { tone(t, { freq: 660, type: 'sine', gain: 0.16, dur: 0.22 });
                     tone(t + 0.13, { freq: 880, type: 'sine', gain: 0.18, dur: 0.3 }); },
  // You won — a quick bright ascending arpeggio + chip cascade.
  win: (t) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(t + i * 0.09, { freq: f, type: 'triangle', gain: 0.18, dur: 0.28 }));
    for (let i = 0; i < 6; i++) chipClink(t + 0.1 + i * 0.05, 0.12);
  },
  // You lost the pot — a soft descending two-note.
  lose: (t) => { tone(t, { freq: 392, type: 'sine', gain: 0.14, dur: 0.24 });
                 tone(t + 0.16, { freq: 294, type: 'sine', gain: 0.14, dur: 0.34 }); },
  // Pot pushed to the winner — a run of chip clinks.
  potSweep: (t) => { for (let i = 0; i < 7; i++) chipClink(t + i * 0.045, 0.13); },
};

export function playSfx(name) {
  loadPref();
  if (!enabled) return;
  const render = RENDER[name];
  if (!render) return;
  const c = ac(); if (!c) return;
  if (c.state === 'suspended') { try { c.resume(); } catch {} }
  render((c.getCurrentTime ? c.getCurrentTime() : c.currentTime) + 0.01);
}
