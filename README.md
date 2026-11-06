# DUCT

A mobile-first web app for HVAC ductwork sizing. Enter an airflow, pick the
space the duct serves and the system it belongs to, and it sizes the duct,
checks it against the velocity limits, and totals the branch pressure drop as
you type.

No build step, no dependencies, works offline once loaded.

```
npm start      # serves on http://localhost:8080
npm test       # engine, start-up order and service-worker tests
```

Open `http://localhost:8080` on a phone (or use the browser's device toolbar).
On iOS/Android, "Add to Home Screen" installs it as a standalone app. Live at
https://joegordon1175.github.io/DUCT/.

### Releasing

**Bump `CACHE_VERSION` in `sw.js` whenever you change a shipped file** —
`index.html`, anything in `css/` or `js/`, or the manifest. That is what tells
an installed copy to update. `npm test` fails if you forget, comparing the
working tree against `origin/main`.

The reasoning behind every figure and every change is recorded in
`docs/CALCULATION-REVIEW.md`; its opening section is the current design basis
at a glance.

---

## How it sizes

**One rule for every duct: constant friction.** The duct is the smallest size
on your list whose friction rate is at or below the project target (default
**1.0 Pa/m**, set in Settings). Velocity limits are then applied on top:

- **A maximum, from the space the duct serves** — noise is the only thing
  driving it. If the friction-sized duct would be too fast, it is enlarged.
- **A minimum, from the system** — only on transport systems (grease, dust).
  On a small flow it **overrides** the friction target, bringing the duct back
  down a size so the air keeps moving; the app reports that as intended (an
  info line), not as a failure.
- **Flexible duct** is the exception: it sizes on velocity with its own
  friction ceiling — see below.

Sizing never leaves your size list. If no listed size satisfies the rule, the
nearest is shown and flagged — the fix is to add sizes in Settings, not to
invent a duct nobody stocks. Where a velocity band holds no listed size at all,
the size that misses by the smaller ratio is taken.

### Space served — sets the maximum

| Space served | Noise band | Main | Branch | Runout (m/s) |
|---|---|---|---|---|
| Bedroom / hotel room | NR 25 | 5.0 | 4.0 | 2.5 |
| Living room / study | NR 30 | 6.0 | 5.0 | 3.0 |
| Private office / meeting / classroom | NR 35 | 7.5 | 6.0 | 4.0 |
| Restaurant / café / bar | NR 35–40 | 7.5 | 6.0 | 4.0 |
| Open-plan office | NR 38 | 8.0 | 7.0 | 4.5 |
| Retail / circulation | NR 40 | 8.0 | 7.0 | 5.0 |
| Toilet / back-of-house / riser / plant | NR 45+ | 10.0 | 8.0 | 6.0 |
| Workshop / factory / process | NR 50+ | 10.0 | 8.0 | 6.0 |
| Car park / loading dock | NR 55+ | 10.0 | 8.0 | 6.0 |
| Commercial kitchen | NR 45+ | 10.0 | 8.0 | 8.0 |

Reconciled against AIRAH Skills Workshop sw123 Table 1 and ASHRAE *HVAC
Applications* 2023 Ch 49 Table 8, both read from the primary documents. AIRAH
frames its table as **absolute maxima** and caps the riser column at 10 m/s at
every NR, which is why the bottom rows plateau. CIBSE (Guide B2 is paywalled)
is a cross-check from reproductions only. Each value is editable per space and
role in Settings; the app shades a reading amber within 10 % of its limit.

One figure covers round and rectangular. ASHRAE allows round duct more for
breakout noise, but the ratio isn't constant (≈1.4–1.95 across its table) and
breakout is only one of the noise paths the limit stands in for.

Commercial kitchen is deliberately outside the NR scale: the canopy fans and
appliances dominate, and a grease duct leaving the kitchen needs its own
acoustic assessment whatever this app says.

### System — sets the minimum, if any

| System | Velocity band | Notes |
|---|---|---|
| Air conditioning / ventilation | Space maximum only | Comfort A/C, fresh air, general and toilet extract all size identically, so they are one system. No minimum: constant friction already picks the smallest duct that holds the target. |
| Kitchen grease extract | **5–9 m/s** at design flow | DW/172 extract mains 6–9; 5 at the lower bound of its branch range. Calculated at **35 °C design air (≈1.15 kg/m³)** unless the entered air temperature is hotter. Rectangular held to 2:1. No flexible duct (not normally fire-code permitted). |
| Dust / fume extract (LEV) | ACGIH transport minimum by material, max 25 m/s | The floor governs everywhere and **overrides the space's acoustic limit** — silting is the worse failure — and the app says the duct will be loud. Own circular size list (EN 1506 series). Rectangular held to 2:1; no flexible duct. |

**Grease extract**, 1.0 Pa/m target, kitchen main:

| Duty | Selection | m/s | Pa/m | |
|---|---|---|---|---|
| 100 l/s | Ø150 | 5.7 | 2.78 | floor overrides target |
| 200 l/s | Ø200 | 6.4 | 2.42 | floor overrides target |
| 500 l/s | Ø350 | 5.2 | 0.84 | target governs |
| 2,500 l/s | Ø700 | 6.5 | 0.55 | target governs |
| 6,000 l/s | Ø1000 | 7.6 | 0.48 | target governs |

The 5 m/s floor is not a grease-suspension figure — that idea is pre-2002.
ASHRAE RP-1033 showed deposition *increases* with velocity, and NFPA 96 cut its
minimum to 500 fpm by Errata 96-01-01. AS 1668.2-2002 sets no in-duct velocity —
only hood face (Type A capture 0.5 m/s, dishwasher 0.3 m/s) and discharge
(≥5 m/s vertical, cl. 5.10.3). **The one figure with code force is 2.54 m/s
(500 fpm) at minimum turndown** (NFPA 96 / IMC 506.3.4): enter a turndown
percentage in Settings for a VSD or DCKV system and the app checks there.

Grease fan duty: duct friction + fittings + dirty baffle filters (supplier data,
typically 100–150 Pa) + hood entry + discharge, plus margin. The fittings library
carries a dirty baffle filter and a canopy hood entry.

Not modelled (recorded in `js/data.js` for reference): discharge velocity, hood
spigot velocity 5–7 m/s, and installation rules — fall to hood, access at each
change of direction, no fire dampers, liquid-tight welded joints.

**Dust transport minimums** (lower bound of each ACGIH range, read through
secondary sources — check against the ACGIH manual before specifying):

| Material class | Minimum m/s | Examples |
|---|---|---|
| Fumes & very fine | 10.0 | welding fume, zinc and aluminium oxide |
| Very fine light dust | 12.5 | cotton lint, wood flour |
| Dry dusts & powders | 15.0 | rubber dust, moulding powder, leather shavings |
| Average industrial dust | 17.5 | sawdust, grinding dust, silica flour |
| Heavy dusts | 20.0 | wet sawdust, metal turnings, shot blast |
| Heavy or moist | 22.5 | moist cement, quicklime, sticky buffing lint |

A space whose maximum sits below a system's floor (a grease duct through a
bedroom) is flagged naming the two settings that conflict; for dust the
transport minimum wins by design.

