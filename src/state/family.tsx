import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  PTT_MAX_DURATION_MS,
  canUseQuietMode,
  clampZoneRadiusM,
  detectBoundaryCross,
  detectCompoundTransitions,
  detectZoneTransitions,
  generateInviteCode,
  hasRequiredPermissions,
  isFamilyAdmin,
  isInForceAudioZone,
  isInsideZone,
  isValidCompoundRing,
  prepareJoinCode,
  shouldPlayIncomingPtt,
  type FamilyAlert,
  type FamilyBoundaryLine,
  type FamilyCompound,
  type FamilyLocationRequest,
  type FamilyMeetingPoint,
  type FamilyPermissionKind,
  type FamilyPermissionStatus,
  type FamilyRole,
  type FamilyZone,
  type LatLng,
} from '@oki/domain';
import {
  addCloudBoundaryLine,
  addCloudCompound,
  addCloudMeetingPoint,
  addCloudZone,
  createCloudFamily,
  createCloudLocationRequest,
  fetchCloudFamilySnapshot,
  fetchFamilyLiveKitToken,
  fetchMyCloudFamilyId,
  insertCloudFamilyAlert,
  joinCloudFamily,
  joinFailureReason,
  leaveCloudFamily,
  leaveUiPlan,
  rotateCloudInviteCode,
  shouldUseOfflineFamily,
  type JoinFamilyResult,
  removeCloudBoundaryLine,
  removeCloudCompound,
  removeCloudMeetingPoint,
  removeCloudZone,
  respondCloudLocationRequest,
  setCloudQuietPreferred,
  setCloudMemberDisplayName,
  type CloudFamilySnapshot,
} from '@oki/api';
import { playPttAutoTone, TripLiveSession } from '@oki/live';
import { useAuth } from './auth';

const STORAGE_KEY = 'oki.family.v1';

/** Common typo of placeholder «אבא» — normalize on load. */
function normalizeDisplayName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === 'אבר') return 'אבא';
  return trimmed;
}
const BC_NAME = 'oki-family-walkie';

export type FamilyMemberLocal = {
  id: string;
  displayName: string;
  role: FamilyRole;
  quietPreferred: boolean;
  /** Self GPS for quiet/zones — not broadcast to admins until share. */
  position: LatLng | null;
  /** Last location explicitly shared with admins (opt-in). */
  sharedPosition: LatLng | null;
  lastSeenAt: string | null;
};

export type FamilyGroupLocal = {
  id: string;
  name: string;
  inviteCode: string;
  livekitRoom: string;
  members: FamilyMemberLocal[];
  zones: FamilyZone[];
  lines: FamilyBoundaryLine[];
  /** Closed enclosures — parent-only visibility. */
  compounds: FamilyCompound[];
  /** Manual meetup pins — visible to all members. */
  meetingPoints: FamilyMeetingPoint[];
  locationRequests: FamilyLocationRequest[];
  alerts: FamilyAlert[];
};

type PermissionMap = Record<FamilyPermissionKind, FamilyPermissionStatus>;
export type PttMode = 'live' | 'demo';

type StoredState = {
  family: FamilyGroupLocal | null;
  selfId: string;
  permissions: PermissionMap;
};

export type RemoteSpeaker = {
  id: string;
  name: string;
};

type FamilyContextValue = {
  family: FamilyGroupLocal | null;
  self: FamilyMemberLocal | null;
  isAdmin: boolean;
  permissions: PermissionMap;
  permissionsReady: boolean;
  quietPreferred: boolean;
  quietEffective: boolean;
  forceAudioActive: boolean;
  forceAudioZoneName: string | null;
  pttActive: boolean;
  pttMode: PttMode;
  pttConnected: boolean;
  remoteSpeaker: RemoteSpeaker | null;
  position: LatLng | null;
  alerts: FamilyAlert[];
  cloudSync: boolean;
  cloudError: string | null;
  requestPermissions: () => Promise<boolean>;
  createFamily: (name: string, displayName: string) => Promise<void>;
  joinFamily: (code: string, displayName: string) => Promise<JoinFamilyResult>;
  leaveFamily: () => Promise<void>;
  rotateInviteCode: () => Promise<void>;
  setQuietPreferred: (value: boolean) => void;
  startPtt: () => Promise<void>;
  stopPtt: () => Promise<void>;
  togglePtt: () => Promise<void>;
  refreshSelfGps: () => Promise<LatLng | null>;
  addZone: (input: {
    name: string;
    center: LatLng;
    radiusM: number;
    forceAudio: boolean;
  }) => Promise<void>;
  removeZone: (zoneId: string) => Promise<void>;
  addBoundaryLine: (input: {
    name: string;
    a: LatLng;
    b: LatLng;
    alertWithinM: number;
  }) => Promise<void>;
  removeBoundaryLine: (lineId: string) => Promise<void>;
  addCompound: (input: { name: string; ring: LatLng[] }) => Promise<void>;
  removeCompound: (compoundId: string) => Promise<void>;
  addMeetingPoint: (input: { name: string; position: LatLng }) => Promise<void>;
  removeMeetingPoint: (meetingPointId: string) => Promise<void>;
  requestMemberLocation: (memberId: string) => Promise<void>;
  respondLocationRequest: (requestId: string, accept: boolean) => Promise<void>;
  renameSelf: (displayName: string) => Promise<void>;
};

