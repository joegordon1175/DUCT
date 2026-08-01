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
  selectRectangular,
  regeneratedNoise,
  combineLevels,
  leakageRate,
  pressureClass,
  calcSegment,
  calcRun,
  STANDARD_AIR,
} from '../js/engine.js';

import { ROUND_SIZES, RECT_SIZES, velocityLimits } from '../js/data.js';

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

test('snapUp picks the next standard size', () => {
  assert.equal(snapUp(300, ROUND_SIZES), 315);
  assert.equal(snapUp(315, ROUND_SIZES), 315);
  assert.equal(snapUp(316, ROUND_SIZES), 355);
  assert.equal(snapUp(410, RECT_SIZES), 450);
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

/* ---------------------------------------------------------------- *
 * Noise
 * ---------------------------------------------------------------- */

test('regenerated noise rises 15 dB per doubling of velocity', () => {
  const a = regeneratedNoise(5, 0.05, 1);
  const b = regeneratedNoise(10, 0.05, 1);
  close(b - a, 50 * Math.log10(2), 1e-9, 'v⁵ law');
});

test('regenerated noise magnitude is plausible', () => {
  // 5 m/s in a Ø250 duct — quiet residential branch
  close(regeneratedNoise(5, 0.0491, 1), 31.9, 0.5);
  // 10 m/s in a Ø400 duct — industrial main
  close(regeneratedNoise(10, 0.1257, 1), 51.0, 0.5);
});

test('a mitred bend is noisier than a smooth one', () => {
  assert.ok(regeneratedNoise(6, 0.05, 1.2) > regeneratedNoise(6, 0.05, 0.15) + 5);
});

test('combining equal levels adds 3 dB', () => {
  close(combineLevels([50, 50]), 53.01, 0.01);
  close(combineLevels([50, 50, 50, 50]), 56.02, 0.01);
  close(combineLevels([]), 0, 1e-9);
  close(combineLevels([60, 40]), 60.04, 0.01, 'quiet source barely counts');
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

/* ---------------------------------------------------------------- *
 * Segment calculation
 * ---------------------------------------------------------------- */

const ctx = (over = {}) => ({
  air: STANDARD_AIR,
  roughness: 0.00009,
  flexFactor: 1,
  method: 'friction',
  targetFriction: 1.0,
  targetVelocity: 5,
  maxVelocity: 6,
  roundSizes: ROUND_SIZES,
  rectSizes: RECT_SIZES,
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
  assert.ok(r.noiseLwA > 0);
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
  assert.equal(r.noiseLwA, 0);
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
  assert.ok(run.noiseLwA >= Math.max(...segs.map((s) => s.noiseLwA)), 'noise combines up');
  assert.ok(run.leakageLps > 0 && run.leakagePct > 0, 'leakage estimated');
  close(run.roomSpl, run.noiseLwA - 9, 1e-9, 'room correction applied');
});

test('empty run is safe', () => {
  const run = calcRun([], {});
  assert.equal(run.totalPa, 0);
  assert.equal(run.leakagePct, 0);
  assert.equal(run.noiseLwA, 0);
});

/* ---------------------------------------------------------------- *
 * Design data sanity
 * ---------------------------------------------------------------- */

test('velocity limits tighten from industrial to residential', () => {
  assert.ok(velocityLimits('residential', 'main').max < velocityLimits('commercial', 'main').max);
  assert.ok(velocityLimits('commercial', 'main').max < velocityLimits('industrial', 'main').max);
  assert.ok(velocityLimits('commercial', 'runout').max < velocityLimits('commercial', 'main').max);
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
