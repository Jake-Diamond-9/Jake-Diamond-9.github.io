/*
 * Sine-tone playback of the Doppler calculation: the constant performer tone,
 * the time-varying tone heard by the observer, or both combined.
 *
 * Mobile (especially iOS Safari) requires audio to be unlocked inside a user
 * gesture. We play a silent buffer synchronously on that gesture before any
 * await, then resume the AudioContext and schedule the real tone.
 */
"use strict";

const MASTER_LEVEL = 0.55; // a bit louder for phone speakers
const FADE = 0.04; // seconds; short enough to feel instant, long enough to avoid clicks

let audioCtx = null;
let audioUnlocked = false;
let activeTone = null; // { oscillators, master, onEnded, stopTimer }

function tonePlaying() {
  return activeTone !== null;
}

function getAudioContext() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  return audioCtx;
}

/**
 * Must run synchronously inside a click/touch handler, before any await.
 * Plays a near-silent 1-sample buffer so iOS treats the AudioContext as
 * user-activated.
 */
function unlockAudioSync() {
  const ctx = getAudioContext();
  try {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    source.connect(g);
    g.connect(ctx.destination);
    source.start(0);
  } catch (e) {
    // ignore unlock failures; resume() may still succeed
  }
  if (ctx.state === "suspended") {
    // Fire-and-forget; also awaited later. Starting the silent buffer above
    // is what matters for keeping this call inside the user gesture.
    ctx.resume().catch(() => {});
  }
  audioUnlocked = true;
  return ctx;
}

/** Priming unlock on first pointer/touch anywhere on the page (iOS help). */
function installAudioUnlockListeners() {
  const unlock = () => {
    unlockAudioSync();
    document.removeEventListener("touchstart", unlock, true);
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("click", unlock, true);
  };
  document.addEventListener("touchstart", unlock, { capture: true, passive: true });
  document.addEventListener("pointerdown", unlock, { capture: true });
  document.addEventListener("click", unlock, { capture: true });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installAudioUnlockListeners);
  } else {
    installAudioUnlockListeners();
  }
}

/**
 * Play sine voice(s) for `duration` seconds.
 *
 * fS: performer frequency in Hz (constant voice)
 * fO: array of observed frequencies in Hz, evenly spaced over the move
 * voice: "performer" (fS only), "observer" (fO curve only), or "combined"
 * onEnded: called once when playback finishes or is stopped
 */
async function playTone({ fS, fO, duration, voice }, onEnded) {
  stopTone();

  // Synchronous unlock BEFORE any await — required on iOS Safari.
  const ctx = unlockAudioSync();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  // If still suspended (rare), bail with a clear error for the UI.
  if (ctx.state !== "running") {
    throw new Error("AudioContext is " + ctx.state);
  }

  const t0 = ctx.currentTime + 0.03;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(MASTER_LEVEL, t0 + FADE);
  master.gain.setValueAtTime(MASTER_LEVEL, t0 + Math.max(duration - FADE, FADE));
  master.gain.linearRampToValueAtTime(0, t0 + duration);
  master.connect(ctx.destination);

  const oscillators = [];

  if (voice === "performer" || voice === "combined") {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(fS, t0);
    oscillators.push(osc);
  }

  if (voice === "observer" || voice === "combined") {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    // Prefer setValueCurveAtTime; fall back to stepped setValueAtTime if needed.
    const curve =
      fO.length >= 2 ? new Float32Array(fO) : new Float32Array([fO[0], fO[0]]);
    try {
      osc.frequency.setValueCurveAtTime(curve, t0, duration);
    } catch (e) {
      osc.frequency.setValueAtTime(curve[0], t0);
      const n = curve.length;
      for (let i = 1; i < n; i++) {
        const ti = t0 + (duration * i) / (n - 1);
        osc.frequency.linearRampToValueAtTime(curve[i], ti);
      }
    }
    oscillators.push(osc);
  }

  const voiceGain = oscillators.length > 1 ? 0.5 : 1;
  for (const osc of oscillators) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(voiceGain, t0);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  const first = oscillators[0];
  first.onended = () => {
    if (activeTone && activeTone.oscillators[0] === first) {
      const tone = activeTone;
      activeTone = null;
      try {
        tone.master.disconnect();
      } catch (e) {
        /* already disconnected */
      }
      if (tone.onEnded) tone.onEnded();
    }
  };

  activeTone = { oscillators, master, onEnded, stopTimer: null };
}

/**
 * Stop playback. Fade the master gain to zero before tearing the graph down —
 * cutting oscillators mid-cycle produces an audible click/static burst.
 */
function stopTone() {
  if (!activeTone) return;
  const tone = activeTone;
  activeTone = null;

  if (!audioCtx) {
    if (tone.onEnded) tone.onEnded();
    return;
  }

  const now = audioCtx.currentTime;
  const gain = tone.master.gain;

  if (typeof gain.cancelAndHoldAtTime === "function") {
    gain.cancelAndHoldAtTime(now);
  } else {
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(MASTER_LEVEL, now);
  }
  gain.linearRampToValueAtTime(0, now + FADE);

  tone.stopTimer = setTimeout(() => {
    for (const osc of tone.oscillators) {
      try {
        osc.disconnect();
      } catch (e) {
        /* already disconnected */
      }
    }
    try {
      tone.master.disconnect();
    } catch (e) {
      /* already disconnected */
    }
  }, (FADE + 0.03) * 1000);

  if (tone.onEnded) tone.onEnded();
}
