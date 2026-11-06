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
 * RC 35 allows 8.9 m/s rectangular against 15.2 round, because flat rectangular
 * walls are mass-controlled and radiate low-frequency breakout noise, while a
 * round shell is stiffness-controlled and keeps it inside the duct.
 *
 * This app uses ONE figure for both shapes, deliberately. The round allowance is
 * not a constant to multiply by: across ASHRAE's own table the ratio runs about
 * 1.4 to 1.95 depending on RC level and where the duct sits. More importantly it
 * is an allowance against BREAKOUT specifically, and the single limit here is
 * standing in for all duct noise — including air noise regenerated at fittings,
 * which travels inside the duct to the terminal and is not attenuated by the
 * duct wall at all. Applying a breakout ratio to a limit that is not a breakout
 * model would claim more accuracy than the method has.
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
    roles: { main: 5.0, branch: 4.0, runout: 2.5 },
  },
  {
    id: 'living',
    name: 'Living room / study',
    short: 'Living',
    useCase: 'Living rooms, studies, consulting rooms',
    nr: 'NR 30',
    roles: { main: 6.0, branch: 5.0, runout: 3.0 },
  },
  {
    id: 'office',
    name: 'Private office / meeting / classroom',
    short: 'Office',
    useCase: 'Cellular offices, meeting rooms, teaching spaces',
    nr: 'NR 35',
    roles: { main: 7.5, branch: 6.0, runout: 4.0 },
  },
  {
    // CIBSE bands restaurants with general offices at NR 35–40 (7.5 / 6.0 / 3.5),
    // a step below shops — they shared the retail row here until the sources
    // were read. Main and branch are CIBSE's figures for that row; the runout
    // follows the office row above rather than CIBSE's 3.5, which is tighter
    // than anything else in this table at that band (AIRAH's NR 40 is 5.5).
    id: 'restaurant',
    name: 'Restaurant / café / bar',
    short: 'Restaurant',
    useCase: 'Dining and drinking spaces — quieter than retail',
    nr: 'NR 35–40',
    roles: { main: 7.5, branch: 6.0, runout: 4.0 },
  },
  {
    id: 'openplan',
    name: 'Open-plan office',
    short: 'Open plan',
    useCase: 'Open-plan workspace, where background level is higher',
    nr: 'NR 38',
    // AIRAH sw123 NR 40 is 8.0 / 7.0 / 5.5 as an ABSOLUTE maximum, and NR 38 is
    // the stricter condition — 8.5 was over it. 8.0 sits inside AIRAH, ASHRAE
    // and CIBSE together; the runout stays well under all three.
    roles: { main: 8.0, branch: 7.0, runout: 4.5 },
  },
  {
    id: 'retail',
    name: 'Retail / circulation',
    short: 'Retail',
    useCase: 'Shops, lobbies and corridors',
    nr: 'NR 40',
    // Was 9.0 / 7.5 / 5.0, which is AIRAH's NR 45 row, not its NR 40 row
    // (8.0 / 7.0 / 5.5). CIBSE puts shops at 9.0 but bands them NR 40–45.
    // Restaurants used to share this row and now have their own, a band lower.
    roles: { main: 8.0, branch: 7.0, runout: 5.0 },
  },
  {
    id: 'backhouse',
    name: 'Toilet / back-of-house / riser / plant',
    short: 'Back of house',
    useCase: 'Risers, plant, stores, WCs — acoustically non-critical',
    nr: 'NR 45+',
    // AIRAH sw123 caps the RISER column at 10.0 m/s at every NR, as an absolute
    // maximum, and CIBSE's industrial row is 10.0 / 8.0 / 5.0 — 12.0 was 20 %
    // over both. 10.0 / 8.0 / 6.0 is AIRAH's NR 50 row exactly. ASHRAE would
    // allow far more (17.8 m/s rectangular in a shaft at RC 45), but only
    // ASHRAE does, and only for that location.
    roles: { main: 10.0, branch: 8.0, runout: 6.0 },
  },
  {
    // Deliberately NOT part of the acoustic scale above, which runs from the
    // tightest room to the least critical. A commercial kitchen is its own
    // case: the duct runs in a space where the canopy fans and the appliances
    // already dominate, so the duct is not what anyone hears. The runout figure
    // in particular does not follow the "half the main" rule the other spaces
    // use — that rule is about a runout feeding a terminal in an occupied room,
    // and a grease duct off a canopy is not that. Deriving it that way made the
    // runout band impossible in every space, which is what sent this here.
    //
    // A grease duct leaving the kitchen needs its own acoustic assessment
    // whatever this app says, so there is no attempt to model that case.
    id: 'kitchen',
    name: 'Commercial kitchen',
    short: 'Kitchen',
    useCase: 'Inside the kitchen — canopy fans and appliances dominate',
    nr: 'NR 45+',
    // No acoustic table covers kitchen extract, so these are the AIRAH riser
    // cap (10.0 m/s absolute, at every NR) rather than a published kitchen
    // figure. 12.0 was above it, and above the 9 m/s the grease system itself
    // allows — the grease cap masked the contradiction for grease ducts while
    // make-up air through the same kitchen still read 12.
    //
    // 10.0 on the main leaves room for the "≤10 m/s on a short riser if noise
    // allows" case in the design basis: raise the SYSTEM cap from 9 to 10 for
    // that job and the space no longer stands in the way.
    roles: { main: 10.0, branch: 8.0, runout: 8.0 },
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
    // id is 'grease', not 'kitchen', so it can never be confused with the
    // Commercial kitchen SPACE of that name — they are different lookups.
    id: 'grease',
    name: 'Kitchen grease extract',
    short: 'Kitchen',
    useCase: 'Commercial kitchen canopies & grease ducts',
    /**
     * EQUAL FRICTION, like everything else — not constant velocity.
     *
     * This used to size to a minimum transport velocity, on the standard
     * reasoning that slower air lets grease settle out. That reasoning is
     * pre-2002 and was overturned: ASHRAE RP-1033 (Kuehn) showed grease
     * deposition INCREASES with velocity, and NFPA 96 cut its minimum from
     * 1500 fpm (7.6 m/s) to 500 fpm (2.54 m/s) by Errata 96-01-01 in January
     * 2002. Any source quoting 7.5 m/s "to keep grease in suspension" predates
     * that. AS 1668.2-2002 sets no in-duct velocity at all — only hood face
     * (Type A capture 0.5 m/s, dishwasher 0.3 m/s) and discharge (5 m/s).
     *
     * So the duct is sized on the project friction target at full design flow,
     * with velocity as a two-sided check rather than the sizing input.
     */
    sizingMethod: 'friction',
    // Flexible duct is not normally fire-code permitted for grease extract
    // (e.g. NFPA 96 / DW/172), so it is not offered as a duct type here.
    allowsFlexible: false,
    /**
     * Velocity floor at full design flow, m/s. Judgement, taken at the lower
     * bound of DW/172's branch range. It OVERRIDES the friction target on small
     * flows: sizing for Pa/m alone leaves a small duct oversized and the air
     * slack, so the duct comes back down a size to hold this instead.
     *
     * Not a grease-suspension figure — see the note on sizingMethod. It is
     * there to stop a small duty producing a duct nothing moves through.
     */
    minVelocity: 5.0,
    /**
     * Velocity ceiling at full design flow, m/s. DW/172 gives 6–9 m/s for
     * extract mains; 9 is the top of that. Short risers can take ~10 if noise
     * allows, which is a per-job override rather than a default. There is no
     * code maximum; the US industry norm is 2500 fpm (12.7 m/s), set by noise.
     *
     * The SPACE the duct runs through caps it further — see `maxVelocity`.
     */
    maxVelocity: 9.0,
    /**
     * Velocity floor at minimum turndown, m/s — NFPA 96 / IMC 506.3.4
     * (500 fpm). This is the one velocity figure that is a code requirement
     * rather than guidance, and it applies at the turndown flow of a VSD or
     * DCKV system, not at design flow. Checked separately; see `turndownPct`
     * on a segment.
     */
    minVelocityTurndown: 2.5,
    /** Hood spigot connection velocity, m/s — DW/172 practice. Advisory. */
    spigotVelocity: [5.0, 7.0],
    /**
     * Discharge velocity, m/s. AS 1668.2-2002 cl. 5.10.3 requires ≥ 5 m/s
     * vertical for systems over 1000 l/s. UK planning practice asks for 10–15
     * near sensitive receptors, so 10 is the target rather than the minimum.
     */
    dischargeMin: 5.0,
    dischargeTarget: 10.0,
    /** Round or square preferred; rectangular held to 2:1. */
    maxAspect: 2,
    /** Design air density, kg/m³ — roughly 35 °C, not 20 °C room air. */
    designDensity: 1.15,
  },
  {
    id: 'dust',
    name: 'Dust / fume extract (LEV)',
    short: 'Dust',
    useCase: 'Local exhaust ventilation — woodworking, grinding, fume',
    /**
     * Equal friction with a transport-velocity floor, like the other systems.
     * A separate constant-velocity sizing mode is unnecessary: wherever the
     * floor binds the two produce identical selections, and at ACGIH transport
     * velocities (10–22.5 m/s) the floor binds everywhere — a 1 Pa/m target
     * never produces anything near that fast.
     */
    sizingMethod: 'friction',
    /**
     * Flexible duct is excluded. LEV uses flexible HOSE, which is a different
     * product from HVAC flexible duct: it runs at transport velocity, not the
     * 3.5 m/s that `FLEX_MAX_VELOCITY` holds comfort runouts to. Offering it
     * here would produce a contradiction the app would then have to explain.
     */
    allowsFlexible: false,
    /** Set from the dust class — see `DUST_CLASSES`. The default is average. */
    minVelocity: 17.5,
    /**
     * Erosion and energy, not noise. ACGIH gives no maximum; above roughly
     * this, abrasive dust starts eating elbows and the fan power stops being
     * worth it.
     */
    maxVelocity: 25.0,
    /**
     * The transport minimum OVERRIDES the space's acoustic maximum.
     *
     * Every space here caps at 10 m/s or less, and every dust class needs more
     * than that, so without this a dust system could never be sized at all.
     * That is not a modelling fudge: in practice an LEV duct runs at transport
     * velocity and the noise is dealt with separately, because silting the duct
     * up is the worse failure. The app says plainly that the duct will be loud
     * rather than pretending the acoustic limit was met.
     */
    transportGoverns: true,
    /** Round or square strongly preferred — corners collect dust. */
    maxAspect: 2,
  },
];

