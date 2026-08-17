import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { GameHub } from './hub.js';

const hub = new GameHub();
hub.start();

export function attachGame(server: Server): void {
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    hub.attach(ws);
  });
}
