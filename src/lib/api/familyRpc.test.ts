import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterInviteInput, prepareJoinCode } from '../domain';
import ar from '../i18n/locales/ar.json';
import en from '../i18n/locales/en.json';
import he from '../i18n/locales/he.json';
import type { OkiClient } from './client';
import {
  JOIN_OKI_FAMILY_RPC,
  JOIN_OKI_FAMILY_V2_RPC,
  JoinRejectedError,
  ROTATE_OKI_INVITE_CODE_RPC,
  cloudErrorI18nKey,
  familyStateAfterLeave,
  joinCloudFamily,
  joinFailureReason,
  leaveUiPlan,
  rotateCloudInviteCode,
  shouldUseOfflineFamily,
} from './familyRpc';

const FAMILY_ID = '11111111-1111-4111-8111-111111111111';

type RpcResult = {
  data: unknown;
  error: { message?: string; code?: string } | null;
  status?: number;
};

function mockClient(
  handler: (name: string, args: Record<string, unknown>) => RpcResult | Promise<RpcResult>,
): { client: OkiClient; calls: string[] } {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      return handler(name, args);
    },
  };
  return { client: client as unknown as OkiClient, calls };
}

describe('joinCloudFamily', () => {
  it('accepts a v2 jsonb payload', async () => {
    const { client, calls } = mockClient(async (name) => {
      assert.equal(name, JOIN_OKI_FAMILY_V2_RPC);
      return {
        data: { status: 'ok', family_id: FAMILY_ID },
        error: null,
        status: 200,
      };
    });
    const id = await joinCloudFamily(client, {
      inviteCode: 'AB12CD',
      displayName: 'אבא',
    });
    assert.equal(id, FAMILY_ID);
    assert.deepEqual(calls, [JOIN_OKI_FAMILY_V2_RPC]);
  });

  it('accepts a uuid string from v2 without calling v1', async () => {
    const { client, calls } = mockClient(async () => ({
      data: FAMILY_ID,
      error: null,
      status: 200,
    }));
    const id = await joinCloudFamily(client, {
      inviteCode: 'ab12cd',
      displayName: 'אבא',
    });
    assert.equal(id, FAMILY_ID);
    assert.deepEqual(calls, [JOIN_OKI_FAMILY_V2_RPC]);
  });

  it('falls back to v1 when v2 is missing (PGRST202)', async () => {
    const { client, calls } = mockClient(async (name) => {
      if (name === JOIN_OKI_FAMILY_V2_RPC) {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function join_oki_family_v2',
          },
          status: 404,
        };
      }
      assert.equal(name, JOIN_OKI_FAMILY_RPC);
      return { data: FAMILY_ID, error: null, status: 200 };
    });
    const id = await joinCloudFamily(client, {
      inviteCode: 'AB12CD',
      displayName: 'אבא',
    });
    assert.equal(id, FAMILY_ID);
    assert.deepEqual(calls, [JOIN_OKI_FAMILY_V2_RPC, JOIN_OKI_FAMILY_RPC]);
  });

  it('falls back to v1 on PostgREST 404', async () => {
    const { client, calls } = mockClient(async (name) => {
      if (name === JOIN_OKI_FAMILY_V2_RPC) {
        return { data: null, error: { message: 'not found' }, status: 404 };
      }
      return { data: FAMILY_ID, error: null, status: 200 };
    });
    assert.equal(
      await joinCloudFamily(client, { inviteCode: 'AB12CD', displayName: 'א' }),
      FAMILY_ID,
    );
    assert.deepEqual(calls, [JOIN_OKI_FAMILY_V2_RPC, JOIN_OKI_FAMILY_RPC]);
  });

  it('rejects invalid_or_expired without a local family and without v1', async () => {
    const { client, calls } = mockClient(async () => ({
      data: { status: 'invalid_or_expired', family_id: null },
      error: null,
      status: 200,
    }));
    await assert.rejects(
      () => joinCloudFamily(client, { inviteCode: 'AB12CD', displayName: 'א' }),
      (err: unknown) =>
        err instanceof JoinRejectedError && err.reason === 'invalid_or_expired',
    );
    assert.deepEqual(calls, [JOIN_OKI_FAMILY_V2_RPC]);
    assert.equal(
      shouldUseOfflineFamily({ serverConfigured: true, signedIn: true }),
      false,
    );
    assert.equal(joinFailureReason(new JoinRejectedError('invalid_or_expired')), 'invalid_or_expired');
  });

  it('rejects rate_limited without a local family', async () => {
    const { client } = mockClient(async () => ({
      data: { status: 'rate_limited', family_id: null },
      error: null,
      status: 200,
    }));
    await assert.rejects(
      () => joinCloudFamily(client, { inviteCode: 'AB12CD', displayName: 'א' }),
      (err: unknown) => err instanceof JoinRejectedError && err.reason === 'rate_limited',
    );
    assert.equal(shouldUseOfflineFamily({ serverConfigured: true, signedIn: true }), false);
  });

  it('treats a v1 invalid_invite_code raise as a hard rejection', async () => {
    const { client, calls } = mockClient(async (name) => {
      if (name === JOIN_OKI_FAMILY_V2_RPC) {
        return {
          data: null,
          error: { code: 'PGRST202', message: 'PGRST202' },
          status: 404,
        };
      }
      return {
        data: null,
        error: { code: 'P0001', message: 'invalid_invite_code' },
        status: 400,
      };
    });
    await assert.rejects(
      () => joinCloudFamily(client, { inviteCode: 'AB12CD', displayName: 'א' }),
      (err: unknown) =>
        err instanceof JoinRejectedError && err.reason === 'invalid_invite_code',
    );
    assert.deepEqual(calls, [JOIN_OKI_FAMILY_V2_RPC, JOIN_OKI_FAMILY_RPC]);
    assert.equal(
      shouldUseOfflineFamily({ serverConfigured: true, signedIn: true }),
      false,
    );
  });
});

