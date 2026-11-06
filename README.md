# DUCT

A mobile-first web app for HVAC ductwork sizing selections. Enter an airflow,
pick the duct type and space type, and it sizes the duct, checks it against
the velocity limits for that space and duct role, and totals the branch
pressure drop as you type.

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
| Space type | Residential / Commercial / Kitchen Extract. Each has a **fixed** sizing method — see below — plus its own velocity limits per duct role. |
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
aspect ratio, and maximum duct height for a ceiling void.

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

Live in the sticky footer: duct size, velocity, Pa/m, total Pa.

Per segment: duct size, velocity, friction rate (Pa/m), velocity pressure,
straight loss, fittings loss, segment total, Reynolds number, friction factor,
equivalent/hydraulic diameter, aspect ratio, free area, the fittings'
equivalent length and duct surface area.

For the run: total branch pressure drop, fan duty with margin, the velocity
that matters for the sizing mode in play (max for friction-sized runs, min for
velocity-sized ones — see below) and the other end of the range alongside it,
run length, duct surface area, DW/144 pressure class, and estimated leakage in
l/s and as a percentage of duty.

Colour-coded flags call out velocities outside the limit (over the max in
both modes; under the minimum too in velocity mode, since that's the failure
that lets grease settle out), a friction rate above the target, excessive
aspect ratios, flexible runs beyond 3 m, and any duty your size list cannot
serve.

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
equivalent round duct. Velocity and velocity pressure use the *actual* face
area, because that is what the air in the duct is really doing. Verified
against the ASHRAE equivalent-diameter table.

Two Reynolds numbers fall out of that and the app reports both rather than
conflating them: the duct's own (hydraulic diameter, actual velocity) and the
one the friction factor is taken at (equivalent diameter, equivalent
velocity). They differ by about 20 % on a 600 × 400, which changes `f`
negligibly — both are fully turbulent — but a figure labelled "Reynolds
number" should be the duct's.

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
the two bounds, the app takes whichever misses by less as a ratio — a fixed
priority gets this wrong in both directions, since holding the cap on a coarse
list can mean nearly doubling the diameter while holding the minimum can mean
running at three times the intended velocity.

**Sizing never leaves your size list.** If no listed size can meet the rule —
a kitchen duty below the smallest size you stock, or a duty past the largest —
the nearest listed size is shown and flagged, rather than an unlisted one
being invented. On the shipped round list Ø150 only reaches 7.5 m/s at 133 l/s,
so a small canopy below that is flagged; add a smaller size in Settings if your
supplier holds one.

**Fittings.** Velocity-pressure method, `Δp = ζ · ρv²/2`, with ζ referred to
the segment velocity. Fixed-loss items (grilles, silencers, filters, coils)
take a pressure in Pa instead. Every value is editable — replace them with
manufacturers' data when you have it.

**Flexible duct.** Higher roughness plus an installation factor: fully
extended ×1.0, 15 % compressed ×2.0, 30 % compressed ×4.0.

**Noise — deliberately not calculated.** There was an indicative A-weighted
regenerated-noise estimate here. It was removed rather than improved, because
it could not be made trustworthy without octave-band data the app does not
have:

- Every fixed-pressure item scored zero, so grilles, diffusers, silencers,
  filters and coils contributed nothing — and the terminal is normally the
  loudest thing in the room.
- There was no duct attenuation, and generated noise did not scale with
  length, so upstream sound power was summed into the room level undiminished.
- Those two errors run in opposite directions and cannot be netted off.
- The residential check could not fire at any permitted velocity: 30 dBA room
  SPL needed 5.8–8.5 m/s depending on size, against a 5.0 m/s cap.

The velocity limits are the noise control, which is how CIBSE Guide B3 and
ASHRAE present them anyway. For a real acoustic assessment, use manufacturers'
sound-power data for the terminals and a proper attenuation calculation.

**Leakage and pressure class.** Leakage is `q = k · p^0.65` per m² of duct
surface (class A 0.027, B 0.009, C 0.003, D 0.001), taken at the mean pressure
**inside the ductwork**. The plant allowance is excluded — a coil, filter or
grease-filter bank is not duct static pressure, and folding it in overstated
leakage by up to 5×.

The DW/144 construction class does use the fan total, because the app cannot
know whether the plant allowance sits upstream or downstream of the duct and
the duct must be built for the worst case. The inconsistency with leakage is
deliberate: over-specifying sheet metal is cheap, overstating a leakage figure
you might report is not.

**Equivalent length** is reported for velocity-pressure fittings only. A
fixed-Pa component has no equivalent length — folding a dirty filter in read
as 260 m of extra duct.

### Reference data

Friction-mode velocity limits follow CIBSE Guide B3 / ASHRAE recommended
maxima for noise-sensitive design, and they are the app's only noise control;
velocity-mode (Kitchen Extract) minimum
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

## Saving calculations

The calculation in progress is written to `localStorage` as you work, so closing
the tab doesn't lose it. The folder icon in the header opens **Saved
calculations**, where you can name and keep the current one, reopen an earlier
one, or delete it.

What a save contains follows one rule: **what's on the main page is part of the
calculation; what's in Settings is a global preference.** So a save holds the
airflows, duct segments, space type and system allowances — and opening it never
touches your duct size lists, velocity targets or air conditions, which describe
your supplier and your standards rather than one job.

The trade-off that buys is worth knowing: a saved calculation is **not a frozen
record**. Change a velocity target and an old job reopened will recalculate
against the new one. Export the CSV if you need a fixed record of what was
issued.

Saves live in that browser on that device only — they aren't synced, and clearing
site data removes them.
