'use client';
// Floating music control + lifecycle for the generative lounge soundtrack.
// The engine (src/lib/ambientEngine.js) is synthesized live in the browser —
// no audio files, no licensing. Browser autoplay policy means sound can only
// begin after a user gesture, so we lazily start on the first tap/keypress
// once the user has opted in. The choice (on/off + volume) persists.

import { useEffect, useRef, useState, useCallback } from 'react';
import { createAmbientEngine } from '../lib/ambientEngine';

const PREF_KEY = 'pvp-music';

function loadPref() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (raw && typeof raw.on === 'boolean') return raw;
  } catch {}
  return { on: true, vol: 0.5 }; // default: on at a gentle volume
}

export default function AmbientMusic() {
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

  if (!mounted) return null;

  return (
    <div className="music-fab" onMouseEnter={() => setExpanded(true)} onMouseLeave={() => setExpanded(false)}>
      {expanded && on && (
        <input
          type="range" min="0" max="1" step="0.05" value={vol}
          onChange={(e) => changeVol(parseFloat(e.target.value))}
          aria-label="Music volume"
          className="music-vol"
        />
      )}
      <button
        onClick={toggle}
        aria-label={on ? 'Mute lounge music' : 'Play lounge music'}
        title={on ? 'Mute lounge music' : 'Play lounge music'}
        className="music-btn"
        style={{ color: on ? 'var(--gold-pale)' : 'var(--text-secondary)' }}
      >
        <span style={{ fontSize: 15 }}>♪</span>
        {on && <span className="music-eq" aria-hidden><i/><i/><i/></span>}
        <span style={{ fontSize: 10, letterSpacing: 1.5 }}>{on ? 'MUSIC' : 'MUTED'}</span>
      </button>
    </div>
  );
}
