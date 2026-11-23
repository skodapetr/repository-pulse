import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleReport } from './fixture.js';

// Loaded by URL so the TypeScript project does not have to typecheck the browser file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v: any = await import(new URL('../viewer/pulse-viewer.js', import.meta.url).href);

test('viewer module can be imported without a page', () => {
  assert.equal(typeof v.main, 'function');
});

test('the hash selects a report only when it is a date', () => {
  assert.equal(v.dateFromHash('#2026-11-14'), '2026-11-14');
  assert.equal(v.dateFromHash('2026-11-14'), '2026-11-14');
  assert.equal(v.dateFromHash('#contributors'), null);
  assert.equal(v.dateFromHash(''), null);
});

test('locate finds the report and its neighbours', () => {
  const reports = ['2026-11-21', '2026-11-14', '2026-11-07'].map((date) => ({ date }));
  const manifest = { reports };
  assert.equal(v.locate(manifest, null).entry.date, '2026-11-21');
  assert.equal(v.locate(manifest, null).next, null);
  assert.equal(v.locate(manifest, null).previous.date, '2026-11-14');
  const middle = v.locate(manifest, '2026-11-14');
  assert.equal(middle.previous.date, '2026-11-07');
  assert.equal(middle.next.date, '2026-11-21');
  assert.equal(v.locate(manifest, '2026-11-07').previous, null);
  assert.equal(v.locate(manifest, '2020-01-01'), null);
});

test('only safe links survive', () => {
  assert.equal(v.safeUrl('https://github.com/o/r'), 'https://github.com/o/r');
  assert.equal(v.safeUrl('pulse/2026-11-14.json'), 'pulse/2026-11-14.json');
  assert.equal(v.safeUrl('#2026-11-14'), '#2026-11-14');
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', '//evil.test/x', 'http://plain.test']) {
    assert.equal(v.safeUrl(bad), '#', bad);
  }
});

test('range, labels and anchors', () => {
  assert.equal(v.formatRange({ since: '2026-10-22T00:00:00Z', until: '2026-10-29T00:00:00Z' }), '2026-10-22 – 2026-10-28');
  assert.equal(v.refLabel({ repository: 'o/alpha', number: 3 }, true), 'alpha#3');
  assert.equal(v.refLabel({ repository: 'o/alpha', number: 3 }, false), '#3');
  assert.equal(v.anchorId('Data/Spec.er'), 'repo-data-spec-er');
});

test('commit grouping and counts', () => {
  const repo = sampleReport('2026-11-14').repositories[0];
  assert.equal(v.commitAuthors(repo.commits.defaultBranch), 'alice 2');
  // abc1234 belongs to merged PR 12 and is shown under it; only the direct one is left.
  const groups = v.directCommitGroups(repo);
  assert.deepEqual(groups.map(([key, commits]: [string, unknown[]]) => [key, commits.length]), [['alice', 1]]);
  assert.deepEqual(v.branchGroups(repo), []);
  assert.deepEqual(v.waitingCounts([{ waitingOn: ['a', 'b'] }, { waitingOn: ['a'] }, { waitingOn: [] }]), [['a', 2], ['b', 1]]);
});
