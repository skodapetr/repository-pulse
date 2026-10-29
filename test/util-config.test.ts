import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildConfig, makeIgnoreFilter, parseList, parseWindow } from '../src/config.js';
import { excerpt, inWindow, mentions } from '../src/util.js';

test('mentions skip code, quotes, e-mails and teams', () => {
  const body = [
    '@alice please look, cc @bob-x.',
    '> @quoted should be ignored',
    'mail me at someone@example.com',
    '`@inline` and team @org/team',
    '```',
    '@fenced',
    '```',
  ].join('\n');
  assert.deepEqual(mentions(body), ['alice', 'bob-x']);
});

test('excerpt cleans Markdown and truncates', () => {
  assert.equal(excerpt('<!-- hidden -->## Title\n**bold** [link](https://x.y/(a)) ![img](z.png)'), 'Title bold link [image]');
  assert.equal(excerpt('a'.repeat(20), 10), 'aaaaaaaaa…');
});

test('parseList accepts lines, commas, YAML dashes and comments', () => {
  assert.deepEqual(parseList('- a/b\n  c/d, e/f # comment\n# skip\n'), ['a/b', 'c/d', 'e/f']);
});

test('window from days and explicit dates', () => {
  const now = new Date('2026-10-29T12:34:56.789Z');
  assert.deepEqual(parseWindow({ days: '7' }, now), {
    since: '2026-10-22T12:34:56Z',
    until: '2026-10-29T12:34:56Z',
    days: 7,
  });
  assert.deepEqual(parseWindow({ since: '2026-10-22', until: '2026-10-29' }), {
    since: '2026-10-22T00:00:00Z',
    until: '2026-10-29T00:00:00Z',
    days: 7,
  });
  assert.throws(() => parseWindow({ since: '2026-10-29', until: '2026-10-22' }));
  const w = parseWindow({ since: '2026-10-22', until: '2026-10-29' });
  assert.ok(inWindow('2026-10-22T00:00:00Z', w));
  assert.ok(!inWindow('2026-10-29T00:00:00Z', w));
});

test('config validates repositories and components', () => {
  const known = ['json', 'html', 'agent', 'step-summary'];
  const c = buildConfig({ repositories: 'https://github.com/o/r.git\no/r' }, known);
  assert.deepEqual(c.repositories, ['o/r']);
  assert.deepEqual(c.components, ['json', 'html', 'agent']);
  assert.deepEqual(buildConfig({ repositories: 'o/r', components: 'agent, JSON' }, known).components, ['agent', 'json']);
  assert.throws(() => buildConfig({ repositories: 'o/r', components: 'pdf' }, ['json']), /Unknown component/);
  assert.throws(() => buildConfig({ repositories: '' }, ['json']), /No repositories/);
  assert.throws(() => buildConfig({ repositories: 'not a repo' }, ['json']), /Invalid repository/);
});

test('bot detection', () => {
  const { isIgnored, seen } = makeIgnoreFilter(['ci-helper']);
  assert.ok(isIgnored('dependabot[bot]'));
  assert.ok(isIgnored('dataspecer-bot'));
  assert.ok(isIgnored('someone', 'Bot'));
  assert.ok(isIgnored('CI-Helper'));
  assert.ok(!isIgnored('robot-arm'));
  assert.ok(!isIgnored('abbott'));
  assert.deepEqual([...seen].sort(), ['CI-Helper', 'dataspecer-bot', 'dependabot[bot]', 'someone']);
});
