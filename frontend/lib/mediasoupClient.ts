import { Device } from 'mediasoup-client';
import type { Transport, Producer, Consumer } from 'mediasoup-client/types';
import { io, Socket } from 'socket.io-client';
import { getServerBase } from './config';

export type MediaSource = 'camera' | 'mic' | 'screen-video' | 'screen-audio';

export interface RemoteTrackInfo {
  peerId: string;
  username: string;
  source: MediaSource;
  producerId: string;
  track: MediaStreamTrack;
}

export interface ChatAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
}

export interface IncomingChatMessage {
  id: string;
  userId: string;
  username: string;
  content: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
  attachmentSize?: number | null;
  createdAt: string;
}

export interface RoomCallbacks {
  onPeerJoined?: (peer: {
    peerId: string;
    username: string;
    isHost?: boolean;
    isCoHost?: boolean;
  }) => void;
  onPeerLeft?: (peerId: string) => void;
  onRemoteTrack?: (info: RemoteTrackInfo) => void;
  onProducerClosed?: (producerId: string, peerId: string) => void;
  onChatMessage?: (msg: IncomingChatMessage) => void;
  onHandState?: (state: {
    peerId: string;
    username: string;
    raised: boolean;
    raisedAt: string | null;
  }) => void;
  onActiveSpeaker?: (peerId: string | null) => void;
  onMicState?: (state: { peerId: string; enabled: boolean }) => void;
  onCamState?: (state: { peerId: string; enabled: boolean }) => void;
  /** A moderator asked us to mute/unmute our own mic. */
  onForceMic?: (enabled: boolean) => void;
  /** A moderator asked us to turn our camera on/off. */
  onForceCam?: (enabled: boolean) => void;
  /** A moderator removed us from the room. */
  onKicked?: () => void;
  /** We are waiting in the lobby for a host to admit us. */
  onWaiting?: () => void;
  /** Co-host status of a peer changed. */
  onCoHostState?: (state: { peerId: string; value: boolean }) => void;
  /** A new guest is waiting in the lobby (moderator only). */
  onWaitingPeer?: (peer: { peerId: string; username: string }) => void;
  /** A waiting guest left / was handled (moderator only). */
  onWaitingPeerLeft?: (peerId: string) => void;
  /** Full lobby list pushed when we become a co-host. */
  onWaitingList?: (list: Array<{ peerId: string; username: string }>) => void;
  /** A participant renamed themselves. */
  onNameChange?: (state: { peerId: string; name: string }) => void;
  /** Socket connection dropped unexpectedly (network loss). */
  onDisconnected?: () => void;
  /** Socket reconnected after a drop. */
  onReconnected?: () => void;
  /** The host ended the meeting for everyone. */
  onMeetingEnded?: () => void;
  /** Someone sent an emoji reaction. */
  onReaction?: (r: { peerId: string; username: string; emoji: string }) => void;
  /** Room lock state changed. */
  onLockState?: (locked: boolean) => void;
  /** A peer reported its connection quality. */
  onPeerQuality?: (q: { peerId: string; level: string }) => void;
  /** The host role moved to another participant. */
  onHostChanged?: (h: { hostPeerId: string; hostUserId: string }) => void;
  /** Meeting PIN was set/cleared. */
  onPinState?: (hasPin: boolean) => void;
}

export class RoomClient {
  socket: Socket;
  device: Device | null = null;
  sendTransport: Transport | null = null;
  recvTransport: Transport | null = null;
  /** Local producers, keyed by MediaSource */
  producers = new Map<MediaSource, Producer>();
  consumers = new Map<string, Consumer>();
  /** Map producerId -> peerId, used when a remote producer closes */
  private producerPeer = new Map<string, string>();
  /** Display name chosen by the user (may be edited while in the lobby). */
  private displayName = '';
  /** Set when we deliberately leave, so the disconnect isn't treated as a drop. */
  private leaving = false;
  callbacks: RoomCallbacks;

