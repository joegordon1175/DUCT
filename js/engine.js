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
 *   - Empirical A-weighted regenerated-noise estimate (CIBSE/Woods form).
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
 * basis); velocity, velocity pressure and noise use the *actual* face area,
 * because that is what the air in the duct is really doing.
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
    Re: equivalent.Re,
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

/** Smallest value in `list` that is >= value; falls back to a 50 mm round-up. */
export function snapUp(value, list) {
  for (const candidate of list) if (candidate >= value - 1e-9) return candidate;
  return Math.ceil(value / 50) * 50;
}

/** Largest value in `list` that is <= value; falls back to a 50 mm round-down,
 * floored at 50 mm so it never returns zero or negative. */
export function snapDown(value, list) {
  let best = null;
  for (const candidate of list) {
    if (candidate <= value + 1e-9) best = candidate;
  }
  if (best !== null) return best;
  return Math.max(50, Math.floor(value / 50) * 50);
}

/**
 * Standard size for "floor" sizing, where the target is a minimum velocity to
 * hold rather than a maximum not to exceed — kitchen grease extract, sized so
 * material stays entrained. Snapping *up* (the normal rule) would silently
 * drop the actual velocity below the target, defeating the point of sizing
 * on velocity at all. Picks the largest standard size that does not exceed
 * `idealMax` (the diameter/width at the target velocity); if that would also
 * fall below `floorMin` (the diameter/width at the max-velocity cap — a very
 * coarse size list skipping the whole valid range), falls back to the
 * smallest size that respects `floorMin` instead, since not exceeding the
 * velocity cap takes priority over holding the minimum.
 */
export function snapFloor(idealMax, floorMin, list) {
  const down = snapDown(idealMax, list);
  return down >= floorMin - 1e-9 ? down : snapUp(floorMin, list);
}

/**
 * Choose a rectangular width × height meeting a required equivalent diameter
 * and a minimum free area, preferring aspect ratios near `preferredAspect`
 * and never exceeding `maxAspect`.
 *
 * @param {object} opts
 *   @param {'up'|'down'} [opts.direction] 'up' (default) snaps each candidate
 *     width up to meet the target — correct when the target is a ceiling (a
 *     friction rate, or a maximum velocity). 'down' snaps down instead, for
 *     "floor" sizing where the target is a minimum velocity to hold and
 *     rounding up would push the actual velocity below it.
 * @returns {{width:number, height:number}} mm
 */
export function selectRectangular(requiredDeMm, minAreaMm2, sizes, opts = {}) {
  const { preferredAspect = 1.5, maxAspect = 4, maxHeightMm = Infinity, direction = 'up' } = opts;
  const pickWidth = (wExact, wForArea) =>
    direction === 'down' ? snapFloor(wExact, wForArea, sizes) : snapUp(Math.max(wExact, wForArea), sizes);
  let best = null;

  for (const h of sizes) {
    if (h > maxHeightMm) continue;
    const wExact = widthForEquivalentDiameter(h, requiredDeMm);
    const wForArea = minAreaMm2 > 0 ? minAreaMm2 / h : 0;
    const w = pickWidth(wExact, wForArea);
    const aspect = Math.max(w, h) / Math.min(w, h);
    if (aspect > maxAspect) continue;

    const area = w * h;
    // Rank on closeness to the preferred aspect first, then on wasted area.
    const score = Math.abs(Math.log(aspect / preferredAspect)) * 1000 + area / 1e6;
    if (!best || score < best.score) best = { width: w, height: h, score };
  }

  if (best) return { width: best.width, height: best.height };

  // Nothing satisfied the aspect limit (very large duct in a shallow void):
  // fall back to the shallowest allowed height and accept the aspect ratio.
  const h = Math.min(maxHeightMm, sizes[sizes.length - 1]);
  const wExact = widthForEquivalentDiameter(h, requiredDeMm);
  const wForArea = minAreaMm2 > 0 ? minAreaMm2 / h : 0;
  return { width: pickWidth(wExact, wForArea), height: h };
}

/* ------------------------------------------------------------------ *
 * Noise
 * ------------------------------------------------------------------ */

/**
 * A-weighted regenerated sound power of a duct element (indicative).
 *
 *   L_wA = 10 + 50 log₁₀(v) + 10 log₁₀(A) + 10 log₁₀(ζ)
 *
 * The v⁵·A form is the long-standing CIBSE/Woods rule of thumb for airflow
 * noise generated in ductwork; the ζ term scales it with the disturbance the
 * element causes, so a mitred bend reads ~9 dB above a smooth radius bend.
 * Straight duct uses ζ = 1. This is an estimate for comparing selections —
 * it is not a substitute for manufacturers' octave-band data.
 *
 * @param {number} velocity  m/s
 * @param {number} area      m²
 * @param {number} zeta      loss coefficient of the element (1 for straight duct)
 */
export function regeneratedNoise(velocity, area, zeta = 1) {
  if (!(velocity > 0) || !(area > 0)) return 0;
  return (
    10 +
    50 * Math.log10(velocity) +
    10 * Math.log10(area) +
    10 * Math.log10(Math.max(zeta, 0.05))
  );
}

