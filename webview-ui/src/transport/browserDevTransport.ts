import type { ClientMessage, ServerMessage } from '../../../core/src/messages.js';
import type { MessageTransport } from './types.js';

/**
 * Dev-mode transport for browser runtime.
 *
 * Receives via window 'message' events (matching `browserMock.dispatchMockMessages`,
 * which fires `window.dispatchEvent(new MessageEvent('message', { data }))`).
 *
 * Sends are no-ops in dev — there's no real extension or server to receive them.
 * For the boardroom UI this is fine since outgoing state changes (chat, PATCH,
 * etc.) go directly to the FastAPI backend via fetch(), not through the
 * pixel-office transport.
 */
export class BrowserDevTransport implements MessageTransport {
  send(message: ClientMessage): void {
    console.debug('[BrowserDevTransport] send (no-op in dev):', message.type);
  }

  onMessage(handler: (message: ServerMessage) => void): () => void {
    const listener = (e: MessageEvent) => handler(e.data as ServerMessage);
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }

  dispose(): void {
    // Listeners are removed by their individual return functions.
  }
}
