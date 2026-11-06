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

/**
 * Circular duct, on 50 mm increments to 600 then 100 mm — not the EN 1506
 * preferred-number series (125/160/200/250/315…), which many suppliers don't
 * hold. Edit in Settings to match what yours actually stocks.
 */
export const ROUND_SIZES = [
  150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 700, 800, 900, 1000, 1100,
  1200, 1300, 1400,
];

/** Flexible duct, 50 mm increments over the range it's normally made in. */
export const FLEX_SIZES = [
  150, 200, 250, 300, 350, 400, 450, 500, 550, 600,
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
 * Space types, system types & duct roles
 * ------------------------------------------------------------------ *
 * Two separate settings, because two different physical causes are at work:
 *
 *   SPACE SERVED sets the MAXIMUM velocity. Noise is the only thing driving
 *   the upper band, and the noise requirement belongs to the space, not to the
 *   building — a hotel bedroom and a house bedroom want the same figure, an
 *   open-plan office and a classroom want the same, and a riser is a riser in
 *   both. Sorting by "Residential / Commercial" was a building label doing a
 *   job that belongs to the space, which is why it kept mis-fitting: it put a
 *   boardroom and a car park in the same bucket.
 *
 *   SYSTEM sets the sizing METHOD. Only kitchen grease extract differs:
 *   everything else — comfort A/C, fresh air, general and toilet extract —
 *   sizes to the same constant friction rate, so they are one system here
 *   rather than three identical ones.
 *
 * There is deliberately NO minimum velocity on the friction system. Constant
 * friction already picks the smallest duct that holds the target, so the
 * target is the anti-oversize control; a separate floor would be a second
 * constraint saying the same thing. Kitchen grease extract is the exception,
 * where the minimum is a transport requirement, not an economic one.
 *
 * The friction target itself is a single project-wide setting (1.0 Pa/m by
 * default), not a per-space one: with noise handled by the velocity cap there
 * is no reason for it to vary by room. It is the main driver of duct size.
 *
 * These velocity limits are the app's ONLY noise control. The regenerated-noise
 * estimate was removed (see the note in engine.js) because it could not be made
 * trustworthy without octave-band terminal data. Keeping velocities inside these
 * figures is how CIBSE Guide B and ASHRAE present the control anyway; an actual
 * acoustic assessment needs manufacturers' sound-power data, not this app.
 *
 * SOURCES AND THEIR LIMITS. The backbone is CIBSE Guide B Table 3.4, which caps
 * velocity in risers and above ceilings at 5 / 7.5 / 10 m/s for acoustically
 * critical / normal / non-critical rooms; the NR bands below interpolate across
 * that range. CIBSE Guide B2 Table 2.16 gives a general office 6.0 m/s in the
 * branch, 3.5 in the run-out and 2.5 at the diffuser. ASHRAE's acoustic table is
 * more permissive and splits by shape — above a suspended acoustic ceiling,
 * RC 35 allows 8.9 m/s rectangular against 15.2 round, because rectangular walls
 * radiate breakout noise. This app uses one figure for both shapes.
 *
 * Every one of these numbers reached this file through a SECONDARY source: the
 * CIBSE and ASHRAE originals are paywalled. Check them against the project
 * specification before issuing anything. All are editable in Settings.
 * ------------------------------------------------------------------ */

/**
 * Maximum velocity by space served and duct role, m/s.
 *
 * One number per role, not a recommended/maximum pair: there is a single
 * acoustic limit, and the app shades the reading amber within 10 % of it rather
 * than asking for a second figure that would only be the same judgement twice.
 */
export const SPACE_TYPES = [
  {
    id: 'bedroom',
    name: 'Bedroom / hotel room',
    short: 'Bedroom',
    useCase: 'Sleeping spaces — the tightest acoustic case',
    nr: 'NR 25',
    roles: { main: 5.0, branch: 4.0, runout: 2.5, flex: 2.5 },
  },
  {
    id: 'living',
    name: 'Living room / study',
    short: 'Living',
    useCase: 'Living rooms, studies, consulting rooms',
    nr: 'NR 30',
    roles: { main: 6.0, branch: 5.0, runout: 3.0, flex: 3.0 },
  },
  {
    id: 'office',
    name: 'Private office / meeting / classroom',
    short: 'Office',
    useCase: 'Cellular offices, meeting rooms, teaching spaces',
    nr: 'NR 35',
    roles: { main: 7.5, branch: 6.0, runout: 4.0, flex: 4.0 },
  },
  {
    id: 'openplan',
    name: 'Open-plan office',
    short: 'Open plan',
    useCase: 'Open-plan workspace, where background level is higher',
    nr: 'NR 38',
    roles: { main: 8.5, branch: 7.0, runout: 4.5, flex: 4.5 },
  },
  {
    id: 'retail',
    name: 'Retail / restaurant / circulation',
    short: 'Retail',
    useCase: 'Shops, restaurants, lobbies and corridors',
    nr: 'NR 40',
    roles: { main: 9.0, branch: 7.5, runout: 5.0, flex: 5.0 },
  },
  {
    id: 'backhouse',
    name: 'Toilet / back-of-house / riser / plant',
    short: 'Back of house',
    useCase: 'Risers, plant, stores, WCs — acoustically non-critical',
    nr: 'NR 45+',
    roles: { main: 12.0, branch: 9.0, runout: 6.0, flex: 6.0 },
  },
];

/**
 * Sizing method by system. Only two, because comfort A/C, fresh air and general
 * extract all size identically — to the project friction target.
 */
export const SYSTEM_TYPES = [
  {
    id: 'standard',
    name: 'Air conditioning / ventilation',
    short: 'A/C · vent',
    useCase: 'Comfort A/C, fresh air, general and toilet extract',
    sizingMethod: 'friction',
    allowsFlexible: true,
  },
  {
    id: 'kitchen',
    name: 'Kitchen grease extract',
    short: 'Kitchen',
    useCase: 'Commercial kitchen canopies & grease ducts',
    sizingMethod: 'velocity',
    // Flexible duct is not normally fire-code permitted for grease extract
    // (e.g. NFPA 96 / DW/172), so it is not offered as a duct type here.
    allowsFlexible: false,
    /**
     * MINIMUM transport velocity by role, m/s — the speed below which grease
     * settles out and fouls the duct, which is a fire risk rather than a
     * maintenance one. DW/172-style indicative figures; confirm against the
     * canopy duty before specifying.
     *
     * The main/riser carries the highest minimum because it is the longest,
     * least accessible part of the run and the hardest to clean; branches and
     * runouts are shorter and reachable, so they sit lower.
     *
     * The MAXIMUM still comes from the space the duct runs through, which is
     * the point of splitting the two: the same grease duct gets 12 m/s of
     * headroom in a riser and 9 m/s where it crosses a restaurant.
     */
    minVelocity: { main: 7.5, branch: 6.0, runout: 6.0, flex: 6.0 },
  },
];

/** Project-wide friction target, Pa/m — the main driver of duct size. */
export const DEFAULT_FRICTION_TARGET = 1.0;

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
  return SPACE_TYPES.find((s) => s.id === id) ?? SPACE_TYPES[3];
}

