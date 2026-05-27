import { isBrowserRuntime } from '../runtime.js';
import { BrowserDevTransport } from './browserDevTransport.js';
import { PostMessageTransport } from './postMessageTransport.js';
import type { MessageTransport } from './types.js';
import { WebSocketTransport } from './webSocketTransport.js';

function createTransport(): MessageTransport {
  if (!isBrowserRuntime) {
    return new PostMessageTransport();
  }
  // Browser + Vite dev mode: use the dev transport that listens to the
  // window 'message' events that browserMock dispatches. No WebSocket
  // server is running on the dev port, and the boardroom UI fetches
  // backend data via direct HTTP rather than through this transport.
  if (import.meta.env.DEV) {
    return new BrowserDevTransport();
  }
  // Standalone browser (production): connect via WebSocket to the host serving the SPA
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  const ws = new WebSocketTransport(wsUrl);
  ws.connect();
  return ws;
}

/** Singleton transport instance. Import this everywhere instead of vscodeApi. */
export const transport: MessageTransport = createTransport();
export type { MessageTransport } from './types.js';
