import { Device } from 'mediasoup-client';
import type { Transport, Producer, Consumer } from 'mediasoup-client/lib/types';
import { io, Socket } from 'socket.io-client';

export type VoiceCallStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'ended';

export interface VoiceCallParticipant {
  /** Socket-scoped id, unique per connected peer */
  peerId: string;
  displayName: string;
  /** Remote audio — attach to an <audio> element to hear them */
  stream: MediaStream;
}

export interface VoiceCallEvents {
  status: (status: VoiceCallStatus) => void;
  /** A participant connected (audio may arrive slightly after via `remoteStream`) */
  participantJoined: (p: { peerId: string; displayName: string }) => void;
  participantLeft: (peerId: string) => void;
  /** Remote audio track is ready to play */
  remoteStream: (p: VoiceCallParticipant) => void;
  /** peerId of the loudest speaker, or null on silence */
  activeSpeaker: (peerId: string | null) => void;
  error: (err: Error) => void;
}

export interface VoiceCallClientOptions {
  /** Base URL of the Teleconference backend, e.g. https://voice.example.com */
  serverUrl: string;
}

/**
 * Audio-only voice call client for third-party apps.
 *
 * Connect with an access token obtained from your backend
 * (POST /api/v1/calls/:id/token). All identity comes from that token.
 */
export class VoiceCallClient {
  private serverUrl: string;
  private socket: Socket | null = null;
  private device: Device | null = null;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private micProducer: Producer | null = null;
  private consumers = new Map<string, Consumer>();
  private localStream: MediaStream | null = null;
  private listeners: { [K in keyof VoiceCallEvents]?: Array<VoiceCallEvents[K]> } = {};
  private _status: VoiceCallStatus = 'idle';

  constructor(opts: VoiceCallClientOptions) {
    this.serverUrl = opts.serverUrl.replace(/\/+$/, '');
  }

  get status(): VoiceCallStatus {
    return this._status;
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof VoiceCallEvents>(event: K, fn: VoiceCallEvents[K]): () => void {
    (this.listeners[event] ||= []).push(fn);
    return () => {
      this.listeners[event] = (this.listeners[event] || []).filter(
        (f) => f !== fn
      ) as any;
    };
  }

  private emit<K extends keyof VoiceCallEvents>(
    event: K,
    ...args: Parameters<VoiceCallEvents[K]>
  ) {
    (this.listeners[event] || []).forEach((fn) => {
      try {
        (fn as (...a: any[]) => void)(...args);
      } catch (e) {
        console.error('[VoiceCallSDK] listener error', e);
      }
    });
  }

  private setStatus(status: VoiceCallStatus) {
    this._status = status;
    this.emit('status', status);
  }

  private request<T = any>(event: string, data?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      this.socket!.emit(event, data, (res: any) => {
        if (res?.error) reject(new Error(res.error));
        else resolve(res as T);
      });
    });
  }

  /**
   * Join the call: acquires the microphone, connects, and starts streaming.
   * @param accessToken token from POST /api/v1/calls/:id/token
   */
  async join(accessToken: string): Promise<void> {
    if (this._status === 'connecting' || this._status === 'connected') return;
    this.setStatus('connecting');

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.socket = io(this.serverUrl, {
        auth: { accessToken },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve, reject) => {
        this.socket!.once('connect', () => resolve());
        this.socket!.once('connect_error', (e) => reject(e));
      });

      const { rtpCapabilities, existingProducers, peers } =
        await this.request<any>('sdk:join');

      this.device = new Device();
      await this.device.load({ routerRtpCapabilities: rtpCapabilities });

      await this.createSendTransport();
      await this.createRecvTransport();
      this.registerSocketEvents();

      // Announce already-connected peers
      for (const p of peers as Array<{ peerId: string; username: string }>) {
        this.emit('participantJoined', {
          peerId: p.peerId,
          displayName: p.username,
        });
      }
      // Consume their audio
      for (const p of existingProducers as Array<any>) {
        await this.consumeProducer(p.producerId, p.peerId, p.username);
      }

      // Publish our microphone
      const track = this.localStream.getAudioTracks()[0];
      if (track) {
        this.micProducer = await this.sendTransport!.produce({
          track,
          appData: { source: 'mic' },
        });
      }

      this.setStatus('connected');
    } catch (err: any) {
      this.setStatus('error');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      this.cleanup();
      throw err;
    }
  }

  private async createSendTransport() {
    const { params } = await this.request<any>('createTransport', {
      direction: 'send',
    });
    this.sendTransport = this.device!.createSendTransport(params);

    this.sendTransport.on('connect', async ({ dtlsParameters }, cb, errback) => {
      try {
        await this.request('connectTransport', {
          transportId: this.sendTransport!.id,
          dtlsParameters,
        });
        cb();
      } catch (e: any) {
        errback(e);
      }
    });
    this.sendTransport.on('produce', async ({ kind, rtpParameters, appData }, cb, errback) => {
      try {
        const { id } = await this.request<{ id: string }>('produce', {
          transportId: this.sendTransport!.id,
          kind,
          rtpParameters,
          appData,
        });
        cb({ id });
      } catch (e: any) {
        errback(e);
      }
    });
  }

  private async createRecvTransport() {
    const { params } = await this.request<any>('createTransport', {
      direction: 'recv',
    });
    this.recvTransport = this.device!.createRecvTransport(params);

    this.recvTransport.on('connect', async ({ dtlsParameters }, cb, errback) => {
      try {
        await this.request('connectTransport', {
          transportId: this.recvTransport!.id,
          dtlsParameters,
        });
        cb();
      } catch (e: any) {
        errback(e);
      }
    });
  }

  private registerSocketEvents() {
    this.socket!.on('peerJoined', ({ peerId, username }) => {
      this.emit('participantJoined', { peerId, displayName: username });
    });
    this.socket!.on('peerLeft', ({ peerId }) => {
      this.emit('participantLeft', peerId);
    });
    this.socket!.on('newProducer', async ({ producerId, peerId, username }) => {
      await this.consumeProducer(producerId, peerId, username);
    });
    this.socket!.on('activeSpeaker', ({ peerId }) => {
      this.emit('activeSpeaker', peerId ?? null);
    });
  }

  private async consumeProducer(
    producerId: string,
    peerId: string,
    username: string
  ) {
    if (!this.device || !this.recvTransport) return;
    const data = await this.request<any>('consume', {
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
    await this.request('resumeConsumer', { consumerId: consumer.id });

    this.emit('remoteStream', {
      peerId,
      displayName: username,
      stream: new MediaStream([consumer.track]),
    });
  }

  /** Mute / unmute the local microphone. */
  setMicEnabled(enabled: boolean) {
    if (this.micProducer) {
      if (enabled) this.micProducer.resume();
      else this.micProducer.pause();
    }
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
  }

  /** Leave the call and release all resources. */
  leave() {
    if (this.socket) {
      this.socket.emit('sdk:leave', {});
    }
    this.cleanup();
    this.setStatus('ended');
  }

  private cleanup() {
    this.micProducer?.close();
    this.consumers.forEach((c) => c.close());
    this.consumers.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.socket?.disconnect();
    this.micProducer = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.localStream = null;
    this.socket = null;
    this.device = null;
  }
}
