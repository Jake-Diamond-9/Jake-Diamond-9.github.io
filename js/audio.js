/*
 * Sine-tone playback of the Doppler calculation: the constant performer tone,
 * the time-varying tone heard by the observer, or both combined.
 */
"use strict";

const MASTER_LEVEL = 0.3;
const FADE = 0.04; // seconds; short enough to feel instant, long enough to avoid clicks

let audioCtx = null;
let activeTone = null; // { oscillators, master, onEnded, stopTimer }

function tonePlaying() {
  return activeTone !== null;
}

/**
 * Play sine voice(s) for `duration` seconds.
 *
 * fS: performer frequency in Hz (constant voice)
 * fO: array of observed frequencies in Hz, evenly spaced over the move
 * voice: "performer" (fS only), "observer" (fO curve only), or "combined"
 * onEnded: called once when playback finishes or is stopped
 */
function playTone({ fS, fO, duration, voice }, onEnded) {
  stopTone();

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  const ctx = audioCtx;
  const t0 = ctx.currentTime + 0.02;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(MASTER_LEVEL, t0 + FADE);
  // Hold the sustain level, then fade out at the natural end of the move.
  master.gain.setValueAtTime(MASTER_LEVEL, t0 + Math.max(duration - FADE, FADE));
  master.gain.linearRampToValueAtTime(0, t0 + duration);
  master.connect(ctx.destination);

  const oscillators = [];

  if (voice === "performer" || voice === "combined") {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = fS;
    oscillators.push(osc);
  }

  if (voice === "observer" || voice === "combined") {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    // setValueCurveAtTime needs at least 2 samples
    const curve =
      fO.length >= 2 ? new Float32Array(fO) : new Float32Array([fO[0], fO[0]]);
    osc.frequency.setValueCurveAtTime(curve, t0, duration);
    oscillators.push(osc);
  }

  const voiceGain = oscillators.length > 1 ? 0.5 : 1;
  for (const osc of oscillators) {
    const g = ctx.createGain();
    g.gain.value = voiceGain;
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    // Stop a little after the fade finishes so the gain reaches zero first.
    osc.stop(t0 + duration + 0.02);
  }

  // Natural end of playback (guard: skip if this tone was already stopped)
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
  activeTone = null; // clear first so osc.onended does nothing

  const now = audioCtx.currentTime;
  const gain = tone.master.gain;

  // Hold whatever level the automation is currently at, then ramp to silence.
  // cancelAndHoldAtTime is the correct API; the older cancelScheduledValues +
  // gain.value path is wrong because AudioParam.value often reports the last
  // explicitly set value (0) rather than the live automated level, which would
  // snap the gain to zero and cause the click we're fixing.
  if (typeof gain.cancelAndHoldAtTime === "function") {
    gain.cancelAndHoldAtTime(now);
  } else {
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(MASTER_LEVEL, now);
  }
  gain.linearRampToValueAtTime(0, now + FADE);

  // Oscillators were already scheduled to stop at end-of-tone; calling stop()
  // again throws. Leave them running silently until the fade finishes, then
  // disconnect everything.
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
