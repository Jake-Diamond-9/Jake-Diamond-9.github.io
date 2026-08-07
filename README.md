# Jake-Diamond-9.github.io

Calculator for the Doppler shift of marching band drill sets.

**Live app:** https://jake-diamond-9.github.io/

Enter a performer's start and end dots, an observer position (defaults to the
Lucas Oil Stadium judges box), the environmental conditions (defaults estimated
for the stadium interior), and the source frequency/tempo. The app plots the
move on an NCAA field, graphs the tuning shift (cents) and tempo shift (bpm)
over the move, and reports summary statistics.

The physics lives in [`js/doppler.js`](js/doppler.js), a direct port of
[`doppler_shift_set.py`](doppler_shift_set.py). The speed of sound is computed
from temperature, pressure, humidity, and CO2 concentration using Cramer,
*J. Acoust. Soc. Am.* 93, 2510-2516 (1993).