/** Logarithmic (energy) sum of sound levels in dB. Ignores non-positive terms. */
export function combineLevels(levels) {
  const sum = levels.reduce((acc, L) => (L > 0 ? acc + Math.pow(10, L / 10) : acc), 0);
  return sum > 0 ? 10 * Math.log10(sum) : 0;
}

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
 */
export function pressureClass(staticPa, velocity) {
  if (staticPa <= 500 && velocity <= 10) return 'A';
  if (staticPa <= 1000 && velocity <= 20) return 'B';
  if (staticPa <= 2000 && velocity <= 40) return 'C';
  return 'C+';
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
  const dMaxVel = diameterForVelocity(flow, ctx.maxVelocity);
  // In floor mode dTargetVel (diameter at the slower, minimum velocity) is the
  // larger of the two and so already wins this max() — requiredD lands on the
  // loose end of the valid [dMaxVel, dTargetVel] diameter range, exactly the
  // ceiling that snapFloor below must not snap past.
  const requiredD = Math.max(dFriction, dTargetVel, dMaxVel); // m
  const minArea = ctx.maxVelocity > 0 ? flow / ctx.maxVelocity : 0; // m²

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
      const wExact = widthForEquivalentDiameter(heightMm, requiredD * 1000);
      const wArea = minArea > 0 ? (minArea * 1e6) / heightMm : 0;
      if (!useStandard) {
        // Round to a fabricable whole mm in whichever direction stays safe:
        // up for a ceiling target, down for a floor (minimum-velocity) one.
        widthMm = floorSizing ? Math.floor(Math.max(wExact, wArea)) : Math.ceil(Math.max(wExact, wArea));
      } else if (floorSizing) {
        widthMm = snapFloor(wExact, wArea, sizes);
      } else {
        widthMm = snapUp(Math.max(wExact, wArea), sizes);
      }
      sizedBy = 'height overridden';
    } else if (widthOverride) {
      widthMm = widthOverride;
      const hExact = widthForEquivalentDiameter(widthMm, requiredD * 1000); // symmetric
      const hArea = minArea > 0 ? (minArea * 1e6) / widthMm : 0;
      if (!useStandard) {
        heightMm = floorSizing ? Math.floor(Math.max(hExact, hArea)) : Math.ceil(Math.max(hExact, hArea));
      } else if (floorSizing) {
        heightMm = snapFloor(hExact, hArea, sizes);
      } else {
        heightMm = snapUp(Math.max(hExact, hArea), sizes);
      }
      sizedBy = 'width overridden';
    } else {
      const picked = selectRectangular(requiredD * 1000, minArea * 1e6, sizes, {
        preferredAspect: ctx.preferredAspect,
        maxAspect: ctx.maxAspect,
        maxHeightMm: ctx.maxHeightMm,
        direction: floorSizing ? 'down' : 'up',
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
    const noiseEach = fixed > 0 ? 0 : regeneratedNoise(hyd.velocity, hyd.area, zeta);
    return {
      ...fit,
      qty,
      zeta,
      each,
      total: each * qty,
      noise: noiseEach > 0 && qty > 0 ? noiseEach + 10 * Math.log10(qty) : 0,
    };
  });
  const fittingLoss = fittings.reduce((sum, f) => sum + f.total, 0);
  const zetaTotal = fittings.reduce((sum, f) => sum + f.zeta * f.qty, 0);

  const componentPa = Math.max(seg.componentPa ?? 0, 0);
  const totalLoss = straightLoss + fittingLoss + componentPa;

  // --- noise -------------------------------------------------------------
  const ductNoise =
    lengthM > 0 ? regeneratedNoise(hyd.velocity, hyd.area, 1) : 0;
  const noiseLwA = combineLevels([ductNoise, ...fittings.map((f) => f.noise)]);

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
    frictionFactor: hyd.f,
    frictionRate,
    lengthM,
    straightLoss,
    fittingLoss,
    componentPa,
    totalLoss,
    equivalentLengthM: frictionRate > 0 ? (fittingLoss + componentPa) / frictionRate : 0,
    zetaTotal,
    fittings,
    ductNoise,
    noiseLwA,
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
 *   @param {number} opts.roomCorrection  dB deducted from L_wA for room SPL
 *   @param {string} opts.leakageClass  DW/144 class for the leakage estimate
 */
export function calcRun(results, opts = {}) {
  const { plantPa = 0, marginPct = 10, roomCorrection = 9, leakageClass = 'A' } = opts;

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
  const noiseLwA = combineLevels(results.map((r) => r.noiseLwA));

  // Leakage is driven by mean duct pressure over the run, not the fan total.
  const meanPressure = totalPa / 2;
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
    noiseLwA,
    roomSpl: noiseLwA > 0 ? Math.max(noiseLwA - roomCorrection, 0) : 0,
    pressureClass: pressureClass(totalPa, maxVelocity),
    leakageClass,
    leakageLps,
    leakagePct: designFlow > 0 ? (leakageLps / designFlow) * 100 : 0,
    segments: results.length,
  };
}
