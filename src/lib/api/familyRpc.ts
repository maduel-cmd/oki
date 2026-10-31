import {
  isValidInviteCode,
  normalizeInviteCode,
  prepareJoinCode,
} from '../domain';
import type { OkiClient } from './client';

export const JOIN_OKI_FAMILY_V2_RPC = 'join_oki_family_v2';
export const JOIN_OKI_FAMILY_RPC = 'join_oki_family';

/**
 * Admin invite-code rotation.
 * TrailLink #226 (branch cursor/family-members-rls-5377) was not readable
 * from this environment, so this is a single stand-in name. Assumed call:
 * rpc(ROTATE_OKI_INVITE_CODE_RPC, { p_family_id }) returns the new code.
 */
export const ROTATE_OKI_INVITE_CODE_RPC = 'rotate_oki_family_invite_code';

export type JoinRejectionReason =
  | 'invalid_or_expired'
  | 'rate_limited'
  | 'invalid_invite_code';

export type JoinFailureReason =
  | 'too_long'
  | 'invalid_format'
  | JoinRejectionReason
  | 'not_signed_in'
  | 'join_failed';

export type JoinFamilyResult =
  | { ok: true }
  | { ok: false; reason: JoinFailureReason };

export class JoinRejectedError extends Error {
  readonly reason: JoinRejectionReason;

  constructor(reason: JoinRejectionReason) {
    super(reason);
    this.name = 'JoinRejectedError';
    this.reason = reason;
  }
}

type RpcError = { message?: string; code?: string } | null;

type RpcResponse = {
  data: unknown;
  error: RpcError;
  status?: number;
};

const CLOUD_ERROR_I18N: Record<string, string> = {
  too_long: 'family.inviteTooLong',
  invalid_format: 'family.invalidCode',
  invalid_or_expired: 'family.joinInvalidOrExpired',
  rate_limited: 'family.joinRateLimited',
  invalid_invite_code: 'family.joinInvalidCode',
  not_signed_in: 'family.signInToJoin',
  create_failed: 'family.createFailed',
  leave_failed: 'family.leaveFailed',
  rotate_failed: 'family.rotateFailed',
  join_failed: 'family.joinFailed',
};

export function cloudErrorI18nKey(code: string | null): string | null {
  if (!code) return null;
  return CLOUD_ERROR_I18N[code] ?? null;
}

/** Offline demo only when no server is configured and nobody is signed in. */
export function shouldUseOfflineFamily(input: {
  serverConfigured: boolean;
  signedIn: boolean;
}): boolean {
  if (input.signedIn) return false;
  return !input.serverConfigured;
}

export function isMissingRpcError(input: RpcResponse): boolean {
  if (typeof input.data === 'string' && input.data.length > 0) return false;
  if (isJoinObject(input.data)) return false;
  if (input.status === 404) return true;
  const code = input.error?.code ?? '';
  const message = input.error?.message ?? '';
  return code === 'PGRST202' || message.includes('PGRST202');
}

export function isInvalidInviteRaise(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message =
    'message' in error && typeof error.message === 'string' ? error.message : '';
  return message.includes('invalid_invite_code');
}

export function interpretJoinPayload(data: unknown): string {
  if (typeof data === 'string' && data.length > 0) return data;
  if (isJoinObject(data)) {
    const status = data.status;
    if (status === 'invalid_or_expired' || status === 'rate_limited') {
      throw new JoinRejectedError(status);
    }
    if (
      status === 'ok' &&
      typeof data.family_id === 'string' &&
      data.family_id.length > 0
    ) {
      return data.family_id;
    }
  }
  throw new Error('join_oki_family_bad_result');
}

export function joinFailureReason(err: unknown): JoinFailureReason {
  if (err instanceof JoinRejectedError) return err.reason;
  if (isInvalidInviteRaise(err)) return 'invalid_invite_code';
  return 'join_failed';
}

export type LeaveUiPlan = {
  clearFamily: boolean;
  stopLocationSharing: boolean;
  showError: boolean;
};

/** A failed server leave keeps the open family and its shared location. */
export function leaveUiPlan(input: {
  attemptedServer: boolean;
  error: unknown | null;
}): LeaveUiPlan {
  if (input.attemptedServer && input.error) {
    return {
      clearFamily: false,
      stopLocationSharing: false,
      showError: true,
    };
  }
  return {
    clearFamily: true,
    stopLocationSharing: true,
    showError: false,
  };
}

export function familyStateAfterLeave<T>(
  family: T,
  plan: LeaveUiPlan,
): T | null {
  return plan.clearFamily ? null : family;
}

export async function joinCloudFamily(
  client: OkiClient,
  input: { inviteCode: string; displayName: string },
): Promise<string> {
  const prepared = prepareJoinCode(input.inviteCode);
  if (prepared.tooLong || !prepared.submitCode) {
    throw new JoinRejectedError('invalid_invite_code');
  }
  const code = normalizeInviteCode(prepared.submitCode);
  if (!isValidInviteCode(code)) {
    throw new JoinRejectedError('invalid_invite_code');
  }
  const args = {
    p_invite_code: code,
    p_display_name: input.displayName,
  };
  const v2 = await callRpc(client, JOIN_OKI_FAMILY_V2_RPC, args);
  const response = isMissingRpcError(v2)
    ? await callRpc(client, JOIN_OKI_FAMILY_RPC, args)
    : v2;
  if (response.error && isMissingRpcError(response)) {
    throw response.error;
  }
  if (response.error) {
    if (isInvalidInviteRaise(response.error)) {
      throw new JoinRejectedError('invalid_invite_code');
    }
    throw response.error;
  }
  return interpretJoinPayload(response.data);
}

export async function rotateCloudInviteCode(
  client: OkiClient,
  familyId: string,
): Promise<string> {
  const response = await callRpc(client, ROTATE_OKI_INVITE_CODE_RPC, {
    p_family_id: familyId,
  });
  if (response.error) throw response.error;
  const code = readRotatedCode(response.data);
  if (!code) throw new Error('rotate_invite_code_bad_result');
  return code;
}

function isJoinObject(
  data: unknown,
): data is { status?: unknown; family_id?: unknown } {
  return Boolean(data) && typeof data === 'object';
}

function readRotatedCode(data: unknown): string | null {
  if (typeof data === 'string' && isValidInviteCode(data)) {
    return normalizeInviteCode(data);
  }
  if (data && typeof data === 'object') {
    const row = data as { invite_code?: unknown; code?: unknown };
    const raw = row.invite_code ?? row.code;
    if (typeof raw === 'string' && isValidInviteCode(raw)) {
      return normalizeInviteCode(raw);
    }
  }
  return null;
}

async function callRpc(
  client: OkiClient,
  name: string,
  args: Record<string, unknown>,
): Promise<RpcResponse> {
  const result = await client.rpc(name, args);
  return result as RpcResponse;
}