### Flexible duct

- **Sized on velocity**: 3.5 m/s (AIRAH sw022), or the space's runout limit if
  lower. Holding compressed flex to the 1 Pa/m project target oversized it.
- **Friction ceiling 4 Pa/m** on the compressed rate (Settings) as a backstop:
  it steps small compressed flex up a size. At Typical 15 %, Ø150 carries up to
  ~42 l/s and Ø200 up to ~99 l/s.
- **Compression**: ASHRAE Fundamentals Eq. 22,
  `PDCF = 1 + 58·rc·e^(−0.00496·D)` (D in mm, valid 150–400, held outside), on a
  stretched roughness of ε 0.9 mm (non-metallic / insulated; metallic 1.2 mm).
  Two conditions: **Typical 15 %** (default, design basis) and **Tight 4 %**
  (only where specified fully extended and checked on site).

  | Ø | Tight 4 % | Typical 15 % |
  |---|---|---|
  | 150 | ×2.1 | ×5.1 |
  | 250 | ×1.7 | ×3.5 |
  | 400 | ×1.3 | ×2.2 |

- Standard sizes Ø150–550 in 50 mm steps; Ø550 holds ~830 l/s at 3.5 m/s.
- Locked to the runout role. Runs over 3 m are flagged.

Eq. 22 was read from secondary reproductions of the Handbook and agrees with
LBNL-49012's measured fits within ~7 %; Culp's data scatter ±20–30 %. It covers
straight duct only — carry bends as fittings.

---

## Inputs

**Design basis** (whole run): space served, system, snap to standard sizes.
The dust material class is chosen in Settings.

**Per segment** — add as many as the run needs:

| Input | Notes |
|---|---|
| Airflow | l/s, ±25 steppers. Shown in m³/h and m³/s alongside. |
| Duct role | Main / riser, branch or runout — sets which of the space's limits applies. Flexible is locked to runout. |
| Duct type | Circular, rectangular or flexible (flexible not offered on grease or dust). |
| Material | Sets absolute roughness ε; filtered to the duct type. |
| Installed condition | Flexible only: Typical 15 % or Tight 4 %. |
| Height / Ø override | Pins the rectangular height or the diameter. Blank = auto. |
| Width override | Rectangular only. Height given → width solved; width given → height solved; both → evaluated as entered. |
| Straight length | m. |
| Fittings | Library of 44 with editable ζ, plus quantity. |
| Extra fixed loss | Pa, for anything not in the library. |

