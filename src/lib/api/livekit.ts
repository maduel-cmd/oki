import type { OkiClient } from './client';

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export type LiveKitTokenSuccess = {
  demo: false;
  url: string;
  room: string;
  identity: string;
  token: string;
};

export type LiveKitTokenDemo = {
  demo: true;
  room: string;
  identity?: string;
  error?: string;
};

export type LiveKitTokenResult = LiveKitTokenSuccess | LiveKitTokenDemo;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Normalize Edge Function JSON into a typed LiveKit token result. */
export function parseLiveKitTokenPayload(
  payload: unknown,
): LiveKitTokenResult {
  const row = asRecord(payload);
  if (!row) {
    return { demo: true, room: 'unknown', error: 'invalid_payload' };
  }

  if (row.demo === true || row.error === 'livekit_not_configured') {
    return {
      demo: true,
      room: typeof row.room === 'string' ? row.room : 'unknown',
      identity: typeof row.identity === 'string' ? row.identity : undefined,
      error: typeof row.error === 'string' ? row.error : undefined,
    };
  }

  const url = typeof row.url === 'string' ? row.url : '';
  const token = typeof row.token === 'string' ? row.token : '';
  const room = typeof row.room === 'string' ? row.room : '';
  const identity = typeof row.identity === 'string' ? row.identity : '';

  if (!url || !token || !room) {
    return {
      demo: true,
      room: room || 'unknown',
      identity: identity || undefined,
      error: 'incomplete_token',
    };
  }

  return { demo: false, url, room, identity, token };
}

/**
 * Mint a LiveKit access token for a trip room (Edge Function `livekit-token`).
 * Returns `{ demo: true }` when LiveKit secrets are missing or trip is local-only.
 */
export async function fetchFamilyLiveKitToken(
  client: OkiClient,
  familyId: string,
): Promise<LiveKitTokenResult> {
  if (!isUuid(familyId)) {
    return {
      demo: true,
      room: `family_local_${familyId}`,
      error: 'local_family',
    };
  }

  const { data, error } = await client.functions.invoke('family-livekit-token', {
    body: { familyId, family_id: familyId },
  });

  if (error) {
    console.warn('[Oki] family-livekit-token invoke failed', error.message);
    return {
      demo: true,
      room: `family_${familyId}`,
      error: error.message,
    };
  }

  return parseLiveKitTokenPayload(data);
}
