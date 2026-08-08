# %%
"""
Doppler shift of a marching band drill set.

Pure-Python twin of the web app at https://jake-diamond-9.github.io/ - the
same inputs produce the same numbers, plots, and results. Optionally plays
the performer tone together with the Doppler-shifted tone heard by the
observer (pure sine or a synthesized brass timbre).
"""

import subprocess
import sys
import warnings
import wave

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.ticker import FuncFormatter

# ============================================================================
# User inputs
# ============================================================================

# Performer start dot
dot1 = {
    "side": "side1",
    "steps_io": 0,
    "io": "inside",
    "yd_io": 45,
    "steps_fb": 0,
    "fb": "behind",
    "marker_fb": "front hash",
}
z_coord1 = 2  # yd

# Performer end dot
dot2 = {
    "side": "side2",
    "steps_io": 0,
    "io": "inside",
    "yd_io": 45,
    "steps_fb": 12,
    "fb": "in front",
    "marker_fb": "front hash",
}
z_coord2 = 2  # yd

# Observer: Lucas Oil Stadium judges box (default in the web app)
dot_obs = {
    "side": "side1",
    "steps_io": 0,
    "io": "inside",
    "yd_io": 50,
    "steps_fb": 85,  # 85 steps in front of the front sideline
    "fb": "in front",
    "marker_fb": "front sideline",
}
z_coord_obs = 33  # yd

# Environmental conditions (defaults estimated for the Lucas Oil interior)
temp_f = 72  # degF
pressure_kpa = 98.7  # kPa
rel_humidity = 50  # %
co2_ppm = 1000  # ppm

# Music
tempo = 192  # bpm
counts = 12
t_start = 0

# Pitch: set freq_mode to "freq" to use f_s directly, or "note" to look the
# frequency up from the note-to-frequency chart (A = 440 Hz).
freq_mode = "freq"
f_s = 440  # Hz, used when freq_mode == "freq"
note = "A"  # used when freq_mode == "note"
octave = 4  # 0-8, used when freq_mode == "note"

# Tone playback: mixes the constant performer tone with the time-varying
# Doppler-shifted tone heard by the observer, for the duration of the move.
play_audio = True
instrument = "sine"  # "sine", "trumpet", "french horn", "trombone", or "tuba"
audio_file = "doppler_tone.wav"

# ============================================================================
# Constants and lookup tables
# ============================================================================

# NCAA field with 8-to-5 standard step size
field_length = 100
field_width = 160 / 3
front_hash = 60 / 3
back_hash = front_hash + 12.5
yd_line_dist = 5
step_size = yd_line_dist / 8

# Note-to-frequency chart (A = 440 Hz equal temperament), same table as the
# web app. Index = octave 0-8.
NOTE_FREQS = {
    "C": [16.35, 32.70, 65.41, 130.81, 261.63, 523.25, 1046.50, 2093.00, 4186.01],
    "C#/Db": [17.32, 34.65, 69.30, 138.59, 277.18, 554.37, 1108.73, 2217.46, 4434.92],
    "D": [18.35, 36.71, 73.42, 146.83, 293.66, 587.33, 1174.66, 2349.32, 4698.63],
    "D#/Eb": [19.45, 38.89, 77.78, 155.56, 311.13, 622.25, 1244.51, 2489.02, 4978.03],
    "E": [20.60, 41.20, 82.41, 164.81, 329.63, 659.25, 1318.51, 2637.02, 5274.04],
    "F": [21.83, 43.65, 87.31, 174.61, 349.23, 698.46, 1396.91, 2793.83, 5587.65],
    "F#/Gb": [23.12, 46.25, 92.50, 185.00, 369.99, 739.99, 1479.98, 2959.96, 5919.91],
    "G": [24.50, 49.00, 98.00, 196.00, 392.00, 783.99, 1567.98, 3135.96, 6271.93],
    "G#/Ab": [25.96, 51.91, 103.83, 207.65, 415.30, 830.61, 1661.22, 3322.44, 6644.88],
    "A": [27.50, 55.00, 110.00, 220.00, 440.00, 880.00, 1760.00, 3520.00, 7040.00],
    "A#/Bb": [29.14, 58.27, 116.54, 233.08, 466.16, 932.33, 1864.66, 3729.31, 7458.62],
    "B": [30.87, 61.74, 123.47, 246.94, 493.88, 987.77, 1975.53, 3951.07, 7902.13],
}

