/**
 * DUCT — UI layer.
 *
 * Segment cards are built once per structural change (add/remove segment,
 * shape change); every keystroke only rewrites output nodes, so focus and
 * caret position survive a recalculation.
 */

import { airProperties, calcSegment, calcRun, pressureClassDependsOnSign } from './engine.js';
import {
  SPACE_TYPES,
  SYSTEM_TYPES,
  FLEX_MAX_VELOCITY,
  DEFAULT_FRICTION_TARGET,
  DUCT_ROLES,
  DEFAULT_MATERIAL,
  FLEX_CONDITIONS,
  FITTINGS,
  fittingGroups,
  materialsFor,
  material,
  spaceType,
  systemType,
  systemAllowsFlexible,
  shapesForSystem,
  maxVelocity,
  minVelocity,
  ROUND_SIZES,
  RECT_SIZES,
  FLEX_SIZES,
} from './data.js';

/** Standard duct sizes are user-editable; these are the shipped starting points. */
const DEFAULT_SIZE_LISTS = { round: ROUND_SIZES, rect: RECT_SIZES, flex: FLEX_SIZES };

/** Duct roles a velocity limit applies to. Flexible duct no longer has its own
 * entry — those figures were inert (see the note in data.js) and flexible is
 * locked to the runout role, so it reads that limit. */
const VEL_ROLE_ORDER = ['main', 'branch', 'runout'];
const VEL_ROLE_LABELS = { main: 'Main', branch: 'Branch', runout: 'Runout' };

/** Maximum velocity by space + role, user-editable in Settings; these are the
 * shipped starting points, cloned from data.js's reference values. Noise is the
 * only thing setting these, so they belong to the space, not the system. */
const DEFAULT_MAX_VELOCITY = Object.fromEntries(
  SPACE_TYPES.map((space) => [
    space.id,
    Object.fromEntries(VEL_ROLE_ORDER.map((role) => [role, space.roles[role]])),
  ])
);

/* Grease extract carries its own velocity band on top of the space's acoustic
 * maximum — a floor that overrides the friction target on small flows, and a
 * ceiling from DW/172's extract-main range. Both editable. */
const DEFAULT_GREASE_MIN_VELOCITY = systemType('grease').minVelocity;
const DEFAULT_GREASE_MAX_VELOCITY = systemType('grease').maxVelocity;
/** NFPA 96 / IMC 506.3.4, 500 fpm — checked at turndown, not design flow. */
const DEFAULT_TURNDOWN_VELOCITY = systemType('grease').minVelocityTurndown;

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

const num = (v, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Round to a sensible number of significant places for a display value. */
function fmt(value, decimals = 1) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

const fmt0 = (v) => fmt(v, 0);

/* Bottom sheets: lock the page behind them. Without this the document scrolls
   under an open sheet on touch devices, which both feels broken and leaves the
   page somewhere unexpected once the sheet closes. */
let lockedScrollY = 0;

function openSheet(dialog) {
  lockedScrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  dialog.showModal();
}

function releaseScrollLock() {
  if (!document.body.style.position) return;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  window.scrollTo(0, lockedScrollY);
}

let toastTimer;
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 1900);
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const STORAGE_KEY = 'duct.state.v1';
let segmentSeq = 0;

function newSegment(over = {}) {
  return {
    id: `s${++segmentSeq}`,
    airflowLps: 250,
    role: 'branch',
    shape: 'circular',
    materialId: DEFAULT_MATERIAL.circular,
    flexCondition: 'extended',
    heightMm: '',
    widthMm: '',
    lengthM: 10,
    componentPa: 0,
    fittings: [],
    collapsed: false,
    ...over,
  };
}

/** Change a segment's duct type, resetting the material and dropping any
 * fittings that don't apply to the new shape. Shared by the per-segment
 * picker and the grease-extract flexible-duct rule below. */
function setSegmentShape(seg, shapeId) {
  seg.shape = shapeId;
  seg.materialId = DEFAULT_MATERIAL[shapeId];
  seg.fittings = seg.fittings.filter((f) => {
    const def = FITTINGS.find((x) => x.id === f.id);
    return def ? def.shapes.includes(shapeId) : true;
  });
  if (shapeId !== 'rectangular') seg.widthMm = '';
  // Flexible duct is a runout. The role picker is hidden for it, so without
  // this the segment keeps whatever role it had and silently reads that limit
  // instead — a flexible "main" would be checked against the main's velocity.
  if (shapeId === 'flexible') seg.role = 'runout';
}

/** Where a system disallows flexible duct (see `allowsFlexible` in data.js),
 * convert any segment that's already flexible when a run switches into it — or
 * loads with it saved — rather than just flagging it after. */
function enforceShapeRules(systemId, segments) {
  for (const seg of segments) {
    if (seg.shape !== 'flexible') continue;
    if (!systemAllowsFlexible(systemId)) {
      setSegmentShape(seg, 'circular');
      continue;
    }
    // Flexible duct is a runout. `role = main` + `shape = flexible` was a
    // combination the app would let you build and nobody would ever install,
    // and with the separate flex velocity entry gone the role is what the
    // limit is read from — so it has to be the right one.
    seg.role = 'runout';
  }
}

function defaultState() {
  return {
    project: '',
    spaceTypeId: 'openplan',
    systemTypeId: 'standard',
    useStandardSizes: true,
    tempC: 20,
    altitudeM: 0,
    maxAspect: 4,
    maxHeightMm: 0,
    plantPa: 0,
    marginPct: 10,
    leakageClass: 'A',
    sizeLists: {
      round: [...DEFAULT_SIZE_LISTS.round],
      rect: [...DEFAULT_SIZE_LISTS.rect],
      flex: [...DEFAULT_SIZE_LISTS.flex],
    },
    // Sizing method is fixed per system (see data.js) — not stored here.
    // One project-wide friction target: with noise handled by the velocity cap
    // there is no reason for it to vary by room.
    frictionTarget: DEFAULT_FRICTION_TARGET,
    maxVelocities: JSON.parse(JSON.stringify(DEFAULT_MAX_VELOCITY)),
    greaseMinVelocity: DEFAULT_GREASE_MIN_VELOCITY,
    greaseMaxVelocity: DEFAULT_GREASE_MAX_VELOCITY,
    turndownVelocity: DEFAULT_TURNDOWN_VELOCITY,
    // % of design flow at minimum turndown; 0 = constant volume, no check.
    turndownPct: 0,
    segments: [newSegment()],
  };
}

/** The size list a segment's shape snaps to; falls back to the shipped default if the
 * user has emptied a list, since an empty list breaks rectangular sizing. */
function sizeListFor(key) {
  const list = state.sizeLists?.[key];
  return list && list.length > 0 ? list : DEFAULT_SIZE_LISTS[key];
}

function sizesForShape(shape) {
  if (shape === 'rectangular') return sizeListFor('rect');
  if (shape === 'flexible') return sizeListFor('flex');
  return sizeListFor('round');
}

/** The project friction target, Pa/m. Falls back to the shipped default if the
 * field has been emptied or broken. */
function frictionTarget() {
  const v = state.frictionTarget;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_FRICTION_TARGET;
}

/** Maximum velocity for a space + duct role. Set by noise alone. */
function maxVelocityFor(spaceId, roleKey) {
  const v = state.maxVelocities?.[spaceId]?.[roleKey];
  const def = DEFAULT_MAX_VELOCITY[spaceId]?.[roleKey] ?? maxVelocity(spaceId, roleKey);
  return Number.isFinite(v) && v > 0 ? v : def;
}

/** Velocity floor for a system, m/s, or 0 where it has none. Grease only. */
function minVelocityFor(systemId) {
  if (!(minVelocity(systemId) > 0)) return 0;
  const v = state.greaseMinVelocity;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_GREASE_MIN_VELOCITY;
}

/** A system's own velocity ceiling, m/s, or Infinity where it has none. */
function systemMaxVelocityFor(systemId) {
  if (!(systemType(systemId).maxVelocity > 0)) return Infinity;
  const v = state.greaseMaxVelocity;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_GREASE_MAX_VELOCITY;
}

/**
 * The band the UI and sizing both work from.
 *
 * The maximum is whichever binds first of three: the space's acoustic limit,
 * the system's own (DW/172 caps a grease extract main at 9 m/s wherever it
 * runs), and the flexible-duct cap. Flexible duct is the one shape with a
 * published limit of its own — AIRAH sw022 at 3.5 m/s — and that binds under
 * most spaces' runout figures.
 */
