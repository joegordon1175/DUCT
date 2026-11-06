# DUCT — calculation method & assumptions review

> **Status: acted on.** Every defect below (D1, D2, D3) is fixed, and the noise
> model has been removed from the app entirely rather than patched — see
> §6 for what changed. The findings are kept as written so the reasoning
> behind each change stays on the record.

Reviewed at commit `ec3276f`. Engine `js/engine.js`, reference data `js/data.js`,
UI/flagging `js/app.js`. 57/57 unit tests pass.

Every number below was reproduced independently — recomputed from first
principles in a separate script rather than read back out of the engine's own
helpers. Where a figure is quoted as "engine X vs independent Y", those are two
separate calculations that had to agree.

---

## 1. Verified correct

| Item | Check | Result |
|---|---|---|
| Air density | ρ(20 °C, sea level) | 1.20410 kg/m³ vs 1.2041 published — exact |
| Dynamic viscosity | Sutherland at 20 °C | 1.8135×10⁻⁵ Pa·s, inside the 1.81–1.83×10⁻⁵ range quoted by different sources |
| Barometric model | ISA at 1500 m | 84.56 kPa vs 84.56 kPa ISA |
| Friction rate | Full Darcy–Weisbach chain, every test duty | matches an independent recomputation to <1×10⁻⁹ Pa/m |
| Velocity | Q/A, round and rectangular | exact, both shapes |
| Ceiling sizing (constant friction) | 50–2000 l/s | friction target **and** velocity cap respected at every duty |
| Ceiling sizing — not oversized | one size down from each selection | always breaches the target or the cap, so no selection is a size too big |
| Floor sizing (kitchen, velocity as minimum) | 250–4000 l/s, round | velocity inside [7.5, 12] m/s at every duty |
| Floor sizing, rectangular | 250–3000 l/s | velocity inside the band at every duty — this is the area-band fix working; the previous equivalent-diameter version landed 3 of 4 duties below the minimum |
| Flexible-duct compression | factors 1.0 / 1.3 / 2 / 3 / 4 against a 1.0 Pa/m target | reported rate 0.987–0.998 Pa/m. Before the fix a ×4 factor came out at 2.4× over target |

The pressure path is sound. Nothing in the hydraulics needs changing.

---

## 2. Defects — these change an answer

### D1. Off-list duct sizes are produced while "standard sizes" is switched on

`snapUp` and `snapDown` both fall back to a 50 mm multiple when nothing in the
list fits. `snapUp`'s fallback only fires *above* the largest listed size;
`snapDown`'s fires *below* the smallest, and in floor (kitchen) mode that is a
duty you will actually meet:

| Duty | Space | Result | On the size list? |
|---|---|---|---|
| 60 l/s | Kitchen extract, round | Ø100 mm | **no** (list starts at 150) |
| 80 l/s | Kitchen extract, round | Ø100 mm | **no** |
| 40 l/s | Kitchen extract, rect | 50 × 100 mm | **no** — a 50 mm-wide duct is not fabricable |
| 60 l/s | Kitchen extract, rect | 50 × 100 mm | **no** |
| 15 000 l/s | Commercial, round | Ø1500 mm | no (list tops out at 1400) |
| 30 000 l/s | Commercial, round | Ø2100 mm | no |

Nothing flags it. The Ø100 @ 80 l/s case reads 10.19 m/s — inside the 7.5–12
band — so it passes every check the app makes and is simply not a size anyone
can buy. The user curated that list deliberately in Settings; the engine should
not step outside it without saying so.

### D2. Kitchen sizing is non-monotonic below ~133 l/s

Same root cause, plus `snapFloor`'s choice to honour the velocity **cap** over
the velocity **minimum** when the list skips the valid band:

| Duty | Selection | Velocity |
|---|---|---|
| 40 l/s | Ø150 | 2.26 m/s ← flagged |
| 60 l/s | Ø100 | 7.64 m/s ← off-list, not flagged |
| 80 l/s | Ø100 | 10.19 m/s ← off-list, not flagged |
| 100 l/s | Ø150 | 5.66 m/s ← flagged |
| 132 l/s | Ø150 | 7.47 m/s ← flagged |

More air gives a *bigger* duct and a *lower* velocity. Ø150 is the smallest
listed round size and only reaches 7.5 m/s at **133 l/s**; below that no listed
round size can hold the transport minimum at all (100 × 150 rectangular manages
it down to 112 l/s). The sub-minimum cases are correctly flagged
"risk of settling/buildup" — the off-list ones are not.

Worth a decision on the fallback priority too. `snapFloor` currently breaks a
tie in favour of not exceeding the cap, which drops the velocity below the
minimum. For grease extract the fire risk from under-velocity is arguably the
worse of the two, so the priority may be backwards — but either way the honest
answer at these duties is "no listed size works", not a silent pick.

### D3. The leakage estimate counts plant pressure as duct pressure

`calcRun` uses `meanPressure = totalPa / 2`, and `totalPa` includes `plantPa`.
A coil or filter allowance is not static pressure inside the ductwork, so the
leakage figure inflates with it. On a 70 Pa duct run, class B:

| Plant allowance | Leakage reported | On duct pressure alone | Overstated by |
|---|---|---|---|
| 0 Pa | 6.16 l/s | 6.16 l/s | — |
| 150 Pa | 12.98 l/s | 6.16 l/s | ×2.1 |
| 450 Pa | 22.70 l/s | 6.16 l/s | ×3.7 |
| 900 Pa | 34.04 l/s | 6.16 l/s | ×5.5 |