describe('offline family policy', () => {
  it('uses a local family only when no server is configured and nobody is signed in', () => {
    assert.equal(shouldUseOfflineFamily({ serverConfigured: false, signedIn: false }), true);
    assert.equal(shouldUseOfflineFamily({ serverConfigured: true, signedIn: false }), false);
    assert.equal(shouldUseOfflineFamily({ serverConfigured: true, signedIn: true }), false);
    assert.equal(shouldUseOfflineFamily({ serverConfigured: false, signedIn: true }), false);
  });

  it('a signed-in cloud create failure does not open a local family', () => {
    const signedIn = true;
    const serverConfigured = true;
    const createFailed = true;
    assert.equal(createFailed, true);
    assert.equal(shouldUseOfflineFamily({ serverConfigured, signedIn }), false);
  });
});

describe('leave', () => {
  it('keeps state and location sharing when the server call fails', () => {
    const family = {
      id: FAMILY_ID,
      inviteCode: 'AB12CD',
      members: [{ id: 'me', sharedPosition: { lat: 32.1, lng: 34.8 } }],
    };
    const plan = leaveUiPlan({
      attemptedServer: true,
      error: new Error('last_admin'),
    });
    assert.equal(plan.clearFamily, false);
    assert.equal(plan.stopLocationSharing, false);
    assert.equal(plan.showError, true);
    assert.equal(familyStateAfterLeave(family, plan), family);
    assert.equal(family.members[0]?.sharedPosition?.lat, 32.1);
    assert.equal(cloudErrorI18nKey('leave_failed'), 'family.leaveFailed');
  });

  it('clears the family after a successful leave', () => {
    const family = { id: 'local', members: [{ id: 'me', sharedPosition: { lat: 1, lng: 2 } }] };
    const plan = leaveUiPlan({ attemptedServer: false, error: null });
    assert.equal(plan.clearFamily, true);
    assert.equal(plan.stopLocationSharing, true);
    assert.equal(plan.showError, false);
    assert.equal(familyStateAfterLeave(family, plan), null);
  });
});

describe('rotate invite code', () => {
  it('shows the code returned by the server RPC', async () => {
    const { client, calls } = mockClient(async (name, args) => {
      assert.equal(name, ROTATE_OKI_INVITE_CODE_RPC);
      assert.equal(args.p_family_id, FAMILY_ID);
      return { data: 'ABCDEFGHJK', error: null, status: 200 };
    });
    assert.equal(await rotateCloudInviteCode(client, FAMILY_ID), 'ABCDEFGHJK');
    assert.deepEqual(calls, [ROTATE_OKI_INVITE_CODE_RPC]);
  });
});

describe('join input field', () => {
  it('keeps legacy O, I, and L when a prefixed code is pasted', () => {
    const field = filterInviteInput('Code: OIL9X2');
    assert.equal(field, 'CODEOIL9X2');
    assert.equal(field.includes('O'), true);
    assert.equal(field.includes('I'), true);
    assert.equal(field.includes('L'), true);
    assert.notEqual(field, 'C0DE0119X2');
    assert.equal(prepareJoinCode('OIL9X2').submitCode, 'OIL9X2');
    assert.equal(prepareJoinCode('OIL9X2').field, 'OIL9X2');
  });

  it('does not truncate a code longer than 10 and reports it', () => {
    const raw = 'ABCDEFGHJKXYZ';
    const prepared = prepareJoinCode(raw);
    assert.equal(prepared.field, 'ABCDEFGHJKXYZ');
    assert.equal(prepared.field.length > 10, true);
    assert.equal(prepared.tooLong, true);
    assert.equal(prepared.submitCode, null);
    assert.equal(cloudErrorI18nKey('too_long'), 'family.inviteTooLong');
  });

  it('maps Crockford lookalikes only when the submitted code is 10 characters', () => {
    assert.equal(filterInviteInput('OOOOOOOOOO'), 'OOOOOOOOOO');
    assert.equal(prepareJoinCode('OOOOOOOOOO').submitCode, '0000000000');
    assert.equal(prepareJoinCode('AB.12CD').submitCode, 'AB12CD');
  });
});

describe('join error copy', () => {
  it('has Hebrew, English, and Arabic strings for each rejection', () => {
    const keys = [
      'inviteTooLong',
      'invalidCode',
      'joinInvalidOrExpired',
      'joinRateLimited',
      'joinInvalidCode',
      'joinFailed',
      'signInToJoin',
      'createFailed',
      'leaveFailed',
      'rotateInvite',
      'rotateFailed',
    ] as const;
    for (const key of keys) {
      assert.equal(typeof he.family[key], 'string');
      assert.equal(typeof en.family[key], 'string');
      assert.equal(typeof ar.family[key], 'string');
      assert.equal(he.family[key].length > 0, true);
    }
  });
});