/**
 * Minimum transport velocity by dust class, m/s — ACGIH *Industrial Ventilation:
 * A Manual of Recommended Practice*, the classic design-velocity table.
 *
 * This is the one place a minimum velocity really is about keeping material
 * airborne, and it is NOT what ASHRAE RP-1033 overturned — that was grease
 * aerosol condensing on duct walls, a different mechanism from a solid particle
 * dropping out of an airstream. Fall below these and the duct silts up.
 *
 * READ BEFORE USE: these came through SECONDARY sources. The ACGIH manual is
 * paywalled, and the reproductions disagree at the light end — one puts light
 * dust at 2,000–2,500 fpm against the 3,000 fpm here. Corroborated at three
 * points only: welding fume ~2,000–2,500 fpm, wood/sawdust ~3,500 fpm, metal
 * turnings ~4,500 fpm. Check against the manual before specifying.
 *
 * Each figure is the LOWER bound of the published range, which is what
 * "minimum transport velocity" means. ACGIH and ASHRAE are both reported to
 * suggest designing 10–15 % above it.
 */
export const DUST_CLASSES = [
  { id: 'fume', name: 'Fumes & very fine', minVelocity: 10.0,
    examples: 'Welding and soldering fume, zinc and aluminium oxide' },
  { id: 'light', name: 'Very fine light dust', minVelocity: 12.5,
    examples: 'Cotton lint, wood flour, litho powder' },
  { id: 'dry', name: 'Dry dusts & powders', minVelocity: 15.0,
    examples: 'Fine rubber dust, moulding powder, jute lint, soap, leather shavings' },
  { id: 'average', name: 'Average industrial dust', minVelocity: 17.5,
    examples: 'Sawdust, grinding dust, coffee, silica flour, brick cutting, limestone' },
  { id: 'heavy', name: 'Heavy dusts', minVelocity: 20.0,
    examples: 'Wet sawdust, metal turnings, shot blast, lead dust, cast iron borings' },
  { id: 'moist', name: 'Heavy or moist', minVelocity: 22.5,
    examples: 'Moist cement, quicklime, sticky buffing lint, lead with chips' },
];

