/*
 * App wiring: builds the position forms, applies Lucas Oil defaults, and runs
 * the Doppler calculation, updating the field plot, shift chart, and results.
 */
"use strict";

// ---------- Defaults ----------

const DEFAULTS = {
  start: {
    side: "side1",
    stepsIo: 0,
    io: "inside",
    yd: 45,
    stepsFb: 0,
    fb: "behind",
    markerFb: "front hash",
    z: 2,
  },
  end: {
    side: "side2",
    stepsIo: 0,
    io: "inside",
    yd: 45,
    stepsFb: 12,
    fb: "front",
    markerFb: "front hash",
    z: 2,
  },
  // Lucas Oil Stadium judges box: on the 50, 85 steps in front of the front
  // sideline, 33 yards up.
  obs: {
    side: "side1",
    stepsIo: 0,
    io: "inside",
    yd: 50,
    stepsFb: 85,
    fb: "front",
    markerFb: "front sideline",
    z: 33,
  },
  // Estimated Lucas Oil Stadium interior: 72 degF climate-controlled, ambient
  // pressure at Indianapolis' elevation (~715 ft, in kPa), 50% RH, 1000 ppm CO2.
  env: { temp: 72, pressure: 98.7, rh: 50, co2ppm: 1000 },
  music: { tempo: 192, counts: 12, freq: 440, freqMode: "freq", note: "A", octave: 4 },
};

// Note-to-frequency chart (A = 440 Hz equal temperament), values taken from
// the MixButton "Music notes to frequencies" chart. Index = octave 0-8.
const NOTE_FREQS = {
  C: [16.35, 32.7, 65.41, 130.81, 261.63, 523.25, 1046.5, 2093.0, 4186.01],
  "C#/Db": [17.32, 34.65, 69.3, 138.59, 277.18, 554.37, 1108.73, 2217.46, 4434.92],
  D: [18.35, 36.71, 73.42, 146.83, 293.66, 587.33, 1174.66, 2349.32, 4698.63],
  "D#/Eb": [19.45, 38.89, 77.78, 155.56, 311.13, 622.25, 1244.51, 2489.02, 4978.03],
  E: [20.6, 41.2, 82.41, 164.81, 329.63, 659.25, 1318.51, 2637.02, 5274.04],
  F: [21.83, 43.65, 87.31, 174.61, 349.23, 698.46, 1396.91, 2793.83, 5587.65],
  "F#/Gb": [23.12, 46.25, 92.5, 185.0, 369.99, 739.99, 1479.98, 2959.96, 5919.91],
  G: [24.5, 49.0, 98.0, 196.0, 392.0, 783.99, 1567.98, 3135.96, 6271.93],
  "G#/Ab": [25.96, 51.91, 103.83, 207.65, 415.3, 830.61, 1661.22, 3322.44, 6644.88],
  A: [27.5, 55.0, 110.0, 220.0, 440.0, 880.0, 1760.0, 3520.0, 7040.0],
  "A#/Bb": [29.14, 58.27, 116.54, 233.08, 466.16, 932.33, 1864.66, 3729.31, 7458.62],
  B: [30.87, 61.74, 123.47, 246.94, 493.88, 987.77, 1975.53, 3951.07, 7902.13],
};

// ---------- Dot form construction ----------

function dotFieldsHTML(prefix) {
  return `
    <div class="dot-row io-row">
      <label>Steps
        <input type="number" id="${prefix}-steps-io" step="any" min="0" />
      </label>
      <label>In/Out
        <select id="${prefix}-io">
          <option value="inside">Inside</option>
          <option value="outside">Outside</option>
        </select>
      </label>
      <label>Yard line
        <input type="number" id="${prefix}-yd" step="5" min="0" max="50" />
      </label>
      <label>Side
        <select id="${prefix}-side">
          <option value="side1">Side 1</option>
          <option value="side2">Side 2</option>
        </select>
      </label>
    </div>
    <div class="dot-row fb-row">
      <label>Steps
        <input type="number" id="${prefix}-steps-fb" step="any" min="0" />
      </label>
      <label>Front/Behind
        <select id="${prefix}-fb">
          <option value="front">In front of</option>
          <option value="behind">Behind</option>
        </select>
      </label>
      <label>Marker
        <select id="${prefix}-marker-fb">
          <option value="front sideline">Front sideline</option>
          <option value="front hash">Front hash</option>
          <option value="back hash">Back hash</option>
          <option value="back sideline">Back sideline</option>
        </select>
      </label>
    </div>
    <div class="dot-row z-row">
      <label>Height (yd)
        <input type="number" id="${prefix}-z" step="any" min="0" />
      </label>
    </div>`;
}

