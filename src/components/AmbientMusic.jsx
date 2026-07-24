'use client';
// Floating music control + lifecycle for the generative lounge soundtrack.
// The engine (src/lib/ambientEngine.js) is synthesized live in the browser —
// no audio files, no licensing. Browser autoplay policy means sound can only
// begin after a user gesture, so we lazily start on the first tap/keypress
// once the user has opted in. The choice (on/off + volume) persists.

import { useEffect, useRef, useState, useCallback } from 'react';
import { createAmbientEngine } from '../lib/ambientEngine';
import { isSfxEnabled, setSfxEnabled, playSfx } from '../lib/soundFx';

const PREF_KEY = 'pvp-music';

function loadPref() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (raw && typeof raw.on === 'boolean') return raw;
  } catch {}
  return { on: true, vol: 0.5 }; // default: on at a gentle volume
}

function useMusic() {
  const engineRef = useRef(null);
  const [mounted, setMounted]   = useState(false);
  const [on, setOn]             = useState(false);
  const [vol, setVol]           = useState(0.5);
  const [expanded, setExpanded] = useState(false);
  const startedRef = useRef(false);

  // Load persisted preference after mount (avoids SSR/localStorage mismatch).
  useEffect(() => {
    const p = loadPref();
    setOn(p.on);
    setVol(p.vol);
    setMounted(true);
  }, []);

  const persist = useCallback((next) => {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch {}
  }, []);

  // Ensure the engine exists and is running (called from a user gesture).
  const ensureRunning = useCallback((targetVol) => {
    if (!engineRef.current) engineRef.current = createAmbientEngine();
    const e = engineRef.current;
    if (!e) return;
    e.start(targetVol);
    startedRef.current = true;
  }, []);

  // First user gesture anywhere starts the music if the user is opted in.
  useEffect(() => {
    if (!mounted || !on) return;
    if (startedRef.current) return;
    const kick = () => {
      if (on && !startedRef.current) ensureRunning(vol);
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });
    return () => {
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
  }, [mounted, on, vol, ensureRunning]);

  const toggle = useCallback(() => {
    const next = !on;
    setOn(next);
    persist({ on: next, vol });
    if (next) ensureRunning(vol);          // this click is a valid gesture
    else engineRef.current?.stop();
  }, [on, vol, persist, ensureRunning]);

  const changeVol = useCallback((v) => {
    setVol(v);
    persist({ on, vol: v });
    if (on) { ensureRunning(v); engineRef.current?.setVolume(v); }
  }, [on, persist, ensureRunning]);

  return { mounted, on, vol, expanded, setExpanded, toggle, changeVol };
}

export default function AmbientMusic() {
  const m = useMusic();
  const [sfx, setSfx] = useState(true);
  useEffect(() => { setSfx(isSfxEnabled()); }, []);

  const toggleSfx = useCallback(() => {
    const next = !sfx;
    setSfx(next);
    setSfxEnabled(next);
    if (next) playSfx('chip'); // a little confirmation click when turning on
  }, [sfx]);

  if (!m.mounted) return null;

  return (
    <div className="music-fab" onMouseEnter={() => m.setExpanded(true)} onMouseLeave={() => m.setExpanded(false)}>
      {m.expanded && m.on && (
        <input
          type="range" min="0" max="1" step="0.05" value={m.vol}
          onChange={(e) => m.changeVol(parseFloat(e.target.value))}
          aria-label="Music volume"
          className="music-vol"
        />
      )}
      <button
        onClick={toggleSfx}
        aria-label={sfx ? 'Mute game sounds' : 'Enable game sounds'}
        title={sfx ? 'Mute game sound effects' : 'Enable game sound effects'}
        className="music-btn"
        style={{ color: sfx ? 'var(--gold-pale)' : 'var(--text-secondary)' }}
      >
        <span style={{ fontSize: 14 }}>{sfx ? '🔊' : '🔇'}</span>
        <span style={{ fontSize: 10, letterSpacing: 1.5 }}>SFX</span>
      </button>
      <button
        onClick={m.toggle}
        aria-label={m.on ? 'Mute lounge music' : 'Play lounge music'}
        title={m.on ? 'Mute lounge music' : 'Play lounge music'}
        className="music-btn"
        style={{ color: m.on ? 'var(--gold-pale)' : 'var(--text-secondary)' }}
      >
        <span style={{ fontSize: 15 }}>♪</span>
        {m.on && <span className="music-eq" aria-hidden><i/><i/><i/></span>}
        <span style={{ fontSize: 10, letterSpacing: 1.5 }}>{m.on ? 'MUSIC' : 'MUTED'}</span>
      </button>
    </div>
  );
}
