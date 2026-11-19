# Atmo — Real-Physics Gravity Laboratory

Interactive 3-D simulator for **dropping and throwing objects anywhere on Earth** (plus the Moon, Mars and Jupiter), and for **levitating them** by every mechanism physics allows. Models are taken from geodesy, aerodynamics and electromagnetism references instead of textbook simplifications. Every one is validated against closed-form solutions or published measurements, and the remaining gaps are stated with their measured size.

```
npm install
npm run dev        # http://localhost:5173
npm test           # validation tests (physics core, electromagnetism, real-world data)
npm run build      # production bundle in dist/
```

Three views: the **globe** (gravity field and launch sites), the **site** (terrain, drops and throws), and the **levitation laboratory** (ten ways to balance gravity, and why none of them is antigravity).

The generated data files (`public/data`, `public/textures`) are part of the repository. To regenerate them from the original sources, run `npm run data`. This needs Python 3 with `numpy`, `scipy`, `ussa1976` and `Pillow`.

## What it simulates

| Domain | Model | Source |
|---|---|---|
| Earth's shape | WGS 84 ellipsoid, exact geodetic ↔ ECEF (Vermeille 2002) | NIMA TR8350.2 |
| Gravity | EGM2008 spherical harmonics to degree 360 (65 341 coefficient pairs); user-selectable degree for integration | Pavlis et al. 2012 (via ICGEM) |
| Rotation | Integration in the Earth-fixed frame with centrifugal and Coriolis terms | — |
| Atmosphere | U.S. Standard Atmosphere 1976 from −5 to 1000 km (analytic layers to 80 km; diffusion model anchored to the published density table above) | NASA-TM-X-74335 |
| Weather | Sea-level temperature and pressure (hydrostatic re-integration), humidity (virtual-temperature effect), boundary-layer and jet-stream wind | — |
| Drag | Clift–Grace–Weber sphere curve (drag crisis included), Mach tables, free-molecular limit with Knudsen bridging, Gunn–Kinzer raindrops, tracking-data fits for baseballs and golf balls | see `src/physics/aero/drag.ts` |
| Spin | Magnus lift and aerodynamic spin decay | Sawicki 2003, Nathan 2008, Smits & Smith 1994 |
| Water | Ocean entry, buoyancy, added mass, compressible sea water, sinking to the real sea floor | EOS-80 |
| Heating | Sutton–Graves stagnation heating, radiative cooling, ablation and burn-up | Sutton & Graves 1971; Ceplecha 1998 |
| Integrator | Adaptive Dormand–Prince RK5(4), dense output, event location (impact, water entry, parachute, apogee, burn-up) | Hairer–Nørsett–Wanner |
| Terrain | AWS Terrain Tiles (SRTM/GMTED/ETOPO1) around the site, with zoom-10 bathymetry filled in over open water; global 0.25° grid elsewhere; flood-filled ocean mask, so the Dead Sea and the Caspian count as land | Mapzen/Tilezen |
| Imagery | Sentinel-2 cloudless (EOX, CC BY 4.0), Solar System Scope planet maps (CC BY 4.0) | |
| Other worlds | Moon GL0660B, Mars MRO120D and Jupiter Juno zonal gravity; Mars (NASA Glenn) and Jupiter (Galileo probe and adiabat) atmospheres | |
| Magnetic fields | Biot–Savart along the conductor with geometric convergence; exact surface-charge solution for block magnets; equivalent surface currents for discs; Carlson elliptic integrals as an independent check | Simpson et al., NASA/TM-2001-210956; Furlani (2001); Carlson (1979) |
| Derivatives | Hyper-dual arithmetic: every field carries exact first and second derivatives, so stability eigenvalues are exact rather than finite-differenced | Fike & Alonso, AIAA 2011-886 |
| Levitation | Earnshaw's theorem and its escape clauses; diamagnetic, Meissner and flux-pinning, eddy-current, servo, spin-stabilised, acoustic, optical, thrust and buoyancy modes | Earnshaw 1842; Berry & Geim 1997; Bean 1964; Landau & Lifshitz §59; Post & Ryutov 2000; Berry 1996; Gor'kov 1962; Ashkin 1970 |
| Magnet engineering | Fabry relation for resistive magnets, Lorentz hoop stress, winding sizing and cooling | Montgomery, "Solenoid Magnet Design" (1969) |

## The levitation laboratory

