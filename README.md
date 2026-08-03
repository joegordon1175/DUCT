# DUCT

A mobile-first web app for HVAC ductwork sizing selections. Enter an airflow,
pick the duct type and space type, and it sizes the duct, checks it against
velocity and noise limits, and totals the branch pressure drop as you type.

No build step, no dependencies, works offline once loaded.

```
npm start      # serves on http://localhost:8080
npm test       # runs the calculation engine + service worker test suite
```

Open `http://localhost:8080` on a phone (or use the browser's device toolbar).
On iOS/Android, "Add to Home Screen" installs it as a standalone app.

### Releasing

**Bump `CACHE_VERSION` in `sw.js` whenever you change a shipped file** —
`index.html`, anything in `css/` or `js/`, or the manifest. That is what tells
an already-installed copy to update: changing `sw.js` produces a new service
worker, which triggers the one-shot reload wired up in `app.js`. Skip it and a
device that already has the app can keep showing the old version.

`npm test` fails if you forget, comparing the working tree against
`origin/main`, so this isn't left to memory.

---

## Inputs

**Design basis** — applies to the whole run

| Input | Notes |
|---|---|
| Space type | Residential / Commercial / Kitchen Extract. Each has a **fixed** sizing method — see below — plus its own noise criterion. |
| Snap to standard sizes | On by default; off gives the exact calculated size. |

The sizing method and its target aren't editable here — they're read-only,
shown right under the space-type picker, so they can't be changed by accident
mid-job. Fine-tune the actual numbers in Settings.

| Space type | Sizing method | Why |
|---|---|---|
| Residential, Commercial | Constant friction rate (Pa/m) | Standard comfort-ventilation design; velocity is checked afterwards against a recommended/max range, not sized to. |
| Kitchen Extract (commercial kitchens & canopies) | Constant velocity, as a **minimum** (m/s) | Air moving slower than the minimum lets grease settle out and foul the duct — a fire risk. Standard duct sizes snap *down* toward the minimum instead of up, since rounding up would silently drop the velocity below it. |

**Per segment** — add as many as the run needs

| Input | Notes |
|---|---|
| Airflow | l/s, with ±25 steppers. Shown alongside in m³/h and m³/s. |
| Duct role | Main / riser, branch, or runout — each has its own velocity target/limit (fine-tuned in Settings). Hidden for flexible duct, which always uses its own dedicated limits regardless of role. |
| Duct type | Circular, rectangular or flexible. Flexible isn't offered under Kitchen Extract — it's not normally fire-code permitted for grease extract (e.g. NFPA 96/DW/172); switching a run to Kitchen Extract converts any existing flexible segments to circular. |
| Material | Sets absolute roughness ε. Options are filtered to the duct type. |
| Installed condition | Flexible duct only: fully extended, 15 % or 30 % compressed. |
| Height / Ø override | Drives rectangular height, or the circular/flex diameter. Blank = auto. |
| Width override | Rectangular only. Blank = solved from the height and the sizing target. |
| Straight length | m. |
| Fittings | Searchable library of ~45 fittings with editable ζ, plus quantity steppers. |
| Extra fixed loss | Pa, for anything not in the library. |

**Settings** — sizing targets per space type (friction target for
Residential/Commercial; recommended/max velocity by duct role — main, branch,
runout, and a separate set for flexible duct — for all three space types,
editable and resettable independently of which space type is active on the
main page), air temperature and altitude (drives density and viscosity),
standard duct size lists for circular, rectangular and flexible duct (edit
these to match what your supplier actually stocks — invalid or emptied lists
fall back to the shipped defaults so a typo can't break sizing), maximum
aspect ratio, maximum duct height for a ceiling void, and the duct-to-room
acoustic correction.

**System allowances** — plant/AHU pressure, fan selection margin, and the
DW/144 leakage class.

### How the overrides interact

- **Circular / flexible** — one size to determine. Blank sizes automatically;
  a value pins the diameter so you can check a size you already have.
- **Rectangular** — enter the height to suit the void and the width is solved
  for the sizing target; enter the width and the height is solved; enter both
  and the size is fixed and simply evaluated.
- The velocity limit for the space type and duct role always applies on top of
  the sizing target. In friction mode, if the target friction would give a
  duct that runs too fast, the app enlarges it until the velocity is within
  limits. In velocity mode the target *is* a velocity, so this constraint is
  built in rather than layered on top — see the sizing-method table above.

## Outputs

Live in the sticky footer: duct size, velocity, Pa/m, total Pa, room dBA.

Per segment: duct size, velocity, friction rate (Pa/m), velocity pressure,
straight loss, fittings loss, segment total, regenerated noise (dBA), Reynolds
number, friction factor, equivalent/hydraulic diameter, aspect ratio, free
area, equivalent length and duct surface area.

For the run: total branch pressure drop, fan duty with margin, the velocity
that matters for the sizing mode in play (max for friction-sized runs, min for
velocity-sized ones — see below), sound power and estimated room level, run
length, duct surface area, DW/144 pressure class, and estimated leakage in
l/s and as a percentage of duty.

Colour-coded flags call out velocities outside the limit (over the max in
both modes; under the minimum too in velocity mode, since that's the failure
that lets grease settle out), excessive aspect ratios, flexible runs beyond
3 m, and noise above the space's criterion.

Export as CSV, or copy a plain-text summary for an email or a report.

---

## Calculation engine

`js/engine.js` is pure and DOM-free; `test/engine.test.mjs` covers it with 48
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

**Two sizing modes.** Friction-mode spaces (Residential, Commercial) size to
a constant friction rate; velocity is only ever checked afterwards, so
standard duct sizes snap *up* — always safe, since a bigger duct only ever
lowers both the friction rate and the velocity further from their targets.
Velocity-mode spaces (Kitchen Extract — commercial kitchens & canopies) size
to a target velocity that's a **minimum**, not a ceiling, so the same snap-up
rule would be wrong: rounding up to the next standard size lowers the
velocity, which is exactly the direction that lets grease settle out and
foul the duct.
Standard sizes snap *down* instead (`snapDown`/`snapFloor` in engine.js),
landing on the largest standard size that still meets the minimum, while a
second bound (the diameter at the *maximum* velocity) stops it snapping down
so far that the max is exceeded instead. Where no standard size fits between
the two bounds, respecting the maximum takes priority over holding the
minimum, since exceeding it risks duct erosion.

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

Friction-mode velocity limits follow CIBSE Guide B3 / ASHRAE recommended
maxima for noise-sensitive design; velocity-mode (Kitchen Extract) minimum
transport velocities are indicative defaults pending confirmation against
DW/172 for the specific kitchen and canopy design. Roughness values follow
the ASHRAE Fundamentals duct roughness table, and loss coefficients are
typical published values.
They are sensible defaults for a first pass, not a project specification —
check them against the job's spec before issuing anything, and use Settings
to fine-tune any of them per space type and duct role.

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
