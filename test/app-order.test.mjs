import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* app.js restores saved state at module load (`let state = load() ...`). Any
   top-level `const` that load() reaches but that is declared BELOW that line
   is in its temporal dead zone when load() runs, throws, and — because load()
   treats failure as "nothing saved" — silently resets the user's work to
   defaults. That shipped once: LEGACY_SPACE was moved below the line and every
   stored calculation came back as a fresh open-plan default. None of the
   engine tests could see it, because none of them load app.js. */

const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const lines = src.split('\n');
const stateLine = lines.findIndex((l) => /^let state = load\(\)/.test(l));

test('app.js restores state at module load', () => {
  assert.ok(stateLine > 0, 'expected a top-level `let state = load()` line');
});

/** Body text of a top-level function declaration. */
function body(name) {
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

test('nothing load() depends on is declared after the state line', () => {
  // Every function on the restore path, transitively.
  const path = ['load', 'normaliseState', 'sanitiseSegment', 'newSegment', 'defaultState',
    'advanceSegmentSeq', 'enforceShapeRules', 'setSegmentShape'];
  const reached = path.map(body).join('\n');
  const late = [];
  lines.forEach((l, i) => {
    const m = /^(?:const|let) ([A-Z_][A-Z0-9_]*|[a-z][A-Za-z0-9]*) =/.exec(l);
    if (!m || i <= stateLine) return;
    if (new RegExp(`\\b${m[1]}\\b`).test(reached)) late.push(`${m[1]} (line ${i + 1})`);
  });
  assert.deepEqual(late, [], `declared below line ${stateLine + 1} but used while restoring: ${late.join(', ')}`);
});
