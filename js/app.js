/**
 * DUCT — UI layer.
 *
 * Segment cards are built once per structural change (add/remove segment,
 * shape change); every keystroke only rewrites output nodes, so focus and
 * caret position survive a recalculation.
 */

import { airProperties, calcSegment, calcRun } from './engine.js';
import {
  SPACE_TYPES,
  DUCT_ROLES,
  SHAPES,
  NOISE_CRITERIA,
  DEFAULT_MATERIAL,
  FLEX_CONDITIONS,
  FITTINGS,
  fittingGroups,
  materialsFor,
  material,
  spaceType,
  ROUND_SIZES,
  RECT_SIZES,
  FLEX_SIZES,
} from './data.js';

/** Standard duct sizes are user-editable; these are the shipped starting points. */
const DEFAULT_SIZE_LISTS = { round: ROUND_SIZES, rect: RECT_SIZES, flex: FLEX_SIZES };

/** Duct roles a velocity target/limit applies to: the three positions plus a
 * dedicated entry for flexible duct, used regardless of the segment's role. */
const VEL_ROLE_ORDER = ['main', 'branch', 'runout', 'flex'];
const VEL_ROLE_LABELS = { main: 'Main', branch: 'Branch', runout: 'Runout', flex: 'Flexible' };

/** Sizing targets are per-space-type and user-editable (fine-tuned in Settings);
 * these are the shipped starting points, cloned from data.js's reference values. */
const DEFAULT_VELOCITY_LIMITS = Object.fromEntries(
  SPACE_TYPES.map((space) => [
    space.id,
    Object.fromEntries(VEL_ROLE_ORDER.map((role) => [role, { ...space.roles[role] }])),
  ])
);

const DEFAULT_FRICTION_TARGETS = Object.fromEntries(
  SPACE_TYPES.filter((s) => s.sizingMethod === 'friction').map((s) => [s.id, s.targetFriction])
);

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

function defaultState() {
  return {
    project: '',
    spaceTypeId: 'commercial',
    useStandardSizes: true,
    tempC: 20,
    altitudeM: 0,
    maxAspect: 4,
    maxHeightMm: 0,
    plantPa: 0,
    marginPct: 10,
    leakageClass: 'A',
    roomCorrection: 9,
    sizeLists: {
      round: [...DEFAULT_SIZE_LISTS.round],
      rect: [...DEFAULT_SIZE_LISTS.rect],
      flex: [...DEFAULT_SIZE_LISTS.flex],
    },
    // Sizing method is fixed per space type (see data.js) — not stored here.
    frictionTargets: { ...DEFAULT_FRICTION_TARGETS },
    velocityLimits: JSON.parse(JSON.stringify(DEFAULT_VELOCITY_LIMITS)),
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

/** Friction target for a space that sizes on constant friction; falls back to
 * the shipped default if the field has been emptied or broken. */
function frictionTargetFor(spaceId) {
  const v = state.frictionTargets?.[spaceId];
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_FRICTION_TARGETS[spaceId] ?? 1;
}

/** Velocity limits for a space type + duct role ('flex' for flexible duct,
 * regardless of the segment's selected role) — falls back to the shipped
 * default if a field has been emptied or broken. */
function velocityLimitsFor(spaceId, roleKey) {
  const rec = state.velocityLimits?.[spaceId]?.[roleKey];
  const def = DEFAULT_VELOCITY_LIMITS[spaceId]?.[roleKey] ?? DEFAULT_VELOCITY_LIMITS.commercial.branch;
  return {
    recommended: Number.isFinite(rec?.recommended) && rec.recommended > 0 ? rec.recommended : def.recommended,
    max: Number.isFinite(rec?.max) && rec.max > 0 ? rec.max : def.max,
  };
}

let state = load() ?? defaultState();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.segments) || parsed.segments.length === 0) return null;
    // Keep the id sequence ahead of anything restored
    for (const seg of parsed.segments) {
      const n = parseInt(String(seg.id).replace(/\D/g, ''), 10);
      if (Number.isFinite(n)) segmentSeq = Math.max(segmentSeq, n);
    }
    const defaults = defaultState();
    const merged = { ...defaults, ...parsed };
    // Older saves predate the custom size lists, or may only have some shapes set.
    merged.sizeLists = { ...defaults.sizeLists, ...(parsed.sizeLists ?? {}) };
    // Older saves predate per-space sizing targets entirely.
    merged.frictionTargets = { ...defaults.frictionTargets, ...(parsed.frictionTargets ?? {}) };
    merged.velocityLimits = {};
    for (const spaceId of Object.keys(defaults.velocityLimits)) {
      merged.velocityLimits[spaceId] = {
        ...defaults.velocityLimits[spaceId],
        ...(parsed.velocityLimits?.[spaceId] ?? {}),
      };
    }
    // Sizing method and its single global target used to be flat, user-set
    // fields; both are now fixed per space type and live in the maps above.
    delete merged.method;
    delete merged.targetFriction;
    delete merged.targetVelocity;
    return merged;
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
 * Calculation
 * ------------------------------------------------------------------ */

