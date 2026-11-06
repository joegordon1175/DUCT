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
 *   - Two sizing modes: "ceiling" (constant friction rate; velocity is only
 *     ever checked, never sized to) and "floor" (constant velocity sized to
 *     a MINIMUM, e.g. kitchen grease extract, where standard sizes snap down
 *     instead of up so the built duct can't fall below the target).
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

/** Smallest diameter whose friction rate is at or below `targetPaPerM`. */
export function diameterForFriction(flow, targetPaPerM, roughness, air = STANDARD_AIR) {
  if (!(flow > 0) || !(targetPaPerM > 0)) return 0;
  let lo = 0.02; // friction rate is monotonically decreasing in diameter
  let hi = 6;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (roundHydraulics(flow, mid, roughness, air).frictionRate > targetPaPerM) lo = mid;
    else hi = mid;
  }
  return hi;
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
 * Standard size for "floor" sizing, where the target velocity is a minimum to
 * hold rather than a maximum not to exceed — kitchen grease extract, sized so
 * material stays entrained. Snapping *up* (the normal rule) would silently drop
 * the actual velocity below the target, defeating the point of sizing on
 * velocity at all.
 *
 * `idealMax` is the diameter (or width) at the target minimum velocity and
 * `floorMin` the one at the max-velocity cap, so [floorMin, idealMax] is the
 * band satisfying both. Normally the largest listed size at or below `idealMax`
 * lands inside it.
 *
 * When the list skips the band entirely neither candidate is valid, and the only
 * choice left is which limit to breach. A fixed priority is wrong in both
 * directions: on a coarse list, holding the velocity cap can mean jumping to
 * nearly double the diameter (6.3 m/s against a 7.5 m/s minimum), while holding
 * the minimum can mean running at 25 m/s. Pick whichever sits closer to the
 * band instead, as a ratio — velocity goes as 1/d² for round duct and 1/w at a
 * fixed height, so the smaller ratio is the smaller velocity excursion either
 * way. Whichever is picked, `calcSegment` reports the rule as unmet.
 */
export function snapFloor(idealMax, floorMin, list) {
  const down = snapDown(idealMax, list);
  if (down >= floorMin - 1e-9 && down <= idealMax + 1e-9) return down;
  const up = snapUp(floorMin, list);
  // `down` clamped up past the band: the duty is below everything listed, so
  // the smallest listed size is the only answer and `up` already is it.
  if (down > idealMax + 1e-9) return up;
  const tooSmallBy = down > 0 ? floorMin / down : Infinity;
  const tooBigBy = idealMax > 0 ? up / idealMax : Infinity;
  return tooSmallBy <= tooBigBy ? down : up;
}

/**
 * Choose a rectangular width × height, preferring aspect ratios near
 * `preferredAspect` and never exceeding `maxAspect`.
 *
 * The two sizing modes constrain *different quantities*, which is why the
 * width is solved differently in each:
 *
 *   'up' (default, friction target) — the constraint is the equivalent
 *   diameter, so the width comes from `requiredDeMm` and is snapped up.
 *
 *   'down' (velocity floor) — the constraint is AREA, not De. Velocity is
 *   Q/(w·h), so a minimum velocity is a maximum area. De is an equal-*friction*
 *   diameter: a rectangular duct matching a round duct's De always has more
 *   area than it (more perimeter per unit area, hence more friction), so
 *   sizing on De here systematically oversizes and drops the velocity below
 *   the minimum it was meant to hold. Pass the area band instead.
 *
 * @param {number} requiredDeMm  equivalent diameter target — 'up' mode only
 * @param {number} minAreaMm2    smallest allowed face area (area at max velocity)
 * @param {object} opts
 *   @param {'up'|'down'} [opts.direction]
 *   @param {number} [opts.maxAreaMm2] largest allowed face area (area at the
 *     minimum velocity) — required in 'down' mode, ignored in 'up' mode.
 * @returns {{width:number, height:number}} mm
 */
export function selectRectangular(requiredDeMm, minAreaMm2, sizes, opts = {}) {
  const {
    preferredAspect = 1.5,
    maxAspect = 4,
    maxHeightMm = Infinity,
    direction = 'up',
    maxAreaMm2 = Infinity,
  } = opts;

  const pickWidth = (h) => {
    if (direction === 'down') {
      // Widths that keep the face area inside [minArea, maxArea] for this height.
      const wUpper = Number.isFinite(maxAreaMm2) ? maxAreaMm2 / h : Infinity;
      const wLower = minAreaMm2 > 0 ? minAreaMm2 / h : 0;
      return snapFloor(wUpper, wLower, sizes);
    }
    const wExact = widthForEquivalentDiameter(h, requiredDeMm);
    const wForArea = minAreaMm2 > 0 ? minAreaMm2 / h : 0;
    return snapUp(Math.max(wExact, wForArea), sizes);
  };

  let best = null;
  let nearest = null;
  for (const h of sizes) {
    if (h > maxHeightMm) continue;
    const w = pickWidth(h);
    const aspect = Math.max(w, h) / Math.min(w, h);
    if (aspect > maxAspect) continue;

    const area = w * h;
    // In floor mode a candidate is only valid if it actually lands in the
    // area band — otherwise it silently breaches the velocity it was sized to.
    const overBand =
      direction === 'down' && Number.isFinite(maxAreaMm2) && area > maxAreaMm2 + 1e-6;
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
  // fall back to the shallowest allowed height and accept the aspect ratio.
  const h = Math.min(maxHeightMm, sizes[sizes.length - 1]);
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
 *   @param {number} ctx.flexFactor    flexible-duct compression multiplier
 *   @param {'friction'|'velocity'} ctx.method  'friction' sizes to a target
 *     friction rate ("ceiling" mode — velocity limits are a check, not a
 *     sizing input). 'velocity' sizes to `targetVelocity` as a MINIMUM
 *     ("floor" mode — kitchen grease extract, where too slow lets material
 *     settle out of the airstream) and snaps standard sizes down instead of
 *     up so the built duct never falls below it.
 *   @param {number} ctx.targetFriction  Pa/m, used when method is 'friction'
 *   @param {number} ctx.targetVelocity  m/s, used when method is 'velocity'
 *   @param {number} ctx.maxVelocity     m/s, hard cap for sizing in both modes
 *   @param {number} [ctx.maxFriction]   Pa/m ceiling, 'velocity' mode only —
 *     the small-duct guard. Sizing to a minimum velocity puts no lower bound on
 *     duct size, so a small duty picks something tiny and screaming. A friction
 *     ceiling sets a minimum diameter, which for a given flow is just an upper
 *     bound on velocity, so it is folded into the effective maximum below.
 *   @param {number[]} ctx.roundSizes, ctx.rectSizes   mm
 *   @param {boolean} ctx.useStandardSizes
 *   @param {number} ctx.preferredAspect, ctx.maxAspect, ctx.maxHeightMm
 */
export function calcSegment(seg, ctx) {
  const air = ctx.air ?? STANDARD_AIR;
  const flow = Math.max(seg.airflowLps ?? 0, 0) / 1000; // m³/s
  const roughness = ctx.roughness ?? 0.00009;
  // Guarded > 0: it divides the friction target when sizing, below.
  const rawFlexFactor = seg.shape === 'flexible' ? (ctx.flexFactor ?? 1) : 1;
  const flexFactor = Number.isFinite(rawFlexFactor) && rawFlexFactor > 0 ? rawFlexFactor : 1;
  const rectangular = seg.shape === 'rectangular';
  const sizes = rectangular ? ctx.rectSizes : ctx.roundSizes;
  const useStandard = ctx.useStandardSizes !== false;
  const floorSizing = ctx.method === 'velocity'; // target is a minimum, not a ceiling

  const heightOverride = positive(seg.heightMm);
  const widthOverride = rectangular ? positive(seg.widthMm) : null;

  // --- required equivalent diameter from the sizing rule -----------------
  // The flexible-duct compression factor is applied to the friction RATE
  // below (`frictionRate = base * flexFactor`), so sizing has to invert that
  // same model: find the diameter whose *uncompressed* rate is target/factor.
  // Inflating the roughness instead would be a different model entirely —
  // roughness only enters logarithmically, so it under-sizes badly (a 4x
  // factor came out ~2.4x over target).
  const dFriction = floorSizing
    ? 0
    : diameterForFriction(flow, ctx.targetFriction / flexFactor, roughness, air);
  const dTargetVel = floorSizing ? diameterForVelocity(flow, ctx.targetVelocity) : 0;

  // A Pa/m ceiling is a minimum diameter, and at a fixed flow a minimum
  // diameter is a maximum velocity — so convert it and take whichever cap binds
  // first. Doing it here means the whole of the sizing below, round and
  // rectangular alike, needs no further knowledge of it.
  const frictionCeiling = floorSizing ? Math.max(ctx.maxFriction ?? 0, 0) : 0;
  const dFrictionCap =
    frictionCeiling > 0 ? diameterForFriction(flow, frictionCeiling, roughness, air) : 0;
  const velocityAtFrictionCap =
    dFrictionCap > 0 ? flow / ((Math.PI * dFrictionCap * dFrictionCap) / 4) : Infinity;
  const maxVelocity =
    ctx.maxVelocity > 0 ? Math.min(ctx.maxVelocity, velocityAtFrictionCap) : velocityAtFrictionCap;
  // Which constraint actually set the ceiling, for the UI to name.
  const capSource =
    Number.isFinite(velocityAtFrictionCap) && velocityAtFrictionCap < (ctx.maxVelocity ?? Infinity)
      ? 'friction'
      : 'noise';

  const dMaxVel = diameterForVelocity(flow, maxVelocity);
  // In floor mode dTargetVel (diameter at the slower, minimum velocity) is the
  // larger of the two and so already wins this max() — requiredD lands on the
  // loose end of the valid [dMaxVel, dTargetVel] diameter range, exactly the
  // ceiling that snapFloor below must not snap past.
  const requiredD = Math.max(dFriction, dTargetVel, dMaxVel); // m
  const minArea = maxVelocity > 0 ? flow / maxVelocity : 0; // m²
  // Floor mode constrains AREA, not equivalent diameter — velocity is Q/A, so
  // the minimum velocity is a maximum area. Rectangular sizing must use this
  // rather than requiredD, which (being an equal-friction diameter) maps to a
  // larger area for a rectangular duct and would undershoot the velocity.
  const maxArea = floorSizing && ctx.targetVelocity > 0 ? flow / ctx.targetVelocity : Infinity; // m²

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
      // Floor mode: the other dimension is bounded by the area band. Ceiling
      // mode: by the equivalent diameter, with the area only as a floor.
      const wUpper = floorSizing
        ? (maxArea * 1e6) / heightMm
        : widthForEquivalentDiameter(heightMm, requiredD * 1000);
      const wLower = minArea > 0 ? (minArea * 1e6) / heightMm : 0;
      if (!useStandard) {
        // Round to a fabricable whole mm in whichever direction stays safe:
        // up for a ceiling target, down for a floor (minimum-velocity) one.
        widthMm = floorSizing ? Math.floor(wUpper) : Math.ceil(Math.max(wUpper, wLower));
      } else if (floorSizing) {
        widthMm = snapFloor(wUpper, wLower, sizes);
      } else {
        widthMm = snapUp(Math.max(wUpper, wLower), sizes);
      }
      sizedBy = 'height overridden';
    } else if (widthOverride) {
      widthMm = widthOverride;
      const hUpper = floorSizing
        ? (maxArea * 1e6) / widthMm
        : widthForEquivalentDiameter(widthMm, requiredD * 1000); // symmetric
      const hLower = minArea > 0 ? (minArea * 1e6) / widthMm : 0;
      if (!useStandard) {
        heightMm = floorSizing ? Math.floor(hUpper) : Math.ceil(Math.max(hUpper, hLower));
      } else if (floorSizing) {
        heightMm = snapFloor(hUpper, hLower, sizes);
      } else {
        heightMm = snapUp(Math.max(hUpper, hLower), sizes);
      }
      sizedBy = 'width overridden';
    } else {
      const picked = selectRectangular(requiredD * 1000, minArea * 1e6, sizes, {
        preferredAspect: ctx.preferredAspect,
        maxAspect: ctx.maxAspect,
        maxHeightMm: ctx.maxHeightMm,
        direction: floorSizing ? 'down' : 'up',
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
      heightMm = floorSizing ? Math.floor(requiredD * 1000) : Math.ceil(requiredD * 1000);
    } else if (floorSizing) {
      heightMm = snapFloor(requiredD * 1000, dMaxVel * 1000, sizes);
    } else {
      heightMm = snapUp(requiredD * 1000, sizes);
    }
  }

  // --- hydraulics --------------------------------------------------------
  const h = heightMm / 1000;
  const w = (widthMm ?? 0) / 1000;
  const hyd = rectangular
    ? rectangularHydraulics(flow, w, h, roughness, air)
    : roundHydraulics(flow, h, roughness, air);

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
  const underMin =
    floorSizing && ctx.targetVelocity > 0 && hyd.velocity < ctx.targetVelocity / tol;
  const overFriction = floorSizing
    ? frictionCeiling > 0 && frictionRate > frictionCeiling * tol
    : ctx.targetFriction > 0 && frictionRate > ctx.targetFriction * tol;
  const ruleMet = !(overMax || underMin || overFriction);

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
    maxVelocityApplied: Number.isFinite(maxVelocity) ? maxVelocity : 0,
    // 'friction' when the Pa/m ceiling bound the duct before the acoustic
    // limit did — the UI names the right one rather than blaming noise.
    velocityCapSource: capSource,
    frictionCeiling,
    exceedsMaxVelocity: overMax,
    belowMinVelocity: underMin,
    exceedsFrictionTarget: overFriction,
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
