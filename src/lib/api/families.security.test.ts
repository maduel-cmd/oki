import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMemberLocations, type CloudFamilyMemberRow } from './families';
import { generateInviteCode, isValidInviteCode } from '../domain';

const member = (id: string): CloudFamilyMemberRow => ({
  family_id: 'f1',
  user_id: id,
  role: 'member',
  display_name: id,
  quiet_preferred: false,
  last_lat: null,
  last_lng: null,
  last_seen_at: null,
  joined_at: '2026-11-13T00:00:00Z',
});

describe('shared locations overlay', () => {
  it('only members with a visible location row get coordinates', () => {
    const out = mergeMemberLocations(
      [member('kid'), member('sibling')],
      [{ user_id: 'kid', lat: 32.1, lng: 34.8, shared_at: '2026-11-13T10:00:00Z' }],
    );
    assert.equal(out[0]!.last_lat, 32.1);
    assert.equal(out[0]!.last_lng, 34.8);
    assert.equal(out[0]!.last_seen_at, '2026-11-13T10:00:00Z');
    assert.equal(out[1]!.last_lat, null);
    assert.equal(out[1]!.last_lng, null);
  });

  it('no rows (non-admin view) leaves every member without coordinates', () => {
    const out = mergeMemberLocations([member('a'), member('b')], []);
    assert.ok(out.every((m) => m.last_lat == null && m.last_lng == null));
  });
});

describe('invite codes', () => {
  it('default generator yields valid, non-repeating codes', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateInviteCode()));
    assert.ok(codes.size > 195);
    for (const c of codes) {
      assert.ok(isValidInviteCode(c));
      assert.match(c, /^[A-HJ-NP-Z2-9]{6}$/);
    }
  });
});