function context(segment) {
  const air = airProperties(num(state.tempC, 20), num(state.altitudeM, 0));
  const mat = material(segment.materialId);
  const flex =
    FLEX_CONDITIONS.find((c) => c.id === segment.flexCondition) ?? FLEX_CONDITIONS[0];
  const space = spaceType(state.spaceTypeId);
  const roleKey = segment.shape === 'flexible' ? 'flex' : segment.role;
  const limits = velocityLimitsFor(state.spaceTypeId, roleKey);

  return {
    air,
    roughness: mat.roughnessMm / 1000,
    flexFactor: flex.factor,
    // Fixed per space type — see data.js. 'velocity' sizes to `limits.recommended`
    // as a MINIMUM (engine.js snaps standard sizes down, not up, to hold it).
    method: space.sizingMethod,
    targetFriction: frictionTargetFor(state.spaceTypeId),
    targetVelocity: limits.recommended,
    maxVelocity: limits.max,
    roundSizes: sizesForShape(segment.shape),
    rectSizes: sizeListFor('rect'),
    useStandardSizes: state.useStandardSizes,
    preferredAspect: 1.5,
    maxAspect: num(state.maxAspect, 4),
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
      roomCorrection: num(state.roomCorrection, 9),
      leakageClass: state.leakageClass,
    }
  );

  return { results, run, air: airProperties(num(state.tempC, 20), num(state.altitudeM, 0)) };
}

/**
 * Velocity status against the space/role limits.
 *
 * Ceiling spaces (friction-sized) flag going OVER the recommended/max.
 * Floor spaces (velocity-sized — grease/dust extract) flag going UNDER the
 * minimum just as seriously as over the max, since that's the failure mode
 * that lets material settle out and foul the duct.
 */
function velocityStatus(velocity, limits, isFloor) {
  if (!(velocity > 0)) return 'info';
  if (velocity > limits.max) return 'bad';
  if (isFloor) return velocity < limits.recommended ? 'bad' : 'ok';
  return velocity > limits.recommended ? 'warn' : 'ok';
}

