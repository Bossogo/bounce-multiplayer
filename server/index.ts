import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage } from '../shared/protocol.js';
import { Room } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3001);

const rooms = new Map<string, Room>();
const socketRoom = new WeakMap<WebSocket, string>();

function generateCode(): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    const existing = rooms.get(code);
    if (!existing || existing.isEmpty) return code;
  }
  throw new Error('Could not allocate a room code');
}

function sendError(ws: WebSocket, message: string): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'error', message }));
  }
}

function cleanupRoom(code: string): void {
  const room = rooms.get(code);
  if (room && room.isEmpty) rooms.delete(code);
}

const server = createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Production: serve Vite build if present
  const dist = path.join(root, 'dist');
  try {
    const urlPath = req.url === '/' ? '/index.html' : (req.url ?? '/');
    const filePath = path.join(dist, urlPath.split('?')[0]);
    if (!filePath.startsWith(dist)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    };
    res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bounce server running. Start the Vite client with pnpm dev.');
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      sendError(ws, 'Invalid message');
      return;
    }

    try {
      if (msg.type === 'create') {
        const code = generateCode();
        const room = new Room(code);
        rooms.set(code, room);
        room.join(ws, msg.name);
        socketRoom.set(ws, code);
        return;
      }

      if (msg.type === 'join') {
        const code = msg.code.replace(/\D/g, '').padStart(4, '0').slice(-4);
        const room = rooms.get(code);
        if (!room) {
          sendError(ws, 'No room with that code');
          return;
        }
        room.join(ws, msg.name);
        socketRoom.set(ws, code);
        return;
      }

      const code = socketRoom.get(ws);
      if (!code) {
        sendError(ws, 'Join a room first');
        return;
      }
      const room = rooms.get(code);
      if (!room) {
        sendError(ws, 'Room gone');
        return;
      }
      room.handle(ws, msg);
    } catch (err) {
      sendError(ws, err instanceof Error ? err.message : 'Something went wrong');
    }
  });

  ws.on('close', () => {
    const code = socketRoom.get(ws);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    room.remove(ws);
    cleanupRoom(code);
  });
});

server.listen(port, () => {
  console.log(`Bounce WS server on http://localhost:${port} (ws path /ws)`);
});
