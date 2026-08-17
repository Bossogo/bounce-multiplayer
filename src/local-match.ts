import {
  BOUNCE_VELOCITY,
  COUNTDOWN_MS,
  FLOOR_Y,
  PLAYER_RADIUS,
  TICK_RATE,
  type GameSnapshot,
  type PlayerId,
} from '../shared/protocol';
import {
  applyBounce,
  createMatchSnapshot,
  pickWinner,
  resolveCollisions,
  stepObstacles,
  stepPlayer,
} from '../shared/sim';

export class LocalMatch {
  snapshot: GameSnapshot;
  private pending = new Set<PlayerId>();
  private auto = false;
  private autoAcc: Record<PlayerId, number> = { p1: 0, p2: 0 };

  constructor() {
    this.snapshot = this.fresh('LOCAL');
  }

  startPlay(): void {
    this.auto = false;
    this.snapshot = this.fresh('LOCAL');
    this.beginCountdown();
  }

  startAttract(): void {
    this.auto = true;
    this.snapshot = this.fresh('DEMO');
    this.beginCountdown();
  }

  rematch(): void {
    this.startPlay();
  }

  bounce(id: PlayerId): void {
    if (this.auto) return;
    if (this.snapshot.phase === 'playing') this.pending.add(id);
  }

  step(dt: number): void {
    const snap = this.snapshot;
    if (snap.phase === 'countdown') {
      snap.countdownMs -= dt * 1000;
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

    if (this.auto) this.autoBounce(dt);

    const tick = 1 / TICK_RATE;
    // dt can be larger than a tick; step in fixed slices
    let remain = Math.min(dt, 0.05);
    while (remain > 0) {
      const slice = Math.min(tick, remain);
      for (const id of this.pending) {
        const player = snap.players.find((p) => p.id === id);
        if (player) applyBounce(player);
      }
      this.pending.clear();

      for (const player of snap.players) {
        stepPlayer(player, slice, { floorLethal: true });
      }
      stepObstacles(snap.obstacles, slice);
      resolveCollisions(snap.players, snap.obstacles);
      snap.tick += 1;
      remain -= slice;
    }

    const alive = snap.players.filter((p) => p.alive).length;
    if (alive <= 1) {
      snap.phase = 'finished';
      snap.winnerId = pickWinner(snap.players);
      if (this.auto) {
        this.startAttract();
      }
    }
  }

  private beginCountdown(): void {
    this.pending.clear();
    this.snapshot.phase = 'countdown';
    this.snapshot.countdownMs = this.auto ? 800 : COUNTDOWN_MS;
    this.snapshot.winnerId = null;
    this.snapshot.tick = 0;
    this.snapshot.playerCount = 2;
  }

  private fresh(code: string): GameSnapshot {
    return createMatchSnapshot(code, { p1: 'Left', p2: 'Right' });
  }

  private autoBounce(dt: number): void {
    for (const player of this.snapshot.players) {
      if (!player.alive) continue;
      this.autoAcc[player.id] += dt;
      const interval = player.id === 'p1' ? 0.42 : 0.5;
      if (this.autoAcc[player.id] >= interval && player.vy > -40) {
        this.autoAcc[player.id] = 0;
        this.pending.add(player.id);
      }
    }
  }
}