450 Pa is an ordinary kitchen plant allowance. The fix is one line
(`ductPa / 2`); the physics (EN 12237 `q = k·p^0.65`, and the factors
A 0.027 / B 0.009 / C 0.003 / D 0.001) is correct and was verified separately.

---

## 3. Assumptions worth knowing — defensible, but they should be stated

### A1. The noise model ignores terminals completely

Any fitting with a `fixedPa` contributes **0 dB**: grille/diffuser (25 Pa),
silencer (40), filter (150), coil (80), heat recovery (120). The diffuser is
normally the loudest thing in the room — a 150 l/s ceiling diffuser is typically
published around 30–35 dBA, above the app's whole residential limit on its own.
Modelling the same grille as a ζ ≈ 2 element added 4.8 dB to the test segment.

Zero is right for a silencer (at worst it under-credits the attenuation) and
defensible for a coil. For a grille it is the dominant source being left out.

### A2. No duct attenuation, and duct noise does not scale with length

`lengthM` acts as an on/off switch: 0 m gives 0 dB, and 0.5 m and 50 m both give
35.6 dBA for the same duct. Nothing attenuates upstream noise on its way to the
room, so all segments are energy-summed undiminished — the commercial test case
came out dominated by the 48.1 dBA main, which in reality would be well
attenuated by the branch, the runout and the terminal.

A1 and A2 err in **opposite directions**. Which wins can't be settled without
octave-band data, which the app doesn't have and doesn't claim to.

### A3. The residential noise check cannot currently fire

Tripping 30 dBA room SPL needs 8.5 m/s in a Ø150, 6.9 m/s in a Ø250 or 5.8 m/s
in a Ø400. Residential maximum velocity is 5.0 m/s. So in residential mode the
dBA output can only ever read "within limits" unless someone overrides a size by
hand. Commercial does bite — the test run gave 42.3 dBA against a 40 dBA limit.

This is arguably the model telling the truth ("keep to residential velocities and
the duct itself won't be your noise problem"), but combined with A1 it means the
residential noise number is doing no work.

### A4. Kitchen extract is calculated at 20 °C

Real grease extract runs 40–60 °C. The app lets you set the temperature but never
prompts for it, and the default is 20 °C. Because kitchen sizing is
velocity-driven, **dimensions do not move** — only pressure does:

| Temperature | ρ | Sizes | Duct Pa | Fan duty |
|---|---|---|---|---|
| 20 °C | 1.2041 | 550 × 350 | 117 | 459 |
| 40 °C | 1.1272 | 550 × 350 | 110 | 451 |
| 60 °C | 1.0595 | 550 × 350 | 105 | 445 |

20 °C **over**-states the pressure, so it is conservative for fan selection. Not
a defect — but a 3 % fan margin is being spent silently on a wrong temperature,
and a hot-extract default or a prompt would be more honest.

### A5. Maximum velocity is inert in automatic floor sizing

Setting the kitchen maximum to 10, 12, 15 or 18 m/s gave **identical**
selections at every duty tested (150, 400, 1000, 2500 l/s). It only constrains
manual overrides and raises flags. That follows from the method — the minimum
is what sizes the duct — but the Settings page presents the two numbers as
equals, which overstates what `max` does.

### A6. Rectangular Reynolds number is the equal-friction round value

For a 600 × 400 duct the engine reports Re = 2.380×10⁵ (equivalent diameter and
equivalent velocity); on the actual duct (hydraulic diameter 480 mm, actual
velocity 6.25 m/s) it is 1.992×10⁵ — about 20 % apart. This is a **labelling**
issue only: both are fully turbulent so the friction factor barely moves, and
evaluating pressure on the circular equivalent is the correct ASHRAE method.
The reported figure just isn't the duct's own Reynolds number.

### A7. "Equivalent length" folds in fixed-Pa components

`equivalentLengthM = (fittingLoss + componentPa) / frictionRate`. Add a dirty
filter to a 10 m run and it reads as **260 m** of extra equivalent duct.
Arithmetically true, physically meaningless — the figure only means something for
velocity-pressure fittings.

### A8. DW/144 class is taken on the whole run at once

`pressureClass(totalPa, maxVelocity)` uses the fan total pressure and the
fastest segment, applied to every section. Per-section classification would be
cheaper to build. This is the conservative direction.

The negative-pressure flag is sound: the DW/144 class only depends on which side
of the fan you are on between 750 and 1000 Pa — below that both readings agree,
above ~1000 Pa the positive limits reach class C anyway.

### A9. One index run, no branch balancing

`calcRun` sums segments in series along a single path. There is no branch
balancing and no damper authority. That is the right scope for a sizing tool,
but it means the fan duty is the index run's, and sister branches need their own
pass.

---

## 4. Minor

- `node --test test/` fails on Node 22 (it treats the bare directory as a test
  file). `npm test` — which uses the `test/*.test.mjs` glob — passes 57/57. Use
  `npm test`.
- `combineLevels` drops any level ≤ 0 dB. `regeneratedNoise` can return a small
  negative value for slow air in a small duct, so those sources vanish rather
  than contributing ~0 dB. The error is immaterial but the threshold is arbitrary.
- `js/data.js` `RECT_SIZES` includes 850 but not 1700, which is the usual
  modular series — worth a glance against what your supplier actually holds.

---

## 5. What was changed

All three defects are fixed and the noise model is gone. `npm test` covers
each change.

### D1/D2 — sizing never leaves the configured size list

`snapUp` now clamps to the largest listed size and `snapDown` to the smallest,
instead of inventing a 50 mm multiple outside the list. The 50 mm fallback
survives only for an empty list, where there is nothing to clamp to.

That removes the fabricated sizes and makes kitchen sizing monotonic again:

| Duty | Before | After |
|---|---|---|
| 40 l/s | Ø150, 2.26 m/s | Ø150, 2.26 m/s — flagged |
| 60 l/s | **Ø100** (off-list), 7.64 m/s, unflagged | Ø150, 3.40 m/s — flagged |
| 80 l/s | **Ø100** (off-list), 10.19 m/s, unflagged | Ø150, 4.53 m/s — flagged |
| 100 l/s | Ø150, 5.66 m/s | Ø150, 5.66 m/s — flagged |
| 40–60 l/s rect | **50 × 100** (not fabricable) | 100 × 100 |
| 15 000 l/s | **Ø1500** (off-list) | Ø1400 — flagged |
| 30 000 l/s | **Ø2100** (off-list) | Ø1400 — flagged |

`calcSegment` now reports `ruleMet`, `sizeLimited`, `belowMinVelocity`,
`exceedsMaxVelocity` and `exceedsFrictionTarget`, and the UI raises a flag
naming the duty and the nearest available size: *"no size in your list meets
the sizing rule at 100 l/s — nearest available (Ø150 mm) shown. Add sizes in
Settings."* `sizeLimited` is false for an overridden size, since there the fix
is not to add sizes to the list.

A friction rate above the target is now flagged too; previously only velocity
was checked, so an overridden size could quietly run at 14 Pa/m against a
1 Pa/m target.

**`snapFloor`'s tie-break changed.** It used to favour the velocity cap over
the transport minimum by fixed priority. That is wrong in both directions: on a
coarse list, holding the cap can mean nearly doubling the diameter, while
holding the minimum can mean running at three times the intended velocity. It
now takes whichever limit it misses by less, as a ratio — velocity goes as 1/d²
for round duct and 1/w at a fixed height, so the smaller ratio is the smaller
velocity excursion either way. Either breach is flagged regardless.

### D3 — leakage is taken on duct pressure

`meanPressure` is now `ductPa / 2`, excluding the plant allowance. On the
worked example the figure drops from 22.70 l/s back to 6.16 l/s at 450 Pa of
plant. The DW/144 construction class deliberately still uses the fan total —
the app cannot know which side of the duct the plant sits on, and the duct must
be built for the worst case. That inconsistency is now stated in the code, the
README and the app's own method note.

### The noise model is removed

Not patched — removed. `regeneratedNoise` and `combineLevels` are gone from the
engine, along with `noiseLwA`, `roomSpl`, the per-fitting noise figure, the
`noiseLimitDba`/`noiseCriterion` fields on every space type, the `NOISE_CRITERIA`
reference table, the duct-to-room correction setting, the dBA column in the
breakdown table and CSV, and the dBA tile in the sticky footer. A stale saved
`roomCorrection` is dropped on load.

Velocity limits are the noise control now, which is how CIBSE Guide B3 and
ASHRAE present them anyway. The app says so in its method note rather than
leaving a reader to wonder where the dBA figure went.

### A6, A7 — reporting corrected

- **Reynolds number.** `reynolds` is now the duct's own (hydraulic diameter,
  actual velocity). The equal-friction value the friction factor is taken at is
  reported separately as `reynoldsEquivalent`, and both are columns in the CSV.
  For round duct they are equal.