# Relative harmonic amplitudes for the tone playback (same recipes as the
# web app): harmonic 1 (fundamental), 2, 3, ...
HARMONICS = {
    "sine": [1.0],
    "trumpet": [1.0, 0.9, 0.9, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15],
    "french horn": [1.0, 0.55, 0.3, 0.18, 0.09, 0.05, 0.03],
    "trombone": [1.0, 0.75, 0.6, 0.4, 0.25, 0.15, 0.08, 0.05],
    "tuba": [1.0, 0.5, 0.2, 0.08, 0.04],
}


# ============================================================================
# Functions
# ============================================================================


# convert dot dictionary to position in global coordinate system
def dot2coord(dot):
    # For steps defined on an 8 to 5 grid
    step_size = 5 / 8

    field_width = 160 / 3
    front_hash = 60 / 3
    back_hash = front_hash + 12.5

    if dot["side"] == "side1":
        if dot["io"] == "inside":
            x_coord = dot["yd_io"] + dot["steps_io"] * step_size
        elif dot["io"] == "outside":
            x_coord = dot["yd_io"] - dot["steps_io"] * step_size

    elif dot["side"] == "side2":
        if dot["io"] == "inside":
            x_coord = (100 - dot["yd_io"]) - dot["steps_io"] * step_size
        elif dot["io"] == "outside":
            x_coord = (100 - dot["yd_io"]) + dot["steps_io"] * step_size

    if dot["marker_fb"] == "front sideline":
        if dot["fb"] == "in front":
            ycoord = -dot["steps_fb"] * step_size
        elif dot["fb"] == "behind":
            ycoord = dot["steps_fb"] * step_size

    elif dot["marker_fb"] == "back sideline":
        if dot["fb"] == "in front":
            ycoord = field_width - dot["steps_fb"] * step_size
        elif dot["fb"] == "behind":
            ycoord = field_width + dot["steps_fb"] * step_size

    elif dot["marker_fb"] == "front hash":
        if dot["fb"] == "in front":
            ycoord = front_hash - dot["steps_fb"] * step_size
        elif dot["fb"] == "behind":
            ycoord = front_hash + dot["steps_fb"] * step_size

    elif dot["marker_fb"] == "back hash":
        if dot["fb"] == "in front":
            ycoord = back_hash - dot["steps_fb"] * step_size
        elif dot["fb"] == "behind":
            ycoord = back_hash + dot["steps_fb"] * step_size

    return x_coord, ycoord


