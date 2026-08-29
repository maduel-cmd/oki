import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
} from 'livekit-client';
export type HazardPayload = {
  type: 'hazard';
  kind: string;
  message?: string;
  lat?: number;
  lng?: number;
  authorId: string;
  at: string;
};

export type ChatDataPayload = {
  type: 'chat';
  body: string;
  authorId: string;
  at: string;
};

export type LiveDataPayload = HazardPayload | ChatDataPayload;

export type ConnectOptions = {
  url: string;
  token: string;
  /** Auto-subscribe remote audio so PTT plays instantly without tap. */
  autoSubscribeAudio?: boolean;
  onData?: (payload: LiveDataPayload) => void;
  onRemoteAudio?: (track: RemoteTrack, participant: RemoteParticipant) => void;
  /** Fired when a remote participant starts/stops publishing PTT audio. */
  onRemoteSpeaking?: (
    speaking: boolean,
    info: { identity: string; name: string },
  ) => void;
  onDisconnected?: () => void;
};

/**
 * LiveKit room helper for trip PTT + data channels.
 * PTT: start → publish mic → stop → unpublish.
 * Max duration is enforced by the UI layer (`livePtt` / `PTT_MAX_DURATION_MS`).
 * Remote audio auto-subscribes so clips play immediately.
 */
export class TripLiveSession {
  readonly room = new Room({
    adaptiveStream: true,
    dynacast: true,
  });

  private micTrack: LocalAudioTrack | null = null;
  private pressStartedAt = 0;
  private listenersBound = false;
  private connectOptions: ConnectOptions | null = null;
  /** Attached remote PTT audio elements — muted when quiet mode is effective. */
  private remoteAudioEls = new Set<HTMLMediaElement>();
  private remoteAudioMuted = false;

  get connected(): boolean {
    return this.room.state === ConnectionState.Connected;
  }

  get transmitting(): boolean {
    return this.micTrack != null;
  }

  /** Mute / unmute all currently attached remote audio (and future attaches). */
  setRemoteAudioMuted(muted: boolean): void {
    this.remoteAudioMuted = muted;
    for (const el of this.remoteAudioEls) {
      el.muted = muted;
      el.volume = muted ? 0 : 1;
    }
  }

  get isRemoteAudioMuted(): boolean {
    return this.remoteAudioMuted;
  }

  private applyRemoteMute(el: HTMLMediaElement): void {
    el.muted = this.remoteAudioMuted;
    el.volume = this.remoteAudioMuted ? 0 : 1;
  }

  private clearRemoteAudioEls(): void {
    for (const el of this.remoteAudioEls) {
      try {
        el.pause();
        el.remove();
      } catch {
        /* ignore */
      }
    }
    this.remoteAudioEls.clear();
  }

  async connect(options: ConnectOptions): Promise<void> {
    this.connectOptions = options;
    const autoSubscribe = options.autoSubscribeAudio !== false;

    if (!this.listenersBound) {
      this.listenersBound = true;
      this.room
        .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
          if (track.kind === Track.Kind.Audio) {
            this.connectOptions?.onRemoteAudio?.(track, participant);
            this.connectOptions?.onRemoteSpeaking?.(true, {
              identity: participant.identity,
              name: participant.name || participant.identity,
            });
            if (
              (this.connectOptions?.autoSubscribeAudio !== false) &&
              track.attach
            ) {
              const el = track.attach();
              el.autoplay = true;
              this.remoteAudioEls.add(el);
              this.applyRemoteMute(el);
              void el.play().catch(() => {
                /* browser may block until gesture — car/native handles differently */
              });
            }
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
          if (track.kind !== Track.Kind.Audio) return;
          if (participant) {
            this.connectOptions?.onRemoteSpeaking?.(false, {
              identity: participant.identity,
              name: participant.name || participant.identity,
            });
          }
          if (!track.detach) return;
          const detached = track.detach();
          for (const el of detached) {
            this.remoteAudioEls.delete(el);
            try {
              el.pause();
              el.remove();
            } catch {
              /* ignore */
            }
          }
        })
        .on(RoomEvent.DataReceived, (payload) => {
          try {
            const text = new TextDecoder().decode(payload);
            const data = JSON.parse(text) as LiveDataPayload;
            this.connectOptions?.onData?.(data);
          } catch {
            /* ignore malformed */
          }
        })
        .on(RoomEvent.Disconnected, () => {
          this.clearRemoteAudioEls();
          this.connectOptions?.onDisconnected?.();
        });
    }

    if (this.connected) return;

    await this.room.connect(options.url, options.token, {
      autoSubscribe,
    });
  }

  async startPtt(): Promise<void> {
    if (!this.connected) {
      throw new Error('TripLiveSession: not connected');
    }
    if (this.micTrack) return;
    this.pressStartedAt = Date.now();
    this.micTrack = await createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
    });
    await this.room.localParticipant.publishTrack(this.micTrack, {
      name: 'ptt',
      source: Track.Source.Microphone,
    });
  }

  async stopPtt(): Promise<{ durationMs: number }> {
    const durationMs = this.pressStartedAt
      ? Date.now() - this.pressStartedAt
      : 0;
    if (this.micTrack) {
      await this.room.localParticipant.unpublishTrack(this.micTrack);
      this.micTrack.stop();
      this.micTrack = null;
    }
    this.pressStartedAt = 0;
    return { durationMs: Math.max(0, durationMs) };
  }

  async sendData(payload: LiveDataPayload): Promise<void> {
    if (!this.connected) {
      throw new Error('TripLiveSession: not connected');
    }
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    await this.room.localParticipant.publishData(bytes, { reliable: true });
  }

  async disconnect(): Promise<void> {
    await this.stopPtt();
    this.clearRemoteAudioEls();
    this.remoteAudioMuted = false;
    if (this.room.state !== ConnectionState.Disconnected) {
      await this.room.disconnect();
    }
  }
}