function limitsFor(spaceId, systemId, roleKey, shape) {
  return {
    min: minVelocityFor(systemId),
    max: Math.min(
      maxVelocityFor(spaceId, roleKey),
      systemMaxVelocityFor(systemId),
      shape === 'flexible' ? FLEX_MAX_VELOCITY : Infinity
    ),
  };
}

/** Aspect-ratio limit: a system may hold itself tighter than the project does. */
function maxAspectFor(systemId) {
  const sys = systemType(systemId).maxAspect;
  return Math.min(num(state.maxAspect, 4), sys ?? Infinity);
}

let state = load() ?? defaultState();

/** Keep the segment id sequence ahead of anything restored, so a new segment
 * can't collide with one that came out of storage. */
function advanceSegmentSeq(segments) {
  for (const seg of segments ?? []) {
    const n = parseInt(String(seg.id).replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) segmentSeq = Math.max(segmentSeq, n);
  }
}

/**
 * Bring a stored state up to the current shape: fill in fields added since it
 * was written, drop fields that have moved, and re-apply rules it may predate.
 * Shared by the working-state load and by opening a saved calculation, so an
 * old save can't reach the app in a shape the rest of the code doesn't expect.
 */
function normaliseState(parsed) {
  const defaults = defaultState();
  const merged = { ...defaults, ...parsed };
  // Older saves predate the custom size lists, or may only have some shapes set.
  merged.sizeLists = { ...defaults.sizeLists, ...(parsed.sizeLists ?? {}) };
  /* -- space / system split -------------------------------------------
   * "Residential / Commercial / Kitchen Extract" used to be one setting doing
   * two jobs. It is now a SPACE (which sets the velocity maximum, since noise
   * is the only thing driving it) and a SYSTEM (which sets the sizing method).
   * Map an old save onto the nearest pair; the velocity numbers themselves do
   * not carry over, because they were keyed to buckets that no longer exist. */
  const LEGACY_SPACE = {
    residential: { spaceTypeId: 'living', systemTypeId: 'standard' },
    commercial: { spaceTypeId: 'openplan', systemTypeId: 'standard' },
    // Kitchen extract is its own SPACE now, not back-of-house: the duct runs
    // in a kitchen, where the canopy fans and appliances dominate.
    industrial: { spaceTypeId: 'kitchen', systemTypeId: 'grease' },
  };
  const legacy = LEGACY_SPACE[parsed.spaceTypeId];
  if (legacy) {
    merged.spaceTypeId = legacy.spaceTypeId;
    merged.systemTypeId = parsed.systemTypeId ?? legacy.systemTypeId;
  }
  // The grease system was briefly id 'kitchen', which now names the SPACE.
  if (merged.systemTypeId === 'kitchen') merged.systemTypeId = 'grease';
  if (!SPACE_TYPES.some((x) => x.id === merged.spaceTypeId)) merged.spaceTypeId = defaults.spaceTypeId;
  if (!SYSTEM_TYPES.some((x) => x.id === merged.systemTypeId)) merged.systemTypeId = defaults.systemTypeId;

  // The friction target was a per-space map and is now one project-wide value.
  // Test what the SAVE held, not `merged` — merged already carries the default,
  // so checking it there would silently drop a target the user had tuned.
  if (!(Number.isFinite(parsed.frictionTarget) && parsed.frictionTarget > 0)) {
    const old = parsed.frictionTargets;
    const carried = old?.[parsed.spaceTypeId] ?? old?.commercial;
    merged.frictionTarget = Number.isFinite(carried) && carried > 0 ? carried : DEFAULT_FRICTION_TARGET;
  }
  delete merged.frictionTargets;

  merged.maxVelocities = {};
  for (const spaceId of Object.keys(defaults.maxVelocities)) {
    merged.maxVelocities[spaceId] = {
      ...defaults.maxVelocities[spaceId],
      ...(parsed.maxVelocities?.[spaceId] ?? {}),
    };
  }
  // Grease extract sized to a per-role minimum transport velocity under a Pa/m
  // ceiling until the design basis moved it to equal friction with a two-sided
  // velocity check; neither of those shapes survives.
  delete merged.minVelocities;
  delete merged.greaseMaxFriction;
  for (const [key, def] of [
    ['greaseMinVelocity', DEFAULT_GREASE_MIN_VELOCITY],
    ['greaseMaxVelocity', DEFAULT_GREASE_MAX_VELOCITY],
    ['turndownVelocity', DEFAULT_TURNDOWN_VELOCITY],
  ]) {
    if (!(Number.isFinite(merged[key]) && merged[key] > 0)) merged[key] = def;
  }
  if (!Number.isFinite(merged.turndownPct) || merged.turndownPct < 0) merged.turndownPct = 0;
  // Old recommended/max pairs keyed to the retired space buckets.
  delete merged.velocityLimits;

  // Sizing method and its single global target used to be flat, user-set
  // fields; both are now fixed per system and live in the maps above.
  delete merged.method;
  delete merged.targetFriction;
  delete merged.targetVelocity;
  // The regenerated-noise estimate and its duct-to-room correction were removed
  // (see the note in engine.js); drop a stale saved value rather than carry it.
  delete merged.roomCorrection;
  // A save from before flexible was excluded from grease extract could still
  // have a flexible segment sitting under it.
  enforceShapeRules(merged.systemTypeId, merged.segments);
  return merged;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.segments) || parsed.segments.length === 0) return null;
    advanceSegmentSeq(parsed.segments);
    return normaliseState(parsed);
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — the app still works, it just won't persist */
  }
}

/* ------------------------------------------------------------------ *
 * Saved calculations
 *
 * A named calculation stores only what lives on the MAIN page — airflows,
 * segments, space type, system allowances. Everything in Settings (size
 * lists, velocity targets, air conditions) is a global preference and is
 * deliberately left alone when a saved calculation is opened: those describe
 * your supplier and your standards, not one job, and silently rewriting them
 * because you opened an old job would be worse than the alternative.
 *
 * The trade-off that buys is real and worth knowing: a saved calculation is
 * not a frozen record. Change a velocity target and an old job reopened will
 * recalculate against the new one. Export the CSV if a fixed record matters.
 * ------------------------------------------------------------------ */

const LIBRARY_KEY = 'duct.projects.v1';

/** Fields belonging to the calculation rather than to global preferences. */
const CALC_KEYS = [
  'project',
  'spaceTypeId',
  'systemTypeId',
  'useStandardSizes',
  'segments',
  'plantPa',
  'marginPct',
  'leakageClass',
];

function loadLibrary() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((e) => e && e.id && e.name) : [];
  } catch {
    return [];
  }
}

function persistLibrary(list) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false; // quota exceeded or private mode
  }
}

function calcSnapshot() {
  const snap = {};
  for (const key of CALC_KEYS) snap[key] = state[key];
  return JSON.parse(JSON.stringify(snap));
}