# calculate the speed of sound in air from temperature, pressure, relative humidity,
# and CO2 concentration using Eq. 15 and Table III of Cramer, J. Acoust. Soc. Am. 93,
# 2510-2516 (1993). Valid for 0-30 degC, 75000-102000 Pa, water vapor mole fraction
# up to 0.06, and CO2 mole fraction up to 0.01.
def sound_speed_air(t_f, p, rh, xc):
    """
    Speed of sound in air (zero frequency).

    If any input is outside the validity range of Eq. 15, a warning is issued
    and the sound speed at the estimated Lucas Oil Stadium interior conditions
    (72 degF, 98.7 kPa, 50% RH, 1000 ppm CO2) is returned instead.

    Parameters
    ----------
    t_f : float
        Temperature in degrees Fahrenheit (32 to 86, i.e., 0 to 30 degC).
    p : float
        Atmospheric pressure in Pa (75000 to 102000).
    rh : float
        Relative humidity in percent (0 to 100).
    xc : float
        CO2 mole fraction (e.g., 0.0004 for 400 ppm; valid up to 0.01).

    Returns
    -------
    tuple of float
        (speed of sound in m/s, speed of sound in yd/s).
    """

    # Water vapor mole fraction from relative humidity (Giacomo, reproduced in
    # the Appendix of Cramer 1993): xw = h * f * psv / p
    def water_vapor_mole_fraction(t, p, rh):
        T = t + 273.15
        h = rh / 100
        f = 1.00062 + 3.14e-8 * p + 5.6e-7 * t**2  # enhancement factor
        psv = np.exp(
            1.2811805e-5 * T**2 - 1.9509874e-2 * T + 34.04926034 - 6.3536311e3 / T
        )  # saturation vapor pressure in Pa
        return h * f * psv / p

    t = (t_f - 32) * 5 / 9  # convert to Celsius
    xw = water_vapor_mole_fraction(t, p, rh)

    # Check that the inputs are within the validity range of Eq. 15. If not,
    # warn the user and fall back to the Lucas Oil interior conditions.
    out_of_bounds = []
    if not 0 <= t <= 30:
        out_of_bounds.append(f"temperature {t_f} degF ({t:.1f} degC, valid 32-86 degF)")
    if not 75000 <= p <= 102000:
        out_of_bounds.append(f"pressure {p / 1000} kPa (valid 75-102 kPa)")
    if not 0 <= rh <= 100:
        out_of_bounds.append(f"relative humidity {rh}% (valid 0-100%)")
    if not 0 <= xc <= 0.01:
        out_of_bounds.append(f"CO2 mole fraction {xc} (valid 0-0.01)")
    if not 0 <= xw <= 0.06:
        out_of_bounds.append(f"water vapor mole fraction {xw:.4f} (valid 0-0.06)")

    if out_of_bounds:
        warnings.warn(
            "Input(s) outside validity range of Cramer Eq. 15: "
            + "; ".join(out_of_bounds)
            + ". Using estimated Lucas Oil Stadium interior conditions "
            "(72 degF, 98.7 kPa, 50% RH, 1000 ppm CO2) instead.",
            stacklevel=2,
        )
        t = (72 - 32) * 5 / 9
        p = 98700.0
        xc = 0.001
        xw = water_vapor_mole_fraction(t, p, 50)

    # Coefficients for the speed of sound from Table III
    a0 = 331.5024
    a1 = 0.603055
    a2 = -0.000528
    a3 = 51.471935
    a4 = 0.1495874
    a5 = -0.000782
    a6 = -1.82e-7
    a7 = 3.73e-8
    a8 = -2.93e-10
    a9 = -85.20931
    a10 = -0.228525
    a11 = 5.91e-5
    a12 = -2.835149
    a13 = -2.15e-13
    a14 = 29.179762
    a15 = 0.000486

    # Eq. 15
    c0 = (
        a0
        + a1 * t
        + a2 * t**2
        + (a3 + a4 * t + a5 * t**2) * xw
        + (a6 + a7 * t + a8 * t**2) * p
        + (a9 + a10 * t + a11 * t**2) * xc
        + a12 * xw**2
        + a13 * p**2
        + a14 * xc**2
        + a15 * xw * p * xc
    )

    c0_yd = c0 / 0.9144  # convert m/s to yd/s

    return c0, c0_yd


