import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_ZONE_RADIUS_M,
  FAMILY_INVITE_CODE_LEN,
  MIN_COMPOUND_POINTS,
  filterInviteInput,
  type LatLng,
} from '@oki/domain';
import { cloudErrorI18nKey } from '@oki/api';
import { dirForLocale, type AppLocale } from '@oki/i18n';
import {
  FamilyGeoMap,
  type FamilyMapDrawMode,
} from './components/FamilyGeoMap';
import { useAuth } from './state/auth';
import { useFamily } from './state/family';
import { useLocale } from './state/locale';

type TabId = 'radio' | 'family' | 'zones';
type GateMode = 'choose' | 'create' | 'join';

function CloudNotice({ code }: { code: string | null }) {
  const { t } = useTranslation();
  if (!code) return null;
  const key = cloudErrorI18nKey(code);
  return <p className="oki-error">{key ? t(key) : code}</p>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

function formatInvite(code: string): string {
  return code.toUpperCase().split('').join(' ');
}

function PermCard({
  title,
  body,
  status,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  status: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const { t } = useTranslation();
  const statusLabel =
    status === 'granted'
      ? t('family.permStatusOk')
      : status === 'denied'
        ? t('family.permStatusDenied')
        : t('family.permStatusNeeded');
  return (
    <div className={`oki-perm-card oki-perm-card--${status}`}>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
        <span className="oki-perm-status">{statusLabel}</span>
      </div>
      {status !== 'granted' ? (
        <button type="button" className="oki-btn oki-btn--ghost" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function WelcomeGate() {
  const { t } = useTranslation();
  const fw = useFamily();
  const { session, configured, signIn, signUp, signOut } = useAuth();
  const [mode, setMode] = useState<GateMode>('choose');
  const [familyName, setFamilyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  return (
    <section className="oki-gate">
      <header className="oki-gate-hero">
        <p className="oki-brand">{t('family.appBrand')}</p>
        <h1>{t('family.title')}</h1>
        <p className="oki-lead">{t('family.introHuman')}</p>
      </header>

      {!fw.permissionsReady ? (
        <div className="oki-section">
          <h2>{t('family.permissionsTitleHuman')}</h2>
          <p className="oki-muted">{t('family.permissionsHintHuman')}</p>
          <div className="oki-perm-grid">
            <PermCard
              title={t('family.permMic')}
              body={t('family.permMicWhy')}
              status={fw.permissions.microphone}
              actionLabel={t('family.enableMic')}
              onAction={() => void fw.requestPermissions()}
            />
            <PermCard
              title={t('family.permGeo')}
              body={t('family.permGeoWhy')}
              status={fw.permissions.geolocation}
              actionLabel={t('family.enableGeo')}
              onAction={() => void fw.requestPermissions()}
            />
            <PermCard
              title={t('family.permNotify')}
              body={t('family.permNotifyWhy')}
              status={fw.permissions.notifications}
              actionLabel={t('family.enableNotify')}
              onAction={() => void fw.requestPermissions()}
            />
          </div>
          {fw.permissions.microphone === 'denied' ||
          fw.permissions.geolocation === 'denied' ? (
            <p className="oki-muted">{t('family.permBrowserHelp')}</p>
          ) : null}
        </div>
      ) : null}

      {!configured ? (
        <p className="oki-dev-badge" title={t('family.localOnlyHint')}>
          {t('family.demoBadge')}
        </p>
      ) : null}

      {mode === 'choose' ? (
        <div className="oki-section oki-choice">
          <h2>{t('family.whatNext')}</h2>
          <button
            type="button"
            className="oki-btn oki-btn--large"
            disabled={!fw.permissionsReady}
            onClick={() => setMode('create')}
          >
            {t('family.chooseCreate')}
          </button>
          <button
            type="button"
            className="oki-btn oki-btn--ghost oki-btn--large"
            disabled={!fw.permissionsReady}
            onClick={() => setMode('join')}
          >
            {t('family.chooseJoin')}
          </button>
          {!fw.permissionsReady ? (
            <p className="oki-muted">{t('family.permissionsRequiredHuman')}</p>
          ) : null}
        </div>
      ) : null}

      {mode === 'create' ? (
        <div className="oki-section oki-stack">
          <button type="button" className="oki-linkish" onClick={() => setMode('choose')}>
            {t('family.back')}
          </button>
          <h2>{t('family.createTitleHuman')}</h2>
          <label className="oki-field">
            <span>{t('family.familyName')}</span>
            <input
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
              placeholder={t('family.familyNamePlaceholder')}
            />
          </label>
          <label className="oki-field">
            <span>{t('family.yourName')}</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('family.yourNamePlaceholder')}
            />
          </label>
          <CloudNotice code={fw.cloudError} />
          <button
            type="button"
            className="oki-btn oki-btn--large"
            disabled={!fw.permissionsReady}
            onClick={() => {
              void fw.createFamily(familyName, displayName);
            }}
          >
            {t('family.createFamily')}
          </button>
        </div>
      ) : null}

      {mode === 'join' ? (
        <div className="oki-section oki-stack">
          <button type="button" className="oki-linkish" onClick={() => setMode('choose')}>
            {t('family.back')}
          </button>
          <h2>{t('family.joinTitleHuman')}</h2>
          <label className="oki-field">
            <span>{t('family.inviteCodeHuman')}</span>
            <input
              className="oki-invite-input"
              value={joinCode}
              onChange={(e) => {
                const field = filterInviteInput(e.target.value);
                setJoinCode(field);
                setJoinError(
                  field.length > FAMILY_INVITE_CODE_LEN
                    ? t('family.inviteTooLong')
                    : null,
                );
              }}
              placeholder="AB12CD / A1B2C3D4E5"
              autoCapitalize="characters"
              inputMode="text"
              dir="ltr"
            />
          </label>
          <label className="oki-field">
            <span>{t('family.yourName')}</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('family.yourNamePlaceholder')}
            />
          </label>
          {joinError ? <p className="oki-error">{joinError}</p> : null}
          <button
            type="button"
            className="oki-btn oki-btn--large"
            disabled={!fw.permissionsReady}
            onClick={() => {
              void fw.joinFamily(joinCode, displayName).then((result) => {
                if (result.ok) {
                  setJoinError(null);
                  return;
                }
                const key = cloudErrorI18nKey(result.reason);
                setJoinError(key ? t(key) : t('family.joinFailed'));
              });
            }}
          >
            {t('family.join')}
          </button>
        </div>
      ) : null}

      {configured ? (
        <details className="oki-section oki-account-details">
          <summary>{t('family.accountTitle')}</summary>
          <p className="oki-muted">{t('family.accountHint')}</p>
          {session ? (
            <div className="oki-row">
              <span className="oki-muted">{session.user.email}</span>
              <button type="button" className="oki-btn oki-btn--ghost" onClick={() => void signOut()}>
                {t('auth.signOut')}
              </button>
            </div>
          ) : (
            <div className="oki-stack">
              <label className="oki-field">
                <span>{t('auth.email')}</span>
                <input
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  type="email"
                  autoComplete="email"
                />
              </label>
              <label className="oki-field">
                <span>{t('auth.password')}</span>
                <input
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  type="password"
                  autoComplete="current-password"
                />
              </label>
              {authError ? <p className="oki-error">{authError}</p> : null}
              <div className="oki-row">
                <button
                  type="button"
                  className="oki-btn"
                  onClick={() => {
                    setAuthError(null);
                    void signIn(authEmail, authPassword).catch((err: Error) =>
                      setAuthError(err.message),
                    );
                  }}
                >
                  {t('auth.signIn')}
                </button>
                <button
                  type="button"
                  className="oki-btn oki-btn--ghost"
                  onClick={() => {
                    setAuthError(null);
                    void signUp(authEmail, authPassword, displayName || 'משתמש').catch(
                      (err: Error) => setAuthError(err.message),
                    );
                  }}
                >
                  {t('auth.signUp')}
                </button>
              </div>
            </div>
          )}
        </details>
      ) : null}
    </section>
  );
}

function RadioScreen() {
  const { t } = useTranslation();
  const fw = useFamily();
  const pressRef = useRef(false);
  const [txSeconds, setTxSeconds] = useState(0);

  const receiving = Boolean(fw.remoteSpeaker && !fw.pttActive);
  const busy = receiving;
  const micBlocked = fw.permissions.microphone === 'denied';

  useEffect(() => {
    if (!fw.pttActive) {
      setTxSeconds(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => {
      setTxSeconds(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [fw.pttActive]);

  const statusLine = useMemo(() => {
    if (micBlocked) return t('family.stateMicBlocked');
    if (fw.pttActive) return t('family.stateYouTalking');
    if (receiving && fw.remoteSpeaker) {
      return t('family.stateSomeoneTalking', { name: fw.remoteSpeaker.name });
    }
    if (fw.forceAudioZoneName) {
      return t('family.stateInForceZone', { zone: fw.forceAudioZoneName });
    }
    if (fw.quietEffective) return t('family.stateQuiet');
    if (fw.pttConnected || fw.cloudSync) return t('family.stateConnected');
    return t('family.stateReady');
  }, [
    micBlocked,
    fw.pttActive,
    receiving,
    fw.remoteSpeaker,
    fw.forceAudioZoneName,
    fw.quietEffective,
    fw.pttConnected,
    fw.cloudSync,
    t,
  ]);

  const pttLabel = fw.pttActive
    ? t('family.pttSpeaking')
    : busy
      ? t('family.pttListening')
      : micBlocked
        ? t('family.pttNeedMic')
        : t('family.pttHoldToTalk');

  const beginPress = () => {
    if (busy || micBlocked || pressRef.current) return;
    pressRef.current = true;
    void fw.startPtt();
  };

  const endPress = () => {
    if (!pressRef.current && !fw.pttActive) return;
    pressRef.current = false;
    void fw.stopPtt();
  };

  const modeClass = fw.pttActive
    ? ' is-tx'
    : receiving
      ? ' is-rx'
      : micBlocked
        ? ' is-blocked'
        : '';

  return (
    <div className={`oki-radio${modeClass}`}>
      <div
        className={`oki-walkie${modeClass}`}
        role="region"
        aria-label={t('family.pttTitle')}
      >
        <div className="oki-walkie-antenna" aria-hidden>
          <span className="oki-walkie-antenna-base" />
          <span className="oki-walkie-antenna-stem" />
          <span className="oki-walkie-antenna-tip" />
        </div>
        <div className="oki-walkie-knob" aria-hidden title="CH">
          <span />
        </div>

        <div className="oki-walkie-body">
          <span className="oki-walkie-screw oki-walkie-screw--tl" aria-hidden />
          <span className="oki-walkie-screw oki-walkie-screw--tr" aria-hidden />
          <span className="oki-walkie-screw oki-walkie-screw--bl" aria-hidden />
          <span className="oki-walkie-screw oki-walkie-screw--br" aria-hidden />

          <header className="oki-walkie-brand">
            <span className="oki-walkie-brand-mark">{t('family.appBrand')}</span>
            <span
              className={`oki-walkie-led${receiving || fw.pttActive ? ' is-on' : ''}`}
              aria-hidden
            />
          </header>

          <div className="oki-walkie-lcd" aria-live="polite">
            <div className="oki-walkie-lcd-glass" aria-hidden />
            <p className="oki-walkie-channel">
              {t('family.walkieChannel', {
                name: fw.family?.name ?? t('family.appBrand'),
              })}
            </p>
            <p className="oki-walkie-lcd-status">{statusLine}</p>
            {fw.pttActive ? (
              <p className="oki-tx-timer" dir="ltr">
                {String(Math.floor(txSeconds / 60)).padStart(2, '0')}:
                {String(txSeconds % 60).padStart(2, '0')}
              </p>
            ) : null}
            {receiving && fw.remoteSpeaker ? (
              <p className="oki-walkie-lcd-who">
                {t('family.speakingNow', { name: fw.remoteSpeaker.name })}
              </p>
            ) : null}
          </div>

          <div className="oki-walkie-grille" aria-hidden>
            <div className="oki-walkie-mesh">
              {Array.from({ length: 48 }, (_, i) => (
                <span key={i} className="oki-walkie-mesh-hole" />
              ))}
            </div>
            <div className={`oki-wave${receiving || fw.pttActive ? ' is-live' : ''}`}>
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>

          <button
            type="button"
            className={`oki-ptt${fw.pttActive ? ' is-active' : ''}${busy ? ' is-busy' : ''}${micBlocked ? ' is-blocked' : ''}`}
            aria-pressed={fw.pttActive}
            aria-label={pttLabel}
            disabled={busy || micBlocked}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              beginPress();
            }}
            onPointerUp={endPress}
            onPointerCancel={endPress}
            onLostPointerCapture={endPress}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                if (!e.repeat) beginPress();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                endPress();
              }
            }}
          >
            <span className="oki-ptt-bevel" aria-hidden />
            <span className="oki-ptt-ring" aria-hidden />
            <span className="oki-ptt-core" aria-hidden />
            <span className="oki-ptt-label">{pttLabel}</span>
          </button>

          <div className="oki-walkie-side-btn" aria-hidden>
            <span className="oki-walkie-ptt-ridge" />
            <span />
            <span />
          </div>

          <div className="oki-quiet-bar">
            <button
              type="button"
              className={`oki-quiet-toggle${fw.quietPreferred ? ' is-on' : ''}${fw.forceAudioActive ? ' is-blocked' : ''}`}
              aria-pressed={fw.quietEffective}
              onClick={() => fw.setQuietPreferred(!fw.quietPreferred)}
            >
              {fw.forceAudioActive
                ? t('family.quietUnavailableShort', {
                    zone: fw.forceAudioZoneName ?? t('family.homeZone'),
                  })
                : fw.quietEffective
                  ? t('family.quietOnShort')
                  : t('family.quietOffShort')}
            </button>
            {fw.forceAudioActive ? (
              <p className="oki-muted oki-quiet-explain">{t('family.quietBlockedHuman')}</p>
            ) : null}
          </div>

          <div className="oki-presence-strip" aria-label={t('family.membersTitle')}>
            {fw.family?.members.map((m) => {
              const speaking =
                fw.remoteSpeaker?.id === m.id ||
                (fw.pttActive && m.id === fw.self?.id);
              return (
                <div
                  key={m.id}
                  className={`oki-presence${speaking ? ' is-speaking' : ''}${m.quietPreferred ? ' is-quiet' : ''}`}
                >
                  <div className="oki-avatar oki-avatar--sm" aria-hidden>
                    {initials(m.displayName)}
                  </div>
                  <span>{m.displayName}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {!fw.pttConnected && !fw.cloudSync ? (
        <p className="oki-dev-badge">{t('family.demoBadge')}</p>
      ) : null}
    </div>
  );
}

function FamilyTab() {
  const { t } = useTranslation();
  const fw = useFamily();
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const code = fw.family?.inviteCode ?? '';

  const pendingForSelf =
    fw.family?.locationRequests.filter(
      (r) => r.status === 'pending' && r.toMemberId === fw.self?.id,
    ) ?? [];

  const adminName = (fromId: string) =>
    fw.family?.members.find((m) => m.id === fromId)?.displayName ?? t('family.roleAdmin');

  const startEditName = () => {
    setNameDraft(fw.self?.displayName ?? '');
    setEditingName(true);
  };

  const saveName = () => {
    void fw.renameSelf(nameDraft);
    setEditingName(false);
  };

  return (
    <div className="oki-tab-panel oki-stack">
      {pendingForSelf.length > 0 ? (
        <div className="oki-sheet oki-stack" role="dialog" aria-label={t('family.locationRequestTitleHuman')}>
          {pendingForSelf.map((r) => (
            <div key={r.id} className="oki-stack">
              <h2>{t('family.locationRequestTitleHuman', { name: adminName(r.fromAdminId) })}</h2>
              <p className="oki-muted">{t('family.locationRequestHintHuman')}</p>
              <div className="oki-row">
                <button
                  type="button"
                  className="oki-btn"
                  onClick={() => void fw.respondLocationRequest(r.id, true)}
                >
                  {t('family.shareLocationHuman')}
                </button>
                <button
                  type="button"
                  className="oki-btn oki-btn--ghost"
                  onClick={() => void fw.respondLocationRequest(r.id, false)}
                >
                  {t('family.denyLocationHuman')}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="oki-section">
        <h2>{t('family.familyCodeTitle')}</h2>
        <p className="oki-invite-code" dir="ltr">
          {formatInvite(code)}
        </p>
        <div className="oki-row">
          <button
            type="button"
            className="oki-btn oki-btn--ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(code).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              });
            }}
          >
            {copied ? t('family.copied') : t('family.copyCode')}
          </button>
          {'share' in navigator ? (
            <button
              type="button"
              className="oki-btn oki-btn--ghost"
              onClick={() =>
                void navigator.share?.({
                  title: t('family.appBrand'),
                  text: t('family.shareCodeMessage', { code }),
                })
              }
            >
              {t('family.shareCode')}
            </button>
          ) : null}
        </div>
        <p className="oki-muted">{t('family.shareCodeHint')}</p>
        {fw.isAdmin ? (
          <button
            type="button"
            className="oki-btn oki-btn--ghost"
            onClick={() => void fw.rotateInviteCode()}
          >
            {t('family.rotateInvite')}
          </button>
        ) : null}
      </div>

      <div className="oki-section">
        <h2>{t('family.membersTitle')}</h2>
        <ul className="oki-member-list">
          {fw.family?.members.map((m) => {
            const pendingReq = fw.family?.locationRequests.find(
              (r) => r.status === 'pending' && r.toMemberId === m.id,
            );
            const speaking =
              fw.remoteSpeaker?.id === m.id || (fw.pttActive && m.id === fw.self?.id);
            const isSelf = m.id === fw.self?.id;
            return (
              <li key={m.id}>
                <div className="oki-member-main">
                  <div className="oki-avatar" aria-hidden>
                    {initials(m.displayName)}
                  </div>
                  <div>
                    {isSelf && editingName ? (
                      <label className="oki-field">
                        <span className="oki-sr-only">{t('family.yourName')}</span>
                        <input
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          placeholder={t('family.yourNamePlaceholder')}
                          autoFocus
                        />
                      </label>
                    ) : (
                      <strong>{m.displayName}</strong>
                    )}
                    <div className="oki-muted">
                      {m.role === 'admin' ? t('family.roleAdmin') : t('family.roleMember')}
                      {speaking ? ` · ${t('family.speakingBadge')}` : ''}
                      {m.quietPreferred ? ` · ${t('family.quietBadge')}` : ''}
                    </div>
                    {fw.isAdmin && !isSelf ? (
                      <div className="oki-muted">
                        {m.sharedPosition
                          ? t('family.locationSharedNow')
                          : pendingReq
                            ? t('family.locationWaiting', { name: m.displayName })
                            : t('family.locationNotSharedHuman')}
                      </div>
                    ) : null}
                  </div>
                </div>
                {isSelf ? (
                  editingName ? (
                    <div className="oki-row">
                      <button type="button" className="oki-btn" onClick={saveName}>
                        {t('family.saveName')}
                      </button>
                      <button
                        type="button"
                        className="oki-btn oki-btn--ghost"
                        onClick={() => setEditingName(false)}
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="oki-btn oki-btn--ghost"
                      onClick={startEditName}
                    >
                      {t('family.editName')}
                    </button>
                  )
                ) : null}
                {fw.isAdmin && !isSelf ? (
                  <button
                    type="button"
                    className="oki-btn oki-btn--ghost"
                    onClick={() => void fw.requestMemberLocation(m.id)}
                  >
                    {t('family.askLocationHuman')}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {(fw.isAdmin || fw.alerts.length > 0) && (
        <div className="oki-section">
          <h2>{t('family.alertsTitleHuman')}</h2>
          {fw.alerts.length === 0 ? (
            <p className="oki-muted">{t('family.alertsEmptyHuman')}</p>
          ) : (
            <ul className="oki-alert-list">
              {fw.alerts.slice(0, 12).map((a) => (
                <li key={a.id} className={`oki-alert oki-alert--${a.kind}`}>
                  <strong>{t(`family.alertHuman.${a.kind}`, { name: a.label })}</strong>
                  <span className="oki-muted">{new Date(a.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button type="button" className="oki-btn oki-btn--ghost" onClick={() => void fw.leaveFamily()}>
        {t('family.leave')}
      </button>
    </div>
  );
}

function ZonesTab() {
  const { t } = useTranslation();
  const fw = useFamily();
  const [zoneName, setZoneName] = useState('');
  const [zoneRadius, setZoneRadius] = useState(String(DEFAULT_ZONE_RADIUS_M));
  const [compoundName, setCompoundName] = useState('');
  const [meetupName, setMeetupName] = useState('');
  const [forceAudio, setForceAudio] = useState(true);
  const [drawMode, setDrawMode] = useState<FamilyMapDrawMode>('none');
  const [draftRing, setDraftRing] = useState<LatLng[]>([]);

  const adminCompounds = fw.isAdmin ? (fw.family?.compounds ?? []) : [];
  const meetingPoints = fw.family?.meetingPoints ?? [];

  const mapPins = (() => {
    const pins: {
      id: string;
      label: string;
      position: LatLng;
      isSelf?: boolean;
    }[] = [];
    if (fw.position && fw.self) {
      pins.push({
        id: fw.self.id,
        label: fw.self.displayName || t('family.mapYou'),
        position: fw.position,
        isSelf: true,
      });
    }
    if (fw.isAdmin) {
      for (const m of fw.family?.members ?? []) {
        if (m.id === fw.self?.id || !m.sharedPosition) continue;
        pins.push({
          id: m.id,
          label: m.displayName,
          position: m.sharedPosition,
        });
      }
    }
    return pins;
  })();

  const connectedWithoutLocation = (fw.family?.members ?? [])
    .filter((m) => {
      if (m.id === fw.self?.id) return !fw.position;
      if (!fw.isAdmin) return true; // members don't see others' coords
      return !m.sharedPosition;
    })
    .map((m) => m.displayName);

  const onMapPick = (pos: LatLng) => {
    if (drawMode === 'meetup') {
      void fw.addMeetingPoint({
        name: meetupName,
        position: pos,
      });
      setMeetupName('');
      setDrawMode('none');
      return;
    }
    if (!fw.isAdmin) return;
    if (drawMode === 'zone') {
      void fw.addZone({
        name: zoneName,
        center: pos,
        radiusM: Number(zoneRadius) || DEFAULT_ZONE_RADIUS_M,
        forceAudio,
      });
      setZoneName('');
      setDrawMode('none');
      return;
    }
    if (drawMode === 'compound') {
      setDraftRing((prev) => [...prev, pos]);
    }
  };

  const closeCompound = () => {
    if (draftRing.length < MIN_COMPOUND_POINTS) return;
    void fw.addCompound({
      name: compoundName,
      ring: draftRing,
    });
    setCompoundName('');
    setDraftRing([]);
    setDrawMode('none');
  };

  const cancelCompoundDraw = () => {
    setDraftRing([]);
    setDrawMode('none');
  };

  const canRemoveMeetup = (createdBy: string) =>
    fw.isAdmin || createdBy === fw.self?.id;

  return (
    <div className="oki-tab-panel oki-stack">
      <div className="oki-section">
        <h2>{t('family.mapTitleHuman')}</h2>
        <p className="oki-muted">{t('family.mapHintHuman')}</p>
        <FamilyGeoMap
          center={fw.position}
          self={fw.position}
          zones={fw.family?.zones ?? []}
          compounds={adminCompounds}
          meetingPoints={meetingPoints}
          draftRing={drawMode === 'compound' ? draftRing : []}
          interactive={fw.isAdmin}
          drawMode={drawMode}
          onMapPick={onMapPick}
          onCompoundClick={(id) => {
            if (!fw.isAdmin || drawMode !== 'none') return;
            if (window.confirm(t('family.confirmRemoveCompound'))) {
              void fw.removeCompound(id);
            }
          }}
          sharedPins={mapPins}
          connectedWithoutLocation={connectedWithoutLocation}
        />
        {fw.forceAudioZoneName ? (
          <p className="oki-zone-banner">
            {t('family.inZoneBanner', { zone: fw.forceAudioZoneName })}
          </p>
        ) : null}
      </div>

      <div className="oki-section oki-stack">
        <h2>{t('family.meetupsTitleHuman')}</h2>
        <p className="oki-muted">{t('family.meetupsHintHuman')}</p>
        <label className="oki-field">
          <span>{t('family.meetupName')}</span>
          <input
            value={meetupName}
            onChange={(e) => setMeetupName(e.target.value)}
            placeholder={t('family.meetupNamePlaceholder')}
          />
        </label>
        <div className="oki-map-actions">
          <button
            type="button"
            className={`oki-btn${drawMode === 'meetup' ? ' oki-btn--active' : ''}`}
            onClick={() => {
              setDraftRing([]);
              setDrawMode((m) => (m === 'meetup' ? 'none' : 'meetup'));
            }}
          >
            {drawMode === 'meetup'
              ? t('family.mapCancelDraw')
              : t('family.mapMarkMeetup')}
          </button>
          <button
            type="button"
            className="oki-btn oki-btn--ghost"
            disabled={!fw.position}
            onClick={() => {
              if (!fw.position) return;
              void fw.addMeetingPoint({
                name: meetupName,
                position: fw.position,
              });
              setMeetupName('');
              setDrawMode('none');
            }}
          >
            {t('family.addMeetupHere')}
          </button>
        </div>
        <ul className="oki-zone-list">
          {meetingPoints.map((m) => (
            <li key={m.id}>
              <div>
                <strong>{m.name}</strong>
              </div>
              {canRemoveMeetup(m.createdBy) ? (
                <button
                  type="button"
                  className="oki-btn oki-btn--danger"
                  onClick={() => {
                    if (window.confirm(t('family.confirmRemoveMeetup'))) {
                      void fw.removeMeetingPoint(m.id);
                    }
                  }}
                >
                  {t('family.remove')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {meetingPoints.length === 0 ? (
          <p className="oki-muted">{t('family.meetupsEmpty')}</p>
        ) : null}
      </div>

      {fw.isAdmin ? (
        <>
          <div className="oki-section oki-stack">
            <h2>{t('family.zonesTitleHuman')}</h2>
            <p className="oki-muted">{t('family.zonesHintHuman')}</p>
            <label className="oki-field">
              <span>{t('family.zoneName')}</span>
              <input
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                placeholder={t('family.zoneNamePlaceholder')}
              />
            </label>
            <label className="oki-field">
              <span>{t('family.zoneRadius')}</span>
              <input
                type="number"
                min={50}
                max={5000}
                value={zoneRadius}
                onChange={(e) => setZoneRadius(e.target.value)}
              />
            </label>
            <label className="oki-quiet-toggle-row">
              <input
                type="checkbox"
                checked={forceAudio}
                onChange={(e) => setForceAudio(e.target.checked)}
              />
              <span>{t('family.forceAudioCheck')}</span>
            </label>
            <div className="oki-map-actions">
              <button
                type="button"
                className={`oki-btn${drawMode === 'zone' ? ' oki-btn--active' : ''}`}
                onClick={() => {
                  setDraftRing([]);
                  setDrawMode((m) => (m === 'zone' ? 'none' : 'zone'));
                }}
              >
                {drawMode === 'zone'
                  ? t('family.mapCancelDraw')
                  : t('family.mapMarkZone')}
              </button>
              <button
                type="button"
                className="oki-btn oki-btn--ghost"
                disabled={!fw.position}
                onClick={() => {
                  if (!fw.position) return;
                  void fw.addZone({
                    name: zoneName,
                    center: fw.position,
                    radiusM: Number(zoneRadius) || DEFAULT_ZONE_RADIUS_M,
                    forceAudio,
                  });
                  setZoneName('');
                }}
              >
                {t('family.addZoneHere')}
              </button>
            </div>
            <ul className="oki-zone-list">
              {(fw.family?.zones ?? []).map((z) => (
                <li key={z.id}>
                  <div>
                    <strong>{z.name}</strong>
                    <div className="oki-muted">
                      {z.radiusM} {t('family.meters')}
                      {z.forceAudio ? ` · ${t('family.forceAudio')}` : ` · ${t('family.quietAllowed')}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="oki-btn oki-btn--danger"
                    onClick={() => void fw.removeZone(z.id)}
                  >
                    {t('family.remove')}
                  </button>
                </li>
              ))}
            </ul>
            {(fw.family?.zones.length ?? 0) === 0 ? (
              <p className="oki-muted">{t('family.zonesEmpty')}</p>
            ) : null}
          </div>

          <div className="oki-section oki-stack">
            <h2>{t('family.compoundsTitleHuman')}</h2>
            <p className="oki-muted">{t('family.compoundsHintHuman')}</p>
            <label className="oki-field">
              <span>{t('family.compoundName')}</span>
              <input
                value={compoundName}
                onChange={(e) => setCompoundName(e.target.value)}
                placeholder={t('family.compoundNamePlaceholder')}
              />
            </label>
            <div className="oki-map-actions">
              <button
                type="button"
                className={`oki-btn${drawMode === 'compound' ? ' oki-btn--active' : ''}`}
                onClick={() => {
                  if (drawMode === 'compound') {
                    cancelCompoundDraw();
                  } else {
                    setDraftRing([]);
                    setDrawMode('compound');
                  }
                }}
              >
                {drawMode === 'compound'
                  ? t('family.mapCancelDraw')
                  : t('family.mapMarkCompound')}
              </button>
              <button
                type="button"
                className="oki-btn oki-btn--ghost"
                disabled={draftRing.length < MIN_COMPOUND_POINTS}
                onClick={closeCompound}
              >
                {t('family.closeCompound', { count: draftRing.length })}
              </button>
            </div>
            {drawMode === 'compound' ? (
              <p className="oki-muted">
                {t('family.mapCompoundProgress', {
                  count: draftRing.length,
                  min: MIN_COMPOUND_POINTS,
                })}
              </p>
            ) : null}
            <ul className="oki-zone-list">
              {adminCompounds.map((c) => (
                <li key={c.id}>
                  <div>
                    <strong>{c.name}</strong>
                    <div className="oki-muted">
                      {t('family.compoundPoints', { count: c.ring.length })}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="oki-btn oki-btn--danger"
                    onClick={() => void fw.removeCompound(c.id)}
                  >
                    {t('family.remove')}
                  </button>
                </li>
              ))}
            </ul>
            {adminCompounds.length === 0 ? (
              <p className="oki-muted">{t('family.compoundsEmpty')}</p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="oki-muted">{t('family.zonesMemberHint')}</p>
      )}
    </div>
  );
}

function ActiveFamilyShell() {
  const { t } = useTranslation();
  const fw = useFamily();
  const [tab, setTab] = useState<TabId>('radio');
  const connectedCount = fw.family?.members.length ?? 0;

  return (
    <div className={`oki-active${tab === 'radio' ? ' oki-active--radio' : ''}`}>
      {tab !== 'radio' ? (
        <header className="oki-active-header">
          <div>
            <p className="oki-brand-mini">{t('family.appBrand')}</p>
            <h1>{fw.family?.name}</h1>
            <p className="oki-muted">
              {t('family.connectedCount', { count: connectedCount })}
            </p>
          </div>
          <CloudNotice code={fw.cloudError} />
        </header>
      ) : (
        <CloudNotice code={fw.cloudError} />
      )}

      <div className={`oki-active-body oki-active-body--${tab}`}>
        <div className="oki-radio-col">
          {tab === 'radio' ? <RadioScreen /> : null}
        </div>
        <aside className="oki-side-col">
          {tab === 'family' ? <FamilyTab /> : null}
          {tab === 'zones' ? <ZonesTab /> : null}
        </aside>
      </div>

      <nav className="oki-bottom-nav" aria-label={t('family.navLabel')}>
        {(
          [
            ['radio', t('family.navRadio')],
            ['family', t('family.navFamily')],
            ['zones', t('family.navZones')],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'is-active' : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function HomeScreen() {
  const fw = useFamily();
  if (!fw.family) return <WelcomeGate />;
  return <ActiveFamilyShell />;
}

export function App() {
  const { locale, setLocale } = useLocale();
  const { t } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dirForLocale(locale as AppLocale);
  }, [locale]);

  return (
    <div className="oki-shell">
      <div className="oki-topbar">
        <span className="oki-brand-mini">{t('family.appBrand')}</span>
        <select
          aria-label={t('settings.language')}
          value={locale}
          onChange={(e) => setLocale(e.target.value as AppLocale)}
        >
          <option value="he">עברית</option>
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </select>
      </div>
      <main className="oki-main">
        <HomeScreen />
      </main>
    </div>
  );
}