  constructor(token: string, callbacks: RoomCallbacks = {}) {
    this.callbacks = callbacks;
    this.socket = io(getServerBase(), {
      auth: { token },
      transports: ['websocket'],
    });
    // Network-drop detection (mediasoup state can't survive it — the app reloads
    // to rebuild cleanly on reconnect).
    this.socket.on('disconnect', () => {
      if (!this.leaving) this.callbacks.onDisconnected?.();
    });
    this.socket.io.on('reconnect', () => {
      if (!this.leaving) this.callbacks.onReconnected?.();
    });
    // Active from the start so even lobby guests are booted when the host ends.
    this.socket.on('meetingEnded', () => {
      this.leaving = true; // forced out — don't treat the disconnect as a drop
      this.callbacks.onMeetingEnded?.();
    });
  }

  private emit<T = any>(event: string, data?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      this.socket.emit(event, data, (response: any) => {
        if (response?.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  }

  async join(roomId: string, displayName = '', pin = '') {
    this.displayName = displayName;
    await new Promise<void>((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('connect_error', reject);
    });

    let res = await this.emit<any>('joinRoom', {
      roomId,
      displayName: this.displayName,
      pin,
    });

    // Non-hosts land in the lobby; block until a moderator admits us.
    if (res?.inLobby) {
      this.callbacks.onWaiting?.();
      await new Promise<void>((resolve, reject) => {
        this.socket.once('admitted', () => resolve());
        this.socket.once('denied', () => reject(new Error('denied')));
      });
      // Send the (possibly edited) name when finalizing.
      res = await this.emit<any>('finalizeJoin', {
        roomId,
        displayName: this.displayName,
      });
    }

    const {
      rtpCapabilities,
      existingProducers,
      peers,
      messages,
      raisedHands,
      isHost,
      isCoHost,
      locked,
      hasPin,
      pin: hostPin,
      startedAt,
      waitingList,
    } = res;

    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: rtpCapabilities });

    await this.createSendTransport();
    await this.createRecvTransport();

    this.registerSocketEvents();

    // Consume existing producers
    for (const p of existingProducers) {
      await this.consumeProducer(p.producerId, p.peerId, p.username, p.appData);
    }

    return {
      peers,
      messages: messages || [],
      raisedHands: (raisedHands || []) as Array<{ peerId: string; raisedAt: string }>,
      isHost: !!isHost,
      isCoHost: !!isCoHost,
      locked: !!locked,
      hasPin: !!hasPin,
      pin: (hostPin || '') as string,
      startedAt: (startedAt || 0) as number,
      waitingList: (waitingList || []) as Array<{
        peerId: string;
        username: string;
      }>,
    };
  }

  private async createSendTransport() {
    const { params } = await this.emit<any>('createTransport', {
      direction: 'send',
    });
    this.sendTransport = this.device!.createSendTransport(params);

    this.sendTransport.on('connect', async ({ dtlsParameters }, cb, errback) => {
      try {
        await this.emit('connectTransport', {
          transportId: this.sendTransport!.id,
          dtlsParameters,
        });
        cb();
      } catch (err: any) {
        errback(err);
      }
    });

    this.sendTransport.on('produce', async ({ kind, rtpParameters, appData }, cb, errback) => {
      try {
        const { id } = await this.emit<{ id: string }>('produce', {
          transportId: this.sendTransport!.id,
          kind,
          rtpParameters,
          appData,
        });
        cb({ id });
      } catch (err: any) {
        errback(err);
      }
    });
  }

  private async createRecvTransport() {
    const { params } = await this.emit<any>('createTransport', {
      direction: 'recv',
    });
    this.recvTransport = this.device!.createRecvTransport(params);

    this.recvTransport.on('connect', async ({ dtlsParameters }, cb, errback) => {
      try {
        await this.emit('connectTransport', {
          transportId: this.recvTransport!.id,
          dtlsParameters,
        });
        cb();
      } catch (err: any) {
        errback(err);
      }
    });
  }

  private registerSocketEvents() {
    this.socket.on('peerJoined', (peer) => this.callbacks.onPeerJoined?.(peer));
    this.socket.on('peerLeft', ({ peerId }) => this.callbacks.onPeerLeft?.(peerId));
    this.socket.on('newProducer', async ({ producerId, peerId, username, appData }) => {
      await this.consumeProducer(producerId, peerId, username, appData);
    });
    this.socket.on('producerClosed', ({ producerId, peerId }) => {
      this.producerPeer.delete(producerId);
      this.callbacks.onProducerClosed?.(producerId, peerId);
    });
    this.socket.on('chatMessage', (msg) => this.callbacks.onChatMessage?.(msg));
    this.socket.on('handState', (state) => this.callbacks.onHandState?.(state));
    this.socket.on('activeSpeaker', ({ peerId }) =>
      this.callbacks.onActiveSpeaker?.(peerId)
    );
    this.socket.on('micState', (state) => this.callbacks.onMicState?.(state));
    this.socket.on('camState', (state) => this.callbacks.onCamState?.(state));
    this.socket.on('forceMic', ({ enabled }) =>
      this.callbacks.onForceMic?.(!!enabled)
    );
    this.socket.on('forceCam', ({ enabled }) =>
      this.callbacks.onForceCam?.(!!enabled)
    );
    this.socket.on('kicked', () => this.callbacks.onKicked?.());
    this.socket.on('coHostState', (state) =>
      this.callbacks.onCoHostState?.(state)
    );
    this.socket.on('waitingPeer', (peer) =>
      this.callbacks.onWaitingPeer?.(peer)
    );
    this.socket.on('waitingPeerLeft', ({ peerId }) =>
      this.callbacks.onWaitingPeerLeft?.(peerId)
    );
    this.socket.on('waitingList', ({ list }) =>
      this.callbacks.onWaitingList?.(list || [])
    );
    this.socket.on('nameChanged', (state) =>
      this.callbacks.onNameChange?.(state)
    );
    this.socket.on('reaction', (r) => this.callbacks.onReaction?.(r));
    this.socket.on('lockState', ({ locked }) =>
      this.callbacks.onLockState?.(!!locked)
    );
    this.socket.on('peerQuality', (q) => this.callbacks.onPeerQuality?.(q));
    this.socket.on('hostChanged', (h) => this.callbacks.onHostChanged?.(h));
    this.socket.on('pinState', ({ hasPin }) =>
      this.callbacks.onPinState?.(!!hasPin)
    );
  }

  transferHost(peerId: string) {
    this.socket.emit('transferHost', { peerId });
  }
  setPin(pin: string): Promise<{ ok?: boolean; pin?: string; error?: string }> {
    return this.emit('setPin', { pin });
  }

  sendReaction(emoji: string) {
    this.socket.emit('reaction', { emoji });
  }
  setLock(locked: boolean) {
    this.socket.emit('setLock', { locked });
  }
  sendQuality(level: string) {
    this.socket.emit('quality', { level });
  }

  // ---- Moderation actions (no-ops server-side unless caller is a moderator) --
  hostMute(peerId: string, enabled: boolean) {
    this.socket.emit('hostMute', { peerId, enabled });
  }
  hostCam(peerId: string, enabled: boolean) {
    this.socket.emit('hostCam', { peerId, enabled });
  }
  hostMuteAll() {
    this.socket.emit('hostMuteAll');
  }
  hostKick(peerId: string) {
    this.socket.emit('hostKick', { peerId });
  }
  hostSetCoHost(peerId: string, value: boolean) {
    this.socket.emit('hostSetCoHost', { peerId, value });
  }
  admitPeer(peerId: string) {
    this.socket.emit('admitPeer', { peerId });
  }
  admitAll() {
    this.socket.emit('admitAll');
  }
  denyPeer(peerId: string) {
    this.socket.emit('denyPeer', { peerId });
  }
  /** Host: end the meeting for everyone. */
  endMeeting() {
    this.leaving = true;
    this.socket.emit('endRoom');
  }
  /** Update our display name while waiting in the lobby. */
  setLobbyName(name: string) {
    this.displayName = name;
    this.socket.emit('setLobbyName', { name });
  }
  /** Rename ourselves while in the meeting. */
  setName(name: string) {
    this.displayName = name;
    this.socket.emit('setName', { name });
  }

  raiseHand(raised: boolean) {
    this.socket.emit('raiseHand', { raised });
  }

  /**
   * Replace the video track of the camera producer (e.g. when switching
   * virtual background on/off). Audio producer is unaffected.
   */
  async replaceCameraTrack(track: MediaStreamTrack) {
    const producer = this.producers.get('camera');
    if (!producer) return;
    await producer.replaceTrack({ track });
  }

  /** Replace the microphone producer's track (e.g. switching input device). */
  async replaceMicTrack(track: MediaStreamTrack) {
    const producer = this.producers.get('mic');
    if (!producer) return;
    await producer.replaceTrack({ track });
  }

  private async consumeProducer(
    producerId: string,
    peerId: string,
    username: string,
    appData: any = {}
  ) {
    if (!this.device || !this.recvTransport) return;

    const data = await this.emit<any>('consume', {
      transportId: this.recvTransport.id,
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });

    const consumer = await this.recvTransport.consume({
      id: data.id,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters,
    });
    this.consumers.set(consumer.id, consumer);
    this.producerPeer.set(producerId, peerId);

    await this.emit('resumeConsumer', { consumerId: consumer.id });

    const source: MediaSource = (data.appData?.source as MediaSource) || 'camera';

    this.callbacks.onRemoteTrack?.({
      peerId,
      username,
      source,
      producerId,
      track: consumer.track,
    });
  }

  async publishCamera(stream: MediaStream) {
    if (!this.sendTransport) throw new Error('Send transport not ready');

    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    if (videoTrack) {
      const producer = await this.sendTransport.produce({
        track: videoTrack,
        // Virtual background swaps this producer's track via replaceTrack().
        // mediasoup-client's default (stopTracks: true) would stop() the old
        // camera track on every swap — killing the real camera (LED off) and
        // the source the background processor reads from. We manage track
        // lifetime ourselves (stopped on leave), so opt out.
        stopTracks: false,
        appData: { source: 'camera' },
      });
      this.producers.set('camera', producer);
    }
    if (audioTrack) {
      const producer = await this.sendTransport.produce({
        track: audioTrack,
        appData: { source: 'mic' },
      });
      this.producers.set('mic', producer);
    }
  }

  /**
   * Start screen sharing. Captures display media and publishes it as new producers
   * tagged with appData.source = 'screen-video' / 'screen-audio'.
   */
  async startScreenShare(): Promise<MediaStream> {
    if (!this.sendTransport) throw new Error('Send transport not ready');
    if (this.producers.has('screen-video')) throw new Error('Already sharing screen');

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15, max: 30 } },
      audio: true,
    });

    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    if (videoTrack) {
      const producer = await this.sendTransport.produce({
        track: videoTrack,
        appData: { source: 'screen-video' },
      });
      this.producers.set('screen-video', producer);

      // If user stops sharing via the browser's "stop sharing" button
      videoTrack.addEventListener('ended', () => {
        this.stopScreenShare();
      });
    }
    if (audioTrack) {
      const producer = await this.sendTransport.produce({
        track: audioTrack,
        appData: { source: 'screen-audio' },
      });
      this.producers.set('screen-audio', producer);
    }

    return stream;
  }

  async stopScreenShare() {
    for (const key of ['screen-video', 'screen-audio'] as const) {
      const producer = this.producers.get(key);
      if (producer) {
        producer.close();
        this.producers.delete(key);
        // Track this producer is closed; emit to server
        this.socket.emit('closeProducer', { producerId: producer.id });
      }
    }
  }

  toggleProducer(source: 'mic' | 'camera', enabled: boolean) {
    const producer = this.producers.get(source);
    if (!producer) return;
    if (enabled) producer.resume();
    else producer.pause();
    // Let other peers update their indicator for this participant.
    if (source === 'mic') this.socket.emit('setMicState', { enabled });
    if (source === 'camera') this.socket.emit('setCamState', { enabled });
  }

  sendChat(content: string, attachment?: ChatAttachment) {
    this.socket.emit('chatMessage', { content, attachment });
  }

  leave() {
    this.leaving = true;
    this.producers.forEach((p) => p.close());
    this.consumers.forEach((c) => c.close());
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.socket.disconnect();
  }

  /** Mark as leaving without tearing down (e.g. when kicked) so a drop is ignored. */
  markLeaving() {
    this.leaving = true;
  }
}
