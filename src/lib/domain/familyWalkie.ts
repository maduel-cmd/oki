import { distanceMeters, closestPointOnSegment } from './geo';
import type { LatLng } from './types';

/** Role inside a family group. Parents (`admin`) manage zones and location requests. */
export type FamilyRole = 'admin' | 'member';

export type FamilyPermissionKind = 'microphone' | 'geolocation' | 'notifications';

export type FamilyPermissionStatus =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'prompt';

/** Circular geofence (e.g. home) where quiet mode can be forbidden. */
export type FamilyZone = {
  id: string;
  name: string;
  center: LatLng;
  radiusM: number;
  /** When true, members inside cannot mute incoming family PTT. */
  forceAudio: boolean;
};

/**
 * Virtual "line" / boundary. Crossing (side change) notifies admins.
 * Side is determined by the sign of the 2D cross product relative to A→B.
 * @deprecated Prefer {@link FamilyCompound} closed enclosures for new UI.
 */
export type FamilyBoundaryLine = {
  id: string;
  name: string;
  a: LatLng;
  b: LatLng;
  /** Alert when distance to the segment is at most this (meters). */
  alertWithinM: number;
};

/**
 * Closed geometric enclosure (fence / compound). Parents only see these.
 * Enter / exit notifies admins. Ring has ≥3 vertices; edge last→first closes it.
 */
export type FamilyCompound = {
  id: string;
  name: string;
  ring: LatLng[];
  createdBy: string;
};

/**
 * Manual meetup pin (e.g. «שער 12»). Visible to all family members.
 * Not GPS tracking — a shared rendezvous label on the map.
 */
export type FamilyMeetingPoint = {
  id: string;
  name: string;
  position: LatLng;
  createdBy: string;
};

export const MIN_COMPOUND_POINTS = 3;

export type FamilyMemberPresence = {
  memberId: string;
  displayName: string;
  role: FamilyRole;
  position: LatLng | null;
  quietPreferred: boolean;
  lastSeenAt: string | null;
};

export type LocationRequestStatus = 'pending' | 'shared' | 'denied' | 'expired';

export type FamilyLocationRequest = {
  id: string;
  fromAdminId: string;
  toMemberId: string;
  status: LocationRequestStatus;
  createdAt: string;
};

export type FamilyAlertKind =
  | 'boundary_crossed'
  | 'zone_enter'
  | 'zone_exit'
  | 'location_shared'
  | 'quiet_blocked'
  | 'meeting_point';

export type FamilyAlert = {
  id: string;
  kind: FamilyAlertKind;
  memberId: string;
  label: string;
  at: string;
  position: LatLng | null;
};

/** New invite codes are 10 Crockford characters. The join field caps at this. */
export const FAMILY_INVITE_CODE_LEN = 10;
/**
 * Codes issued before the Crockford migration. The current create_oki_family
 * RPC still requires and stores exactly this length.
 */
export const LEGACY_INVITE_CODE_LEN = 6;

/** Crockford base32: 0-9 and A-Z without I, L, O, U. */
const CROCKFORD_CODE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/;
const LEGACY_CODE = /^[A-Z0-9]{6}$/;
export const DEFAULT_ZONE_RADIUS_M = 150;
export const DEFAULT_LINE_ALERT_M = 40;
export const MIN_ZONE_RADIUS_M = 50;
export const MAX_ZONE_RADIUS_M = 5_000;

/** Point-in-circle geofence check. */
export function isInsideZone(position: LatLng, zone: FamilyZone): boolean {
  return distanceMeters(position, zone.center) <= zone.radiusM;
}

/** True if any force-audio zone contains the position. */
export function isInForceAudioZone(
  position: LatLng | null,
  zones: FamilyZone[],
): boolean {
  if (!position) return false;
  return zones.some((z) => z.forceAudio && isInsideZone(position, z));
}

/**
 * Quiet (mute incoming PTT) is allowed only when the member prefers quiet
 * AND they are not inside a force-audio zone.
 */
export function canUseQuietMode(
  quietPreferred: boolean,
  position: LatLng | null,
  zones: FamilyZone[],
): boolean {
  if (!quietPreferred) return false;
  return !isInForceAudioZone(position, zones);
}

/** Effective listen state for incoming family PTT. */
export function shouldPlayIncomingPtt(
  quietPreferred: boolean,
  position: LatLng | null,
  zones: FamilyZone[],
): boolean {
  return !canUseQuietMode(quietPreferred, position, zones);
}

/**
 * Signed side of point relative to directed segment A→B.
 * Uses lng as X, lat as Y (local planar approx — fine for short family lines).
 * Returns -1 | 0 | 1.
 */
export function sideOfLine(point: LatLng, a: LatLng, b: LatLng): -1 | 0 | 1 {
  const cross =
    (b.lng - a.lng) * (point.lat - a.lat) - (b.lat - a.lat) * (point.lng - a.lng);
  if (cross > 0) return 1;
  if (cross < 0) return -1;
  return 0;
}

export function distanceToSegmentMeters(
  point: LatLng,
  a: LatLng,
  b: LatLng,
): number {
  const closest = closestPointOnSegment(point, a, b);
  return distanceMeters(point, closest);
}