# calculate the velocity along the line between the source and the observer as well as the frequency shift at the
# observer. The sound speed is calculated from the environmental conditions
# (temperature in degF, pressure in Pa, relative humidity in %, and CO2 mole
# fraction). Defaults are estimates for Lucas Oil Stadium: 72 degF climate-
# controlled interior, ambient pressure at Indianapolis' elevation (~715 ft,
# ~98700 Pa), 50% relative humidity, and 1000 ppm CO2 for a crowded indoor venue.
def doppler(m, n, l, tempo, counts, t_start, f_s, t_f=72, p=98700, rh=50, xc=0.001):
    r = (
        n - m
    )  # n and m must be numpy arrays of shape (3, 1). l must be the same shape too
    set_dist = np.linalg.norm(r)

    step_size = 8 / ((set_dist / counts) / (5 / 8))

    Vs = set_dist / ((60 / tempo) * counts)  # in yds per sec
    t_end = set_dist / Vs + t_start
    num_pts = 100
    t = np.linspace(t_start, t_end, num_pts)
    t = t.reshape(1, num_pts)

    counts_list = t * (tempo / 60)

    Ps = m + r * ((t - t_start) / (t_end - t_start))

    d_so = np.linalg.norm(Ps, axis=0)

    m1 = m[0, 0]
    m2 = m[1, 0]
    m3 = m[2, 0]
    n1 = n[0, 0]
    n2 = n[1, 0]
    n3 = n[2, 0]
    l1 = l[0, 0]
    l2 = l[1, 0]
    l3 = l[2, 0]

    V_so_der = (
        1.0
        / np.sqrt(
            (
                l1
                - m1
                + Vs
                * (m1 - n1)
                * (t - t_start)
                * 1.0
                / np.sqrt((m1 - n1) ** 2 + (m2 - n2) ** 2 + (m3 - n3) ** 2)
            )
            ** 2
            + (
                l2
                - m2
                + Vs
                * (m2 - n2)
                * (t - t_start)
                * 1.0
                / np.sqrt((m1 - n1) ** 2 + (m2 - n2) ** 2 + (m3 - n3) ** 2)
            )
            ** 2
            + (
                l3
                - m3
                + Vs
                * (m3 - n3)
                * (t - t_start)
                * 1.0
                / np.sqrt((m1 - n1) ** 2 + (m2 - n2) ** 2 + (m3 - n3) ** 2)
            )
            ** 2
        )
        * (
            Vs
            * (m1 - n1)
            * (
                l1
                - m1
                + Vs
                * (m1 - n1)
                * (t - t_start)
                * 1.0
                / np.sqrt((m1 - n1) ** 2 + (m2 - n2) ** 2 + (m3 - n3) ** 2)
            )
            * 1.0
            / np.sqrt((m1 - n1) ** 2 + (m2 - n2) ** 2 + (m3 - n3) ** 2)
            * 2.0
            + Vs
            * (m2 - n2)
            * (
                l2
                - m2
                + Vs
                * (m2 - n2)
                * (t - t_start)
                * 1.0
                / np.sqrt((m1 - n1) ** 2 + (m2 - n2) ** 2 + (m3 - n3) ** 2)
            )
            * 1.0
            / np.sqrt((m1 - n1) ** 2 + (m2 - n2) ** 2 + (m3 - n3) ** 2)
            * 2.0
            + Vs
            * (m3 - n3)
            * (
                l3
                - m3
                + Vs
                * (m3 - n3)
                * (t - t_start)
                * 1.0
                / np.sqrt((m1 - n1) ** 2 + (m2 - n2) ** 2 + (m3 - n3) ** 2)
            )
            * 1.0
            / np.sqrt((m1 - n1) ** 2 + (m2 - n2) ** 2 + (m3 - n3) ** 2)
            * 2.0
        )
    ) / 2.0

    # sound speed in air from the environmental conditions, in yd/s
    c_SI, c = sound_speed_air(t_f, p, rh, xc)
    f_o = f_s * (c / (c + V_so_der))
    f_o_tempo = tempo * (c / (c + V_so_der))
    tempo_shift = f_o_tempo - tempo

    cents = (1200 / np.log(2)) * np.log(f_o / f_s)

    return V_so_der, t, counts_list, f_o, f_o_tempo, tempo_shift, cents, step_size, c_SI


def synthesize_tones(f_s, t_sec, f_o_t, instrument="sine", sample_rate=44100):
    """
    Synthesize the performer tone (constant f_s) mixed with the Doppler-
    shifted tone heard by the observer (frequency f_o_t sampled at times
    t_sec), using the harmonic recipe for the chosen instrument.

    Returns (samples, sample_rate) with samples as float64 in [-1, 1].
    """
    harmonics = HARMONICS[instrument]
    duration = t_sec[-1] - t_sec[0]
    n_samples = int(round(duration * sample_rate))
    t_audio = np.arange(n_samples) / sample_rate

    # Instantaneous frequency of the shifted voice, resampled to audio rate,
    # then integrated to phase so the pitch glide is continuous.
    f_shift = np.interp(t_audio, t_sec - t_sec[0], f_o_t)
    phase_shift = 2 * np.pi * np.cumsum(f_shift) / sample_rate
    phase_steady = 2 * np.pi * f_s * t_audio

    def voice(phase):
        out = np.zeros_like(phase)
        for k, amp in enumerate(harmonics, start=1):
            out += amp * np.sin(k * phase)
        return out / np.sum(harmonics)

    mix = 0.5 * (voice(phase_steady) + voice(phase_shift))

    # Short attack/release envelope to avoid clicks
    env = np.ones(n_samples)
    ramp = int(0.02 * sample_rate)
    env[:ramp] = np.linspace(0, 1, ramp)
    env[-ramp:] = np.linspace(1, 0, ramp)
    mix *= env

    mix *= 0.9 / np.max(np.abs(mix))
    return mix, sample_rate


