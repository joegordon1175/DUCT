# DUCT

A mobile-first web app for HVAC ductwork sizing selections. Enter an airflow,
pick the duct type and space type, and it sizes the duct, checks it against
the velocity limit for the space it serves, and totals the branch pressure
drop as you type.

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
| Space served | Sets the **maximum** velocity. Six acoustic bands from bedroom (NR 25) to riser/plant (NR 45+). |
| System | Sets the **sizing method**. Air conditioning / ventilation, or kitchen grease extract. |
| Snap to standard sizes | On by default; off gives the exact calculated size. |

These are two settings because two different physical causes are at work, and
keeping them apart is what lets the app express things the old
Residential/Commercial split could not.

**Space served sets the maximum**, because noise is the only thing driving the
upper band — and the noise requirement belongs to the space, not the building.
A hotel bedroom and a house bedroom want the same figure; an open-plan office
and a classroom want the same; a riser is a riser in both. Sorting by building
type was a label doing a job that belongs to the space, which is why it kept
mis-fitting: it put a boardroom and a car park in the same bucket.

| Space served | Noise band | Main | Branch | Runout |
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
Applications* 2023 Ch 49 Table 8, both read from the primary documents. AIRAH's
table is framed as **absolute maxima** and caps the riser column at 10.0 m/s at
every NR, which is what sets the bottom two rows. CIBSE remains secondary —
Guide B2 is paywalled — so its values are cross-checks, not authority. The full
working, including what changed and why, is in `docs/CALCULATION-REVIEW.md` §11.

**Flexible duct is sized on velocity, not friction**: 3.5 m/s (AIRAH sw022,
"reasonable present-day practice"), or the space's runout limit if that is
lower. Flex runouts are short, so a high Pa/m costs little in absolute terms,
and holding compressed flex to 1 Pa/m oversized it badly. An **8 Pa/m friction
ceiling** on the compressed rate (Settings) is the backstop: it upsizes small,
long or crushed flex where velocity alone would leave a real pressure penalty —
e.g. 60 l/s at 15 % goes Ø150 → Ø200.
Standard flex sizes are Ø150–550 in 50 mm steps (editable in Settings); the
largest holds about 830 l/s at 3.5 m/s.

Above NR 45 the published limits plateau — AIRAH caps the riser column at
10 m/s at every NR — so back of house, workshop and car park share figures. They
are separate rows so the space is named correctly and can be tuned on its own.
**Workshop / factory / process** is where dust extract lives, as Commercial
kitchen is where grease extract lives; pick either system on a different space
and the hint says where it usually runs, without switching it for you.

Commercial kitchen sits outside that scale deliberately. The duct runs in a space
where the canopy fans and the appliances already dominate, so the duct isn't what
anyone hears — and its runout doesn't follow the "half the main" rule the others
use, because that rule is about a runout feeding a terminal in an occupied room.
A grease duct leaving the kitchen needs its own acoustic assessment whatever this
app says, so there's no attempt to model that.

One number per role, not a recommended/maximum pair: there is a single acoustic
limit, and the app shades the reading amber within 10 % of it rather than asking
for a second figure that would only be the same judgement twice.

**System sets the method.** Only two, because comfort A/C, fresh air, general
extract and toilet extract all size identically — to the same friction target —
so they are one system rather than three identical ones.

| System | Sizing method | Why |
|---|---|---|
| Air conditioning / ventilation | Constant friction rate (Pa/m) | Standard design. Velocity is only ever checked afterwards against the space's maximum, never sized to. |
| Kitchen grease extract | Constant friction too, under a two-sided velocity check | Sizes to the same target at full design flow, held to 5–9 m/s (DW/172 extract mains 6–9; 5 at the lower bound of its branch range). Aspect ratio held to 2:1. |
| Dust / fume extract (LEV) | Constant friction, under an ACGIH transport-velocity floor | The floor governs everywhere — 10 to 22.5 m/s by material, far above anything 1 Pa/m produces — and it **overrides the space's acoustic limit**, because every dust class needs more than any space allows. The app says the duct will be loud rather than pretending otherwise. Aspect ratio held to 2:1; flexible excluded, since LEV hose isn't HVAC flexible duct. |

**The floor overrides Pa/m on small flows.** Sizing for friction alone goes slack
long before it goes noisy — at 200 l/s the target gives a duct the air barely
moves through — so the duct comes back down a size and the friction target is
what gives. That is design intent, so it reads as an info line, not a warning:

| Duty | Selection | Velocity | Pa/m | |
|---|---|---|---|---|
| 100 l/s | Ø150 | 5.7 | 2.88 | floor overrides target |
| 200 l/s | Ø200 | 6.4 | 2.51 | floor overrides target |
| 500 l/s | Ø350 | 5.2 | 0.87 | target governs |
| 2,500 l/s | Ø700 | 6.5 | 0.57 | target governs |
| 6,000 l/s | Ø1000 | 7.6 | 0.50 | target governs |

**The 5 m/s floor is not a grease-suspension figure.** That reading is pre-2002
and was overturned: ASHRAE RP-1033 (Kuehn) showed grease deposition *increases*
with velocity, and NFPA 96 cut its minimum from 1500 fpm (7.6 m/s) to 500 fpm
(2.54 m/s) by Errata 96-01-01 in January 2002. Any source quoting ≥7.5 m/s "to
keep grease in suspension" predates that. AS 1668.2-2002 sets no in-duct velocity
at all — only hood face (Type A capture 0.5 m/s, dishwasher 0.3 m/s) and
discharge (5 m/s vertical, cl. 5.10.3). There is no code maximum anywhere; the
US industry norm of 2500 fpm (12.7 m/s) is a noise convention.

The floor is there to stop a small duty producing a duct nothing moves through.

**Dust transport velocity is a different matter from grease.** RP-1033 was
about grease aerosol condensing on duct walls; a solid particle dropping out of
an airstream is a different mechanism, and below the ACGIH figures the duct does
silt up. The material is chosen in Settings:

| Material class | Minimum | Examples |
|---|---|---|
| Fumes & very fine | 10.0 | welding fume, zinc and aluminium oxide |
| Very fine light dust | 12.5 | cotton lint, wood flour |
| Dry dusts & powders | 15.0 | rubber dust, moulding powder, leather shavings |
| Average industrial dust | 17.5 | sawdust, grinding dust, silica flour |
| Heavy dusts | 20.0 | wet sawdust, metal turnings, shot blast |
| Heavy or moist | 22.5 | moist cement, quicklime, sticky buffing lint |

Each is the lower bound of ACGIH's published range. **These came through
secondary sources** and the reproductions disagree at the light end; check them
against the ACGIH manual before specifying. Dust extract has **its own circular size list**, defaulting to the EN 1506
series (63, 80, 100, 125, 140, 160, 180, 200, 224, 250, 280, 315 …). It's needed:
an LEV transport band like 22.5–25 m/s spans only ~5 % in diameter, so 50 mm
steps usually hold nothing inside it. Across 270 dust duties the general 50 mm
list left 45 % with no size in their band; EN 1506 leaves 14 %. Edit it in
Settings to match what your LEV supplier stocks.

**The one figure with code force** is 2.54 m/s (500 fpm) at minimum turndown —
NFPA 96 / IMC 506.3.4 — and it applies at the turndown flow of a VSD or DCKV
system, not at design duty. Enter a turndown percentage in Settings and the app
checks there; leave it blank for constant volume.

**Fan duty build-up for grease extract**: duct friction + fittings + dirty baffle
filters (supplier data, typically 100–150 Pa) + hood entry K 0.5–1.0 + discharge
velocity pressure or cowl + ~10 % margin. The fittings library carries a dirty
baffle filter and a canopy hood entry for this.

Not yet modelled, and recorded in `js/data.js`: discharge velocity (≥5 m/s
vertical, 10+ near sensitive receptors per UK planning practice), hood spigot
velocity 5–7 m/s, the 1.15 kg/m³ design density (the app still defaults to 20 °C
and 1.204), and the installation notes — fall to hood ≥2 % up to 23 m and ≥8 %
beyond (IMC 506.3.7), access at each change of direction and ≤3 m centres, no
fire dampers, liquid-tight welded joints.

The useful consequence of splitting them: a grease duct's velocity band comes
from the system and its acoustic cap from wherever it runs, and whichever binds
first wins. Pick a space whose maximum sits below the system's floor — a grease
duct through a bedroom — and the app says which two settings are fighting rather
than quietly picking one.

**There is deliberately no minimum velocity on the air conditioning /
ventilation system.** Constant friction already picks the smallest duct that
holds the target, so the target *is* the anti-oversize control; a separate floor
would be a second constraint saying the same thing.

**Per segment** — add as many as the run needs