function setDotForm(prefix, dot) {
  document.getElementById(`${prefix}-steps-io`).value = dot.stepsIo;
  document.getElementById(`${prefix}-io`).value = dot.io;
  document.getElementById(`${prefix}-yd`).value = dot.yd;
  document.getElementById(`${prefix}-side`).value = dot.side;
  document.getElementById(`${prefix}-steps-fb`).value = dot.stepsFb;
  document.getElementById(`${prefix}-fb`).value = dot.fb;
  document.getElementById(`${prefix}-marker-fb`).value = dot.markerFb;
  document.getElementById(`${prefix}-z`).value = dot.z;
}

function readDotForm(prefix, label) {
  const num = (id, name) => {
    const v = parseFloat(document.getElementById(id).value);
    if (!isFinite(v)) throw new Error(`${label}: enter a number for ${name}.`);
    return v;
  };
  const dot = {
    stepsIo: num(`${prefix}-steps-io`, "steps in/out"),
    io: document.getElementById(`${prefix}-io`).value,
    yd: num(`${prefix}-yd`, "yard line"),
    side: document.getElementById(`${prefix}-side`).value,
    stepsFb: num(`${prefix}-steps-fb`, "steps front/behind"),
    fb: document.getElementById(`${prefix}-fb`).value,
    markerFb: document.getElementById(`${prefix}-marker-fb`).value,
    z: num(`${prefix}-z`, "height"),
  };
  if (dot.yd < 0 || dot.yd > 50) {
    throw new Error(`${label}: yard line must be between 0 and 50.`);
  }
  return dot;
}

function readNumber(id, name) {
  const v = parseFloat(document.getElementById(id).value);
  if (!isFinite(v)) throw new Error(`Enter a number for ${name}.`);
  return v;
}

// ---------- Pitch picker ----------

function initPitchPicker() {
  const noteSel = document.getElementById("music-note");
  const octaveSel = document.getElementById("music-octave");
  noteSel.innerHTML = Object.keys(NOTE_FREQS)
    .map((n) => `<option value="${n}">${n}</option>`)
    .join("");
  octaveSel.innerHTML = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    .map((o) => `<option value="${o}">${o}</option>`)
    .join("");

  document.getElementById("freq-mode").addEventListener("change", syncPitchInputs);
  noteSel.addEventListener("change", syncPitchInputs);
  octaveSel.addEventListener("change", syncPitchInputs);
}

/**
 * Show/hide the note and octave selects based on the pitch input mode. In
 * note mode the frequency field is auto-filled from the chart and locked.
 */
function syncPitchInputs() {
  const noteMode = document.getElementById("freq-mode").value === "note";
  document.getElementById("note-field").hidden = !noteMode;
  document.getElementById("octave-field").hidden = !noteMode;

  const freqInput = document.getElementById("music-freq");
  freqInput.readOnly = noteMode;
  if (noteMode) {
    const note = document.getElementById("music-note").value;
    const octave = parseInt(document.getElementById("music-octave").value, 10);
    freqInput.value = NOTE_FREQS[note][octave];
  }
}

function applyDefaults() {
  setDotForm("start", DEFAULTS.start);
  setDotForm("end", DEFAULTS.end);
  setDotForm("obs", DEFAULTS.obs);
  document.getElementById("env-temp").value = DEFAULTS.env.temp;
  document.getElementById("env-pressure").value = DEFAULTS.env.pressure;
  document.getElementById("env-rh").value = DEFAULTS.env.rh;
  document.getElementById("env-co2").value = DEFAULTS.env.co2ppm;
  document.getElementById("music-tempo").value = DEFAULTS.music.tempo;
  document.getElementById("music-counts").value = DEFAULTS.music.counts;
  document.getElementById("music-freq").value = DEFAULTS.music.freq;
  document.getElementById("freq-mode").value = DEFAULTS.music.freqMode;
  document.getElementById("music-note").value = DEFAULTS.music.note;
  document.getElementById("music-octave").value = DEFAULTS.music.octave;
  syncPitchInputs();
}

// ---------- Chart ----------

let shiftChart = null;

/** Default numeric tick formatting, with a leading + for positive values. */
function signedTickLabel(value, index, ticks) {
  const label = Chart.Ticks.formatters.numeric.apply(this, [value, index, ticks]);
  return value > 0 ? `+${label}` : label;
}