const FamilyContext = createContext<FamilyContextValue | null>(null);

const DEFAULT_PERMISSIONS: PermissionMap = {
  microphone: 'unknown',
  geolocation: 'unknown',
  notifications: 'unknown',
};

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function snapshotToLocal(
  snap: CloudFamilySnapshot,
  selfUserId: string,
  prevSelfPos: LatLng | null,
): FamilyGroupLocal {
  return {
    id: snap.family.id,
    name: snap.family.name,
    inviteCode: snap.family.invite_code,
    livekitRoom:
      snap.family.livekit_room ?? `family_${snap.family.invite_code}`,
    members: snap.members.map((m) => {
      const shared =
        m.last_lat != null && m.last_lng != null
          ? { lat: m.last_lat, lng: m.last_lng }
          : null;
      const isSelf = m.user_id === selfUserId;
      return {
        id: m.user_id,
        displayName: normalizeDisplayName(m.display_name),
        role: m.role,
        quietPreferred: m.quiet_preferred,
        position: isSelf ? prevSelfPos : null,
        sharedPosition: shared,
        lastSeenAt: m.last_seen_at,
      };
    }),
    zones: snap.zones.map((z) => ({
      id: z.id,
      name: z.name,
      center: z.center,
      radiusM: z.radiusM,
      forceAudio: z.forceAudio,
    })),
    lines: snap.lines.map((l) => ({
      id: l.id,
      name: l.name,
      a: l.a,
      b: l.b,
      alertWithinM: l.alertWithinM,
    })),
    compounds: (snap.compounds ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      ring: c.ring,
      createdBy: c.createdBy,
    })),
    meetingPoints: (snap.meetingPoints ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      position: m.position,
      createdBy: m.createdBy,
    })),
    locationRequests: snap.locationRequests.map((r) => ({
      id: r.id,
      fromAdminId: r.fromAdminId,
      toMemberId: r.toMemberId,
      status: r.status,
      createdAt: r.createdAt,
    })),
    alerts: snap.alerts.map((a) => ({
      id: a.id,
      kind: a.kind,
      memberId: a.memberId,
      label: a.label,
      at: a.at,
      position: a.position,
    })),
  };
}

function loadStored(selfFallbackId: string): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        family: null,
        selfId: selfFallbackId,
        permissions: { ...DEFAULT_PERMISSIONS },
      };
    }
    const parsed = JSON.parse(raw) as StoredState;
    return {
      family: parsed.family
        ? {
            ...parsed.family,
            livekitRoom:
              parsed.family.livekitRoom ??
              `family_${parsed.family.inviteCode}`,
            members: parsed.family.members.map((m) => ({
              ...m,
              displayName: normalizeDisplayName(m.displayName || ''),
              sharedPosition: m.sharedPosition ?? null,
            })),
            compounds: parsed.family.compounds ?? [],
            meetingPoints: parsed.family.meetingPoints ?? [],
          }
        : null,
      selfId: parsed.selfId || selfFallbackId,
      permissions: { ...DEFAULT_PERMISSIONS, ...parsed.permissions },
    };
  } catch {
    return {
      family: null,
      selfId: selfFallbackId,
      permissions: { ...DEFAULT_PERMISSIONS },
    };
  }
}

