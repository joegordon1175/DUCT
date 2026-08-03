/**
 * DUCT — reference data: standard sizes, materials, design limits, fittings.
 *
 * Sources are noted per table. Values are typical design figures from
 * CIBSE Guide B3, ASHRAE Fundamentals (Duct Design), DW/144 and manufacturers'
 * published loss coefficients. They are defaults, not a substitute for a
 * project specification — every one of them is editable in the app.
 */

/* ------------------------------------------------------------------ *
 * Standard sizes (mm)
 * ------------------------------------------------------------------ */

/** Spiral-wound circular duct, EN 1506 series plus sizes in common use. */
export const ROUND_SIZES = [
  63, 80, 100, 125, 150, 160, 180, 200, 224, 250, 280, 315, 355, 400, 450, 500,
  560, 630, 710, 800, 900, 1000, 1120, 1250, 1400, 1600,
];

/** Flexible duct is made in a coarser range than spiral. */
export const FLEX_SIZES = [
  100, 125, 150, 160, 180, 200, 250, 300, 315, 355, 400, 450, 500,
];

/** Rectangular duct on the usual 50 mm modular increments. */
export const RECT_SIZES = [
  100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800,
  850, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1800, 2000,
];

/* ------------------------------------------------------------------ *
 * Materials — absolute roughness ε (mm), ASHRAE Fundamentals Table
 * ------------------------------------------------------------------ */

export const MATERIALS = [
  { id: 'galv', name: 'Galvanised steel, spiral/seamed', roughnessMm: 0.09, shapes: ['circular', 'rectangular'] },
  { id: 'galv_rect', name: 'Galvanised steel, longitudinal seam', roughnessMm: 0.15, shapes: ['rectangular'] },
  { id: 'stainless', name: 'Stainless steel', roughnessMm: 0.05, shapes: ['circular', 'rectangular'] },
  { id: 'alu', name: 'Aluminium', roughnessMm: 0.05, shapes: ['circular', 'rectangular'] },
  { id: 'pvc', name: 'PVC / plastic', roughnessMm: 0.03, shapes: ['circular', 'rectangular'] },
  { id: 'board', name: 'Fibrous glass duct board', roughnessMm: 0.9, shapes: ['rectangular'] },
  { id: 'lined', name: 'Acoustically lined (fibrous liner)', roughnessMm: 1.5, shapes: ['circular', 'rectangular'] },
  { id: 'concrete', name: 'Concrete / builders work', roughnessMm: 3.0, shapes: ['rectangular'] },
  { id: 'flex_metal', name: 'Flexible, metallic', roughnessMm: 1.2, shapes: ['flexible'] },
  { id: 'flex_nonmetal', name: 'Flexible, non-metallic', roughnessMm: 3.0, shapes: ['flexible'] },
  { id: 'flex_insulated', name: 'Flexible, insulated', roughnessMm: 3.0, shapes: ['flexible'] },
];

export const DEFAULT_MATERIAL = { circular: 'galv', rectangular: 'galv', flexible: 'flex_insulated' };

/**
 * Flexible duct is only as good as its installation. Compression raises the
 * friction rate sharply (ASHRAE: ~15 % compression roughly doubles the loss,
 * ~30 % roughly quadruples it).
 */
export const FLEX_CONDITIONS = [
  { id: 'extended', name: 'Fully extended', factor: 1.0 },
  { id: 'c15', name: '15 % compressed', factor: 2.0 },
  { id: 'c30', name: '30 % compressed', factor: 4.0 },
];

/* ------------------------------------------------------------------ *
 * Space types & duct roles — sizing method, and velocity/friction targets
 * ------------------------------------------------------------------ *
 * Each space type has a FIXED sizing method — this isn't a free per-project
 * toggle, because the two methods serve different physical requirements:
 *
 *   'friction' (Residential, Commercial) — sizes to a constant friction
 *   rate. Velocity is only ever a check afterwards: `recommended` is a soft
 *   comfort/noise ceiling, `max` a hard one.
 *
 *   'velocity' (Industrial — kitchen extract) — sizes to `recommended` as a
 *   MINIMUM transport velocity instead, and standard sizes snap down rather
 *   than up (see `snapFloor` in engine.js) so the built duct can't fall
 *   below it. Air moving slower than this lets grease settle out and foul
 *   the duct — a fire risk, not just a maintenance one. `max` here caps
 *   erosion and noise instead.
 *
 * `roles` covers the three duct positions (main/branch/runout) plus a
 * separate `flex` entry: flexible duct is rougher and usually shorter, so it
 * gets its own limits applied whenever a segment's shape is 'flexible',
 * regardless of which role is selected for it.
 *
 * These are indicative starting points (CIBSE Guide B3 / ASHRAE recommended
 * maxima for the friction-mode spaces; DW/172-style kitchen grease extract
 * transport velocities for Industrial) — the app lets every number here be
 * edited and reset per space type in Settings.
 */

