# %%
import warnings

import matplotlib.pyplot as plt
import numpy as np


# convert dot dictionary to position in global coordinate system
def dot2coord(dot):
    # For steps defined on an 8 to 5 grid
    step_size = 5 / 8

    field_width = 160 / 3
    front_hash = 60 / 3
    # back_hash = field_width - 60 / 3
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
    and the sound speed at STP conditions (0 degC, 101325 Pa, dry air,
    314 ppm CO2) is returned instead.

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
    t = (t_f - 32) * 5 / 9  # convert to Celsius
    T = t + 273.15

    # Water vapor mole fraction from relative humidity (Giacomo, reproduced in
    # the Appendix of Cramer 1993): xw = h * f * psv / p
    h = rh / 100
    f = 1.00062 + 3.14e-8 * p + 5.6e-7 * t**2  # enhancement factor
    psv = np.exp(
        1.2811805e-5 * T**2 - 1.9509874e-2 * T + 34.04926034 - 6.3536311e3 / T
    )  # saturation vapor pressure in Pa
    xw = h * f * psv / p

    # Check that the inputs are within the validity range of Eq. 15. If not,
    # warn the user and fall back to STP conditions.
    out_of_bounds = []
    if not 0 <= t <= 30:
        out_of_bounds.append(f"temperature {t_f} degF ({t:.1f} degC, valid 32-86 degF)")
    if not 75000 <= p <= 102000:
        out_of_bounds.append(f"pressure {p} Pa (valid 75000-102000 Pa)")
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
            + ". Using sound speed at STP (0 degC, 101325 Pa, dry air, "
            "314 ppm CO2) instead.",
            stacklevel=2,
        )
        t, p, xw, xc = 0.0, 101325.0, 0.0, 0.000314

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
# fraction). Defaults are estimates for Lucas Oil Stadium: 70 degF climate-
# controlled interior, ambient pressure at Indianapolis' elevation (~715 ft,
# ~98700 Pa), 50% relative humidity, and 1000 ppm CO2 for a crowded indoor venue.
def doppler(m, n, l, tempo, counts, t_start, f_s, t_f=70, p=98700, rh=50, xc=0.001):
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


dot_obs = {
    "side": "side1",
    "steps_io": 0,
    "io": "inside",
    "yd_io": 50,
    "steps_fb": 0,
    "fb": "in front",
    "marker_fb": "front sideline",
}

"""# Lucas Oil Judges Box
    # Hardcoded Lucas Oil Judges Box observer position
    obs_side = "side1"
    obs_steps_io = 0.0
    obs_io = "inside"
    obs_yd = 50
    obs_steps_fb = 85.0  # 85 steps in front of front sideline
    obs_fb = "in front"
    obs_marker_fb = "front sideline"
    z_coord_obs = 33.0  # 33 yards high
"""

dot1 = {
    "side": "side1",
    "steps_io": 0,
    "io": "inside",
    "yd_io": 45,
    "steps_fb": 8,
    "fb": "behind",
    "marker_fb": "front sideline",
}

dot2 = {
    "side": "side2",
    "steps_io": 0,
    "io": "inside",
    "yd_io": 45,
    "steps_fb": 8,
    "fb": "behind",
    "marker_fb": "front sideline",
}

z_coord_obs = 2
z_coord1 = 2
z_coord2 = 2

tempo = 160
counts = 12
f_s = 440
t_start = 0

# Important constants, NCAA field with 8 to 5 standard step size
field_length = 100
field_width = 160 / 3
front_hash = 60 / 3
back_hash = field_width - 60 / 3
yd_line_dist = 5
step_size = yd_line_dist / 8

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
) = doppler(m, n, l, tempo, counts, t_start, f_s, t_f=70, p=98700, rh=50, xc=0.001)

# Yard line locations and markers
yd_markers_locations = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
yd_markers = ["G", 10, 20, 30, 40, 50, 40, 30, 20, 10, "G"]