function buildChart() {
  const ctx = document.getElementById("shift-chart").getContext("2d");
  shiftChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Tuning shift (cents)",
          data: [],
          borderColor: "#2b62d9",
          backgroundColor: "#2b62d9",
          yAxisID: "y",
          pointRadius: 0,
          borderWidth: 3,
          tension: 0.15,
        },
        {
          label: "Tempo shift (bpm)",
          data: [],
          borderColor: "#d63a3a",
          backgroundColor: "#d63a3a",
          yAxisID: "y1",
          pointRadius: 0,
          borderWidth: 3,
          tension: 0.15,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { usePointStyle: true, boxHeight: 6 } },
        tooltip: {
          callbacks: {
            title: (items) => `Count ${items[0].parsed.x.toFixed(2)}`,
            label: (item) =>
              `${item.dataset.label}: ${item.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          title: { display: true, text: "Count" },
        },
        y: {
          position: "left",
          title: { display: true, text: "Tuning Shift (cents)" },
          ticks: { callback: signedTickLabel },
        },
        y1: {
          position: "right",
          title: { display: true, text: "Tempo Shift (bpm)" },
          grid: { drawOnChartArea: false },
          ticks: { callback: signedTickLabel },
        },
      },
    },
  });
}

function updateChart(countsList, cents, tempoShift) {
  shiftChart.data.datasets[0].data = countsList.map((c, i) => ({
    x: c,
    y: cents[i],
  }));
  shiftChart.data.datasets[1].data = countsList.map((c, i) => ({
    x: c,
    y: tempoShift[i],
  }));
  shiftChart.options.scales.x.min = countsList[0];
  shiftChart.options.scales.x.max = countsList[countsList.length - 1];
  shiftChart.update();
}

// ---------- Results ----------

function renderResults(items) {
  const dl = document.getElementById("results");
  dl.innerHTML = items
    .map(
      ({ label, value, sub }) => `
      <div class="result">
        <dt>${label}</dt>
        <dd>${value}${sub ? ` <small>${sub}</small>` : ""}</dd>
      </div>`
    )
    .join("");
}

// ---------- Banners ----------

function showBanner(id, message) {
  const el = document.getElementById(id);
  if (message) {
    el.textContent = message;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

// ---------- Main run ----------

let fieldPlot = null;

function run() {
  try {
    const start = readDotForm("start", "Performer start");
    const end = readDotForm("end", "Performer end");
    const obs = readDotForm("obs", "Observer");

    const env = {
      tF: readNumber("env-temp", "temperature"),
      p: readNumber("env-pressure", "pressure") * 1000, // kPa -> Pa
      rh: readNumber("env-rh", "relative humidity"),
      xc: readNumber("env-co2", "CO2 concentration") * 1e-6,
    };
    const tempo = readNumber("music-tempo", "tempo");
    const counts = readNumber("music-counts", "counts");
    const fs = readNumber("music-freq", "frequency");
    if (tempo <= 0) throw new Error("Tempo must be positive.");
    if (counts <= 0) throw new Error("Counts must be positive.");
    if (fs <= 0) throw new Error("Frequency must be positive.");

    const pStart = dot2coord(start);
    const pEnd = dot2coord(end);
    const pObs = dot2coord(obs);

    const m = [pStart.x, pStart.y, start.z];
    const n = [pEnd.x, pEnd.y, end.z];
    const l = [pObs.x, pObs.y, obs.z];

    const res = doppler(m, n, l, tempo, counts, fs, env);

    // Field plot: gridlines only redraw if the extent changed.
    fieldPlot.setMarkers({
      start: pStart,
      end: pEnd,
      obs: pObs,
    });

    updateChart(res.countsList, res.cents, res.tempoShift);

    const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
    renderResults([
      { label: "Tempo", value: r1(tempo), sub: "bpm" },
      { label: "Counts", value: counts },
      { label: "Performer frequency", value: r1(fs), sub: "Hz" },
      { label: "Step size", value: `${r1(res.stepSizeMarch)} to 5` },
      {
        label: "Tuning shift",
        value: `${r1(mean(res.cents))}`,
        sub: `\u00b1 ${r1(std(res.cents))} cents`,
      },
      {
        label: "Tempo shift",
        value: `${r1(mean(res.tempoShift))}`,
        sub: `\u00b1 ${r1(std(res.tempoShift))} bpm`,
      },
      {
        label: "Observed frequency",
        value: `${r1(mean(res.fO))}`,
        sub: `\u00b1 ${r1(std(res.fO))} Hz`,
      },
      { label: "Sound speed", value: r1(res.cSI), sub: "m/s" },
    ]);

    showBanner("error-banner", null);
    showBanner(
      "warning-banner",
      res.warnings.length
        ? "Input(s) outside the validity range of the sound-speed model: " +
            res.warnings.join("; ") +
            ". Using estimated Lucas Oil Stadium interior conditions " +
            "(72 \u00b0F, 98.7 kPa, 50% RH, 1000 ppm CO2) instead."
        : null
    );
  } catch (err) {
    showBanner("error-banner", err.message);
  }
}

// ---------- Init ----------

document.addEventListener("DOMContentLoaded", () => {
  for (const prefix of ["start", "end", "obs"]) {
    document.getElementById(`dot-${prefix}`).innerHTML = dotFieldsHTML(prefix);
  }
  initPitchPicker();
  applyDefaults();

  fieldPlot = new FieldPlot(document.getElementById("field-container"));
  buildChart();

  document.getElementById("controls").addEventListener("submit", (e) => {
    e.preventDefault();
    run();
  });
  document.getElementById("reset-defaults").addEventListener("click", () => {
    applyDefaults();
    run();
  });

  // Draw the field grid and the default calculation on load.
  run();
});
