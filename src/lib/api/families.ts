import {
  generateInviteCode,
  isValidInviteCode,
  LEGACY_INVITE_CODE_LEN,
  normalizeInviteCode,
  type FamilyAlertKind,
  type FamilyRole,
  type LatLng,
} from '../domain';
import type { OkiClient } from './client';

export type CloudFamilyRow = {
  id: string;
  name: string;
  invite_code: string;
  livekit_room: string | null;
  created_by: string;
  created_at: string;
};

export type CloudFamilyMemberRow = {
  family_id: string;
  user_id: string;
  role: FamilyRole;
  display_name: string;
  quiet_preferred: boolean;
  last_lat: number | null;
  last_lng: number | null;
  last_seen_at: string | null;
  joined_at: string;
};

export type CloudFamilyZoneRow = {
  id: string;
  family_id: string;
  name: string;
  radius_m: number;
  force_audio: boolean;
  created_by: string;
  /** GeoJSON or WKT depending on PostgREST; we request lat/lng via RPC-free parse. */
  center: unknown;
};

export type CloudFamilySnapshot = {
  family: CloudFamilyRow;
  members: CloudFamilyMemberRow[];
  zones: Array<{
    id: string;
    name: string;
    center: LatLng;
    radiusM: number;
    forceAudio: boolean;
  }>;
  lines: Array<{
    id: string;
    name: string;
    a: LatLng;
    b: LatLng;
    alertWithinM: number;
  }>;
  compounds: Array<{
    id: string;
    name: string;
    ring: LatLng[];
    createdBy: string;
  }>;
  meetingPoints: Array<{
    id: string;
    name: string;
    position: LatLng;
    createdBy: string;
  }>;
  locationRequests: Array<{
    id: string;
    fromAdminId: string;
    toMemberId: string;
    status: 'pending' | 'shared' | 'denied' | 'expired';
    createdAt: string;
  }>;
  alerts: Array<{
    id: string;
    kind: FamilyAlertKind;
    memberId: string;
    label: string;
    at: string;
    position: LatLng | null;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Parse PostGIS/GeoJSON point-ish payloads into LatLng. */
export function parseGeoPoint(value: unknown): LatLng | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const wkt = value.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (wkt?.[1] && wkt[2]) {
      return { lng: Number(wkt[1]), lat: Number(wkt[2]) };
    }
    // EWKT: SRID=4326;POINT(lng lat)
    const ewkt = value.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (ewkt?.[1] && ewkt[2]) {
      return { lng: Number(ewkt[1]), lat: Number(ewkt[2]) };
    }
    return null;
  }
  const row = asRecord(value);
  if (!row) return null;
  if (typeof row.lat === 'number' && typeof row.lng === 'number') {
    return { lat: row.lat, lng: row.lng };
  }
  if (typeof row.coordinates === 'object' && Array.isArray(row.coordinates)) {
    const [lng, lat] = row.coordinates as unknown[];
    if (typeof lat === 'number' && typeof lng === 'number') {
      return { lat, lng };
    }
  }
  return null;
}

/** Parse LineString with ≥2 positions into endpoints (first/last). */
export function parseGeoLineEndpoints(
  value: unknown,
): { a: LatLng; b: LatLng } | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const nums = [...value.matchAll(/([-\d.]+)\s+([-\d.]+)/g)].map((m) => ({
      lng: Number(m[1]),
      lat: Number(m[2]),
    }));
    if (nums.length >= 2) {
      const a = nums[0]!;
      const b = nums[nums.length - 1]!;
      return { a, b };
    }
    return null;
  }
  const row = asRecord(value);
  if (!row || !Array.isArray(row.coordinates)) return null;
  const coords = row.coordinates as unknown[];
  if (coords.length < 2) return null;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (!Array.isArray(first) || !Array.isArray(last)) return null;
  const aLng = first[0];
  const aLat = first[1];
  const bLng = last[0];
  const bLat = last[1];
  if (
    typeof aLat !== 'number' ||
    typeof aLng !== 'number' ||
    typeof bLat !== 'number' ||
    typeof bLng !== 'number'
  ) {
    return null;
  }
  return { a: { lat: aLat, lng: aLng }, b: { lat: bLat, lng: bLng } };
}