- **Equivalent length.** `fittingsEquivalentLengthM` covers velocity-pressure
  fittings only and is what the UI now shows. The combined figure — which read
  a dirty filter as 260 m of extra duct — is kept in the engine output for
  continuity but is no longer displayed.

### Left as they are, and why

- **A4, kitchen extract at 20 °C** — conservative (over-states Pa by ~3 % on
  the fan against 60 °C air) and sizing is velocity-driven, so dimensions do
  not move. The temperature is settable; changing the default would quietly
  reduce everyone's fan duty.
- **A5, max velocity inert in floor sizing** — correct as designed. It
  constrains overrides and raises flags.
- **A8, DW/144 class on the whole run** — conservative, see D3 above.
- **A9, single index run** — the right scope for a sizing tool.

### Minor

- `combineLevels`' threshold is moot now the noise model is gone.
- `node --test test/` still fails on Node 22 (it treats the bare directory as a
  test file). Use `npm test`, which globs `test/*.test.mjs`.

---

## 6. Follow-up: the velocity limits themselves

The review above checked that the arithmetic was right. It did not ask whether
the *limits* were right. They were not — they were over-conservative, and worse,
they were attached to the wrong thing.

### The limits were driving almost every selection

At a constant friction target, velocity rises naturally with duty: 1.0 Pa/m
gives 2.6 m/s at 25 l/s, 3.7 at 100, 6.2 at 800, 8.5 at 3,000 and 10.1 at 6,000.
So a velocity cap only matters above the duty where it crosses that curve. Here
is where each old limit took over and enlarged the duct beyond what the friction
target asked for:

| Old limit | recommended bites above | hard max bites above |
|---|---|---|
| Residential main 4.0 / 5.0 | 201 l/s | 491 l/s |
| Residential branch 3.0 / 3.5 | 65 l/s | 118 l/s |
| Residential runout 2.0 / 2.5 | 14 l/s | 32 l/s |
| Commercial main 6.0 / 8.0 | 711 l/s | 2,302 l/s |
| Commercial branch 4.5 / 6.0 | 223 l/s | 711 l/s |
| Commercial runout 3.0 / 4.0 | 45 l/s | 140 l/s |

