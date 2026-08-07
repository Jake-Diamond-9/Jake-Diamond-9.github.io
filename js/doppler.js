/*
 * Doppler shift math for a marching performer, ported from doppler_shift_set.py.
 *
 * Coordinate system: x runs along the field (0 = side-1 goal line, 100 = side-2
 * goal line), y runs from the front sideline (0) toward the back sideline,
 * z is height. All distances in yards.
 */
"use strict";

const FIELD = {
  length: 100,
  width: 160 / 3,
  frontHash: 60 / 3,
  backHash: 60 / 3 + 12.5, // NCAA hash, matches the Python script
  ydLineDist: 5,
  stepSize: 5 / 8, // 8-to-5 step in yards
};

/**
 * Convert a marching "dot" (yard line + steps) to global field coordinates.
 *
 * dot = {
 *   side: "side1" | "side2",
 *   stepsIo: number,           // steps inside/outside the yard line
 *   io: "inside" | "outside",
 *   yd: number,                // yard line, 0-50
 *   stepsFb: number,           // steps in front of / behind the marker
 *   fb: "front" | "behind",
 *   markerFb: "front sideline" | "back sideline" | "front hash" | "back hash",
 * }
 *
 * Returns { x, y } in yards.
 */
function dot2coord(dot) {
  const s = FIELD.stepSize;
  let x;
  if (dot.side === "side1") {
    x = dot.io === "inside" ? dot.yd + dot.stepsIo * s : dot.yd - dot.stepsIo * s;
  } else {
    x =
      dot.io === "inside"
        ? 100 - dot.yd - dot.stepsIo * s
        : 100 - dot.yd + dot.stepsIo * s;
  }

  const markerY = {
    "front sideline": 0,
    "back sideline": FIELD.width,
    "front hash": FIELD.frontHash,
    "back hash": FIELD.backHash,
  }[dot.markerFb];

  const y = dot.fb === "front" ? markerY - dot.stepsFb * s : markerY + dot.stepsFb * s;

  return { x, y };
}

/**
 * Speed of sound in air (zero frequency) from Cramer, J. Acoust. Soc. Am. 93,
 * 2510-2516 (1993), Eq. 15 and Table III.
 *
 * tF: temperature in degrees Fahrenheit (valid 32-86)
 * p:  pressure in Pa (valid 75000-102000)
 * rh: relative humidity in percent (valid 0-100)
 * xc: CO2 mole fraction (valid 0-0.01)
 *
 * If any input is outside the validity range, falls back to STP conditions
 * (0 degC, 101325 Pa, dry air, 314 ppm CO2) and reports the reasons in
 * `warnings`.
 *
 * Returns { cSI, cYd, warnings } - speed in m/s and yd/s.
 */
function soundSpeedAir(tF, p, rh, xc) {
  let t = ((tF - 32) * 5) / 9; // Celsius
  let T = t + 273.15;

  // Water vapor mole fraction from relative humidity (Giacomo, reproduced in
  // the Appendix of Cramer 1993): xw = h * f * psv / p
  const h = rh / 100;
  const f = 1.00062 + 3.14e-8 * p + 5.6e-7 * t * t; // enhancement factor
  const psv = Math.exp(
    1.2811805e-5 * T * T - 1.9509874e-2 * T + 34.04926034 - 6.3536311e3 / T
  ); // saturation vapor pressure in Pa
  let xw = (h * f * psv) / p;

  const warnings = [];
  if (!(t >= 0 && t <= 30)) {
    warnings.push(
      `temperature ${tF} \u00b0F (${t.toFixed(1)} \u00b0C, valid 32\u201386 \u00b0F)`
    );
  }
  if (!(p >= 75000 && p <= 102000)) {
    warnings.push(`pressure ${p} Pa (valid 75000\u2013102000 Pa)`);
  }
  if (!(rh >= 0 && rh <= 100)) {
    warnings.push(`relative humidity ${rh}% (valid 0\u2013100%)`);
  }
  if (!(xc >= 0 && xc <= 0.01)) {
    warnings.push(`CO2 mole fraction ${xc} (valid 0\u20130.01)`);
  }
  if (!(xw >= 0 && xw <= 0.06)) {
    warnings.push(`water vapor mole fraction ${xw.toFixed(4)} (valid 0\u20130.06)`);
  }

  if (warnings.length > 0) {
    // Fall back to STP conditions, same as the Python script.
    t = 0.0;
    p = 101325.0;
    xw = 0.0;
    xc = 0.000314;
  }

  // Coefficients for the speed of sound from Table III
  const a0 = 331.5024;
  const a1 = 0.603055;
  const a2 = -0.000528;
  const a3 = 51.471935;
  const a4 = 0.1495874;
  const a5 = -0.000782;
  const a6 = -1.82e-7;
  const a7 = 3.73e-8;
  const a8 = -2.93e-10;
  const a9 = -85.20931;
  const a10 = -0.228525;
  const a11 = 5.91e-5;
  const a12 = -2.835149;
  const a13 = -2.15e-13;
  const a14 = 29.179762;
  const a15 = 0.000486;

  // Eq. 15
  const c0 =
    a0 +
    a1 * t +
    a2 * t * t +
    (a3 + a4 * t + a5 * t * t) * xw +
    (a6 + a7 * t + a8 * t * t) * p +
    (a9 + a10 * t + a11 * t * t) * xc +
    a12 * xw * xw +
    a13 * p * p +
    a14 * xc * xc +
    a15 * xw * p * xc;

  return { cSI: c0, cYd: c0 / 0.9144, warnings };
}

