import { EventEmitter } from 'events';

/**
 * Cross-module event bus.
 *
 * Lets REST controllers (which don't hold a reference to `io`) signal the
 * socket layer about state changes so it can broadcast accordingly.
 *
 * Events:
 *   memberAdded   { conversationId, userId, addedBy }
 *   memberRemoved { conversationId, userId, removedBy }
 */
export const appEvents = new EventEmitter();
appEvents.setMaxListeners(100);
