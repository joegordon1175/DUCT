import test from 'node:test';
import assert from 'node:assert/strict';

import {
  airProperties,
  frictionFactor,
  equivalentDiameter,
  hydraulicDiameter,
  widthForEquivalentDiameter,
  roundHydraulics,
  rectangularHydraulics,
  diameterForFriction,
  diameterForVelocity,
  snapUp,
  snapDown,
  selectRectangular,
  clampToBand,
  leakageRate,
  pressureClass,
  pressureClassDependsOnSign,
  NEGATIVE_CLASS_B_LIMIT,
  calcSegment,
  calcRun,
  STANDARD_AIR,
} from '../js/engine.js';

import {
  ROUND_SIZES,
  RECT_SIZES,
  SPACE_TYPES,
  SYSTEM_TYPES,
  maxVelocity,
  minVelocity,
  systemType,
  DUST_CLASSES,
  dustClass,
  spaceType,
} from '../js/data.js';

/* The acoustic scale runs from the tightest room to the least critical.
   Commercial kitchen sits outside it deliberately — it is a special case, not a
   rung on the ladder — so the ordering checks below exclude it. */
const ACOUSTIC_SCALE = SPACE_TYPES.filter((s) => s.id !== 'kitchen');

const close = (actual, expected, tol, msg) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ?? ''} expected ${expected} ±${tol}, got ${actual}`
  );

/* ---------------------------------------------------------------- *
 * Air properties
 * ---------------------------------------------------------------- */

test('standard air at 20 °C, sea level', () => {
  const air = airProperties(20, 0);
  close(air.pressurePa, 101325, 1, 'barometric pressure');
  close(air.density, 1.2041, 0.001, 'density');
  close(air.viscosity, 1.8136e-5, 1e-7, 'dynamic viscosity');
  close(air.kinematic, 1.506e-5, 1e-7, 'kinematic viscosity');
});

test('density falls with altitude and temperature', () => {
  assert.ok(airProperties(20, 1500).density < airProperties(20, 0).density);
  assert.ok(airProperties(40, 0).density < airProperties(20, 0).density);
  // 1500 m ISA pressure is ~84.6 kPa
  close(airProperties(20, 1500).pressurePa, 84556, 200, 'pressure at 1500 m');
});

/* ---------------------------------------------------------------- *
 * Friction factor — checked against the Moody chart
 * ---------------------------------------------------------------- */

test('laminar friction factor is 64/Re', () => {
  close(frictionFactor(1000, 0.001), 0.064, 1e-9);
  close(frictionFactor(2000, 0), 0.032, 1e-9);
});

test('Colebrook matches Moody chart values', () => {
  // Smooth pipe, Re 1e5 — Blasius gives 0.0178
  close(frictionFactor(1e5, 0), 0.0180, 0.0006, 'smooth, Re 1e5');
  // ε/D = 0.001, Re 1e5 → 0.0222
  close(frictionFactor(1e5, 0.001), 0.0222, 0.0005, 'ε/D 0.001, Re 1e5');
  // ε/D = 0.01, fully rough → 0.038
  close(frictionFactor(1e7, 0.01), 0.0380, 0.0008, 'ε/D 0.01, fully rough');
});

test('friction factor is continuous through the critical zone', () => {
  const below = frictionFactor(2299, 0.0003);
  const above = frictionFactor(2301, 0.0003);
  close(above, below, 0.002, 'no step at Re 2300');
  const atBlend = frictionFactor(3999, 0.0003);
  const atTurbulent = frictionFactor(4001, 0.0003);
  close(atTurbulent, atBlend, 0.001, 'no step at Re 4000');
});

/* ---------------------------------------------------------------- *
 * Geometry — checked against ASHRAE equivalent-diameter tables
 * ---------------------------------------------------------------- */

test('circular equivalent diameter matches ASHRAE table', () => {
  close(equivalentDiameter(300, 300), 328, 1, '300×300');
  close(equivalentDiameter(400, 200), 305, 1, '400×200');
  close(equivalentDiameter(600, 300), 457, 1, '600×300');
  close(equivalentDiameter(1000, 500), 762, 2, '1000×500');
});

test('hydraulic diameter of a square duct equals its side', () => {
  close(hydraulicDiameter(300, 300), 300, 1e-9);
  close(hydraulicDiameter(400, 200), 266.67, 0.01);
});

test('width solver inverts the equivalent diameter', () => {
  const w = widthForEquivalentDiameter(300, 457);
  close(w, 600, 1, 'solve 600 from h=300, De=457');
  close(equivalentDiameter(w, 300), 457, 0.01, 'round trip');
});

/* ---------------------------------------------------------------- *
 * Straight duct hydraulics — checked against a ductulator
 * ---------------------------------------------------------------- */

test('500 l/s in Ø315 galvanised duct', () => {
  const hyd = roundHydraulics(0.5, 0.315, 0.00009, STANDARD_AIR);
  close(hyd.velocity, 6.42, 0.02, 'velocity');
  close(hyd.Re, 134200, 500, 'Reynolds');
  close(hyd.f, 0.0186, 0.0004, 'friction factor');
  close(hyd.velocityPressure, 24.8, 0.2, 'velocity pressure');
  close(hyd.frictionRate, 1.46, 0.05, 'friction rate Pa/m');
});

test('100 l/s in Ø150 galvanised duct', () => {
  const hyd = roundHydraulics(0.1, 0.15, 0.00009, STANDARD_AIR);
  close(hyd.velocity, 5.66, 0.02, 'velocity');
  close(hyd.frictionRate, 2.6, 0.3, 'friction rate Pa/m');
});

test('rectangular duct uses actual area for velocity, De for friction', () => {
  const hyd = rectangularHydraulics(0.5, 0.4, 0.2, 0.00009, STANDARD_AIR);
  close(hyd.velocity, 6.25, 0.01, 'actual velocity = Q/(w·h)');
  close(hyd.De * 1000, 305, 1, 'equivalent diameter');
  close(hyd.aspectRatio, 2, 1e-9, 'aspect ratio');
  // Friction must match the equivalent round duct carrying the same flow
  const round = roundHydraulics(0.5, hyd.De, 0.00009, STANDARD_AIR);
  close(hyd.frictionRate, round.frictionRate, 1e-9, 'equal-friction basis');
});

test('rougher duct always loses more pressure', () => {
  const smooth = roundHydraulics(0.5, 0.315, 0.00003, STANDARD_AIR).frictionRate;
  const galv = roundHydraulics(0.5, 0.315, 0.00009, STANDARD_AIR).frictionRate;
  const flex = roundHydraulics(0.5, 0.315, 0.003, STANDARD_AIR).frictionRate;
  assert.ok(smooth < galv, 'smooth < galvanised');
  assert.ok(galv < flex, 'galvanised < flexible');
  assert.ok(flex / galv > 1.5, 'flexible is materially worse');
});

/* ---------------------------------------------------------------- *
 * Sizing
 * ---------------------------------------------------------------- */

test('constant-friction sizing hits the target', () => {
  const d = diameterForFriction(0.5, 1.0, 0.00009, STANDARD_AIR);
  close(d, 0.34, 0.015, '500 l/s at 1 Pa/m ≈ Ø340');
  const check = roundHydraulics(0.5, d, 0.00009, STANDARD_AIR);
  close(check.frictionRate, 1.0, 0.01, 'solved diameter reproduces the target');
});

test('constant-velocity sizing hits the target', () => {
  const d = diameterForVelocity(0.5, 5);
  close(d, 0.3568, 0.001);
  close(roundHydraulics(0.5, d, 0.00009, STANDARD_AIR).velocity, 5, 1e-9);
});

test('larger flow needs a larger duct at the same friction rate', () => {
  const small = diameterForFriction(0.1, 1.0, 0.00009, STANDARD_AIR);
  const large = diameterForFriction(1.0, 1.0, 0.00009, STANDARD_AIR);
  assert.ok(large > small);
});

/* The snap helpers are pure list arithmetic, so they're tested against a fixed
   local list rather than the shipped defaults — those are user-editable data
   that can legitimately change, and pinning tests to them turns a defaults
   change into a wall of unrelated failures. */
const SNAP_LIST = [100, 150, 200, 250, 300, 400, 500];

test('snapUp picks the next size at or above the value', () => {
  assert.equal(snapUp(260, SNAP_LIST), 300);
  assert.equal(snapUp(300, SNAP_LIST), 300, 'an exact match is used as-is');
  assert.equal(snapUp(301, SNAP_LIST), 400);
});

test('the snap helpers never leave the list', () => {
  // The list is what the supplier holds. Inventing a 50 mm multiple outside it
  // produced sizes that cannot be bought — Ø1500 off a list ending at 1400, and
  // worse at the bottom, a Ø100 round and a 50 mm wide rectangular duct.
  assert.equal(snapUp(600, SNAP_LIST), 500, 'above the list, clamps to the largest size');
  assert.equal(snapUp(99999, SNAP_LIST), 500);
  assert.equal(snapDown(50, SNAP_LIST), 100, 'below the list, clamps to the smallest size');
  assert.equal(snapDown(1, SNAP_LIST), 100);
  // Only an empty list has nothing to clamp to.
  assert.equal(snapUp(260, []), 300);
  assert.equal(snapDown(260, []), 250);
});

test('snapDown picks the previous size at or below the value', () => {
  assert.equal(snapDown(299, SNAP_LIST), 250);
  assert.equal(snapDown(300, SNAP_LIST), 300, 'an exact match is used as-is');
  assert.equal(snapDown(399, SNAP_LIST), 300);
});

test('rectangular selection respects the aspect limit and area floor', () => {
  const picked = selectRectangular(457, 0, RECT_SIZES, { maxAspect: 4, preferredAspect: 1.5 });
  const aspect = Math.max(picked.width, picked.height) / Math.min(picked.width, picked.height);
  assert.ok(aspect <= 4, `aspect ${aspect} within limit`);
  assert.ok(
    equivalentDiameter(picked.width, picked.height) >= 457,
    'meets the required equivalent diameter'
  );
});

test('rectangular selection honours a ceiling void height limit', () => {
  const picked = selectRectangular(457, 0, RECT_SIZES, { maxHeightMm: 250 });
  assert.ok(picked.height <= 250, `height ${picked.height} fits the void`);
  assert.ok(equivalentDiameter(picked.width, picked.height) >= 457);
});

test('rectangular selection lands inside the area band', () => {
  // A velocity limit is constrained by AREA, not equivalent diameter — velocity
  // is Q/(w·h). An earlier version of this test asserted De instead, which
  // encoded the bug: a rectangular duct matching a round duct's De has more
  // area than it, so De-based sizing undershot the minimum velocity.
  // 500 l/s over a 6–8 m/s band: area must be within [62 500, 83 333] mm².
  const minArea = (0.5 / 8) * 1e6;
  const maxArea = (0.5 / 6) * 1e6;
  const picked = selectRectangular(0, minArea, RECT_SIZES, { maxAreaMm2: maxArea });
  const area = picked.width * picked.height;
  assert.ok(
    area >= minArea - 1e-6 && area <= maxArea + 1e-6,
    `${picked.width}×${picked.height} = ${area} mm² must sit within [${minArea.toFixed(0)}, ${maxArea.toFixed(0)}]`
  );
});

test('rectangular sizing holds a velocity band across realistic duties', () => {
  // Regression for the De-vs-area bug: with a 6–8 m/s band this used to land
  // at 5.71 m/s — below the minimum — for most flows. Written against the
  // friction path with a velocity floor, which is what replaced the separate
  // constant-velocity mode; the floor binds throughout, so the selections are
  // the ones the old mode made.
  for (const lps of [250, 500, 1000, 2000, 4000]) {
    const r = calcSegment(
      { airflowLps: lps, shape: 'rectangular', lengthM: 10 },
      ctx({ minVelocity: 6, maxVelocity: 8 })
    );
    assert.ok(
      r.velocity >= 6 - 1e-6 && r.velocity <= 8 + 1e-6,
      `${lps} l/s -> ${r.label} = ${r.velocity.toFixed(2)} m/s, outside the 6–8 m/s band`
    );
  }
});

test('rectangular sizing respects a height override and the velocity band', () => {
  const r = calcSegment(
    { airflowLps: 1000, shape: 'rectangular', lengthM: 10, heightMm: 300 },
    ctx({ minVelocity: 6, maxVelocity: 8 })
  );
  assert.equal(r.heightMm, 300, 'height held');
  assert.ok(
    r.velocity >= 6 - 1e-6 && r.velocity <= 8 + 1e-6,
    `${r.label} = ${r.velocity.toFixed(2)} m/s, outside the 6–8 m/s band`
  );
});

/* ---------------------------------------------------------------- *
 * Leakage & pressure class
 * ---------------------------------------------------------------- */

test('DW/144 leakage classes', () => {
  // Class A at 400 Pa: 0.027 × 400^0.65
  close(leakageRate(400, 'A'), 0.027 * Math.pow(400, 0.65), 1e-9);
  assert.ok(leakageRate(400, 'B') < leakageRate(400, 'A'));
  assert.ok(leakageRate(400, 'C') < leakageRate(400, 'B'));
  assert.equal(leakageRate(0, 'A'), 0);
});

test('pressure class follows DW/144 limits', () => {
  assert.equal(pressureClass(300, 8), 'A');
  assert.equal(pressureClass(600, 8), 'B');
  assert.equal(pressureClass(300, 15), 'B');
  assert.equal(pressureClass(1500, 25), 'C');
  assert.equal(pressureClass(2500, 45), 'C+');
});

test('sign-dependent pressure class band is 750–1000 Pa and no wider', () => {
  // Below the negative class-B cap both readings agree.
  assert.equal(pressureClassDependsOnSign(300, 8), false, '300 Pa is class A either way');
  assert.equal(pressureClassDependsOnSign(700, 8), false, 'still inside negative class B');
  assert.equal(pressureClassDependsOnSign(NEGATIVE_CLASS_B_LIMIT, 8), false, 'exactly at the cap is fine');
  // Inside the band: positive limits say B, negative limits would say C.
  assert.equal(pressureClassDependsOnSign(800, 8), true);
  assert.equal(pressureClassDependsOnSign(1000, 8), true, 'top of the band still ambiguous');
  // Above it the positive limits reach C anyway, so they agree again.
  assert.equal(pressureClassDependsOnSign(1001, 8), false, 'positive limits reach C — no disagreement');
  assert.equal(pressureClassDependsOnSign(1500, 25), false);
  // Velocity alone can force C, which also removes the ambiguity.
  assert.equal(pressureClassDependsOnSign(900, 25), false, 'velocity already forces class C');
});

/* ---------------------------------------------------------------- *
 * Segment calculation
 * ---------------------------------------------------------------- */

/* Segment tests run against fixed size lists, not the shipped defaults. The
   defaults are user-editable data and do change (they've moved from the EN 1506
   preferred-number series to 50 mm increments); pinning hand-checked numbers to
   them makes a legitimate data change look like an engine regression. */
const TEST_ROUND = [
  63, 80, 100, 125, 150, 160, 180, 200, 224, 250, 280, 315, 355, 400, 450, 500,
  560, 630, 710, 800, 900, 1000,
];
const TEST_RECT = [
  100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800,
  850, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1800, 2000,
];

const ctx = (over = {}) => ({
  air: STANDARD_AIR,
  roughness: 0.00009,
  flexFactor: 1,
  method: 'friction',
  targetFriction: 1.0,
  targetVelocity: 5,
  maxVelocity: 6,
  roundSizes: TEST_ROUND,
  rectSizes: TEST_RECT,
  useStandardSizes: true,
  preferredAspect: 1.5,
  maxAspect: 4,
  maxHeightMm: Infinity,
  ...over,
});

test('circular segment sizes, snaps and totals correctly', () => {
  const r = calcSegment(
    { airflowLps: 500, shape: 'circular', lengthM: 10, fittings: [{ id: 'r90_15', zeta: 0.15, qty: 2 }] },
    ctx()
  );
  assert.equal(r.heightMm, 355, 'snaps up to Ø355');
  assert.equal(r.label, 'Ø355 mm');
  close(r.velocity, 5.05, 0.05, 'velocity');
  close(r.frictionRate, 0.79, 0.06, 'friction rate');
  close(r.straightLoss, r.frictionRate * 10, 1e-9, 'straight loss = rate × length');
  close(r.fittingLoss, 2 * 0.15 * r.velocityPressure, 1e-9, 'fitting loss = n·ζ·Pv');
  close(r.totalLoss, r.straightLoss + r.fittingLoss, 1e-9, 'segment total');
});

test('diameter override is respected exactly', () => {
  const r = calcSegment({ airflowLps: 500, shape: 'circular', lengthM: 5, heightMm: 250 }, ctx());
  assert.equal(r.heightMm, 250);
  assert.equal(r.sizedBy, 'diameter overridden');
  close(r.velocity, 0.5 / (Math.PI * 0.125 ** 2), 0.01, 'velocity from the override');
});

test('velocity cap overrides the friction target when it binds', () => {
  // A 2 m/s cap forces a much larger duct than 1 Pa/m would give
  const capped = calcSegment({ airflowLps: 500, shape: 'circular', lengthM: 1 }, ctx({ maxVelocity: 2 }));
  const free = calcSegment({ airflowLps: 500, shape: 'circular', lengthM: 1 }, ctx({ maxVelocity: 20 }));
  assert.ok(capped.heightMm > free.heightMm, 'cap enlarges the duct');
  assert.ok(capped.velocity <= 2.01, `velocity ${capped.velocity} respects the cap`);
});

/* ---------------------------------------------------------------- *
 * Floor-mode (constant velocity, minimum transport velocity) sizing —
 * kitchen grease extract, where the failure mode is velocity too LOW, so
 * standard sizes must snap down rather than up.
 * ---------------------------------------------------------------- */

test('naive snap-up would violate a minimum transport velocity — the bug floor mode fixes', () => {
  // 300 l/s at exactly the 10 m/s minimum needs Ø195.5; the old rule (always
  // snap up) would land on Ø200, which undershoots the minimum.
  const undershoot = roundHydraulics(0.3, 0.2, 0.00009, STANDARD_AIR).velocity;
  assert.ok(undershoot < 10, `Ø200 gives ${undershoot.toFixed(2)} m/s, below the 10 m/s minimum it was meant to hold`);
});

test('floor-mode circular sizing snaps down and holds the minimum velocity', () => {
  const r = calcSegment(
    { airflowLps: 300, shape: 'circular', lengthM: 5 },
    ctx({ minVelocity: 10, maxVelocity: 20 })
  );
  assert.equal(r.heightMm, 180, 'snaps DOWN to Ø180, not up to Ø200');
  assert.ok(r.velocity >= 10 - 1e-6, `velocity ${r.velocity} must not fall below the 10 m/s minimum`);
  assert.ok(r.velocity <= 20 + 1e-6, `velocity ${r.velocity} must respect the 20 m/s cap`);
});

test('floor-mode rectangular auto-select holds the minimum velocity', () => {
  const r = calcSegment(
    { airflowLps: 300, shape: 'rectangular', lengthM: 5 },
    ctx({ minVelocity: 10, maxVelocity: 20 })
  );
  assert.ok(r.velocity >= 10 - 1e-6, `velocity ${r.velocity} must not fall below the 10 m/s minimum`);
  assert.ok(r.velocity <= 20 + 1e-6, `velocity ${r.velocity} must respect the 20 m/s cap`);
});

test('floor-mode rectangular height override solves a width that holds the minimum velocity', () => {
  const r = calcSegment(
    { airflowLps: 300, shape: 'rectangular', lengthM: 5, heightMm: 150 },
    ctx({ minVelocity: 10, maxVelocity: 20 })
  );
  assert.equal(r.heightMm, 150, 'height held');
  assert.ok(r.velocity >= 10 - 1e-6, `velocity ${r.velocity} must not fall below the 10 m/s minimum`);
  assert.ok(r.velocity <= 20 + 1e-6, `velocity ${r.velocity} must respect the 20 m/s cap`);
});

test('floor-mode sizing without standard sizes rounds the diameter down, not up', () => {
  // Ceiling mode rounds a fractional mm UP (safe: never undersizes the duct).
  // Floor mode must round DOWN instead, or the same sub-mm rounding that's
  // harmless for a friction target would shave the minimum transport
  // velocity below its target.
  const r = calcSegment(
    { airflowLps: 300, shape: 'circular', lengthM: 5 },
    ctx({ minVelocity: 10, maxVelocity: 20, useStandardSizes: false })
  );
  close(r.heightMm, 195, 0.5, 'floors the exact 195.44 mm diameter to 195 mm');
  assert.ok(r.velocity >= 10 - 1e-6, `velocity ${r.velocity} must not fall below the 10 m/s minimum`);
});

test('rectangular height override drives the width', () => {
  const r = calcSegment(
    { airflowLps: 500, shape: 'rectangular', lengthM: 10, heightMm: 200 },
    ctx()
  );
  assert.equal(r.heightMm, 200, 'height held');
  assert.ok(r.widthMm > 200, 'width solved');
  assert.equal(r.sizedBy, 'height overridden');
  assert.ok(
    equivalentDiameter(r.widthMm, 200) >= diameterForFriction(0.5, 1.0, 0.00009, STANDARD_AIR) * 1000 - 1,
    'meets the friction target'
  );
});

test('rectangular width override drives the height', () => {
  const r = calcSegment(
    { airflowLps: 500, shape: 'rectangular', lengthM: 10, widthMm: 600 },
    ctx()
  );
  assert.equal(r.widthMm, 600, 'width held');
  assert.equal(r.sizedBy, 'width overridden');
  assert.ok(r.heightMm > 0 && r.heightMm < 600);
});

test('both rectangular overrides are used verbatim', () => {
  const r = calcSegment(
    { airflowLps: 500, shape: 'rectangular', lengthM: 10, widthMm: 400, heightMm: 200 },
    ctx()
  );
  assert.equal(r.widthMm, 400);
  assert.equal(r.heightMm, 200);
  assert.equal(r.label, '400 × 200 mm');
  close(r.velocity, 0.5 / 0.08, 1e-9, 'velocity from the actual face area');
  close(r.equivalentDiameterMm, 305, 1, 'reports De');
  close(r.aspectRatio, 2, 1e-9);
});

test('flexible duct compression multiplies the friction rate', () => {
  const extended = calcSegment(
    { airflowLps: 200, shape: 'flexible', lengthM: 6, heightMm: 200 },
    ctx({ roughness: 0.003, flexFactor: 1 })
  );
  const compressed = calcSegment(
    { airflowLps: 200, shape: 'flexible', lengthM: 6, heightMm: 200 },
    ctx({ roughness: 0.003, flexFactor: 2 })
  );
  close(compressed.frictionRate, extended.frictionRate * 2, 1e-9);
  close(compressed.straightLoss, extended.straightLoss * 2, 1e-9);
});

test('compressed flexible duct is SIZED to actually hit the friction target', () => {
  // Regression: sizing used to inflate roughness by the compression factor
  // while reporting multiplied the friction rate by it — two different models.
  // Roughness only enters logarithmically, so the duct came out far too small
  // and the reported rate overshot the target (4x factor -> ~2.4x over).
  // Exact sizing (no standard-size snapping) so only the model is under test.
  // The diameter is still rounded up to a whole mm, and dp/m falls steeply with
  // diameter (~D^-5), so the rate lands just *under* target by up to ~2 %.
  for (const flexFactor of [1, 2, 4]) {
    const r = calcSegment(
      { airflowLps: 200, shape: 'flexible', lengthM: 6 },
      ctx({ roughness: 0.003, flexFactor, targetFriction: 1.0, maxVelocity: 20, useStandardSizes: false })
    );
    assert.ok(
      r.frictionRate <= 1.0 + 1e-9,
      `flexFactor ${flexFactor}: rounding the diameter up must not overshoot the target, got ${r.frictionRate}`
    );
    close(r.frictionRate, 1.0, 0.025, `flexFactor ${flexFactor} must land on the 1.0 Pa/m target`);
  }
});

test('compression makes the sized duct larger, not smaller', () => {
  const size = (flexFactor) =>
    calcSegment(
      { airflowLps: 200, shape: 'flexible', lengthM: 6 },
      ctx({ roughness: 0.003, flexFactor, targetFriction: 1.0, maxVelocity: 20, useStandardSizes: false })
    ).heightMm;
  assert.ok(size(2) > size(1), 'a 15 % compressed run needs a bigger duct than an extended one');
  assert.ok(size(4) > size(2), 'a 30 % compressed run needs a bigger duct again');
});

test('a zero or invalid flex factor cannot divide the friction target', () => {
  for (const flexFactor of [0, NaN, undefined, -1]) {
    const r = calcSegment(
      { airflowLps: 200, shape: 'flexible', lengthM: 6 },
      ctx({ roughness: 0.003, flexFactor, targetFriction: 1.0, maxVelocity: 20 })
    );
    assert.ok(Number.isFinite(r.frictionRate) && r.frictionRate > 0, `flexFactor ${flexFactor} stays finite`);
    assert.ok(Number.isFinite(r.heightMm) && r.heightMm > 0, `flexFactor ${flexFactor} gives a real size`);
  }
});

test('fixed-loss fittings ignore ζ and use Pa directly', () => {
  const r = calcSegment(
    {
      airflowLps: 100,
      shape: 'circular',
      lengthM: 0,
      fittings: [{ id: 'grille', fixedPa: 25, qty: 2 }],
    },
    ctx()
  );
  close(r.fittingLoss, 50, 1e-9, '2 × 25 Pa');
  close(r.totalLoss, 50, 1e-9);
});

test('equivalent length reflects the fitting losses', () => {
  const r = calcSegment(
    { airflowLps: 500, shape: 'circular', lengthM: 10, fittings: [{ zeta: 1.0, qty: 1 }] },
    ctx()
  );
  close(r.equivalentLengthM, r.fittingLoss / r.frictionRate, 1e-9);
});

test('surface area matches the duct perimeter', () => {
  const round = calcSegment({ airflowLps: 500, shape: 'circular', lengthM: 10, heightMm: 300 }, ctx());
  close(round.surfaceArea, Math.PI * 0.3 * 10, 1e-9);
  const rect = calcSegment(
    { airflowLps: 500, shape: 'rectangular', lengthM: 10, widthMm: 400, heightMm: 200 },
    ctx()
  );
  close(rect.surfaceArea, 2 * (0.4 + 0.2) * 10, 1e-9);
});

test('zero airflow degrades gracefully', () => {
  const r = calcSegment({ airflowLps: 0, shape: 'circular', lengthM: 5 }, ctx());
  assert.ok(Number.isFinite(r.totalLoss), 'no NaN');
  assert.equal(r.totalLoss, 0);
});

/* ---------------------------------------------------------------- *
 * Sizing never leaves the configured size list
 * ---------------------------------------------------------------- */

test('a duty the size list cannot serve is reported, not met with an unlisted size', () => {
  // Below the smallest listed size nothing can hold the transport minimum, and
  // saying so is the honest answer. Ø63 is the smallest in TEST_ROUND and only
  // reaches 7.5 m/s at ~23 l/s; on the shipped list Ø150 needs 133 l/s, which is
  // an ordinary small-canopy duty. Previously this fabricated a Ø100 round and a
  // 50 mm wide rectangular duct, unflagged, and made the selection
  // non-monotonic: more airflow gave a bigger duct and a LOWER velocity.
  const velCtx = ctx({ minVelocity: 7.5, maxVelocity: 12 });
  let lastVelocity = 0;
  for (const airflowLps of [5, 10, 15, 20, 23]) {
    const r = calcSegment({ airflowLps, shape: 'circular', lengthM: 5 }, velCtx);
    assert.ok(TEST_ROUND.includes(r.heightMm), `Ø${r.heightMm} must be a listed size`);
    assert.equal(r.sizeLimited, true, `${airflowLps} l/s cannot reach the minimum`);
    assert.equal(r.belowMinVelocity, true);
    assert.ok(r.velocity > lastVelocity, 'more airflow must not give a lower velocity');
    lastVelocity = r.velocity;
  }
  // Rectangular too: 100 mm is the smallest listed, never 50. 100 x 100 holds
  // 7.5 m/s only from 75 l/s up.
  for (const airflowLps of [20, 40, 60]) {
    const r = calcSegment({ airflowLps, shape: 'rectangular', lengthM: 5 }, velCtx);
    assert.ok(TEST_RECT.includes(r.widthMm), `width ${r.widthMm} must be listed`);
    assert.ok(TEST_RECT.includes(r.heightMm), `height ${r.heightMm} must be listed`);
  }
  // And once the duty is servable, nothing is flagged.
  const ok = calcSegment({ airflowLps: 250, shape: 'circular', lengthM: 5 }, velCtx);
  assert.equal(ok.sizeLimited, false);
  assert.equal(ok.ruleMet, true);
});

test('a duty past the top of the list is reported, not rounded to an unlisted size', () => {
  const big = calcSegment({ airflowLps: 30000, shape: 'circular', lengthM: 5 }, ctx());
  assert.equal(big.heightMm, TEST_ROUND[TEST_ROUND.length - 1], 'clamped to the largest listed size');
  assert.equal(big.sizeLimited, true);
  assert.ok(big.exceedsFrictionTarget || big.exceedsMaxVelocity);
});

test('an override that misses the target is reported but is not a list limit', () => {
  // The user chose this size, so the fix is not "add sizes to your list".
  const r = calcSegment({ airflowLps: 500, shape: 'circular', lengthM: 5, heightMm: 200 }, ctx());
  assert.equal(r.sizedBy, 'diameter overridden');
  assert.equal(r.ruleMet, false);
  assert.equal(r.exceedsFrictionTarget, true);
  assert.equal(r.sizeLimited, false);
});

test('equivalent length covers fittings only, not fixed-Pa components', () => {
  // A dirty filter is not 260 m of duct, which is what the combined figure read.
  const r = calcSegment(
    {
      airflowLps: 400,
      shape: 'circular',
      lengthM: 10,
      fittings: [{ zeta: 0.15, qty: 3 }, { fixedPa: 150, qty: 1 }],
    },
    ctx()
  );
  const zetaOnly = 3 * 0.15 * r.velocityPressure;
  close(r.fittingsEquivalentLengthM, zetaOnly / r.frictionRate, 1e-9);
  assert.ok(
    r.equivalentLengthM > r.fittingsEquivalentLengthM * 10,
    'the combined figure is kept for continuity and is much larger'
  );
});

test('rectangular Reynolds is the duct own, not the equivalent round pipe', () => {
  const r = calcSegment(
    { airflowLps: 1500, shape: 'rectangular', lengthM: 10, widthMm: 600, heightMm: 400 },
    ctx()
  );
  const Dh = (2 * 0.6 * 0.4) / (0.6 + 0.4);
  close(r.reynolds, (r.velocity * Dh) / STANDARD_AIR.kinematic, 1, 'on Dh and actual velocity');
  // The friction factor is taken at the circular equivalent, so that Re is
  // reported separately rather than conflated with the duct own.
  assert.ok(r.reynoldsEquivalent > r.reynolds * 1.1, 'and they genuinely differ');
  const round = calcSegment({ airflowLps: 500, shape: 'circular', lengthM: 5 }, ctx());
  assert.equal(round.reynoldsEquivalent, round.reynolds, 'equal for round duct');
});

/* ---------------------------------------------------------------- *
 * Run totals
 * ---------------------------------------------------------------- */

test('run totals sum the segments and apply the fan margin', () => {
  const segs = [
    calcSegment({ airflowLps: 500, shape: 'circular', lengthM: 10 }, ctx()),
    calcSegment({ airflowLps: 250, shape: 'circular', lengthM: 8 }, ctx()),
    calcSegment({ airflowLps: 100, shape: 'flexible', lengthM: 4 }, ctx({ roughness: 0.003 })),
  ];
  const run = calcRun(segs, { plantPa: 50, marginPct: 10, leakageClass: 'A' });

  close(run.ductPa, segs.reduce((s, r) => s + r.totalLoss, 0), 1e-9, 'duct total');
  close(run.totalPa, run.ductPa + 50, 1e-9, 'plus plant');
  close(run.fanDutyPa, run.totalPa * 1.1, 1e-9, 'plus 10 % margin');
  close(run.maxVelocity, Math.max(...segs.map((s) => s.velocity)), 1e-9);
  close(run.lengthM, 22, 1e-9);
  assert.equal(run.segments, 3);
  assert.ok(run.leakageLps > 0 && run.leakagePct > 0, 'leakage estimated');
});

test('leakage is taken on duct pressure, not the fan total', () => {
  // The plant allowance is a coil or filter, not duct static pressure. Folding
  // it in read 3.7x high on 450 Pa of plant and 5.5x high on 900 Pa.
  const segs = [calcSegment({ airflowLps: 500, shape: 'circular', lengthM: 20 }, ctx())];
  const bare = calcRun(segs, { plantPa: 0, leakageClass: 'B' });
  for (const plantPa of [150, 450, 900]) {
    const run = calcRun(segs, { plantPa, leakageClass: 'B' });
    close(run.leakageLps, bare.leakageLps, 1e-9, `plant ${plantPa} Pa must not move leakage`);
    close(run.totalPa, run.ductPa + plantPa, 1e-9, 'but it still counts toward the fan');
  }
  close(
    bare.leakageLps,
    leakageRate(bare.ductPa / 2, 'B') * bare.surfaceArea,
    1e-9,
    'mean duct pressure basis'
  );
});

test('empty run is safe', () => {
  const run = calcRun([], {});
  assert.equal(run.totalPa, 0);
  assert.equal(run.leakagePct, 0);
});

/* ---------------------------------------------------------------- *
 * Design data sanity
 * ---------------------------------------------------------------- */

test('the acoustic maxima loosen monotonically as the space gets less critical', () => {
  // The space list is ordered from the tightest acoustic case (bedroom) to the
  // least critical (riser/plant). If that order ever stops being monotonic the
  // list has been edited into something that no longer reads as a scale.
  for (const role of ['main', 'branch', 'runout']) {
    for (let i = 1; i < ACOUSTIC_SCALE.length; i++) {
      const prev = maxVelocity(ACOUSTIC_SCALE[i - 1].id, role);
      const here = maxVelocity(ACOUSTIC_SCALE[i].id, role);
      assert.ok(
        here >= prev,
        `${role}: ${ACOUSTIC_SCALE[i].id} (${here}) must not be tighter than ${ACOUSTIC_SCALE[i - 1].id} (${prev})`
      );
    }
  }
});

test('within a space, a main is allowed to run faster than a runout', () => {
  for (const space of SPACE_TYPES) {
    assert.ok(
      maxVelocity(space.id, 'main') > maxVelocity(space.id, 'branch'),
      `${space.id}: main > branch`
    );
    assert.ok(
      maxVelocity(space.id, 'branch') >= maxVelocity(space.id, 'runout'),
      `${space.id}: branch >= runout`
    );
  }
  // The kitchen's runout does NOT follow the "half the main" rule the acoustic
  // spaces use. That rule is about a runout feeding a terminal in an occupied
  // room; a grease duct off a canopy is not that, and deriving it that way made
  // the grease runout band impossible in every space.
  assert.equal(maxVelocity('kitchen', 'runout'), maxVelocity('kitchen', 'branch'));
});

test('every grease band is workable in the commercial kitchen', () => {
  // The regression this guards: with the kitchen max taken from an acoustic
  // space, the runout band came out impossible (max below min) in five spaces
  // and zero-width in the sixth, so no runout could ever satisfy the rule.
  const min = minVelocity('grease');
  const systemMax = systemType('grease').maxVelocity;
  for (const role of ['main', 'branch', 'runout']) {
    const max = Math.min(maxVelocity('kitchen', role), systemMax);
    assert.ok(max > min, `${role}: kitchen max ${max} must leave room above the ${min} minimum`);
  }
});

test('only the transport systems carry a minimum velocity', () => {
  // Constant friction already picks the smallest duct that holds the target, so
  // an air conditioning / ventilation system needs no floor. Grease and dust do,
  // for different reasons: grease to stop a small duct going slack, dust to keep
  // solid material airborne.
  for (const system of SYSTEM_TYPES) {
    assert.equal(
      minVelocity(system.id) > 0,
      system.id === 'grease' || system.id === 'dust',
      system.id
    );
  }
  // Every system sizes on equal friction. Grease moved off constant velocity
  // when the design basis did, and dust never needed it: wherever the floor
  // binds, friction + floor makes the selections constant velocity would.
  for (const system of SYSTEM_TYPES) assert.equal(system.sizingMethod, 'friction', system.id);
  assert.equal(systemType('grease').allowsFlexible, false, 'no flex on grease extract');
  assert.equal(systemType('dust').allowsFlexible, false, 'LEV hose is not HVAC flexible duct');
  // The grease SYSTEM and the commercial-kitchen SPACE must not share an id:
  // they are different lookups and a typo between them would read silently.
  assert.ok(SYSTEM_TYPES.every((x) => x.id !== 'kitchen'));
  assert.equal(spaceType('kitchen').id, 'kitchen');
});

test('a narrow velocity band on a coarse list takes the nearer miss', () => {
  // Regression: moist dust (22.5–25 m/s, a 5 % diameter range) at 1,500 l/s on
  // a 50 mm list. The band 276–291 mm holds no size. Always coming down to the
  // faster side gave Ø250 at 30.6 m/s — 22 % over the cap — when Ø300 misses
  // the floor by 6 %.
  const COARSE = [150, 200, 250, 300, 350, 400, 450, 500];
  const r = calcSegment(
    { airflowLps: 1500, shape: 'circular', lengthM: 10 },
    ctx({ minVelocity: 22.5, maxVelocity: 25, roundSizes: COARSE })
  );
  assert.equal(r.heightMm, 300);
  assert.ok(r.velocity < 25, `${r.velocity.toFixed(1)} m/s must not blow through the cap`);
  assert.equal(r.belowMinVelocity, true, 'the miss is reported, not hidden');
  // And the helper directly: in band, under the floor, and both misses.
  assert.equal(clampToBand(400, 200, 450, COARSE), 400, 'floor not breached: stands');
  assert.equal(clampToBand(500, 200, 450, COARSE), 450, 'in band: largest under the floor');
  assert.equal(clampToBand(500, 276, 291, COARSE), 300, 'no size in band: nearer miss');
});

test('dust classes rise with the difficulty of the material', () => {
  for (let i = 1; i < DUST_CLASSES.length; i++) {
    assert.ok(
      DUST_CLASSES[i].minVelocity > DUST_CLASSES[i - 1].minVelocity,
      `${DUST_CLASSES[i].id} must need more than ${DUST_CLASSES[i - 1].id}`
    );
  }
  assert.equal(dustClass('nonsense').id, 'average', 'unknown falls back to average');
});

test('every dust class exceeds every acoustic limit, which is why transport governs', () => {
  // Without transportGoverns no dust system could be sized at all. Guard the
  // premise so that if a space cap or a class ever moves, this gets revisited
  // rather than silently half-working.
  const loosestSpace = Math.max(...SPACE_TYPES.map((sp) => maxVelocity(sp.id, 'main')));
  const gentlestDust = Math.min(...DUST_CLASSES.map((c) => c.minVelocity));
  assert.ok(gentlestDust >= loosestSpace, `${gentlestDust} vs ${loosestSpace}`);
  assert.equal(systemType('dust').transportGoverns, true);
  assert.ok(systemType('dust').maxVelocity > Math.max(...DUST_CLASSES.map((c) => c.minVelocity)));
});

test('a dust duct is sized to its transport velocity, not to the friction target', () => {
  // At 17.5 m/s the floor binds on every duty; 1 Pa/m never comes close.
  // (Not 200 l/s on this list: its 101–121 mm band holds no listed size, so it
  // lands on Ø100 at 25.5 m/s — 2 % over the cap rather than 7 % under the
  // minimum at Ø125. That is the right bias for dust, where a silted duct is
  // worse than some erosion, but it is a list-granularity case, not this one.)
  for (const airflowLps of [300, 800, 3000]) {
    const r = calcSegment(
      { airflowLps, shape: 'circular', lengthM: 10 },
      ctx({ minVelocity: 17.5, maxVelocity: 25, roundSizes: TEST_ROUND })
    );
    assert.ok(r.velocity >= 17.5 / 1.001, `${airflowLps} l/s -> ${r.velocity.toFixed(1)} m/s`);
    assert.ok(r.velocity <= 25 * 1.001);
    assert.equal(r.velocityFloorOverrode, true, 'the floor, not the target, chose this size');
    assert.equal(r.ruleMet, true, 'and that is a correct selection, not a failure');
  }
});

test('no space carries a flexible-duct velocity entry any more', () => {
  // They were inert: flexible duct's roughness makes the friction target bind
  // long before any velocity limit does. Flexible is locked to the runout role.
  for (const space of SPACE_TYPES) {
    assert.equal(space.roles.flex, undefined, `${space.id} still has a flex entry`);
  }
  assert.equal(systemType('grease').minVelocity.flex, undefined);
});

test('a velocity floor overrides the friction target on a small flow', () => {
  // Sizing for Pa/m alone goes slack long before it goes noisy: at 200 l/s the
  // friction target alone gives a duct the air barely moves through. The floor
  // brings it back down a size, and the friction target is the thing that
  // gives, which is reported rather than hidden.
  const base = {
    air: STANDARD_AIR,
    roughness: 0.00009,
    method: 'friction',
    targetFriction: 1.0,
    maxVelocity: 9,
    roundSizes: TEST_ROUND,
    rectSizes: TEST_RECT,
    useStandardSizes: true,
  };
  const seg = { airflowLps: 200, shape: 'circular', lengthM: 10 };
  const loose = calcSegment(seg, { ...base, minVelocity: 0 });
  const floored = calcSegment(seg, { ...base, minVelocity: 5 });

  assert.ok(loose.velocity < 5, `unfloored is ${loose.velocity.toFixed(2)} m/s`);
  assert.ok(floored.heightMm < loose.heightMm, 'the floor makes the duct smaller');
  assert.ok(floored.velocity >= 5 / 1.001, `floored is ${floored.velocity.toFixed(2)} m/s`);
  assert.equal(floored.belowMinVelocity, false);
  assert.equal(floored.minVelocityApplied, 5);
  // The friction target is what gives way, and that is said out loud.
  assert.ok(floored.frictionRate > base.targetFriction);
  assert.equal(floored.exceedsFrictionTarget, true);
});

test('the velocity floor leaves a flow it does not bind on alone', () => {
  const base = {
    air: STANDARD_AIR,
    roughness: 0.00009,
    method: 'friction',
    targetFriction: 1.0,
    maxVelocity: 9,
    roundSizes: TEST_ROUND,
    rectSizes: TEST_RECT,
    useStandardSizes: true,
  };
  const seg = { airflowLps: 2500, shape: 'circular', lengthM: 10 };
  const loose = calcSegment(seg, { ...base, minVelocity: 0 });
  const floored = calcSegment(seg, { ...base, minVelocity: 5 });
  assert.equal(floored.heightMm, loose.heightMm, 'same size');
  assert.equal(floored.ruleMet, true);
  assert.ok(floored.frictionRate <= base.targetFriction * 1.001);
});

test('a rectangular duct honours the velocity floor too', () => {
  const r = calcSegment(
    { airflowLps: 200, shape: 'rectangular', lengthM: 10 },
    {
      air: STANDARD_AIR,
      roughness: 0.00009,
      method: 'friction',
      targetFriction: 1.0,
      minVelocity: 5,
      maxVelocity: 9,
      roundSizes: TEST_ROUND,
      rectSizes: TEST_RECT,
      useStandardSizes: true,
      preferredAspect: 1.5,
      maxAspect: 2,
    }
  );
  assert.ok(r.velocity >= 5 / 1.001, `${r.velocity.toFixed(2)} m/s`);
  assert.ok(r.aspectRatio <= 2 + 1e-9, `aspect ${r.aspectRatio.toFixed(2)}`);
});

test('the grease velocity band is flat across the roles', () => {
  // It is a bound on how slack the air may get, not a per-position transport
  // requirement — the transport reading of these figures is the pre-2002 one.
  assert.equal(typeof systemType('grease').minVelocity, 'number');
  assert.ok(systemType('grease').maxVelocity > systemType('grease').minVelocity);
  // The one velocity figure that is a code requirement, and it applies at
  // turndown rather than at design flow.
  assert.ok(systemType('grease').minVelocityTurndown < systemType('grease').minVelocity);
});

test('each transport system has a space of its own', () => {
  // Grease runs in a commercial kitchen; dust extract in a workshop. Before the
  // workshop row, LEV had to borrow back of house, which describes a riser.
  assert.equal(spaceType('kitchen').id, 'kitchen');
  assert.equal(spaceType('workshop').id, 'workshop');
  assert.equal(spaceType('carpark').id, 'carpark');
  // Above NR 45 the published limits plateau at AIRAH's 10 m/s riser cap, so
  // these rows are allowed to match back of house rather than climb past it.
  for (const id of ['backhouse', 'workshop', 'carpark']) assert.equal(maxVelocity(id, 'main'), 10);
});

test('no space main exceeds the AIRAH absolute riser maximum', () => {
  // AIRAH sw123 caps the riser column at 10.0 m/s at EVERY NR, and frames its
  // table as absolute maxima rather than design recommendations. Back of house
  // and Commercial kitchen both sat at 12.0 until the sources were read.
  for (const space of SPACE_TYPES) {
    assert.ok(
      maxVelocity(space.id, 'main') <= 10.0 + 1e-9,
      `${space.id} main ${maxVelocity(space.id, 'main')} exceeds the 10 m/s riser cap`
    );
  }
});

test('the commercial kitchen space does not contradict the grease system cap', () => {
  // The grease cap masked this for grease ducts while make-up air through the
  // same kitchen still read the space's 12 m/s.
  const systemCap = systemType('grease').maxVelocity;
  assert.ok(
    maxVelocity('kitchen', 'main') <= 10.0 + 1e-9,
    'the kitchen space may not sit above the AIRAH riser cap'
  );
  assert.ok(
    maxVelocity('kitchen', 'main') >= systemCap,
    'but it must leave room for the grease system cap, which is what should bind'
  );
});

test('grease extract is held to a tighter aspect ratio than the project default', () => {
  assert.equal(systemType('grease').maxAspect, 2);
  assert.equal(systemType('standard').maxAspect, undefined, 'the project limit applies');
});

test('standard size lists are sorted ascending', () => {
  for (const list of [ROUND_SIZES, RECT_SIZES]) {
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i] > list[i - 1], `${list[i]} follows ${list[i - 1]}`);
    }
  }
});

/* ---------------------------------------------------------------- *
 * Worked end-to-end example
 * ---------------------------------------------------------------- */

test('worked example: 250 l/s commercial branch, Ø250, 12 m, 3 bends', () => {
  const r = calcSegment(
    {
      airflowLps: 250,
      shape: 'circular',
      lengthM: 12,
      heightMm: 250,
      fittings: [
        { id: 'r90_15', zeta: 0.15, qty: 3 },
        { id: 'vcd', zeta: 0.2, qty: 1 },
        { id: 'grille', fixedPa: 25, qty: 1 },
      ],
    },
    ctx()
  );

  // A = 0.04909 m², v = 5.093 m/s, Pv = 15.6 Pa
  close(r.area, 0.04909, 1e-5);
  close(r.velocity, 5.093, 0.01);
  close(r.velocityPressure, 15.62, 0.05);
  // Re ≈ 84 500, ε/D = 3.6e-4 → f ≈ 0.0202, dp/m = f·Pv/D ≈ 1.264 Pa/m
  close(r.reynolds, 84500, 300);
  close(r.frictionFactor, 0.0202, 0.0005);
  close(r.frictionRate, 1.264, 0.01);
  close(r.straightLoss, r.frictionRate * 12, 1e-9);
  // fittings: (3×0.15 + 1×0.2) × 15.62 = 10.15 Pa, + 25 Pa grille
  close(r.fittingLoss, 0.65 * r.velocityPressure + 25, 0.01);
  close(r.totalLoss, r.straightLoss + r.fittingLoss, 1e-9);
  assert.ok(r.totalLoss > 45 && r.totalLoss < 60, `total ${r.totalLoss} Pa is plausible`);
});