A 200 l/s runout to a diffuser is routine, so the app was oversizing nearly
every commercial runout. The friction target was nominally "the main driver" and
in practice was overridden almost everywhere.

### The limits were attached to the building, not the space

"Residential / Commercial / Kitchen Extract" was one setting doing two jobs, and
the building half was the wrong axis. Noise is the only thing setting the upper
band, and a noise requirement belongs to the space: a hotel bedroom and a house
bedroom want the same number, an open-plan office and a classroom want the same,
a riser is a riser in both. The building label put a boardroom and a car park in
the same bucket, and it is what produced the awkward cases that kept surfacing —
residential cooker hoods, commercial-versus-residential kitchens.

### What replaced it

Two settings, one per cause:

- **Space served → maximum velocity.** Six acoustic bands, NR 25 to NR 45+, one
  figure per duct role. Amber within 10 % of it, derived from that single limit
  rather than asked for as a second number.
- **System → sizing method.** Only two, because comfort A/C, fresh air, general
  and toilet extract all size identically to the friction target. Kitchen grease
  extract is the exception, and carries the minimum transport velocity.
- **Friction target → one project-wide value**, 1.0 Pa/m, replacing the per-space
  map. With noise handled by the velocity cap there is no reason for it to vary
  by room.
- **No minimum velocity on the friction system.** Constant friction already picks
  the smallest duct that holds the target, so the target is the anti-oversize
  control; a separate floor would be a second constraint saying the same thing.

The split buys something the old model could not express: a grease duct's
minimum comes from transport physics and its maximum from wherever it runs, so
the same duct gets 12 m/s of headroom in a riser and 9 m/s where it crosses a
restaurant. Choose a space whose maximum sits below the transport minimum and
the app names the two settings that are fighting instead of quietly picking one.

### Where the new limits bite

At 1.0 Pa/m: an NR 35 main stays friction-driven to 1,766 l/s, NR 40 to 3,743,
NR 45+ to 12,408. The friction target is now the driver across the normal range,
which was the point.

### Provenance, stated plainly

The backbone is CIBSE Guide B Table 3.4 (5 / 7.5 / 10 m/s for acoustically
critical / normal / non-critical rooms), with CIBSE Guide B2 Table 2.16 and
ASHRAE's acoustic table as cross-checks. **Every one of those numbers reached
this app through a secondary source** — the originals are paywalled, and two of
the hosts were outside the session's network allowlist. They are starting points
to be checked against a project specification, not authority. All are editable
in Settings.

One thing not taken up: ASHRAE allows round duct a higher velocity than
rectangular for the same RC. §7 below digs into that, and concludes against
building it in.

---

## 7. The round-duct velocity allowance, examined

§6 recorded that ASHRAE allows round duct "roughly 1.7x" the rectangular
velocity, sourced from one secondary site. That number was challenged, so here
is the working. Short version: **1.7x is not high — if anything it is
conservative — but it should still not be built into this app.**

### The physics says the ratio could be much larger

Round duct wins on breakout because of *how* it resists sound, not just how
much. A flat rectangular wall is a mass-controlled panel: at low frequency it
offers little resistance, and panel resonances put local dips in its
transmission loss. A round shell is stiffness-controlled, and stiffness is what
matters at low frequency, which is where duct rumble lives. Measurements bear
that out — a 305 x 1220 mm rectangular duct against an 815 mm spiral came out
**25 dB or more** apart across the range of interest, and a 24-inch round
against a 24-inch square put the gap at about **30 dB from 63 to 250 Hz**.

Converting a transmission-loss advantage into a velocity allowance, with
straight-duct sound power going as 50·log₁₀(v):

| Velocity ratio | dB it spends (v⁵) | dB it spends (v⁶) |
|---|---|---|
| ×1.4 | 7.3 | 8.8 |
| ×1.7 | 11.5 | 13.8 |
| ×2.0 | 15.1 | 18.1 |
| ×2.6 | 20.7 | 24.9 |
| ×3.2 | 25.3 | 30.3 |

A 25 dB breakout advantage would justify around ×3.2. ASHRAE's ×1.7 spends only
11.5 dB of it. So the table is far more conservative than the breakout argument
alone would allow — sensibly, because breakout is not the only path.

### But it is not a constant

Across ASHRAE's own table the round/rectangular ratio is not one number:

| Location / level | Rect | Round | Ratio |
|---|---|---|---|
| Above suspended acoustic ceiling, RC 35 | 1750 fpm | 3000 fpm | 1.71 |
| Within occupied space, RC 45 | 2000 | 3900 | 1.95 |
| Within occupied space, RC 35 | 1450 | 2600 | 1.79 |
| Within occupied space, RC 25 | 950 | 1700 | 1.79 |
| Non-acoustic ceiling, NC 35 (conflicting source) | 2500 | 3500 | 1.40 |

1.4 to 1.95. The RC 35 above-ceiling pair is the one corroborated by ASHRAE's
own worked example; the rest are secondary and one source contradicts another.

### What it would actually change

At the 1.0 Pa/m target, friction binds before the cap does on anything small, so
a round allowance changes nothing until the duct is large — and then by exactly
one standard size. NR 35 office main, cap 7.5 m/s against 7.5 × 1.7 = 12.75:

