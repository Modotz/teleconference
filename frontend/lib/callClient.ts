'use client';

import { Device } from 'mediasoup-client';
import type { Transport, Producer, Consumer } from 'mediasoup-client/types';
import type { Socket } from 'socket.io-client';

/**
 * Audio-only voice call client. Piggybacks on the existing socket (chat
 * socket / signaling socket — both are the same connection) and uses the
 * room manager's mediasoup events with the call's synthetic room id.
 */

export interface RemoteCallPeer {
  peerId: string;
  username: string;
  stream: MediaStream;
}

export interface CallCallbacks {
  onPeerJoined?: (peer: { peerId: string; username: string }) => void;
  onPeerLeft?: (peerId: string) => void;
  onRemoteTrack?: (peer: RemoteCallPeer) => void;
  onActiveSpeaker?: (peerId: string | null) => void;
}

export class CallClient {
  socket: Socket;
  device: Device | null = null;
  sendTransport: Transport | null = null;
  recvTransport: Transport | null = null;
  audioProducer: Producer | null = null;
  consumers = new Map<string, Consumer>();
  conversationId: string;
  callbacks: CallCallbacks;

  constructor(socket: Socket, conversationId: string, callbacks: CallCallbacks = {}) {
    this.socket = socket;
    this.conversationId = conversationId;
    this.callbacks = callbacks;
  }

  private emit<T = any>(event: string, data?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      this.socket.emit(event, data, (response: any) => {
        if (response?.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  }

  /**
   * Accept/join the call: server creates router, returns rtpCapabilities,
   * we set up transports and publish our microphone.
   */
  async join(localStream: MediaStream) {
    const { rtpCapabilities, existingProducers, peers } = await this.emit<any>(
      'call:accept',
      { conversationId: this.conversationId }
    );

    this.device = new Device();
    await this.device.load({ routerRtpCapabilities: rtpCapabilities });

    await this.createSendTransport();
    await this.createRecvTransport();

    this.registerEvents();

    // Consume existing peers' audio
    for (const p of existingProducers) {
      await this.consumeProducer(p.producerId, p.peerId, p.username);
    }

    // Publish our microphone
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack && this.sendTransport) {
      this.audioProducer = await this.sendTransport.produce({
        track: audioTrack,
        appData: { source: 'mic-call' },
      });
    }

    return { peers };
  }

  private async createSendTransport() {
    const { params } = await this.emit<any>('createTransport', { direction: 'send' });
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
    const { params } = await this.emit<any>('createTransport', { direction: 'recv' });
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

  private registerEvents() {
    this.socket.on('peerJoined', (peer) => this.callbacks.onPeerJoined?.(peer));
    this.socket.on('peerLeft', ({ peerId }) => {
      this.callbacks.onPeerLeft?.(peerId);
    });
    this.socket.on('newProducer', async ({ producerId, peerId, username }) => {
      await this.consumeProducer(producerId, peerId, username);
    });
    this.socket.on('activeSpeaker', ({ peerId }) =>
      this.callbacks.onActiveSpeaker?.(peerId)
    );
  }

  private async consumeProducer(producerId: string, peerId: string, username: string) {
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
    await this.emit('resumeConsumer', { consumerId: consumer.id });

    const stream = new MediaStream([consumer.track]);
    this.callbacks.onRemoteTrack?.({ peerId, username, stream });
  }

  toggleMic(enabled: boolean) {
    if (!this.audioProducer) return;
    if (enabled) this.audioProducer.resume();
    else this.audioProducer.pause();
  }

  async leave() {
    try {
      await this.emit('call:leave', { conversationId: this.conversationId });
    } catch {
      /* ignore */
    }
    this.audioProducer?.close();
    this.consumers.forEach((c) => c.close());
    this.sendTransport?.close();
    this.recvTransport?.close();
    // Detach socket listeners we added so they don't leak when reused
    this.socket.off('peerJoined');
    this.socket.off('peerLeft');
    this.socket.off('newProducer');
    this.socket.off('activeSpeaker');
  }
}