function noiseStatus(dba, limitDba) {
  if (!(dba > 0)) return 'info';
  if (dba > limitDba + 5) return 'bad';
  if (dba > limitDba) return 'warn';
  return 'ok';
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
  buildSegmentedControl($('#space-group'), 'space', SPACE_TYPES, state.spaceTypeId, (id) => {
    state.spaceTypeId = id;
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
  $('#room-correction').value = state.roomCorrection;

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
  const isFloor = space.sizingMethod === 'velocity';

  buildSegmentedControl($('#settings-space-group'), 'settings-space', SPACE_TYPES, settingsSpaceId, (id) => {
    settingsSpaceId = id;
    renderSettingsTargets();
  });

  $('#settings-method-hint').textContent = isFloor
    ? `${space.name} (${space.useCase}) sizes to a minimum transport velocity — locked; choose the space type on the main page.`
    : `${space.name} (${space.useCase}) sizes to a constant friction rate — locked; choose the space type on the main page.`;

  $('#settings-friction-field').hidden = isFloor;
  if (!isFloor) $('#settings-target-friction').value = frictionTargetFor(settingsSpaceId);

  $('#settings-velocity-matrix').replaceChildren(
    el('div', { class: 'vel-matrix-head' }, [
      el('span'),
      el('span', { text: isFloor ? 'Min m/s' : 'Target m/s' }),
      el('span', { text: 'Max m/s' }),
    ]),
    ...VEL_ROLE_ORDER.map((roleKey) => {
      const limits = velocityLimitsFor(settingsSpaceId, roleKey);
      return el('div', { class: 'vel-row' }, [
        el('span', { class: 'vel-role', text: VEL_ROLE_LABELS[roleKey] }),
        el('input', {
          type: 'number',
          inputmode: 'decimal',
          step: '0.5',
          min: '0',
          value: limits.recommended,
          'aria-label': `${space.name} ${VEL_ROLE_LABELS[roleKey]} ${isFloor ? 'minimum' : 'target'} velocity`,
          oninput: (e) => {
            state.velocityLimits[settingsSpaceId][roleKey].recommended = num(e.target.value, limits.recommended);
            update();
          },
        }),
        el('input', {
          type: 'number',
          inputmode: 'decimal',
          step: '0.5',
          min: '0',
          value: limits.max,
          'aria-label': `${space.name} ${VEL_ROLE_LABELS[roleKey]} maximum velocity`,
          oninput: (e) => {
            state.velocityLimits[settingsSpaceId][roleKey].max = num(e.target.value, limits.max);
            update();
          },
        }),
      ]);
    })
  );
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
  const shapeGroup = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Duct type' });
  buildSegmentedControl(shapeGroup, `shape-${seg.id}`, SHAPES, seg.shape, (id) => {
    seg.shape = id;
    // Material and fitting lists differ by shape, so reset to a valid default.
    seg.materialId = DEFAULT_MATERIAL[id];
    seg.fittings = seg.fittings.filter((f) => {
      const def = FITTINGS.find((x) => x.id === f.id);
      return def ? def.shapes.includes(id) : true;
    });
    if (id !== 'rectangular') seg.widthMm = '';
    renderAll();
  });

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

  body.append(
    el('div', { class: 'field' }, [el('label', { class: 'label', text: 'Duct type' }), shapeGroup]),
    roleField
  );

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
  const isFloor = space.sizingMethod === 'velocity';

  /* -- per-segment -------------------------------------------------- */
  results.forEach(({ seg, ctx, result }, i) => {
    const card = $(`[data-seg="${seg.id}"]`);
    if (!card) return;

    const vStatus = velocityStatus(result.velocity, ctx.limits, isFloor);

    $('.js-head-size', card).textContent = `${result.label} · ${fmt(result.velocity, 1)} m/s`;

    $('.js-flow-alt', card).textContent =
      `${fmt(num(seg.airflowLps, 0) * 3.6, 0)} m³/h · ${fmt(num(seg.airflowLps, 0) / 1000, 3)} m³/s`;

    const roleLabel =
      seg.shape === 'flexible' ? 'flexible duct' : DUCT_ROLES.find((r) => r.id === seg.role).name.toLowerCase();
    $('.js-limit-hint', card).textContent = isFloor
      ? `${space.name} ${roleLabel}: minimum ${fmt(ctx.limits.recommended, 1)} m/s, max ${fmt(ctx.limits.max, 1)} m/s`
      : `${space.name} ${roleLabel}: recommended ≤ ${fmt(ctx.limits.recommended, 1)} m/s, max ${fmt(ctx.limits.max, 1)} m/s`;

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
      metric(fmt(result.noiseLwA, 0), 'noise dBA', noiseStatus(result.noiseLwA, space.noiseLimitDba)),
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
      metric(fmt(result.equivalentLengthM, 1), 'equiv. length m'),
      metric(fmt(result.surfaceArea, 1), 'duct area m²'),
    ];

    $('.js-seg-metrics', card).replaceChildren(...metrics);
  });

  /* -- run flags ---------------------------------------------------- */
  const flags = [];
  for (const { seg, ctx, result } of results) {
    const i = state.segments.indexOf(seg) + 1;
    if (isFloor) {
      if (result.velocity > ctx.limits.max) {
        flags.push({ level: 'bad', text: `Seg ${i}: ${fmt(result.velocity, 1)} m/s exceeds the ${fmt(ctx.limits.max, 1)} m/s maximum (erosion/noise)` });
      } else if (result.velocity > 0 && result.velocity < ctx.limits.recommended) {
        flags.push({ level: 'bad', text: `Seg ${i}: ${fmt(result.velocity, 1)} m/s is below the ${fmt(ctx.limits.recommended, 1)} m/s minimum — risk of settling/buildup` });
      }
    } else {
      const status = velocityStatus(result.velocity, ctx.limits, false);
      if (status === 'bad') {
        flags.push({ level: 'bad', text: `Seg ${i}: ${fmt(result.velocity, 1)} m/s exceeds the ${fmt(ctx.limits.max, 1)} m/s limit` });
      } else if (status === 'warn') {
        flags.push({ level: 'warn', text: `Seg ${i}: ${fmt(result.velocity, 1)} m/s above the ${fmt(ctx.limits.recommended, 1)} m/s target` });
      }
    }
    if (result.shape === 'rectangular' && result.aspectRatio > num(state.maxAspect, 4)) {
      flags.push({ level: 'warn', text: `Seg ${i}: aspect ratio ${fmt(result.aspectRatio, 1)}:1 — costly and hard to fit` });
    }
    if (result.shape === 'flexible' && result.lengthM > 3) {
      flags.push({ level: 'warn', text: `Seg ${i}: ${fmt(result.lengthM, 1)} m of flexible — most specs cap runs at 3 m` });
    }
    if (result.shape === 'flexible' && state.spaceTypeId === 'industrial') {
      flags.push({ level: 'bad', text: `Seg ${i}: flexible duct is not normally permitted for kitchen/dust extract — check local fire code (e.g. NFPA 96/DW172) before specifying` });
    }
  }

  const noise = noiseStatus(run.roomSpl, space.noiseLimitDba);
  if (noise === 'bad') {
    flags.push({ level: 'bad', text: `Est. ${fmt(run.roomSpl, 0)} dBA in room exceeds ${space.noiseCriterion} (${space.noiseLimitDba} dBA)` });
  } else if (noise === 'warn') {
    flags.push({ level: 'warn', text: `Est. ${fmt(run.roomSpl, 0)} dBA is at the ${space.noiseCriterion} limit` });
  }

  if (run.pressureClass !== 'A') {
    flags.push({ level: 'info', text: `DW/144 class ${run.pressureClass} construction required` });
  }
  if (flags.length === 0 && run.totalPa > 0) {
    flags.push({ level: 'ok', text: 'All velocities and noise levels within limits' });
  }

  $('#run-flags').replaceChildren(
    ...flags.map((f) => el('span', { class: `flag ${f.level}`, text: f.text }))
  );

  /* -- run metrics --------------------------------------------------- */
  const first = results[0]?.result;
  const worstVelocityStatus = (() => {
    let worst = 'ok';
    for (const { ctx, result } of results) {
      const s = velocityStatus(result.velocity, ctx.limits, isFloor);
      if (s === 'bad') return 'bad';
      if (s === 'warn') worst = 'warn';
    }
    return worst;
  })();
  // Ceiling runs (friction-sized) care about the FASTEST segment — the one
  // closest to being too noisy. Floor runs (velocity-sized, grease/dust
  // extract) care about the SLOWEST — the one closest to settling out.
  const headlineVelocity = isFloor ? run.minVelocity : run.maxVelocity;
  const headlineVelocityLabel = isFloor ? 'min velocity m/s' : 'max velocity m/s';

  $('#run-grid').replaceChildren(
    metric(`${fmt(run.totalPa, 1)} Pa`, 'total branch pressure drop', 'hero'),
    metric(`${fmt(run.fanDutyPa, 0)} Pa`, `fan duty (+${fmt0(num(state.marginPct, 0))} %)`, 'hero'),
    metric(first ? first.label : '—', 'index duct size'),
    metric(fmt(headlineVelocity, 2), headlineVelocityLabel, worstVelocityStatus),
    metric(fmt(run.noiseLwA, 0), 'noise LᴡA dBA', noiseStatus(run.noiseLwA, space.noiseLimitDba + 9)),
    metric(fmt(run.roomSpl, 0), 'est. room dBA', noise),
    metric(fmt(run.ductPa, 1), 'ductwork Pa'),
    metric(fmt(run.plantPa, 0), 'plant Pa'),
    metric(fmt(run.lengthM, 1), 'run length m'),
    metric(fmt(run.surfaceArea, 1), 'duct area m²'),
    metric(run.pressureClass, 'DW/144 class'),
    metric(`${fmt(run.leakageLps, 1)} l/s`, `leakage (${fmt(run.leakagePct, 1)} %)`),
    metric(fmt(air.density, 3), 'air density kg/m³'),
    metric(space.noiseCriterion, 'noise criterion')
  );

  /* -- breakdown table ------------------------------------------------ */
  $('#run-table tbody').replaceChildren(
    ...results.map(({ seg, ctx, result }, i) => {
      const vClass = velocityStatus(result.velocity, ctx.limits, isFloor);
      return el('tr', {}, [
        el('td', { text: String(i + 1) }),
        el('td', { class: 'hi', text: result.label }),
        el('td', { text: fmt0(num(seg.airflowLps, 0)) }),
        el('td', { class: vClass === 'ok' ? '' : vClass, text: fmt(result.velocity, 2) }),
        el('td', { text: fmt(result.frictionRate, 2) }),
        el('td', { text: fmt(result.lengthM, 1) }),
        el('td', { text: fmt(result.fittingLoss + result.componentPa, 1) }),
        el('td', { class: 'hi', text: fmt(result.totalLoss, 1) }),
        el('td', { text: fmt(result.noiseLwA, 0) }),
      ]);
    })
  );

  /* -- sticky summary -------------------------------------------------- */
  $('#sum-size').textContent = first ? first.label.replace(' mm', '') : '—';
  const velNode = $('#sum-vel');
  velNode.textContent = fmt(headlineVelocity, 1);
  velNode.className = `sum-val ${worstVelocityStatus}`;
  $('#sum-vel-key').textContent = isFloor ? 'min m/s' : 'max m/s';
  $('#sum-rate').textContent = first ? fmt(first.frictionRate, 2) : '—';
  $('#sum-total').textContent = fmt(run.totalPa, 0);
  const noiseNode = $('#sum-noise');
  noiseNode.textContent = fmt(run.roomSpl, 0);
  noiseNode.className = `sum-val ${noise}`;

  /* -- settings sheet air readout --------------------------------------- */
  $('#air-hint').textContent =
    `ρ = ${fmt(air.density, 4)} kg/m³ · ν = ${air.kinematic.toExponential(3)} m²/s · ` +
    `barometric ${fmt0(air.pressurePa / 100)} mbar`;

  /* -- design basis readout (sizing method is fixed, shown not edited) -- */
  $('#space-hint').textContent = isFloor
    ? `${space.useCase} · constant velocity, sized to a minimum transport velocity per duct role · ${space.noiseCriterion} (${space.noiseLimitDba} dBA)`
    : `${space.useCase} · constant friction, target ${fmt(frictionTargetFor(state.spaceTypeId), 1)} Pa/m · ${space.noiseCriterion} (${space.noiseLimitDba} dBA)`;

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
    space.sizingMethod === 'friction'
      ? `constant friction, target ${fmt(frictionTargetFor(state.spaceTypeId), 1)} Pa/m`
      : 'constant velocity, minimum transport velocity per duct role';
  const lines = [
    `DUCT — ${state.project || 'Untitled'}`,
    `${space.name} (${space.useCase}) · ${methodLine}`,
    '',
  ];

  results.forEach(({ seg, result }, i) => {
    lines.push(
      `Segment ${i + 1}: ${num(seg.airflowLps, 0)} l/s, ${result.shape}`,
      `  Size ${result.label} · ${fmt(result.velocity, 2)} m/s · ${fmt(result.frictionRate, 2)} Pa/m`,
      `  Length ${fmt(result.lengthM, 1)} m = ${fmt(result.straightLoss, 1)} Pa` +
        ` · fittings ${fmt(result.fittingLoss + result.componentPa, 1)} Pa` +
        ` · total ${fmt(result.totalLoss, 1)} Pa`,
      `  Regenerated noise ${fmt(result.noiseLwA, 0)} dBA`
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
    `Noise LwA         ${fmt(run.noiseLwA, 0)} dBA (est. ${fmt(run.roomSpl, 0)} dBA in room)`,
    `DW/144 class      ${run.pressureClass} · leakage ${fmt(run.leakageLps, 1)} l/s (${fmt(run.leakagePct, 1)} %)`
  );

  return lines.join('\n');
}

function csvText() {
  const { results, run } = compute();
  const rows = [
    ['Segment', 'Airflow l/s', 'Shape', 'Size', 'Velocity m/s', 'Pa/m', 'Length m',
     'Straight Pa', 'Fittings Pa', 'Total Pa', 'Noise dBA', 'Reynolds', 'Friction factor',
     'Equiv dia mm', 'Aspect', 'Duct area m2'],
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
      result.noiseLwA.toFixed(1),
      Math.round(result.reynolds),
      result.frictionFactor.toFixed(5),
      Math.round(result.equivalentDiameterMm),
      result.aspectRatio.toFixed(2),
      result.surfaceArea.toFixed(2),
    ]);
  });

  rows.push([], ['Ductwork Pa', run.ductPa.toFixed(2)]);
  rows.push(['Plant Pa', run.plantPa.toFixed(2)]);
  rows.push(['Total branch Pa', run.totalPa.toFixed(2)]);
  rows.push(['Fan duty Pa', run.fanDutyPa.toFixed(2)]);
  rows.push(['Max velocity m/s', run.maxVelocity.toFixed(2)]);
  rows.push(['Min velocity m/s', run.minVelocity.toFixed(2)]);
  rows.push(['Noise LwA dBA', run.noiseLwA.toFixed(1)]);
  rows.push(['Est room dBA', run.roomSpl.toFixed(1)]);
  rows.push(['DW/144 class', run.pressureClass]);
  rows.push(['Leakage l/s', run.leakageLps.toFixed(2)]);

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
  bindInput('#room-correction', 'roomCorrection');

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
    state.frictionTargets[settingsSpaceId] = num(e.target.value, frictionTargetFor(settingsSpaceId));
    update();
  });

  $('#settings-reset-targets').addEventListener('click', () => {
    state.frictionTargets[settingsSpaceId] = DEFAULT_FRICTION_TARGETS[settingsSpaceId];
    state.velocityLimits[settingsSpaceId] = JSON.parse(JSON.stringify(DEFAULT_VELOCITY_LIMITS[settingsSpaceId]));
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

  $('#criteria-table tbody').replaceChildren(
    ...NOISE_CRITERIA.map((c) =>
      el('tr', {}, [
        el('td', { text: c.name }),
        el('td', { text: c.nr }),
        el('td', { text: String(c.dba) }),
      ])
    )
  );

  $('#about-text').textContent =
    'Straight-duct friction is calculated with the Darcy–Weisbach equation using a ' +
    'Colebrook–White friction factor iterated to convergence, on air properties derived ' +
    'from the entered temperature and altitude. Rectangular ducts are sized on the ASHRAE ' +
    'circular equivalent diameter (equal friction, equal flow). Residential and Commercial ' +
    'size to a constant friction rate; Industrial sizes to a minimum transport velocity ' +
    'instead (kitchen/dust extract), so standard duct sizes snap down rather than up — ' +
    'rounding up would drop the actual velocity below the minimum needed to keep grease or ' +
    'dust entrained. Fitting losses use the velocity-pressure method with the ζ values ' +
    'shown, which you can overwrite with manufacturers’ data. Leakage follows the DW/144 ' +
    'class factors. Regenerated noise is an indicative A-weighted estimate for comparing ' +
    'selections, not a substitute for an octave-band acoustic calculation.';

  renderAll();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
