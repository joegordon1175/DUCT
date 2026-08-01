# DUCT

A mobile-first web app for HVAC ductwork sizing selections. Enter an airflow,
pick the duct type and space type, and it sizes the duct, checks it against
velocity and noise limits, and totals the branch pressure drop as you type.

No build step, no dependencies, works offline once loaded.

```
npm start      # serves on http://localhost:8080
npm test       # runs the calculation engine test suite
```

Open `http://localhost:8080` on a phone (or use the browser's device toolbar).
On iOS/Android, "Add to Home Screen" installs it as a standalone app.

---

## Inputs

**Design basis** — applies to the whole run

| Input | Notes |
|---|---|
| Space type | Residential / Commercial / Industrial. Sets the friction target, the velocity limits and the noise criterion. |
| Size on | Constant friction (Pa/m) or constant velocity (m/s). |
| Target | Pre-filled from the space type, editable. |
| Snap to standard sizes | On by default; off gives the exact calculated size. |

**Per segment** — add as many as the run needs

| Input | Notes |
|---|---|
| Airflow | l/s, with ±25 steppers. Shown alongside in m³/h and m³/s. |
| Duct role | Main / riser, branch, or runout — each has its own velocity limits. |
| Duct type | Circular, rectangular or flexible. |
| Material | Sets absolute roughness ε. Options are filtered to the duct type. |
| Installed condition | Flexible duct only: fully extended, 15 % or 30 % compressed. |
| Height / Ø override | Drives rectangular height, or the circular/flex diameter. Blank = auto. |
| Width override | Rectangular only. Blank = solved from the height and the friction target. |
| Straight length | m. |
| Fittings | Searchable library of ~45 fittings with editable ζ, plus quantity steppers. |
| Extra fixed loss | Pa, for anything not in the library. |

**Settings** — air temperature and altitude (drives density and viscosity),
maximum aspect ratio, maximum duct height for a ceiling void, and the
duct-to-room acoustic correction.

**System allowances** — plant/AHU pressure, fan selection margin, and the
DW/144 leakage class.

### How the overrides interact

- **Circular / flexible** — one size to determine. Blank sizes automatically;
  a value pins the diameter so you can check a size you already have.
- **Rectangular** — enter the height to suit the void and the width is solved
  for the friction target; enter the width and the height is solved; enter
  both and the size is fixed and simply evaluated.
- The velocity limit for the space type and duct role always applies on top of
  the friction target. If the target friction would give a duct that runs too
  fast, the app enlarges it until the velocity is within limits.

## Outputs

Live in the sticky footer: duct size, velocity, Pa/m, total Pa, room dBA.

Per segment: duct size, velocity, friction rate (Pa/m), velocity pressure,
straight loss, fittings loss, segment total, regenerated noise (dBA), Reynolds
number, friction factor, equivalent/hydraulic diameter, aspect ratio, free
area, equivalent length and duct surface area.

For the run: total branch pressure drop, fan duty with margin, max velocity,
sound power and estimated room level, run length, duct surface area, DW/144
pressure class, and estimated leakage in l/s and as a percentage of duty.

Colour-coded flags call out velocities over the limit, excessive aspect
ratios, flexible runs beyond 3 m, and noise above the space's criterion.

Export as CSV, or copy a plain-text summary for an email or a report.

---

## Calculation engine

`js/engine.js` is pure and DOM-free; `test/engine.test.mjs` covers it with 40
tests, including checks against published reference values.

**Air properties.** Barometric pressure from the ISA troposphere model,
density from the ideal gas law, dynamic viscosity from Sutherland's formula.
Temperature and altitude both feed the pressure drop.

**Straight duct.** Darcy–Weisbach, `Δp/L = f · ρv² / 2D`, with the friction
factor `f` from Colebrook–White iterated to convergence — not a curve fit.
Laminar flow uses `64/Re`, and the critical zone between Re 2300 and 4000 is
blended so results stay continuous. Verified against Moody chart values.

**Rectangular duct.** Sized on the ASHRAE circular equivalent diameter,

```
De = 1.30 (a·b)^0.625 / (a+b)^0.25
```

on an equal-friction, equal-flow basis — the friction rate is that of the
equivalent round duct. Velocity, velocity pressure and noise use the *actual*
face area, because that is what the air in the duct is really doing. Verified
against the ASHRAE equivalent-diameter table.

**Fittings.** Velocity-pressure method, `Δp = ζ · ρv²/2`, with ζ referred to
the segment velocity. Fixed-loss items (grilles, silencers, filters, coils)
take a pressure in Pa instead. Every value is editable — replace them with
manufacturers' data when you have it.

**Flexible duct.** Higher roughness plus an installation factor: fully
extended ×1.0, 15 % compressed ×2.0, 30 % compressed ×4.0.

**Noise.** An indicative A-weighted regenerated sound power per element,

```
L_wA = 10 + 50 log₁₀(v) + 10 log₁₀(A) + 10 log₁₀(ζ)
```

The v⁵·A form is the long-standing CIBSE/Woods rule of thumb for airflow noise
in ductwork; the ζ term scales it with the disturbance the element causes, so a
mitred bend reads about 9 dB above a smooth radius bend. Elements are summed
logarithmically, and the room level is the sound power less a single
duct-to-room correction (9 dB by default).

This is deliberately a comparison tool — it tells you whether a selection is
quiet enough to be plausible and which fitting is the noisy one. It is **not**
an octave-band acoustic calculation and does not replace manufacturers' data
or a specialist assessment for a noise-critical space.

**Leakage and pressure class.** DW/144 construction class from operating
pressure and velocity, with leakage `q = k · p^0.65` per m² of duct surface
(class A 0.027, B 0.009, C 0.003, D 0.001).

### Reference data

Velocity limits follow CIBSE Guide B3 / ASHRAE recommended maxima for
noise-sensitive design, roughness values follow the ASHRAE Fundamentals duct
roughness table, and loss coefficients are typical published values. They are
sensible defaults for a first pass, not a project specification — check them
against the job's spec before issuing anything.

---

## Files

```
index.html            app shell
css/app.css           styling, dark and light
js/engine.js          calculation engine (pure, tested)
js/data.js            sizes, materials, limits, fittings library
js/app.js             UI, state and export
sw.js                 offline cache
test/engine.test.mjs  engine tests
```

State is saved to `localStorage` as you work, so closing the tab does not lose
the calculation.