/**
 * Doppler shift for a performer marching in a straight line from m to n,
 * heard by an observer at l. Positions are [x, y, z] arrays in yards.
 *
 * tempo: beats per minute
 * counts: number of counts for the move
 * fs: source frequency in Hz
 * env: { tF, p, rh, xc } environmental conditions (see soundSpeedAir)
 *
 * The velocity along the source-observer line is the time derivative of
 * |l - Ps(t)|, which is (Vs / D) * dot(m - n, l - Ps) / |l - Ps| - the exact
 * simplification of the expanded expression in the Python script.
 *
 * Returns arrays sampled at 100 points along the move.
 */
function doppler(m, n, l, tempo, counts, fs, env) {
  const r = [n[0] - m[0], n[1] - m[1], n[2] - m[2]];
  const setDist = Math.hypot(r[0], r[1], r[2]);

  if (setDist === 0) {
    throw new Error("Start and end positions are identical; there is no movement.");
  }

  // Step size expressed as "X to 5" (steps per 5 yards)
  const stepSizeMarch = 8 / (setDist / counts / (5 / 8));

  const Vs = setDist / ((60 / tempo) * counts); // yd/s
  const tEnd = setDist / Vs;
  const numPts = 100;

  const { cSI, cYd: c, warnings } = soundSpeedAir(env.tF, env.p, env.rh, env.xc);

  const t = new Array(numPts);
  const countsList = new Array(numPts);
  const V = new Array(numPts);
  const fO = new Array(numPts);
  const fOTempo = new Array(numPts);
  const tempoShift = new Array(numPts);
  const cents = new Array(numPts);
  const path = new Array(numPts); // performer positions along the move

  for (let i = 0; i < numPts; i++) {
    const ti = (tEnd * i) / (numPts - 1);
    t[i] = ti;
    countsList[i] = ti * (tempo / 60);

    const frac = ti / tEnd;
    const Ps = [m[0] + r[0] * frac, m[1] + r[1] * frac, m[2] + r[2] * frac];
    path[i] = Ps;

    const u = [l[0] - Ps[0], l[1] - Ps[1], l[2] - Ps[2]]; // source -> observer
    const dSO = Math.hypot(u[0], u[1], u[2]);

    // d/dt |l - Ps(t)|: positive when the performer moves away from the observer
    const Vi =
      ((Vs / setDist) * (-(r[0] * u[0]) - r[1] * u[1] - r[2] * u[2])) / dSO;
    V[i] = Vi;

    fO[i] = fs * (c / (c + Vi));
    fOTempo[i] = tempo * (c / (c + Vi));
    tempoShift[i] = fOTempo[i] - tempo;
    cents[i] = (1200 / Math.LN2) * Math.log(fO[i] / fs);
  }

  return {
    V,
    t,
    countsList,
    fO,
    fOTempo,
    tempoShift,
    cents,
    stepSizeMarch,
    cSI,
    cYd: c,
    warnings,
    setDist,
    Vs,
    path,
  };
}

function mean(a) {
  return a.reduce((s, v) => s + v, 0) / a.length;
}

function std(a) {
  const mu = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - mu) * (v - mu), 0) / a.length);
}

// Export for Node-based testing; in the browser these are plain globals.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { FIELD, dot2coord, soundSpeedAir, doppler, mean, std };
}
