/*
 * Sine-tone playback of the Doppler calculation: the constant performer tone,
 * the time-varying tone heard by the observer, or both combined.
 */
"use strict";

let audioCtx = null;
let activeTone = null; // { oscillators, master, onEnded }

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
  const t0 = ctx.currentTime + 0.05;
  const ramp = 0.02; // attack/release to avoid clicks

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(0.3, t0 + ramp);
  master.gain.setValueAtTime(0.3, t0 + duration - ramp);
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
    osc.frequency.setValueCurveAtTime(new Float32Array(fO), t0, duration);
    oscillators.push(osc);
  }

  const voiceGain = oscillators.length > 1 ? 0.5 : 1;
  for (const osc of oscillators) {
    const g = ctx.createGain();
    g.gain.value = voiceGain;
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.01);
  }

  // Natural end of playback (guard: skip if this tone was already stopped)
  const first = oscillators[0];
  first.onended = () => {
    if (activeTone && activeTone.oscillators[0] === first) {
      activeTone = null;
      master.disconnect();
      if (onEnded) onEnded();
    }
  };

  activeTone = { oscillators, master, onEnded };
}

/** Stop playback immediately (calls the active tone's onEnded). */
function stopTone() {
  if (!activeTone) return;
  const tone = activeTone;
  activeTone = null; // clear first so osc.onended does nothing
  for (const osc of tone.oscillators) {
    try {
      osc.stop();
    } catch (e) {
      // already stopped
    }
  }
  tone.master.disconnect();
  if (tone.onEnded) tone.onEnded();
}
