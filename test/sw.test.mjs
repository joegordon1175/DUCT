import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

/** Files the service worker pre-caches and serves — a change to any of these
 *  is a release, and a release needs a new CACHE_VERSION to reach devices. */
const SHIPPED = ['index.html', 'css/app.css', 'js/app.js', 'js/engine.js', 'js/data.js', 'sw.js', 'manifest.webmanifest'];

test('service worker declares a cache version', () => {
  assert.match(sw, /CACHE_VERSION = '[^']+'/, 'CACHE_VERSION must be present and non-empty');
});

test('every shipped asset is listed in the pre-cache manifest', () => {
  // A file the worker never caches is a file that cannot work offline.
  for (const f of SHIPPED.filter((f) => f !== 'sw.js')) {
    assert.ok(sw.includes(`'${f}'`), `${f} is missing from the service worker ASSETS list`);
  }
});

test('CACHE_VERSION was bumped alongside any shipped-asset change', () => {
  // Guards the one step that is easy to forget and silently ships stale code
  // to installed devices. Compares the working tree against origin/main.
  let base;
  try {
    base = execSync('git rev-parse origin/main', { cwd: new URL('..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return; // no origin/main to compare against (fresh clone / CI shallow) — skip
  }
  const repo = new URL('..', import.meta.url).pathname;
  const changed = execSync(`git diff --name-only ${base} -- ${SHIPPED.join(' ')}`, { cwd: repo })
    .toString().trim().split('\n').filter(Boolean);
  const appChanged = changed.filter((f) => f !== 'sw.js');
  if (appChanged.length === 0) return; // nothing shipped changed

  // Resolve the effective cache NAME, not just the version token — older
  // revisions inline it as `CACHE = 'duct-v1'` with no CACHE_VERSION at all,
  // and comparing a token against `undefined` would pass vacuously.
  const cacheNameOf = (src) => {
    const v = (src.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
    if (v) return `duct-${v}`;
    return (src.match(/CACHE\s*=\s*'([^']+)'/) || [])[1] ?? null;
  };

  const now = cacheNameOf(sw);
  assert.ok(now, 'could not resolve a cache name from sw.js — the guard cannot verify a bump');

  const baseSw = execSync(`git show ${base}:sw.js`, { cwd: repo }).toString();
  const before = cacheNameOf(baseSw);
  assert.ok(before, `could not resolve a cache name from ${base}:sw.js`);

  assert.notEqual(
    now,
    before,
    `these shipped files changed:\n  ${appChanged.join('\n  ')}\n` +
      `so the service worker cache name must change (still '${now}') — ` +
      `without it the update may not reach installed devices`
  );
});