/** Save under `name`, replacing any existing entry with the same name. */
function saveCalculation(rawName) {
  const name = String(rawName ?? '').trim();
  if (!name) return { ok: false, error: 'Enter a name for this calculation.' };

  const list = loadLibrary();
  const at = list.findIndex((e) => e.name.toLowerCase() === name.toLowerCase());
  if (at >= 0 && !confirm(`“${name}” already exists. Replace it?`)) return { ok: false };

  state.project = name;
  const entry = {
    id: at >= 0 ? list[at].id : `p${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    name,
    savedAt: new Date().toISOString(),
    calc: calcSnapshot(),
  };
  if (at >= 0) list[at] = entry;
  else list.unshift(entry);

  if (!persistLibrary(list)) {
    return { ok: false, error: 'Could not save — device storage is full.' };
  }
  $('#project').value = name;
  save();
  return { ok: true, replaced: at >= 0 };
}

function openCalculation(id) {
  const entry = loadLibrary().find((e) => e.id === id);
  if (!entry) return false;
  advanceSegmentSeq(entry.calc?.segments);
  // Merge the calculation over the CURRENT state so global preferences survive,
  // then normalise — the entry may have been written by an older version.
  state = normaliseState({ ...state, ...entry.calc });
  buildDesignBasis();
  renderAll();
  return true;
}

function deleteCalculation(id) {
  const list = loadLibrary();
  const entry = list.find((e) => e.id === id);
  if (!entry) return false;
  if (!confirm(`Delete “${entry.name}”? This cannot be undone.`)) return false;
  persistLibrary(list.filter((e) => e.id !== id));
  return true;
}

function renderLibrary() {
  const list = loadLibrary();
  $('#saved-count').textContent = list.length ? `Saved (${list.length})` : 'Saved';
  const host = $('#saved-list');

  if (list.length === 0) {
    host.replaceChildren(
      el('p', { class: 'empty-note', text: 'Nothing saved yet — name the current calculation above to keep it.' })
    );
    return;
  }

  host.replaceChildren(
    ...list.map((entry) => {
      const calc = entry.calc ?? {};
      const segs = Array.isArray(calc.segments) ? calc.segments : [];
      const duty = num(segs[0]?.airflowLps, 0);
      const when = new Date(entry.savedAt);
      const meta = [
        spaceType(calc.spaceTypeId).name,
        `${segs.length} segment${segs.length === 1 ? '' : 's'}`,
        duty > 0 ? `${fmt0(duty)} l/s` : null,
        Number.isNaN(when.getTime())
          ? null
          : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) +
            ' ' +
            when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      ].filter(Boolean);

      return el('div', { class: 'saved-row' }, [
        el('button', {
          class: 'saved-open',
          type: 'button',
          onclick: () => {
            if (openCalculation(entry.id)) {
              $('#saved-sheet').close();
              toast(`Opened “${entry.name}”`);
            }
          },
        }, [
          el('b', { text: entry.name }),
          el('span', { text: meta.join(' · ') }),
        ]),
        el('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': `Delete ${entry.name}`,
          onclick: () => {
            if (deleteCalculation(entry.id)) {
              renderLibrary();
              toast('Deleted');
            }
          },
        }, [
          el('span', {
            html: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
          }),
        ]),
      ]);
    })
  );
}

function openSavedSheet() {
  $('#save-name').value = state.project ?? '';
  $('#save-error').textContent = '';
  renderLibrary();
  $('#saved-list').scrollTop = 0;
  openSheet($('#saved-sheet'));
}

/* ------------------------------------------------------------------ *
 * Calculation
 * ------------------------------------------------------------------ */

function context(segment) {
  const air = airProperties(num(state.tempC, 20), num(state.altitudeM, 0));
  const mat = material(segment.materialId);
  const flex =
    FLEX_CONDITIONS.find((c) => c.id === segment.flexCondition) ?? FLEX_CONDITIONS[0];
  const system = systemType(state.systemTypeId);
  // Flexible duct is locked to the runout role by `enforceShapeRules`, so the
  // role is read straight through; it no longer has a limit of its own.
  const roleKey = segment.role;
  // max comes from the SPACE (noise), min from the SYSTEM (grease transport).
  const limits = limitsFor(state.spaceTypeId, state.systemTypeId, roleKey, segment.shape);

  return {
    air,
    roughness: mat.roughnessMm / 1000,
    flexFactor: flex.factor,
    // Fixed per system — see data.js. 'velocity' sizes to `limits.min` as a
    // MINIMUM (engine.js snaps standard sizes down, not up, to hold it).
    method: system.sizingMethod,
    targetFriction: frictionTarget(),
    targetVelocity: limits.min,
    maxVelocity: limits.max,
    // Friction mode: the floor that overrides the friction target on a small
    // flow, where sizing for Pa/m alone leaves the air slack.
    minVelocity: limits.min,
    roundSizes: sizesForShape(segment.shape),
    rectSizes: sizeListFor('rect'),
    useStandardSizes: state.useStandardSizes,
    preferredAspect: 1.5,
    maxAspect: maxAspectFor(state.systemTypeId),
    maxHeightMm: num(state.maxHeightMm, 0) > 0 ? num(state.maxHeightMm) : Infinity,
    limits,
    roleKey,
  };
}

function compute() {
  const results = state.segments.map((seg) => {
    const ctx = context(seg);
    const result = calcSegment(
      {
        airflowLps: num(seg.airflowLps, 0),
        shape: seg.shape,
        lengthM: num(seg.lengthM, 0),
        heightMm: num(seg.heightMm, 0) || null,
        widthMm: num(seg.widthMm, 0) || null,
        componentPa: num(seg.componentPa, 0),
        fittings: seg.fittings.map((f) => ({
          id: f.id,
          name: f.name,
          zeta: num(f.zeta, 0),
          fixedPa: num(f.fixedPa, 0),
          qty: num(f.qty, 1),
        })),
      },
      ctx
    );
    return { seg, ctx, result };
  });

  const run = calcRun(
    results.map((r) => r.result),
    {
      plantPa: num(state.plantPa, 0),
      marginPct: num(state.marginPct, 0),
      leakageClass: state.leakageClass,
    }
  );

  return { results, run, air: airProperties(num(state.tempC, 20), num(state.altitudeM, 0)) };
}

/**
 * Velocity status against the limits in play.
 *
 * Over the space's acoustic maximum is bad on any system. Amber within 10 % of
 * it: that band is derived from the one limit rather than asked for as a second
 * number, because "recommended" and "maximum" would be the same judgement
 * twice. Under the system's minimum is bad too where there is one — on grease
 * extract that is the failure that lets material settle out and foul the duct.
 */
const VELOCITY_WARN_FRACTION = 0.9;

function velocityStatus(velocity, limits) {
  if (!(velocity > 0)) return 'info';
  if (velocity > limits.max) return 'bad';
  if (limits.min > 0 && velocity < limits.min) return 'bad';
  return velocity > limits.max * VELOCITY_WARN_FRACTION ? 'warn' : 'ok';
}

/* ------------------------------------------------------------------ *
 * Static controls
 * ------------------------------------------------------------------ */

function buildSegmentedControl(container, name, options, selected, onChange) {
  container.replaceChildren(
    ...options.map((opt) =>
      el('label', {}, [
        el('input', {
          type: 'radio',
          name,
          value: opt.id,
          checked: opt.id === selected,
          onchange: () => onChange(opt.id),
        }),
        el('span', { text: opt.short ?? opt.name }),
      ])
    )
  );
}

function buildDesignBasis() {
  // Six spaces don't fit a segmented control at phone width, so this one is a
  // select; the system, with two, stays a segmented control.
  const spaceSelect = $('#space-select');
  spaceSelect.replaceChildren(
    ...SPACE_TYPES.map((sp) =>
      el('option', { value: sp.id, text: `${sp.name} — ${sp.nr}`, selected: sp.id === state.spaceTypeId })
    )
  );
  spaceSelect.value = state.spaceTypeId;
  spaceSelect.addEventListener('change', (e) => {
    state.spaceTypeId = e.target.value;
    renderAll();
  });

  buildSegmentedControl($('#system-group'), 'system', SYSTEM_TYPES, state.systemTypeId, (id) => {
    state.systemTypeId = id;
    enforceShapeRules(id, state.segments);
    renderAll();
  });

  $('#standard-sizes').checked = state.useStandardSizes;
  $('#project').value = state.project;
  $('#plant-pa').value = state.plantPa;
  $('#margin-pct').value = state.marginPct;
  $('#leakage-class').value = state.leakageClass;
  $('#temp-c').value = state.tempC;
  $('#altitude').value = state.altitudeM;
  $('#max-aspect').value = state.maxAspect;
  $('#max-height').value = state.maxHeightMm || '';

  syncSizeFields();
}

/* ------------------------------------------------------------------ *
 * Custom standard size lists
 *
 * Chips instead of a comma-separated text field: iOS's numeric keypad
 * (inputmode="numeric"/"decimal") has no comma and no space, so there was no
 * way to separate values on a phone. One-number-at-a-time entry sidesteps
 * that entirely and suits a touch tool better anyway.
 * ------------------------------------------------------------------ */

const SIZE_KEYS = ['round', 'rect', 'flex'];

function renderSizeChips(key) {
  $(`#sizes-${key}-chips`).replaceChildren(
    ...sizeListFor(key).map((size) =>
      el('span', { class: 'chip', role: 'listitem' }, [
        `${size}`,
        el('button', {
          type: 'button',
          'aria-label': `Remove ${size} mm`,
          text: '×',
          onclick: () => removeSize(key, size),
        }),
      ])
    )
  );
}

function addSize(key, rawValue) {
  const errorNode = $(`#sizes-${key}-error`);
  const n = Math.round(num(rawValue, NaN));
  if (!Number.isFinite(n) || n <= 0) {
    errorNode.textContent = 'Enter a size in mm.';
    return false;
  }
  if (state.sizeLists[key].includes(n)) {
    errorNode.textContent = `${n} mm is already in the list.`;
    return false;
  }
  state.sizeLists[key] = [...state.sizeLists[key], n].sort((a, b) => a - b);
  errorNode.textContent = '';
  renderSizeChips(key);
  update();
  return true;
}

