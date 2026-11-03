// Where the corner approvals go, and the checklist summary's approval copy
// (discovery-call build review R3). Pure modules only: no DOM, DB or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const p = require('../lib/notification-placement.ts');
const copy = require('../lib/checklist-coverage/followup-copy.ts');

const NONE = { surface: false, modal: false };

test('Calls, Settings › Calls and Inbox are compact: a badge, cards only on tap, below sheets', () => {
  for (const path of ['/calls', '/calls?open=1', '/settings/calls', '/inbox', '/inbox/t1']) {
    const pathname = path.split('?')[0];
    const closed = p.approvalPlacement(pathname, NONE, false, true);
    assert.deepEqual(closed, { compact: true, expanded: false, badge: 'slot', corner: 'top', layer: 35 }, path);
    assert.equal(p.approvalPlacement(pathname, NONE, true, true).expanded, true, `${path}: the badge opens the cards`);
  }
});

test('other pages keep the bottom-right stack; similar paths are not caught', () => {
  for (const path of ['/projects', '/settings', '/settings/callsx', '/callsheet', '/leads/alex', null]) {
    assert.deepEqual(p.approvalPlacement(path, NONE, false), { compact: false, expanded: true, badge: 'none', corner: 'bottom', layer: 60 }, String(path));
  }
});

test('a mounted checklist surface makes any page compact; an open sheet keeps the cards shut', () => {
  const surface = p.approvalPlacement('/leads/alex', { surface: true, modal: false }, true);
  assert.equal(surface.compact, true);
  assert.equal(surface.expanded, true);
  assert.equal(surface.badge, 'corner', 'no slot on the page: top corner');
  for (const [path, slot] of [['/leads/alex', false], ['/calls', true], ['/projects', false]]) {
    const modal = p.approvalPlacement(path, { surface: true, modal: true }, true, slot);
    assert.equal(modal.compact, true, path);
    assert.equal(modal.expanded, false, `${path}: no card above an open sheet, even after a tap`);
    assert.equal(modal.layer, 35);
  }
  assert.equal(p.approvalPlacement('/leads/alex', { surface: true, modal: true }, false, false).badge, 'none', 'no slot + sheet open: the badge waits rather than land on the breadcrumb');
  assert.equal(p.approvalPlacement('/calls', { surface: true, modal: true }, false, true).badge, 'slot');
  // The old boolean form (Inbox's surface flag) still works.
  assert.equal(p.approvalPlacement('/projects', true, false).compact, true);
});

test('claims: each source counts once; releasing the last one ends compact; modal wins while any is open', () => {
  let m = new Map();
  m = p.applyClaim(m, 'pane', true);
  assert.deepEqual(p.summarizeClaims(m), { surface: true, modal: false });
  m = p.applyClaim(m, 'sheet', true, true);
  assert.deepEqual(p.summarizeClaims(m), { surface: true, modal: true });
  m = p.applyClaim(m, 'pane', true);
  assert.equal(m.size, 2, 're-claiming does not double count');
  m = p.applyClaim(m, 'sheet', false);
  assert.deepEqual(p.summarizeClaims(m), { surface: true, modal: false }, 'sheet closed: the pane still holds compact');
  m = p.applyClaim(m, 'pane', false);
  assert.deepEqual(p.summarizeClaims(m), NONE);
  m = p.applyClaim(m, 'never-claimed', false);
  assert.equal(m.size, 0);
});

test('module registry: a claim made before NotificationCenter listens is still counted', () => {
  assert.deepEqual(p.currentClaims(), NONE);
  p.claimCompactApprovals('pane-1', true);
  p.claimCompactApprovals('sheet-1', true, true);
  assert.deepEqual(p.currentClaims(), { surface: true, modal: true });
  p.claimCompactApprovals('sheet-1', false);
  p.claimCompactApprovals('pane-1', false);
  assert.deepEqual(p.currentClaims(), NONE);
  assert.equal(p.APPROVAL_SLOT_ID, 'approval-badge-slot');
});

test('submitted copy: the owner is told it waits for *his* approval; staff that Joe approves it', () => {
  const owner = copy.followupCopy('owner');
  assert.equal(owner.submitted, "Waiting for your approval — it's in Today.");
  assert.doesNotMatch(owner.submitted + owner.hint + owner.status('requested'), /\bJoe\b/);
  const staff = copy.followupCopy('staff');
  assert.equal(staff.submitted, 'Submitted for approval. Joe approves it in Today; approval sends it.');
  assert.equal(staff.hint, 'Joe approves it in Today; approval sends it.');
  assert.equal(copy.followupCopy(undefined).submitted, staff.submitted, 'unknown viewer: the staff wording');
  assert.equal(staff.status('approved'), 'approved');
  assert.equal(staff.status('weird'), 'weird');
});

test('the follow-up just submitted here is said once (its status line), earlier ones stay listed', () => {
  const drafts = [{ id: 'new' }, { id: 'old' }];
  assert.deepEqual(copy.earlierDrafts(drafts, false, null).map((d) => d.id), ['new', 'old']);
  assert.deepEqual(copy.earlierDrafts(drafts, true, ['old']).map((d) => d.id), ['old']);
  assert.deepEqual(copy.earlierDrafts(drafts, true, []).map((d) => d.id), []);
});