export function dustClass(id) {
  return DUST_CLASSES.find((c) => c.id === id) ?? DUST_CLASSES[3];
}

/** Project-wide friction target, Pa/m — the main driver of duct size. */
export const DEFAULT_FRICTION_TARGET = 1.0;

/**
 * Velocity cap for flexible duct, m/s — AIRAH sw022, which calls it reasonable
 * present-day practice to limit a flexible runout to this.
 *
 * The per-space flexible entries removed earlier were inert and unsourced; this
 * is neither. It binds where a space's runout limit is looser than 3.5 — retail
 * (5.0), back of house (6.0) — which is most of them.
 *
 * The same source allows twice the measured length when working out flexible
 * friction. That is a second model alongside the compression factors in
 * `FLEX_CONDITIONS`, not a replacement: x2 on length is the same arithmetic as
 * the "15 % compressed" x2 on rate over a given run.
 */
export const FLEX_MAX_VELOCITY = 3.5;

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

/**
 * Flexible duct used to carry its own velocity entry per space. It has been
 * dropped: those figures were inert, because flexible duct's roughness makes the
 * friction target bind long before any velocity limit does — at 120 l/s a
 * bedroom (2.5 m/s), an office (4.0) and a retail space (5.0) all produced the
 * same Ø250 at 2.44 m/s. What actually matters for flexible duct is its pressure
 * drop, and that is already modelled by roughness and the compression factor.
 * Flexible duct is locked to the runout role, so it reads that space's limit.
 */

/**
 * Maximum velocity for a space + duct role, m/s. Set by noise alone.
 */
export function maxVelocity(spaceId, roleId) {
  const space = spaceType(spaceId);
  return space.roles[roleId] ?? space.roles.branch;
}

/**
 * Velocity floor at design flow for a system, m/s, or 0 where there is none.
 * Only kitchen grease extract has one, and it is flat across the roles: the
 * figure is a lower bound on how slack the air may get, not a per-position
 * transport requirement.
 */
export function minVelocity(systemId) {
  return systemType(systemId).minVelocity ?? 0;
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
  { id: 'hood_entry', name: 'Canopy hood entry', zeta: 0.75, group: 'Entries & exits', shapes: ['circular', 'rectangular'] },
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
  // Kitchen grease extract fan-duty build-up: dirty baffle filters (supplier
  // data, typically 100–150 Pa) and the hood entry (K 0.5–1.0).
  { id: 'baffle', name: 'Baffle filters, dirty', fixedPa: 125, group: 'Fixed loss', shapes: ['circular', 'rectangular'] },
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