function removeSize(key, value) {
  state.sizeLists[key] = state.sizeLists[key].filter((v) => v !== value);
  $(`#sizes-${key}-error`).textContent = '';
  renderSizeChips(key);
  update();
}

function resetSizeList(key) {
  state.sizeLists[key] = [...DEFAULT_SIZE_LISTS[key]];
  $(`#sizes-${key}-error`).textContent = '';
  renderSizeChips(key);
  update();
  toast('Reset to default sizes');
}

function bindSizeAdd(key) {
  const input = $(`#sizes-${key}-add`);
  const commit = () => {
    if (addSize(key, input.value)) {
      input.value = '';
      input.focus();
    }
  };
  $(`#sizes-${key}-add-btn`).addEventListener('click', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  });
  input.addEventListener('input', () => {
    $(`#sizes-${key}-error`).textContent = '';
  });
}

function syncSizeFields() {
  for (const key of SIZE_KEYS) renderSizeChips(key);
}

/* ------------------------------------------------------------------ *
 * Sizing targets (Settings)
 *
 * Sizing method is fixed per space type and isn't user-choosable — but the
 * numbers behind it (friction target; recommended/max velocity per duct
 * role, plus a dedicated set for flexible duct) are, so accidental changes
 * mid-job don't happen from the main page. `settingsSpaceId` is local to the
 * sheet — switching space type here to peek at another space's numbers
 * doesn't change the active calculation; it's reset to match whenever the
 * sheet is (re)opened.
 * ------------------------------------------------------------------ */

let settingsSpaceId = state.spaceTypeId;

function renderSettingsTargets() {
  const space = spaceType(settingsSpaceId);

  // A select, not a segmented control: at eight spaces the chips overflowed the
  // sheet at phone width with no way to scroll, which left the last two
  // uneditable. Matches the main page's picker.
  const picker = $('#settings-space-select');
  picker.replaceChildren(
    ...SPACE_TYPES.map((sp) =>
      el('option', { value: sp.id, text: `${sp.name} — ${sp.nr}`, selected: sp.id === settingsSpaceId })
    )
  );
  picker.value = settingsSpaceId;
  picker.onchange = (e) => {
    settingsSpaceId = e.target.value;
    renderSettingsTargets();
  };

  $('#settings-space-hint').textContent =
    `${space.name} — ${space.nr}. ${space.useCase}. These maxima are set by noise alone; ` +
    `the system chosen on the main page sets the sizing method.`;

  $('#settings-target-friction').value = frictionTarget();


  /* -- the space's acoustic maxima --------------------------------- */
  $('#settings-velocity-matrix').replaceChildren(
    el('div', { class: 'vel-matrix-head' }, [el('span'), el('span', { text: 'Max m/s' })]),
    ...VEL_ROLE_ORDER.map((roleKey) =>
      el('div', { class: 'vel-row two' }, [
        el('span', { class: 'vel-role', text: VEL_ROLE_LABELS[roleKey] }),
        el('input', {
          type: 'number',
          inputmode: 'decimal',
          step: '0.5',
          min: '0',
          value: maxVelocityFor(settingsSpaceId, roleKey),
          'aria-label': `${space.name} ${VEL_ROLE_LABELS[roleKey]} maximum velocity`,
          oninput: (e) => {
            state.maxVelocities[settingsSpaceId][roleKey] = num(
              e.target.value,
              maxVelocityFor(settingsSpaceId, roleKey)
            );
            update();
          },
        }),
      ])
    )
  );

  /* -- the grease band, which belongs to the system ----------------- */
  $('#settings-grease-min').value = minVelocityFor('grease');
  $('#settings-grease-max').value = systemMaxVelocityFor('grease');
  $('#settings-turndown-pct').value = state.turndownPct || '';
  $('#settings-turndown-velocity').value = num(state.turndownVelocity, DEFAULT_TURNDOWN_VELOCITY);
}

/* ------------------------------------------------------------------ *
 * Segment cards
 * ------------------------------------------------------------------ */

function renderSegments() {
  const host = $('#segments');
  host.replaceChildren(...state.segments.map((seg, i) => segmentCard(seg, i)));
}