export const SPACE_TYPES = [
  {
    id: 'residential',
    name: 'Residential',
    short: 'Residential',
    useCase: 'Homes & apartments',
    sizingMethod: 'friction',
    targetFriction: 0.8, // Pa/m
    noiseLimitDba: 30, // ≈ NR 25
    noiseCriterion: 'NR 25',
    roles: {
      main: { recommended: 4.0, max: 5.0 },
      branch: { recommended: 3.0, max: 3.5 },
      runout: { recommended: 2.0, max: 2.5 },
      flex: { recommended: 2.0, max: 2.5 },
    },
  },
  {
    id: 'commercial',
    name: 'Commercial',
    short: 'Commercial',
    useCase: 'Offices, retail & general ventilation',
    sizingMethod: 'friction',
    targetFriction: 1.0,
    noiseLimitDba: 40, // ≈ NR 35
    noiseCriterion: 'NR 35',
    roles: {
      main: { recommended: 6.0, max: 8.0 },
      branch: { recommended: 4.5, max: 6.0 },
      runout: { recommended: 3.0, max: 4.0 },
      flex: { recommended: 3.0, max: 4.0 },
    },
  },
  {
    id: 'industrial',
    name: 'Kitchen Extract',
    short: 'Kitchen',
    useCase: 'Commercial kitchens & canopies',
    sizingMethod: 'velocity',
    // Flexible duct is not normally fire-code permitted for grease extract
    // (e.g. NFPA 96/DW/172), so it is not offered as a duct type here — and
    // its velocity limits are hidden in Settings, since nothing could use them.
    allowsFlexible: false,
    noiseLimitDba: 50, // ≈ NR 45
    noiseCriterion: 'NR 45',
    roles: {
      // "recommended" is a MINIMUM transport velocity, not a soft ceiling —
      // see the file-level note above. Confirm against DW/172 before
      // specifying.
      main: { recommended: 10.0, max: 18.0 },
      branch: { recommended: 10.0, max: 18.0 },
      runout: { recommended: 10.0, max: 15.0 },
      flex: { recommended: 10.0, max: 15.0 },
    },
  },
];

export const DUCT_ROLES = [
  { id: 'main', name: 'Main / riser', short: 'Main' },
  { id: 'branch', name: 'Branch', short: 'Branch' },
  { id: 'runout', name: 'Runout / terminal', short: 'Runout' },
];

export const SHAPES = [
  { id: 'circular', name: 'Circular', short: 'Circular' },
  { id: 'rectangular', name: 'Rectangular', short: 'Rectangular' },
  { id: 'flexible', name: 'Flexible', short: 'Flexible' },
];

export function spaceType(id) {
  return SPACE_TYPES.find((s) => s.id === id) ?? SPACE_TYPES[1];
}

/** Whether flexible duct may be used at all in this space type. */
export function spaceAllowsFlexible(spaceId) {
  return spaceType(spaceId).allowsFlexible !== false;
}

/** Duct types selectable in this space type, in display order. */
export function shapesForSpace(spaceId) {
  return spaceAllowsFlexible(spaceId) ? SHAPES : SHAPES.filter((s) => s.id !== 'flexible');
}

/**
 * Velocity limits for a space type + duct role. Pass `shape: 'flexible'` (or
 * any shape) to pick the role-specific limit, or leave it out — flexible
 * duct's dedicated `flex` limits apply whenever `shape` is 'flexible'.
 */
export function velocityLimits(spaceId, roleId, shape) {
  const space = spaceType(spaceId);
  const key = shape === 'flexible' ? 'flex' : roleId;
  return space.roles[key] ?? space.roles.branch;
}

