/*
 * Combined-tone playback: the constant performer tone mixed with the
 * time-varying Doppler-shifted tone heard by the observer, rendered with the
 * Web Audio API as a pure sine or a synthesized brass timbre.
 *
 * The harmonic recipes match the Python twin (doppler_shift_set.py).
 */
"use strict";

const AUDIO_HARMONICS = {
  sine: [1],
  trumpet: [1, 0.9, 0.9, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15],
  "french horn": [1, 0.55, 0.3, 0.18, 0.09, 0.05, 0.03],
  trombone: [1, 0.75, 0.6, 0.4, 0.25, 0.15, 0.08, 0.05],
  tuba: [1, 0.5, 0.2, 0.08, 0.04],
};

let audioCtx = null;
let activeTone = null; // { oscillators, master }

function tonePlaying() {
  return activeTone !== null;
}

/** Build a PeriodicWave (sine terms only) from a harmonic amplitude list. */
function makeWave(ctx, harmonics) {
  const real = new Float32Array(harmonics.length + 1);
  const imag = new Float32Array(harmonics.length + 1);
  harmonics.forEach((amp, i) => {
    imag[i + 1] = amp;
  });
  return ctx.createPeriodicWave(real, imag);
}

/**
 * Play the two voices for `duration` seconds.
 *
 * fS: performer frequency in Hz (constant voice)
 * fO: array of observed frequencies in Hz, evenly spaced over the move
 * instrument: key of AUDIO_HARMONICS
 * onEnded: called once when playback finishes or is stopped
 */
function playTone({ fS, fO, duration, instrument }, onEnded) {
  stopTone();

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  const ctx = audioCtx;
  const wave = makeWave(ctx, AUDIO_HARMONICS[instrument]);
  const t0 = ctx.currentTime + 0.05;
  const ramp = 0.02; // attack/release to avoid clicks

  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(0.3, t0 + ramp);
  master.gain.setValueAtTime(0.3, t0 + duration - ramp);
  master.gain.linearRampToValueAtTime(0, t0 + duration);
  master.connect(ctx.destination);

  // Voice 1: constant performer tone
  const osc1 = ctx.createOscillator();
  osc1.setPeriodicWave(wave);
  osc1.frequency.value = fS;

  // Voice 2: Doppler-shifted tone, frequency follows f_o(t)
  const osc2 = ctx.createOscillator();
  osc2.setPeriodicWave(wave);
  osc2.frequency.setValueCurveAtTime(new Float32Array(fO), t0, duration);

  for (const osc of [osc1, osc2]) {
    const g = ctx.createGain();
    g.gain.value = 0.5;
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.01);
  }

  // Natural end of playback (guard: skip if this tone was already stopped)
  osc1.onended = () => {
    if (activeTone && activeTone.oscillators[0] === osc1) {
      activeTone = null;
      master.disconnect();
      if (onEnded) onEnded();
    }
  };

  activeTone = { oscillators: [osc1, osc2], master, onEnded };
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
