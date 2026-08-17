import {
  BOUNCE_VELOCITY,
  COUNTDOWN_MS,
  FLOOR_Y,
  PLAYER_RADIUS,
  TICK_RATE,
  type GameSnapshot,
  type ObstacleState,
  type PlayerId,
  type PlayerState,
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
  private cpu: PlayerId | null = null;
  private autoAcc: Record<PlayerId, number> = { p1: 0, p2: 0 };
  private cpuCooldown = 0;

  constructor() {
    this.snapshot = this.fresh('LOCAL');
  }

  startPlay(): void {
    this.auto = false;
    this.cpu = 'p2';
    this.cpuCooldown = 0;
    this.snapshot = this.fresh('LOCAL');
    this.beginCountdown();
  }

  startAttract(): void {
    this.auto = true;
    this.cpu = null;
    this.snapshot = this.fresh('DEMO');
    this.beginCountdown();
  }

  rematch(): void {
    this.startPlay();
  }

  bounce(id: PlayerId): void {
    if (this.auto) return;
    if (this.cpu === id) this.cpu = null;
    if (
      this.snapshot.phase === 'playing' ||
      this.snapshot.phase === 'countdown'
    ) {
      this.pending.add(id);
    }
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
        for (const id of this.pending) {
          const player = snap.players.find((p) => p.id === id);
          if (player) applyBounce(player);
        }
        this.pending.clear();
      }
      return;
    }

    if (snap.phase !== 'playing') return;

    if (this.auto) this.autoBounce(dt);
    else if (this.cpu) this.cpuThink(dt);

    const tick = 1 / TICK_RATE;
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
    const names =
      code === 'LOCAL' ? { p1: 'You', p2: 'CPU' } : { p1: 'Left', p2: 'Right' };
    return createMatchSnapshot(code, names);
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

  private cpuThink(dt: number): void {
    this.cpuCooldown = Math.max(0, this.cpuCooldown - dt);
    if (this.cpuCooldown > 0 || !this.cpu) return;

    const me = this.snapshot.players.find((p) => p.id === this.cpu);
    if (!me?.alive) return;

    const floor = FLOOR_Y - PLAYER_RADIUS;
    const floorThreat = me.vy > 120 && me.y > floor - 110;
    const diesCoast = diesWithin(me, this.snapshot.obstacles, 0.32, false);
    const diesBounce = diesWithin(me, this.snapshot.obstacles, 0.32, true);
    const climbOpen = !diesBounce && me.vy > 90;

    let shouldBounce = false;
    if (floorThreat) shouldBounce = true;
    else if (diesCoast && !diesBounce) shouldBounce = true;
    else if (diesCoast && me.vy > 40) shouldBounce = true;
    else if (climbOpen) shouldBounce = true;

    if (!shouldBounce) return;
    if (Math.random() < 0.12) {
      this.cpuCooldown = 0.08;
      return;
    }

    this.pending.add(this.cpu);
    this.cpuCooldown = 0.16 + Math.random() * 0.12;
  }
}

function diesWithin(
  player: PlayerState,
  obstacles: ObstacleState[],
  seconds: number,
  bounceFirst: boolean,
): boolean {
  const ghost: PlayerState = { ...player };
  const bars = obstacles.map((o) => ({ ...o }));
  if (bounceFirst) applyBounce(ghost);
  const step = 1 / TICK_RATE;
  for (let t = 0; t < seconds; t += step) {
    stepPlayer(ghost, step, { floorLethal: true });
    stepObstacles(bars, step);
    resolveCollisions([ghost], bars);
    if (!ghost.alive) return true;
  }
  return false;
}
