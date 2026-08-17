import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  BOUNCE_VELOCITY,
  COUNTDOWN_MS,
  FLOOR_Y,
  PLAYER_RADIUS,
  TICK_RATE,
  type ClientMessage,
  type PlayerId,
  type ServerMessage,
} from '../shared/protocol.js';
import {
  applyBounce,
  createMatchSnapshot,
  pickWinner,
  resolveCollisions,
  stepObstacles,
  stepPlayer,
} from '../shared/sim.js';
import { getStore, type RoomRecord } from './store.js';

const ownerId = randomUUID();
const dtMs = 1000 / TICK_RATE;

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function sendError(socket: WebSocket, message: string): void {
  send(socket, { type: 'error', message });
}

export class GameHub {
  private store = getStore();
  private local = new Map<string, Map<PlayerId, WebSocket>>();
  private socketMeta = new WeakMap<WebSocket, { code: string; id: PlayerId }>();
  private lastSent = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, dtMs);
  }

  attach(socket: WebSocket): void {
    socket.on('message', (raw) => {
      void this.onMessage(socket, raw);
    });
    socket.on('close', () => {
      void this.onClose(socket);
    });
  }

  private async onMessage(socket: WebSocket, raw: unknown): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      sendError(socket, 'Invalid message');
      return;
    }

    try {
      if (msg.type === 'create') {
        await this.create(socket, msg.name);
        return;
      }
      if (msg.type === 'join') {
        await this.join(socket, msg.code, msg.name);
        return;
      }
      const meta = this.socketMeta.get(socket);
      if (!meta) {
        sendError(socket, 'Join a room first');
        return;
      }
      if (msg.type === 'bounce' || msg.type === 'rematch') {
        await this.handle(meta.code, meta.id, msg);
      }
    } catch (err) {
      sendError(socket, err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  private async create(socket: WebSocket, name?: string): Promise<void> {
    const code = await this.allocateCode();
    const display = displayName(name, 'p1');
    const snapshot = createMatchSnapshot(code, { p1: display });
    snapshot.playerCount = 1;
    const record: RoomRecord = {
      snapshot,
      seats: { p1: { name: display } },
      pendingBounce: [],
    };
    await this.store.set(code, record);
    this.bind(socket, code, 'p1');
    send(socket, { type: 'room', you: 'p1', snapshot });
  }

  private async join(socket: WebSocket, rawCode: string, name?: string): Promise<void> {
    const code = rawCode.replace(/\D/g, '').padStart(4, '0').slice(-4);
    const record = await this.store.get(code);
    if (!record) throw new Error('No room with that code');
    if (record.snapshot.playerCount >= 2 || record.seats.p2) {
      throw new Error('Room is full');
    }
    if (
      record.snapshot.phase !== 'lobby' &&
      record.snapshot.phase !== 'finished'
    ) {
      throw new Error('Match already in progress');
    }

    const display = displayName(name, 'p2');
    record.seats.p2 = { name: display };
    const player = record.snapshot.players.find((p) => p.id === 'p2');
    if (player) player.name = display;
    record.snapshot.playerCount = 2;
    if (record.snapshot.phase === 'lobby') {
      beginCountdown(record);
    }
    await this.store.set(code, record);
    this.bind(socket, code, 'p2');
    send(socket, { type: 'room', you: 'p2', snapshot: record.snapshot });
    this.broadcast(code, record);
  }

  private async handle(
    code: string,
    id: PlayerId,
    msg: Extract<ClientMessage, { type: 'bounce' | 'rematch' }>,
  ): Promise<void> {
    const record = await this.store.get(code);
    if (!record) return;

    if (msg.type === 'bounce') {
      if (record.snapshot.phase === 'playing' && !record.pendingBounce.includes(id)) {
        record.pendingBounce.push(id);
        await this.store.set(code, record);
      }
      return;
    }

    if (Object.keys(record.seats).length < 2) return;
    const names: Partial<Record<PlayerId, string>> = {};
    for (const [seatId, seat] of Object.entries(record.seats)) {
      if (seat) names[seatId as PlayerId] = seat.name;
    }
    record.snapshot = createMatchSnapshot(code, names);
    record.snapshot.playerCount = 2;
    record.pendingBounce = [];
    beginCountdown(record);
    await this.store.set(code, record);
    this.broadcast(code, record);
  }

  private async onClose(socket: WebSocket): Promise<void> {
    const meta = this.socketMeta.get(socket);
    if (!meta) return;
    const { code, id } = meta;
    this.unbind(socket, code, id);

    const record = await this.store.get(code);
    if (!record) return;
    delete record.seats[id];
    record.snapshot.playerCount = Object.keys(record.seats).length;
    record.pendingBounce = record.pendingBounce.filter((p) => p !== id);

    if (
      record.snapshot.phase === 'playing' ||
      record.snapshot.phase === 'countdown'
    ) {
      record.snapshot.phase = 'finished';
      const remaining = (Object.keys(record.seats)[0] as PlayerId | undefined) ?? null;
      record.snapshot.winnerId = remaining;
    }

    if (record.snapshot.playerCount === 0) {
      await this.store.del(code);
      this.local.delete(code);
      this.lastSent.delete(code);
      return;
    }

    await this.store.set(code, record);
    this.broadcast(code, record);
  }

  private async tick(): Promise<void> {
    const codes = new Set(this.local.keys());
    for (const code of codes) {
      const record = await this.store.get(code);
      if (!record) continue;

      const lead = await this.store.tryLead(code, ownerId, 2);
      if (
        lead &&
        (record.snapshot.phase === 'countdown' ||
          record.snapshot.phase === 'playing')
      ) {
        stepRecord(record, dtMs);
        await this.store.set(code, record);
      }

      const sent = this.lastSent.get(code) ?? -1;
      if (record.snapshot.tick !== sent) {
        this.lastSent.set(code, record.snapshot.tick);
        this.broadcast(code, record);
      }
    }
  }

  private async allocateCode(): Promise<string> {
    for (let attempt = 0; attempt < 40; attempt++) {
      const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      const existing = await this.store.get(code);
      if (!existing) return code;
    }
    throw new Error('Could not allocate a room code');
  }

  private bind(socket: WebSocket, code: string, id: PlayerId): void {
    let seats = this.local.get(code);
    if (!seats) {
      seats = new Map();
      this.local.set(code, seats);
    }
    seats.set(id, socket);
    this.socketMeta.set(socket, { code, id });
  }

  private unbind(socket: WebSocket, code: string, id: PlayerId): void {
    const seats = this.local.get(code);
    if (!seats) return;
    if (seats.get(id) === socket) seats.delete(id);
    if (seats.size === 0) this.local.delete(code);
  }

  private broadcast(code: string, record: RoomRecord): void {
    const payload: ServerMessage = { type: 'state', snapshot: record.snapshot };
    const seats = this.local.get(code);
    if (!seats) return;
    for (const socket of seats.values()) {
      send(socket, payload);
    }
  }
}

function displayName(name: string | undefined, id: PlayerId): string {
  return (name?.trim() || `Player ${id === 'p1' ? '1' : '2'}`).slice(0, 16);
}

function beginCountdown(record: RoomRecord): void {
  record.snapshot.phase = 'countdown';
  record.snapshot.countdownMs = COUNTDOWN_MS;
  record.snapshot.winnerId = null;
  record.snapshot.tick = 0;
}

function stepRecord(record: RoomRecord, dt: number): void {
  const snap = record.snapshot;
  if (snap.phase === 'countdown') {
    snap.countdownMs -= dt;
    snap.tick += 1;
    if (snap.countdownMs <= 0) {
      snap.countdownMs = 0;
      snap.phase = 'playing';
      for (const player of snap.players) {
        player.y = FLOOR_Y - PLAYER_RADIUS - 8;
        player.vy = BOUNCE_VELOCITY * 0.55;
      }
    }
    return;
  }

  if (snap.phase !== 'playing') return;

  const seconds = dt / 1000;
  for (const id of record.pendingBounce) {
    const player = snap.players.find((p) => p.id === id);
    if (player) applyBounce(player);
  }
  record.pendingBounce = [];

  for (const player of snap.players) {
    stepPlayer(player, seconds, { floorLethal: true });
  }
  stepObstacles(snap.obstacles, seconds);
  resolveCollisions(snap.players, snap.obstacles);
  snap.tick += 1;

  const alive = snap.players.filter((p) => p.alive).length;
  if (alive <= 1) {
    snap.phase = 'finished';
    snap.winnerId = pickWinner(snap.players);
  }
}
