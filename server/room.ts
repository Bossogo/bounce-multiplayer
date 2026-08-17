import type { WebSocket } from 'ws';
import {
  BOUNCE_VELOCITY,
  COUNTDOWN_MS,
  FLOOR_Y,
  PLAYER_RADIUS,
  TICK_RATE,
  type ClientMessage,
  type GameSnapshot,
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

interface Seat {
  id: PlayerId;
  name: string;
  socket: WebSocket;
}

export class Room {
  readonly code: string;
  private seats = new Map<PlayerId, Seat>();
  private snapshot: GameSnapshot;
  private interval: ReturnType<typeof setInterval> | null = null;
  private pendingBounce = new Set<PlayerId>();

  constructor(code: string) {
    this.code = code;
    this.snapshot = createMatchSnapshot(code, {});
  }

  get size(): number {
    return this.seats.size;
  }

  get isEmpty(): boolean {
    return this.seats.size === 0;
  }

  has(socket: WebSocket): boolean {
    for (const seat of this.seats.values()) {
      if (seat.socket === socket) return true;
    }
    return false;
  }

  playerIdFor(socket: WebSocket): PlayerId | null {
    for (const seat of this.seats.values()) {
      if (seat.socket === socket) return seat.id;
    }
    return null;
  }

  join(socket: WebSocket, name?: string): PlayerId {
    if (this.seats.size >= 2) {
      throw new Error('Room is full');
    }
    if (this.snapshot.phase !== 'lobby' && this.snapshot.phase !== 'finished') {
      throw new Error('Match already in progress');
    }

    const id: PlayerId = this.seats.has('p1') ? 'p2' : 'p1';
    const display = (name?.trim() || `Player ${id === 'p1' ? '1' : '2'}`).slice(
      0,
      16,
    );
    this.seats.set(id, { id, name: display, socket });

    const player = this.snapshot.players.find((p) => p.id === id);
    if (player) player.name = display;

    this.snapshot.playerCount = this.seats.size;
    this.send(socket, { type: 'room', you: id, snapshot: this.snapshot });
    this.broadcastState();

    if (this.seats.size === 2 && this.snapshot.phase === 'lobby') {
      this.startCountdown();
    }

    return id;
  }

  remove(socket: WebSocket): void {
    const id = this.playerIdFor(socket);
    if (!id) return;
    this.seats.delete(id);
    this.pendingBounce.delete(id);
    this.snapshot.playerCount = this.seats.size;

    if (this.snapshot.phase === 'playing' || this.snapshot.phase === 'countdown') {
      this.stopLoop();
      this.snapshot.phase = 'finished';
      const remaining = [...this.seats.keys()][0] ?? null;
      this.snapshot.winnerId = remaining;
      this.broadcastState();
    } else {
      this.broadcastState();
    }
  }

  handle(socket: WebSocket, msg: ClientMessage): void {
    const id = this.playerIdFor(socket);
    if (!id) return;

    if (msg.type === 'bounce') {
      if (this.snapshot.phase === 'playing') {
        this.pendingBounce.add(id);
      }
      return;
    }

    if (msg.type === 'rematch') {
      if (this.seats.size < 2) return;
      const names: Partial<Record<PlayerId, string>> = {};
      for (const seat of this.seats.values()) {
        names[seat.id] = seat.name;
      }
      this.snapshot = createMatchSnapshot(this.code, names);
      this.snapshot.playerCount = this.seats.size;
      this.pendingBounce.clear();
      this.startCountdown();
    }
  }

  private startCountdown(): void {
    this.stopLoop();
    this.snapshot.phase = 'countdown';
    this.snapshot.countdownMs = COUNTDOWN_MS;
    this.snapshot.winnerId = null;
    this.snapshot.tick = 0;
    this.broadcastState();

    const dt = 1000 / TICK_RATE;
    this.interval = setInterval(() => {
      if (this.snapshot.phase === 'countdown') {
        this.snapshot.countdownMs -= dt;
        if (this.snapshot.countdownMs <= 0) {
          this.snapshot.countdownMs = 0;
          this.snapshot.phase = 'playing';
          // Pop both players off the floor so the opening bounce matters
          for (const player of this.snapshot.players) {
            player.y = FLOOR_Y - PLAYER_RADIUS - 8;
            player.vy = BOUNCE_VELOCITY * 0.55;
          }
        }
        this.broadcastState();
        return;
      }

      if (this.snapshot.phase !== 'playing') return;

      const seconds = dt / 1000;
      for (const id of this.pendingBounce) {
        const player = this.snapshot.players.find((p) => p.id === id);
        if (player) applyBounce(player);
      }
      this.pendingBounce.clear();

      for (const player of this.snapshot.players) {
        stepPlayer(player, seconds, { floorLethal: true });
      }
      stepObstacles(this.snapshot.obstacles, seconds);
      resolveCollisions(this.snapshot.players, this.snapshot.obstacles);

      this.snapshot.tick += 1;

      const alive = this.snapshot.players.filter((p) => p.alive).length;
      if (alive <= 1) {
        this.snapshot.phase = 'finished';
        this.snapshot.winnerId = pickWinner(this.snapshot.players);
        this.stopLoop();
      }

      this.broadcastState();
    }, dt);
  }

  private stopLoop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private broadcastState(): void {
    const payload: ServerMessage = { type: 'state', snapshot: this.snapshot };
    for (const seat of this.seats.values()) {
      this.send(seat.socket, payload);
    }
  }

  private send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }
}
