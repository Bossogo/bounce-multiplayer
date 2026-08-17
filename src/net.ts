import type { ClientMessage, ServerMessage } from '../shared/protocol';

type Handler = (msg: ServerMessage) => void;

export class NetClient {
  private ws: WebSocket | null = null;
  private handler: Handler | null = null;
  private opened = false;

  connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    return this.tryConnect(this.candidateUrls(), 0);
  }

  onMessage(handler: Handler): void {
    this.handler = handler;
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private candidateUrls(): string[] {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const urls = [`${protocol}//${location.host}/ws`];
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      urls.push('ws://localhost:3001/ws');
    }
    return [...new Set(urls)];
  }

  private tryConnect(urls: string[], index: number): Promise<void> {
    const url = urls[index];
    if (!url) {
      return Promise.reject(new Error('Could not connect to game server'));
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      this.opened = false;
      let settled = false;

      const fail = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (index + 1 < urls.length) {
          this.tryConnect(urls, index + 1).then(resolve, reject);
        } else {
          reject(new Error('Could not connect to game server'));
        }
      };

      const timer = window.setTimeout(() => {
        ws.close();
        fail();
      }, 2500);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.opened = true;
        resolve();
      };

      ws.onerror = () => {
        // close follows
      };

      ws.onclose = () => {
        this.ws = null;
        if (!this.opened) {
          fail();
          return;
        }
        this.handler?.({
          type: 'error',
          message: 'Disconnected from server',
        });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as ServerMessage;
          this.handler?.(msg);
        } catch {
          // ignore malformed
        }
      };
    });
  }
}
