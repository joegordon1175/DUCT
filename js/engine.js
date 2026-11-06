/**
 * DUCT — HVAC ductwork sizing calculation engine.
 *
 * Pure functions, no DOM. SI units internally:
 *   length m, area m², airflow m³/s, velocity m/s, pressure Pa, density kg/m³.
 * Airflow crosses the UI boundary in l/s and duct sizes in mm; conversion
 * happens at the edges (`calcSegment` takes l/s and mm for convenience).
 *
 * Methods:
 *   - Darcy–Weisbach with the Colebrook–White friction factor (iterated to
 *     convergence) for straight duct.
 *   - ASHRAE circular equivalent diameter for rectangular duct, sized on
 *     "equal friction, equal flow".
 *   - Loss-coefficient (velocity-pressure) method for fittings.
 *   - Constant friction sizing, with an optional velocity FLOOR that overrides
 *     the friction target where sizing for Pa/m alone would leave the air too
 *     slack. On a transport system — grease, dust — that floor governs almost
 *     everywhere, which is what makes a separate constant-velocity mode
 *     unnecessary: the two produce identical selections wherever the floor binds.
 */

export const R_AIR = 287.055; // J/(kg·K), dry air

/* ------------------------------------------------------------------ *
 * Air properties
 * ------------------------------------------------------------------ */

/**
 * Air density and viscosity from temperature and altitude.
 * Barometric pressure via the ISA troposphere model, density via the ideal
 * gas law, dynamic viscosity via Sutherland's formula.
 *
 * @param {number} tempC       dry-bulb temperature, °C
 * @param {number} altitudeM   site altitude above sea level, m
 */
export function airProperties(tempC = 20, altitudeM = 0) {
  const T = tempC + 273.15;
  const pressurePa = 101325 * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
  const density = pressurePa / (R_AIR * T);
  const viscosity = (1.458e-6 * Math.pow(T, 1.5)) / (T + 110.4);
  return {
    tempC,
    altitudeM,
    pressurePa,
    density,
    viscosity,
    kinematic: viscosity / density,
  };
}

export const STANDARD_AIR = airProperties(20, 0);

/* ------------------------------------------------------------------ *
 * Friction factor
 * ------------------------------------------------------------------ */

/**
 * Darcy friction factor.
 * Laminar below Re 2300, Colebrook–White above Re 4000, linearly blended
 * across the critical zone so the result stays continuous.
 *
 * @param {number} Re                  Reynolds number
 * @param {number} relativeRoughness   ε/D, dimensionless
 */