**Settings**: friction target; flexible friction ceiling; maximum velocity per
space and role; grease band and turndown check; dust material; air temperature
and altitude (density and viscosity); standard size lists for circular,
rectangular, flexible and dust duct (invalid or emptied lists fall back to the
defaults); maximum aspect ratio; maximum duct depth for a ceiling void.

**System allowances**: plant/AHU pressure, fan selection margin, DW/144 leakage
class.

## Outputs

Sticky footer: index duct size, max velocity, Pa/m, total Pa.

Per segment: size, velocity, friction rate, segment loss, velocity pressure,
straight and fittings loss, Reynolds number, friction factor, equivalent
diameter and aspect ratio (rectangular) or volume per metre and free area
(round), fittings equivalent length and surface area. The CSV adds the
equivalent-round Reynolds number the friction factor is taken at.

For the run: total branch pressure, fan duty with margin, max and min velocity,
run length, duct surface area, DW/144 class, leakage in l/s and % of duty, air
density.

Flags: velocity over the limit (amber within 10 %), under a transport minimum,
turndown below 2.54 m/s, friction over target (or over the flex ceiling), floor
overriding the target (info), aspect ratio over the limit, a void too shallow,
flex over 3 m or below the Ø150 tested range, a duty your size list can't
serve, DW/144 class above A, and the extract-side class B/C ambiguity.

Export as CSV, or copy a plain-text summary.

---

## Calculation engine

`js/engine.js` is pure and DOM-free, covered by `test/engine.test.mjs` with
checks against published reference values. Independently re-implemented
(Python) for the 07/11/2026 review and matched to 0.000 %.

- **Air** — ISA barometric pressure from altitude, ideal-gas density,
  Sutherland viscosity. 20 °C at sea level: ρ 1.204 kg/m³.
- **Straight duct** — Darcy–Weisbach `Δp/L = f·ρv²/2D`, `f` from Colebrook–
  White iterated to convergence; laminar `64/Re` below Re 2300, blended to
  4000. Ø400 galvanised at 1000 l/s: 1.63 Pa/m, matching the ASHRAE chart.
- **Rectangular** — ASHRAE equivalent diameter `De = 1.30(ab)^0.625/(a+b)^0.25`
  for friction; velocity and velocity pressure from the actual face area. A
  velocity limit is applied as an area limit, not a De limit.
- **Fittings** — `Δp = ζ·ρv²/2` at segment velocity; fixed-Pa items as entered.
  Equivalent length is reported for ζ fittings only.
- **Leakage** — `q = k·p^0.65` per m² (DW/144 / EN 12237: A 0.027, B 0.009,
  C 0.003, D 0.001) at the mean duct pressure (ductwork loss ÷ 2), plant
  excluded.
- **DW/144 class** — on the fan total (plant included) and max velocity: the duct
  must be built for the worst case. Over-specifying sheet metal is cheap.
- **Noise is not calculated.** An earlier regenerated-noise estimate was removed:
  without terminal sound-power data and duct attenuation it could not be made
  trustworthy. The velocity limits are the noise control, as in CIBSE and
  ASHRAE. Use manufacturers' data and an attenuation calculation for a real
  acoustic assessment.

Roughness values follow the ASHRAE Fundamentals table; loss coefficients are
typical published values. They are defaults for a first pass, not a project
specification.

---

## Files

```
index.html               app shell
css/app.css              styling, dark and light
js/engine.js             calculation engine (pure, tested)
js/data.js               sizes, materials, spaces, systems, limits, fittings
js/app.js                UI, state, migration of old saves, export
sw.js                    offline cache
test/engine.test.mjs     engine and data tests
test/app-order.test.mjs  start-up declaration order guard
test/sw.test.mjs         cache-version bump guard
docs/CALCULATION-REVIEW.md  design basis and decision record
```

## Saving calculations

The calculation in progress is written to `localStorage` as you work. The folder
icon opens **Saved calculations**, where you can name, reopen or delete one.

**What's on the main page is part of the calculation; what's in Settings is a
global preference.** A save holds airflows, segments, space, system and
allowances; opening it never touches your size lists, velocity limits or air
conditions. So a saved calculation is **not a frozen record** — change a limit
and an old job recalculates. Export the CSV for a fixed record.

Saves stay in that browser on that device. Older saves are migrated on load
(retired spaces, systems, flex conditions and default lists map to their
current equivalents; anything you edited is kept).