function segmentCard(seg, index) {
  const removable = state.segments.length > 1;
  const card = el('section', {
    class: `card segment${seg.collapsed ? ' collapsed' : ''}${removable ? ' removable' : ''}`,
    'data-seg': seg.id,
  });

  /* -- header ------------------------------------------------------- */
  const head = el('button', {
    class: 'segment-head',
    type: 'button',
    'aria-expanded': String(!seg.collapsed),
    onclick: () => {
      seg.collapsed = !seg.collapsed;
      card.classList.toggle('collapsed', seg.collapsed);
      head.setAttribute('aria-expanded', String(!seg.collapsed));
      save();
    },
  }, [
    el('span', { class: 'segment-index', text: String(index + 1) }),
    el('span', { class: 'segment-title', text: index === 0 ? 'Duct segment' : 'Segment' }),
    el('span', { class: 'segment-sub' }, [
      el('span', { class: 'js-head-size' }),
      el('span', {
        class: 'chev',
        html: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      }),
    ]),
  ]);
  card.append(head);

  if (removable) {
    card.append(
      el('button', {
        class: 'icon-btn segment-remove',
        type: 'button',
        'aria-label': `Remove segment ${index + 1}`,
        onclick: () => {
          state.segments = state.segments.filter((s) => s.id !== seg.id);
          renderAll();
          toast('Segment removed');
        },
      }, [
        el('span', {
          html: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        }),
      ])
    );
  }

  const body = el('div', { class: 'segment-body' });
  card.append(body);

  /* -- airflow ------------------------------------------------------ */
  const airflowInput = el('input', {
    type: 'number',
    inputmode: 'decimal',
    step: '10',
    min: '0',
    value: seg.airflowLps,
    'aria-label': 'Airflow in litres per second',
    oninput: (e) => {
      seg.airflowLps = e.target.value;
      update();
    },
  });

  const bump = (delta) => {
    const next = Math.max(0, Math.round((num(seg.airflowLps, 0) + delta) / 5) * 5);
    seg.airflowLps = next;
    airflowInput.value = next;
    update();
  };

  body.append(
    el('div', { class: 'field' }, [
      el('label', { class: 'label', text: 'Airflow' }),
      el('div', { class: 'airflow' }, [
        el('button', { class: 'stepper', type: 'button', 'aria-label': 'Decrease airflow', onclick: () => bump(-25), text: '−' }),
        el('div', { class: 'input-unit' }, [airflowInput, el('span', { class: 'unit', text: 'l/s' })]),
        el('button', { class: 'stepper', type: 'button', 'aria-label': 'Increase airflow', onclick: () => bump(25), text: '+' }),
      ]),
      el('p', { class: 'hint js-flow-alt' }),
    ])
  );

  /* -- duct type & role --------------------------------------------- */
  // Where the space type disallows flexible, leave it off the picker entirely
  // rather than offer it and flag it after the fact.
  const shapeGroup = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Duct type' });
  buildSegmentedControl(shapeGroup, `shape-${seg.id}`, shapesForSystem(state.systemTypeId), seg.shape, (id) => {
    setSegmentShape(seg, id);
    renderAll();
  });
  const shapeField = el('div', { class: 'field' }, [el('label', { class: 'label', text: 'Duct type' }), shapeGroup]);
  if (!systemAllowsFlexible(state.systemTypeId)) {
    shapeField.append(
      el('p', {
        class: 'hint',
        text: `Flexible duct isn’t offered on ${systemType(state.systemTypeId).name.toLowerCase()} — not normally fire-code permitted for grease extract (e.g. NFPA 96/DW/172).`,
      })
    );
  }

  // Flexible duct always sizes to its own velocity limits (Settings),
  // regardless of role — showing a picker that has no effect would be worse
  // than not showing one, so swap it for a plain explanation instead.
  const roleField = el('div', { class: 'field' }, [el('label', { class: 'label', text: 'Duct role' })]);
  if (seg.shape === 'flexible') {
    roleField.append(
      el('p', {
        class: 'hint',
        text: 'Flexible duct sizes to its own velocity range regardless of role — see Settings.',
      })
    );
  } else {
    const roleGroup = el('div', { class: 'segmented segmented-sm', role: 'radiogroup', 'aria-label': 'Duct role' });
    buildSegmentedControl(roleGroup, `role-${seg.id}`, DUCT_ROLES, seg.role, (id) => {
      seg.role = id;
      update();
    });
    roleField.append(roleGroup);
  }
  roleField.append(el('p', { class: 'hint js-limit-hint' }));

  body.append(shapeField, roleField);

  /* -- material ------------------------------------------------------ */
  const materialSelect = el('select', {
    'aria-label': 'Duct material',
    onchange: (e) => {
      seg.materialId = e.target.value;
      update();
    },
  }, materialsFor(seg.shape).map((m) =>
    el('option', {
      value: m.id,
      selected: m.id === seg.materialId,
      text: `${m.name} — ε ${m.roughnessMm} mm`,
    })
  ));

  const materialField = el('div', { class: 'field' }, [
    el('label', { class: 'label', text: 'Material' }),
    materialSelect,
  ]);

  if (seg.shape === 'flexible') {
    const flexGroup = el('div', { class: 'segmented segmented-sm', role: 'radiogroup', 'aria-label': 'Flexible duct condition' });
    buildSegmentedControl(
      flexGroup,
      `flex-${seg.id}`,
      FLEX_CONDITIONS.map((c) => ({ id: c.id, short: c.name })),
      seg.flexCondition,
      (id) => {
        seg.flexCondition = id;
        update();
      }
    );
    body.append(
      materialField,
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Installed condition' }),
        flexGroup,
        el('p', {
          class: 'hint',
          text: 'Compressed flexible duct loses pressure far faster than the same duct pulled tight — 15 % compression roughly doubles it.',
        }),
      ])
    );
  } else {
    body.append(materialField);
  }

  /* -- overrides ----------------------------------------------------- */
  const rectangular = seg.shape === 'rectangular';
  const heightLabel = rectangular ? 'Height override' : 'Diameter override';

  const heightInput = el('input', {
    type: 'number',
    inputmode: 'numeric',
    step: '25',
    min: '0',
    placeholder: 'auto',
    value: seg.heightMm,
    'aria-label': heightLabel,
    oninput: (e) => {
      seg.heightMm = e.target.value;
      update();
    },
  });

  const widthInput = el('input', {
    type: 'number',
    inputmode: 'numeric',
    step: '25',
    min: '0',
    placeholder: rectangular ? 'auto' : 'n/a',
    value: seg.widthMm,
    disabled: !rectangular,
    'aria-label': 'Width override',
    oninput: (e) => {
      seg.widthMm = e.target.value;
      update();
    },
  });

  body.append(
    el('div', { class: 'row' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: heightLabel }),
        el('div', { class: 'input-unit' }, [heightInput, el('span', { class: 'unit', text: 'mm' })]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Width override' }),
        el('div', { class: 'input-unit' }, [widthInput, el('span', { class: 'unit', text: 'mm' })]),
      ]),
    ]),
    el('p', {
      class: 'hint',
      text: rectangular
        ? 'Set height to fit the void and the width is solved for you; set width and the height is solved. Set both to fix the size.'
        : 'Leave blank to size automatically, or enter a diameter to check a size you already have.',
    })
  );

  /* -- length & fixed loss ------------------------------------------- */
  body.append(
    el('div', { class: 'row' }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Straight length' }),
        el('div', { class: 'input-unit' }, [
          el('input', {
            type: 'number',
            inputmode: 'decimal',
            step: '0.5',
            min: '0',
            value: seg.lengthM,
            'aria-label': 'Straight length in metres',
            oninput: (e) => {
              seg.lengthM = e.target.value;
              update();
            },
          }),
          el('span', { class: 'unit', text: 'm' }),
        ]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'label', text: 'Extra fixed loss' }),
        el('div', { class: 'input-unit' }, [
          el('input', {
            type: 'number',
            inputmode: 'decimal',
            step: '5',
            min: '0',
            value: seg.componentPa,
            'aria-label': 'Extra fixed pressure loss in pascals',
            oninput: (e) => {
              seg.componentPa = e.target.value;
              update();
            },
          }),
          el('span', { class: 'unit', text: 'Pa' }),
        ]),
      ]),
    ])
  );

  /* -- fittings ------------------------------------------------------ */
  const fittingHost = el('div', { class: 'js-fittings' });
  body.append(
    el('div', { class: 'field' }, [
      el('label', { class: 'label', text: 'Fittings' }),
      fittingHost,
      el('button', {
        class: 'add-fitting',
        type: 'button',
        onclick: () => openFittingSheet(seg),
      }, [el('span', { class: 'plus', text: '+ ' }), 'Add fitting']),
    ])
  );
  renderFittings(seg, fittingHost);

  /* -- per-segment metrics ------------------------------------------- */
  body.append(el('div', { class: 'metric-grid seg-metrics js-seg-metrics' }));

  return card;
}

function renderFittings(seg, host) {
  if (seg.fittings.length === 0) {
    host.replaceChildren(
      el('p', { class: 'empty-note', text: 'No fittings yet — straight duct only.' })
    );
    return;
  }

  host.replaceChildren(
    ...seg.fittings.map((fit, i) => {
      const isFixed = num(fit.fixedPa, 0) > 0;

      const valueInput = el('input', {
        type: 'number',
        class: 'fitting-zeta',
        inputmode: 'decimal',
        step: isFixed ? '5' : '0.05',
        min: '0',
        value: isFixed ? fit.fixedPa : fit.zeta,
        'aria-label': isFixed ? `${fit.name} pressure loss in pascals` : `${fit.name} loss coefficient`,
        oninput: (e) => {
          if (isFixed) fit.fixedPa = e.target.value;
          else fit.zeta = e.target.value;
          update();
        },
      });

      const qtyLabel = el('span', { class: 'n', text: String(fit.qty) });
      const setQty = (delta) => {
        const next = Math.max(1, num(fit.qty, 1) + delta);
        fit.qty = next;
        qtyLabel.textContent = String(next);
        update();
      };

      return el('div', { class: 'fitting-row' }, [
        el('div', { class: 'fitting-name' }, [
          el('b', { text: fit.name }),
          el('span', { text: isFixed ? 'fixed loss, Pa each' : 'loss coefficient ζ' }),
        ]),
        el('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': `Remove ${fit.name}`,
          onclick: () => {
            seg.fittings.splice(i, 1);
            renderFittings(seg, host);
            update();
          },
        }, [
          el('span', {
            html: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
          }),
        ]),
        el('div', { class: 'fitting-controls' }, [
          valueInput,
          el('div', { class: 'qty' }, [
            el('button', { type: 'button', 'aria-label': `Decrease ${fit.name}`, text: '−', onclick: () => setQty(-1) }),
            qtyLabel,
            el('button', { type: 'button', 'aria-label': `Increase ${fit.name}`, text: '+', onclick: () => setQty(1) }),
          ]),
          el('span', { class: 'fitting-loss js-fit-loss', 'data-i': String(i) }),
        ]),
      ]);
    })
  );
}

/* ------------------------------------------------------------------ *
 * Fitting picker sheet
 * ------------------------------------------------------------------ */

/** Rebuild the picker list for `seg`, filtered by the search box. */
function renderFittingList(seg, query = '') {
  const list = $('#fitting-list');
  const q = query.trim().toLowerCase();
  list.replaceChildren();

  const add = (item) => {
    seg.fittings.push({
      id: item.id,
      name: item.name,
      zeta: item.zeta ?? 0,
      fixedPa: item.fixedPa ?? 0,
      qty: 1,
    });
    $('#fitting-sheet').close();
    const card = $(`[data-seg="${seg.id}"]`);
    if (card) renderFittings(seg, $('.js-fittings', card));
    update();
    toast(`${item.name} added`);
  };

  let shown = 0;
  for (const [group, items] of fittingGroups(seg.shape)) {
    const matches = q
      ? items.filter((i) => `${i.name} ${group}`.toLowerCase().includes(q))
      : items;
    if (matches.length === 0) continue;

    list.append(el('h3', { class: 'group-title', text: group }));
    for (const item of matches) {
      shown++;
      list.append(
        el('button', { class: 'pick', type: 'button', onclick: () => add(item) }, [
          el('span', { text: item.name }),
          el('span', {
            class: 'zeta',
            text: item.fixedPa ? `${item.fixedPa} Pa` : `ζ ${item.zeta}`,
          }),
        ])
      );
    }
  }

  if (shown === 0) {
    list.append(el('p', { class: 'empty-note', text: `Nothing matches “${query}”.` }));
  }
}