| Duty | Cap 7.5 | Cap 12.75 | Change |
|---|---|---|---|
| 800 l/s | Ø450, 5.0 m/s | Ø450 | — |
| 1,500 l/s | Ø550, 6.3 m/s | Ø550 | — |
| 2,500 l/s | Ø700, 6.5 m/s | Ø700 | — |
| 4,000 l/s | Ø900, 6.3 m/s | Ø800, 8.0 m/s | one size down |
| 6,000 l/s | Ø1100, 6.3 m/s | Ø900, 9.4 m/s | one size down |
| 9,000 l/s | Ø1300, 6.8 m/s | Ø1100, 9.5 m/s | one size down |
| 12,000 l/s | Ø1400, 7.8 m/s | Ø1200, 10.6 m/s | one size down |

### Why it is not built in

1. **The limit here is not a breakout model.** It is one number standing in for
   all duct noise. Regenerated noise at a bend, damper or take-off travels
   *inside* the duct to the terminal, where the duct wall's transmission loss
   does nothing for it. A breakout ratio applied to that limit would claim an
   accuracy the method does not have.
2. **There is no single ratio to apply** — 1.4 to 1.95, and the sources
   disagree with each other.
3. **Frameworks would be mixed.** These limits are anchored on CIBSE Guide B,
   which does not split by shape at all. Bolting an ASHRAE shape ratio onto a
   CIBSE backbone is not one method.
4. **The gain is narrow**: nothing below ~4,000 l/s, one standard size above.

If it is wanted anyway, the honest form is a per-space round allowance that is
visible and editable rather than a hidden constant, defaulted to the low end
(1.4) rather than 1.7.

### Incidental corroboration

ASHRAE states branch ducts should run at about **80 %** of the main-duct value
and final runouts at **50 % or less**. The role gradation in §6 was arrived at
independently and lands on it:

| Space | Main | Branch | Runout |
|---|---|---|---|
| Bedroom | 5.0 | 4.0 (80 %) | 2.5 (50 %) |
| Living | 6.0 | 5.0 (83 %) | 3.0 (50 %) |
| Office | 7.5 | 6.0 (80 %) | 4.0 (53 %) |
| Open plan | 8.5 | 7.0 (82 %) | 4.5 (53 %) |
| Retail | 9.0 | 7.5 (83 %) | 5.0 (56 %) |
| Back of house | 12.0 | 9.0 (75 %) | 6.0 (50 %) |

---

## 8. Follow-up: kitchen as its own space, and the small-duct guard

### The grease runout band was impossible everywhere

§6 split the velocity limits so the space sets the maximum and the system sets
the minimum. A sanity check of kitchen mode found that the grease **runout** band
was unusable in every single space:

| Space | Runout min | Runout max | |
|---|---|---|---|
| Bedroom / Living / Office / Open plan / Retail | 6.0 | 2.5–5.0 | max below min — impossible |
| Back of house | 6.0 | 6.0 | zero width — only an exact 6.00 m/s hit passes |

The cause was a category error introduced by the split. Each space's runout
maximum was derived as ~50 % of its main, following ASHRAE's rule — but that rule
is about **runouts feeding a terminal in an occupied room**. A grease duct off a
canopy is not that, so the figure never applied to it.

**Fix: a commercial kitchen is its own space** (main 12.0, branch 8.0, runout
8.0, NR 45+). The duct runs where canopy fans and appliances dominate, so the
duct is not what anyone hears, and the runout is not tied to the half-the-main
rule. A grease duct leaving the kitchen needs its own acoustic assessment
whatever this app says, so no attempt is made to model that case. The space sits
outside the acoustic scale deliberately, and the ordering tests exclude it.

### Floor sizing had no lower bound on duct size

The same check found that velocity-floor sizing will meet a small duty with a
tiny, screaming duct, because nothing stops it: on the shipped 50 mm list,
200 l/s on a main lands at Ø150, **11.3 m/s and 10.5 Pa/m**. Holding 7.5 m/s at
100 l/s costs 5.8 Pa/m and at 50 l/s, 8.9 Pa/m.

**Fix: a friction ceiling on the grease system**, 6.0 Pa/m by default and
editable. A Pa/m ceiling is a minimum diameter, and at a fixed flow a minimum
diameter is just a maximum velocity — so it is converted to one and folded into
the effective cap, which means the whole of the sizing below, round and
rectangular alike, needs no further knowledge of it. Where it binds, the duct
goes up a size and the velocity drops below the transport minimum; that is
flagged, because the trade between fan energy and keeping grease entrained is the
engineer's to make. `velocityCapSource` says which limit bound the duct so the UI
names the right one rather than blaming noise.

**Choosing the default taught something.** 3.0 Pa/m looked right from the rate
*at* the minimum velocity — and is wrong. Floor sizing snaps **down**, so it
deliberately lands at the fast end of the band and runs hotter than the
at-minimum figure suggests. Worse, 3.0 narrows the band below one standard size
step, so most duties then satisfy neither bound: only 5 of 12 test duties met the
rule, against 12 of 12 uncapped.

| Ceiling | Worst Pa/m | Duties meeting the rule |
|---|---|---|
| none | 10.51 | 12 / 12 |
| 3.0 | 3.81 | 5 / 12 |
| 4.0 | 6.12 | 8 / 12 |
| 6.0 | 6.12 | 10 / 12 |
| 8.0 | 10.51 | 11 / 12 |

6.0 moves exactly the pathological duty (200 l/s: Ø150 at 11.3 m/s and 10.5 Pa/m
becomes Ø200 at 6.4 m/s and 2.5 Pa/m) and leaves every normal duty alone.