# Make arrays for the yard lines, four step lines, and two step lines
yd_lines = np.arange(0, field_length + yd_line_dist, yd_line_dist)
four_step_lines_vert = np.arange(0, field_length + yd_line_dist / 2, yd_line_dist / 2)
two_step_lines_vert = np.arange(0, field_length + yd_line_dist / 4, yd_line_dist / 4)
four_step_lines_horz = np.arange(0, field_width, yd_line_dist / 2)
two_step_lines_horz = np.arange(0, field_width, yd_line_dist / 4)

# plot NCAA football field grid, velocity, and cents shift
fig = plt.figure(num=1, figsize=(7, 6), dpi=300)
ax1 = plt.subplot2grid((2, 1), (0, 0))
ax2 = plt.subplot2grid((2, 1), (1, 0))
ax3 = ax2.twinx()

ax1.vlines(two_step_lines_vert, 0, field_width, color="grey", linewidth=0.25, alpha=0.5)
ax1.hlines(
    two_step_lines_horz, 0, field_length, color="grey", linewidth=0.25, alpha=0.5
)
ax1.vlines(four_step_lines_vert, 0, field_width, color="grey", linewidth=0.5)
ax1.hlines(four_step_lines_horz, 0, field_length, color="grey", linewidth=0.5)
ax1.hlines(front_hash, 0, field_length, color="k", linewidth=1)
ax1.hlines(back_hash, 0, field_length, color="k", linewidth=1)
ax1.hlines(0, 0, field_length, color="k", linewidth=1)
ax1.hlines(field_width, 0, field_length, color="k", linewidth=1)
ax1.vlines(yd_lines, 0, field_width, color="k", linewidth=1)
ax1.plot(x_coord1, y_coord1, "gD", ms=5, alpha=1, mec="k", mew=0.5, label="Start")
ax1.plot(x_coord2, y_coord2, "ro", ms=5, mec="k", mew=0.5, label="End")
ax1.plot(x_coord_obs, y_coord_obs, "bs", ms=5, mec="k", mew=0.5, label="Observer")
ax1.set_xticks(yd_markers_locations, labels=yd_markers)
ax1.tick_params(direction="inout", length=10)
ax1.set_yticks([])
ax1.set_xlim([0, field_length])
ax1.set_ylim([0, field_width])
ax1.axis("equal")
ax1.spines[["left", "right", "top", "bottom"]].set_visible(False)
ax1.legend(fontsize=7, loc="upper left")

ax2.plot(counts_list[0, :], cents[0, :], color="tab:blue")
ax2.set_xlabel("Count")
ax2.set_ylabel("Tuning Shift (cents)", color="k")
ax2.tick_params(axis="y", labelcolor="k")
ax2.set_xlim([np.min(counts_list[0, :]), np.max(counts_list[0, :])])

ax3.plot(counts_list[0, :], tempo_shift[0, :], color="tab:blue", linestyle="-")
ax3.set_ylabel("Tempo Shift (bpm)", color="k")
ax3.tick_params(axis="y", labelcolor="k")


plt.tight_layout()
plt.show()

print(f"Tempo:              {tempo} bpm")
print(f"Counts:             {counts}")
print(f"Frequency:          {f_s} Hz")
print(f"Step Size:          {np.round(step_size_march,1)}")
print(f"Mean Shift:         {np.round(np.mean(cents[0, :]),1)} cents")
print(f"SD Shift:           {np.round(np.std(cents[0, :]),1)} cents")
print(f"Mean Frequency:     {np.round(np.mean(f_o[0, :]),1)} Hz")
print(f"SD Frequency:       {np.round(np.std(f_o[0, :]),1)} Hz")
print(f"Mean Tempo Shift:   {np.round(np.mean(tempo_shift[0, :]),1)} bpm")
print(f"SD Tempo Shift:     {np.round(np.std(tempo_shift[0, :]),1)} bpm")
print(f"Sound Speed:        {np.round(c_SI,1)} m/s")