export function pointWkt(p: LatLng): string {
  return `SRID=4326;POINT(${p.lng} ${p.lat})`;
}

export function lineWkt(a: LatLng, b: LatLng): string {
  return `SRID=4326;LINESTRING(${a.lng} ${a.lat},${b.lng} ${b.lat})`;
}

/** Closed polygon WKT — ring is closed automatically (last→first). */
export function polygonWkt(ring: LatLng[]): string {
  const closed =
    ring.length > 0 &&
    ring[0]!.lat === ring[ring.length - 1]!.lat &&
    ring[0]!.lng === ring[ring.length - 1]!.lng
      ? ring
      : [...ring, ring[0]!];
  const body = closed.map((p) => `${p.lng} ${p.lat}`).join(',');
  return `SRID=4326;POLYGON((${body}))`;
}

/** Parse Polygon outer ring into LatLng[] (without repeating closing vertex). */
export function parseGeoPolygonRing(value: unknown): LatLng[] | null {
  if (!value) return null;
  let coords: LatLng[] = [];
  if (typeof value === 'string') {
    const nums = [...value.matchAll(/([-\d.]+)\s+([-\d.]+)/g)].map((m) => ({
      lng: Number(m[1]),
      lat: Number(m[2]),
    }));
    coords = nums.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  } else {
    const row = asRecord(value);
    const coordinates = row?.coordinates;
    if (Array.isArray(coordinates) && Array.isArray(coordinates[0])) {
      const outer = coordinates[0] as unknown[];
      for (const pt of outer) {
        if (!Array.isArray(pt) || pt.length < 2) continue;
        const lng = pt[0];
        const lat = pt[1];
        if (typeof lat === 'number' && typeof lng === 'number') {
          coords.push({ lat, lng });
        }
      }
    }
  }
  if (coords.length < 3) return null;
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;
  if (first.lat === last.lat && first.lng === last.lng) {
    coords = coords.slice(0, -1);
  }
  return coords.length >= 3 ? coords : null;
}

