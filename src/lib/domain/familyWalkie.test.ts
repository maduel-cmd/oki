import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canUseQuietMode,
  clampZoneRadiusM,
  detectBoundaryCross,
  detectZoneTransitions,
  generateInviteCode,
  hasRequiredPermissions,
  isFamilyAdmin,
  isInForceAudioZone,
  isInsideZone,
  isValidInviteCode,
  normalizeInviteCode,
  shouldPlayIncomingPtt,
  sideOfLine,
  type FamilyZone,
  type FamilyBoundaryLine,
} from './familyWalkie';

const home: FamilyZone = {
  id: 'z1',
  name: 'בית',
  center: { lat: 32.08, lng: 34.78 },
  radiusM: 200,
  forceAudio: true,
};

const park: FamilyZone = {
  id: 'z2',
  name: 'פארק',
  center: { lat: 32.1, lng: 34.8 },
  radiusM: 100,
  forceAudio: false,
};

describe('isInsideZone', () => {
  it('true near center', () => {
    assert.equal(isInsideZone({ lat: 32.0801, lng: 34.7801 }, home), true);
  });

  it('false far away', () => {
    assert.equal(isInsideZone({ lat: 32.2, lng: 34.9 }, home), false);
  });
});

describe('quiet / force-audio', () => {
  it('force-audio zone blocks quiet even when preferred', () => {
    const pos = { lat: 32.08, lng: 34.78 };
    assert.equal(isInForceAudioZone(pos, [home, park]), true);
    assert.equal(canUseQuietMode(true, pos, [home, park]), false);
    assert.equal(shouldPlayIncomingPtt(true, pos, [home, park]), true);
  });

  it('outside force-audio allows quiet when preferred', () => {
    const pos = { lat: 32.2, lng: 34.9 };
    assert.equal(canUseQuietMode(true, pos, [home]), true);
    assert.equal(shouldPlayIncomingPtt(true, pos, [home]), false);
  });

  it('quiet off always plays', () => {
    assert.equal(
      shouldPlayIncomingPtt(false, { lat: 32.2, lng: 34.9 }, [home]),
      true,
    );
  });

  it('non-force zone does not block quiet', () => {
    const pos = { lat: 32.1, lng: 34.8 };
    assert.equal(canUseQuietMode(true, pos, [park]), true);
  });
});

describe('boundary line crossing', () => {
  const line: FamilyBoundaryLine = {
    id: 'l1',
    name: 'שער',
    a: { lat: 32.0, lng: 35.0 },
    b: { lat: 32.02, lng: 35.0 },
    alertWithinM: 80,
  };

  it('detects side flip near the line', () => {
    const prev = { lat: 32.01, lng: 34.9995 };
    const next = { lat: 32.01, lng: 35.0005 };
    const r = detectBoundaryCross(prev, next, line);
    assert.equal(r.crossed, true);
    assert.equal(r.fromSide, sideOfLine(prev, line.a, line.b));
    assert.equal(r.toSide, sideOfLine(next, line.a, line.b));
    assert.notEqual(r.fromSide, r.toSide);
  });

  it('ignores side flip when far from segment', () => {
    const prev = { lat: 32.01, lng: 34.9 };
    const next = { lat: 32.01, lng: 35.1 };
    const r = detectBoundaryCross(prev, next, line);
    assert.equal(r.crossed, false);
  });

  it('no cross without previous point', () => {
    const r = detectBoundaryCross(null, { lat: 32.01, lng: 35.0005 }, line);
    assert.equal(r.crossed, false);
  });
});

describe('zone transitions', () => {
  it('reports enter and exit', () => {
    const outside = { lat: 32.2, lng: 34.9 };
    const inside = { lat: 32.08, lng: 34.78 };
    const enter = detectZoneTransitions(outside, inside, [home]);
    assert.equal(enter.entered.length, 1);
    assert.equal(enter.entered[0]?.id, 'z1');
    const exit = detectZoneTransitions(inside, outside, [home]);
    assert.equal(exit.exited.length, 1);
  });
});

describe('invite codes & helpers', () => {
  it('normalizes and validates', () => {
    assert.equal(normalizeInviteCode(' ab-12cd '), 'AB12CD');
    assert.equal(isValidInviteCode('AB12CD'), true);
    assert.equal(isValidInviteCode('ab'), false);
  });

  it('generates 6-char codes', () => {
    const code = generateInviteCode(() => 0.1);
    assert.equal(code.length, 6);
    assert.equal(isValidInviteCode(code), true);
  });

  it('clamps radius', () => {
    assert.equal(clampZoneRadiusM(10), 50);
    assert.equal(clampZoneRadiusM(99999), 5000);
  });

  it('admin role check and permissions', () => {
    assert.equal(isFamilyAdmin('admin'), true);
    assert.equal(isFamilyAdmin('member'), false);
    assert.equal(
      hasRequiredPermissions({
        microphone: 'granted',
        geolocation: 'granted',
      }),
      true,
    );
    assert.equal(
      hasRequiredPermissions({
        microphone: 'granted',
        geolocation: 'denied',
      }),
      false,
    );
  });
});
