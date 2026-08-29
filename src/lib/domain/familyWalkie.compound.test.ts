import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCompoundTransitions,
  isInsideCompound,
  isValidCompoundRing,
  type FamilyCompound,
} from './familyWalkie';

const square: FamilyCompound = {
  id: 'c1',
  name: 'חצר',
  createdBy: 'admin1',
  ring: [
    { lat: 32.0, lng: 34.0 },
    { lat: 32.0, lng: 34.01 },
    { lat: 32.01, lng: 34.01 },
    { lat: 32.01, lng: 34.0 },
  ],
};

describe('family compounds', () => {
  it('validates ring length', () => {
    assert.equal(isValidCompoundRing(square.ring), true);
    assert.equal(isValidCompoundRing(square.ring.slice(0, 2)), false);
  });

  it('detects point inside / outside closed ring', () => {
    assert.equal(isInsideCompound({ lat: 32.005, lng: 34.005 }, square), true);
    assert.equal(isInsideCompound({ lat: 31.5, lng: 34.005 }, square), false);
  });

  it('detects enter and exit transitions', () => {
    const outside = { lat: 31.5, lng: 34.005 };
    const inside = { lat: 32.005, lng: 34.005 };
    const enter = detectCompoundTransitions(outside, inside, [square]);
    assert.equal(enter.entered.length, 1);
    assert.equal(enter.exited.length, 0);
    const exit = detectCompoundTransitions(inside, outside, [square]);
    assert.equal(exit.exited.length, 1);
    assert.equal(exit.entered.length, 0);
  });
});