| Input | Notes |
|---|---|
| Airflow | l/s, with ±25 steppers. Shown alongside in m³/h and m³/s. |
| Duct role | Main / riser, branch, or runout — each has its own limit within the chosen space (fine-tuned in Settings). Hidden for flexible duct, which always uses its own dedicated limit regardless of role. |
| Duct type | Circular, rectangular or flexible. Flexible is locked to the runout role — it's what flexible duct is, and a flexible "main" would otherwise be checked against the main's limit. It isn't offered on kitchen grease extract at all, not being normally fire-code permitted (e.g. NFPA 96/DW/172); switching a run to that system converts any existing flexible segments to circular. |
| Material | Sets absolute roughness ε. Options are filtered to the duct type. |
| Installed condition | Flexible duct only: Typical 15 % (default, design basis) or Tight 4 % (only where specified fully extended and checked on site). |
| Height / Ø override | Drives rectangular height, or the circular/flex diameter. Blank = auto. |
| Width override | Rectangular only. Blank = solved from the height and the sizing target. |
| Straight length | m. |
| Fittings | Searchable library of ~45 fittings with editable ζ, plus quantity steppers. |
| Extra fixed loss | Pa, for anything not in the library. |

**Settings** — one project-wide friction target (Pa/m); maximum velocity by
duct role — main, branch and runout — for each of the ten spaces, editable
independently of which space is active on the main page; the grease transport
band and the turndown check; air temperature and altitude (drives density and viscosity),
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

**Two sizing modes.** The air conditioning / ventilation system sizes to a
constant friction rate; velocity is only ever checked afterwards, so standard
duct sizes snap *up* — always safe, since a bigger duct only ever lowers both
the friction rate and the velocity further from their limits.
Kitchen grease extract sizes to a velocity that's a **minimum**, not a ceiling,
so the same snap-up rule would be wrong: rounding up to the next standard size
lowers the velocity, which is exactly the direction that lets grease settle out
and foul the duct.
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

**Flexible duct.** Stretched roughness ε 0.9 mm (non-metallic / insulated;
metallic 1.2 mm) times the ASHRAE Fundamentals compression correction, Eq. 22:
`PDCF = 1 + 58·rc·e^(−0.00496·D)`, D in mm, valid 150–400 mm and held at the
end values outside (below Ø150 the app notes the pressure drop is indicative).
At 15 % that is ×5.1 at Ø150, ×3.5 at Ø250, ×2.2 at Ø400. LBNL-49012's
size-specific fits agree within ~7 %. Two compression options: Typical 15 % (LBNL
"normal stretch", default — a little conservative against the 10 % measured field
average) and Tight 4 % (ACCA "fully extended"). Culp's underlying data scatter
±20–30 %; ε 0.9 mm is ASHRAE's "medium rough" category value from recall, and
mildly conservative against measured stretched flex.

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

The acoustic maxima are the app's only noise control. The backbone is CIBSE
Guide B Table 3.4, which caps velocity in risers and above ceilings at
5 / 7.5 / 10 m/s for acoustically critical / normal / non-critical rooms; the NR
bands interpolate across that range. CIBSE Guide B2 Table 2.16 gives a general
office 6.0 m/s in the branch, 3.5 in the run-out and 2.5 at the diffuser.
ASHRAE's acoustic table (Applications 2023 Ch 49 Table 8, read from the primary)
is more permissive and splits by shape — above a suspended acoustic ceiling,
RC 35 allows 8.9 m/s rectangular against 15.2 round,
because flat rectangular walls are mass-controlled and radiate low-frequency
breakout noise while a round shell is stiffness-controlled and keeps it in.

**This app uses one figure for both shapes, deliberately.** The round allowance
is not a constant: across ASHRAE's own table the ratio runs about 1.4 to 1.95
depending on RC level and duct location. And it is an allowance against
*breakout* specifically, whereas the single limit here stands in for all duct
noise — including air noise regenerated at fittings, which travels inside the
duct to the terminal and is not attenuated by the duct wall at all. See
`docs/CALCULATION-REVIEW.md` §7 for the working.

**AIRAH and ASHRAE have since been read from the primary documents; CIBSE has
not** — Guide B2 is paywalled, so its figures here come from reproductions of
Guide B (2005) Tables 3.2–3.5. Check against the project specification before
issuing anything.

Note also that CIBSE Guide B Table 3.4's 5 / 7.5 / 10 applies to *rectangular*
duct in a riser or above a plasterboard ceiling. Circular gets 7 / 10 / 15, and
above a suspended ceiling it drops to 3 / 5 / 6 — a tighter case this app does
not model.

The kitchen grease transport minimums are DW/172-style indicative defaults,
pending confirmation against the specific kitchen and canopy design. Roughness
values follow the ASHRAE Fundamentals duct roughness table, and loss
coefficients are typical published values.
They are sensible defaults for a first pass, not a project specification — use
Settings to fine-tune any of them per space and duct role.

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
