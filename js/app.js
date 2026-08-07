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
  // Estimated Lucas Oil Stadium interior: 70 degF climate-controlled, ambient
  // pressure at Indianapolis' elevation (~715 ft), 50% RH, 1000 ppm CO2.
  env: { temp: 70, pressure: 98700, rh: 50, co2ppm: 1000 },
  music: { tempo: 192, counts: 12, freq: 440 },
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
}

// ---------- Chart ----------

let shiftChart = null;

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
          borderWidth: 2,
          tension: 0.15,
        },
        {
          label: "Tempo shift (bpm)",
          data: [],
          borderColor: "#e07b28",
          backgroundColor: "#e07b28",
          yAxisID: "y1",
          pointRadius: 0,
          borderWidth: 2,
          borderDash: [6, 4],
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
        },
        y1: {
          position: "right",
          title: { display: true, text: "Tempo Shift (bpm)" },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

function updateChart(countsList, cents, tempoShift, tempo) {
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

  // Lock the two y axes to the same physical scale so the cents and bpm
  // curves overlay as a single line. For small shifts,
  //   tempoShift = tempo * (f/fs - 1)  and  cents = (1200/ln 2) * ln(f/fs),
  // so tempoShift ~= cents * (tempo * ln 2 / 1200). Scale the bpm axis by
  // that factor for any tempo/conditions.
  const k = (tempo * Math.LN2) / 1200;
  let lo = Math.min(...cents);
  let hi = Math.max(...cents);
  const pad = Math.max((hi - lo) * 0.05, 1e-6);
  lo -= pad;
  hi += pad;
  shiftChart.options.scales.y.min = lo;
  shiftChart.options.scales.y.max = hi;
  shiftChart.options.scales.y1.min = lo * k;
  shiftChart.options.scales.y1.max = hi * k;
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
      p: readNumber("env-pressure", "pressure"),
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

    updateChart(res.countsList, res.cents, res.tempoShift, tempo);

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
            ". Using the sound speed at STP (0 \u00b0C, 101325 Pa, dry air, " +
            "314 ppm CO2) instead."
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