### Flexible duct: limits dropped, role locked

The per-space flexible velocity entries were inert — flexible duct's roughness
makes the friction target bind long before any velocity limit does. At 120 l/s a
bedroom (2.5 m/s), an office (4.0) and a retail space (5.0) all produced the same
Ø250 at 2.44 m/s. They are gone; what actually matters for flexible duct is its
pressure drop, already modelled by roughness and the compression factor.

Flexible is now locked to the **runout** role. It had to be: the role picker is
hidden for flexible duct, so without the lock a segment kept whatever role it had
and silently read that limit — a flexible "main" checked against the main's
velocity. The app also no longer lets you build `role = main` + `shape =
flexible`, a combination nobody would install.

### One thing that looked like a bug and was not

Velocity is not monotonic in airflow under floor sizing. It sawtooths, dropping
back toward the minimum each time it steps up a size. A check flagged it; the
check was wrong, not the engine.

### Still outstanding

AIRAH's "Maximum duct velocities and noise effects" table (Skills Workshop
sw123) could not be read — `airah.org.au` is outside the session's network
allowlist. A **DUCT** cloud environment now exists with the reference hosts
allowed, for the consensus pass across CIBSE, ASHRAE and AIRAH. What did come
through: AIRAH sizes under 180 l/s at 4.5 m/s and 180–4,500 l/s by friction at
~1.2 Pa/m, and frames its table as absolute maxima for systems over 1,000 l/s
rather than recommended design velocities — the same framing as the single
maximum used here.

---

## 9. AS 1668, and what the research says about grease velocity

Two findings, and the second is uncomfortable.

### AS 1668.2 does not set an in-duct velocity

It sets a **discharge** minimum — objectionable discharges to outside at not
less than 5 m/s (attributed to Cl. 3.10.3) — but appears to carry no requirement
for velocity *within* the duct, in either the 2002 or 2012 editions. Vendor and
consultant guidance that cites "AS 1668 minimum duct velocity" is importing a
figure from somewhere else.

For a project designed to AS 1668, that means there is no mandated in-duct
velocity to meet, and the app's grease minimums are guidance rather than
compliance.

### The premise behind the grease minimum has been overturned — elsewhere

The app encodes the standard reasoning: air slower than the transport minimum
lets grease settle out, so size to hold it. **ASHRAE RP-1033 tested 500, 1,000,
1,500 and 2,000 fpm and found grease deposition is reduced as velocity is
reduced.** On the back of it, NFPA 96 cut its minimum from 1,500 fpm (7.6 m/s)
to **500 fpm (2.5 m/s)** in March 2002.

7.5 m/s — the app's main default — is almost exactly the figure that research
retired.

UK and Australian practice did not follow:

| Source | Main | Branch | Note |
|---|---|---|---|
| NFPA 96 (post-2002) | 2.5 | 2.5 | after RP-1033 |
| DW/172 | 6–9 | 5–7 | where this app's defaults sit |
| AIRAH 5th ed. (reported) | 10 | — | |
| AS 1668.2 | none | none | discharge only, ≥ 5 m/s |

A 3x spread between codes, with no consensus. The defaults follow DW/172 because
it is the most conservative widely-used guidance, not because the question is
settled. Worth a deliberate decision rather than inheritance — holding 7.5 m/s
costs real fan energy, and the research says it may also deposit more grease,
not less.

**All of this came through secondary sources.** The RP-1033 report and the
standards are paywalled, and the sources disagree with each other on details
(one reads NFPA 96 as prescribing 500 fpm, another as prescribing nothing).
Confirm before specifying.

### The friction ceiling now applies to runouts only

A runout is short and reachable, so trading its transport velocity away to avoid
a screaming duct is cheap. The main and riser are the longest, least accessible,
hardest-to-clean part of the run, so there the transport velocity holds whatever
it costs in Pa/m — a small main that reads hot is telling you something true
rather than something to be capped away.

| Duty | Main (no ceiling) | Runout (6.0 Pa/m ceiling) |
|---|---|---|
| 200 l/s | Ø150, 11.3 m/s, 10.5 Pa/m | Ø200, 6.4 m/s, 2.5 Pa/m |
| 300 l/s | Ø200, 9.5 m/s, 5.4 Pa/m | Ø250, 6.1 m/s, 1.8 Pa/m |
| 500 l/s | Ø250, 10.2 m/s, 4.6 Pa/m | Ø300, 7.1 m/s, 1.9 Pa/m |

---

## 10. Design basis adopted (06/11/2026)

A project design basis supersedes the defaults derived in §6–§9. It resolves the
open question in §9 in the opposite direction to the app's previous behaviour.

### Grease extract sizes on equal friction, not constant velocity

The system no longer has a sizing method of its own. It sizes to the project
friction target at full design flow, like everything else, with velocity as a
two-sided check:

| | Figure | Basis |
|---|---|---|
| Method | equal friction, 1.0 Pa/m at design flow | constant section hood → fan where practical |
| Max velocity | 9 m/s | DW/172 extract mains 6–9; ≤10 short risers if noise allows |
| Min velocity at design flow | 5 m/s | judgement, DW/172 branch lower bound |
| Min velocity at turndown | 2.5 m/s | NFPA 96 / IMC 506.3.4 (500 fpm) |
| Aspect ratio | ≤ 2:1 | round/square preferred |
| Air density | 1.15 kg/m³ | ≈ 35 °C, not room air |