function openFittingSheet(seg) {
  const search = $('#fitting-search');
  search.value = '';
  search.oninput = () => renderFittingList(seg, search.value);
  renderFittingList(seg);
  $('#fitting-list').scrollTop = 0;
  openSheet($('#fitting-sheet'));
}

/* ------------------------------------------------------------------ *
 * Output rendering
 * ------------------------------------------------------------------ */

function metric(value, key, status = '') {
  return el('div', { class: `metric${status ? ` ${status}` : ''}` }, [
    el('span', { class: 'm-val', text: value }),
    el('span', { class: 'm-key', text: key }),
  ]);
}

function update() {
  const { results, run, air } = compute();
  const space = spaceType(state.spaceTypeId);
  const system = systemType(state.systemTypeId);
  const isGrease = system.id === 'grease';

  /* -- per-segment -------------------------------------------------- */
  results.forEach(({ seg, ctx, result }, i) => {
    const card = $(`[data-seg="${seg.id}"]`);
    if (!card) return;

    const vStatus = velocityStatus(result.velocity, ctx.limits);

    $('.js-head-size', card).textContent = `${result.label} · ${fmt(result.velocity, 1)} m/s`;

    $('.js-flow-alt', card).textContent =
      `${fmt(num(seg.airflowLps, 0) * 3.6, 0)} m³/h · ${fmt(num(seg.airflowLps, 0) / 1000, 3)} m³/s`;

    const roleLabel =
      seg.shape === 'flexible' ? 'flexible duct' : DUCT_ROLES.find((r) => r.id === seg.role).name.toLowerCase();
    // Attribute the cap to whatever actually binds. A bedroom runout (2.5) is
    // tighter than the flexible cap (3.5), so naming AIRAH there would be wrong.
    const capBy =
      seg.shape === 'flexible' && Math.abs(ctx.limits.max - FLEX_MAX_VELOCITY) < 1e-9
        ? 'flexible duct, AIRAH'
        : `${space.short.toLowerCase()}, ${space.nr}`;
    $('.js-limit-hint', card).textContent = ctx.limits.min > 0
      ? `${roleLabel}: ${fmt(ctx.limits.min, 1)}–${fmt(ctx.limits.max, 1)} m/s at design flow (${capBy})`
      : `${roleLabel}: max ${fmt(ctx.limits.max, 1)} m/s — ${capBy}`;

    $$('.js-fit-loss', card).forEach((node) => {
      const fit = result.fittings[Number(node.dataset.i)];
      node.textContent = fit ? `${fmt(fit.total, 1)} Pa` : '';
    });

    const rect = result.shape === 'rectangular';
    const metrics = [
      metric(result.label, 'duct size'),
      metric(fmt(result.velocity, 2), 'velocity m/s', vStatus),
      metric(fmt(result.frictionRate, 2), 'Pa per m'),
      metric(fmt(result.totalLoss, 1), 'segment Pa'),
      metric(fmt(result.velocityPressure, 1), 'vel. press. Pa'),
      metric(fmt(result.straightLoss, 1), 'straight Pa'),
      metric(fmt(result.fittingLoss + result.componentPa, 1), 'fittings Pa'),
      metric(fmt0(result.reynolds), 'Reynolds no.'),
      metric(fmt(result.frictionFactor, 4), 'friction factor'),
      metric(
        rect ? `${fmt0(result.equivalentDiameterMm)} mm` : `${fmt(result.area * 1000, 1)} L/m`,
        rect ? 'equiv. dia.' : 'volume per m'
      ),
      metric(
        rect ? `${fmt(result.aspectRatio, 2)}:1` : `${fmt(result.area, 4)} m²`,
        rect ? 'aspect ratio' : 'free area'
      ),
      // Fittings only: a fixed-Pa component has no equivalent length, and
      // folding one in read a dirty filter as 260 m of extra duct.
      metric(fmt(result.fittingsEquivalentLengthM, 1), 'fittings equiv. m'),
      metric(fmt(result.surfaceArea, 1), 'duct area m²'),
    ];

    $('.js-seg-metrics', card).replaceChildren(...metrics);
  });

  /* -- run flags ---------------------------------------------------- */
  const flags = [];
  for (const { seg, ctx, result } of results) {
    const i = state.segments.indexOf(seg) + 1;
    if (ctx.limits.min > ctx.limits.max) {
      // Contradictory setup: a grease duct through an acoustically tight space,
      // where the transport minimum sits above the space's noise ceiling. No
      // size satisfies both, so name the two settings that are fighting.
      flags.push({
        level: 'bad',
        text: `Seg ${i}: the ${fmt(ctx.limits.min, 1)} m/s grease transport minimum is above the ` +
          `${fmt(ctx.limits.max, 1)} m/s acoustic maximum for ${space.name.toLowerCase()} — no size ` +
          `satisfies both. Route it through a less sensitive space, or attenuate and relax the limit.`,
      });
    } else if (result.velocity > 0 && ctx.limits.min > 0 && result.belowMinVelocity) {
      flags.push({
        level: 'bad',
        text: `Seg ${i}: ${fmt(result.velocity, 1)} m/s is below the ${fmt(ctx.limits.min, 1)} m/s design-flow minimum`,
      });
    } else {
      const status = velocityStatus(result.velocity, ctx.limits);
      if (status === 'bad') {
        flags.push({ level: 'bad', text: `Seg ${i}: ${fmt(result.velocity, 1)} m/s exceeds the ${fmt(ctx.limits.max, 1)} m/s limit` });
      } else if (status === 'warn') {
        flags.push({ level: 'warn', text: `Seg ${i}: ${fmt(result.velocity, 1)} m/s is close to the ${fmt(ctx.limits.max, 1)} m/s limit` });
      }
    }

    // NFPA 96 / IMC 506.3.4: 500 fpm at minimum turndown. The one velocity
    // figure here that is a code requirement rather than guidance — and it
    // applies at the turndown flow of a VSD or DCKV system, not at design flow.
    if (isGrease && num(state.turndownPct, 0) > 0 && result.velocity > 0) {
      const turndownV = result.velocity * (num(state.turndownPct, 0) / 100);
      const floor = num(state.turndownVelocity, DEFAULT_TURNDOWN_VELOCITY);
      if (turndownV < floor) {
        flags.push({
          level: 'bad',
          text: `Seg ${i}: ${fmt(turndownV, 2)} m/s at ${fmt0(num(state.turndownPct, 0))} % turndown — ` +
            `below the ${fmt(floor, 2)} m/s code minimum (NFPA 96 / IMC 506.3.4)`,
        });
      }
    }
    if (result.shape === 'rectangular' && result.aspectRatio > maxAspectFor(state.systemTypeId) + 1e-9) {
      flags.push({ level: 'warn', text: `Seg ${i}: aspect ratio ${fmt(result.aspectRatio, 1)}:1 — costly and hard to fit` });
    }
    if (result.shape === 'flexible' && result.lengthM > 3) {
      flags.push({ level: 'warn', text: `Seg ${i}: ${fmt(result.lengthM, 1)} m of flexible — most specs cap runs at 3 m` });
    }
    // Sizing never leaves the configured size list, so a duty the list cannot
    // serve has to be said out loud rather than met with an invented size.
    if (result.sizeLimited && state.useStandardSizes) {
      flags.push({
        level: 'bad',
        text: `Seg ${i}: no size in your list meets the sizing rule at ${fmt0(num(seg.airflowLps, 0))} l/s — ` +
          `nearest available (${result.label}) shown. Add sizes in Settings.`,
      });
    }
    // Sized to the friction target but could not hold it — an overridden size,
    // a duty past the end of the list, or the velocity floor overriding it.
    if (result.exceedsFrictionTarget) {
      flags.push({
        level: result.velocityFloorOverrode ? 'info' : 'warn',
        text: result.velocityFloorOverrode
          ? `Seg ${i}: ${fmt(result.frictionRate, 2)} Pa/m — the ${fmt(ctx.limits.min, 1)} m/s velocity floor overrides the ${fmt(frictionTarget(), 1)} Pa/m target at this flow, as intended`
          : `Seg ${i}: ${fmt(result.frictionRate, 2)} Pa/m is above the ${fmt(frictionTarget(), 1)} Pa/m target`,
      });
    }
  }

  if (run.pressureClass !== 'A') {
    flags.push({ level: 'info', text: `DW/144 class ${run.pressureClass} construction required` });
  }
  // The reported class reads DW/144's positive-pressure limits. Between the
  // negative class-B cap and the positive one, an extract run may be a class
  // higher — so prompt rather than silently pick a side.
  if (pressureClassDependsOnSign(run.totalPa, run.maxVelocity)) {
    flags.push({
      level: 'warn',
      text: isGrease
        ? `Extract at ${fmt0(run.totalPa)} Pa — past the DW/144 negative limit for class B; check whether class C applies`
        : `${fmt0(run.totalPa)} Pa — an extract run here may need class C (DW/144 negative limit); supply is unaffected`,
    });
  }
  if (flags.length === 0 && run.totalPa > 0) {
    flags.push({ level: 'ok', text: 'All velocities within limits and the sizing rule met' });
  }

  $('#run-flags').replaceChildren(
    ...flags.map((f) => el('span', { class: `flag ${f.level}`, text: f.text }))
  );

  /* -- run metrics --------------------------------------------------- */
  const first = results[0]?.result;
  const worstVelocityStatus = (() => {
    let worst = 'ok';
    for (const { ctx, result } of results) {
      const s = velocityStatus(result.velocity, ctx.limits);
      if (s === 'bad') return 'bad';
      if (s === 'warn') worst = 'warn';
    }
    return worst;
  })();
  // Ceiling runs (friction-sized) care about the FASTEST segment — the one
  // closest to being too noisy. Floor runs (velocity-sized, kitchen grease
  // extract) care about the SLOWEST — the one closest to settling out.
  const headlineVelocity = run.maxVelocity;
  const headlineVelocityLabel = 'max velocity m/s';

  $('#run-grid').replaceChildren(
    metric(`${fmt(run.totalPa, 1)} Pa`, 'total branch pressure drop', 'hero'),
    metric(`${fmt(run.fanDutyPa, 0)} Pa`, `fan duty (+${fmt0(num(state.marginPct, 0))} %)`, 'hero'),
    metric(first ? first.label : '—', 'index duct size'),
    metric(fmt(headlineVelocity, 2), headlineVelocityLabel, worstVelocityStatus),
    metric(fmt(run.ductPa, 1), 'ductwork Pa'),
    metric(fmt(run.plantPa, 0), 'plant Pa'),
    metric(fmt(run.lengthM, 1), 'run length m'),
    metric(fmt(run.surfaceArea, 1), 'duct area m²'),
    metric(run.pressureClass, 'DW/144 class'),
    metric(`${fmt(run.leakageLps, 1)} l/s`, `leakage (${fmt(run.leakagePct, 1)} %)`),
    metric(fmt(air.density, 3), 'air density kg/m³'),
    // The headline shows whichever end of the velocity range the sizing method
    // cares about; this is the other end, so both are on the page.
    metric(
      fmt(run.minVelocity, 2),
      'min velocity m/s'
    )
  );

  /* -- breakdown table ------------------------------------------------ */
  $('#run-table tbody').replaceChildren(
    ...results.map(({ seg, ctx, result }, i) => {
      const vClass = velocityStatus(result.velocity, ctx.limits);
      return el('tr', {}, [
        el('td', { text: String(i + 1) }),
        el('td', { class: 'hi', text: result.label }),
        el('td', { text: fmt0(num(seg.airflowLps, 0)) }),
        el('td', { class: vClass === 'ok' ? '' : vClass, text: fmt(result.velocity, 2) }),
        el('td', { text: fmt(result.frictionRate, 2) }),
        el('td', { text: fmt(result.lengthM, 1) }),
        el('td', { text: fmt(result.fittingLoss + result.componentPa, 1) }),
        el('td', { class: 'hi', text: fmt(result.totalLoss, 1) }),
      ]);
    })
  );

  /* -- sticky summary -------------------------------------------------- */
  $('#sum-size').textContent = first ? first.label.replace(' mm', '') : '—';
  const velNode = $('#sum-vel');
  velNode.textContent = fmt(headlineVelocity, 1);
  velNode.className = `sum-val ${worstVelocityStatus}`;
  $('#sum-vel-key').textContent = 'max m/s';
  $('#sum-rate').textContent = first ? fmt(first.frictionRate, 2) : '—';
  $('#sum-total').textContent = fmt(run.totalPa, 0);

  /* -- settings sheet air readout --------------------------------------- */
  $('#air-hint').textContent =
    `ρ = ${fmt(air.density, 4)} kg/m³ · ν = ${air.kinematic.toExponential(3)} m²/s · ` +
    `barometric ${fmt0(air.pressurePa / 100)} mbar`;

  /* -- design basis readout (sizing method is fixed, shown not edited) -- */
  const band = limitsFor(state.spaceTypeId, state.systemTypeId, 'main', 'circular');
  $('#space-hint').textContent = isGrease
    ? `${space.useCase} · constant friction, target ${fmt(frictionTarget(), 1)} Pa/m · ` +
      `${fmt(band.min, 1)}–${fmt(band.max, 1)} m/s at design flow, floor overrides Pa/m on small flows`
    : `${space.useCase} · ${space.nr} sets the maximum · constant friction, target ${fmt(frictionTarget(), 1)} Pa/m`;

  save();
}

