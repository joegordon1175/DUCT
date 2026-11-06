# DUCT — calculation method & assumptions review

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

## 5. Suggested order of work

1. **D3** — leakage basis. One line, no behavioural risk, removes a figure that
   is up to 5× out.
2. **D1/D2** — refuse to leave the size list. Clamp to the list and raise a flag
   saying no listed size can hold the target, rather than inventing Ø100 or
   50 mm wide. Also settles the `snapFloor` cap-vs-minimum priority question.
3. **A1** — give terminals a noise contribution, or state plainly in the UI that
   the dBA figure is duct-generated noise only and excludes terminals. The second
   is honest and costs nothing.
4. **A4** — a kitchen-extract temperature default, or a prompt.
5. The rest are documentation: A5, A6, A7, A8, A9 are all correct-as-designed
   and only need saying out loud.