export function systemType(id) {
  return SYSTEM_TYPES.find((s) => s.id === id) ?? SYSTEM_TYPES[0];
}

/** Whether flexible duct may be used at all on this system. */
export function systemAllowsFlexible(systemId) {
  return systemType(systemId).allowsFlexible !== false;
}

/** Duct types selectable on this system, in display order. */
export function shapesForSystem(systemId) {
  return systemAllowsFlexible(systemId) ? SHAPES : SHAPES.filter((s) => s.id !== 'flexible');
}

/** Role key for a lookup — flexible duct has its own entry whatever its role. */
function roleKey(roleId, shape) {
  return shape === 'flexible' ? 'flex' : roleId;
}

/**
 * Maximum velocity for a space + duct role, m/s. Set by noise alone.
 */
export function maxVelocity(spaceId, roleId, shape) {
  const space = spaceType(spaceId);
  return space.roles[roleKey(roleId, shape)] ?? space.roles.branch;
}

/**
 * Minimum velocity for a system + duct role, m/s, or 0 where there is none.
 * Only kitchen grease extract has one; the friction target is what stops a
 * friction-sized duct being oversized.
 */
export function minVelocity(systemId, roleId, shape) {
  const system = systemType(systemId);
  if (!system.minVelocity) return 0;
  return system.minVelocity[roleKey(roleId, shape)] ?? system.minVelocity.branch;
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