**The floor overrides Pa/m on small flows.** Sizing for friction alone goes
slack long before it goes noisy — at 200 l/s the target gives a duct the air
barely moves through — so the duct comes back down a size and the friction
target is what gives. That is design intent, so it reads as an info line, not a
warning:

| Duty | Selection | Velocity | Pa/m | |
|---|---|---|---|---|
| 100 l/s | Ø150 | 5.7 | 2.88 | floor overrides target |
| 200 l/s | Ø200 | 6.4 | 2.51 | floor overrides target |
| 300 l/s | Ø250 | 6.1 | 1.77 | floor overrides target |
| 500 l/s | Ø350 | 5.2 | 0.87 | target governs |
| 2,500 l/s | Ø700 | 6.5 | 0.57 | target governs |
| 6,000 l/s | Ø1000 | 7.6 | 0.50 | target governs |

The engine's velocity floor is general, not grease-specific: `ctx.minVelocity`
in friction mode. Rectangular honours it through the area ceiling, which
`selectRectangular` now applies in both directions.

### The 5 m/s is not a grease-suspension figure

Worth stating, because the number looks like the old one. The pre-2002 reading —
that slower air lets grease settle — is what **ASHRAE RP-1033 (Kuehn)**
overturned: deposition *increases* with velocity, and NFPA 96 cut its minimum
from 1500 fpm (7.6 m/s) to 500 fpm (2.54 m/s) by **Errata 96-01-01, January
2002**. Any source quoting ≥7.5 m/s "to keep grease in suspension" predates that.

The 5 m/s floor is there to stop a small duty producing a duct nothing moves
through. The 2.5 m/s turndown figure is the one that carries code force, and it
applies at the minimum flow of a VSD or DCKV system, not at design duty — which
is why the app asks for a turndown percentage and checks there.

### AS 1668.2-2002, corrected

Sets **no in-duct velocity**. It covers hood face (Type A capture 0.5 m/s,
dishwasher 0.3 m/s) and discharge (5 m/s vertical, **cl. 5.10.3**, systems over
1000 l/s). §9 cited cl. 3.10.3 from a secondary source; 5.10.3 is correct.

There is no code *maximum* anywhere; the US industry norm of 2500 fpm (12.7 m/s)
is a noise convention.

### What the friction ceiling became

The Pa/m ceiling added in §8 and scoped to runouts in §9 is **gone**. It existed
to stop constant-velocity sizing producing a tiny screaming duct; with equal
friction that pathology cannot arise, because the duct is never smaller than the
velocity floor requires. Worst case is now 2.88 Pa/m at 100 l/s against 10.5 Pa/m
before.

### Carried in but not yet modelled

Recorded in `js/data.js` on the grease system, and surfaced nowhere yet:

- **Discharge** ≥5 m/s vertical, target 10+ near sensitive receptors (UK
  planning practice 10–15). Needs a discharge input — a stack is not a duct
  segment.
- **Hood spigot** 5–7 m/s (DW/172 practice). Advisory.
- **Air density 1.15 kg/m³.** The app still defaults to 20 °C / 1.204. Setting
  the temperature to ~35 °C gets there; nothing prompts for it.
- **Installation notes** — fall to hood ≥2 % (runs ≤23 m) or ≥8 % (>23 m), IMC
  506.3.7; access at each change of direction, ≤3 m centres, within ~1 m of fan
  (TR/19, DW/172, NFPA 96 12 ft; AS 1668.1:2015 reportedly 3 m + changes of
  direction, unverified); no fire dampers; liquid-tight welded joints. These are
  drawing notes, not calculations.

### Dead code this leaves behind

Nothing now uses the engine's `'velocity'` sizing method: `snapFloor`,
`selectRectangular`'s `'down'` direction, `ctx.maxFriction` and the
`velocityCapSource` / `frictionCeiling` outputs are all unreachable from the app.
They are still covered by tests and still correct; they are simply no longer
wired to anything.

---

## 11. Consensus pass: AIRAH, CIBSE, ASHRAE (07/11/2026)

The velocity table was finally read against the primary documents — AIRAH Skills
Workshop sw123 and sw022, and ASHRAE *HVAC Applications* 2023 Ch 49 Tables 8
and 9. CIBSE remains secondary (Guide B2 is £100 behind a paywall), as do the
AS 1668 clause numbers.

**Four rows were wrong, and one was wrong against this app's own design basis.**

### AIRAH sw123 Table 1 — the figure that moved things

| Required NR | Riser | Main supply | Branch | Run-out | Return |
|---|---|---|---|---|---|
| 50 | 10.0 | 10.0 | 8.0 | 6.0 | 8.0 |
| 45 | 10.0 | 9.0 | 7.0 | 6.0 | 7.0 |
| 40 | 10.0 | 8.0 | 7.0 | 5.5 | 7.0 |
| 35 | 10.0 | 7.5 | 6.5 | 5.0 | 6.5 |
| 30 | 9.0 | 6.5 | 5.5 | 4.0 | 5.5 |

Three things about it matter more than the numbers:

- It is framed as **absolute maxima, not design recommendations**, and applies
  only to systems over 1,000 l/s. Nothing else here is framed that way, so where
  this app exceeded AIRAH it was exceeding a hard limit rather than a target.
- **The riser column is capped at 10.0 m/s at every NR.** Two rows sat at 12.0.
- Its lowest row is NR 30. There is no AIRAH figure for a bedroom.

### What changed