export function material(id) {
  return MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];
}

export function materialsFor(shape) {
  return MATERIALS.filter((m) => m.shapes.includes(shape));
}

export function sizesFor(shape) {
  if (shape === 'rectangular') return RECT_SIZES;
  if (shape === 'flexible') return FLEX_SIZES;
  return ROUND_SIZES;
}

/* ------------------------------------------------------------------ *
 * Fittings — loss coefficients ζ (velocity-pressure method)
 * ------------------------------------------------------------------ *
 * ζ is referred to the velocity in the segment the fitting sits in.
 * For junctions this is the common-to-branch coefficient at typical flow
 * splits; where a project has manufacturer data, edit ζ in the app.
 */

export const FITTINGS = [
  // --- bends, round ---------------------------------------------------
  { id: 'r90_15', name: '90° bend, r/D 1.5', zeta: 0.15, group: 'Bends', shapes: ['circular', 'rectangular'] },
  { id: 'r90_10', name: '90° bend, r/D 1.0', zeta: 0.22, group: 'Bends', shapes: ['circular', 'rectangular'] },
  { id: 'r90_075', name: '90° bend, r/D 0.75', zeta: 0.33, group: 'Bends', shapes: ['circular'] },
  { id: 'r90_seg', name: '90° segmented bend (5 pc)', zeta: 0.24, group: 'Bends', shapes: ['circular'] },
  { id: 'r45', name: '45° bend, r/D 1.5', zeta: 0.09, group: 'Bends', shapes: ['circular', 'rectangular'] },
  { id: 'mitre90', name: '90° mitred, no vanes', zeta: 1.2, group: 'Bends', shapes: ['circular', 'rectangular'] },
  { id: 'mitre90_sv', name: '90° mitred, single vanes', zeta: 0.25, group: 'Bends', shapes: ['rectangular'] },
  { id: 'mitre90_dv', name: '90° mitred, double vanes', zeta: 0.15, group: 'Bends', shapes: ['rectangular'] },
  { id: 'mitre45', name: '45° mitred', zeta: 0.34, group: 'Bends', shapes: ['circular', 'rectangular'] },
  { id: 'rect90_05', name: '90° radius elbow, r/W 0.5', zeta: 0.6, group: 'Bends', shapes: ['rectangular'] },
  { id: 'offset', name: 'Offset / double bend', zeta: 0.3, group: 'Bends', shapes: ['circular', 'rectangular'] },
  { id: 'flex90_10', name: '90° bend in flex, r/D 1.0', zeta: 0.6, group: 'Bends', shapes: ['flexible'] },
  { id: 'flex90_20', name: '90° bend in flex, r/D 2.0', zeta: 0.35, group: 'Bends', shapes: ['flexible'] },
  { id: 'flex45', name: '45° bend in flex', zeta: 0.2, group: 'Bends', shapes: ['flexible'] },

  // --- junctions ------------------------------------------------------
  { id: 'tee_b90', name: 'Tee, 90° branch', zeta: 0.9, group: 'Junctions', shapes: ['circular', 'rectangular', 'flexible'] },
  { id: 'tee_b90c', name: 'Tee, 90° conical branch', zeta: 0.6, group: 'Junctions', shapes: ['circular'] },
  { id: 'tee_b45', name: 'Tee, 45° take-off', zeta: 0.4, group: 'Junctions', shapes: ['circular', 'rectangular'] },
  { id: 'shoe', name: 'Shoe / boot take-off', zeta: 0.6, group: 'Junctions', shapes: ['rectangular', 'flexible'] },
  { id: 'tee_thru', name: 'Tee, straight through', zeta: 0.15, group: 'Junctions', shapes: ['circular', 'rectangular'] },
  { id: 'breeches', name: 'Y / breeches, 45°', zeta: 0.3, group: 'Junctions', shapes: ['circular', 'rectangular'] },
  { id: 'saddle', name: 'Saddle spigot on main', zeta: 0.8, group: 'Junctions', shapes: ['circular'] },

  // --- transitions ----------------------------------------------------
  { id: 'red_grad', name: 'Gradual reducer, ≤30°', zeta: 0.06, group: 'Transitions', shapes: ['circular', 'rectangular'] },
  { id: 'exp_grad', name: 'Gradual expansion, ≤20°', zeta: 0.25, group: 'Transitions', shapes: ['circular', 'rectangular'] },
  { id: 'red_abrupt', name: 'Abrupt contraction', zeta: 0.35, group: 'Transitions', shapes: ['circular', 'rectangular'] },
  { id: 'exp_abrupt', name: 'Abrupt expansion', zeta: 0.7, group: 'Transitions', shapes: ['circular', 'rectangular'] },
  { id: 'flex_conn', name: 'Flex-to-rigid connection', zeta: 0.2, group: 'Transitions', shapes: ['circular', 'flexible'] },

  // --- terminations ---------------------------------------------------
  { id: 'entry_sharp', name: 'Duct entry, sharp edged', zeta: 0.5, group: 'Entries & exits', shapes: ['circular', 'rectangular', 'flexible'] },
  { id: 'entry_bell', name: 'Duct entry, bellmouth', zeta: 0.05, group: 'Entries & exits', shapes: ['circular', 'rectangular'] },
  { id: 'exit', name: 'Discharge to still air', zeta: 1.0, group: 'Entries & exits', shapes: ['circular', 'rectangular', 'flexible'] },
  { id: 'louvre', name: 'Weather louvre (free area 50 %)', zeta: 2.5, group: 'Entries & exits', shapes: ['circular', 'rectangular'] },

  // --- in-line components --------------------------------------------
  { id: 'vcd', name: 'Volume control damper, open', zeta: 0.2, group: 'Components', shapes: ['circular', 'rectangular', 'flexible'] },
  { id: 'vcd_part', name: 'VCD, 30° closed', zeta: 1.5, group: 'Components', shapes: ['circular', 'rectangular'] },
  { id: 'fd', name: 'Fire damper, curtain type', zeta: 0.3, group: 'Components', shapes: ['circular', 'rectangular'] },
  { id: 'nrv', name: 'Non-return / backdraught damper', zeta: 1.2, group: 'Components', shapes: ['circular', 'rectangular'] },
  { id: 'mesh', name: 'Bird / insect mesh', zeta: 0.7, group: 'Components', shapes: ['circular', 'rectangular'] },
  { id: 'plenum', name: 'Plenum box, side entry', zeta: 1.0, group: 'Components', shapes: ['circular', 'rectangular', 'flexible'] },

  // --- fixed-pressure items (ζ ignored, Pa entered directly) ----------
  { id: 'grille', name: 'Grille / diffuser', fixedPa: 25, group: 'Fixed loss', shapes: ['circular', 'rectangular', 'flexible'] },
  { id: 'silencer', name: 'Attenuator / silencer', fixedPa: 40, group: 'Fixed loss', shapes: ['circular', 'rectangular'] },
  { id: 'filter', name: 'Filter (dirty)', fixedPa: 150, group: 'Fixed loss', shapes: ['circular', 'rectangular'] },
  { id: 'coil', name: 'Heating / cooling coil', fixedPa: 80, group: 'Fixed loss', shapes: ['circular', 'rectangular'] },
  { id: 'heat_rec', name: 'Heat recovery unit', fixedPa: 120, group: 'Fixed loss', shapes: ['circular', 'rectangular'] },
  { id: 'custom', name: 'Custom item', zeta: 0.5, group: 'Fixed loss', shapes: ['circular', 'rectangular', 'flexible'] },
];

export function fittingsFor(shape) {
  return FITTINGS.filter((f) => f.shapes.includes(shape));
}

export function fittingGroups(shape) {
  const groups = new Map();
  for (const f of fittingsFor(shape)) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group).push(f);
  }
  return [...groups.entries()];
}

/* ------------------------------------------------------------------ *
 * Noise criteria — indicative dBA room limits by space use
 * ------------------------------------------------------------------ */

export const NOISE_CRITERIA = [
  { name: 'Bedroom', nr: 'NR 25', dba: 30 },
  { name: 'Living room', nr: 'NR 30', dba: 35 },
  { name: 'Private office', nr: 'NR 35', dba: 40 },
  { name: 'Open plan office', nr: 'NR 38', dba: 43 },
  { name: 'Retail / restaurant', nr: 'NR 40', dba: 45 },
  { name: 'Workshop / plant', nr: 'NR 45', dba: 50 },
];