function renderAll() {
  renderSegments();
  update();
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

function summaryText() {
  const { results, run } = compute();
  const space = spaceType(state.spaceTypeId);
  const methodLine =
    systemType(state.systemTypeId).sizingMethod === 'friction'
      ? `constant friction, target ${fmt(frictionTarget(), 1)} Pa/m`
      : `constant friction, target ${fmt(frictionTarget(), 1)} Pa/m, held to ${fmt(minVelocityFor(state.systemTypeId), 1)}–${fmt(systemMaxVelocityFor(state.systemTypeId), 1)} m/s`;
  const lines = [
    `DUCT — ${state.project || 'Untitled'}`,
    `${space.name} (${space.nr}) · ${systemType(state.systemTypeId).name} · ${methodLine}`,
    '',
  ];

  results.forEach(({ seg, result }, i) => {
    lines.push(
      `Segment ${i + 1}: ${num(seg.airflowLps, 0)} l/s, ${result.shape}`,
      `  Size ${result.label} · ${fmt(result.velocity, 2)} m/s · ${fmt(result.frictionRate, 2)} Pa/m`,
      `  Length ${fmt(result.lengthM, 1)} m = ${fmt(result.straightLoss, 1)} Pa` +
        ` · fittings ${fmt(result.fittingLoss + result.componentPa, 1)} Pa` +
        ` · total ${fmt(result.totalLoss, 1)} Pa`
    );
    for (const fit of result.fittings) {
      lines.push(`    ${fit.qty} × ${fit.name} = ${fmt(fit.total, 1)} Pa`);
    }
  });

  lines.push(
    '',
    `Ductwork          ${fmt(run.ductPa, 1)} Pa`,
    `Plant allowance   ${fmt(run.plantPa, 1)} Pa`,
    `TOTAL BRANCH      ${fmt(run.totalPa, 1)} Pa`,
    `Fan duty (+${fmt0(num(state.marginPct, 0))} %)  ${fmt(run.fanDutyPa, 0)} Pa`,
    `Velocity          max ${fmt(run.maxVelocity, 2)} m/s · min ${fmt(run.minVelocity, 2)} m/s`,
    `DW/144 class      ${run.pressureClass} · leakage ${fmt(run.leakageLps, 1)} l/s (${fmt(run.leakagePct, 1)} %)`
  );

  return lines.join('\n');
}

function csvText() {
  const { results, run } = compute();
  const rows = [
    ['Segment', 'Airflow l/s', 'Shape', 'Size', 'Velocity m/s', 'Pa/m', 'Length m',
     'Straight Pa', 'Fittings Pa', 'Total Pa', 'Reynolds (duct)',
     'Reynolds (equiv. round)', 'Friction factor', 'Equiv dia mm', 'Aspect',
     'Duct area m2', 'Fittings equiv. length m', 'Sizing rule met'],
  ];

  results.forEach(({ seg, result }, i) => {
    rows.push([
      i + 1,
      num(seg.airflowLps, 0),
      result.shape,
      result.label,
      result.velocity.toFixed(3),
      result.frictionRate.toFixed(3),
      result.lengthM,
      result.straightLoss.toFixed(2),
      (result.fittingLoss + result.componentPa).toFixed(2),
      result.totalLoss.toFixed(2),
      Math.round(result.reynolds),
      Math.round(result.reynoldsEquivalent),
      result.frictionFactor.toFixed(5),
      Math.round(result.equivalentDiameterMm),
      result.aspectRatio.toFixed(2),
      result.surfaceArea.toFixed(2),
      result.fittingsEquivalentLengthM.toFixed(2),
      result.ruleMet ? 'yes' : 'NO',
    ]);
  });

  rows.push([], ['Ductwork Pa', run.ductPa.toFixed(2)]);
  rows.push(['Plant Pa', run.plantPa.toFixed(2)]);
  rows.push(['Total branch Pa', run.totalPa.toFixed(2)]);
  rows.push(['Fan duty Pa', run.fanDutyPa.toFixed(2)]);
  rows.push(['Max velocity m/s', run.maxVelocity.toFixed(2)]);
  rows.push(['Min velocity m/s', run.minVelocity.toFixed(2)]);
  rows.push(['DW/144 class', run.pressureClass]);
  rows.push(['Leakage l/s (duct pressure basis, excl. plant)', run.leakageLps.toFixed(2)]);
  rows.push(['Sizing rule met on every segment', run.rulesMet ? 'yes' : 'NO']);

  return rows
    .map((row) => row.map((cell) => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\n');
}

async function copySummary() {
  const text = summaryText();
  try {
    await navigator.clipboard.writeText(text);
    toast('Summary copied');
  } catch {
    // Clipboard API needs a secure context; fall back to a selectable textarea.
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand?.('copy');
    ta.remove();
    toast(ok ? 'Summary copied' : 'Copy not available');
  }
}

function downloadCsv() {
  const blob = new Blob([csvText()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const name = (state.project || 'duct-sizing').replace(/[^\w-]+/g, '-').toLowerCase();
  const a = el('a', { href: url, download: `${name}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('CSV exported');
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

function bindInput(selector, key, parse = num) {
  const node = $(selector);
  node.addEventListener('input', () => {
    state[key] = parse(node.value);
    update();
  });
}

function init() {
  buildDesignBasis();

  $('#project').addEventListener('input', (e) => {
    state.project = e.target.value;
    save();
  });

  bindInput('#plant-pa', 'plantPa');
  bindInput('#margin-pct', 'marginPct');
  bindInput('#temp-c', 'tempC');
  bindInput('#altitude', 'altitudeM');
  bindInput('#max-aspect', 'maxAspect');
  bindInput('#max-height', 'maxHeightMm');

  $('#leakage-class').addEventListener('change', (e) => {
    state.leakageClass = e.target.value;
    update();
  });

  $('#standard-sizes').addEventListener('change', (e) => {
    state.useStandardSizes = e.target.checked;
    update();
  });

  for (const key of SIZE_KEYS) bindSizeAdd(key);
  for (const btn of $$('[data-reset-sizes]')) {
    btn.addEventListener('click', () => resetSizeList(btn.dataset.resetSizes));
  }

  $('#settings-target-friction').addEventListener('input', (e) => {
    state.frictionTarget = num(e.target.value, frictionTarget());
    update();
  });

  $('#settings-grease-min').addEventListener('input', (e) => {
    state.greaseMinVelocity = num(e.target.value, DEFAULT_GREASE_MIN_VELOCITY);
    update();
  });

  $('#settings-grease-max').addEventListener('input', (e) => {
    state.greaseMaxVelocity = num(e.target.value, DEFAULT_GREASE_MAX_VELOCITY);
    update();
  });

  $('#settings-turndown-pct').addEventListener('input', (e) => {
    state.turndownPct = Math.max(num(e.target.value, 0), 0);
    update();
  });

  $('#settings-turndown-velocity').addEventListener('input', (e) => {
    state.turndownVelocity = num(e.target.value, DEFAULT_TURNDOWN_VELOCITY);
    update();
  });

  $('#settings-reset-targets').addEventListener('click', () => {
    state.frictionTarget = DEFAULT_FRICTION_TARGET;
    state.maxVelocities = JSON.parse(JSON.stringify(DEFAULT_MAX_VELOCITY));
    state.greaseMinVelocity = DEFAULT_GREASE_MIN_VELOCITY;
    state.greaseMaxVelocity = DEFAULT_GREASE_MAX_VELOCITY;
    state.turndownVelocity = DEFAULT_TURNDOWN_VELOCITY;
    renderSettingsTargets();
    update();
    toast('Reset to default targets');
  });

  $('#btn-add-segment').addEventListener('click', () => {
    const last = state.segments[state.segments.length - 1];
    // A new segment usually continues the run, so inherit the setup and
    // start from a downstream-looking duty.
    state.segments.push(
      newSegment({
        airflowLps: Math.max(Math.round(num(last.airflowLps, 250) / 2 / 5) * 5, 5),
        role: last.role === 'main' ? 'branch' : 'runout',
        shape: last.shape,
        materialId: last.materialId,
        flexCondition: last.flexCondition,
        lengthM: 5,
      })
    );
    renderAll();
    $('#segments').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('#btn-copy').addEventListener('click', copySummary);
  $('#btn-share').addEventListener('click', copySummary);
  $('#btn-csv').addEventListener('click', downloadCsv);

  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Clear all inputs and start again?')) return;
    segmentSeq = 0;
    state = defaultState();
    buildDesignBasis();
    renderAll();
    toast('Reset');
  });

  $('#btn-settings').addEventListener('click', () => {
    settingsSpaceId = state.spaceTypeId;
    renderSettingsTargets();
    openSheet($('#settings-sheet'));
  });

  $('#btn-saved').addEventListener('click', openSavedSheet);

  const commitSave = () => {
    const result = saveCalculation($('#save-name').value);
    $('#save-error').textContent = result.error ?? '';
    if (!result.ok) return;
    renderLibrary();
    toast(result.replaced ? 'Calculation replaced' : 'Calculation saved');
  };
  $('#btn-save-calc').addEventListener('click', commitSave);
  $('#save-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitSave();
    }
  });
  $('#save-name').addEventListener('input', () => {
    $('#save-error').textContent = '';
  });

  for (const sheet of $$('dialog.sheet')) {
    sheet.addEventListener('close', releaseScrollLock);
    $('[data-close]', sheet)?.addEventListener('click', () => sheet.close());
    // Tapping the backdrop closes the sheet
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) sheet.close();
    });
  }

  $('#summary-btn').addEventListener('click', () => {
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#about-text').textContent =
    'Straight-duct friction is calculated with the Darcy–Weisbach equation using a ' +
    'Colebrook–White friction factor iterated to convergence, on air properties derived ' +
    'from the entered temperature and altitude. Rectangular ducts are sized on the ASHRAE ' +
    'circular equivalent diameter (equal friction, equal flow). Residential and Commercial ' +
    'size to a constant friction rate; Kitchen Extract sizes to a minimum transport ' +
    'velocity instead, so standard duct sizes snap down rather than up — rounding up would ' +
    'drop the actual velocity below the minimum needed to keep grease entrained. Fitting ' +
    'losses use the velocity-pressure method with the ζ values ' +
    'shown, which you can overwrite with manufacturers’ data. Leakage follows the DW/144 ' +
    'class factors, applied to the mean pressure inside the ductwork — the plant ' +
    'allowance is excluded, because it is not duct static pressure. Sizes never leave ' +
    'your configured size list: a duty the list cannot serve is flagged rather than met ' +
    'with an unlisted size. There is deliberately no noise calculation — velocity limits ' +
    'are the noise control here, as CIBSE Guide B3 and ASHRAE present them. A dBA figure ' +
    'needs manufacturers’ octave-band data for the terminals, which this app does not have.';

  renderAll();

  registerServiceWorker();
}

/**
 * Register the offline cache, and make sure a released update actually reaches
 * a device that already has the app installed.
 *
 * Three things are needed for that, and missing any one of them leaves someone
 * looking at old code with no clue why:
 *   - `updateViaCache: 'none'` — otherwise the browser serves sw.js itself from
 *     its HTTP cache, so a new worker isn't even noticed for hours.
 *   - an explicit `update()` on load — installed PWAs can run for days without
 *     a navigation that would trigger the check on its own.
 *   - a one-shot reload when the new worker takes control — the page is already
 *     running the old JS it booted with, and `skipWaiting()` alone doesn't
 *     replace that. The `reloading` guard is what stops this looping.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;

  // On a first-ever visit there is no controller yet, and the worker's
  // `clients.claim()` fires controllerchange too — reloading for that would be
  // a pointless refresh on someone's first load. Only an update replacing an
  // *existing* controller should trigger one.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  navigator.serviceWorker
    .register('sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update().catch(() => {}))
    .catch(() => {});
}

init();