| Row | Was | Now | Why |
|---|---|---|---|
| Open-plan office, NR 38 | 8.5 / 7.0 / 4.5 | **8.0** / 7.0 / 4.5 | 8.5 exceeded AIRAH's NR 40 absolute maximum (8.0), and NR 38 is the stricter condition |
| Retail / restaurant, NR 40 | 9.0 / 7.5 / 5.0 | **8.0 / 7.0** / 5.0 | was AIRAH's NR 45 row, not its NR 40 row |
| Back of house, NR 45+ | 12.0 / 9.0 / 6.0 | **10.0 / 8.0** / 6.0 | 20 % over the AIRAH riser cap and over CIBSE's industrial row; now AIRAH's NR 50 row exactly |
| Commercial kitchen | 12.0 / 8.0 / 8.0 | **10.0** / 8.0 / 8.0 | above the riser cap, and above the 9 m/s this app's own grease basis allows |

The kitchen row is the one worth dwelling on. The grease system's own 9 m/s cap
meant grease ducts never saw the space's 12.0 — `min(space, system)` quietly
masked it. **Make-up air through the same kitchen did see it**, because the
standard system has no cap of its own. An internal contradiction that only
surfaced on one of the two paths through the code. Both regression tests added.

Rows 1–3 came back inside the published spread and are unchanged.

### Flexible duct gets a limit back, and this one is sourced

AIRAH sw022 calls it reasonable present-day practice to limit a flexible runout
to **3.5 m/s**. The per-space flexible entries dropped in §8 were inert and
unsourced; this is neither, and it binds under most spaces' runout figures —
retail (5.0), back of house (6.0). Added as a single global cap, attributed to
whichever limit actually binds so a bedroom runout (2.5) is not blamed on AIRAH.

The same source allows twice the measured length when working out flexible
friction, which is the same arithmetic as the ×2 "15 % compressed" factor in
`FLEX_CONDITIONS` over a given run. Not a conflict; worth knowing.

### Confirmed, and left alone

- **1.0 Pa/m is defensible.** It sits between ASHRAE's usual 0.65–0.82 Pa/m and
  Ahern's 1.2 Pa/m, which AIRAH's own text calls higher than many designers use.
  At 1.0 the velocity cap only starts to govern around 1,850 l/s for 7.5 m/s and
  3,700 l/s for 9 m/s — so the caps bind on large mains and little else.
- **CIBSE Guide B Table 3.4's 5 / 7.5 / 10** is confirmed, but only for the
  *rectangular* row of "riser or above plasterboard ceiling". Circular gets
  7 / 10 / 15, and above a *suspended* ceiling it drops to 3 / 5 / 6 — a tighter
  case this app does not model.
- **ASHRAE's 1750 / 3000 fpm at RC 35** is confirmed from the primary, which
  settles §7's round-duct question: the ratio is real, it is Table 8, and it is
  still not a constant (1.4–1.95 across the table).

### The 80 / 50 role gradation is ASHRAE's, not universal

| Source | Branch ÷ main | Runout ÷ main |
|---|---|---|
| ASHRAE | 0.80 (stated rule) | ≤0.50 (stated rule) |
| AIRAH sw123 | 0.78–0.87 | 0.60–0.69 |
| CIBSE | 0.78–0.92 | ≈0.47–0.50 |
| This app | 0.67–0.88 | 0.50–0.67 |

§7 recorded the gradation as "corroborated by ASHRAE". It is corroborated by
ASHRAE specifically; AIRAH allows runouts 20–35 % faster than the 50 % rule.

### Open, and now narrower

- **CIBSE B2 (2016) Tables 2.17–2.19** — values unread; §2 of the research used
  Guide B (2005) Tables 3.2–3.5 as the stand-in. Table 2.16's title and first two
  rows were confirmed to match.
- **AIRAH DA03** velocity table — paywalled. The reported 10 m/s kitchen minimum
  is neither confirmed nor refuted; no source found states it.
- **ASHRAE Fundamentals Ch 21** — unreachable; whether it carries its own
  velocity table is unknown.
- **AS 1668.2 and 1668.1 clause text** — paywalled. The absence of an in-duct
  velocity requirement is consistent across every secondary source but remains
  absence of evidence. The 2024 edition exists and has renumbered the kitchen
  clauses, so cl. 5.10.3 is a 2002 reference.
- **CIBSE B2 Table 2.17** (medium/high-pressure duct, sized by pressure class
  rather than noise) is not modelled at all. Everything here assumes
  low-pressure work.

### Restaurants split out of retail

CIBSE bands restaurants with general offices at NR 35–40 (7.5 / 6.0 / 3.5), a
step below shops, so sharing a row with retail was letting a restaurant main run
at a shop's velocity. **Restaurant / café / bar** is now its own space at
7.5 / 6.0 / 4.0 — CIBSE's main and branch for that row, with the runout following
the office row rather than CIBSE's 3.5, which is tighter than anything else at
that band (AIRAH's NR 40 runout is 5.5).

The practical difference, on a 4,000 l/s main: restaurant gives Ø900 at 6.3 m/s,
retail Ø800 at 8.0 m/s.

Adding the eighth space broke the Settings picker. Eight chips overflowed the
segmented control at phone width — 490 px of content in 360 px — with no scroll,
so **Back of house and Commercial kitchen became uneditable**, silently. The
picker is now a select, matching the main page. Worth noting as the second time
a UI control has quietly stopped reaching part of its data; the first was the
role picker hidden for flexible duct while the role still drove the limit.