export async function createCloudFamily(
  client: OkiClient,
  input: { name: string; displayName: string; inviteCode?: string },
): Promise<string> {
  // create_oki_family still requires a unique 6-character p_invite_code and
  // stores it. A constant placeholder collides (families.invite_code is unique)
  // and a 10-character value is rejected until TrailLink #226. The screen shows
  // the snapshot's families.invite_code, not this argument.
  const code = normalizeInviteCode(input.inviteCode ?? generateInviteCode());
  if (!isValidInviteCode(code) || code.length !== LEGACY_INVITE_CODE_LEN) {
    throw new Error('invalid_invite_code');
  }
  const { data, error } = await client.rpc('create_oki_family', {
    p_name: input.name,
    p_display_name: input.displayName,
    p_invite_code: code,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('create_oki_family_bad_result');
  return data;
}

export async function joinCloudFamily(
  client: OkiClient,
  input: { inviteCode: string; displayName: string },
): Promise<string> {
  const code = normalizeInviteCode(input.inviteCode);
  if (!isValidInviteCode(code)) {
    throw new Error('invalid_invite_code');
  }
  const { data, error } = await client.rpc('join_oki_family', {
    p_invite_code: code,
    p_display_name: input.displayName,
  });
  if (error) throw error;
  if (typeof data !== 'string') throw new Error('join_oki_family_bad_result');
  return data;
}

export async function fetchMyCloudFamilyId(
  client: OkiClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('family_members')
    .select('family_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.family_id ?? null;
}

export async function fetchCloudFamilySnapshot(
  client: OkiClient,
  familyId: string,
): Promise<CloudFamilySnapshot> {
  const [
    familyRes,
    membersRes,
    zonesRes,
    linesRes,
    compoundsRes,
    meetingsRes,
    reqRes,
    alertsRes,
  ] = await Promise.all([
    client.from('families').select('*').eq('id', familyId).single(),
    client.from('family_members').select('*').eq('family_id', familyId),
    client.from('family_zones').select('*').eq('family_id', familyId),
    client.from('family_boundary_lines').select('*').eq('family_id', familyId),
    client.from('family_compounds').select('*').eq('family_id', familyId),
    client.from('family_meeting_points').select('*').eq('family_id', familyId),
    client
      .from('family_location_requests')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: false }),
    client
      .from('family_alerts')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (familyRes.error) throw familyRes.error;
  if (membersRes.error) throw membersRes.error;
  if (zonesRes.error) throw zonesRes.error;
  // Lines / compounds / meetings may 404 before migration — treat as empty
  if (linesRes.error && !/does not exist|permission|42501|PGRST/i.test(linesRes.error.message)) {
    throw linesRes.error;
  }
  if (
    compoundsRes.error &&
    !/does not exist|permission|42501|PGRST|42P01/i.test(compoundsRes.error.message)
  ) {
    throw compoundsRes.error;
  }
  if (
    meetingsRes.error &&
    !/does not exist|permission|42501|PGRST|42P01/i.test(meetingsRes.error.message)
  ) {
    throw meetingsRes.error;
  }
  if (reqRes.error) throw reqRes.error;
  if (alertsRes.error) throw alertsRes.error;

  const family = familyRes.data as CloudFamilyRow;
  const members = (membersRes.data ?? []) as CloudFamilyMemberRow[];

  const zones = (zonesRes.data ?? [])
    .map((z) => {
      const center = parseGeoPoint(z.center);
      if (!center) return null;
      return {
        id: z.id as string,
        name: z.name as string,
        center,
        radiusM: z.radius_m as number,
        forceAudio: Boolean(z.force_audio),
      };
    })
    .filter((z): z is NonNullable<typeof z> => z != null);

  const lines = ((linesRes.data ?? []) as unknown[])
    .map((l) => {
      const row = l as Record<string, unknown>;
      const ends = parseGeoLineEndpoints(row.geom);
      if (!ends) return null;
      return {
        id: row.id as string,
        name: row.name as string,
        a: ends.a,
        b: ends.b,
        alertWithinM: row.alert_within_m as number,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l != null);

  const compounds = ((compoundsRes.data ?? []) as unknown[])
    .map((c) => {
      const row = c as Record<string, unknown>;
      const ring = parseGeoPolygonRing(row.geom);
      if (!ring) return null;
      return {
        id: row.id as string,
        name: row.name as string,
        ring,
        createdBy: row.created_by as string,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c != null);

  const meetingPoints = ((meetingsRes.data ?? []) as unknown[])
    .map((m) => {
      const row = m as Record<string, unknown>;
      const position = parseGeoPoint(row.geom);
      if (!position) return null;
      return {
        id: row.id as string,
        name: row.name as string,
        position,
        createdBy: row.created_by as string,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m != null);

  const locationRequests = (reqRes.data ?? []).map((r) => ({
    id: r.id as string,
    fromAdminId: r.from_admin_id as string,
    toMemberId: r.to_member_id as string,
    status: r.status as 'pending' | 'shared' | 'denied' | 'expired',
    createdAt: r.created_at as string,
  }));

  const alerts = (alertsRes.data ?? []).map((a) => ({
    id: a.id as string,
    kind: a.kind as FamilyAlertKind,
    memberId: a.member_id as string,
    label: a.label as string,
    at: a.created_at as string,
    position: parseGeoPoint(a.geom),
  }));

  return {
    family,
    members,
    zones,
    lines,
    compounds,
    meetingPoints,
    locationRequests,
    alerts,
  };
}

export async function leaveCloudFamily(
  client: OkiClient,
  input: { familyId: string; userId: string },
): Promise<void> {
  const { error } = await client
    .from('family_members')
    .delete()
    .eq('family_id', input.familyId)
    .eq('user_id', input.userId);
  if (error) throw error;
}

export async function setCloudQuietPreferred(
  client: OkiClient,
  input: { familyId: string; userId: string; quiet: boolean },
): Promise<void> {
  const { error } = await client
    .from('family_members')
    .update({ quiet_preferred: input.quiet })
    .eq('family_id', input.familyId)
    .eq('user_id', input.userId);
  if (error) throw error;
}

export async function setCloudMemberDisplayName(
  client: OkiClient,
  input: { familyId: string; userId: string; displayName: string },
): Promise<void> {
  const name = input.displayName.trim() || 'בן משפחה';
  const { error } = await client
    .from('family_members')
    .update({ display_name: name })
    .eq('family_id', input.familyId)
    .eq('user_id', input.userId);
  if (error) throw error;
}

export async function addCloudZone(
  client: OkiClient,
  input: {
    familyId: string;
    createdBy: string;
    name: string;
    center: LatLng;
    radiusM: number;
    forceAudio: boolean;
  },
): Promise<string> {
  const { data, error } = await client
    .from('family_zones')
    .insert({
      family_id: input.familyId,
      name: input.name,
      center: pointWkt(input.center),
      radius_m: input.radiusM,
      force_audio: input.forceAudio,
      created_by: input.createdBy,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function removeCloudZone(
  client: OkiClient,
  zoneId: string,
): Promise<void> {
  const { error } = await client.from('family_zones').delete().eq('id', zoneId);
  if (error) throw error;
}

export async function addCloudBoundaryLine(
  client: OkiClient,
  input: {
    familyId: string;
    createdBy: string;
    name: string;
    a: LatLng;
    b: LatLng;
    alertWithinM: number;
  },
): Promise<string> {
  const { data, error } = await client
    .from('family_boundary_lines')
    .insert({
      family_id: input.familyId,
      name: input.name,
      geom: lineWkt(input.a, input.b),
      alert_within_m: input.alertWithinM,
      created_by: input.createdBy,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function removeCloudBoundaryLine(
  client: OkiClient,
  lineId: string,
): Promise<void> {
  const { error } = await client
    .from('family_boundary_lines')
    .delete()
    .eq('id', lineId);
  if (error) throw error;
}

export async function addCloudCompound(
  client: OkiClient,
  input: {
    familyId: string;
    createdBy: string;
    name: string;
    ring: LatLng[];
  },
): Promise<string> {
  const { data, error } = await client
    .from('family_compounds')
    .insert({
      family_id: input.familyId,
      name: input.name,
      geom: polygonWkt(input.ring),
      created_by: input.createdBy,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function removeCloudCompound(
  client: OkiClient,
  compoundId: string,
): Promise<void> {
  const { error } = await client
    .from('family_compounds')
    .delete()
    .eq('id', compoundId);
  if (error) throw error;
}

export async function addCloudMeetingPoint(
  client: OkiClient,
  input: {
    familyId: string;
    createdBy: string;
    name: string;
    position: LatLng;
  },
): Promise<string> {
  const { data, error } = await client
    .from('family_meeting_points')
    .insert({
      family_id: input.familyId,
      name: input.name,
      geom: pointWkt(input.position),
      created_by: input.createdBy,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function removeCloudMeetingPoint(
  client: OkiClient,
  meetingPointId: string,
): Promise<void> {
  const { error } = await client
    .from('family_meeting_points')
    .delete()
    .eq('id', meetingPointId);
  if (error) throw error;
}

export async function createCloudLocationRequest(
  client: OkiClient,
  input: { familyId: string; fromAdminId: string; toMemberId: string },
): Promise<string> {
  const { data, error } = await client
    .from('family_location_requests')
    .insert({
      family_id: input.familyId,
      from_admin_id: input.fromAdminId,
      to_member_id: input.toMemberId,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function respondCloudLocationRequest(
  client: OkiClient,
  input: {
    requestId: string;
    familyId: string;
    userId: string;
    accept: boolean;
    position: LatLng | null;
  },
): Promise<void> {
  const { error } = await client
    .from('family_location_requests')
    .update({
      status: input.accept ? 'shared' : 'denied',
      resolved_at: new Date().toISOString(),
    })
    .eq('id', input.requestId);
  if (error) throw error;

  if (input.accept && input.position) {
    const { error: memErr } = await client
      .from('family_members')
      .update({
        last_lat: input.position.lat,
        last_lng: input.position.lng,
        last_seen_at: new Date().toISOString(),
      })
      .eq('family_id', input.familyId)
      .eq('user_id', input.userId);
    if (memErr) throw memErr;
  }
}

export async function insertCloudFamilyAlert(
  client: OkiClient,
  input: {
    familyId: string;
    memberId: string;
    kind: FamilyAlertKind;
    label: string;
    position: LatLng | null;
  },
): Promise<void> {
  const { error } = await client.from('family_alerts').insert({
    family_id: input.familyId,
    kind: input.kind,
    member_id: input.memberId,
    label: input.label,
    geom: input.position ? pointWkt(input.position) : null,
  });
  if (error) throw error;
}
