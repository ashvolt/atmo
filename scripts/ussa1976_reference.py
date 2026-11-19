"""
Builds src/data/ussa1976_upper.json: the U.S. Standard Atmosphere 1976 from
80 km to 1000 km (geometric altitude).

Method
------
* Temperature and species number densities come from the `ussa1976` package
  (a full implementation of NASA-TM-X-74335's 86-1000 km diffusion model).
* Its total mass density deviates from the *published* 1976 tables by up to
  +6.7 % (around 450 km). The published tables are the standard, so density,
  pressure and number density are multiplied by a smooth correction factor
  c(z) that is exactly 1 at 80-90 km and exactly reproduces the published
  density at every anchor altitude below (monotone cubic interpolation of c in z).
  Temperatures already agree with the published tables and are left unchanged.

Also writes tests/fixtures/ussa1976_lower.json (0-86 km reference from the
package) to cross-check the analytic TypeScript lower-atmosphere model.
"""
import json
import os

import numpy as np
import ussa1976
from scipy.interpolate import PchipInterpolator

# Published USSA-1976 densities [kg/m^3] (NASA-TM-X-74335 Table I, geometric altitude, km)
PUBLISHED_RHO = {
    86: 6.958e-6, 90: 3.416e-6, 100: 5.604e-7, 110: 9.708e-8, 120: 2.222e-8, 130: 8.152e-9,
    150: 2.076e-9, 200: 2.541e-10, 250: 6.073e-11, 300: 1.916e-11, 350: 7.014e-12,
    400: 2.803e-12, 450: 1.184e-12, 500: 5.215e-13, 600: 1.137e-13, 700: 3.070e-14,
    800: 1.136e-14, 900: 5.759e-15, 1000: 3.561e-15,
}

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

z_km = np.unique(np.concatenate([
    np.arange(80.0, 150.0, 0.25),
    np.arange(150.0, 400.0, 1.0),
    np.arange(400.0, 1000.0 + 1e-9, 2.0),
]))
ds = ussa1976.compute(z=z_km * 1000.0)
rho_pkg = ds["rho"].values
p_pkg = ds["p"].values
n_pkg = ds["n_tot"].values
t_pkg = ds["t"].values

anchors = sorted(PUBLISHED_RHO)
anchor_pkg = ussa1976.compute(z=np.array(anchors, dtype=float) * 1000.0)["rho"].values
ratio = np.array([PUBLISHED_RHO[a] / r for a, r in zip(anchors, anchor_pkg)])
# Force the 80 km point to 1 (the analytic model below 86 km is exact).
ck = np.concatenate([[80.0], anchors])
cv = np.concatenate([[1.0], ratio])
c = PchipInterpolator(ck, cv)(z_km)

rho = rho_pkg * c
p = p_pkg * c
n = n_pkg * c
M = rho / n * 6.02214076e26  # mean molar mass [kg/kmol]

out = {
    "source": "U.S. Standard Atmosphere 1976 (NASA-TM-X-74335). T, species profile: ussa1976 "
    + "package v0.3.4; density anchored to published table values.",
    "z_km": [round(float(v), 4) for v in z_km],
    "T": [float(f"{v:.6f}") for v in t_pkg],
    "logRho": [float(f"{v:.9f}") for v in np.log(rho)],
    "logP": [float(f"{v:.9f}") for v in np.log(p)],
    "logN": [float(f"{v:.9f}") for v in np.log(n)],
    "M": [float(f"{v:.6f}") for v in M],
}
os.makedirs(os.path.join(root, "src", "data"), exist_ok=True)
with open(os.path.join(root, "src", "data", "ussa1976_upper.json"), "w") as fh:
    json.dump(out, fh, separators=(",", ":"))

# Cross-check fixture for the analytic 0-86 km model and for interpolation midpoints.
zl = np.arange(0.0, 86000.0 + 1, 500.0)
dl = ussa1976.compute(z=zl)
zm = (z_km[:-1] + z_km[1:]) / 2
dm = ussa1976.compute(z=zm * 1000.0)
cm = PchipInterpolator(ck, cv)(zm)
os.makedirs(os.path.join(root, "tests", "fixtures"), exist_ok=True)
with open(os.path.join(root, "tests", "fixtures", "ussa1976_reference.json"), "w") as fh:
    json.dump({
        "lower": {"z": zl.tolist(), "T": dl["t"].values.tolist(), "p": dl["p"].values.tolist(),
                  "rho": dl["rho"].values.tolist(), "cs": dl["cs"].values.tolist()},
        "mid": {"z_km": zm.tolist(), "T": dm["t"].values.tolist(), "rho": (dm["rho"].values * cm).tolist()},
        "published_rho": {str(k): v for k, v in PUBLISHED_RHO.items()},
    }, fh)
print("rows:", len(z_km), "max correction:", float(np.max(np.abs(c - 1))))