export type BoundaryCrossResult = {
  crossed: boolean;
  nearLine: boolean;
  distanceM: number;
  fromSide: -1 | 0 | 1;
  toSide: -1 | 0 | 1;
};

/**
 * Detect crossing of a boundary line between two consecutive positions.
 * Requires a real side flip (±) and proximity to the segment on the new point
 * (avoids false positives when far away on the other side of a long line).
 */
export function detectBoundaryCross(
  prev: LatLng | null,
  next: LatLng,
  line: FamilyBoundaryLine,
): BoundaryCrossResult {
  const distanceM = distanceToSegmentMeters(next, line.a, line.b);
  const nearLine = distanceM <= line.alertWithinM;
  if (!prev) {
    return {
      crossed: false,
      nearLine,
      distanceM,
      fromSide: 0,
      toSide: sideOfLine(next, line.a, line.b),
    };
  }
  const fromSide = sideOfLine(prev, line.a, line.b);
  const toSide = sideOfLine(next, line.a, line.b);
  const crossed =
    fromSide !== 0 &&
    toSide !== 0 &&
    fromSide !== toSide &&
    nearLine;
  return { crossed, nearLine, distanceM, fromSide, toSide };
}

export type ZoneTransition = {
  entered: FamilyZone[];
  exited: FamilyZone[];
};

export function detectZoneTransitions(
  prev: LatLng | null,
  next: LatLng,
  zones: FamilyZone[],
): ZoneTransition {
  const entered: FamilyZone[] = [];
  const exited: FamilyZone[] = [];
  for (const zone of zones) {
    const wasInside = prev ? isInsideZone(prev, zone) : false;
    const nowInside = isInsideZone(next, zone);
    if (!wasInside && nowInside) entered.push(zone);
    if (wasInside && !nowInside) exited.push(zone);
  }
  return { entered, exited };
}

/** Ray-casting point-in-polygon (lng=X, lat=Y). Ring need not repeat first point. */
export function isInsideCompound(
  position: LatLng,
  compound: FamilyCompound,
): boolean {
  const ring = compound.ring;
  if (ring.length < MIN_COMPOUND_POINTS) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.lng;
    const yi = ring[i]!.lat;
    const xj = ring[j]!.lng;
    const yj = ring[j]!.lat;
    const intersect =
      yi > position.lat !== yj > position.lat &&
      position.lng <
        ((xj - xi) * (position.lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export type CompoundTransition = {
  entered: FamilyCompound[];
  exited: FamilyCompound[];
};

export function detectCompoundTransitions(
  prev: LatLng | null,
  next: LatLng,
  compounds: FamilyCompound[],
): CompoundTransition {
  const entered: FamilyCompound[] = [];
  const exited: FamilyCompound[] = [];
  for (const c of compounds) {
    const wasInside = prev ? isInsideCompound(prev, c) : false;
    const nowInside = isInsideCompound(next, c);
    if (!wasInside && nowInside) entered.push(c);
    if (wasInside && !nowInside) exited.push(c);
  }
  return { entered, exited };
}

export function isValidCompoundRing(ring: LatLng[]): boolean {
  return ring.length >= MIN_COMPOUND_POINTS;
}

/**
 * Uppercase, then strip spaces and hyphens. Does not truncate.
 * Crockford look-alike mapping (O→0, I and L→1) runs only when the stripped
 * value is 10 characters. A 6-character legacy code is returned unchanged,
 * so O, I, and L stay significant.
 */
export function normalizeInviteCode(raw: string): string {
  const stripped = raw.toUpperCase().replace(/[\s-]/g, '');
  if (stripped.length !== FAMILY_INVITE_CODE_LEN) return stripped;
  return stripped.replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function isValidInviteCode(code: string): boolean {
  const normalized = normalizeInviteCode(code);
  if (normalized.length === LEGACY_INVITE_CODE_LEN) {
    return LEGACY_CODE.test(normalized);
  }
  if (normalized.length === FAMILY_INVITE_CODE_LEN) {
    return CROCKFORD_CODE.test(normalized);
  }
  return false;
}

/**
 * Six-character code for the pre-migration create_oki_family argument and for
 * the offline demo. The current RPC rejects any other length and stores this
 * value. Callers that have a server row display families.invite_code instead.
 */
export function generateInviteCode(random = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < LEGACY_INVITE_CODE_LEN; i += 1) {
    out += alphabet[Math.floor(random() * alphabet.length)] ?? 'A';
  }
  return out;
}

export function clampZoneRadiusM(radiusM: number): number {
  if (!Number.isFinite(radiusM)) return DEFAULT_ZONE_RADIUS_M;
  return Math.min(
    MAX_ZONE_RADIUS_M,
    Math.max(MIN_ZONE_RADIUS_M, Math.round(radiusM)),
  );
}

export function isFamilyAdmin(role: FamilyRole): boolean {
  return role === 'admin';
}

/**
 * Permissions required before joining the live family channel.
 * Mic is required for PTT; location for zones/quiet enforcement; notifications optional.
 */
export function requiredPermissionsForFamily(): FamilyPermissionKind[] {
  return ['microphone', 'geolocation'];
}

export function hasRequiredPermissions(
  statuses: Partial<Record<FamilyPermissionKind, FamilyPermissionStatus>>,
): boolean {
  return requiredPermissionsForFamily().every((k) => statuses[k] === 'granted');
}
