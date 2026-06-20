'use client';

import { io, Socket } from 'socket.io-client';
import { getServerBase } from './config';

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId?: string;
  content: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
  attachmentSize?: number | null;
  createdAt: string;
  sender?: { id: string; username: string };
}

export interface CallInvite {
  conversationId: string;
  fromUserId: string;
  fromUsername: string;
  conversation: {
    id: string;
    name: string | null;
    isGroup: boolean;
    members: { id: string; username: string }[];
  };
}

export interface ChatCallbacks {
  onMessage?: (msg: ChatMessage) => void;
  onNotify?: (msg: ChatMessage) => void;
  onTyping?: (info: {
    conversationId: string;
    userId: string;
    username: string;
    isTyping: boolean;
  }) => void;
  onRead?: (info: { conversationId: string; userId: string; lastReadAt: string }) => void;
  onMemberAdded?: (info: {
    conversationId: string;
    member: { userId: string; user: { id: string; username: string } };
    addedBy: { id: string; username: string };
  }) => void;
  onMemberRemoved?: (info: {
    conversationId: string;
    removedUserId: string;
    removedBy: { id: string; username: string };
  }) => void;
  onAdded?: (info: { conversation: any }) => void;
  onRemoved?: (info: {
    conversationId: string;
    removedBy: { id: string; username: string };
  }) => void;
  onCallInvite?: (invite: CallInvite) => void;
  onCallDeclined?: (info: { conversationId: string; byUserId: string; byUsername: string }) => void;
  onCallCancelled?: (info: { conversationId: string }) => void;
  onCallEnded?: (info: { conversationId: string }) => void;
}

/**
 * A connected socket for the /chat page.
 *
 * Reuses the SAME socket.io connection that handles room/call signaling,
 * just with the chat events overlaid on top.
 */
export class ChatClient {
  socket: Socket;
  callbacks: ChatCallbacks;

  constructor(token: string, callbacks: ChatCallbacks = {}) {
    this.callbacks = callbacks;
    this.socket = io(getServerBase(), {
      auth: { token },
      transports: ['websocket'],
    });

    this.socket.on('chat:message', ({ message }) => this.callbacks.onMessage?.(message));
    this.socket.on('chat:notify', ({ message }) => this.callbacks.onNotify?.(message));
    this.socket.on('chat:typing', (info) => this.callbacks.onTyping?.(info));
    this.socket.on('chat:read', (info) => this.callbacks.onRead?.(info));
    this.socket.on('chat:memberAdded', (info) => this.callbacks.onMemberAdded?.(info));
    this.socket.on('chat:memberRemoved', (info) => this.callbacks.onMemberRemoved?.(info));
    this.socket.on('chat:added', (info) => this.callbacks.onAdded?.(info));
    this.socket.on('chat:removed', (info) => this.callbacks.onRemoved?.(info));
    this.socket.on('call:invite', (invite) => this.callbacks.onCallInvite?.(invite));
    this.socket.on('call:declined', (info) => this.callbacks.onCallDeclined?.(info));
    this.socket.on('call:cancelled', (info) => this.callbacks.onCallCancelled?.(info));
    this.socket.on('call:ended', (info) => this.callbacks.onCallEnded?.(info));
  }

  private emit<T = any>(event: string, data?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      this.socket.emit(event, data, (response: any) => {
        if (response?.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  }

  async waitConnect() {
    if (this.socket.connected) return;
    await new Promise<void>((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('connect_error', reject);
    });
  }

  joinConversation(conversationId: string) {
    return this.emit('chat:join', { conversationId });
  }

  leaveConversation(conversationId: string) {
    return this.emit('chat:leave', { conversationId });
  }

  send(conversationId: string, content: string, attachment?: any) {
    return this.emit<{ message: ChatMessage }>('chat:send', {
      conversationId,
      content,
      attachment,
    });
  }

  setTyping(conversationId: string, isTyping: boolean) {
    this.socket.emit('chat:typing', { conversationId, isTyping });
  }

  markRead(conversationId: string, lastReadAt?: string) {
    return this.emit('chat:markRead', { conversationId, lastReadAt });
  }

  startCall(conversationId: string) {
    return this.emit('call:start', { conversationId });
  }

  declineCall(conversationId: string) {
    this.socket.emit('call:decline', { conversationId });
  }

  cancelCall(conversationId: string) {
    this.socket.emit('call:cancel', { conversationId });
  }

  disconnect() {
    this.socket.disconnect();
  }
}