export function frictionFactor(Re, relativeRoughness) {
  if (!(Re > 0)) return 0;
  if (Re < 2300) return 64 / Re;

  const colebrook = (re) => {
    let f = 0.02;
    for (let i = 0; i < 60; i++) {
      const invSqrtF = -2 * Math.log10(relativeRoughness / 3.7 + 2.51 / (re * Math.sqrt(f)));
      const next = 1 / (invSqrtF * invSqrtF);
      if (Math.abs(next - f) < 1e-12) return next;
      f = next;
    }
    return f;
  };

  if (Re < 4000) {
    const fLaminar = 64 / 2300;
    const fTurbulent = colebrook(4000);
    const x = (Re - 2300) / 1700;
    return fLaminar + (fTurbulent - fLaminar) * x;
  }
  return colebrook(Re);
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

/**
 * ASHRAE circular equivalent diameter — the round duct that carries the same
 * airflow at the same friction rate as the given rectangular duct.
 * De = 1.30 (a·b)^0.625 / (a+b)^0.25
 */
export function equivalentDiameter(width, height) {
  return (1.3 * Math.pow(width * height, 0.625)) / Math.pow(width + height, 0.25);
}

/** Hydraulic diameter of a rectangular duct: 4A/P. */
export function hydraulicDiameter(width, height) {
  return (2 * width * height) / (width + height);
}

/**
 * Rectangular width that yields a required equivalent diameter for a fixed
 * height. `equivalentDiameter` is dimensionally consistent, so this works in
 * whatever unit the caller uses — the bracket is grown from the inputs rather
 * than hard-coded. De is monotonic and unbounded in width, so bisect.
 */
export function widthForEquivalentDiameter(height, targetDe) {
  if (!(height > 0) || !(targetDe > 0)) return 0;
  let lo = 0;
  let hi = Math.max(targetDe, height);
  let guard = 0;
  while (equivalentDiameter(hi, height) < targetDe && guard++ < 200) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (equivalentDiameter(mid, height) < targetDe) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ------------------------------------------------------------------ *
 * Straight duct hydraulics
 * ------------------------------------------------------------------ */

/**
 * Friction rate and flow state for a round duct.
 *
 * @param {number} flow       m³/s
 * @param {number} diameter   m
 * @param {number} roughness  absolute roughness ε, m
 * @param {object} air        from `airProperties`
 */
export function roundHydraulics(flow, diameter, roughness, air = STANDARD_AIR) {
  const area = (Math.PI * diameter * diameter) / 4;
  const velocity = flow / area;
  const Re = (velocity * diameter) / air.kinematic;
  const f = frictionFactor(Re, roughness / diameter);
  const velocityPressure = 0.5 * air.density * velocity * velocity;
  const frictionRate = (f * velocityPressure) / diameter; // Pa/m
  return { area, velocity, Re, f, velocityPressure, frictionRate };
}

/**
 * Friction rate and flow state for a rectangular duct.
 *
 * Pressure is evaluated on the circular equivalent (ASHRAE equal-friction
 * basis); velocity and velocity pressure use the *actual* face area, because
 * that is what the air in the duct is really doing.
 *
 * Two Reynolds numbers come out of that, and conflating them is misleading:
 * `Re` is the duct's own (hydraulic diameter, actual velocity) and `ReEquivalent`
 * is the one the friction factor is taken at (equivalent diameter, equivalent
 * velocity). They differ by ~20 % on a 600 × 400, which matters not at all for
 * `f` — both are fully turbulent — but a reported "Reynolds number" should be
 * the duct's, not the equivalent round pipe's.
 */
export function rectangularHydraulics(flow, width, height, roughness, air = STANDARD_AIR) {
  const area = width * height;
  const velocity = flow / area;
  const De = equivalentDiameter(width, height);
  const Dh = hydraulicDiameter(width, height);
  const equivalent = roundHydraulics(flow, De, roughness, air);
  const velocityPressure = 0.5 * air.density * velocity * velocity;
  return {
    area,
    velocity,
    De,
    Dh,
    aspectRatio: Math.max(width, height) / Math.min(width, height),
    Re: (velocity * Dh) / air.kinematic,
    ReEquivalent: equivalent.Re,
    f: equivalent.f,
    velocityPressure,
    equivalentVelocity: equivalent.velocity,
    frictionRate: equivalent.frictionRate,
  };
}

/* ------------------------------------------------------------------ *
 * Sizing
 * ------------------------------------------------------------------ */

/**
 * Smallest diameter whose friction rate is at or below `targetPaPerM`.
 *
 * `multiplier(diameterM)` scales the straight-duct rate before the comparison —
 * the compressed-flexible correction, which depends on diameter, so it cannot
 * be applied by simply dividing the target. Both the base rate and the measured
 * correction fall as the duct gets bigger, so the product is still monotonic
 * and bisection still holds.
 */
export function diameterForFriction(flow, targetPaPerM, roughness, air = STANDARD_AIR, multiplier = () => 1) {
  if (!(flow > 0) || !(targetPaPerM > 0)) return 0;
  let lo = 0.02; // friction rate is monotonically decreasing in diameter
  let hi = 6;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (roundHydraulics(flow, mid, roughness, air).frictionRate * multiplier(mid) > targetPaPerM) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Pressure-drop correction for compressed flexible duct (PDCF), relative to the
 * same duct fully stretched:
 *
 *   PDCF = 1 + 58 · rc · e^(−0.00496·D)     rc = longitudinal compression ratio
 *                                           (0.15 = 15 %), D in mm
 *
 * ASHRAE Fundamentals (2009 SI onward), Duct Design chapter, Eq. 22, from Culp
 * (RP-1333). Valid 150–400 mm; the underlying data scatter ±20–30 %. Read from
 * secondary reproductions of the Handbook text. The Handbook's own check — 150 to
 * 400 mm at 70 % extended (rc 0.30) loses 3–9× fully extended — is reproduced.
 *
 * Cross-check: LBNL-49012 (Abushakra, Walker & Sherman, primary) fits
 * PDCF = 1 + k·rc with k = 25.35 / 21.61 / 16.18 at 150 / 200 / 250 mm. It agrees
 * within about 7 % (150 mm at 30 %: 8.6 against 9.3). The app used those fits
 * before; ASHRAE's form replaces them because it covers 300–400 mm, where holding
 * LBNL's 250 mm value overstated a 400 mm duct by ~55 %.
 *
 * Outside 150–400 mm there is no data in any set, so D is HELD at the nearest end
 * rather than extrapolated. Below 150 that is an extrapolation by assumption and
 * the app says so; holding at 150 understates rather than inflates, but small
 * flex already hits the friction ceiling first.
 *
 * The baseline it multiplies must be STRETCHED flex. Measured stretched flex is
 * close to sheet metal (Weaver & Culp 2007, ±2 %) and LBNL measured 10–35 % below
 * a 0.9 mm "medium rough" baseline, so non-metallic flex takes ε 0.9 mm in
 * data.js. A 3 mm roughness on top of this factor counted the penalty twice.
 */
export const FLEX_PDCF_RANGE_MM = [150, 400];

export function flexCompressionFactor(diameterMm, compressionRatio) {
  if (!(compressionRatio > 0) || !(diameterMm > 0)) return 1;
  const [lo, hi] = FLEX_PDCF_RANGE_MM;
  const d = Math.min(hi, Math.max(lo, diameterMm));
  return 1 + 58 * compressionRatio * Math.exp(-0.00496 * d);
}

/** Diameter that produces exactly `velocity`. */
export function diameterForVelocity(flow, velocity) {
  if (!(flow > 0) || !(velocity > 0)) return 0;
  return Math.sqrt((4 * flow) / (Math.PI * velocity));
}

/**
 * Smallest value in `list` that is >= value.
 *
 * When nothing in the list is big enough the answer is CLAMPED to the largest
 * listed size, never invented. The size list is what the user's supplier
 * actually holds, so rounding to an unlisted 50 mm multiple produced ducts
 * that cannot be bought (Ø1500 and Ø2100 off a list topping out at 1400).
 * `calcSegment` notices that the sizing rule was missed and reports it instead:
 * the honest answer is "nothing in your list works", not a duct that is not made.
 * The 50 mm fallback survives only for an empty list, where there is nothing
 * to clamp to.
 */
export function snapUp(value, list) {
  for (const candidate of list) if (candidate >= value - 1e-9) return candidate;
  if (list.length) return list[list.length - 1];
  return Math.max(50, Math.ceil(value / 50) * 50);
}

/**
 * Largest value in `list` that is <= value, clamped up to the smallest listed
 * size when nothing is small enough — same reasoning as `snapUp`. Below the
 * list this was the more damaging of the two, because floor sizing reaches it
 * on ordinary duties: a small kitchen canopy at 60–80 l/s was fabricating a
 * Ø100 round, and 40–60 l/s a 50 mm wide rectangular duct.
 */
export function snapDown(value, list) {
  let best = null;
  for (const candidate of list) {
    if (candidate <= value + 1e-9) best = candidate;
  }
  if (best !== null) return best;
  if (list.length) return list[0];
  return Math.max(50, Math.floor(value / 50) * 50);
}


/**
 * Bring a friction-sized dimension back inside a velocity band.
 *
 * `size` is what the friction target asked for; `lo` is the smallest dimension
 * the velocity CAP allows and `hi` the largest the velocity FLOOR allows. If
 * `size` already sits at or under `hi` the floor isn't breached and it stands.
 * Otherwise come down to the largest listed size under `hi`, provided that
 * still respects the cap.
 *
 * When the band holds no listed size at all — common for LEV on a 50 mm list,
 * where 22.5–25 m/s is only a 5 % diameter range — neither neighbour is valid,
 * and always taking the smaller one is wrong: moist dust at 1,500 l/s went to
 * Ø250 at 30.6 m/s, 22 % over the cap, when Ø300 missed the floor by 6 %. Take
 * whichever misses by less, as a ratio — velocity goes as 1/d² round and 1/w
 * at a fixed height, so the smaller ratio is the smaller velocity excursion
 * either way. `calcSegment` reports the miss; the size list is the real fix.
 */
export function clampToBand(size, lo, hi, list) {
  if (!Number.isFinite(hi) || size <= hi + 1e-9) return size;
  const down = snapDown(hi, list);
  if (down >= lo - 1e-9) return down;
  const up = snapUp(lo, list);
  const tooFast = down > 0 ? lo / down : Infinity;
  const tooSlow = hi > 0 ? up / hi : Infinity;
  return tooFast <= tooSlow ? down : up;
}

/**
 * Choose a rectangular width × height, preferring aspect ratios near
 * `preferredAspect` and never exceeding `maxAspect`.
 *
 * Width comes from the required equivalent diameter and is snapped up, then
 * bounded by the area ceiling. The two bounds constrain different quantities
 * and that distinction matters: `requiredDeMm` is an equal-*friction* diameter,
 * while a velocity limit is an AREA limit, because velocity is Q/(w·h). A
 * rectangular duct matching a round duct's De always has more area than it
 * (more perimeter per unit area, hence more friction), so sizing a velocity
 * bound on De systematically oversizes and undershoots the velocity. Pass the
 * area directly.
 *
 * @param {number} requiredDeMm  equivalent diameter target
 * @param {number} minAreaMm2    smallest allowed face area (area at max velocity)
 * @param {object} opts
 *   @param {number} [opts.maxAreaMm2] largest allowed face area (area at the
 *     minimum velocity), or Infinity where there is no velocity floor
 * @returns {{width:number, height:number}} mm
 */
export function selectRectangular(requiredDeMm, minAreaMm2, sizes, opts = {}) {
  const {
    preferredAspect = 1.5,
    maxAspect = 4,
    maxHeightMm = Infinity,
    maxAreaMm2 = Infinity,
  } = opts;

  const pickWidth = (h) => {
    const wExact = widthForEquivalentDiameter(h, requiredDeMm);
    const wForArea = minAreaMm2 > 0 ? minAreaMm2 / h : 0;
    const w = snapUp(Math.max(wExact, wForArea), sizes);
    // A velocity FLOOR is an area ceiling, and it overrides the friction
    // target: a duct sized for Pa/m alone can fall below the minimum velocity
    // on a small flow, so come back down — by the nearest-miss rule if the
    // band holds no listed width.
    const wCeiling = Number.isFinite(maxAreaMm2) ? maxAreaMm2 / h : Infinity;
    return clampToBand(w, wForArea, wCeiling, sizes);
  };

  let best = null;
  let nearest = null;
  for (const h of sizes) {
    if (h > maxHeightMm) continue;
    const w = pickWidth(h);
    const aspect = Math.max(w, h) / Math.min(w, h);
    if (aspect > maxAspect) continue;

    const area = w * h;
    // A candidate is only valid if it lands in the area band — otherwise it
    // silently breaches the minimum velocity the area ceiling stands for.
    const overBand = Number.isFinite(maxAreaMm2) && area > maxAreaMm2 + 1e-6;
    if (overBand) {
      // Keep the one that misses by least, in case the list holds nothing
      // inside the band at all — better than falling through to the largest
      // height on the list, which is what used to happen.
      const miss = area / maxAreaMm2;
      if (!nearest || miss < nearest.miss) nearest = { width: w, height: h, miss };
      continue;
    }

    // Rank on closeness to the preferred aspect first, then on wasted area.
    const score = Math.abs(Math.log(aspect / preferredAspect)) * 1000 + area / 1e6;
    if (!best || score < best.score) best = { width: w, height: h, score };
  }

  if (best) return { width: best.width, height: best.height };
  if (nearest) return { width: nearest.width, height: nearest.height };

  // Nothing satisfied the aspect limit (very large duct in a shallow void):
  // take the deepest LISTED height that fits under the void and accept the
  // aspect ratio. If no listed height fits at all, use the smallest one and let
  // calcSegment report the void as breached — inventing a height that isn't on
  // the list is the same fault as inventing a diameter. An empty list has
  // nothing to choose from, so fall back to 50 mm steps.
  if (!sizes.length) {
    const side = Math.max(50, Math.ceil(Math.sqrt(Math.max(minAreaMm2, 1)) / 50) * 50);
    return { width: side, height: Math.min(side, Number.isFinite(maxHeightMm) ? maxHeightMm : side) };
  }
  const fitting = sizes.filter((x) => x <= maxHeightMm + 1e-9);
  const h = fitting.length ? fitting[fitting.length - 1] : sizes[0];
  return { width: pickWidth(h), height: h };
}

/* ------------------------------------------------------------------ *
 * Noise — deliberately NOT modelled
 * ------------------------------------------------------------------ *
 * There was an indicative A-weighted regenerated-noise estimate here
 * (L_wA = 10 + 50 log₁₀ v + 10 log₁₀ A + 10 log₁₀ ζ, the CIBSE/Woods form).
 * It has been removed rather than improved, because it could not be made
 * trustworthy without octave-band data this app does not have:
 *
 *   - Every fixed-pressure item scored zero. Grilles, diffusers, silencers,
 *     filters and coils contributed nothing, and the terminal is normally the
 *     loudest thing in the room — a 150 l/s ceiling diffuser is typically
 *     published around 30–35 dBA, above the whole residential limit on its own.
 *   - There was no duct attenuation, and generated noise did not scale with
 *     length (0.5 m and 50 m of the same duct read identically), so upstream
 *     sound power was summed into the room level undiminished.
 *   - Those two errors run in opposite directions and cannot be netted off
 *     without the octave-band data that would have made the estimate
 *     unnecessary in the first place.
 *   - The residential check could not fire at any permitted velocity: 30 dBA
 *     room SPL needed 5.8–8.5 m/s depending on size, against a 5.0 m/s cap.
 *
 * Velocity limits remain the app's noise control, which is how CIBSE Guide B3
 * and ASHRAE present them anyway. For an actual acoustic assessment, use
 * manufacturers' sound-power data for the terminals and a proper attenuation
 * calculation.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Leakage & pressure class
 * ------------------------------------------------------------------ */

/** DW/144 & EN 12237 leakage factors: q = k · p^0.65 (l/s per m² of duct). */
export const LEAKAGE_FACTORS = { A: 0.027, B: 0.009, C: 0.003, D: 0.001 };

export function leakageRate(pressurePa, ductClass = 'A') {
  const k = LEAKAGE_FACTORS[ductClass] ?? LEAKAGE_FACTORS.A;
  return k * Math.pow(Math.max(pressurePa, 0), 0.65); // l/s per m²
}

/**
 * DW/144 construction class from operating static pressure and velocity.
 * Class A ≤ 500 Pa / 10 m/s, B ≤ 1000 Pa / 20 m/s, C ≤ 2000 Pa / 40 m/s.
 *
 * These are the POSITIVE-pressure limits. DW/144 caps suction tighter for
 * classes B and C — see `NEGATIVE_CLASS_B_LIMIT` below.
 */
export function pressureClass(staticPa, velocity) {
  if (staticPa <= 500 && velocity <= 10) return 'A';
  if (staticPa <= 1000 && velocity <= 20) return 'B';
  if (staticPa <= 2000 && velocity <= 40) return 'C';
  return 'C+';
}

/**
 * DW/144 class-B limit on the negative (suction) side, where the failure mode
 * is the duct collapsing rather than leaking — so the cap is lower than the
 * 1000 Pa allowed on the positive side.
 *
 * Treat as indicative and confirm against the standard before relying on it;
 * the app only uses it to raise a "check this" flag, never to silently
 * re-classify a run.
 */
export const NEGATIVE_CLASS_B_LIMIT = 750; // Pa

/**
 * True when a run's pressure falls in the band where the DW/144 class depends
 * on which side of the fan the duct sits: class B read on the positive limits,
 * but past the negative class-B cap, so an extract run may need class C.
 *
 * Only ~750–1000 Pa is affected. Below that both readings agree; above ~1000 Pa
 * the positive limits reach class C anyway, so they agree again.
 */
export function pressureClassDependsOnSign(staticPa, velocity) {
  return pressureClass(staticPa, velocity) === 'B' && staticPa > NEGATIVE_CLASS_B_LIMIT;
}

/* ------------------------------------------------------------------ *
 * Segment calculation
 * ------------------------------------------------------------------ */

/**
 * Size and evaluate one duct segment.
 *
 * @param {object} seg
 *   @param {number} seg.airflowLps    duty, l/s
 *   @param {'circular'|'rectangular'|'flexible'} seg.shape
 *   @param {number} seg.lengthM       straight run, m
 *   @param {number} [seg.heightMm]    height / diameter override, mm
 *   @param {number} [seg.widthMm]     width override, mm (rectangular only)
 *   @param {Array}  [seg.fittings]    [{ id, name, zeta, qty, fixedPa }]
 *   @param {number} [seg.componentPa] extra fixed loss (terminal, coil…), Pa
 * @param {object} ctx
 *   @param {object} ctx.air           from `airProperties`
 *   @param {number} ctx.roughness     absolute roughness ε, m
 *   @param {number} [ctx.flexCompression]  flexible-duct compression ratio
 *     (0.15 = 15 %), applied through `flexCompressionFactor` (ASHRAE Eq. 22).
 *     Omitted or 0 = stretched duct.
 *   @param {number} ctx.targetFriction  Pa/m. The project target for rigid
 *     duct; for flexible duct the app passes its friction CEILING instead,
 *     on the compressed rate.
 *   @param {number} [ctx.minVelocity]  m/s floor — the duct may not be sized so
 *     large that the air drops below it. On a small flow this OVERRIDES the
 *     friction target (grease, dust).
 *   @param {number} ctx.maxVelocity     m/s cap (acoustic, system, or flex)
 *   @param {number[]} ctx.roundSizes, ctx.rectSizes   mm
 *   @param {boolean} ctx.useStandardSizes
 *   @param {number} ctx.preferredAspect, ctx.maxAspect, ctx.maxHeightMm
 */
export function calcSegment(seg, ctx) {
  const air = ctx.air ?? STANDARD_AIR;
  // Coerce rather than trust: NaN or text here used to run straight through
  // and come out as NaN in every figure.
  const rawFlow = Number(seg.airflowLps);
  const flow = Number.isFinite(rawFlow) && rawFlow > 0 ? rawFlow / 1000 : 0; // m³/s
  const roughness = ctx.roughness ?? 0.00009;
  // Flexible duct: diameter-dependent compression correction. Anything else,
  // or an invalid ratio, is 1.
  const compression =
    seg.shape === 'flexible' && Number.isFinite(ctx.flexCompression) && ctx.flexCompression > 0
      ? ctx.flexCompression
      : 0;
  const flexAt = (diameterM) => (compression > 0 ? flexCompressionFactor(diameterM * 1000, compression) : 1);
  const rectangular = seg.shape === 'rectangular';
  const sizes = rectangular ? ctx.rectSizes : ctx.roundSizes;
  const useStandard = ctx.useStandardSizes !== false;

  const heightOverride = positive(seg.heightMm);
  const widthOverride = rectangular ? positive(seg.widthMm) : null;

  // --- required equivalent diameter from the sizing rule -----------------
  // The flexible-duct compression factor multiplies the friction RATE below,
  // so sizing applies the same factor at each trial diameter. (Inflating the
  // roughness instead would under-size badly — it only enters logarithmically.)
  const dFriction = diameterForFriction(flow, ctx.targetFriction, roughness, air, flexAt);

  // The minimum velocity the duct must hold. It overrides the friction target
  // on small flows, where sizing for Pa/m alone would leave the duct too big
  // and the air too slack — and on a transport system (grease, dust) it is the
  // governing figure almost everywhere.
  const minVelocity = Math.max(ctx.minVelocity ?? 0, 0);
  const dMinVelocity = minVelocity > 0 ? diameterForVelocity(flow, minVelocity) : Infinity;

  const maxVelocity = ctx.maxVelocity > 0 ? ctx.maxVelocity : Infinity;
  const dMaxVel = diameterForVelocity(flow, maxVelocity);
  const requiredD = Math.max(dFriction, dMaxVel); // m
  const minArea = maxVelocity > 0 ? flow / maxVelocity : 0; // m²
  // A minimum velocity is a maximum AREA, not a maximum equivalent diameter —
  // velocity is Q/A. Rectangular sizing has to use this rather than requiredD,
  // which (being an equal-friction diameter) maps to a larger area for a
  // rectangular duct and would undershoot the velocity.
  const maxArea = minVelocity > 0 ? flow / minVelocity : Infinity; // m²

  // --- pick dimensions ---------------------------------------------------
  let widthMm = null;
  let heightMm = null;
  let sizedBy = 'calculated';

  if (rectangular) {
    if (heightOverride && widthOverride) {
      widthMm = widthOverride;
      heightMm = heightOverride;
      sizedBy = 'both overridden';
    } else if (heightOverride) {
      heightMm = heightOverride;
      // The width has to be at least `wNeeded` (equivalent diameter, and the
      // area floor that the velocity cap sets) and at most `wCeiling` (the area
      // ceiling that the velocity floor sets). Snapping up from the lower bound
      // can overshoot the upper one, so come back down when it does — the same
      // clamp the round branch applies.
      const wCeiling = Number.isFinite(maxArea) ? (maxArea * 1e6) / heightMm : Infinity;
      const wNeeded = Math.max(
        widthForEquivalentDiameter(heightMm, requiredD * 1000),
        minArea > 0 ? (minArea * 1e6) / heightMm : 0
      );
      const wCap = minArea > 0 ? (minArea * 1e6) / heightMm : 0;
      if (!useStandard) {
        // Same 0 mm trap as the round path: zero flow, or a floor on a trickle.
        const exact = Math.min(Math.ceil(wNeeded), Math.floor(wCeiling));
        widthMm = flow > 0 ? Math.max(exact, 1) : (sizes?.[0] ?? 50);
      } else {
        widthMm = clampToBand(snapUp(wNeeded, sizes), wCap, wCeiling, sizes);
      }
      sizedBy = 'height overridden';
    } else if (widthOverride) {
      widthMm = widthOverride;
      const hCeiling = Number.isFinite(maxArea) ? (maxArea * 1e6) / widthMm : Infinity;
      const hNeeded = Math.max(
        widthForEquivalentDiameter(widthMm, requiredD * 1000), // symmetric
        minArea > 0 ? (minArea * 1e6) / widthMm : 0
      );
      const hCap = minArea > 0 ? (minArea * 1e6) / widthMm : 0;
      if (!useStandard) {
        const exact = Math.min(Math.ceil(hNeeded), Math.floor(hCeiling));
        heightMm = flow > 0 ? Math.max(exact, 1) : (sizes?.[0] ?? 50);
      } else {
        heightMm = clampToBand(snapUp(hNeeded, sizes), hCap, hCeiling, sizes);
      }
      sizedBy = 'width overridden';
    } else {
      const picked = selectRectangular(requiredD * 1000, minArea * 1e6, sizes, {
        preferredAspect: ctx.preferredAspect,
        maxAspect: ctx.maxAspect,
        maxHeightMm: ctx.maxHeightMm,
        maxAreaMm2: Number.isFinite(maxArea) ? maxArea * 1e6 : Infinity,
      });
      widthMm = picked.width;
      heightMm = picked.height;
    }
  } else {
    if (heightOverride) {
      heightMm = heightOverride;
      sizedBy = 'diameter overridden';
    } else if (!useStandard) {
      // Exact sizing can reach 0 mm — zero airflow, or a velocity floor on a
      // trickle — and a 0 mm duct turns every downstream figure into 0/0 = NaN.
      // With nothing flowing, show the smallest listed size, as the rectangular
      // path already does; otherwise never go below 1 mm.
      const exact = Math.min(Math.ceil(requiredD * 1000), Math.floor(dMinVelocity * 1000));
      heightMm = flow > 0 ? Math.max(exact, 1) : (sizes?.[0] ?? 50);
    } else {
      // Velocity floor overrides the friction target on small flows.
      heightMm = clampToBand(snapUp(requiredD * 1000, sizes), dMaxVel * 1000, dMinVelocity * 1000, sizes);
    }
  }

  // --- hydraulics --------------------------------------------------------
  const h = heightMm / 1000;
  const w = (widthMm ?? 0) / 1000;
  const hyd = rectangular
    ? rectangularHydraulics(flow, w, h, roughness, air)
    : roundHydraulics(flow, h, roughness, air);

  const flexFactor = seg.shape === 'flexible' ? flexAt(h) : 1;
  const frictionRate = hyd.frictionRate * flexFactor; // Pa/m
  const lengthM = Math.max(seg.lengthM ?? 0, 0);
  const straightLoss = frictionRate * lengthM;

  // --- fittings ----------------------------------------------------------
  const fittings = (seg.fittings ?? []).map((fit) => {
    const qty = Math.max(fit.qty ?? 1, 0);
    const zeta = Math.max(fit.zeta ?? 0, 0);
    const fixed = Math.max(fit.fixedPa ?? 0, 0);
    const each = fixed > 0 ? fixed : zeta * hyd.velocityPressure;
    return { ...fit, qty, zeta, each, total: each * qty };
  });
  const fittingLoss = fittings.reduce((sum, f) => sum + f.total, 0);
  const zetaTotal = fittings.reduce((sum, f) => sum + f.zeta * f.qty, 0);

  const componentPa = Math.max(seg.componentPa ?? 0, 0);
  const totalLoss = straightLoss + fittingLoss + componentPa;

  // --- did the selection actually satisfy the sizing rule? ---------------
  // With sizes clamped to the configured list (see `snapUp`/`snapDown`) a duty
  // can fall outside what the list can serve: below the smallest size a kitchen
  // run cannot reach its transport minimum, above the largest one a friction
  // target cannot be met. Report it rather than inventing a size or quietly
  // missing the target — the fix is to add sizes to the list, which only the
  // user can decide.
  const tol = 1.001;
  const overMax = maxVelocity > 0 && hyd.velocity > maxVelocity * tol;
  const underMin = minVelocity > 0 && hyd.velocity < minVelocity / tol;
  const overFriction = ctx.targetFriction > 0 && frictionRate > ctx.targetFriction * tol;

  // Exceeding the friction target BECAUSE the velocity floor overrode it is the
  // design intent, not a failure to size. The test is tight: sizing on friction
  // alone can only ever give a duct at or above `dFriction`, whose rate is at or
  // under the target — so a rate above the target on an automatically sized duct
  // means something forced it smaller, and the floor is the only thing that does.
  const floorOverrodeFriction =
    minVelocity > 0 && sizedBy === 'calculated' && hyd.velocity >= minVelocity / tol;
  const ruleMet = !(overMax || underMin || (overFriction && !floorOverrodeFriction));

  // --- geometry extras ---------------------------------------------------
  const perimeter = rectangular ? 2 * (w + h) : Math.PI * h;
  const surfaceArea = perimeter * lengthM; // m²

  return {
    shape: seg.shape,
    sizedBy,
    widthMm: rectangular ? widthMm : null,
    heightMm,
    label: rectangular ? `${widthMm} × ${heightMm} mm` : `Ø${heightMm} mm`,
    area: hyd.area,
    velocity: hyd.velocity,
    velocityPressure: hyd.velocityPressure,
    equivalentDiameterMm: rectangular ? hyd.De * 1000 : heightMm,
    hydraulicDiameterMm: rectangular ? hyd.Dh * 1000 : heightMm,
    aspectRatio: rectangular ? hyd.aspectRatio : 1,
    reynolds: hyd.Re,
    // For rectangular duct the friction factor is taken at the circular
    // equivalent, so this is the Re that `frictionFactor` belongs to. Equal to
    // `reynolds` for round duct.
    reynoldsEquivalent: hyd.ReEquivalent ?? hyd.Re,
    frictionFactor: hyd.f,
    frictionRate,
    lengthM,
    straightLoss,
    fittingLoss,
    componentPa,
    totalLoss,
    // Only meaningful for velocity-pressure fittings: a fixed-Pa component has
    // no equivalent length, so `fittingsEquivalentLengthM` excludes them and
    // the older combined figure is kept only for continuity.
    equivalentLengthM: frictionRate > 0 ? (fittingLoss + componentPa) / frictionRate : 0,
    fittingsEquivalentLengthM:
      frictionRate > 0 ? fittings.reduce((s, f) => s + (f.zeta > 0 ? f.total : 0), 0) / frictionRate : 0,
    zetaTotal,
    fittings,
    ruleMet,
    sizeLimited: !ruleMet && sizedBy === 'calculated',
    // A ceiling void the listed heights can't fit under. Not part of ruleMet —
    // it is a coordination problem, not a sizing one — but it must be said.
    exceedsMaxHeight:
      rectangular && Number.isFinite(ctx.maxHeightMm) && heightMm > ctx.maxHeightMm + 1e-9,
    maxVelocityApplied: Number.isFinite(maxVelocity) ? maxVelocity : 0,
    minVelocityApplied: minVelocity,
    exceedsMaxVelocity: overMax,
    belowMinVelocity: underMin,
    exceedsFrictionTarget: overFriction,
    // True when that excess is the velocity floor doing its job rather than a
    // selection that missed — the UI says so instead of crying wolf.
    velocityFloorOverrode: overFriction && floorOverrodeFriction,
    surfaceArea,
    flexFactor,
    flow,
  };
}

function positive(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ------------------------------------------------------------------ *
 * Run (branch) totals
 * ------------------------------------------------------------------ */

/**
 * Total a series of segments as one index branch.
 *
 * @param {object[]} results   outputs of `calcSegment`, in flow order
 * @param {object} opts
 *   @param {number} opts.plantPa       fixed plant/terminal allowance, Pa
 *   @param {number} opts.marginPct     fan selection margin, %
 *   @param {string} opts.leakageClass  DW/144 class for the leakage estimate
 */
export function calcRun(results, opts = {}) {
  const { plantPa = 0, marginPct = 10, leakageClass = 'A' } = opts;

  const ductPa = results.reduce((sum, r) => sum + r.totalLoss, 0);
  const totalPa = ductPa + Math.max(plantPa, 0);
  const maxVelocity = results.reduce((m, r) => Math.max(m, r.velocity), 0);
  // For floor-sized runs (kitchen grease extract) the weakest link is the
  // SLOWEST segment, not the fastest — that's the one at risk of settling.
  const minVelocity = results.length
    ? results.reduce((m, r) => Math.min(m, r.velocity), Infinity)
    : 0;
  const surfaceArea = results.reduce((sum, r) => sum + r.surfaceArea, 0);
  const lengthM = results.reduce((sum, r) => sum + r.lengthM, 0);

  // Leakage is driven by the mean pressure INSIDE THE DUCT, so the plant
  // allowance is excluded: a coil, filter or grease-filter bank is not duct
  // static pressure. Including it inflated the figure badly — 450 Pa of plant
  // on a 70 Pa duct run read 3.7x high, 900 Pa read 5.5x high.
  const meanPressure = ductPa / 2;
  const leakageLps = leakageRate(meanPressure, leakageClass) * surfaceArea;
  const designFlow = results.length ? results[0].flow * 1000 : 0;

  return {
    ductPa,
    plantPa: Math.max(plantPa, 0),
    totalPa,
    fanDutyPa: totalPa * (1 + Math.max(marginPct, 0) / 100),
    marginPct,
    maxVelocity,
    minVelocity,
    lengthM,
    surfaceArea,
    rulesMet: results.every((r) => r.ruleMet !== false),
    sizeLimited: results.some((r) => r.sizeLimited === true),
    // Construction class stays on the fan total, unlike leakage above. The app
    // cannot know whether the plant allowance sits upstream or downstream of
    // the duct, and the duct must be built for the worst case; over-specifying
    // sheet metal is cheap, under-specifying it is not.
    pressureClass: pressureClass(totalPa, maxVelocity),
    leakageClass,
    leakageLps,
    leakagePct: designFlow > 0 ? (leakageLps / designFlow) * 100 : 0,
    segments: results.length,
  };
}