Gravity cannot be shielded, reduced or cancelled. Everything called "levitation" balances it with another force, and this view works out which forces can, how much of each it takes, and whether the result is stable.

The organising fact is **Earnshaw's theorem** (1842): in a source-free region the energy of a fixed charge or magnetic moment is a harmonic function, so its three stiffnesses sum to zero and every static equilibrium is a saddle. The app checks that identity numerically — the trace of the stiffness matrix comes out zero to machine precision — and then shows what each working mode breaks to get around it.

| Mode | What balances gravity | How it escapes Earnshaw |
|---|---|---|
| Electrostatic | *QE* | nothing — needs feedback (NASA's ESL) or an AC trap |
| Permanent magnet | ∇(**m**·**B**) | nothing — provably unstable |
| **Diamagnetic** | (χ/μ₀)·*B*∂*B*/∂*z* | induced moment: ∇²(B²) ≥ 0, so B² can have a minimum |
| **Superconducting** | Meissner image + flux pinning | χ = −1 *and* hysteretic pinning |
| **Eddy current** | induced-current repulsion | the field varies in time |
| **Active servo** | controlled electromagnet | continuous energy input |
| **Spin-stabilised** | precessing moment | angular momentum: *U* = +*m*|**B**| |
| **Acoustic** | Gor'kov radiation force | oscillating field |
| **Optical** | radiation pressure + gradient force | oscillating field |
| **Thrust / buoyancy** | momentum transfer, Archimedes | not a field energy at all |

Bold = stable with no feedback, no spin and no power.

**What it computes.** For your object, on your apparatus, at your place on Earth: the requirement (field–gradient product, charge, sound pressure, laser power, thrust…), the equilibrium height, the stability eigenvalues and oscillation frequencies, and a verdict tier from *desk toy* to *beyond any current technology* — benchmarked against 0.6 T neodymium, 2.2 T iron-yoke, 23.5 T superconducting, 45.5 T hybrid (NHMFL) and 1200 T single-shot magnets. A build sheet sizes the magnet: amp-turns, current density, wire gauge, ohmic power from the Fabry relation, cooling flow, conductor mass, Lorentz hoop stress and indicative cost.

Because the local gravity comes from EGM2008 at the chosen site, the requirement really does differ between places — about 0.35 % between a Peruvian summit and the pole.

**What it draws.** Field lines traced by RK4 through the real field and coloured by log|**B**|; a |**B**| slice through the apparatus; net-force arrows (gravity included, so an upward arrow means it would actually rise); and a rotatable 3-D energy surface where a basin is a trap and a mountain pass is a saddle, with the escape direction drawn as an arrow.

**What it integrates.** Six-degree-of-freedom rigid-body motion — translation, rotation, magnetic torque and gyroscopic precession — on the same Dormand–Prince integrator the ballistics uses. With damping off the total energy is conserved to about one part in 10¹⁰, which is the check that the force ∇(**m**·**B**) and the torque **m**×**B** agree.

### Antigravity: the claims and the evidence

A dedicated section sets out the impossibility argument step by step and tabulates every notable claim with the measurement that settles it: the MICROSCOPE equivalence-principle bound (|η| < 1.5 × 10⁻¹⁵), lunar-laser-ranging limits on gravitational shielding, Podkletnov's unreplicated rotating superconductor, the EmDrive traced to thermal artefacts at TU Dresden, "antigravity lifters" identified as ion-wind thrusters that stop working in vacuum, and why negative mass would break causality. Alongside them sits the Nijmegen levitating frog, which is entirely real and not antigravity at all.

## Validation

`npm test` runs 151 tests across 8 suites. Two in-app **✔ Validation** buttons run 18 ballistics cases and 52 levitation cases in the browser, with exactly the shipped code. Highlights:

* **Somigliana normal gravity:** the harmonic normal field agrees with the closed form to **2×10⁻⁹ m/s²**. The published WGS 84 zonals are reproduced to 10⁻⁹.
* **EGM2008:** the geoid shows −106.9 m (Indian Ocean low) and +85.8 m (New Guinea high), as published. The analytic gradient equals the finite-difference gradient.
* **USSA-1976:** layer pressures and densities match the published tables. Interpolation error in the upper atmosphere is under 0.1 %.
* **Closed-form vacuum mechanics:**
  * radial fall time (Kepler) to **10⁻⁹**;
  * ballistic range and time of flight on a Kepler ellipse to **10⁻⁹**;
  * circular-orbit closure to **10⁻¹⁰**;
  * escape velocity.
* **Rotating frame:** the Jacobi integral is conserved over 3 orbits to 5×10⁻¹⁰, shrinking with tolerance. Coriolis eastward deflection matches ⅓Ωgt³cosφ to 0.2 %.
* **Drag:**
  * exact terminal velocity, including the predicted lag from height-dependent g;
  * the v_t·tanh(gt/v_t) solution;
  * the Allen–Eggers entry solution reproduced to 10⁻⁷ under its own assumptions;
  * the exact drag-only line integral on the real-size Earth to 10⁻⁹.
* **Real-world checks:**
  * Gunn–Kinzer raindrop terminal speeds within 1 %;
  * skydiver terminal speed (USPA, about 54 m/s);
  * Red Bull Stratos peak Mach 1.25 (independent of the fitted peak speed);
  * a 100 mph home run carries about 405 ft (Statcast);
  * PGA Tour drive carry of 275 yd (TrackMan);
  * Perseid meteor burn-out height;
  * Apollo 15 hammer and feather;
  * Galileo-probe pressure depth.

### Electromagnetism and levitation

The **✔ Validation** button inside the levitation view runs 52 further cases, split into two tabs: comparisons against closed-form solutions (where a failure is a bug) and against published measurements (where a gap may be a model limitation, and is labelled).

* **Elliptic integrals:** Carlson's symmetric forms and an independent arithmetic–geometric-mean implementation agree to 5×10⁻¹⁵ across the whole range, and both match the published K(0.5) and E(0.5) to 10⁻¹⁴.
* **Fields:** the loop quadrature matches the exact on-axis formula to 10⁻¹³ and the closed-form elliptic solution off-axis to 10⁻¹¹; ∇·**B** = 0 and ∇×**B** = 0 hold to 10⁻⁹ of the field scale; the block-magnet solution returns exactly 2B_r/3 at the centre of a cube (demagnetising factor ⅓) and converges on its own point dipole in the far field; the finite solenoid matches its closed form to 10⁻¹¹.
* **Three paths, one answer:** every source exposes a value, an analytic Jacobian and a hyper-dual evaluation of the same expression, and the tests assert all three agree — so none can silently drift from the others.
* **Theorems, measured:** the trace of the stiffness matrix for a fixed dipole is zero to 10⁻⁹ (Earnshaw), and ∇²(B²) equals 2|∇**B**|² to the same precision (the escape clause). A diamagnet is confirmed stable and a paramagnet unstable at the same field zero.
* **6-DOF:** total energy is conserved to about 10⁻¹⁰ over a multi-second run with damping off, the quaternion stays normalised to 10⁻⁹, and the spin about the symmetry axis is conserved to 10⁻⁸ — as it must be, since **m**×**B** has no component along **m**.
* **Against experiment:** water needs 1360 T²/m (published ≈1400); a graphite flake floats 1.1 mm over a neodymium checkerboard, computed from the real field of 36 cube magnets with no fitted parameters; a frog levitates with the 16 T magnet turned down to about 10 T; the Levitron's spin window comes out 17–42 rev/s against a measured 18–35; acoustic levitation of water needs 159 dB; Millikan's drop balances at 45 kV/m; a 1 kg quadcopter hovers on 78 W; and the Fabry relation reproduces the NHMFL 35 T / 20 MW magnet.

### Known limitations (asserted in the tests, shown in amber in the app)

* **Red Bull Stratos freefall time:** the model gives about 206 s against the actual 259 s. Felix Baumgartner's posture changes (flat spin, then stabilisation) are not modelled; one drag area fitted to the peak speed cannot capture both phases.
* **Golf apex:** the Smits–Smith lift law over-predicts the apex by about 30 %, while the carry distance agrees.
* **Wind:** this is a mean-wind profile; turbulence and gusts are not modelled. The heating model treats the body as a single skin temperature.
* **Gravity resolution:** EGM2008 is truncated at degree 360 (about 55 km resolution). The full degree-2190 model differs by up to a few mGal locally.
* **Other bodies:** the Moon, Mars and Jupiter use flat datum surfaces and zonal gravity only. Their Sun position is fixed for illustration.
* **Levitron spin window:** the adiabatic condition is an inequality with an order-unity constant. That constant is fixed at 3, chosen so the upper bound lands on the measured 35 rev/s. It is the only fitted number in the levitation model, and the validation report says so in the case itself.
* **Anisotropic flakes:** the orientation of a magnetically anisotropic body is modelled at a single point. The exact small-body torque then drives the hard axis across the field, which would stand a graphite flake on edge; real flakes lie flat because a thin plate is held by the field varying across its width. The levitation height and stability are unaffected — only the predicted tilt is.
* **Optical trap stiffness:** the Rayleigh (point-dipole) formula over-predicts for a bead comparable to the wavelength, typically by two to five times. A Mie treatment would be needed to do better.
* **Superconductor height:** the image-dipole model treats the superconductor as an ideal plane of finite radius. Real pucks float somewhat lower, because flux that penetrates is flux that does not repel.
* **Conductors very close to a winding:** the loop quadrature reaches double precision down to about 1 % of a coil radius from the conductor, and degrades inside that.

## Using it

1. **Pick a site.** Click the globe, search a city (offline list, nothing leaves your browser), type lat/lon, or choose a landmark (Everest, Burj Khalifa, Mariana Trench, Red Bull Stratos, Apollo 15, Olympus Mons, Galileo probe…).
2. **Pick an experiment.** Drop from a height (1 cm to 2000 km), or throw at any speed, elevation and azimuth. In the 3-D view you can also drag the arrow handle to aim, with a live predicted arc.
3. **Pick an object.** Choose from 21 presets with regulation masses and sizes, or build a custom object (shape, size, mass, material, optional fixed Cd).
4. **Set up the environment.** Toggle air or vacuum, Earth rotation and the ocean; set weather, wind and time of day.
5. **Press Simulate.** You get the 3-D replay with chase, side, ground and top cameras, a live telemetry HUD, charts (height, speed, g-load, Mach and dynamic pressure, Cd/Re/Kn, heating, trajectory profile), and an impact summary that includes the vacuum comparison and the isolated Coriolis deflection.
6. **Compare** up to 4 setups side by side.
7. **∑ Equations** shows every equation with live, step-by-step numbers at the current playback time.

Globe overlays: EGM2008 gravity anomaly, surface |g| and geoid height, plus the exaggerated geoid "gravity potato".

### In the levitation view

1. **Pick a mode.** Eleven of them, grouped by whether they can work at all. Each says in one line what it breaks to get around Earnshaw's theorem.
2. **Pick an apparatus.** Fifteen, from a checkerboard of half-inch magnets to a Nijmegen-class solenoid, a Halbach track, an acoustic cell and an optical trap. Every parameter is live: change the cube size and the field, the gap and the verdict all follow.
3. **Pick an object.** Twenty-one presets — a graphite flake, a frog, a YBCO puck, a Levitron top, a Millikan oil drop, a person — or build your own from the material library.
4. **Read the verdict.** Whether it levitates, at what height, how stiff the trap is in each direction, and what tier of hardware it would take. **Full report** gives the requirements, what the apparatus delivers, and the reasoning; **Build sheet** sizes the magnet.
5. **Release it.** A six-degree-of-freedom run with the object's real inertia, played back on the timeline with charts for height, tilt, spin, field and energy conservation. Try a Levitron at 10 rev/s and watch it topple, then at 28 and watch it hold.
6. **Switch to the energy surface** to see the shape of the problem: a basin for a diamagnet, a mountain pass for a magnet over a magnet, with the escape direction drawn on it.
7. **🚫 Antigravity claims** collects the impossibility argument and the measurements that settle each famous claim.

## Layout

```
src/physics/      gravity, geodesy, atmosphere, aerodynamics, integrator, simulation (no DOM, fully tested)
src/physics/em/   hyper-dual arithmetic, elliptic integrals, field sources, materials,
                  levitation modes, apparatus, magnet engineering, 6-DOF dynamics, claims
src/worker/       simulation runs in Web Workers
src/render/       three.js globe, local 3-D world, terrain tiles, object models
src/ui/           panel, HUD, charts (uPlot), equations (KaTeX), validation report
src/validation/   in-app validation cases (ballistics and electromagnetism)
scripts/          data pipelines (EGM2008, grids, atmosphere tables, textures, places) and a headless smoke test
tests/            vitest suites
```

Smoke test with screenshots (needs a local Chrome or Edge and a running dev server):

```
CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/shot.mjs http://localhost:5173/ shots "click=SIMULATE" wait=20000 shot=run
```