function saveStored(state: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { client, session } = useAuth();
  const selfFallbackId = session?.user?.id ?? 'local_self';
  const initial = useMemo(() => loadStored(selfFallbackId), [selfFallbackId]);

  const [family, setFamily] = useState<FamilyGroupLocal | null>(initial.family);
  const [selfId, setSelfId] = useState(initial.selfId);
  const [permissions, setPermissions] = useState<PermissionMap>(
    initial.permissions,
  );
  const [pttActive, setPttActive] = useState(false);
  const [pttMode, setPttMode] = useState<PttMode>('demo');
  const [pttConnected, setPttConnected] = useState(false);
  const [remoteSpeaker, setRemoteSpeaker] = useState<RemoteSpeaker | null>(
    null,
  );
  const [cloudError, setCloudError] = useState<string | null>(null);

  const pttTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPosRef = useRef<LatLng | null>(null);
  /** Admin-side: last known shared GPS per member for compound enter/exit. */
  const prevSharedPosRef = useRef<Record<string, LatLng>>({});
  const liveRef = useRef<TripLiveSession | null>(null);
  const familyRef = useRef(family);
  familyRef.current = family;
  const selfIdRef = useRef(selfId);
  selfIdRef.current = selfId;
  const pttLiveRef = useRef(false);
  const pttBusyRef = useRef(false);

  useEffect(() => {
    saveStored({ family, selfId, permissions });
  }, [family, selfId, permissions]);

  const self = useMemo(
    () => family?.members.find((m) => m.id === selfId) ?? null,
    [family, selfId],
  );
  const isAdmin = self ? isFamilyAdmin(self.role) : false;
  const quietPreferred = self?.quietPreferred ?? false;
  const position = self?.position ?? null;
  const zones = family?.zones ?? [];
  const quietEffective = canUseQuietMode(quietPreferred, position, zones);
  const forceAudioActive = quietPreferred && !quietEffective;
  const forceAudioZoneName = useMemo(() => {
    if (!position || !isInForceAudioZone(position, zones)) return null;
    return (
      zones.find((z) => z.forceAudio && isInsideZone(position, z))?.name ??
      null
    );
  }, [position, zones]);

  const updateSelf = useCallback((patch: Partial<FamilyMemberLocal>) => {
    setFamily((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        members: prev.members.map((m) =>
          m.id === selfIdRef.current ? { ...m, ...patch } : m,
        ),
      };
    });
  }, []);

  const pushAlert = useCallback(
    (alert: Omit<FamilyAlert, 'id' | 'at'>) => {
      setFamily((prev) => {
        if (!prev) return prev;
        const next: FamilyAlert = {
          ...alert,
          id: uid('alert'),
          at: new Date().toISOString(),
        };
        return { ...prev, alerts: [next, ...prev.alerts].slice(0, 50) };
      });
      const current = familyRef.current;
      if (client && current && isUuid(current.id) && session?.user?.id) {
        void insertCloudFamilyAlert(client, {
          familyId: current.id,
          memberId: session.user.id,
          kind: alert.kind,
          label: alert.label,
          position: alert.position,
        }).catch((err) => console.warn('[Oki] alert sync failed', err));
      }
    },
    [client, session?.user?.id],
  );

  const evaluateGeoRules = useCallback(
    (prev: LatLng | null, next: LatLng) => {
      const current = familyRef.current;
      if (!current) return;
      const memberId = selfIdRef.current;
      const memberName =
        current.members.find((m) => m.id === memberId)?.displayName ?? memberId;

      for (const line of current.lines) {
        const cross = detectBoundaryCross(prev, next, line);
        if (cross.crossed) {
          pushAlert({
            kind: 'boundary_crossed',
            memberId,
            label: `${memberName} · ${line.name}`,
            position: next,
          });
        }
      }

      const transitions = detectZoneTransitions(prev, next, current.zones);
      for (const z of transitions.entered) {
        pushAlert({
          kind: 'zone_enter',
          memberId,
          label: `${memberName} · ${z.name}`,
          position: next,
        });
      }
      for (const z of transitions.exited) {
        pushAlert({
          kind: 'zone_exit',
          memberId,
          label: `${memberName} · ${z.name}`,
          position: next,
        });
      }

      const compoundTx = detectCompoundTransitions(
        prev,
        next,
        current.compounds ?? [],
      );
      for (const c of compoundTx.entered) {
        pushAlert({
          kind: 'boundary_crossed',
          memberId,
          label: `${memberName} · נכנס/ה למתחם ${c.name}`,
          position: next,
        });
      }
      for (const c of compoundTx.exited) {
        pushAlert({
          kind: 'boundary_crossed',
          memberId,
          label: `${memberName} · יצא/ה ממתחם ${c.name}`,
          position: next,
        });
      }
    },
    [pushAlert],
  );

  /** GPS for quiet/boundary only — never auto-shared with admins (decision 3A). */
  const refreshSelfGps = useCallback(async (): Promise<LatLng | null> => {
    if (!('geolocation' in navigator)) {
      setPermissions((p) => ({ ...p, geolocation: 'denied' }));
      return null;
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next: LatLng = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          const prev = prevPosRef.current;
          prevPosRef.current = next;
          setPermissions((p) => ({ ...p, geolocation: 'granted' }));
          updateSelf({
            position: next,
            lastSeenAt: new Date().toISOString(),
          });
          evaluateGeoRules(prev, next);
          resolve(next);
        },
        () => {
          setPermissions((p) => ({ ...p, geolocation: 'denied' }));
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 5_000 },
      );
    });
  }, [evaluateGeoRules, updateSelf]);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    const next: PermissionMap = { ...DEFAULT_PERMISSIONS };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      next.microphone = 'granted';
    } catch {
      next.microphone = 'denied';
    }

    if ('geolocation' in navigator) {
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            next.geolocation = 'granted';
            const coords: LatLng = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            };
            prevPosRef.current = coords;
            updateSelf({
              position: coords,
              lastSeenAt: new Date().toISOString(),
            });
            resolve();
          },
          () => {
            next.geolocation = 'denied';
            resolve();
          },
          { enableHighAccuracy: true, timeout: 12_000 },
        );
      });
    } else {
      next.geolocation = 'denied';
    }

    if ('Notification' in window) {
      try {
        const result = await Notification.requestPermission();
        next.notifications =
          result === 'granted'
            ? 'granted'
            : result === 'denied'
              ? 'denied'
              : 'prompt';
      } catch {
        next.notifications = 'denied';
      }
    }

    setPermissions(next);
    return hasRequiredPermissions(next);
  }, [updateSelf]);

  // Local GPS watch for geofence/quiet — positions stay on-device until share.
  useEffect(() => {
    if (!family || permissions.geolocation !== 'granted') return;
    if (!('geolocation' in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const next: LatLng = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        const prev = prevPosRef.current;
        prevPosRef.current = next;
        updateSelf({
          position: next,
          lastSeenAt: new Date().toISOString(),
        });
        evaluateGeoRules(prev, next);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [family, permissions.geolocation, evaluateGeoRules, updateSelf]);

  // Demo cross-tab PTT when LiveKit unavailable
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel(BC_NAME);
    bc.onmessage = (ev: MessageEvent) => {
      const data = ev.data as {
        type?: string;
        familyId?: string;
        fromId?: string;
        fromName?: string;
      };
      if (
        data?.type !== 'ptt' &&
        data?.type !== 'ptt_start' &&
        data?.type !== 'ptt_stop'
      ) {
        return;
      }
      const current = familyRef.current;
      if (!current || data.familyId !== current.id) return;
      if (data.fromId === selfIdRef.current) return;
      const me = current.members.find((m) => m.id === selfIdRef.current);
      if (!me) return;
      if (!shouldPlayIncomingPtt(me.quietPreferred, me.position, current.zones)) {
        if (data.type === 'ptt_stop' || data.type === 'ptt') {
          setRemoteSpeaker(null);
        }
        return;
      }
      if (data.type === 'ptt_start') {
        const name =
          data.fromName ||
          current.members.find((m) => m.id === data.fromId)?.displayName ||
          'משפחה';
        setRemoteSpeaker({ id: data.fromId ?? 'remote', name });
        return;
      }
      setRemoteSpeaker(null);
      void playPttAutoTone(700);
    };
    return () => bc.close();
  }, []);

  const tearDownLive = useCallback(async () => {
    const live = liveRef.current;
    liveRef.current = null;
    setPttConnected(false);
    setPttMode('demo');
    if (live) {
      try {
        await live.disconnect();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const ensureLiveKit = useCallback(async (): Promise<boolean> => {
    const current = familyRef.current;
    if (!current || !client || !session) {
      setPttMode('demo');
      return false;
    }
    if (!isUuid(current.id)) {
      setPttMode('demo');
      return false;
    }
    if (liveRef.current?.connected) {
      setPttMode('live');
      setPttConnected(true);
      return true;
    }
    try {
      const token = await fetchFamilyLiveKitToken(client, current.id);
      if (token.demo) {
        setPttMode('demo');
        setPttConnected(false);
        return false;
      }
      const live = new TripLiveSession();
      await live.connect({
        url: token.url,
        token: token.token,
        autoSubscribeAudio: true,
        onRemoteSpeaking: (speaking, info) => {
          if (speaking) {
            setRemoteSpeaker({ id: info.identity, name: info.name });
          } else {
            setRemoteSpeaker((prev) =>
              prev?.id === info.identity ? null : prev,
            );
          }
        },
        onDisconnected: () => {
          setRemoteSpeaker(null);
          setPttConnected(false);
        },
      });
      // Apply current quiet state before any remote PTT arrives.
      const me = familyRef.current?.members.find(
        (m) => m.id === selfIdRef.current,
      );
      const zonesNow = familyRef.current?.zones ?? [];
      const play = me
        ? shouldPlayIncomingPtt(me.quietPreferred, me.position, zonesNow)
        : true;
      live.setRemoteAudioMuted(!play);
      liveRef.current = live;
      setPttMode('live');
      setPttConnected(true);
      return true;
    } catch (err) {
      console.warn('[Oki] LiveKit connect failed; demo PTT', err);
      setPttMode('demo');
      setPttConnected(false);
      return false;
    }
  }, [client, session]);

  useEffect(() => {
    if (!family) {
      void tearDownLive();
      return;
    }
    void ensureLiveKit();
    return () => {
      void tearDownLive();
    };
  }, [family?.id, ensureLiveKit, tearDownLive]);

  /** Keep LiveKit remote PTT muted while quiet mode is effective (outside force_audio). */
  useEffect(() => {
    const live = liveRef.current;
    if (!live?.connected) return;
    live.setRemoteAudioMuted(quietEffective);
  }, [quietEffective, pttConnected]);

  /** Hydrate cloud family when signed in (UUID → LiveKit path). */
  useEffect(() => {
    if (!client || !session?.user?.id) return;
    let cancelled = false;
    void (async () => {
      try {
        const existingId = await fetchMyCloudFamilyId(client, session.user.id);
        if (!existingId || cancelled) return;
        const snap = await fetchCloudFamilySnapshot(client, existingId);
        if (cancelled) return;
        setSelfId(session.user.id);
        setFamily(
          snapshotToLocal(snap, session.user.id, prevPosRef.current),
        );
        setCloudError(null);
      } catch (err) {
        console.warn('[Oki] cloud hydrate failed', err);
        if (!cancelled) {
          setCloudError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, session?.user?.id]);

  /** Poll cloud snapshot so location requests / members / alerts stay in sync. */
  useEffect(() => {
    if (!client || !session?.user?.id || !family || !isUuid(family.id)) return;
    const familyId = family.id;
    const userId = session.user.id;
    let cancelled = false;

    const refresh = async () => {
      try {
        const snap = await fetchCloudFamilySnapshot(client, familyId);
        if (cancelled) return;
        const nextLocal = snapshotToLocal(snap, userId, prevPosRef.current);

        // Parents evaluate compound enter/exit from shared locations (members never see compounds).
        const selfRole = nextLocal.members.find((m) => m.id === userId)?.role;
        if (selfRole === 'admin' && (nextLocal.compounds?.length ?? 0) > 0) {
          for (const m of nextLocal.members) {
            if (m.id === userId || !m.sharedPosition) continue;
            const prevShared = prevSharedPosRef.current[m.id];
            const nextShared = m.sharedPosition;
            if (!prevShared) {
              // Seed baseline — no alert on first observation after load/share.
              prevSharedPosRef.current[m.id] = nextShared;
              continue;
            }
            const tx = detectCompoundTransitions(
              prevShared,
              nextShared,
              nextLocal.compounds,
            );
            for (const c of tx.entered) {
              pushAlert({
                kind: 'boundary_crossed',
                memberId: m.id,
                label: `${m.displayName} · נכנס/ה למתחם ${c.name}`,
                position: nextShared,
              });
            }
            for (const c of tx.exited) {
              pushAlert({
                kind: 'boundary_crossed',
                memberId: m.id,
                label: `${m.displayName} · יצא/ה ממתחם ${c.name}`,
                position: nextShared,
              });
            }
            prevSharedPosRef.current[m.id] = nextShared;
          }
        }

        setFamily(nextLocal);
        setCloudError(null);
      } catch (err) {
        console.warn('[Oki] cloud refresh failed', err);
        if (!cancelled) {
          setCloudError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    const timer = setInterval(() => {
      void refresh();
    }, 6_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, session?.user?.id, family?.id, pushAlert]);

  const createFamily = useCallback(
    async (name: string, displayName: string) => {
      setCloudError(null);
      if (client && session?.user?.id) {
        try {
          const familyId = await createCloudFamily(client, {
            name,
            displayName: normalizeDisplayName(displayName),
          });
          const snap = await fetchCloudFamilySnapshot(client, familyId);
          setSelfId(session.user.id);
          setFamily(
            snapshotToLocal(snap, session.user.id, prevPosRef.current),
          );
          return;
        } catch (err) {
          console.warn('[Oki] cloud create failed', err);
          setCloudError('create_failed');
          return;
        }
      }
      if (
        !shouldUseOfflineFamily({
          serverConfigured: Boolean(client),
          signedIn: Boolean(session?.user?.id),
        })
      ) {
        setCloudError('not_signed_in');
        return;
      }
      const id = uid('fam');
      const code = generateInviteCode();
      const memberId = session?.user?.id ?? uid('mem');
      setSelfId(memberId);
      setFamily({
        id,
        name: name.trim() || 'משפחה',
        inviteCode: code,
        livekitRoom: `family_${code}`,
        members: [
          {
            id: memberId,
            displayName: normalizeDisplayName(displayName) || 'מנהל',
            role: 'admin',
            quietPreferred: false,
            position: prevPosRef.current,
            sharedPosition: null,
            lastSeenAt: new Date().toISOString(),
          },
        ],
        zones: [],
        lines: [],
        compounds: [],
        meetingPoints: [],
        locationRequests: [],
        alerts: [],
      });
    },
    [client, session?.user?.id],
  );

  const joinFamily = useCallback(
    async (code: string, displayName: string): Promise<JoinFamilyResult> => {
      const prepared = prepareJoinCode(code);
      if (prepared.tooLong) {
        setCloudError('too_long');
        return { ok: false, reason: 'too_long' };
      }
      if (!prepared.submitCode) {
        setCloudError('invalid_format');
        return { ok: false, reason: 'invalid_format' };
      }
      const normalized = prepared.submitCode;
      setCloudError(null);
      const offline = shouldUseOfflineFamily({
        serverConfigured: Boolean(client),
        signedIn: Boolean(session?.user?.id),
      });
      if (!offline) {
        if (!client || !session?.user?.id) {
          setCloudError('not_signed_in');
          return { ok: false, reason: 'not_signed_in' };
        }
        try {
          const familyId = await joinCloudFamily(client, {
            inviteCode: normalized,
            displayName: normalizeDisplayName(displayName),
          });
          const snap = await fetchCloudFamilySnapshot(client, familyId);
          setSelfId(session.user.id);
          setFamily(
            snapshotToLocal(snap, session.user.id, prevPosRef.current),
          );
          return { ok: true };
        } catch (err) {
          console.warn('[Oki] cloud join failed', err);
          const reason = joinFailureReason(err);
          setCloudError(reason);
          return { ok: false, reason };
        }
      }
      const memberId = session?.user?.id ?? uid('mem');
      setSelfId(memberId);
      setFamily((prev) => {
        if (prev && prev.inviteCode === normalized) {
          const exists = prev.members.some((m) => m.id === memberId);
          if (exists) return prev;
          return {
            ...prev,
            members: [
              ...prev.members,
              {
                id: memberId,
                displayName: normalizeDisplayName(displayName) || 'בן משפחה',
                role: 'member',
                quietPreferred: false,
                position: prevPosRef.current,
                sharedPosition: null,
                lastSeenAt: new Date().toISOString(),
              },
            ],
          };
        }
        return {
          id: uid('fam'),
          name: 'משפחה',
          inviteCode: normalized,
          livekitRoom: `family_${normalized}`,
          members: [
            {
              id: memberId,
              displayName: normalizeDisplayName(displayName) || 'בן משפחה',
              role: 'member',
              quietPreferred: false,
              position: prevPosRef.current,
              sharedPosition: null,
              lastSeenAt: new Date().toISOString(),
            },
          ],
          zones: [],
          lines: [],
          compounds: [],
          meetingPoints: [],
          locationRequests: [],
          alerts: [],
        };
      });
      return { ok: true };
    },
    [client, session?.user?.id],
  );

  const leaveFamily = useCallback(async () => {
    const current = familyRef.current;
    const attemptedServer = Boolean(
      client && session?.user?.id && current && isUuid(current.id),
    );
    let leaveError: unknown | null = null;
    if (attemptedServer && client && session?.user?.id && current) {
      try {
        await leaveCloudFamily(client, {
          familyId: current.id,
          userId: session.user.id,
        });
      } catch (err) {
        console.warn('[Oki] cloud leave failed', err);
        leaveError = err;
      }
    }
    const plan = leaveUiPlan({ attemptedServer, error: leaveError });
    if (plan.showError) {
      setCloudError('leave_failed');
      return;
    }
    void tearDownLive();
    setFamily(null);
    setPttActive(false);
    setCloudError(null);
  }, [client, session?.user?.id, tearDownLive]);

  const rotateInviteCode = useCallback(async () => {
    const current = familyRef.current;
    if (!client || !session?.user?.id || !current || !isUuid(current.id)) return;
    setCloudError(null);
    try {
      const code = await rotateCloudInviteCode(client, current.id);
      setFamily((prev) => (prev ? { ...prev, inviteCode: code } : prev));
    } catch (err) {
      console.warn('[Oki] rotate invite failed', err);
      setCloudError('rotate_failed');
    }
  }, [client, session?.user?.id]);

  const setQuietPreferred = useCallback(
    (value: boolean) => {
      const current = familyRef.current;
      const me = current?.members.find((m) => m.id === selfIdRef.current);
      if (value && me && current) {
        const blocked = !canUseQuietMode(true, me.position, current.zones);
        if (blocked) {
          pushAlert({
            kind: 'quiet_blocked',
            memberId: me.id,
            label: me.displayName,
            position: me.position,
          });
        }
      }
      updateSelf({ quietPreferred: value });
      if (client && current && isUuid(current.id) && session?.user?.id) {
        void setCloudQuietPreferred(client, {
          familyId: current.id,
          userId: session.user.id,
          quiet: value,
        }).catch((err) => console.warn('[Oki] quiet sync failed', err));
      }
    },
    [client, pushAlert, session?.user?.id, updateSelf],
  );

  const stopPtt = useCallback(async () => {
    if (pttTimerRef.current) {
      clearTimeout(pttTimerRef.current);
      pttTimerRef.current = null;
    }
    pttBusyRef.current = false;
    setPttActive(false);
    if (pttLiveRef.current && liveRef.current) {
      pttLiveRef.current = false;
      try {
        await liveRef.current.stopPtt();
      } catch {
        /* ignore */
      }
      return;
    }
    const current = familyRef.current;
    if (current && typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(BC_NAME);
      bc.postMessage({
        type: 'ptt_stop',
        familyId: current.id,
        fromId: selfIdRef.current,
      });
      bc.close();
    }
  }, []);

  const startPtt = useCallback(async () => {
    if (pttBusyRef.current) return;
    let micOk = permissions.microphone === 'granted';
    if (!micOk) micOk = await requestPermissions();
    if (!micOk) return;

    pttBusyRef.current = true;
    const liveOk = await ensureLiveKit();
    setPttActive(true);
    if (liveOk && liveRef.current) {
      pttLiveRef.current = true;
      try {
        await liveRef.current.startPtt();
      } catch (err) {
        console.warn('[Oki] live PTT failed; demo', err);
        pttLiveRef.current = false;
        setPttMode('demo');
      }
    } else {
      pttLiveRef.current = false;
      const current = familyRef.current;
      const me = current?.members.find((m) => m.id === selfIdRef.current);
      if (current && typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel(BC_NAME);
        bc.postMessage({
          type: 'ptt_start',
          familyId: current.id,
          fromId: selfIdRef.current,
          fromName: me?.displayName,
        });
        bc.close();
      }
    }

    if (pttTimerRef.current) clearTimeout(pttTimerRef.current);
    pttTimerRef.current = setTimeout(() => {
      void stopPtt();
    }, PTT_MAX_DURATION_MS);
  }, [permissions.microphone, requestPermissions, ensureLiveKit, stopPtt]);

  const togglePtt = useCallback(async () => {
    if (pttActive) await stopPtt();
    else await startPtt();
  }, [pttActive, startPtt, stopPtt]);

  // Safety: never leave mic transmitting on hide / unload
  useEffect(() => {
    const halt = () => {
      void stopPtt();
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') halt();
    };
    window.addEventListener('pagehide', halt);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', halt);
      document.removeEventListener('visibilitychange', onVis);
      halt();
    };
  }, [stopPtt]);

  const addZone = useCallback(
    async (input: {
      name: string;
      center: LatLng;
      radiusM: number;
      forceAudio: boolean;
    }) => {
      const current = familyRef.current;
      const radiusM = clampZoneRadiusM(input.radiusM);
      const name = input.name.trim() || 'אזור';
      let id = uid('zone');
      if (client && session?.user?.id && current && isUuid(current.id)) {
        try {
          id = await addCloudZone(client, {
            familyId: current.id,
            createdBy: session.user.id,
            name,
            center: input.center,
            radiusM,
            forceAudio: input.forceAudio,
          });
        } catch (err) {
          console.warn('[Oki] cloud addZone failed', err);
        }
      }
      const zone: FamilyZone = {
        id,
        name,
        center: input.center,
        radiusM,
        forceAudio: input.forceAudio,
      };
      setFamily((prev) =>
        prev ? { ...prev, zones: [...prev.zones, zone] } : prev,
      );
    },
    [client, session?.user?.id],
  );

  const removeZone = useCallback(
    async (zoneId: string) => {
      const current = familyRef.current;
      if (client && current && isUuid(current.id)) {
        try {
          await removeCloudZone(client, zoneId);
        } catch (err) {
          console.warn('[Oki] cloud removeZone failed', err);
        }
      }
      setFamily((prev) =>
        prev
          ? { ...prev, zones: prev.zones.filter((z) => z.id !== zoneId) }
          : prev,
      );
    },
    [client],
  );

  const addBoundaryLine = useCallback(
    async (input: {
      name: string;
      a: LatLng;
      b: LatLng;
      alertWithinM: number;
    }) => {
      const current = familyRef.current;
      const name = input.name.trim() || 'קו';
      const alertWithinM = Math.min(500, Math.max(10, input.alertWithinM));
      let id = uid('line');
      if (client && session?.user?.id && current && isUuid(current.id)) {
        try {
          id = await addCloudBoundaryLine(client, {
            familyId: current.id,
            createdBy: session.user.id,
            name,
            a: input.a,
            b: input.b,
            alertWithinM,
          });
        } catch (err) {
          console.warn('[Oki] cloud addLine failed', err);
        }
      }
      const line: FamilyBoundaryLine = {
        id,
        name,
        a: input.a,
        b: input.b,
        alertWithinM,
      };
      setFamily((prev) =>
        prev ? { ...prev, lines: [...prev.lines, line] } : prev,
      );
    },
    [client, session?.user?.id],
  );

  const removeBoundaryLine = useCallback(
    async (lineId: string) => {
      const current = familyRef.current;
      if (client && current && isUuid(current.id)) {
        try {
          await removeCloudBoundaryLine(client, lineId);
        } catch (err) {
          console.warn('[Oki] cloud removeLine failed', err);
        }
      }
      setFamily((prev) =>
        prev
          ? { ...prev, lines: prev.lines.filter((l) => l.id !== lineId) }
          : prev,
      );
    },
    [client],
  );

  const addCompound = useCallback(
    async (input: { name: string; ring: LatLng[] }) => {
      if (!isValidCompoundRing(input.ring)) return;
      const current = familyRef.current;
      const name = input.name.trim() || 'מתחם';
      let id = uid('cmp');
      if (client && session?.user?.id && current && isUuid(current.id)) {
        try {
          id = await addCloudCompound(client, {
            familyId: current.id,
            createdBy: session.user.id,
            name,
            ring: input.ring,
          });
        } catch (err) {
          console.warn('[Oki] cloud addCompound failed', err);
        }
      }
      const compound: FamilyCompound = {
        id,
        name,
        ring: input.ring,
        createdBy: session?.user?.id ?? selfIdRef.current,
      };
      setFamily((prev) =>
        prev
          ? { ...prev, compounds: [...(prev.compounds ?? []), compound] }
          : prev,
      );
    },
    [client, session?.user?.id],
  );

  const removeCompound = useCallback(
    async (compoundId: string) => {
      const current = familyRef.current;
      if (client && current && isUuid(current.id)) {
        try {
          await removeCloudCompound(client, compoundId);
        } catch (err) {
          console.warn('[Oki] cloud removeCompound failed', err);
        }
      }
      setFamily((prev) =>
        prev
          ? {
              ...prev,
              compounds: (prev.compounds ?? []).filter((c) => c.id !== compoundId),
            }
          : prev,
      );
    },
    [client],
  );

  const addMeetingPoint = useCallback(
    async (input: { name: string; position: LatLng }) => {
      const current = familyRef.current;
      const name = input.name.trim() || 'מפגש';
      const createdBy = session?.user?.id ?? selfIdRef.current;
      let id = uid('mtp');
      if (client && session?.user?.id && current && isUuid(current.id)) {
        try {
          id = await addCloudMeetingPoint(client, {
            familyId: current.id,
            createdBy: session.user.id,
            name,
            position: input.position,
          });
        } catch (err) {
          console.warn('[Oki] cloud addMeetingPoint failed', err);
        }
      }
      const point: FamilyMeetingPoint = {
        id,
        name,
        position: input.position,
        createdBy,
      };
      const alert: FamilyAlert = {
        id: uid('al'),
        kind: 'meeting_point',
        memberId: createdBy,
        label: name,
        at: new Date().toISOString(),
        position: input.position,
      };
      setFamily((prev) =>
        prev
          ? {
              ...prev,
              meetingPoints: [...(prev.meetingPoints ?? []), point],
              alerts: [alert, ...prev.alerts].slice(0, 50),
            }
          : prev,
      );
      if (client && current && isUuid(current.id)) {
        try {
          await insertCloudFamilyAlert(client, {
            familyId: current.id,
            memberId: createdBy,
            kind: 'meeting_point',
            label: name,
            position: input.position,
          });
        } catch (err) {
          console.warn('[Oki] cloud meeting_point alert failed', err);
        }
      }
    },
    [client, session?.user?.id],
  );

  const removeMeetingPoint = useCallback(
    async (meetingPointId: string) => {
      const current = familyRef.current;
      if (client && current && isUuid(current.id)) {
        try {
          await removeCloudMeetingPoint(client, meetingPointId);
        } catch (err) {
          console.warn('[Oki] cloud removeMeetingPoint failed', err);
        }
      }
      setFamily((prev) =>
        prev
          ? {
              ...prev,
              meetingPoints: (prev.meetingPoints ?? []).filter(
                (m) => m.id !== meetingPointId,
              ),
            }
          : prev,
      );
    },
    [client],
  );

  const requestMemberLocation = useCallback(
    async (memberId: string) => {
      const current = familyRef.current;
      let id = uid('locreq');
      if (client && session?.user?.id && current && isUuid(current.id)) {
        try {
          id = await createCloudLocationRequest(client, {
            familyId: current.id,
            fromAdminId: session.user.id,
            toMemberId: memberId,
          });
        } catch (err) {
          console.warn('[Oki] cloud location request failed', err);
        }
      }
      const req: FamilyLocationRequest = {
        id,
        fromAdminId: selfIdRef.current,
        toMemberId: memberId,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      setFamily((prev) =>
        prev
          ? { ...prev, locationRequests: [req, ...prev.locationRequests] }
          : prev,
      );
    },
    [client, session?.user?.id],
  );

  const respondLocationRequest = useCallback(
    async (requestId: string, accept: boolean) => {
      const current = familyRef.current;
      if (!accept) {
        if (client && current && isUuid(current.id) && session?.user?.id) {
          try {
            await respondCloudLocationRequest(client, {
              requestId,
              familyId: current.id,
              userId: session.user.id,
              accept: false,
              position: null,
            });
          } catch (err) {
            console.warn('[Oki] cloud deny location failed', err);
          }
        }
        setFamily((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            locationRequests: prev.locationRequests.map((r) =>
              r.id === requestId ? { ...r, status: 'denied' } : r,
            ),
          };
        });
        return;
      }
      const pos = await refreshSelfGps();
      if (client && current && isUuid(current.id) && session?.user?.id) {
        try {
          await respondCloudLocationRequest(client, {
            requestId,
            familyId: current.id,
            userId: session.user.id,
            accept: true,
            position: pos,
          });
        } catch (err) {
          console.warn('[Oki] cloud share location failed', err);
        }
      }
      setFamily((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          locationRequests: prev.locationRequests.map((r) =>
            r.id === requestId ? { ...r, status: 'shared' } : r,
          ),
          members: prev.members.map((m) =>
            m.id === selfIdRef.current
              ? {
                  ...m,
                  sharedPosition: pos,
                  position: pos ?? m.position,
                }
              : m,
          ),
        };
      });
      if (pos) {
        pushAlert({
          kind: 'location_shared',
          memberId: selfIdRef.current,
          label: self?.displayName ?? '',
          position: pos,
        });
      }
    },
    [
      client,
      pushAlert,
      refreshSelfGps,
      self?.displayName,
      session?.user?.id,
    ],
  );

  const renameSelf = useCallback(
    async (displayName: string) => {
      const name = normalizeDisplayName(displayName) || 'בן משפחה';
      updateSelf({ displayName: name });
      const current = familyRef.current;
      if (client && current && isUuid(current.id) && session?.user?.id) {
        try {
          await setCloudMemberDisplayName(client, {
            familyId: current.id,
            userId: session.user.id,
            displayName: name,
          });
        } catch (err) {
          console.warn('[Oki] cloud rename failed', err);
        }
      }
    },
    [client, session?.user?.id, updateSelf],
  );

  const value = useMemo<FamilyContextValue>(
    () => ({
      family,
      self,
      isAdmin,
      permissions,
      permissionsReady: hasRequiredPermissions(permissions),
      quietPreferred,
      quietEffective,
      forceAudioActive,
      forceAudioZoneName,
      pttActive,
      pttMode,
      pttConnected,
      remoteSpeaker,
      position,
      alerts: family?.alerts ?? [],
      cloudSync: Boolean(family && isUuid(family.id)),
      cloudError,
      requestPermissions,
      createFamily,
      joinFamily,
      leaveFamily,
      rotateInviteCode,
      setQuietPreferred,
      startPtt,
      stopPtt,
      togglePtt,
      refreshSelfGps,
      addZone,
      removeZone,
      addBoundaryLine,
      removeBoundaryLine,
      addCompound,
      removeCompound,
      addMeetingPoint,
      removeMeetingPoint,
      requestMemberLocation,
      respondLocationRequest,
      renameSelf,
    }),
    [
      family,
      self,
      isAdmin,
      permissions,
      quietPreferred,
      quietEffective,
      forceAudioActive,
      forceAudioZoneName,
      pttActive,
      pttMode,
      pttConnected,
      remoteSpeaker,
      position,
      cloudError,
      requestPermissions,
      createFamily,
      joinFamily,
      leaveFamily,
      rotateInviteCode,
      setQuietPreferred,
      startPtt,
      stopPtt,
      togglePtt,
      refreshSelfGps,
      addZone,
      removeZone,
      addBoundaryLine,
      removeBoundaryLine,
      addCompound,
      removeCompound,
      addMeetingPoint,
      removeMeetingPoint,
      requestMemberLocation,
      respondLocationRequest,
      renameSelf,
    ],
  );

  return (
    <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>
  );
}

export function useFamily(): FamilyContextValue {
  const ctx = useContext(FamilyContext);
  if (!ctx) throw new Error('useFamily requires FamilyProvider');
  return ctx;
}
