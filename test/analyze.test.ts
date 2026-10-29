import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeWaiting, type WaitingInput } from '../src/analyze.js';

const base = (overrides: Partial<WaitingInput>): WaitingInput => ({
  repository: 'o/r',
  number: 1,
  kind: 'issue',
  title: 't',
  url: 'u',
  draft: false,
  author: 'alice',
  createdAt: '2026-10-01T00:00:00Z',
  assignees: [],
  requestedReviewers: [],
  requestedTeams: [],
  activity: [],
  ...overrides,
});

test('issue: someone else comments last, assignee is expected to respond', () => {
  const w = computeWaiting(
    base({ assignees: ['bob'], activity: [{ type: 'comment', actor: 'alice', at: '2026-10-28T10:00:00Z' }] }),
  );
  assert.deepEqual(w?.waitingOn, ['bob']);
  assert.equal(w?.reasons[0].code, 'assignee-to-respond');
  assert.equal(w?.since, '2026-10-28T10:00:00Z');
});

test('issue: assignee answered the author, author is expected to respond', () => {
  const w = computeWaiting(
    base({ assignees: ['bob'], activity: [{ type: 'comment', actor: 'bob', at: '2026-10-28T10:00:00Z' }] }),
  );
  assert.deepEqual(w?.waitingOn, ['alice']);
  assert.equal(w?.reasons[0].code, 'author-to-respond');
});

test('issue: assignee is also the author and comments last, nothing to wait on', () => {
  const w = computeWaiting(
    base({ assignees: ['alice'], activity: [{ type: 'comment', actor: 'alice', at: '2026-10-28T10:00:00Z' }] }),
  );
  assert.equal(w, null);
});

test('issue: mention wins over assignment rules', () => {
  const w = computeWaiting(
    base({
      assignees: ['bob'],
      activity: [{ type: 'comment', actor: 'alice', at: '2026-10-28T10:00:00Z', mentions: ['carol'] }],
    }),
  );
  assert.deepEqual(w?.waitingOn, ['carol']);
  assert.equal(w?.reasons[0].code, 'mentioned');
});

test('issue: mention is cleared once the mentioned person acts', () => {
  const w = computeWaiting(
    base({
      assignees: ['alice'],
      activity: [
        { type: 'comment', actor: 'alice', at: '2026-10-28T10:00:00Z', mentions: ['carol'] },
        { type: 'comment', actor: 'carol', at: '2026-10-28T11:00:00Z' },
      ],
    }),
  );
  assert.deepEqual(w?.waitingOn, ['alice']);
  assert.equal(w?.reasons[0].code, 'assignee-to-respond');
});

test('issue: new and unassigned', () => {
  const w = computeWaiting(base({}));
  assert.equal(w?.reasons[0].code, 'unassigned');
  assert.deepEqual(w?.waitingOn, []);
});

test('pull: pending review request', () => {
  const w = computeWaiting(base({ kind: 'pull', requestedReviewers: ['bob'], requestedTeams: ['o/core'] }));
  assert.deepEqual(w?.waitingOn, ['bob', 'o/core']);
  assert.equal(w?.reasons[0].code, 'review-requested');
});

test('pull: draft ignores review requests', () => {
  assert.equal(computeWaiting(base({ kind: 'pull', draft: true, requestedReviewers: ['bob'] })), null);
});

test('pull: review comments wait on the author until they push', () => {
  const reviewed = base({
    kind: 'pull',
    draft: true,
    activity: [{ type: 'review', actor: 'bob', at: '2026-10-25T10:00:00Z', reviewState: 'COMMENTED' }],
  });
  const w = computeWaiting(reviewed);
  assert.deepEqual(w?.waitingOn, ['alice']);
  assert.equal(w?.reasons[0].code, 'review-feedback');

  const pushed = { ...reviewed, activity: [...reviewed.activity, { type: 'commit' as const, actor: 'alice', at: '2026-10-26T10:00:00Z' }] };
  assert.equal(computeWaiting(pushed), null);
});

test('pull: approved but not merged', () => {
  const w = computeWaiting(
    base({ kind: 'pull', activity: [{ type: 'review', actor: 'bob', at: '2026-10-25T10:00:00Z', reviewState: 'APPROVED' }] }),
  );
  assert.equal(w?.reasons[0].code, 'approved-not-merged');
});

test('pull: review request and mention combine', () => {
  const w = computeWaiting(
    base({
      kind: 'pull',
      requestedReviewers: ['bob', 'carol'],
      activity: [
        { type: 'commit', actor: 'alice', at: '2026-10-28T09:00:00Z' },
        { type: 'comment', actor: 'alice', at: '2026-10-28T10:00:00Z', mentions: ['carol'] },
        { type: 'commit', actor: 'alice', at: '2026-10-28T11:00:00Z' },
      ],
    }),
  );
  assert.deepEqual(w?.reasons.map((r) => r.code), ['review-requested', 'mentioned']);
  assert.deepEqual(w?.waitingOn, ['bob', 'carol']);
});