def write_and_play_wav(samples, sample_rate, filename):
    """Write 16-bit mono WAV with the stdlib and play it if possible."""
    pcm = (samples * 32767).astype(np.int16)
    with wave.open(filename, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    print(f"Tone written to {filename}")

    try:
        if sys.platform == "darwin":
            subprocess.run(["afplay", filename], check=True)
        elif sys.platform.startswith("linux"):
            subprocess.run(["aplay", filename], check=True)
        elif sys.platform.startswith("win"):
            import os

            os.startfile(filename)  # noqa
        else:
            print("Automatic playback not supported on this platform.")
    except Exception as exc:
        print(f"Could not play audio automatically ({exc}); open {filename} manually.")


# ============================================================================
# Calculation
# ============================================================================

# Resolve the performer frequency
if freq_mode == "note":
    f_s = NOTE_FREQS[note][octave]

# Convert environmental inputs to the units used by the physics
pressure_pa = pressure_kpa * 1000
xc = co2_ppm * 1e-6

# convert dots to global coordinates
x_coord_obs, y_coord_obs = dot2coord(dot_obs)
x_coord1, y_coord1 = dot2coord(dot1)
x_coord2, y_coord2 = dot2coord(dot2)

l = np.transpose(np.array([[x_coord_obs, y_coord_obs, z_coord_obs]]))
m = np.transpose(np.array([[x_coord1, y_coord1, z_coord1]]))
n = np.transpose(np.array([[x_coord2, y_coord2, z_coord2]]))

(
    V_so_der,
    time,
    counts_list,
    f_o,
    f_o_tempo,
    tempo_shift,
    cents,
    step_size_march,
    c_SI,
) = doppler(
    m,
    n,
    l,
    tempo,
    counts,
    t_start,
    f_s,
    t_f=temp_f,
    p=pressure_pa,
    rh=rel_humidity,
    xc=xc,
)

# ============================================================================
# Plots (styled to match the web app)
# ============================================================================

FIELD_GREEN = "#41804a"
APRON_GREEN = "#2f5e34"
RED = "#d63a3a"
BLUE = "#2b62d9"

# Yard line locations and markers
yd_markers_locations = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
yd_markers = ["G", 10, 20, 30, 40, 50, 40, 30, 20, 10, "G"]

# Make arrays for the yard lines, four step lines, and two step lines
yd_lines = np.arange(0, field_length + yd_line_dist, yd_line_dist)
four_step_lines_vert = np.arange(0, field_length + yd_line_dist / 2, yd_line_dist / 2)
two_step_lines_vert = np.arange(0, field_length + yd_line_dist / 4, yd_line_dist / 4)
four_step_lines_horz = np.arange(0, field_width, yd_line_dist / 2)
two_step_lines_horz = np.arange(0, field_width, yd_line_dist / 4)

# Plot extent: whole field plus a margin, expanded to include all markers
pad = 3
xs = [0, field_length, x_coord1, x_coord2, x_coord_obs]
ys = [0, field_width, y_coord1, y_coord2, y_coord_obs]
x_min, x_max = min(xs) - pad, max(xs) + pad
y_min, y_max = min(ys) - pad, max(ys) + pad

fig = plt.figure(num=1, figsize=(7, 8), dpi=300)
ax1 = plt.subplot2grid((2, 1), (0, 0))
ax2 = plt.subplot2grid((2, 1), (1, 0))
ax3 = ax2.twinx()

# Turf
ax1.set_facecolor(APRON_GREEN)
ax1.fill_between([0, field_length], 0, field_width, color=FIELD_GREEN, zorder=0)
# Alternating 5-yard mowing stripes
for x in np.arange(yd_line_dist, field_length, 2 * yd_line_dist):
    ax1.fill_between(
        [x, x + yd_line_dist], 0, field_width, color="white", alpha=0.06, zorder=0
    )

# Gridlines (white, like the web app)
ax1.vlines(
    two_step_lines_vert, 0, field_width, color="white", linewidth=0.25, alpha=0.18
)
ax1.hlines(
    two_step_lines_horz, 0, field_length, color="white", linewidth=0.25, alpha=0.18
)
ax1.vlines(
    four_step_lines_vert, 0, field_width, color="white", linewidth=0.5, alpha=0.35
)
ax1.hlines(
    four_step_lines_horz, 0, field_length, color="white", linewidth=0.5, alpha=0.35
)
ax1.vlines(yd_lines, 0, field_width, color="white", linewidth=0.75, alpha=0.9)
ax1.hlines(front_hash, 0, field_length, color="white", linewidth=1)
ax1.hlines(back_hash, 0, field_length, color="white", linewidth=1)
ax1.hlines(0, 0, field_length, color="white", linewidth=1.25)
ax1.hlines(field_width, 0, field_length, color="white", linewidth=1.25)

# Arrow from start to end
ax1.annotate(
    "",
    xy=(x_coord2, y_coord2),
    xytext=(x_coord1, y_coord1),
    arrowprops=dict(
        arrowstyle="-|>", color="white", linewidth=1.5, shrinkA=6, shrinkB=6
    ),
    zorder=3,
)

# Markers: open red circle start, filled red circle end, blue observer square
ax1.plot(
    x_coord1,
    y_coord1,
    "o",
    ms=6,
    mfc="none",
    mec=RED,
    mew=1.5,
    label="Start",
    zorder=4,
)
ax1.plot(
    x_coord2, y_coord2, "o", ms=6, mfc=RED, mec="white", mew=0.5, label="End", zorder=4
)
ax1.plot(
    x_coord_obs,
    y_coord_obs,
    "s",
    ms=6,
    mfc=BLUE,
    mec="white",
    mew=0.5,
    label="Observer",
    zorder=4,
)

ax1.set_xticks(yd_markers_locations, labels=yd_markers)
ax1.tick_params(direction="inout", length=10)
ax1.set_yticks([])
ax1.set_xlim([x_min, x_max])
ax1.set_ylim([y_min, y_max])
ax1.set_aspect("equal")
ax1.spines[["left", "right", "top", "bottom"]].set_visible(False)
ax1.legend(fontsize=7, loc="upper left")

# Shift plot: blue cents (left), red bpm (right), "+" on positive ticks
signed = FuncFormatter(lambda v, pos: f"+{v:g}" if v > 0 else f"{v:g}")

ax2.plot(counts_list[0, :], cents[0, :], color=BLUE, linewidth=2)
ax2.set_xlabel("Count")
ax2.set_ylabel("Tuning Shift (cents)", color="k")
ax2.tick_params(axis="y", labelcolor="k")
ax2.set_xlim([np.min(counts_list[0, :]), np.max(counts_list[0, :])])
ax2.yaxis.set_major_formatter(signed)

ax3.plot(counts_list[0, :], tempo_shift[0, :], color=RED, linewidth=2)
ax3.set_ylabel("Tempo Shift (bpm)", color="k")
ax3.tick_params(axis="y", labelcolor="k")
ax3.yaxis.set_major_formatter(signed)
# Slightly larger margin than the left axis so the two nearly-proportional
# curves don't overlap exactly (mirrors the web app's axis rounding)
ax3.margins(y=0.12)

plt.tight_layout()
plt.show()

# ============================================================================
# Results (same as the web app's Results panel)
# ============================================================================

print(f"Tempo:               {tempo} bpm")
print(f"Counts:              {counts}")
print(f"Performer Frequency: {np.round(f_s, 1)} Hz")
print(f"Step Size:           {np.round(step_size_march, 1)} to 5")
print(
    f"Tuning Shift:        {np.round(np.mean(cents[0, :]), 1)} "
    f"\u00b1 {np.round(np.std(cents[0, :]), 1)} cents"
)
print(
    f"Tempo Shift:         {np.round(np.mean(tempo_shift[0, :]), 1)} "
    f"\u00b1 {np.round(np.std(tempo_shift[0, :]), 1)} bpm"
)
print(
    f"Observed Frequency:  {np.round(np.mean(f_o[0, :]), 1)} "
    f"\u00b1 {np.round(np.std(f_o[0, :]), 1)} Hz"
)
print(f"Sound Speed:         {np.round(c_SI, 1)} m/s")

# ============================================================================
# Tone playback
# ============================================================================

if play_audio:
    samples, sr = synthesize_tones(
        f_s, time[0, :], f_o[0, :], instrument=instrument
    )
    write_and_play_wav(samples, sr, audio_file)
